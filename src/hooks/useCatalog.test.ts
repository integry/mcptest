import React, { act } from 'react';
import { createRoot, type Root } from 'react-dom/client';
import {
  MemoryRouter,
  useLocation,
  useNavigate,
  type Location,
  type NavigateFunction,
} from 'react-router-dom';
import { afterEach, beforeAll, beforeEach, describe, expect, it, vi } from 'vitest';
import { CATALOG_CATEGORY_ALL } from '../types/catalog';
import { logEvent } from '../utils/analytics';
import {
  buildCatalogSearchParams,
  getCatalogFiltersFromParams,
  useCatalog,
} from './useCatalog';

vi.mock('../utils/analytics', () => ({
  logEvent: vi.fn(),
}));

const mockedLogEvent = vi.mocked(logEvent);

beforeAll(() => {
  (
    globalThis as typeof globalThis & { IS_REACT_ACT_ENVIRONMENT: boolean }
  ).IS_REACT_ACT_ENVIRONMENT = true;
});

const renderCatalogHook = (initialEntry = '/catalog') => {
  let catalog: ReturnType<typeof useCatalog> | undefined;
  let location: Location | undefined;
  let navigate: NavigateFunction | undefined;
  const container = document.createElement('div');
  const root: Root = createRoot(container);

  const Probe = () => {
    catalog = useCatalog();
    location = useLocation();
    navigate = useNavigate();

    return null;
  };

  act(() => {
    root.render(
      React.createElement(
        MemoryRouter,
        { initialEntries: [initialEntry] },
        React.createElement(Probe)
      )
    );
  });

  return {
    get catalog() {
      if (!catalog) {
        throw new Error('Catalog hook was not rendered');
      }

      return catalog;
    },
    get location() {
      if (!location) {
        throw new Error('Router location was not rendered');
      }

      return location;
    },
    navigate(to: number) {
      if (!navigate) {
        throw new Error('Catalog navigation was not rendered');
      }
      navigate(to);
    },
    unmount() {
      act(() => {
        root.unmount();
      });
    },
  };
};

describe('catalog query params', () => {
  const categories = ['Finance', 'Productivity'];

  beforeEach(() => {
    vi.useFakeTimers();
    mockedLogEvent.mockClear();
  });

  afterEach(() => {
    vi.clearAllTimers();
    vi.useRealTimers();
  });

  it('reads valid params and normalizes search text', () => {
    const filters = getCatalogFiltersFromParams(
      new URLSearchParams('q=%20crypto%20&auth=oauth&category=Finance&sort=name'),
      categories
    );

    expect(filters).toEqual({
      searchQuery: 'crypto',
      oauthFilter: 'oauth',
      category: 'Finance',
      sortOrder: 'name',
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
      sortOrder: 'catalog-order',
    });
  });

  it.each(['bearer-token', 'api-key'] as const)('accepts the %s auth filter', (auth) => {
    const filters = getCatalogFiltersFromParams(new URLSearchParams(`auth=${auth}`), categories);

    expect(filters.oauthFilter).toBe(auth);
    expect(buildCatalogSearchParams('', auth, CATALOG_CATEGORY_ALL).get('auth')).toBe(auth);
  });

  it('omits default values when building params', () => {
    const params = buildCatalogSearchParams('   ', 'all', CATALOG_CATEGORY_ALL);

    expect(params.toString()).toBe('');
  });

  it('trims search text and preserves non-default filters when building params', () => {
    const params = buildCatalogSearchParams(
      '  crypto tools  ',
      'no-auth',
      'Productivity',
      'recently-tested'
    );

    expect(params.get('q')).toBe('crypto tools');
    expect(params.get('auth')).toBe('no-auth');
    expect(params.get('category')).toBe('Productivity');
    expect(params.get('sort')).toBe('recently-tested');
  });

  it('cleans invalid URL params without logging search analytics', () => {
    const view = renderCatalogHook(
      '/catalog?q=%20crypto%20&auth=basic&category=DoesNotExist&sort=random&extra=1'
    );

    expect(view.catalog.searchQuery).toBe('crypto');
    expect(view.catalog.oauthFilter).toBe('all');
    expect(view.catalog.category).toBe(CATALOG_CATEGORY_ALL);
    expect(view.catalog.sortOrder).toBe('catalog-order');
    expect(view.location.search).toBe('?q=crypto');

    act(() => {
      vi.advanceTimersByTime(1000);
    });

    expect(mockedLogEvent).not.toHaveBeenCalled();
    view.unmount();
  });

  it('hydrates category, auth, and sort together and produces filtered name order', () => {
    const view = renderCatalogHook('/catalog?category=Finance&auth=no-auth&sort=name');

    expect(view.catalog.category).toBe('Finance');
    expect(view.catalog.oauthFilter).toBe('no-auth');
    expect(view.catalog.sortOrder).toBe('name');
    expect(view.catalog.filteredServers.map(({ name }) => name)).toEqual([
      'CoinGecko',
      'Yahoo Finance',
    ]);
    expect(view.location.search).toBe('?category=Finance&auth=no-auth&sort=name');
    expect(mockedLogEvent).not.toHaveBeenCalled();
    view.unmount();
  });

  it('logs sorting only for user changes and persists the non-default value', () => {
    const view = renderCatalogHook('/catalog?sort=name');

    expect(view.catalog.sortOrder).toBe('name');
    expect(mockedLogEvent).not.toHaveBeenCalled();

    act(() => {
      view.catalog.setSortOrder('browser-ready');
    });
    act(() => {
      vi.advanceTimersByTime(300);
    });

    expect(view.location.search).toBe('?sort=browser-ready');
    expect(mockedLogEvent).toHaveBeenCalledWith('catalog_sort', {
      sort: 'browser-ready',
    });
    view.unmount();
  });

  it('pushes category changes so browser back and forward restore selection', () => {
    const view = renderCatalogHook();

    act(() => {
      view.catalog.setCategory('Finance');
    });
    act(() => {
      vi.advanceTimersByTime(300);
    });
    expect(view.location.search).toBe('?category=Finance');

    act(() => view.navigate(-1));
    expect(view.location.search).toBe('');
    expect(view.catalog.category).toBe(CATALOG_CATEGORY_ALL);

    act(() => view.navigate(1));
    expect(view.location.search).toBe('?category=Finance');
    expect(view.catalog.category).toBe('Finance');
    view.unmount();
  });

  it('logs search analytics only for user-entered non-empty searches', () => {
    const view = renderCatalogHook();

    act(() => {
      view.catalog.setSearchQuery('  crypto  ');
    });

    expect(mockedLogEvent).not.toHaveBeenCalled();

    act(() => {
      vi.advanceTimersByTime(500);
    });

    expect(view.location.search).toBe('?q=crypto');
    expect(mockedLogEvent).toHaveBeenCalledTimes(1);
    expect(mockedLogEvent).toHaveBeenLastCalledWith('catalog_search', {
      query_length: 6,
    });

    act(() => {
      view.catalog.setSearchQuery('');
    });

    act(() => {
      vi.advanceTimersByTime(500);
    });

    expect(view.location.search).toBe('');
    expect(mockedLogEvent).toHaveBeenCalledTimes(1);

    act(() => {
      view.catalog.setSearchQuery('crypto');
      vi.advanceTimersByTime(500);
    });

    expect(mockedLogEvent).toHaveBeenCalledTimes(2);
    expect(mockedLogEvent).toHaveBeenLastCalledWith('catalog_search', {
      query_length: 6,
    });
    view.unmount();
  });
});
