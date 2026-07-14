import React, { act } from 'react';
import { createRoot, type Root } from 'react-dom/client';
import { MemoryRouter, useLocation, type Location } from 'react-router-dom';
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
  const container = document.createElement('div');
  const root: Root = createRoot(container);

  const Probe = () => {
    catalog = useCatalog();
    location = useLocation();

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

  it('cleans invalid URL params without logging search analytics', () => {
    const view = renderCatalogHook(
      '/catalog?q=%20crypto%20&auth=basic&category=DoesNotExist&extra=1'
    );

    expect(view.catalog.searchQuery).toBe('crypto');
    expect(view.catalog.oauthFilter).toBe('all');
    expect(view.catalog.category).toBe(CATALOG_CATEGORY_ALL);
    expect(view.location.search).toBe('?q=crypto');

    act(() => {
      vi.advanceTimersByTime(1000);
    });

    expect(mockedLogEvent).not.toHaveBeenCalled();
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
