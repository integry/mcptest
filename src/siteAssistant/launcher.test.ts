import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

const trackEvent = vi.hoisted(() => vi.fn());
vi.mock('../utils/analytics', () => ({ trackEvent }));

import { mountSiteAssistantLauncher } from './launcher';
import { loadWidgetScript } from './widgetScript';

const CONFIG = { endpoint: 'https://chat.example.com', assistantKey: 'pk_test_1' };
const flush = () => new Promise(resolve => setTimeout(resolve, 0));
const launcherButton = () => document.querySelector<HTMLButtonElement>('.site-assistant-launcher');
const widgetScript = () => document.head.querySelector<HTMLScriptElement>('script[data-site-assistant]');

/** What widget.js does: define <solv-chat> with its own launcher in an open shadow root. */
let onWidgetLauncherClick: () => void = () => {};
const defineStubWidget = (onOpen: () => void) => {
  onWidgetLauncherClick = onOpen;
  if (customElements.get('solv-chat')) return;
  customElements.define('solv-chat', class extends HTMLElement {
    connectedCallback() {
      if (this.shadowRoot) return;
      const root = this.attachShadow({ mode: 'open' });
      const button = document.createElement('button');
      button.className = 'solv-launcher';
      button.addEventListener('click', () => onWidgetLauncherClick());
      root.append(button);
    }
  });
};

let opened = 0;

beforeEach(() => {
  trackEvent.mockClear();
  sessionStorage.clear();
  document.body.replaceChildren();
  document.head.querySelectorAll('script[data-site-assistant]').forEach(script => script.remove());
  opened = 0;
});

afterEach(() => {
  vi.restoreAllMocks();
  document.body.replaceChildren();
});

describe('site assistant launcher', () => {
  it('is a hidden, named button until a page may show it', () => {
    const launcher = mountSiteAssistantLauncher(CONFIG);
    const button = launcherButton()!;
    expect(button.hidden).toBe(true);
    expect(button.type).toBe('button');
    expect(button.getAttribute('aria-label')).toBe('Ask MCP Test AI');
    expect(button.textContent).toBe('Ask MCP Test AI');
    launcher.setActive(true);
    expect(button.hidden).toBe(false);
    launcher.setActive(false);
    expect(button.hidden).toBe(true);
  });

  it('requests nothing from solv.chat until it is pressed', () => {
    mountSiteAssistantLauncher(CONFIG).setActive(true);
    expect(widgetScript()).toBeNull();
    expect(document.querySelector('solv-chat')).toBeNull();
  });

  it('loads widget.js on press, adds the element and opens its panel', async () => {
    const launcher = mountSiteAssistantLauncher(CONFIG);
    launcher.setActive(true);
    launcherButton()!.click();

    const script = widgetScript()!;
    expect(script.src).toBe('https://chat.example.com/widget.js');
    expect(script.async).toBe(true);
    expect(launcherButton()!.getAttribute('aria-busy')).toBe('true');
    expect(trackEvent).toHaveBeenCalledWith('assistant_launcher_click');

    defineStubWidget(() => { opened += 1; });
    await flush();

    const widget = document.querySelector('solv-chat')!;
    expect(widget.getAttribute('assistant')).toBe('pk_test_1');
    expect(widget.getAttribute('endpoint')).toBe('https://chat.example.com');
    expect(opened).toBe(1);
    // The widget's own launcher takes over.
    expect(launcherButton()!.hidden).toBe(true);
    expect(trackEvent).toHaveBeenCalledWith('assistant_widget_load', expect.objectContaining({ outcome: 'loaded', trigger: 'launcher' }));

    // An excluded page removes the widget; an allowed one brings it back.
    launcher.setActive(false);
    expect(document.querySelector('solv-chat')).toBeNull();
    launcher.setActive(true);
    expect(document.querySelector('solv-chat')).not.toBeNull();
    expect(launcherButton()!.hidden).toBe(true);
  });

  it('opens the panel once when pressed again while widget.js loads', async () => {
    let panelOpen = false;
    // Like the real widget, its launcher toggles the panel.
    defineStubWidget(() => { opened += 1; panelOpen = !panelOpen; });
    vi.spyOn(customElements, 'get').mockReturnValue(undefined);
    let define!: () => void;
    vi.spyOn(customElements, 'whenDefined')
      .mockReturnValue(new Promise(resolve => { define = () => resolve(customElements as never); }));
    mountSiteAssistantLauncher(CONFIG).setActive(true);
    launcherButton()!.click();
    launcherButton()!.click();
    launcherButton()!.click();
    expect(document.head.querySelectorAll('script[data-site-assistant]')).toHaveLength(1);

    define();
    await flush();
    expect(opened).toBe(1);
    expect(panelOpen).toBe(true);
    expect(launcherButton()!.hidden).toBe(true);
  });

  it('lets the widget restore the docked panel without toggling it', async () => {
    defineStubWidget(() => { opened += 1; });
    mountSiteAssistantLauncher(CONFIG, loadWidgetScript(CONFIG)).setActive(true);
    await flush();
    expect(document.querySelector('solv-chat')).not.toBeNull();
    expect(opened).toBe(0);
    expect(trackEvent).toHaveBeenCalledWith('assistant_widget_load', expect.objectContaining({ outcome: 'loaded', trigger: 'restore' }));
  });

  it('keeps a pending restore detached if the URL changes before the router updates the launcher', async () => {
    defineStubWidget(() => { opened += 1; });
    const launcher = mountSiteAssistantLauncher(CONFIG, loadWidgetScript(CONFIG));
    launcher.setActive(true);
    const originalPath = window.location.pathname;
    try {
      window.history.replaceState(null, '', '/space');
      await flush();
      expect(document.querySelector('solv-chat')).toBeNull();
      window.history.replaceState(null, '', originalPath);
      launcher.setActive(true);
      expect(document.querySelector('solv-chat')).not.toBeNull();
    } finally {
      window.history.replaceState(null, '', originalPath);
    }
  });

  it('says so and can retry when the script fails to load', async () => {
    // Undefined element name for this case: make the custom element lookup fail.
    const get = vi.spyOn(customElements, 'get').mockReturnValue(undefined);
    const whenDefined = vi.spyOn(customElements, 'whenDefined').mockReturnValue(new Promise(() => {}));
    mountSiteAssistantLauncher(CONFIG).setActive(true);
    launcherButton()!.click();
    widgetScript()!.dispatchEvent(new Event('error'));
    await flush();

    const button = launcherButton()!;
    expect(button.hidden).toBe(false);
    expect(button.dataset.state).toBe('failed');
    expect(button.textContent).toBe('Retry');
    expect(button.getAttribute('aria-label')).toBe('The mcptest assistant could not load. Try again');
    expect(widgetScript()).toBeNull();
    expect(trackEvent).toHaveBeenCalledWith('assistant_widget_load', expect.objectContaining({ outcome: 'failed', trigger: 'launcher' }));

    button.click();
    button.click();
    expect(document.head.querySelectorAll('script[data-site-assistant]')).toHaveLength(1);
    get.mockRestore();
    whenDefined.mockRestore();
  });
});
