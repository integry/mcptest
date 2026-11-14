import React, { act } from 'react';
import { createRoot, type Root } from 'react-dom/client';
import { renderToStaticMarkup } from 'react-dom/server';
import { MemoryRouter } from 'react-router-dom';
import { afterEach, beforeAll, beforeEach, describe, expect, it, vi } from 'vitest';
import SideNav from './SideNav';
import { DASHBOARDS_NAVIGATION, LEARN_TRACKS, NAVIGATION_GROUPS, PRIMARY_NAVIGATION } from '../content/navigation';
import { TRACK_NAVIGATION } from '../content/learnRegistry';
import { SIDEBAR_COLLAPSED_CLASS, SIDEBAR_COLLAPSED_KEY } from '../hooks/useSidebarCollapsed';
import { readStylesheet } from '../styles/readStylesheet';

vi.mock('../context/AuthContext', () => ({
  useAuth: () => ({
    currentUser: null,
    loginWithGoogle: vi.fn(),
    logout: vi.fn(),
  }),
}));

type ActiveView = React.ComponentProps<typeof SideNav>['activeView'];

const baseProps = (activeView: ActiveView, spaces = [{ id: 'dashboard-1', name: 'Saved space', cards: [] }]) => ({
  activeView,
  spaces,
  selectedSpaceId: null,
  handleSelectSpace: vi.fn(),
  handleCreateSpace: vi.fn(),
  handleReorderDashboards: vi.fn(),
  getSpaceHealthStatus: () => ({ loading: false, successCount: 0, totalCount: 0 }),
  getSpaceHealthColor: () => 'gray' as const,
  performAllDashboardsHealthCheck: vi.fn().mockResolvedValue(undefined),
  onMoveCard: vi.fn(),
});

const renderStatic = (activeView: ActiveView, path: string, spaces?: Array<{ id: string; name: string; cards: never[] }>) => {
  const markup = renderToStaticMarkup(
    <MemoryRouter initialEntries={[path]}>
      <SideNav {...baseProps(activeView, spaces)} />
    </MemoryRouter>
  );
  const container = document.createElement('div');
  container.innerHTML = markup;
  return container;
};

const expandedTracks = (container: ParentNode) =>
  Array.from(container.querySelectorAll<HTMLElement>('.content-track'))
    .filter(track => track.querySelector('.sidenav-group-toggle')?.getAttribute('aria-expanded') === 'true')
    .map(track => track.dataset.track);

describe('SideNav dashboard rows', () => {
  it('keeps the card count beside a flexible, truncatable dashboard name', () => {
    const sidebarCss = readStylesheet();
    const dashboardName = 'My first dashboard with a deliberately long name';
    const container = renderStatic('dashboards', '/space/my-first-dashboard', [
      { id: 'dashboard-1', name: dashboardName, cards: [] },
    ]);

    const list = container.querySelector<HTMLElement>('.dashboard-list');
    const link = container.querySelector<HTMLElement>('.dashboard-link');
    const name = link?.querySelector<HTMLElement>('.dashboard-name');
    const count = link?.querySelector<HTMLElement>('.dashboard-card-count');

    expect(name?.textContent).toBe(dashboardName);
    expect(name?.title).toBe(dashboardName);
    expect(name?.nextElementSibling).toBe(count);
    expect(count?.textContent?.trim()).toBe('0 cards');
    expect(name?.classList).toContain('flex-grow-1');
    expect(name?.classList).toContain('text-truncate');

    const dashboardRulesStart = sidebarCss.indexOf('.dashboard-name {');
    const dashboardRulesEnd = sidebarCss.indexOf('.main-content.p-3 {', dashboardRulesStart);
    const style = document.createElement('style');
    style.textContent = sidebarCss.slice(dashboardRulesStart, dashboardRulesEnd);
    document.head.appendChild(style);
    document.body.appendChild(container);

    expect(getComputedStyle(list!).marginLeft).toBe('0px');
    expect(getComputedStyle(link!).width).toBe('100%');
    expect(getComputedStyle(name!).flex).toBe('1 1 0%');
    expect(getComputedStyle(name!).minWidth).toBe('0');
    expect(getComputedStyle(name!).textOverflow).toBe('ellipsis');
    expect(getComputedStyle(count!).flex).toBe('0 0 auto');
    expect(getComputedStyle(count!).whiteSpace).toBe('nowrap');

    container.remove();
    style.remove();
  });

  it('sets section labels as small mono capitals, the Learn toggle included', () => {
    const sidebarCss = readStylesheet();
    const container = renderStatic('playground', '/', []);

    expect(
      Array.from(container.querySelectorAll('.sidenav-section-label'), (label) => label.textContent)
    ).toEqual(['Workspace', 'Checks', 'Saved work']);

    const ruleBody = (selector: string) => {
      const start = sidebarCss.indexOf(`${selector} {`);
      expect(start, `${selector} should have a style rule`).toBeGreaterThan(-1);
      return sidebarCss.slice(start, sidebarCss.indexOf('}', start));
    };
    // The structural labels share one type: mono, 11px, tracked capitals.
    ['.sidenav-section-label', '.app-sidenav .sidenav-section-toggle.nav-link', '.catalog-category-heading'].forEach((selector) => {
      const rule = ruleBody(selector);
      expect(rule, selector).toMatch(/font-family:\s*var\(--font-family-mono\)/);
      expect(rule, selector).toMatch(/font-size:\s*var\(--text-2xs\)/);
      expect(rule, selector).toMatch(/letter-spacing:\s*0\.08em/);
      expect(rule, selector).toMatch(/text-transform:\s*uppercase/);
    });
  });
});

describe('SideNav information architecture', () => {
  const groupLinks = (container: ParentNode, groupId: string) => Array.from(
    container.querySelectorAll(`.sidenav-group--${groupId} > .sidenav-list > .nav-item`),
    item => item.querySelector('a.sidenav-link, button.sidenav-group-toggle')!
  ).map(link => [link.querySelector('.sidenav-label')?.textContent?.trim(), link.getAttribute('href')]);

  it('orders the groups by what people come to do: test and browse, checks, saved work, then learn', () => {
    const container = renderStatic('catalog', '/catalog');

    const sections = Array.from(container.querySelectorAll('.app-sidenav > section.sidenav-group'));
    expect(sections.map(section => section.querySelector('h2')?.textContent?.trim()))
      .toEqual(['Workspace', 'Checks', 'Saved work', 'Learn']);
    // Every group, the first included, shows its heading as a section label.
    sections.slice(0, 3).forEach(section => {
      expect(section.querySelector('h2')?.classList).toContain('sidenav-section-label');
    });
    // Each group is a region named by its own heading.
    sections.forEach(section => {
      expect(section.querySelector(`[id="${section.getAttribute('aria-labelledby')}"]`)?.textContent?.trim()).toBeTruthy();
    });

    expect(groupLinks(container, 'start')).toEqual([['Playground', '/'], ['Catalog', '/catalog']]);
    expect(groupLinks(container, 'checks')).toEqual([
      ['Breaking changes', '/tools/breaking-changes'],
      ['OAuth checker', '/tools/oauth-check'],
      ['Discovery checker', '/tools/discovery'],
    ]);
    expect(groupLinks(container, 'saved')).toEqual([['Reports', '/report'], ['Dashboards', null]]);
    expect(PRIMARY_NAVIGATION.map(item => item.path)).toEqual(
      NAVIGATION_GROUPS.flatMap(group => group.items.map(item => item.path))
    );

    // Playground is the primary action.
    expect(container.querySelector('a[href="/"]')?.classList).toContain('sidenav-link--primary');
    expect(container.querySelectorAll('.sidenav-link--primary')).toHaveLength(1);
    expect(container.querySelector('a[href="/catalog"]')?.classList).toContain('active');
    expect(container.querySelector('a[href="/catalog"]')?.getAttribute('aria-current')).toBe('page');

    // The old "Resources" trio is gone; its entries live under the tracks.
    expect(container.textContent).not.toContain('Resources');
    expect(container.textContent).not.toContain('Guides & Tutorials');
    expect(container.querySelector('a[href="/learn"]')?.textContent?.trim()).toBe('Guides');
    expect(
      Array.from(container.querySelectorAll('.content-track-label .sidenav-label'), label => label.textContent)
    ).toEqual(['Understand', 'Use', 'Build', 'Reference']);
  });

  it('gives every tool entry a one-line description as its tooltip and accessible description', () => {
    const container = renderStatic('playground', '/');
    for (const item of PRIMARY_NAVIGATION) {
      expect(item.description, item.label).toMatch(/^[^\n]{10,90}$/);
      const control = Array.from(container.querySelectorAll<HTMLElement>('.app-sidenav .sidenav-link'))
        .find(element => element.querySelector('.sidenav-label')?.textContent === item.label)!;
      expect(control, item.label).toBeTruthy();
      expect(control.title).toBe(item.description);
      const description = container.querySelector(`#${control.getAttribute('aria-describedby')}`);
      expect(description?.textContent).toBe(item.description);
      expect(description?.classList).toContain('visually-hidden');
      // The description is not part of the link's name.
      expect(control.textContent?.trim()).toBe(item.label);
    }
  });

  it('shows a single Dashboards entry, not an empty default dashboard, to a visitor with none', () => {
    const container = renderStatic('playground', '/', []);
    const entry = container.querySelector('.sidenav-dashboards')!;

    expect(entry.querySelector('a')?.getAttribute('href')).toBe(DASHBOARDS_NAVIGATION.path);
    expect(entry.querySelector('a')?.textContent?.trim()).toBe('Dashboards');
    expect(container.querySelector('.dashboard-list')).toBeNull();
    expect(container.textContent).not.toContain('My first dashboard');
    expect(container.textContent).not.toContain('0 cards');
    expect(container.querySelector('[aria-label="Create new dashboard"]')).toBeNull();
    expect(container.querySelector('[aria-label="Refresh health status of all dashboards"]')).toBeNull();

    const onPage = renderStatic('dashboards', '/space', []);
    expect(onPage.querySelector('.sidenav-dashboards a')?.getAttribute('aria-current')).toBe('page');
  });

  it('keeps the collapsible dashboards group for a visitor who has dashboards', () => {
    const container = renderStatic('catalog', '/catalog');
    const dashboardsToggle = container.querySelector<HTMLElement>('.sidenav-dashboards .sidenav-group-toggle');
    expect(dashboardsToggle?.textContent).toContain('Dashboards');
    expect(dashboardsToggle?.getAttribute('aria-expanded')).toBe('true');
    const dashboardsBody = container.querySelector<HTMLElement>(`#${dashboardsToggle?.getAttribute('aria-controls')}`);
    expect(dashboardsBody?.hidden).toBe(false);
    expect(dashboardsBody?.textContent).toContain('Saved space');
    expect(container.querySelector('.sidenav-dashboards [aria-label="Create new dashboard"]')).not.toBeNull();
    expect(container.querySelector('.sidenav-dashboards [aria-label="Refresh health status of all dashboards"]')).not.toBeNull();
  });

  it.each([
    ['playground', '/'],
    ['catalog', '/catalog'],
    ['report', '/report'],
    ['breaking-changes', '/tools/breaking-changes'],
    ['dashboards', '/space'],
  ] as const)('folds the Learn group on the app page %s, with every guide link still in the HTML', (view, path) => {
    const container = renderStatic(view, path);
    const toggle = container.querySelector<HTMLElement>('.content-track-nav .sidenav-section-toggle')!;
    const body = container.querySelector<HTMLElement>(`#${toggle.getAttribute('aria-controls')}`)!;

    expect(toggle.getAttribute('aria-expanded')).toBe('false');
    expect(body.hidden).toBe(true);
    expect(body.querySelector('.guide-search')).not.toBeNull();
    expect(Array.from(body.querySelectorAll('.sidenav-sublist a'), link => link.getAttribute('href')))
      .toEqual(LEARN_TRACKS.flatMap(track => track.items.map(item => item.path)));
    expect(expandedTracks(container)).toEqual([]);
  });

  it('opens the Learn group with the current track on Learn and Docs pages', () => {
    const container = renderStatic('learn', '/learn/mcp-clients-compared');
    const toggle = container.querySelector<HTMLElement>('.content-track-nav .sidenav-section-toggle')!;
    expect(toggle.getAttribute('aria-expanded')).toBe('true');
    expect(container.querySelector<HTMLElement>(`#${toggle.getAttribute('aria-controls')}`)?.hidden).toBe(false);

    expect(expandedTracks(container)).toEqual(['use']);
    const useTrack = container.querySelector('.content-track[data-track="use"]')!;
    const hrefs = Array.from(useTrack.querySelectorAll('.sidenav-sublist a'), link => link.getAttribute('href'));
    expect(hrefs).toEqual(TRACK_NAVIGATION.find(track => track.id === 'use')!.items.map(item => item.path));
    expect(useTrack.querySelector('a[href="/learn/mcp-clients-compared"]')?.classList).toContain('active');
    expect(container.querySelector('a[href="/learn"]')?.classList).not.toContain('active');
    // No app destination is active on a guide.
    expect(container.querySelectorAll('.sidenav-group:not(.content-track-nav) a.active')).toHaveLength(0);

    // Every article of every track is still in the DOM in reading order, just hidden when collapsed.
    const allHrefs = Array.from(container.querySelectorAll('.sidenav-sublist a'), link => link.getAttribute('href'));
    expect(allHrefs).toEqual(LEARN_TRACKS.flatMap(track => track.items.map(item => item.path)));
    const preExisting = [
      '/docs/what-is-mcp',
      '/docs/remote-vs-local',
      '/learn/should-you-build-mcp-server',
      '/learn/connect-remote-mcp-server',
      '/learn/mcp-clients-compared',
      '/learn/oauth-for-mcp-explained',
      '/docs/testing-guide',
      '/learn/designing-production-mcp-server',
      '/learn/mcp-server-trust-checklist',
      '/docs/troubleshooting',
    ];
    expect(allHrefs.filter(href => preExisting.includes(href as string))).toEqual(preExisting);

    // Dashboards stay available on content pages too; the workspace links lead back to the app.
    expect(container.querySelector('.sidenav-dashboards')).not.toBeNull();
    expect(container.querySelector('a[href="/"]')).not.toBeNull();
    expect(container.querySelector('a[href="/report"]')).not.toBeNull();

    const docs = renderStatic('docs', '/docs/troubleshooting');
    expect(docs.querySelector('.sidenav-section-toggle')?.getAttribute('aria-expanded')).toBe('true');
    expect(expandedTracks(docs)).toEqual(['reference']);
    expect(docs.querySelector('a[href="/docs/troubleshooting"]')?.classList).toContain('active');
    expect(expandedTracks(renderStatic('docs', '/docs/troubleshooting/'))).toEqual(['reference']);
  });

  it.each([
    ['playground', '/', '/'],
    ['catalog', '/catalog', '/catalog'],
    ['server-profile', '/servers/example/', '/catalog'],
    ['breaking-changes', '/tools/breaking-changes', '/tools/breaking-changes'],
    ['oauth-check', '/tools/oauth-check', '/tools/oauth-check'],
    ['discovery', '/tools/discovery', '/tools/discovery'],
    ['report', '/report/example.com', '/report'],
    ['dashboards', '/space', '/space'],
  ] as const)('marks only the entry for %s active', (view, path, expected) => {
    const container = renderStatic(view, path, []);
    const active = Array.from(container.querySelectorAll('.sidenav-group:not(.content-track-nav) a.active'), link => link.getAttribute('href'));
    expect(active).toEqual([expected]);
    expect(container.querySelectorAll('[aria-current="page"]')).toHaveLength(1);
  });

  it('renders the footer links in order, with external links opening in a new tab', () => {
    const container = renderStatic('playground', '/');
    const footer = container.querySelector('.sidenav-footer')!;

    const projectLinks = Array.from(footer.querySelectorAll('.sidenav-footer-links a'), link => [
      link.textContent?.replace(/\s*\(opens in a new tab\)/, '').trim(),
      link.getAttribute('href'),
      link.getAttribute('target'),
      link.getAttribute('rel'),
    ]);
    expect(projectLinks).toEqual([
      ['Test an MCP server', '/mcp-test-server', null, null],
      ['MCP Inspector online', '/mcp-inspector-online', null, null],
      ['MCP playground', '/mcp-playground', null, null],
      ['CI release gate', '/ci', null, null],
      ['MCP test servers', '/mcp-test-servers', null, null],
      ['Test your MCP client', '/mcp-test-client', null, null],
      ['Submit a server', '/submit', null, null],
      ['Badges', 'https://github.com/integry/mcptest#embedding-a-badge', '_blank', 'noopener noreferrer'],
      ['GitHub repository', 'https://github.com/integry/mcptest', '_blank', 'noopener noreferrer'],
    ]);
    expect(
      Array.from(footer.querySelectorAll('.sidenav-legal a'), link => [link.textContent, link.getAttribute('href')])
    ).toEqual([
      ['Contact', '/docs/contact'],
      ['Privacy', '/docs/privacy-policy'],
      ['Terms', '/docs/terms-of-service'],
    ]);
    expect(footer.querySelector('.sidenav-build time')).not.toBeNull();
    expect(footer.querySelector('.sidenav-build a')?.getAttribute('href')).toMatch(/github\.com\/integry\/mcptest\/commit\//);

    // Quieter type than the navigation links.
    const css = readStylesheet('layout');
    const footerRule = css.match(/\.sidenav-footer\s*\{([^}]*)\}/)?.[1] ?? '';
    expect(parseFloat(footerRule.match(/font-size:\s*([\d.]+)rem/)?.[1] ?? '1')).toBeLessThan(0.875);
    expect(footerRule).toMatch(/border-top:\s*1px solid var\(--border-color\)/);
  });
});

describe('SideNav collapsed desktop mode', () => {
  beforeAll(() => {
    (globalThis as typeof globalThis & { IS_REACT_ACT_ENVIRONMENT: boolean }).IS_REACT_ACT_ENVIRONMENT = true;
  });

  let root: Root | undefined;
  let host: HTMLDivElement;

  beforeEach(() => {
    localStorage.clear();
    document.body.classList.remove(SIDEBAR_COLLAPSED_CLASS);
    host = document.createElement('div');
    document.body.appendChild(host);
  });

  afterEach(() => {
    act(() => root?.unmount());
    root = undefined;
    host.remove();
  });

  const mount = (props: Partial<React.ComponentProps<typeof SideNav>> = {}, path = '/learn/mcp-clients-compared') => {
    root = createRoot(host);
    act(() => root!.render(
      <MemoryRouter initialEntries={[path]}>
        <SideNav {...baseProps('learn')} {...props} />
      </MemoryRouter>
    ));
  };

  const click = (element: Element | null) => act(() => {
    element?.dispatchEvent(new MouseEvent('click', { bubbles: true }));
  });

  it('collapses to an icon rail from the bottom control, remembers it, and restores it', () => {
    mount();
    const nav = host.querySelector<HTMLElement>('.app-sidenav')!;
    const toggle = host.querySelector<HTMLButtonElement>('.sidenav-collapse-toggle')!;

    expect(toggle.getAttribute('aria-expanded')).toBe('true');
    expect(toggle.getAttribute('aria-controls')).toBe(nav.id);
    expect(nav.classList).not.toContain('app-sidenav--collapsed');
    expect(expandedTracks(host)).toEqual(['use']);

    click(toggle);

    expect(nav.classList).toContain('app-sidenav--collapsed');
    expect(toggle.getAttribute('aria-expanded')).toBe('false');
    expect(toggle.getAttribute('aria-label')).toBe('Expand sidebar');
    expect(document.body.classList).toContain(SIDEBAR_COLLAPSED_CLASS);
    expect(localStorage.getItem(SIDEBAR_COLLAPSED_KEY)).toBe('true');
    // Icon-only: groups fold, but every link keeps a name for its tooltip.
    expect(expandedTracks(host)).toEqual([]);
    expect(host.querySelector('.sidenav-dashboards .sidenav-group-toggle')?.getAttribute('aria-expanded')).toBe('false');
    expect(host.querySelector('.sidenav-section-toggle')?.getAttribute('aria-expanded')).toBe('false');
    host.querySelectorAll('.sidenav-group:not(.content-track-nav) .sidenav-list > .nav-item > a').forEach(link => {
      const label = link.textContent?.trim();
      const item = PRIMARY_NAVIGATION.find(entry => entry.label === label)!;
      expect(link.getAttribute('title')).toBe(`${label}: ${item.description}`);
    });
    expect(host.querySelector('.sidenav-section-toggle')?.getAttribute('title')).toBe('Learn');

    // Opening Learn from the rail expands the sidebar first, with the page's track open.
    click(host.querySelector('.sidenav-section-toggle'));
    expect(nav.classList).not.toContain('app-sidenav--collapsed');
    expect(host.querySelector('.sidenav-section-toggle')?.getAttribute('aria-expanded')).toBe('true');
    expect(expandedTracks(host)).toEqual(['use']);
    expect(localStorage.getItem(SIDEBAR_COLLAPSED_KEY)).toBe('false');

    // A track opened from the rail is the only one open.
    click(toggle);
    click(host.querySelector('.content-track[data-track="build"] .sidenav-group-toggle'));
    expect(nav.classList).not.toContain('app-sidenav--collapsed');
    expect(expandedTracks(host)).toEqual(['build']);

    act(() => root?.unmount());
    root = undefined;
    expect(document.body.classList).not.toContain(SIDEBAR_COLLAPSED_CLASS);

    // A remembered collapse applies on the next mount; the mobile drawer ignores it.
    localStorage.setItem(SIDEBAR_COLLAPSED_KEY, 'true');
    mount();
    expect(host.querySelector('.app-sidenav')?.classList).toContain('app-sidenav--collapsed');
    expect(document.body.classList).toContain(SIDEBAR_COLLAPSED_CLASS);
    act(() => root?.unmount());
    root = undefined;

    mount({ isMobile: true, theme: 'light', onToggleTheme: vi.fn() });
    expect(host.querySelector('.app-sidenav')?.classList).not.toContain('app-sidenav--collapsed');
    expect(host.querySelector('.sidenav-collapse-toggle')).toBeNull();
    expect(document.body.classList).not.toContain(SIDEBAR_COLLAPSED_CLASS);
  });

  it('narrows the desktop column to 56px and hides labels in the stylesheet', () => {
    const css = readStylesheet('layout');
    expect(css).toMatch(/\.sidenav-collapsed \.desktop-sidebar\s*\{[^}]*width:\s*56px;/);
    const hidden = css.match(/((?:\.app-sidenav--collapsed [^,{]+,?\s*)+)\{\s*display:\s*none;\s*\}/)?.[1] ?? '';
    ['.sidenav-label', '.sidenav-section-label', '.sidenav-footer-links', '.sidenav-legal'].forEach(selector => {
      expect(hidden).toContain(`.app-sidenav--collapsed ${selector}`);
    });
  });

  it('toggles the dashboards group and the learn tracks with aria-expanded', () => {
    mount({}, '/catalog');
    const dashboardsToggle = host.querySelector<HTMLButtonElement>('.sidenav-dashboards .sidenav-group-toggle')!;
    const body = host.querySelector<HTMLElement>(`#${dashboardsToggle.getAttribute('aria-controls')}`)!;

    expect(dashboardsToggle.getAttribute('aria-expanded')).toBe('true');
    click(dashboardsToggle);
    expect(dashboardsToggle.getAttribute('aria-expanded')).toBe('false');
    expect(body.hidden).toBe(true);
    click(dashboardsToggle);
    expect(body.hidden).toBe(false);

    const understand = host.querySelector<HTMLButtonElement>('.content-track[data-track="understand"] .sidenav-group-toggle')!;
    const list = host.querySelector<HTMLElement>(`#${understand.getAttribute('aria-controls')}`)!;
    expect(list.hidden).toBe(true);
    click(understand);
    expect(understand.getAttribute('aria-expanded')).toBe('true');
    expect(list.hidden).toBe(false);
    expect(expandedTracks(host)).toEqual(['understand']);
    click(understand);
    expect(expandedTracks(host)).toEqual([]);
  });
});

describe('SideNav mobile drawer', () => {
  beforeAll(() => {
    (globalThis as typeof globalThis & { IS_REACT_ACT_ENVIRONMENT: boolean }).IS_REACT_ACT_ENVIRONMENT = true;
  });

  let root: Root | undefined;
  let drawer: HTMLDivElement;
  let opener: HTMLButtonElement;

  beforeEach(() => {
    document.body.classList.remove('menu-open');
    opener = document.createElement('button');
    opener.className = 'mobile-menu-toggle';
    document.body.appendChild(opener);
    drawer = document.createElement('div');
    drawer.className = 'mobile-sidebar';
    document.body.appendChild(drawer);
  });

  afterEach(() => {
    act(() => root?.unmount());
    root = undefined;
    drawer.remove();
    opener.remove();
    document.body.classList.remove('menu-open');
    vi.unstubAllEnvs();
  });

  const waitForObserver = () => act(async () => {
    await Promise.resolve();
  });

  it('traps focus while open, closes on Escape and restores focus to the hamburger', async () => {
    vi.stubEnv('VITE_FIREBASE_AUTH_ENABLED', 'true');
    root = createRoot(drawer);
    act(() => root!.render(
      <MemoryRouter initialEntries={['/']}>
        <SideNav {...baseProps('playground')} isMobile theme="light" onToggleTheme={vi.fn()} />
      </MemoryRouter>
    ));

    expect(drawer.getAttribute('role')).toBe('dialog');
    expect(drawer.getAttribute('aria-modal')).toBe('true');
    expect(drawer.querySelector('.sidenav-theme-toggle')).not.toBeNull();

    opener.focus();
    document.body.classList.add('menu-open');
    await waitForObserver();
    const focusable = Array.from(drawer.querySelectorAll<HTMLElement>('a[href], button:not([disabled]), input:not([disabled])'))
      .filter(element => !element.closest('[hidden]'));
    expect(document.activeElement).toBe(focusable[0]);
    // The primary action is the drawer's first control: one tap after opening.
    expect(focusable[0].getAttribute('href')).toBe('/');
    expect(focusable[0].classList).toContain('sidenav-link--primary');
    // Learn is folded on app pages, so the drawer's tab order skips its guide links.
    expect(focusable.some(element => element.closest('.sidenav-learn-body'))).toBe(false);
    // Signing in is explained in the drawer too.
    const signIn = Array.from(drawer.querySelectorAll('button')).find(button => button.textContent === 'Login with Google')!;
    expect(drawer.querySelector(`#${signIn.getAttribute('aria-describedby')}`)?.textContent).toMatch(/^Optional\. Testing works without an account/);

    focusable[focusable.length - 1].focus();
    act(() => {
      document.dispatchEvent(new KeyboardEvent('keydown', { key: 'Tab', bubbles: true, cancelable: true }));
    });
    expect(document.activeElement).toBe(focusable[0]);

    act(() => {
      document.dispatchEvent(new KeyboardEvent('keydown', { key: 'Tab', shiftKey: true, bubbles: true, cancelable: true }));
    });
    expect(document.activeElement).toBe(focusable[focusable.length - 1]);

    act(() => {
      document.dispatchEvent(new KeyboardEvent('keydown', { key: 'Escape', bubbles: true, cancelable: true }));
    });
    expect(document.body.classList).not.toContain('menu-open');
    await waitForObserver();
    expect(document.activeElement).toBe(opener);
  });

  it('gives the hamburger, close button and theme toggle 44px targets', () => {
    const css = readStylesheet('layout');
    const size = (selector: string) => {
      const rule = css.match(new RegExp(`(?:^|\\n)${selector.replace(/[.-]/g, '\\$&')}\\s*\\{([^}]*)\\}`))?.[1] ?? '';
      return [rule.match(/width:\s*([\d.]+)rem/)?.[1], rule.match(/height:\s*([\d.]+)rem/)?.[1]].map(Number);
    };
    expect(size('.mobile-menu-toggle')).toEqual([2.75, 2.75]);
    expect(size('.mobile-close-btn')).toEqual([2.75, 2.75]);
    expect(size('.app-sidenav .sidenav-theme-toggle.btn')).toEqual([2.75, 2.75]);
  });
});
