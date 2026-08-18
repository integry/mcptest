import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { useLocation, useSearchParams } from 'react-router-dom';
import {
  CATALOG_CATEGORY_ALL,
  type CatalogSortOrder,
  type OAuthFilter,
} from '../types/catalog';
import {
  filterCatalogServers,
  getCatalogCategoryCounts,
  getCatalogCategories,
  getCatalogServers,
  sortCatalogServers,
} from '../utils/catalogUtils';
import { logEvent } from '../utils/analytics';

const isOAuthFilter = (value: string | null): value is OAuthFilter => {
  return (
    value === 'all' ||
    value === 'oauth' ||
    value === 'bearer-token' ||
    value === 'api-token' ||
    value === 'api-key' ||
    value === 'no-auth'
  );
};

const normalizeSearchQuery = (searchQuery: string) => searchQuery.trim();
const isCatalogSortOrder = (value: string | null): value is CatalogSortOrder => {
  return (
    value === 'catalog-order' ||
    value === 'name' ||
    value === 'recently-tested' ||
    value === 'browser-ready'
  );
};

const DEFAULT_CATALOG_FILTERS = {
  searchQuery: '',
  oauthFilter: 'all' as OAuthFilter,
  category: CATALOG_CATEGORY_ALL,
  sortOrder: 'catalog-order' as CatalogSortOrder,
};
const SEARCH_ANALYTICS_DEBOUNCE_MS = 500;
const SEARCH_PARAM_SYNC_DEBOUNCE_MS = 300;
const CATALOG_PARAM_KEYS = ['q', 'auth', 'category', 'sort'];

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

const getSortOrderFromParams = (params: URLSearchParams): CatalogSortOrder => {
  const sortParam = params.get('sort');
  return isCatalogSortOrder(sortParam) ? sortParam : 'catalog-order';
};

export const getCatalogFiltersFromParams = (
  params: URLSearchParams,
  categories: string[] = []
) => {
  return {
    searchQuery: normalizeSearchQuery(params.get('q') ?? ''),
    oauthFilter: getOAuthFilterFromParams(params),
    category: getCategoryFromParams(params, categories),
    sortOrder: getSortOrderFromParams(params),
  };
};

export const buildCatalogSearchParams = (
  searchQuery: string,
  oauthFilter: OAuthFilter,
  category: string,
  sortOrder: CatalogSortOrder = 'catalog-order'
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

  if (sortOrder !== 'catalog-order') {
    params.set('sort', sortOrder);
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
  const [sortOrder, setSortOrderState] = useState<CatalogSortOrder>(initialFilters.sortOrder);
  const lastLoggedSearchQueryRef = useRef(normalizeSearchQuery(initialFilters.searchQuery));
  const searchAnalyticsTimeoutRef = useRef<number | null>(null);
  const searchParamSyncTimeoutRef = useRef<number | null>(null);
  const pushNextCatalogParamsRef = useRef(false);
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
    (
      nextSearchQuery: string,
      nextOauthFilter: OAuthFilter,
      nextCategory: string,
      nextSortOrder: CatalogSortOrder,
      replace: boolean
    ) => {
      if (!onCatalogRoute) {
        return;
      }

      const nextParams = buildCatalogSearchParams(
        nextSearchQuery,
        nextOauthFilter,
        nextCategory,
        nextSortOrder
      );

      if (!catalogParamsMatch(searchParams, nextParams)) {
        setSearchParams(nextParams, { replace });
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
    setSortOrderState((current) =>
      current === nextFilters.sortOrder ? current : nextFilters.sortOrder
    );

    const normalizedParams = buildCatalogSearchParams(
      nextFilters.searchQuery,
      nextFilters.oauthFilter,
      nextFilters.category,
      nextFilters.sortOrder
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
      const shouldPushHistory = pushNextCatalogParamsRef.current;
      pushNextCatalogParamsRef.current = false;
      syncCatalogParams(
        normalizedSearchQuery,
        oauthFilter,
        category,
        sortOrder,
        !shouldPushHistory
      );
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
    sortOrder,
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

      pushNextCatalogParamsRef.current = true;
      setOauthFilterState(nextOauthFilter);
      logEvent('catalog_filter_auth', { filter: nextOauthFilter });
    },
    [oauthFilter]
  );

  const setCategory = useCallback(
    (nextCategory: string) => {
      if (nextCategory === category) {
        return;
      }

      pushNextCatalogParamsRef.current = true;
      setCategoryState(nextCategory);
      logEvent('catalog_filter_category', { category: nextCategory });
    },
    [category]
  );

  const setSortOrder = useCallback(
    (nextSortOrder: CatalogSortOrder) => {
      if (nextSortOrder === sortOrder) {
        return;
      }

      pushNextCatalogParamsRef.current = true;
      setSortOrderState(nextSortOrder);
      logEvent('catalog_sort', { sort: nextSortOrder });
    },
    [sortOrder]
  );

  const categoryCounts = useMemo(() => {
    return getCatalogCategoryCounts(
      allServers,
      { query: normalizedSearchQuery, oauthFilter },
      categories
    );
  }, [allServers, categories, normalizedSearchQuery, oauthFilter]);

  const filteredServers = useMemo(() => {
    const matchingServers = filterCatalogServers(allServers, {
      query: normalizedSearchQuery,
      category,
      oauthFilter,
    });
    return sortCatalogServers(matchingServers, sortOrder);
  }, [allServers, normalizedSearchQuery, category, oauthFilter, sortOrder]);

  return {
    allServers,
    filteredServers,
    categories,
    categoryCounts,
    searchQuery,
    setSearchQuery,
    oauthFilter,
    setOauthFilter,
    category,
    setCategory,
    sortOrder,
    setSortOrder,
  };
};
