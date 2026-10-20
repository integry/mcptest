import React, { act } from 'react';
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
import { readStylesheet } from '../styles/readStylesheet';

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
    expect(sortSelect?.selectedOptions[0]?.textContent).toBe('Sort: Name');
    expect(sortSelect?.labels[0]?.textContent).toBe('Sort');
    expect(sortSelect?.labels[0]?.classList).toContain('visually-hidden');

    const categoryRail = container.querySelector<HTMLElement>('.catalog-category-rail');
    expect(categoryRail?.getAttribute('aria-label')).toBe('Catalog categories');
    expect(categoryRail?.querySelectorAll('button')).toHaveLength(2);

    act(() => {
      root.unmount();
    });
  });

  it('renders servers as one dense list of rows instead of a card grid', () => {
    catalogMocks.filteredServers = [{ id: 'example' }, { id: 'example-2' }];
    const container = document.createElement('div');
    const root = createRoot(container);

    act(() => {
      root.render(<CatalogView onTestServer={vi.fn()} />);
    });

    const list = container.querySelector<HTMLElement>('ul.catalog-server-list');
    const rows = container.querySelectorAll('li.catalog-server-list-item');
    const catalogCss = readStylesheet();

    expect(list?.getAttribute('aria-label')).toBe('Catalog servers');
    expect(rows).toHaveLength(2);
    expect(container.querySelector('.row.g-3, .catalog-result-column, .catalog-server-card')).toBeNull();
    expect(catalogCss).not.toMatch(/\.catalog-result-column/);
    expect(catalogCss).toMatch(/\.catalog-server-list\s*\{[^}]*border-top:\s*1px solid var\(--border-color\);/);

    act(() => {
      root.unmount();
    });
  });

  it('keeps catalog actions visually light and aligns the outline action to the right', () => {
    const catalogCss = readStylesheet();
    const actionRule = catalogCss.match(/\.catalog-card-actions\s*\{([^}]*)\}/)?.[1] ?? '';
    const reportRule = catalogCss.match(/\.catalog-report-link\s*\{([^}]*)\}/)?.[1] ?? '';
    const reportHoverRule =
      catalogCss.match(/\.catalog-report-link:hover\s*\{([^}]*)\}/)?.[1] ?? '';
    const testRule =
      catalogCss.match(/\.catalog-test-button\.btn-outline-primary\s*\{([^}]*)\}/)?.[1] ?? '';

    expect(actionRule).toMatch(/justify-content:\s*space-between;/);
    expect(actionRule).toMatch(/flex-wrap:\s*wrap;/);
    expect(reportRule).toMatch(/color:\s*var\(--catalog-secondary-text\);/);
    expect(reportRule).toMatch(/font-weight:\s*500;/);
    expect(reportRule).toMatch(/text-decoration:\s*none;/);
    expect(reportRule).not.toMatch(/flex:/);
    expect(reportHoverRule).toMatch(/text-decoration:\s*underline;/);
    expect(reportHoverRule).toMatch(/color:\s*var\(--primary-color\);/);
    expect(testRule).toMatch(/margin-left:\s*auto;/);
    expect(testRule).not.toMatch(/flex:/);
  });

  it('uses the stronger brand color and medium weight for an active category', () => {
    const catalogCss = readStylesheet();
    const activeCategoryRule = catalogCss.match(
      /\.catalog-category-option\[aria-pressed='true'\]\s*\{([^}]*)\}/
    )?.[1] ?? '';

    expect(activeCategoryRule).toMatch(/color:\s*var\(--primary-hover\);/);
    expect(activeCategoryRule).toMatch(/font-weight:\s*500;/);
  });

  it('folds the three selects into a Filters disclosure that counts the active filters', () => {
    const container = document.createElement('div');
    const root = createRoot(container);

    act(() => {
      root.render(<CatalogView onTestServer={vi.fn()} />);
    });

    const filters = container.querySelector<HTMLElement>('.catalog-filters')!;
    const toggle = filters.querySelector<HTMLButtonElement>('.catalog-filters-toggle')!;
    const fields = filters.querySelector<HTMLElement>('.catalog-filter-fields')!;

    // Search stays first and outside the disclosure.
    expect(filters.firstElementChild?.classList).toContain('catalog-search-field');
    expect(fields.contains(filters.querySelector('.catalog-search-field'))).toBe(false);
    expect(fields.querySelectorAll('select')).toHaveLength(3);
    expect(toggle.textContent).toContain('Filters');
    // Mocked state: auth "oauth", category "Developer tools", sort "name" are all non-default.
    expect(toggle.querySelector('.catalog-filters-count')?.textContent).toBe('3');
    expect(fields.dataset.activeFilters).toBe('3');
    expect(toggle.getAttribute('aria-expanded')).toBe('false');
    expect(toggle.getAttribute('aria-controls')).toBe(fields.id);
    expect(fields.classList).not.toContain('is-open');

    act(() => {
      toggle.click();
    });

    expect(toggle.getAttribute('aria-expanded')).toBe('true');
    expect(fields.classList).toContain('is-open');

    // Desktop keeps the grid: the wrapper is transparent and the toggle hidden until the phone breakpoint.
    const catalogCss = readStylesheet();
    expect(catalogCss).toMatch(/\.catalog-filter-fields\s*\{\s*display:\s*contents;\s*\}/);
    expect(catalogCss).toMatch(/\.catalog-filters-toggle\s*\{\s*display:\s*none;\s*\}/);
    const phone = catalogCss.slice(catalogCss.indexOf('@media (max-width: 768px)'));
    expect(phone).toMatch(/\.catalog-filters-toggle\s*\{[^}]*display:\s*flex;[^}]*min-height:\s*2\.75rem;/);
    expect(phone).toMatch(/\.catalog-filter-fields\s*\{\s*display:\s*none;\s*\}/);
    expect(phone).toMatch(/\.catalog-filter-fields\.is-open\s*\{[^}]*display:\s*grid;/);

    act(() => {
      root.unmount();
    });
  });
});
