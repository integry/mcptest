import React, { act } from 'react';
import { createRoot, type Root } from 'react-dom/client';
import { MemoryRouter } from 'react-router-dom';
import { afterEach, beforeAll, beforeEach, describe, expect, it, vi } from 'vitest';

vi.mock('../utils/analytics', async (importOriginal) => ({
  ...(await importOriginal<typeof import('../utils/analytics')>()),
  trackEvent: vi.fn(),
}));

import { trackEvent } from '../utils/analytics';
import { KEYWORD_LANDING_PAGES, getKeywordLandingPage } from '../content/keywordLandingPages';
import { landingPlainText } from '../content/landingCopy';
import { RECENT_SERVERS_KEY } from '../utils/recentServers';
import { KeywordLandingView } from './KeywordLandingView';
import { LandingHero } from './LandingHero';

beforeAll(() => {
  (
    globalThis as typeof globalThis & { IS_REACT_ACT_ENVIRONMENT: boolean }
  ).IS_REACT_ACT_ENVIRONMENT = true;
});

let root: Root | undefined;
let container: HTMLDivElement;

beforeEach(() => {
  localStorage.clear();
  vi.mocked(trackEvent).mockClear();
  container = document.createElement('div');
  document.body.appendChild(container);
});

afterEach(() => {
  act(() => root?.unmount());
  root = undefined;
  container.remove();
});

const render = (path: string) => {
  const page = getKeywordLandingPage(path)!;
  const onConnect = vi.fn();
  const onOpenAdvancedOptions = vi.fn();
  root = createRoot(container);
  act(() => root!.render(
    <MemoryRouter initialEntries={[path]}>
      <KeywordLandingView page={page} onConnect={onConnect} onOpenAdvancedOptions={onOpenAdvancedOptions} />
    </MemoryRouter>
  ));
  return { page, onConnect, onOpenAdvancedOptions };
};

const text = (element: Element | null | undefined) => element?.textContent?.replace(/\s+/g, ' ').trim();

const typeUrl = (input: HTMLInputElement, value: string) => {
  const setter = Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, 'value')!.set!;
  act(() => {
    setter.call(input, value);
    input.dispatchEvent(new Event('input', { bubbles: true }));
  });
};

describe('KeywordLandingView', () => {
  it.each(KEYWORD_LANDING_PAGES.map(page => [page.path]))('renders %s: its own H1, intro, sections, FAQ and related links around the connect form', (path) => {
    const { page } = render(path);

    expect(container.querySelectorAll('h1')).toHaveLength(1);
    expect(text(container.querySelector('h1'))).toBe(page.h1);
    expect(text(container.querySelector('.landing-lede'))).toBe(landingPlainText(page.intro));
    expect(container.querySelector(`#${page.key}-server-url`)).toBeInstanceOf(HTMLInputElement);
    expect(container.querySelector('#serverUrl'), 'no clash with the playground landing').toBeNull();
    expect(text(container.querySelector('.landing-connect-button'))).toBe('Connect');
    expect(container.querySelectorAll('.landing-quick-pick').length).toBeGreaterThan(0);
    expect(text(container.querySelector('.landing-advanced-toggle'))).toContain('Advanced options');

    expect(Array.from(container.querySelectorAll('.keyword-landing-section'), section => section.id))
      .toEqual(page.sections.map(section => section.id));
    expect(Array.from(container.querySelectorAll('.keyword-landing-section > h2'), text))
      .toEqual(page.sections.map(section => section.title));
    expect(Array.from(container.querySelectorAll('.landing-faq-question'), text)).toEqual(page.faq.map(item => item.question));
    expect(Array.from(container.querySelectorAll('.landing-faq-answer'), text))
      .toEqual(page.faq.map(item => landingPlainText(item.answer)));
    expect(Array.from(container.querySelectorAll('.keyword-landing-related a'), link => link.getAttribute('href')))
      .toEqual(page.related.map(link => link.href));

    // The home page's own sections are not repeated.
    expect(container.querySelector('#landing-steps-title')).toBeNull();
    expect(container.querySelector('.landing-coverage')).toBeNull();

    const ids = Array.from(container.querySelectorAll('[id]'), element => element.id);
    expect(new Set(ids).size).toBe(ids.length);
    expect(trackEvent).toHaveBeenCalledWith('landing_view', { variant: 'new', page: page.key });
  });

  it('renders the comparison with the official Inspector as a table', () => {
    render('/mcp-inspector-online');
    const table = container.querySelector('#compared-with-the-official-inspector table');
    expect(Array.from(table?.querySelectorAll('thead th') ?? [], text)).toEqual(['mcptest.io', 'MCP Inspector']);
    expect(Array.from(table?.querySelectorAll('tbody th[scope="row"]') ?? [], text)).toContain('Local stdio servers');
    expect(container.querySelector('a[href="/learn/mcptest-vs-mcp-inspector"]')).not.toBeNull();
  });

  it('hands a typed endpoint to the playground on Connect and on Enter', () => {
    const { page, onConnect } = render('/mcp-test-server');
    const input = container.querySelector<HTMLInputElement>(`#${page.key}-server-url`)!;
    const button = container.querySelector<HTMLButtonElement>('.landing-connect-button')!;
    expect(button.disabled).toBe(true);

    typeUrl(input, '  https://example.com/mcp ');
    expect(button.disabled).toBe(false);
    act(() => button.click());
    expect(onConnect).toHaveBeenLastCalledWith({ serverUrl: 'https://example.com/mcp', source: 'manual' });
    expect(trackEvent).toHaveBeenCalledWith('landing_connect', { source: 'manual', host: 'example.com', page: 'test-server' });

    act(() => input.dispatchEvent(new KeyboardEvent('keydown', { key: 'Enter', bubbles: true })));
    expect(onConnect).toHaveBeenCalledTimes(2);
  });

  it('hands a quick pick to the playground with the catalog endpoint and protocol era it chose', () => {
    const { onConnect } = render('/mcp-playground');
    const pick = container.querySelector<HTMLButtonElement>('.landing-quick-pick')!;
    act(() => pick.click());

    const request = onConnect.mock.calls[0][0];
    expect(request.source).toBe('quick_pick');
    expect(request.serverUrl).toBe(pick.getAttribute('title'));
    expect(request.selection.endpoint.url).toBe(request.serverUrl);
    expect(request.selection).toHaveProperty('protocolEra');
  });

  it('offers a returning visitor their recent endpoints', () => {
    localStorage.setItem(RECENT_SERVERS_KEY, JSON.stringify([{ url: 'https://recent.example/mcp' }, 'https://older.example/sse']));
    const { onConnect } = render('/mcp-inspector-online');

    expect(container.querySelector('.landing-quick-picks:not(.landing-recent)')).toBeNull();
    const chips = Array.from(container.querySelectorAll<HTMLButtonElement>('.landing-recent-connect'));
    expect(chips.map(chip => chip.dataset.recentUrl)).toEqual(['https://recent.example/mcp', 'https://older.example/sse']);
    act(() => chips[0].click());
    expect(onConnect).toHaveBeenCalledWith({ serverUrl: 'https://recent.example/mcp', source: 'recent_chip' });
  });

  it('opens the full connection panel in the playground from Advanced options', () => {
    const { page, onOpenAdvancedOptions, onConnect } = render('/mcp-test-server');
    typeUrl(container.querySelector<HTMLInputElement>(`#${page.key}-server-url`)!, 'https://secure.example/mcp');
    act(() => container.querySelector<HTMLButtonElement>('.landing-advanced-toggle')!.click());

    expect(onOpenAdvancedOptions).toHaveBeenCalledWith('https://secure.example/mcp');
    expect(onConnect).not.toHaveBeenCalled();
    expect(trackEvent).toHaveBeenCalledWith('advanced_options_open');
  });
});

describe('LandingHero on the home page', () => {
  it('keeps its own ids and sections when no page is given', () => {
    root = createRoot(container);
    act(() => root!.render(
      <MemoryRouter>
        <LandingHero serverUrl="" onServerUrlChange={() => {}} onConnect={() => {}} isConnecting={false} quickPicks={[]} />
      </MemoryRouter>
    ));
    expect(container.querySelector('#serverUrl')).not.toBeNull();
    expect(container.querySelector('#connectBtn')).not.toBeNull();
    expect(container.querySelector('#landing-steps-title')).not.toBeNull();
    expect(container.querySelector('.keyword-landing-section')).toBeNull();
    expect(container.querySelector('.landing-advanced-toggle'), 'no toggle without a panel or handler').toBeNull();
  });

  it('starts with the advanced panel open when asked to', () => {
    root = createRoot(container);
    act(() => root!.render(
      <MemoryRouter>
        <LandingHero
          serverUrl=""
          onServerUrlChange={() => {}}
          onConnect={() => {}}
          isConnecting={false}
          quickPicks={[]}
          advancedOptions={<div className="advanced-probe">panel</div>}
          defaultShowAdvanced
        />
      </MemoryRouter>
    ));
    expect(container.querySelector('#landing-advanced-panel .advanced-probe')).not.toBeNull();
    expect(container.querySelector('.landing-advanced-toggle')?.getAttribute('aria-expanded')).toBe('true');
  });
});
