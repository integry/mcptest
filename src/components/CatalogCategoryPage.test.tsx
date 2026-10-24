import React, { act } from 'react';
import { createRoot, type Root } from 'react-dom/client';
import { MemoryRouter, useLocation, type Location } from 'react-router-dom';
import { afterEach, beforeAll, describe, expect, it, vi } from 'vitest';
import CatalogView from './CatalogView';
import { getCatalogServers } from '../utils/catalogUtils';
import {
  getCatalogCategoryIntro,
  getCatalogCategoryNames,
  getCatalogCategoryNeighbors,
  summarizeCatalogCategory,
} from '../utils/catalogCategories';
import { CATEGORY_GUIDES } from '../content/categoryGuides';
import { getLearnArticle } from '../content/learnRegistry';

vi.mock('../utils/analytics', () => ({ trackEvent: vi.fn() }));

beforeAll(() => {
  (globalThis as typeof globalThis & { IS_REACT_ACT_ENVIRONMENT: boolean }).IS_REACT_ACT_ENVIRONMENT = true;
});

const servers = getCatalogServers();
const categories = getCatalogCategoryNames(servers);
let root: Root | undefined;

const renderAt = (path: string) => {
  const container = document.createElement('div');
  document.body.appendChild(container);
  const state: { location?: Location } = {};
  const Probe = () => {
    state.location = useLocation();
    return null;
  };
  root = createRoot(container);
  act(() => {
    root!.render(
      <MemoryRouter initialEntries={[path]}>
        <CatalogView onTestServer={vi.fn()} />
        <Probe />
      </MemoryRouter>
    );
  });
  return { container, state };
};

afterEach(() => {
  act(() => root?.unmount());
  root = undefined;
  document.body.innerHTML = '';
});

describe('catalog category pages', () => {
  it('renders the Databases page with its generated intro, counts, rows, guides and neighbors', () => {
    const summary = summarizeCatalogCategory(servers, 'Databases');
    const { container } = renderAt('/catalog/databases');

    expect(container.querySelector('h1')?.textContent).toBe('Databases MCP servers');
    expect(container.querySelector('.catalog-category-breadcrumb a')?.getAttribute('href')).toBe('/catalog');
    expect(container.querySelector('.catalog-category-intro')?.textContent).toBe(
      getCatalogCategoryIntro(summary).join(' ')
    );
    expect(container.querySelectorAll('li.catalog-server-list-item')).toHaveLength(summary.count);
    expect(container.querySelector('.catalog-results-count')?.textContent).toBe(
      `Showing ${summary.count} of ${summary.count} Databases servers`
    );

    const summaryText = container.querySelector('.catalog-category-summary')?.textContent ?? '';
    for (const { label, count } of [...summary.auth, ...summary.transport]) {
      expect(summaryText).toContain(`${label} ${count}`);
    }

    const guideLinks = [...container.querySelectorAll<HTMLAnchorElement>('.catalog-category-guides a')];
    expect(guideLinks.map((link) => link.getAttribute('href'))).toEqual(
      CATEGORY_GUIDES.Databases.map((slug) => getLearnArticle(slug)?.path)
    );
    expect(guideLinks.map((link) => link.getAttribute('href'))).toContain('/learn/convert-local-stdio-mcp-server-to-remote');

    const { previous, next } = getCatalogCategoryNeighbors(categories, 'Databases');
    const neighbors = container.querySelector('.catalog-category-neighbors');
    expect(neighbors?.querySelector('a[rel="prev"]')?.textContent?.trim()).toBe(previous);
    expect(neighbors?.querySelector('a[rel="next"]')?.textContent?.trim()).toBe(next);

    const current = container.querySelector('.catalog-category-rail [aria-current="page"]');
    expect(current?.textContent).toContain('Databases');
  });

  it('counts every category page once with the right number of rows', () => {
    for (const category of categories) {
      const summary = summarizeCatalogCategory(servers, category);
      const { container } = renderAt(summary.path);
      expect(container.querySelectorAll('li.catalog-server-list-item'), category).toHaveLength(
        servers.filter((server) => server.category === category).length
      );
      act(() => root?.unmount());
      root = undefined;
    }
  });

  it('links the /catalog category list and row badges to category pages', () => {
    const { container, state } = renderAt('/catalog?sort=name');
    const rail = [...container.querySelectorAll<HTMLAnchorElement>('.catalog-category-rail a')];

    expect(rail.map((link) => link.getAttribute('href'))).toEqual([
      '/catalog?sort=name',
      ...categories.map((category) => `${summarizeCatalogCategory(servers, category).path}?sort=name`),
    ]);
    const badge = container.querySelector<HTMLAnchorElement>('a.catalog-metadata-badge--category');
    expect(badge?.getAttribute('href')).toMatch(/^\/catalog\/[a-z0-9-]+\?sort=name$/);

    act(() => {
      rail.find((link) => link.textContent?.startsWith('Finance'))?.click();
    });
    expect(state.location?.pathname).toBe('/catalog/finance');
    expect(state.location?.search).toBe('?sort=name');
    expect(container.querySelector('h1')?.textContent).toBe('Finance MCP servers');
  });

  it('navigates from the category select on small screens', () => {
    const { container, state } = renderAt('/catalog');
    const select = container.querySelector<HTMLSelectElement>('.catalog-category-field select')!;

    act(() => {
      const setter = Object.getOwnPropertyDescriptor(HTMLSelectElement.prototype, 'value')!.set!;
      setter.call(select, 'Search');
      select.dispatchEvent(new Event('change', { bubbles: true }));
    });

    expect(state.location?.pathname).toBe('/catalog/search');
  });

  it('shows a not-found state for an unknown category slug', () => {
    const { container } = renderAt('/catalog/not-a-category');

    expect(container.querySelector('h1')?.textContent).toBe('Catalog category not found');
    expect(container.querySelector('.catalog-empty-state a')?.getAttribute('href')).toBe('/catalog');
    expect(container.querySelector('.catalog-server-list')).toBeNull();
  });

  it('maps every catalog category to guides that exist', () => {
    for (const category of categories) {
      const slugs = CATEGORY_GUIDES[category];
      expect(slugs, `${category} has no row in categoryGuides.ts`).toBeDefined();
      for (const slug of slugs) expect(getLearnArticle(slug), `${category}: ${slug}`).toBeDefined();
    }
  });
});
