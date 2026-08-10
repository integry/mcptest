import React, { act } from 'react';
import { createRoot } from 'react-dom/client';
import { beforeAll, beforeEach, describe, expect, it, vi } from 'vitest';

const catalogMocks = vi.hoisted(() => ({
  setSearchQuery: vi.fn(),
  setOauthFilter: vi.fn(),
  setCategory: vi.fn(),
}));

vi.mock('../hooks/useCatalog', () => ({
  useCatalog: () => ({
    allServers: [{ id: 'example' }],
    filteredServers: [],
    categories: ['Developer tools'],
    searchQuery: 'ASDFASDF',
    setSearchQuery: catalogMocks.setSearchQuery,
    oauthFilter: 'oauth',
    setOauthFilter: catalogMocks.setOauthFilter,
    category: 'Developer tools',
    setCategory: catalogMocks.setCategory,
  }),
}));

import CatalogView from './CatalogView';

beforeAll(() => {
  (
    globalThis as typeof globalThis & { IS_REACT_ACT_ENVIRONMENT: boolean }
  ).IS_REACT_ACT_ENVIRONMENT = true;
});

describe('CatalogView empty state', () => {
  beforeEach(() => {
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

    act(() => {
      root.unmount();
    });
  });
});
