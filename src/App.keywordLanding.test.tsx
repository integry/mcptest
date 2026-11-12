import React, { act } from 'react';
import { createRoot, type Root } from 'react-dom/client';
import { MemoryRouter, useLocation } from 'react-router-dom';
import { afterEach, beforeAll, beforeEach, describe, expect, it, vi } from 'vitest';

vi.mock('./firebase', async (importOriginal) => {
  const actual = await importOriginal<typeof import('./firebase')>();
  return { ...actual, loadFirebase: vi.fn(() => new Promise(() => {})) };
});
vi.mock('./utils/analytics', async (importOriginal) => {
  const actual = await importOriginal<typeof import('./utils/analytics')>();
  return { ...actual, trackEvent: vi.fn(), logPageView: vi.fn() };
});

import App from './App';
import { AuthProvider } from './context/AuthContext';
import { logPageView } from './utils/analytics';
import { KEYWORD_LANDING_PAGES, getKeywordLandingPage } from './content/keywordLandingPages';
import { getRouteView, preloadViewsForPath } from './views/deferredViews';
import { canonicalAliasPath } from './utils/appRoutes';

beforeAll(async () => {
  (
    globalThis as typeof globalThis & { IS_REACT_ACT_ENVIRONMENT: boolean }
  ).IS_REACT_ACT_ENVIRONMENT = true;
  // main.tsx preloads the route's chunks before mounting.
  await Promise.all(['/', ...KEYWORD_LANDING_PAGES.map(page => page.path)].map(path => preloadViewsForPath(path)));
});

let root: Root | undefined;
let container: HTMLDivElement;
let currentLocation: ReturnType<typeof useLocation> | undefined;

const LocationProbe = () => {
  currentLocation = useLocation();
  return null;
};

const mount = (path: string) => {
  root = createRoot(container);
  act(() => root!.render(
    <MemoryRouter initialEntries={[path]}>
      <AuthProvider>
        <App />
        <LocationProbe />
      </AuthProvider>
    </MemoryRouter>
  ));
};

const visibleTitle = () => container.querySelector('.view-panel:not(.d-none) h1')?.textContent;

const click = (element: Element | null) => {
  expect(element).not.toBeNull();
  act(() => (element as HTMLElement).click());
};

const typeUrl = (input: HTMLInputElement, value: string) => {
  const setter = Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, 'value')!.set!;
  act(() => {
    setter.call(input, value);
    input.dispatchEvent(new Event('input', { bubbles: true }));
  });
};

const storedTabs = () => JSON.parse(localStorage.getItem('mcpConnectionTabs') || '[]');

describe('keyword landing routes', () => {
  beforeEach(() => {
    localStorage.clear();
    sessionStorage.clear();
    vi.mocked(logPageView).mockClear();
    vi.spyOn(console, 'log').mockImplementation(() => {});
    // The playground's auto-connect must not reach the network in tests.
    vi.stubGlobal('fetch', vi.fn(() => new Promise(() => {})));
    container = document.createElement('div');
    document.body.appendChild(container);
  });

  afterEach(() => {
    act(() => root?.unmount());
    root = undefined;
    container.remove();
    vi.unstubAllGlobals();
    vi.restoreAllMocks();
  });

  it('are app routes with their own view and no alias spellings', () => {
    for (const page of KEYWORD_LANDING_PAGES) {
      expect(getRouteView(page.path)).toBe('keyword-landing');
      expect(canonicalAliasPath(page.path)).toBeNull();
      expect(canonicalAliasPath(`${page.path}/`)).toBe(page.path);
      expect(canonicalAliasPath(`${page.path}/index.html`)).toBe(page.path);
    }
  });

  it.each(KEYWORD_LANDING_PAGES.map(page => [page.path]))('renders %s with its title, canonical, FAQ JSON-LD and page view', async (path) => {
    const page = getKeywordLandingPage(path)!;
    mount(path);
    await act(async () => {});

    expect(visibleTitle()).toBe(page.h1);
    expect(container.querySelector('.view-panel:not(.d-none) .landing-faq')).not.toBeNull();
    // Not the playground: no tab strip, no NotFound.
    expect(container.querySelector('.view-panel:not(.d-none) .playground-tabs-wrapper')).toBeNull();
    expect(container.querySelector('.not-found-page')).toBeNull();
    // No primary sidebar link claims the page; its footer link is there.
    expect(container.querySelector('.desktop-sidebar .sidenav-list > .nav-item > a.nav-link.active')).toBeNull();
    expect(container.querySelector(`.desktop-sidebar .sidenav-footer a[href="${path}"]`)).not.toBeNull();

    expect(document.title).toBe(page.title);
    expect(document.querySelector("link[rel='canonical']")?.getAttribute('href')).toBe(`https://mcptest.io${path}`);
    expect(document.querySelector("meta[property='og:url']")?.getAttribute('content')).toBe(`https://mcptest.io${path}`);
    expect(document.querySelector("meta[name='twitter:title']")?.getAttribute('content')).toBe(page.title);
    const jsonLd = JSON.parse(document.getElementById('server-structured-data')?.textContent || '{}');
    expect(jsonLd['@type']).toBe('FAQPage');
    expect(jsonLd.mainEntity.map((entry: { name: string }) => entry.name)).toEqual(page.faq.map(item => item.question));

    expect(logPageView).toHaveBeenCalledWith(path, page.pageViewTitle);
  });

  it('navigates between the pages, the home page and back in the app', async () => {
    mount('/');
    await act(async () => {});
    expect(visibleTitle()).toBe('Test remote MCP servers online');

    click(container.querySelector('.desktop-sidebar .sidenav-footer a[href="/mcp-playground"]'));
    expect(currentLocation?.pathname).toBe('/mcp-playground');
    expect(visibleTitle()).toBe('MCP playground');
    expect(document.title).toBe(getKeywordLandingPage('/mcp-playground')!.title);

    click(container.querySelector('.view-panel:not(.d-none) .keyword-landing-related a[href="/mcp-inspector-online"]'));
    expect(currentLocation?.pathname).toBe('/mcp-inspector-online');
    expect(visibleTitle()).toBe('MCP Inspector online');
    expect(logPageView).toHaveBeenCalledWith('/mcp-inspector-online', 'MCP Inspector online');

    click(container.querySelector('.desktop-sidebar a.sidenav-link[href="/"]'));
    expect(currentLocation?.pathname).toBe('/');
    expect(visibleTitle()).toBe('Test remote MCP servers online');
    // The home page's FAQPage JSON-LD replaces the landing page's.
    const jsonLd = JSON.parse(document.getElementById('server-structured-data')?.textContent || '{}');
    expect(jsonLd.mainEntity[0].name).toBe('Is mcptest.io free?');
  });

  it('connects in the playground on / through the empty tab, as the home page does', async () => {
    mount('/mcp-test-server');
    await act(async () => {});
    const [initialTab] = storedTabs();

    typeUrl(container.querySelector<HTMLInputElement>('#test-server-server-url')!, 'https://example.com/mcp');
    click(container.querySelector('.view-panel:not(.d-none) .landing-connect-button'));
    await act(async () => {});

    expect(currentLocation?.pathname).toBe('/');
    const tabs = storedTabs();
    expect(tabs).toHaveLength(1);
    expect(tabs[0].id).not.toBe(initialTab.id);
    expect(tabs[0]).toMatchObject({ serverUrl: 'https://example.com/mcp', title: 'example.com', useProxy: true });
    expect(Array.from(container.querySelectorAll('.playground-tabs-wrapper [role="tab"]'), tab => tab.textContent))
      .toEqual(['example.com']);
    // The playground has taken over: the connection panel, not a landing.
    expect(container.querySelector('.view-panel:not(.d-none) .landing-title')).toBeNull();
    expect(container.querySelector('.view-panel:not(.d-none) .connection-console')).not.toBeNull();
  });

  it('opens a new tab when the playground already has a server', async () => {
    localStorage.setItem('mcpConnectionTabs', JSON.stringify([{
      id: 'existing', title: 'Existing', serverUrl: 'https://existing.example/mcp', connectionStatus: 'Disconnected', useProxy: true,
    }]));
    mount('/mcp-playground');
    await act(async () => {});

    click(container.querySelector('.view-panel:not(.d-none) .landing-quick-pick'));
    await act(async () => {});

    expect(currentLocation?.pathname).toBe('/');
    const tabs = storedTabs();
    expect(tabs.map((tab: { id: string }) => tab.id)[0]).toBe('existing');
    expect(tabs).toHaveLength(2);
    expect(tabs[1].preferredTransportHint).toBeDefined();
  });

  it('opens the playground with Advanced options expanded and the URL filled in', async () => {
    mount('/mcp-inspector-online');
    await act(async () => {});

    typeUrl(container.querySelector<HTMLInputElement>('#inspector-online-server-url')!, 'https://secure.example/mcp');
    click(container.querySelector('.view-panel:not(.d-none) .landing-advanced-toggle'));
    await act(async () => {});

    expect(currentLocation?.pathname).toBe('/');
    expect(currentLocation?.state).toEqual({ openAdvancedOptions: true });
    expect(storedTabs()[0]).toMatchObject({ serverUrl: 'https://secure.example/mcp' });
    expect(storedTabs()[0].autoConnect).toBeUndefined();
    const details = container.querySelector<HTMLDetailsElement>('.view-panel:not(.d-none) details.connection-advanced');
    expect(details?.open).toBe(true);
  });
});
