import React from 'react';
import { renderToStaticMarkup } from 'react-dom/server';
import { MemoryRouter } from 'react-router-dom';
import { afterEach, beforeAll, describe, expect, it, vi } from 'vitest';

// Auth is "loading" in the app's first render (before Firebase, loaded on
// demand, reports a user); the static shell stands in for that frame.
vi.mock('../src/utils/analytics', async (importOriginal) => ({
  ...(await importOriginal()),
  trackEvent: vi.fn(),
  logPageView: vi.fn(),
}));

import App from '../src/App';
import { AuthProvider } from '../src/context/AuthContext';
import { LandingHero, selectLandingQuickPicks } from '../src/components/LandingHero';
import { LEARN_HUB_NAVIGATION, LEARN_TRACKS, PRIMARY_NAVIGATION } from '../src/content/navigation';
import * as landingCopy from '../src/content/landingCopy';
import { getCatalogServers } from '../src/utils/catalogUtils';
import { preloadViewsForPath } from '../src/views/deferredViews';
import { prepareContentPrerender, renderArticlePage, renderLearnIndexPage } from '../src/prerender/contentPages';
import seoGenerator from './generate-seo-pages.js';
import catalogSeeds from '../src/data/serverCatalog.json';

const { renderAppShell, renderLandingFallback, renderShellFallback } = seoGenerator;

const catalogCount = getCatalogServers().length;
const parse = html => new DOMParser().parseFromString(`<!DOCTYPE html><body>${html}</body>`, 'text/html').body;
const text = element => element?.textContent.replace(/\s+/g, ' ').trim();

const component = parse(renderToStaticMarkup(React.createElement(
  MemoryRouter,
  null,
  React.createElement(LandingHero, {
    serverUrl: '',
    onServerUrlChange: () => {},
    onConnect: () => {},
    isConnecting: false,
    quickPicks: [],
    catalogCount,
  })
)));
const fallback = parse(renderLandingFallback(catalogSeeds.length));

const describeLanding = root => ({
  headline: text(root.querySelector('h1')),
  lede: text(root.querySelector('.landing-lede')),
  pathsLabel: root.querySelector('nav').getAttribute('aria-label'),
  paths: Array.from(root.querySelectorAll('nav a'), link => ({
    href: link.getAttribute('href'),
    title: text(link.querySelector('.landing-path-title')),
    description: text(link.querySelector('.landing-path-description')),
  })),
  coverageTitle: text(root.querySelector('.landing-coverage h2')),
  coverage: Array.from(root.querySelectorAll('.landing-coverage li'), text),
  catalog: {
    href: root.querySelector('.landing-catalog a').getAttribute('href'),
    text: text(root.querySelector('.landing-catalog a')),
  },
});

describe('crawler-visible landing fallback', () => {
  it('counts the same catalog servers as the app', () => {
    expect(catalogSeeds.length).toBe(catalogCount);
  });

  it('carries the same text, links and labels as LandingHero', () => {
    expect(describeLanding(fallback)).toEqual(describeLanding(component));
  });

  it('renders every string in the shared landing copy module', () => {
    const strings = Object.values(landingCopy).flatMap(value => (
      typeof value === 'string'
        ? [value]
        : value.flatMap(item => (typeof item === 'string' ? [item] : [item.title, item.description]))
    ));
    const fallbackText = text(fallback);
    const componentText = text(component);
    for (const value of strings) {
      expect(fallbackText.includes(value) || fallback.innerHTML.includes(value), value).toBe(true);
      expect(componentText.includes(value) || component.innerHTML.includes(value), value).toBe(true);
    }
  });

  it('uses semantic elements and only classes the component also renders', () => {
    expect(fallback.querySelector('section > div > h1')).not.toBeNull();
    expect(fallback.querySelector('section > div > p')).not.toBeNull();
    expect(fallback.querySelectorAll('section > nav > ul > li > a')).toHaveLength(landingCopy.LANDING_AUDIENCE_PATHS.length);
    expect(fallback.querySelectorAll('.landing-coverage > ul > li')).toHaveLength(landingCopy.LANDING_REPORT_COVERAGE.length);

    const componentClasses = new Set(Array.from(component.querySelectorAll('[class]'), element => [...element.classList]).flat());
    const fallbackClasses = Array.from(fallback.querySelectorAll('[class]'), element => [...element.classList]).flat();
    expect(fallbackClasses.filter(name => name !== 'seo-landing-fallback' && !['landing-quick-picks', 'landing-recent', 'landing-quick-picks-label'].includes(name) && !componentClasses.has(name))).toEqual([]);
  });
});

/**
 * Element outline for comparing the static shell with the app's first
 * render: tag, classes, link target and own text per element, in document
 * order. Inline styles and accessibility attributes are left to the browser
 * test; drawers and views hidden on the playground are not part of the frame.
 */
const HIDDEN_IN_FIRST_FRAME = [
  '.mobile-sidebar',
  '.mobile-sidebar-overlay',
  '.view-panel.d-none',
  '.main-content > .d-none',
  'style',
  // Static alternative selected before first paint for returning visitors.
  '[data-prerendered-recent]',
  'template',
  // The shell carries both theme icons and shows one with CSS.
  '.theme-toggle-icon',
];
const outline = (root) => {
  const copy = root.cloneNode(true);
  copy.querySelectorAll(HIDDEN_IN_FIRST_FRAME.join(',')).forEach(element => element.remove());
  const lines = [];
  const walk = (element, depth) => {
    const classes = [...element.classList]
      .filter(name => name !== 'seo-shell-fallback' && name !== 'seo-landing-fallback')
      .sort()
      .join('.');
    const ownText = Array.from(element.childNodes)
      .filter(node => node.nodeType === 3)
      .map(node => node.textContent)
      .join('')
      .replace(/\s+/g, ' ')
      .trim();
    const href = element.getAttribute('href');
    lines.push(`${'  '.repeat(depth)}${element.tagName.toLowerCase()}${classes ? `.${classes}` : ''}${href ? ` [${href}]` : ''}${ownText ? ` "${ownText}"` : ''}`);
    for (const child of element.children) walk(child, depth + 1);
  };
  walk(copy, 0);
  return lines;
};

const renderAppFirstFrame = () => parse(renderToStaticMarkup(React.createElement(
  MemoryRouter,
  { initialEntries: ['/'] },
  React.createElement(AuthProvider, null, React.createElement(App))
))).querySelector('.app-shell');

const renderShell = (authEnabled) => parse(renderShellFallback({
  catalogCount,
  quickPicks: selectLandingQuickPicks(getCatalogServers()),
  learnTracks: LEARN_TRACKS,
  authEnabled,
})).querySelector('.app-shell');

describe('static first frame (header, sidebar, playground landing)', () => {
  // main.tsx fetches the playground chunk before mounting on "/", so the
  // first React frame already contains it.
  beforeAll(() => preloadViewsForPath('/'));

  afterEach(() => {
    vi.unstubAllEnvs();
    localStorage.clear();
  });

  it.each([false, true])('matches the app shell React renders first for a new visitor (auth enabled: %s)', (authEnabled) => {
    vi.stubEnv('VITE_FIREBASE_AUTH_ENABLED', authEnabled ? 'true' : 'false');
    localStorage.clear();
    const app = renderAppFirstFrame();
    const shell = renderShell(authEnabled);

    expect(app).not.toBeNull();
    // This variant is hidden by CSS for new visitors.
    shell.querySelector('.seo-returning-workspace')?.remove();
    expect(outline(shell)).toEqual(outline(app));
    expect(Boolean(shell.querySelector('.app-auth-placeholder'))).toBe(authEnabled);
  });

  it('builds the sidebar links from the shared navigation module', () => {
    const shell = renderShell(false);
    const sidebarLinks = Array.from(
      shell.querySelectorAll('.desktop-sidebar .app-sidenav .sidenav-group:first-child .sidenav-list > .nav-item > a.nav-link'),
      link => ({
        path: link.getAttribute('href'),
        label: text(link),
        active: link.classList.contains('active'),
      })
    );
    expect(sidebarLinks).toEqual(PRIMARY_NAVIGATION.map(item => ({
      path: item.path,
      label: item.label,
      active: item.path === '/',
    })));
    expect(shell.querySelector('.content-track-nav .sidenav-list > .nav-item > a').getAttribute('href'))
      .toBe(LEARN_HUB_NAVIGATION.path);
    expect(Array.from(shell.querySelectorAll('.content-track-nav .sidenav-sublink'), link => link.getAttribute('href')))
      .toEqual(LEARN_TRACKS.flatMap(track => track.items.map(item => item.path)));
  });

  it('renders an editable connect form and quick picks for the deferred mount', () => {
    const shell = renderShell(false);
    const input = shell.querySelector('.landing-connect input#serverUrl');
    expect(input.hasAttribute('readonly')).toBe(false);
    expect(shell.querySelector('.landing-connect button#connectBtn').disabled).toBe(true);
    expect(shell.querySelectorAll('[onclick], script')).toHaveLength(0);
    expect(Array.from(shell.querySelectorAll('.landing-quick-pick'), button => button.dataset.serverId))
      .toEqual(selectLandingQuickPicks(getCatalogServers()).map(server => server.id));
  });

  it('shows the theme icon matching data-theme and nothing else', () => {
    const style = renderShell(false).querySelector('style').textContent;
    expect(style).toContain(":root[data-theme='dark'] .seo-shell-fallback .theme-toggle-icon.bi-moon-stars-fill");
    expect(style).toContain(":root:not([data-theme='dark']) .seo-shell-fallback .theme-toggle-icon.bi-sun-fill");
  });
});

/**
 * Guides and the Learn index mount React on the first input (issue #405), so
 * their static page must already be the frame the app renders: the same
 * header, sidebar (with the guide's track open) and page body.
 */
describe('static frame of a prerendered Learn page', () => {
  const renderAppAt = pathname => parse(renderToStaticMarkup(React.createElement(
    MemoryRouter,
    { initialEntries: [pathname] },
    React.createElement(AuthProvider, null, React.createElement(App))
  ))).querySelector('.app-shell');
  const renderStaticAt = (pathname, content) => parse(renderAppShell({
    content,
    view: 'learn',
    pathname,
    panelStyle: 'min-height: 100%;',
    learnTracks: LEARN_TRACKS,
  })).querySelector('.app-shell');

  afterEach(() => {
    localStorage.clear();
  });

  it.each([
    '/learn/mcp-http-headers-reference',
    '/learn/connect-remote-mcp-server',
  ])('matches the app React mounts over %s', async (pathname) => {
    // As in the browser without a prerendered body: the article and Markdown chunks and highlight.js.
    await preloadViewsForPath(pathname);
    await prepareContentPrerender();
    const page = renderArticlePage(pathname);
    expect(page).not.toBeNull();
    // The review date the sitemap's lastmod and the site audit read.
    expect(page).toMatch(/Last reviewed <time datetime="\d{4}-\d{2}-\d{2}"/);

    expect(outline(renderStaticAt(pathname, page))).toEqual(outline(renderAppAt(pathname)));
  });

  it('matches the app React mounts over the Learn index', () => {
    expect(outline(renderStaticAt('/learn', renderLearnIndexPage()))).toEqual(outline(renderAppAt('/learn')));
  });
});
