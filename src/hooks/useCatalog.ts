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
const CATALOG_PARAM_KEYS = ['q', 'auth', 'category'];

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

const catalogParamsMatch = (currentParams: URLSearchParams, nextParams: URLSearchParams) => {
  const currentKeys = Array.from(currentParams.keys());
  const nextKeys = Array.from(nextParams.keys());

  return (
    currentKeys.length === nextKeys.length &&
    CATALOG_PARAM_KEYS.every((key) => currentParams.get(key) === nextParams.get(key))
  );
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
  const lastLoggedSearchQueryRef = useRef(normalizeSearchQuery(initialFilters.searchQuery));
  const searchAnalyticsTimeoutRef = useRef<number | null>(null);
  const searchParamSyncTimeoutRef = useRef<number | null>(null);
  const onCatalogRoute = isCatalogRoute(location.pathname);
  const normalizedSearchQuery = useMemo(
    () => normalizeSearchQuery(searchQuery),
    [searchQuery]
  );

  const clearPendingSearchParamSync = useCallback(() => {
    if (searchParamSyncTimeoutRef.current === null) {
      return;
    }

    window.clearTimeout(searchParamSyncTimeoutRef.current);
    searchParamSyncTimeoutRef.current = null;
  }, []);

  const clearPendingSearchAnalytics = useCallback(() => {
    if (searchAnalyticsTimeoutRef.current === null) {
      return;
    }

    window.clearTimeout(searchAnalyticsTimeoutRef.current);
    searchAnalyticsTimeoutRef.current = null;
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

      const normalizedNextQuery = normalizeSearchQuery(nextSearchQuery);
      clearPendingSearchAnalytics();

      if (normalizedNextQuery === lastLoggedSearchQueryRef.current) {
        return;
      }

      if (!normalizedNextQuery) {
        lastLoggedSearchQueryRef.current = '';
        return;
      }

      const timeoutId = window.setTimeout(() => {
        searchAnalyticsTimeoutRef.current = null;
        lastLoggedSearchQueryRef.current = normalizedNextQuery;
        logEvent('catalog_search', { query_length: normalizedNextQuery.length });
      }, SEARCH_ANALYTICS_DEBOUNCE_MS);

      searchAnalyticsTimeoutRef.current = timeoutId;
    },
    [clearPendingSearchAnalytics]
  );

  useEffect(() => {
    if (!onCatalogRoute) {
      return;
    }

    clearPendingSearchParamSync();

    const timeoutId = window.setTimeout(() => {
      searchParamSyncTimeoutRef.current = null;
      syncCatalogParams(normalizedSearchQuery, oauthFilter, category);
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
    normalizedSearchQuery,
    oauthFilter,
    onCatalogRoute,
    syncCatalogParams,
  ]);

  useEffect(() => {
    return () => {
      clearPendingSearchAnalytics();
    };
  }, [clearPendingSearchAnalytics]);

  const setOauthFilter = useCallback(
    (nextOauthFilter: OAuthFilter) => {
      if (nextOauthFilter === oauthFilter) {
        return;
      }

      setOauthFilterState(nextOauthFilter);
      logEvent('catalog_filter_oauth', { filter: nextOauthFilter });
    },
    [oauthFilter]
  );

  const setCategory = useCallback(
    (nextCategory: string) => {
      if (nextCategory === category) {
        return;
      }

      setCategoryState(nextCategory);
      logEvent('catalog_filter_category', { category: nextCategory });
    },
    [category]
  );

  const filteredServers = useMemo(() => {
    return filterCatalogServers(allServers, {
      query: normalizedSearchQuery,
      category,
      oauthFilter,
    });
  }, [allServers, normalizedSearchQuery, category, oauthFilter]);

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
