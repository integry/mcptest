import { describe, expect, it } from 'vitest';
import { CATALOG_CATEGORY_ALL } from '../types/catalog';
import {
  buildCatalogSearchParams,
  getCatalogFiltersFromParams,
} from './useCatalog';

describe('catalog query params', () => {
  const categories = ['Finance', 'Productivity'];

  it('reads valid params and normalizes search text', () => {
    const filters = getCatalogFiltersFromParams(
      new URLSearchParams('q=%20crypto%20&auth=oauth&category=Finance'),
      categories
    );

    expect(filters).toEqual({
      searchQuery: 'crypto',
      oauthFilter: 'oauth',
      category: 'Finance',
    });
  });

  it('falls back to defaults for invalid auth and category params', () => {
    const filters = getCatalogFiltersFromParams(
      new URLSearchParams('q=agent&auth=basic&category=DoesNotExist'),
      categories
    );

    expect(filters).toEqual({
      searchQuery: 'agent',
      oauthFilter: 'all',
      category: CATALOG_CATEGORY_ALL,
    });
  });

  it('omits default values when building params', () => {
    const params = buildCatalogSearchParams('   ', 'all', CATALOG_CATEGORY_ALL);

    expect(params.toString()).toBe('');
  });

  it('trims search text and preserves non-default filters when building params', () => {
    const params = buildCatalogSearchParams('  crypto tools  ', 'no-auth', 'Productivity');

    expect(params.get('q')).toBe('crypto tools');
    expect(params.get('auth')).toBe('no-auth');
    expect(params.get('category')).toBe('Productivity');
  });
});
