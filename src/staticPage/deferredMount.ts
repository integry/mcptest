/**
 * Mounts the app over a prerendered page on the first input instead of at
 * load (issue #405). A reader who only reads never pays for React, the router,
 * the catalog data or the guide registry; the first pointer, key or form-field
 * focus starts the download, and the app mounts as soon as it is ready and no
 * press is in progress.
 *
 * The mount replaces the static DOM, so whatever the visitor started on it
 * carries over: scroll positions, the focused field with its text and caret,
 * a button click no static handler served, replayed on the app's matching
 * button, and the state the static handlers changed (staticPage.ts). Links
 * need nothing: they navigate natively.
 */

/** Finds an element again after the mount: its id, or its position under the nearest ancestor with an id. */
interface ElementLocator {
  scopeId: string | null;
  selector: string;
  index: number;
}

const cssEscape = (value: string): string => (
  typeof CSS !== 'undefined' && typeof CSS.escape === 'function' ? CSS.escape(value) : value.replace(/["\\]/g, '\\$&')
);

const selectorFor = (element: Element): string => {
  const tag = element.tagName.toLowerCase();
  const label = element.getAttribute('aria-label');
  if (label) return `${tag}[aria-label="${cssEscape(label)}"]`;
  const stableClass = Array.from(element.classList).find(name => !/^(active|is-|seo-)/.test(name));
  return stableClass ? `${tag}.${cssEscape(stableClass)}` : tag;
};

export const locateElement = (root: HTMLElement, element: Element): ElementLocator | null => {
  if (!root.contains(element) || element === root) return null;
  if (element.id) return { scopeId: element.id, selector: '', index: 0 };
  let scope = element.parentElement?.closest<HTMLElement>('[id]') ?? null;
  if (scope && (scope === root || !root.contains(scope))) scope = null;
  const container = scope ?? root;
  const selector = selectorFor(element);
  const index = Array.from(container.querySelectorAll(selector)).indexOf(element);
  return index === -1 ? null : { scopeId: scope?.id ?? null, selector, index };
};

export const resolveElement = (root: HTMLElement, locator: ElementLocator): HTMLElement | null => {
  const scope = locator.scopeId ? document.getElementById(locator.scopeId) : root;
  if (!scope || !root.contains(scope)) return null;
  if (!locator.selector) return scope;
  return (scope.querySelectorAll<HTMLElement>(locator.selector)[locator.index]) ?? null;
};

interface FocusSnapshot {
  locator: ElementLocator;
  value?: string;
  selection?: [number | null, number | null];
}

const isTextField = (element: Element): element is HTMLInputElement | HTMLTextAreaElement => (
  element instanceof HTMLTextAreaElement || (element instanceof HTMLInputElement && !['checkbox', 'radio', 'button', 'submit'].includes(element.type))
);

const snapshotFocus = (root: HTMLElement): FocusSnapshot | null => {
  const active = document.activeElement;
  if (!active || active === document.body) return null;
  const locator = locateElement(root, active);
  if (!locator) return null;
  if (!isTextField(active) || active.readOnly) return { locator };
  let selection: [number | null, number | null] | undefined;
  try {
    selection = [active.selectionStart, active.selectionEnd];
  } catch {
    // type="email" and friends expose no selection.
  }
  return { locator, value: active.value, selection };
};

/** Writes a value the way typing does, so a React-controlled field's onChange sees it. */
const setFieldValue = (field: HTMLInputElement | HTMLTextAreaElement, value: string): void => {
  const prototype = field instanceof HTMLTextAreaElement ? HTMLTextAreaElement.prototype : HTMLInputElement.prototype;
  Object.getOwnPropertyDescriptor(prototype, 'value')?.set?.call(field, value);
  field.dispatchEvent(new Event('input', { bubbles: true }));
};

const restoreFocus = (root: HTMLElement, snapshot: FocusSnapshot | null): void => {
  if (!snapshot) return;
  const element = resolveElement(root, snapshot.locator);
  if (!element) return;
  if (snapshot.value && isTextField(element) && !element.readOnly && element.value !== snapshot.value) {
    setFieldValue(element, snapshot.value);
  }
  element.focus({ preventScroll: true });
  if (snapshot.selection && isTextField(element)) {
    try {
      element.setSelectionRange(snapshot.selection[0], snapshot.selection[1]);
    } catch {
      // Not every input type supports a selection.
    }
  }
};

/** Scroll offsets of the page and of every scrolled element under `root` (the main panel, the sidebar). */
const snapshotScroll = (root: HTMLElement) => ({
  window: [window.scrollX, window.scrollY] as const,
  elements: Array.from(root.querySelectorAll<HTMLElement>('*'))
    .filter(element => element.scrollTop !== 0 || element.scrollLeft !== 0)
    .flatMap(element => {
      const locator = locateElement(root, element);
      return locator ? [{ locator, top: element.scrollTop, left: element.scrollLeft }] : [];
    }),
});

const restoreScroll = (root: HTMLElement, snapshot: ReturnType<typeof snapshotScroll>): void => {
  for (const { locator, top, left } of snapshot.elements) {
    const element = resolveElement(root, locator);
    if (element) {
      element.scrollTop = top;
      element.scrollLeft = left;
    }
  }
  const [x, y] = snapshot.window;
  if (window.scrollX !== x || window.scrollY !== y) window.scrollTo(x, y);
};

const isFormField = (target: EventTarget | null): boolean => (
  target instanceof HTMLElement && (target.isContentEditable || ['INPUT', 'TEXTAREA', 'SELECT'].includes(target.tagName))
);

export interface DeferredMountOptions {
  root: HTMLElement;
  /** Downloads what the mount needs; resolves to the function that renders the app and resolves after its first commit. */
  prepare: () => Promise<() => Promise<void>>;
  /** Clicks a static handler fully served; not replayed after the mount. */
  isHandled?: (element: Element) => boolean;
  /** Reads state the static handlers changed, just before the mount; the returned function applies it to the app. */
  snapshotState?: (root: HTMLElement) => () => void;
}

/** Waits for the first input, then mounts. Returns a function that starts the mount immediately. */
export const deferMountUntilInput = ({ root, prepare, isHandled = () => false, snapshotState = () => () => {} }: DeferredMountOptions): (() => void) => {
  let started = false;
  let pressed = false;
  let clickedButton: Element | null = null;
  let render: (() => Promise<void>) | null = null;
  let mounted = false;
  let mountScheduled = false;

  const listeners: [string, EventListener][] = [];
  const listen = (type: string, listener: EventListener) => {
    document.addEventListener(type, listener, { capture: true, passive: true });
    listeners.push([type, listener]);
  };
  const removeListeners = () => {
    for (const [type, listener] of listeners) document.removeEventListener(type, listener, { capture: true });
  };

  const mountWhenIdle = () => {
    if (!render || mounted || mountScheduled || pressed) return;
    mountScheduled = true;
    // After the click the release belongs to has been dispatched to the static element.
    window.setTimeout(() => {
      mountScheduled = false;
      // Another press may have started since the chunk resolved (or the last
      // release queued this timer). Keep the static handlers until its click
      // has run; the next release will schedule a fresh mount.
      if (pressed) return;
      mounted = true;
      // The mount replaces the scrolling panel too; a reader keeps their place.
      const scroll = snapshotScroll(root);
      const focus = snapshotFocus(root);
      const restoreState = snapshotState(root);
      // Decided now: the static handlers run after this capture-phase listener saw the click.
      const click = clickedButton && !isHandled(clickedButton) ? locateElement(root, clickedButton) : null;
      removeListeners();
      render!()
        .then(() => {
          restoreScroll(root, scroll);
          restoreFocus(root, focus);
          restoreState();
          if (click) resolveElement(root, click)?.click();
        })
        .catch(error => console.error('[Startup] The app failed to mount over the static page.', error));
    }, 0);
  };

  const start = () => {
    if (started) return;
    started = true;
    prepare()
      .then((ready) => {
        render = ready;
        mountWhenIdle();
      })
      .catch((error) => {
        // The static page keeps working; the next input tries again.
        started = false;
        console.warn('[Startup] Could not load the app.', error);
      });
  };

  listen('pointerdown', () => {
    pressed = true;
    start();
  });
  const release = () => {
    pressed = false;
    mountWhenIdle();
  };
  listen('pointerup', release);
  listen('pointercancel', release);
  listen('keydown', start);
  listen('focusin', (event) => {
    if (isFormField(event.target)) start();
  });
  listen('click', (event) => {
    const button = (event.target as Element | null)?.closest?.('button');
    if (button && root.contains(button)) clickedButton = button;
  });

  return start;
};
