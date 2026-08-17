import React, { act } from 'react';
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { createRoot } from 'react-dom/client';
import { beforeAll, beforeEach, describe, expect, it, vi } from 'vitest';

const catalogMocks = vi.hoisted(() => ({
  filteredServers: [] as Array<{ id: string }>,
  setSearchQuery: vi.fn(),
  setOauthFilter: vi.fn(),
  setCategory: vi.fn(),
  setSortOrder: vi.fn(),
}));

vi.mock('../hooks/useCatalog', () => ({
  useCatalog: () => ({
    allServers: [{ id: 'example' }],
    filteredServers: catalogMocks.filteredServers,
    categories: ['Developer tools'],
    categoryCounts: {
      all: 0,
      categories: [{ category: 'Developer tools', count: 0 }],
    },
    searchQuery: 'ASDFASDF',
    setSearchQuery: catalogMocks.setSearchQuery,
    oauthFilter: 'oauth',
    setOauthFilter: catalogMocks.setOauthFilter,
    category: 'Developer tools',
    setCategory: catalogMocks.setCategory,
    sortOrder: 'name',
    setSortOrder: catalogMocks.setSortOrder,
  }),
}));

vi.mock('./CatalogServerCard', () => ({
  default: () => null,
}));

import CatalogView from './CatalogView';

beforeAll(() => {
  (
    globalThis as typeof globalThis & { IS_REACT_ACT_ENVIRONMENT: boolean }
  ).IS_REACT_ACT_ENVIRONMENT = true;
});

describe('CatalogView', () => {
  beforeEach(() => {
    catalogMocks.filteredServers = [];
    vi.clearAllMocks();
  });

  it('anchors the search field with an icon and offers to clear every filter', () => {
    const container = document.createElement('div');
    const root = createRoot(container);

    act(() => {
      root.render(<CatalogView onTestServer={vi.fn()} />);
    });

    const searchIcon = container.querySelector('.catalog-search-field .catalog-search-icon');
    const emptyState = container.querySelector('.catalog-empty-state');
    const clearButton = emptyState?.querySelector<HTMLButtonElement>('button');

    expect(searchIcon?.classList).toContain('bi-search');
    expect(searchIcon?.getAttribute('aria-hidden')).toBe('true');
    expect(emptyState?.querySelector('h3')?.textContent).toContain(
      'No servers found matching your criteria'
    );
    expect(clearButton?.textContent).toContain('Clear all filters');

    act(() => {
      clearButton?.click();
    });

    expect(catalogMocks.setSearchQuery).toHaveBeenCalledWith('');
    expect(catalogMocks.setOauthFilter).toHaveBeenCalledWith('all');
    expect(catalogMocks.setCategory).toHaveBeenCalledWith('all');
    expect(catalogMocks.setSortOrder).toHaveBeenCalledWith('catalog-order');

    const sortSelect = container.querySelector<HTMLSelectElement>('.catalog-sort-field select');
    expect(sortSelect?.value).toBe('name');
    expect(sortSelect?.labels[0]?.textContent).toBe('Sort');

    const categoryRail = container.querySelector<HTMLElement>('.catalog-category-rail');
    expect(categoryRail?.getAttribute('aria-label')).toBe('Catalog categories');
    expect(categoryRail?.querySelectorAll('button')).toHaveLength(2);

    act(() => {
      root.unmount();
    });
  });

  it('keeps cards in two columns at the 1440px sidebar-visible desktop width', () => {
    catalogMocks.filteredServers = [{ id: 'example' }];
    const container = document.createElement('div');
    const root = createRoot(container);

    act(() => {
      root.render(<CatalogView onTestServer={vi.fn()} />);
    });

    const resultColumn = container.querySelector<HTMLElement>('.catalog-result-column');
    const catalogCss = readFileSync(resolve('src/index.css'), 'utf8');
    const wideDesktopRule = catalogCss.match(
      /@media \(min-width: (\d+)px\) \{\s*\.catalog-result-column \{\s*width: 33\.33333333%;/
    );

    expect(resultColumn?.classList).toContain('col-md-6');
    expect(resultColumn?.classList).not.toContain('col-xl-4');
    expect(Number(wideDesktopRule?.[1])).toBeGreaterThan(1440);

    act(() => {
      root.unmount();
    });
  });
});
