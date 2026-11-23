import './launcher.css';
import { trackEvent } from '../utils/analytics';
import { isSiteAssistantPath, type SiteAssistantConfig } from './config.mts';
import { createWidgetElement, loadWidgetScript, openWidgetPanel } from './widgetScript';
import type { SiteAssistantLauncher } from './siteAssistant';

/*
 * The launcher adds a fixed button after idle, or loads the widget immediately
 * to take over the pre-paint placeholder when a docked panel is being restored.
 */

const LABEL = 'Ask MCP Test AI';
const LOADING_LABEL = 'Loading the mcptest assistant';
const FAILED_LABEL = 'The mcptest assistant could not load. Try again';
const FAILED_TEXT = 'Retry';

export type WidgetLoadTrigger = 'launcher' | 'restore';

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

export const mountSiteAssistantLauncher = (config: SiteAssistantConfig, restore = false): SiteAssistantLauncher => {
  const button = document.createElement('button');
  button.type = 'button';
  button.className = 'site-assistant-launcher';
  button.setAttribute('aria-label', LABEL);
  button.title = LABEL;
  const text = document.createElement('span');
  text.className = 'site-assistant-launcher-text';
  text.textContent = LABEL;
  button.append(chatIcon(), text);
  button.hidden = true;
  document.body.append(button);

  let active = false;
  let widget: HTMLElement | null = null;
  let loading: Promise<boolean> | null = null;

  // History can change before the router commits and calls setActive.
  const canShow = () => active && isSiteAssistantPath(window.location.pathname);

  const attachWidget = () => {
    if (!widget) {
      widget = createWidgetElement(config);
      // First-paint hints match the site's published Widget settings.
      widget.setAttribute('launcher-label', LABEL);
      widget.setAttribute('launcher-shortcut', 'none');
      widget.setAttribute('launcher-accent-color', '#0d6efd');
      widget.setAttribute('launcher-position', 'right');
      widget.setAttribute('opens-as', 'side');
    }
    if (canShow() && !widget.isConnected) document.body.append(widget);
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
      button.removeAttribute('aria-busy');
      button.setAttribute('aria-label', LABEL);
      button.title = LABEL;
      text.textContent = LABEL;
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
      text.textContent = FAILED_TEXT;
      button.dataset.state = 'failed';
      return false;
    });
    return loading;
  };

  // One pending opening per load: the widget's launcher toggles, so a second
  // press while widget.js loads must not queue a second click (which would
  // close the panel the first one opened). Cleared once the load settles, so a
  // failed load can be retried.
  let opening = false;

  button.addEventListener('click', () => {
    trackEvent('assistant_launcher_click');
    if (opening) return;
    opening = true;
    void load('launcher').then(loaded => {
      opening = false;
      if (!loaded || !widget?.isConnected) return;
      openWidgetPanel(widget);
    });
  });

  let pendingRestore = restore;

  return {
    setActive(next: boolean) {
      active = next;
      render();
      if (pendingRestore && canShow()) {
        pendingRestore = false;
        void load('restore');
      }
    },
  };
};
