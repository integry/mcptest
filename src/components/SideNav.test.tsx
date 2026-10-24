import React, { act } from 'react';
import { createRoot, type Root } from 'react-dom/client';
import { renderToStaticMarkup } from 'react-dom/server';
import { MemoryRouter } from 'react-router-dom';
import { afterEach, beforeAll, beforeEach, describe, expect, it, vi } from 'vitest';
import SideNav from './SideNav';
import { LEARN_TRACKS } from '../content/navigation';
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

  it('presents section labels in natural case without micro-label typography', () => {
    const sidebarCss = readStylesheet();
    const container = renderStatic('playground', '/', []);

    expect(
      Array.from(container.querySelectorAll('.sidenav-section-label'), (label) => label.textContent)
    ).toEqual(['Workspace', 'Learn']);
    expect(sidebarCss).not.toMatch(/text-transform:\s*uppercase/i);

    const sectionRuleStart = sidebarCss.indexOf('.sidenav-section-label {');
    const sectionRuleEnd = sidebarCss.indexOf('}', sectionRuleStart);
    const sectionRule = sidebarCss.slice(sectionRuleStart, sectionRuleEnd);
    // Body-sized, not a micro-label: at least 13px and no tracking.
    expect(parseFloat(sectionRule.match(/font-size:\s*([\d.]+)rem/)?.[1] ?? '0')).toBeGreaterThanOrEqual(0.8125);
    expect(sectionRule).toMatch(/letter-spacing:\s*0/);

    const labelSelectors = [
      '.sidenav-section-label',
      '.catalog-category-heading',
      '.server-signal-label',
      '.server-endpoint-box span',
      '.catalog-filters .form-label',
      '.authorization-setup-kicker',
    ];

    labelSelectors.forEach((selector) => {
      const ruleStart = sidebarCss.indexOf(`${selector} {`);
      const ruleEnd = sidebarCss.indexOf('}', ruleStart);
      const rule = sidebarCss.slice(ruleStart, ruleEnd);

      expect(ruleStart, `${selector} should have a style rule`).toBeGreaterThan(-1);
      expect(parseFloat(rule.match(/font-size:\s*([\d.]+)rem/)?.[1] ?? '0')).toBeGreaterThanOrEqual(0.8);
      expect(rule).not.toMatch(/text-transform/);
      expect(rule).toMatch(/letter-spacing:\s*0/);
    });
  });
});

describe('SideNav information architecture', () => {
  it('groups the workspace links, a collapsible dashboards group and the learn tracks', () => {
    const container = renderStatic('catalog', '/catalog');

    const workspaceLinks = Array.from(
      container.querySelectorAll('.sidenav-group:first-of-type > .sidenav-list > .nav-item > a'),
      link => [link.textContent?.trim(), link.getAttribute('href')]
    );
    expect(workspaceLinks).toEqual([
      ['Playground', '/'],
      ['Catalog', '/catalog'],
      ['Reports', '/report'],
      ['Tool-selection evals', '/evals'],
      ['Discovery check', '/tools/discovery'],
    ]);
    expect(container.querySelector('a[href="/catalog"]')?.classList).toContain('active');
    expect(container.querySelector('a[href="/catalog"]')?.getAttribute('aria-current')).toBe('page');

    const dashboardsToggle = container.querySelector<HTMLElement>('.sidenav-dashboards .sidenav-group-toggle');
    expect(dashboardsToggle?.textContent).toContain('Dashboards');
    expect(dashboardsToggle?.getAttribute('aria-expanded')).toBe('true');
    const dashboardsBody = container.querySelector<HTMLElement>(`#${dashboardsToggle?.getAttribute('aria-controls')}`);
    expect(dashboardsBody?.hidden).toBe(false);
    expect(dashboardsBody?.textContent).toContain('Saved space');
    expect(container.querySelector('.sidenav-dashboards [aria-label="Create new dashboard"]')).not.toBeNull();
    expect(container.querySelector('.sidenav-dashboards [aria-label="Refresh health status of all dashboards"]')).not.toBeNull();

    // The old "Resources" trio is gone; its entries live under the tracks.
    expect(container.textContent).not.toContain('Resources');
    expect(container.textContent).not.toContain('Guides & Tutorials');
    expect(container.querySelector('a[href="/learn"]')?.textContent?.trim()).toBe('Guides');
    expect(
      Array.from(container.querySelectorAll('.content-track-label .sidenav-label'), label => label.textContent)
    ).toEqual(['Understand', 'Use', 'Build', 'Reference']);
    // Off content pages every track is collapsed, but all four stay visible.
    expect(expandedTracks(container)).toEqual([]);
    container.querySelectorAll('.content-track').forEach(track => {
      expect(track.querySelector('.sidenav-group-toggle')?.getAttribute('aria-expanded')).toBe('false');
      expect(track.querySelector<HTMLElement>('.sidenav-sublist')?.hidden).toBe(true);
    });
  });

  it('expands only the active track to its articles on a content page', () => {
    const container = renderStatic('learn', '/learn/mcp-clients-compared');

    expect(expandedTracks(container)).toEqual(['use']);
    const useTrack = container.querySelector('.content-track[data-track="use"]')!;
    const hrefs = Array.from(useTrack.querySelectorAll('.sidenav-sublist a'), link => link.getAttribute('href'));
    expect(hrefs).toEqual(TRACK_NAVIGATION.find(track => track.id === 'use')!.items.map(item => item.path));
    expect(useTrack.querySelector('a[href="/learn/mcp-clients-compared"]')?.classList).toContain('active');
    expect(container.querySelector('a[href="/learn"]')?.classList).not.toContain('active');

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
    expect(expandedTracks(docs)).toEqual(['reference']);
    expect(docs.querySelector('a[href="/docs/troubleshooting"]')?.classList).toContain('active');
    expect(expandedTracks(renderStatic('docs', '/docs/troubleshooting/'))).toEqual(['reference']);
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
    host.querySelectorAll('.sidenav-group:first-of-type > .sidenav-list > .nav-item > a').forEach(link => {
      expect(link.getAttribute('title')).toBe(link.textContent?.trim());
    });

    // Opening a group from the rail expands the sidebar first.
    click(host.querySelector('.content-track[data-track="build"] .sidenav-group-toggle'));
    expect(nav.classList).not.toContain('app-sidenav--collapsed');
    expect(expandedTracks(host)).toEqual(['build']);
    expect(localStorage.getItem(SIDEBAR_COLLAPSED_KEY)).toBe('false');

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
  });

  const waitForObserver = () => act(async () => {
    await Promise.resolve();
  });

  it('traps focus while open, closes on Escape and restores focus to the hamburger', async () => {
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
