import React from 'react';
import { renderToStaticMarkup } from 'react-dom/server';
import { MemoryRouter } from 'react-router-dom';
import { afterEach, describe, expect, it, vi } from 'vitest';

// Auth stays loading: the static shell stands in for the app's first render,
// which happens before Firebase reports a user.
vi.mock('firebase/auth', () => ({
  onAuthStateChanged: vi.fn(() => () => {}),
  GoogleAuthProvider: class {},
  signInWithPopup: vi.fn(),
  signOut: vi.fn(),
}));
vi.mock('../src/firebase', () => ({ auth: {} }));
vi.mock('../src/utils/analytics', async (importOriginal) => ({
  ...(await importOriginal()),
  logEvent: vi.fn(),
  logPageView: vi.fn(),
}));

import App from '../src/App';
import { AuthProvider } from '../src/context/AuthContext';
import { LandingHero, selectLandingQuickPicks } from '../src/components/LandingHero';
import { RESOURCE_NAV_ITEMS } from '../src/content/resourceNavigation';
import { PRIMARY_NAV_ITEMS } from '../src/content/navigation';
import * as landingCopy from '../src/content/landingCopy';
import { getCatalogServers } from '../src/utils/catalogUtils';
import seoGenerator from './generate-seo-pages.js';
import catalogSeeds from '../src/data/serverCatalog.json';

const { renderLandingFallback, renderShellFallback } = seoGenerator;

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
    expect(fallbackClasses.filter(name => name !== 'seo-landing-fallback' && !componentClasses.has(name))).toEqual([]);
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
  resourceItems: RESOURCE_NAV_ITEMS,
  authEnabled,
})).querySelector('.app-shell');

describe('static first frame (header, sidebar, playground landing)', () => {
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
    expect(outline(shell)).toEqual(outline(app));
    expect(Boolean(shell.querySelector('.app-auth-placeholder'))).toBe(authEnabled);
  });

  it('builds the sidebar links from the shared navigation module', () => {
    const shell = renderShell(false);
    const sidebarLinks = Array.from(shell.querySelectorAll('.desktop-sidebar .app-sidenav > a.nav-link'), link => ({
      path: link.getAttribute('href'),
      label: text(link),
      active: link.classList.contains('active'),
    }));
    expect(sidebarLinks).toEqual(PRIMARY_NAV_ITEMS.map(item => ({
      path: item.path,
      label: item.label,
      active: item.activeViews.includes('playground'),
    })));
    expect(Array.from(shell.querySelectorAll('.sidenav-content-list a'), link => link.getAttribute('href')))
      .toEqual(RESOURCE_NAV_ITEMS.map(item => item.path));
  });

  it('renders the landing connect form and quick picks as inert markup', () => {
    const shell = renderShell(false);
    const input = shell.querySelector('.landing-connect input#serverUrl');
    expect(input.hasAttribute('readonly')).toBe(true);
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
