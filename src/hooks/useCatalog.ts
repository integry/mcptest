import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { useLocation, useSearchParams } from 'react-router-dom';
import { CATALOG_CATEGORY_ALL, type OAuthFilter } from '../types/catalog';
import {
  filterCatalogServers,
  getCatalogCategories,
  getCatalogServers,
} from '../utils/catalogUtils';
import { logEvent } from '../utils/analytics';

const isOAuthFilter = (value: string | null): value is OAuthFilter => {
  return value === 'all' || value === 'oauth' || value === 'no-auth';
};

const normalizeSearchQuery = (searchQuery: string) => searchQuery.trim();
const DEFAULT_CATALOG_FILTERS = {
  searchQuery: '',
  oauthFilter: 'all' as OAuthFilter,
  category: CATALOG_CATEGORY_ALL,
};
const SEARCH_ANALYTICS_DEBOUNCE_MS = 500;
const SEARCH_PARAM_SYNC_DEBOUNCE_MS = 300;

const getOAuthFilterFromParams = (params: URLSearchParams): OAuthFilter => {
  const authParam = params.get('auth');
  return isOAuthFilter(authParam) ? authParam : 'all';
};

const getCategoryFromParams = (params: URLSearchParams, categories: string[]) => {
  const categoryParam = params.get('category');

  if (!categoryParam || categoryParam === CATALOG_CATEGORY_ALL) {
    return CATALOG_CATEGORY_ALL;
  }

  return categories.includes(categoryParam) ? categoryParam : CATALOG_CATEGORY_ALL;
};

export const getCatalogFiltersFromParams = (
  params: URLSearchParams,
  categories: string[] = []
) => {
  return {
    searchQuery: normalizeSearchQuery(params.get('q') ?? ''),
    oauthFilter: getOAuthFilterFromParams(params),
    category: getCategoryFromParams(params, categories),
  };
};

export const buildCatalogSearchParams = (
  searchQuery: string,
  oauthFilter: OAuthFilter,
  category: string
) => {
  const params = new URLSearchParams();
  const normalizedQuery = normalizeSearchQuery(searchQuery);

  if (normalizedQuery) {
    params.set('q', normalizedQuery);
  }

  if (oauthFilter !== 'all') {
    params.set('auth', oauthFilter);
  }

  if (category !== CATALOG_CATEGORY_ALL) {
    params.set('category', category);
  }

  return params;
};

const isCatalogRoute = (pathname: string) => {
  return pathname === '/catalog';
};

const getCanonicalParamsString = (params: URLSearchParams) => {
  return Array.from(params.entries())
    .sort(([keyA, valueA], [keyB, valueB]) => {
      const keyComparison = keyA.localeCompare(keyB);
      return keyComparison === 0 ? valueA.localeCompare(valueB) : keyComparison;
    })
    .map(([key, value]) => `${encodeURIComponent(key)}=${encodeURIComponent(value)}`)
    .join('&');
};

const catalogParamsMatch = (currentParams: URLSearchParams, nextParams: URLSearchParams) => {
  return getCanonicalParamsString(currentParams) === getCanonicalParamsString(nextParams);
};

export const useCatalog = () => {
  const location = useLocation();
  const [searchParams, setSearchParams] = useSearchParams();
  const [allServers] = useState(() => getCatalogServers());
  const [categories] = useState(() => getCatalogCategories(allServers));
  const [initialFilters] = useState(() =>
    isCatalogRoute(location.pathname)
      ? getCatalogFiltersFromParams(searchParams, categories)
      : DEFAULT_CATALOG_FILTERS
  );
  const [searchQuery, setSearchQueryState] = useState(initialFilters.searchQuery);
  const [oauthFilter, setOauthFilterState] = useState<OAuthFilter>(initialFilters.oauthFilter);
  const [category, setCategoryState] = useState(initialFilters.category);
  const lastLoggedSearchQueryRef = useRef(initialFilters.searchQuery);
  const searchParamSyncTimeoutRef = useRef<number | null>(null);
  const onCatalogRoute = isCatalogRoute(location.pathname);

  const clearPendingSearchParamSync = useCallback(() => {
    if (searchParamSyncTimeoutRef.current === null) {
      return;
    }

    window.clearTimeout(searchParamSyncTimeoutRef.current);
    searchParamSyncTimeoutRef.current = null;
  }, []);

  const syncCatalogParams = useCallback(
    (nextSearchQuery: string, nextOauthFilter: OAuthFilter, nextCategory: string) => {
      if (!onCatalogRoute) {
        return;
      }

      const nextParams = buildCatalogSearchParams(
        nextSearchQuery,
        nextOauthFilter,
        nextCategory
      );

      if (!catalogParamsMatch(searchParams, nextParams)) {
        setSearchParams(nextParams, { replace: true });
      }
    },
    [onCatalogRoute, searchParams, setSearchParams]
  );

  useEffect(() => {
    if (!onCatalogRoute) {
      return;
    }

    const nextFilters = getCatalogFiltersFromParams(searchParams, categories);

    setSearchQueryState((current) => {
      const currentNormalized = normalizeSearchQuery(current);
      return currentNormalized === nextFilters.searchQuery ? current : nextFilters.searchQuery;
    });
    setOauthFilterState((current) =>
      current === nextFilters.oauthFilter ? current : nextFilters.oauthFilter
    );
    setCategoryState((current) =>
      current === nextFilters.category ? current : nextFilters.category
    );

    const normalizedParams = buildCatalogSearchParams(
      nextFilters.searchQuery,
      nextFilters.oauthFilter,
      nextFilters.category
    );

    if (!catalogParamsMatch(searchParams, normalizedParams)) {
      setSearchParams(normalizedParams, { replace: true });
    }
  }, [categories, onCatalogRoute, searchParams, setSearchParams]);

  const setSearchQuery = useCallback(
    (nextSearchQuery: string) => {
      setSearchQueryState((current) =>
        current === nextSearchQuery ? current : nextSearchQuery
      );
    },
    []
  );

  useEffect(() => {
    if (!onCatalogRoute) {
      return;
    }

    clearPendingSearchParamSync();

    const timeoutId = window.setTimeout(() => {
      searchParamSyncTimeoutRef.current = null;
      syncCatalogParams(searchQuery, oauthFilter, category);
    }, SEARCH_PARAM_SYNC_DEBOUNCE_MS);

    searchParamSyncTimeoutRef.current = timeoutId;

    return () => {
      if (searchParamSyncTimeoutRef.current === timeoutId) {
        clearPendingSearchParamSync();
      }
    };
  }, [
    category,
    clearPendingSearchParamSync,
    oauthFilter,
    onCatalogRoute,
    searchQuery,
    syncCatalogParams,
  ]);

  useEffect(() => {
    const normalizedQuery = normalizeSearchQuery(searchQuery);

    if (normalizedQuery === lastLoggedSearchQueryRef.current) {
      return;
    }

    const timeoutId = window.setTimeout(() => {
      lastLoggedSearchQueryRef.current = normalizedQuery;
      logEvent('catalog_search', { query_length: normalizedQuery.length });
    }, SEARCH_ANALYTICS_DEBOUNCE_MS);

    return () => window.clearTimeout(timeoutId);
  }, [searchQuery]);

  const setOauthFilter = useCallback(
    (nextOauthFilter: OAuthFilter) => {
      if (nextOauthFilter === oauthFilter) {
        return;
      }

      clearPendingSearchParamSync();
      setOauthFilterState(nextOauthFilter);
      syncCatalogParams(searchQuery, nextOauthFilter, category);
      logEvent('catalog_filter_oauth', { filter: nextOauthFilter });
    },
    [category, clearPendingSearchParamSync, oauthFilter, searchQuery, syncCatalogParams]
  );

  const setCategory = useCallback(
    (nextCategory: string) => {
      if (nextCategory === category) {
        return;
      }

      clearPendingSearchParamSync();
      setCategoryState(nextCategory);
      syncCatalogParams(searchQuery, oauthFilter, nextCategory);
      logEvent('catalog_filter_category', { category: nextCategory });
    },
    [category, clearPendingSearchParamSync, oauthFilter, searchQuery, syncCatalogParams]
  );

  const filteredServers = useMemo(() => {
    return filterCatalogServers(allServers, {
      query: normalizeSearchQuery(searchQuery),
      category,
      oauthFilter,
    });
  }, [allServers, searchQuery, category, oauthFilter]);

  return {
    allServers,
    filteredServers,
    categories,
    searchQuery,
    setSearchQuery,
    oauthFilter,
    setOauthFilter,
    category,
    setCategory,
  };
};
