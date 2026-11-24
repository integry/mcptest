import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { OPEN_QUOTE_ACTION, QUOTE_REFUSED, createOpenQuoteAction, createQuoteAssistant } from './quoteAssistant';
import type { SolvPageAction } from '../siteAssistant/widgetScript';

const SERVICE_API = 'https://service.example.com';
const CONFIG = { endpoint: 'https://chat.example.com', assistantKey: 'pk_quote' };

describe('open_quote', () => {
  it('needs the visitor to confirm and takes one url', () => {
    const action = createOpenQuoteAction(SERVICE_API, vi.fn());
    expect(action.name).toBe(OPEN_QUOTE_ACTION);
    expect(action.confirm).toBe(true);
    expect(action.input).toMatchObject({ type: 'object', required: ['url'], properties: { url: { type: 'string' } } });
    // solv.chat caps descriptions; keep it short.
    expect(action.description.length).toBeLessThanOrEqual(200);
  });

  it('navigates to a quote page on the service origin', () => {
    const navigate = vi.fn();
    const result = createOpenQuoteAction(SERVICE_API, navigate).run({ url: 'https://service.example.com/q/abc123' });
    expect(navigate).toHaveBeenCalledWith('https://service.example.com/q/abc123');
    expect(result).toEqual({ opened: true, url: 'https://service.example.com/q/abc123' });
  });

  it.each([
    'https://evil.example/q/abc123',
    'https://service.example.com.evil.example/q/abc123',
    'http://service.example.com/q/abc123',
    'https://service.example.com/admin/orders',
    'javascript:alert(document.cookie)',
    'data:text/html,<script>alert(1)</script>',
    '//evil.example/q/abc',
  ])('refuses %s without navigating', url => {
    const navigate = vi.fn();
    expect(createOpenQuoteAction(SERVICE_API, navigate).run({ url })).toEqual({ opened: false, error: QUOTE_REFUSED });
    expect(navigate).not.toHaveBeenCalled();
  });

  it('refuses everything when the build has no service API', () => {
    const navigate = vi.fn();
    expect(createOpenQuoteAction(null, navigate).run({ url: 'https://service.example.com/q/abc123' })).toMatchObject({ opened: false });
    expect(navigate).not.toHaveBeenCalled();
  });
});

describe('the quote assistant', () => {
  const registry = new Map<string, SolvPageAction>();
  const solv = {
    actions: {
      register: vi.fn((action: SolvPageAction) => { registry.set(action.name, action); }),
      unregister: vi.fn((name: string) => { registry.delete(name); }),
    },
  };

  /** Stands in for widget.js: defines <solv-chat> with a launcher in its shadow root. */
  const defineWidget = () => {
    (globalThis as { solv?: unknown }).solv = solv;
    if (customElements.get('solv-chat')) return;
    customElements.define('solv-chat', class extends HTMLElement {
      connectedCallback() {
        if (this.shadowRoot) return;
        const root = this.attachShadow({ mode: 'open' });
        // Like the real widget: the launcher toggles the panel and reports
        // the state in aria-expanded.
        const launcher = document.createElement('button');
        launcher.className = 'solv-launcher';
        launcher.setAttribute('aria-expanded', 'false');
        const input = document.createElement('textarea');
        input.className = 'solv-input';
        launcher.addEventListener('click', () => {
          const open = !this.hasAttribute('data-open');
          this.toggleAttribute('data-open', open);
          launcher.setAttribute('aria-expanded', String(open));
          if (open) input.focus();
        });
        root.append(input, launcher);
      }
    });
  };

  beforeEach(() => {
    registry.clear();
    vi.clearAllMocks();
    // widget.js installs solv.actions with <solv-chat>; once defined, both stay for the tab.
    if (customElements.get('solv-chat')) (globalThis as { solv?: unknown }).solv = solv;
    // Each appended widget script "loads" by defining the element.
    vi.spyOn(document.head, 'append').mockImplementation((...nodes) => {
      for (const node of nodes) if (node instanceof HTMLScriptElement) queueMicrotask(defineWidget);
    });
  });

  afterEach(() => {
    vi.restoreAllMocks();
    document.body.querySelectorAll('solv-chat').forEach(element => element.remove());
    delete (globalThis as { solv?: unknown }).solv;
  });

  it('loads the widget on open, registers open_quote and opens the panel', async () => {
    const navigate = vi.fn();
    const assistant = createQuoteAssistant(CONFIG, SERVICE_API, { navigate });
    expect(document.querySelector('solv-chat')).toBeNull();
    await expect(assistant.open()).resolves.toBe(true);

    const widget = document.querySelector<HTMLElement>('solv-chat[data-quote-assistant]')!;
    expect(widget.getAttribute('assistant')).toBe('pk_quote');
    expect(widget.getAttribute('endpoint')).toBe('https://chat.example.com');
    expect(widget.hasAttribute('data-open')).toBe(true);
    expect([...registry.keys()]).toEqual([OPEN_QUOTE_ACTION]);
    registry.get(OPEN_QUOTE_ACTION)!.run({ url: 'https://evil.example/q/1' });
    expect(navigate).not.toHaveBeenCalled();
  });

  it('keeps the panel open when "Get a quote" is pressed again', async () => {
    const assistant = createQuoteAssistant(CONFIG, SERVICE_API);
    await expect(assistant.open()).resolves.toBe(true);
    const widget = document.querySelector<HTMLElement>('solv-chat[data-quote-assistant]')!;
    expect(widget.hasAttribute('data-open')).toBe(true);
    (document.activeElement as HTMLElement | null)?.blur();

    await expect(assistant.open()).resolves.toBe(true);
    expect(widget.hasAttribute('data-open')).toBe(true);
    expect(widget.shadowRoot!.querySelector('.solv-launcher')!.getAttribute('aria-expanded')).toBe('true');
    expect(widget.shadowRoot!.activeElement).toBe(widget.shadowRoot!.querySelector('.solv-input'));
    expect(document.querySelectorAll('solv-chat')).toHaveLength(1);
  });

  it('opens a panel the visitor closed with the widget launcher', async () => {
    const assistant = createQuoteAssistant(CONFIG, SERVICE_API);
    await assistant.open();
    const widget = document.querySelector<HTMLElement>('solv-chat[data-quote-assistant]')!;
    widget.shadowRoot!.querySelector<HTMLButtonElement>('.solv-launcher')!.click();
    expect(widget.hasAttribute('data-open')).toBe(false);

    await assistant.open();
    expect(widget.hasAttribute('data-open')).toBe(true);
  });

  it('removes the widget and the action when the page goes away', async () => {
    const assistant = createQuoteAssistant(CONFIG, SERVICE_API);
    await assistant.open();
    assistant.destroy();
    expect(document.querySelector('solv-chat')).toBeNull();
    expect(solv.actions.unregister).toHaveBeenCalledWith(OPEN_QUOTE_ACTION);
    expect(registry.size).toBe(0);
  });
});
