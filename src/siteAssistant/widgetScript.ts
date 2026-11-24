import { widgetScriptUrl, type SiteAssistantConfig } from './config.mts';

/*
 * The solv.chat widget loader, shared by the site assistant's launcher
 * (./launcher.ts) and the service page's quote assistant
 * (src/servicePage/quoteAssistant.ts): `<endpoint>/widget.js` defines
 * `<solv-chat>` and installs `globalThis.solv.actions`; each assistant is a
 * `<solv-chat assistant endpoint>` element.
 */

export const SOLV_ELEMENT_NAME = 'solv-chat';
const LOAD_TIMEOUT_MS = 15_000;

/** One in-flight load per script URL, so two callers never add two scripts. */
const pending = new Map<string, Promise<void>>();

/** Loads widget.js once; resolves when `<solv-chat>` is defined. */
export const loadWidgetScript = (config: SiteAssistantConfig): Promise<void> => {
  if (customElements.get(SOLV_ELEMENT_NAME)) return Promise.resolve();
  const src = widgetScriptUrl(config);
  const inFlight = pending.get(src);
  if (inFlight) return inFlight;
  const load = new Promise<void>((resolve, reject) => {
    const script = document.createElement('script');
    script.src = src;
    script.async = true;
    script.dataset.siteAssistant = '';
    const fail = (reason: string) => {
      window.clearTimeout(timer);
      script.remove();
      reject(new Error(reason));
    };
    const timer = window.setTimeout(() => fail('timed out'), LOAD_TIMEOUT_MS);
    script.addEventListener('error', () => fail('the widget script failed to load'), { once: true });
    customElements.whenDefined(SOLV_ELEMENT_NAME).then(() => {
      window.clearTimeout(timer);
      resolve();
    }, () => {});
    document.head.append(script);
  }).finally(() => pending.delete(src));
  pending.set(src, load);
  return load;
};

/** A `<solv-chat>` element for one assistant, not yet attached. */
export const createWidgetElement = (config: SiteAssistantConfig): HTMLElement => {
  const widget = document.createElement(SOLV_ELEMENT_NAME);
  widget.setAttribute('assistant', config.assistantKey);
  widget.setAttribute('endpoint', config.endpoint);
  return widget;
};

/**
 * Opens an attached widget's panel, and leaves an open one open. The widget
 * launcher works after an asynchronous script load and opens the chat without
 * starting the visitor check. It toggles the panel and reports the state in
 * `aria-expanded` (solv.chat
 * packages/widget/src/element.ts). The panel can already be open from an
 * earlier call or from the conversation solv.chat restores from
 * sessionStorage, so the launcher is clicked only while it reports closed;
 * otherwise focus moves to the message input, as opening would.
 */
export const openWidgetPanel = (widget: HTMLElement): void => {
  const root = widget.shadowRoot;
  const launcher = root?.querySelector<HTMLButtonElement>('.solv-launcher');
  if (!launcher) return;
  if (launcher.getAttribute('aria-expanded') !== 'true') {
    launcher.click();
    return;
  }
  root?.querySelector<HTMLElement>('.solv-input')?.focus();
};

/** The page action API widget.js installs (solv.chat packages/widget/src/actions.ts). */
export interface SolvPageAction {
  name: string;
  description: string;
  input: Record<string, unknown>;
  confirm: boolean;
  run: (input: Record<string, unknown>) => unknown;
}

export interface SolvActionsApi {
  register(action: SolvPageAction): void;
  unregister(name: string): void;
}

export const getSolvActions = (): SolvActionsApi | null => {
  const actions = (globalThis as { solv?: { actions?: Partial<SolvActionsApi> } }).solv?.actions;
  return actions && typeof actions.register === 'function' && typeof actions.unregister === 'function'
    ? actions as SolvActionsApi
    : null;
};
