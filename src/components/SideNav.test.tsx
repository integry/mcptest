import React from 'react';
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { renderToStaticMarkup } from 'react-dom/server';
import { MemoryRouter } from 'react-router-dom';
import { describe, expect, it, vi } from 'vitest';
import SideNav from './SideNav';

vi.mock('../context/AuthContext', () => ({
  useAuth: () => ({
    currentUser: null,
    loginWithGoogle: vi.fn(),
    logout: vi.fn(),
  }),
}));

describe('SideNav dashboard rows', () => {
  it('keeps the card count beside a flexible, truncatable dashboard name', () => {
    const sidebarCss = readFileSync(resolve('src/index.css'), 'utf8');
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
    const sidebarCss = readFileSync(resolve('src/index.css'), 'utf8');
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
    ).toEqual(['Dashboards', 'Documentation', 'Learn']);
    expect(sidebarCss).not.toMatch(/text-transform:\s*uppercase/i);

    const sectionRuleStart = sidebarCss.indexOf('.sidenav-section-label {');
    const sectionRuleEnd = sidebarCss.indexOf('}', sectionRuleStart);
    const sectionRule = sidebarCss.slice(sectionRuleStart, sectionRuleEnd);
    expect(sectionRule).toMatch(/font-size:\s*0\.95rem/);
    expect(sectionRule).toMatch(/letter-spacing:\s*0/);

    const labelSelectors = [
      '.server-signal-label',
      '.server-endpoint-box span',
      '.catalog-filters .form-label',
      '.docs-toc-title',
      '.first-connection-eyebrow',
    ];

    labelSelectors.forEach((selector) => {
      const ruleStart = sidebarCss.indexOf(`${selector} {`);
      const ruleEnd = sidebarCss.indexOf('}', ruleStart);
      const rule = sidebarCss.slice(ruleStart, ruleEnd);

      expect(ruleStart, `${selector} should have a style rule`).toBeGreaterThan(-1);
      expect(rule).toMatch(/font-size:\s*0\.8(?:2)?rem/);
      expect(rule).toMatch(/letter-spacing:\s*0/);
    });
  });

  it('renders registry-driven Documentation and Learn navigation', () => {
    const markup = renderToStaticMarkup(
      <MemoryRouter initialEntries={['/learn/mcp-clients-compared']}>
        <SideNav
          activeView="learn"
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

    const hrefs = Array.from(container.querySelectorAll('a'), link => link.getAttribute('href'));
    expect(hrefs).toEqual(expect.arrayContaining([
      '/docs/what-is-mcp',
      '/docs/remote-vs-local',
      '/docs/testing-guide',
      '/docs/troubleshooting',
      '/learn',
      '/learn/mcp-clients-compared',
      '/learn/connect-remote-mcp-server',
      '/learn/oauth-for-mcp-explained',
      '/learn/should-you-build-mcp-server',
      '/learn/designing-production-mcp-server',
      '/learn/mcp-server-trust-checklist',
    ]));
    expect(container.querySelector('a[href="/learn/mcp-clients-compared"]')?.classList).toContain('active');
  });
});
