import './launcher.css';
import { trackEvent } from '../utils/analytics';
import { widgetScriptUrl, type SiteAssistantConfig } from './config.mts';
import type { SiteAssistantLauncher } from './siteAssistant';

/*
 * The launcher chunk (issue #637), imported by ./siteAssistant.ts once the
 * page has loaded and gone idle on a page that may show the assistant.
 *
 * It adds one fixed-position button (no layout shift) and requests nothing
 * from solv.chat until that button is pressed. Pressing it loads
 * `<endpoint>/widget.js` and adds `<solv-chat assistant endpoint>` per the
 * solv.chat install snippet; the widget then brings its own launcher and
 * panel, so this button steps aside. After that, later pages in the same tab
 * load the widget as soon as the launcher is up, so its conversation (which
 * solv.chat keeps in sessionStorage) is restored. No page actions are
 * registered (`solv.actions`).
 */

const OPENED_KEY = 'mcptest.siteAssistant.opened';
const ELEMENT_NAME = 'solv-chat';
const LOAD_TIMEOUT_MS = 15_000;
const LABEL = 'Ask the mcptest assistant';
const LOADING_LABEL = 'Loading the mcptest assistant';
const FAILED_LABEL = 'The mcptest assistant could not load. Try again';

export type WidgetLoadTrigger = 'launcher' | 'restore';

const readOpened = (): boolean => {
  try {
    return window.sessionStorage.getItem(OPENED_KEY) === '1';
  } catch {
    return false;
  }
};

const rememberOpened = (): void => {
  try {
    window.sessionStorage.setItem(OPENED_KEY, '1');
  } catch {
    // Storage off: the next page shows the launcher again, which is fine.
  }
};

const SVG_NS = 'http://www.w3.org/2000/svg';

/** A speech-bubble glyph in currentColor; inline so it needs no icon font. */
const chatIcon = (): SVGSVGElement => {
  const svg = document.createElementNS(SVG_NS, 'svg');
  svg.setAttribute('viewBox', '0 0 16 16');
  svg.setAttribute('width', '16');
  svg.setAttribute('height', '16');
  svg.setAttribute('aria-hidden', 'true');
  svg.setAttribute('focusable', 'false');
  svg.classList.add('site-assistant-launcher-icon');
  const path = document.createElementNS(SVG_NS, 'path');
  path.setAttribute('fill', 'currentColor');
  path.setAttribute('d', 'M2.5 2A1.5 1.5 0 0 0 1 3.5v7A1.5 1.5 0 0 0 2.5 12H4v2.25a.5.5 0 0 0 .82.38L8.06 12h5.44A1.5 1.5 0 0 0 15 10.5v-7A1.5 1.5 0 0 0 13.5 2h-11ZM2 3.5a.5.5 0 0 1 .5-.5h11a.5.5 0 0 1 .5.5v7a.5.5 0 0 1-.5.5H7.88a.5.5 0 0 0-.32.12L5 13.2v-1.7a.5.5 0 0 0-.5-.5h-2a.5.5 0 0 1-.5-.5v-7Z');
  svg.append(path);
  return svg;
};

/** Loads widget.js once; resolves when `<solv-chat>` is defined. */
const loadWidgetScript = (config: SiteAssistantConfig): Promise<void> => {
  if (customElements.get(ELEMENT_NAME)) return Promise.resolve();
  return new Promise<void>((resolve, reject) => {
    const script = document.createElement('script');
    script.src = widgetScriptUrl(config);
    script.async = true;
    script.dataset.siteAssistant = '';
    const fail = (reason: string) => {
      window.clearTimeout(timer);
      script.remove();
      reject(new Error(reason));
    };
    const timer = window.setTimeout(() => fail('timed out'), LOAD_TIMEOUT_MS);
    script.addEventListener('error', () => fail('the widget script failed to load'), { once: true });
    customElements.whenDefined(ELEMENT_NAME).then(() => {
      window.clearTimeout(timer);
      resolve();
    }, () => {});
    document.head.append(script);
  });
};

export const mountSiteAssistantLauncher = (config: SiteAssistantConfig): SiteAssistantLauncher => {
  const button = document.createElement('button');
  button.type = 'button';
  button.className = 'site-assistant-launcher';
  button.setAttribute('aria-label', LABEL);
  button.title = LABEL;
  const text = document.createElement('span');
  text.className = 'site-assistant-launcher-text';
  text.textContent = 'Ask';
  button.append(chatIcon(), text);
  button.hidden = true;
  document.body.append(button);

  let active = false;
  let widget: HTMLElement | null = null;
  let loading: Promise<boolean> | null = null;

  const attachWidget = () => {
    if (!widget) {
      widget = document.createElement(ELEMENT_NAME);
      widget.setAttribute('assistant', config.assistantKey);
      widget.setAttribute('endpoint', config.endpoint);
    }
    if (active && !widget.isConnected) document.body.append(widget);
  };

  const render = () => {
    button.hidden = !active || Boolean(widget);
    if (!active) widget?.remove();
    else if (widget) attachWidget();
  };

  const load = (trigger: WidgetLoadTrigger): Promise<boolean> => {
    if (loading) return loading;
    const started = performance.now();
    button.setAttribute('aria-busy', 'true');
    button.setAttribute('aria-label', LOADING_LABEL);
    button.dataset.state = 'loading';
    loading = loadWidgetScript(config).then(() => {
      trackEvent('assistant_widget_load', { outcome: 'loaded', trigger, duration_ms: Math.round(performance.now() - started) });
      rememberOpened();
      button.removeAttribute('aria-busy');
      button.setAttribute('aria-label', LABEL);
      button.title = LABEL;
      delete button.dataset.state;
      attachWidget();
      render();
      return true;
    }, error => {
      console.warn('[Site assistant] The widget did not load.', error);
      trackEvent('assistant_widget_load', { outcome: 'failed', trigger, duration_ms: Math.round(performance.now() - started) });
      loading = null;
      button.removeAttribute('aria-busy');
      button.setAttribute('aria-label', FAILED_LABEL);
      button.title = FAILED_LABEL;
      button.dataset.state = 'failed';
      return false;
    });
    return loading;
  };

  button.addEventListener('click', () => {
    trackEvent('assistant_launcher_click');
    void load('launcher').then(loaded => {
      if (!loaded || !widget?.isConnected) return;
      // The widget has no public open method; its own launcher toggles the panel
      // and moves focus into it, which is what pressing this button means.
      widget.shadowRoot?.querySelector<HTMLButtonElement>('.solv-launcher')?.click();
    });
  });

  const restore = readOpened();

  return {
    setActive(next: boolean) {
      active = next;
      render();
      if (active && restore) void load('restore');
    },
  };
};
