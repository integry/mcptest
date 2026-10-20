import React from 'react';
import { renderToStaticMarkup } from 'react-dom/server';
import { MemoryRouter } from 'react-router-dom';
import { describe, expect, it, vi } from 'vitest';
import SideNav from './SideNav';
import { TRACK_NAVIGATION } from '../content/learnRegistry';
import { readStylesheet } from '../styles/readStylesheet';

vi.mock('../context/AuthContext', () => ({
  useAuth: () => ({
    currentUser: null,
    loginWithGoogle: vi.fn(),
    logout: vi.fn(),
  }),
}));

describe('SideNav dashboard rows', () => {
  it('keeps the card count beside a flexible, truncatable dashboard name', () => {
    const sidebarCss = readStylesheet();
    const dashboardName = 'My first dashboard with a deliberately long name';
    const markup = renderToStaticMarkup(
      <MemoryRouter>
        <SideNav
          activeView="dashboards"
          spaces={[{ id: 'dashboard-1', name: dashboardName, cards: [] }]}
          selectedSpaceId="dashboard-1"
          handleSelectSpace={vi.fn()}
          handleCreateSpace={vi.fn()}
          handleReorderDashboards={vi.fn()}
          getSpaceHealthStatus={() => ({ loading: false, successCount: 0, totalCount: 0 })}
          getSpaceHealthColor={() => 'gray'}
          performAllDashboardsHealthCheck={vi.fn().mockResolvedValue(undefined)}
          onMoveCard={vi.fn()}
        />
      </MemoryRouter>
    );
    const container = document.createElement('div');
    container.innerHTML = markup;

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
    const dashboardRulesEnd = sidebarCss.indexOf('.app-sidenav .nav-link:hover', dashboardRulesStart);
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
    const markup = renderToStaticMarkup(
      <MemoryRouter>
        <SideNav
          activeView="playground"
          spaces={[]}
          selectedSpaceId={null}
          handleSelectSpace={vi.fn()}
          handleCreateSpace={vi.fn()}
          handleReorderDashboards={vi.fn()}
          getSpaceHealthStatus={() => ({ loading: false, successCount: 0, totalCount: 0 })}
          getSpaceHealthColor={() => 'gray'}
          performAllDashboardsHealthCheck={vi.fn().mockResolvedValue(undefined)}
          onMoveCard={vi.fn()}
        />
      </MemoryRouter>
    );
    const container = document.createElement('div');
    container.innerHTML = markup;

    expect(
      Array.from(container.querySelectorAll('.sidenav-section-label'), (label) => label.textContent)
    ).toEqual(['Dashboards', 'Resources']);
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

  const renderSideNav = (activeView: 'learn' | 'docs' | 'catalog', path: string) => {
    const markup = renderToStaticMarkup(
      <MemoryRouter initialEntries={[path]}>
        <SideNav
          activeView={activeView}
          spaces={[{ id: 'dashboard-1', name: 'Saved space', cards: [] }]}
          selectedSpaceId={null}
          handleSelectSpace={vi.fn()}
          handleCreateSpace={vi.fn()}
          handleReorderDashboards={vi.fn()}
          getSpaceHealthStatus={() => ({ loading: false, successCount: 0, totalCount: 0 })}
          getSpaceHealthColor={() => 'gray'}
          performAllDashboardsHealthCheck={vi.fn().mockResolvedValue(undefined)}
          onMoveCard={vi.fn()}
        />
      </MemoryRouter>
    );
    const container = document.createElement('div');
    container.innerHTML = markup;
    return container;
  };

  it('shows track navigation instead of dashboards on content pages', () => {
    const container = renderSideNav('learn', '/learn/mcp-clients-compared');

    expect(container.textContent).not.toContain('Dashboards');
    expect(container.textContent).not.toContain('Saved space');
    expect(container.querySelector('.dashboard-list')).toBeNull();
    expect(container.querySelector('[aria-label="Create new dashboard"]')).toBeNull();
    expect(container.textContent).not.toContain('Resources');

    expect(
      Array.from(container.querySelectorAll('.content-track-label'), (label) => label.textContent)
    ).toEqual(['Understand', 'Use', 'Build', 'Reference']);
    const hrefs = Array.from(container.querySelectorAll('.content-track-nav a'), link => link.getAttribute('href'));
    expect(hrefs).toEqual([
      '/learn',
      ...TRACK_NAVIGATION.flatMap(track => track.items.map(item => item.path)),
    ]);
    // Pre-existing guides keep their relative sidebar order as new articles are added.
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
    expect(hrefs.filter(href => preExisting.includes(href as string))).toEqual(preExisting);
    expect(container.querySelector('a[href="/learn/mcp-clients-compared"]')?.classList).toContain('active');
    expect(container.querySelector('a[href="/learn"]')?.classList).not.toContain('active');
    expect(container.querySelector('a[href="/docs/what-is-mcp"]')?.textContent).toBe('What is MCP?');

    // Playground, catalog, and report links stay available for getting back to the app.
    expect(container.querySelector('a[href="/"]')).not.toBeNull();
    expect(container.querySelector('a[href="/catalog"]')).not.toBeNull();
    expect(container.querySelector('a[href="/report"]')).not.toBeNull();

    const docs = renderSideNav('docs', '/docs/troubleshooting');
    expect(docs.querySelector('.dashboard-list')).toBeNull();
    expect(docs.querySelector('a[href="/docs/troubleshooting"]')?.classList).toContain('active');
  });

  it('keeps dashboards and the generated resource hub on app views', () => {
    const container = renderSideNav('catalog', '/catalog');

    expect(
      Array.from(container.querySelectorAll('.sidenav-section-label'), (label) => label.textContent)
    ).toEqual(['Dashboards', 'Resources']);
    expect(container.textContent).toContain('Saved space');
    const hrefs = Array.from(container.querySelectorAll('.sidenav-content-section a'), link => link.getAttribute('href'));
    expect(hrefs).toEqual(['/docs/what-is-mcp', '/learn', '/docs/troubleshooting']);
    expect(container.querySelector('a[href="/learn"]')?.textContent).toContain('Guides & Tutorials');
    expect(container.querySelector('.content-track-nav')).toBeNull();
  });
});
