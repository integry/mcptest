import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { useLocation, useNavigate, useSearchParams } from 'react-router-dom';
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
import { trackEvent } from '../utils/analytics';
import {
  CATALOG_PATH,
  findCatalogCategoryBySlug,
  getCatalogCategoryPath,
  getCatalogCategorySlugFromPath,
  isCatalogPath,
} from '../utils/catalogCategories';

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

const isCatalogRoute = isCatalogPath;

/**
 * A category lives in the path (`/catalog/databases`) so the selection is a
 * shareable, indexable page. The older `?category=` parameter is still read
 * on `/catalog` and redirected to the category path.
 */
const getCategoryFromLocation = (
  pathname: string,
  params: URLSearchParams,
  categories: string[]
): { category: string; fromLegacyParam: boolean; notFound: boolean } => {
  const slug = getCatalogCategorySlugFromPath(pathname);
  if (slug !== null) {
    const category = findCatalogCategoryBySlug(categories, slug);
    return { category: category ?? CATALOG_CATEGORY_ALL, fromLegacyParam: false, notFound: !category };
  }
  const category = getCategoryFromParams(params, categories);
  return { category, fromLegacyParam: category !== CATALOG_CATEGORY_ALL, notFound: false };
};

const getCatalogPathForCategory = (category: string) => (
  category === CATALOG_CATEGORY_ALL ? CATALOG_PATH : getCatalogCategoryPath(category)
);

const toSearch = (params: URLSearchParams) => {
  const value = params.toString();
  return value ? `?${value}` : '';
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
  const navigate = useNavigate();
  const [searchParams, setSearchParams] = useSearchParams();
  const [allServers] = useState(() => getCatalogServers());
  const [categories] = useState(() => getCatalogCategories(allServers));
  const [initialFilters] = useState(() =>
    isCatalogRoute(location.pathname)
      ? {
          ...getCatalogFiltersFromParams(searchParams, categories),
          category: getCategoryFromLocation(location.pathname, searchParams, categories).category,
        }
      : DEFAULT_CATALOG_FILTERS
  );
  const [searchQuery, setSearchQueryState] = useState(initialFilters.searchQuery);
  const [oauthFilter, setOauthFilterState] = useState<OAuthFilter>(initialFilters.oauthFilter);
  const [selectedCategory, setCategoryState] = useState(initialFilters.category);
  const [sortOrder, setSortOrderState] = useState<CatalogSortOrder>(initialFilters.sortOrder);
  const lastLoggedSearchQueryRef = useRef(normalizeSearchQuery(initialFilters.searchQuery));
  const searchAnalyticsTimeoutRef = useRef<number | null>(null);
  const searchParamSyncTimeoutRef = useRef<number | null>(null);
  const pushNextCatalogParamsRef = useRef(false);
  const onCatalogRoute = isCatalogRoute(location.pathname);
  const locationCategory = useMemo(
    () => getCategoryFromLocation(location.pathname, searchParams, categories),
    [categories, location.pathname, searchParams]
  );
  // On a catalog route the URL is the source of truth, so a category link
  // renders its page on the first frame; elsewhere the last selection is kept.
  const category = onCatalogRoute ? locationCategory.category : selectedCategory;
  const categoryNotFound = onCatalogRoute && locationCategory.notFound;
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
      nextSortOrder: CatalogSortOrder,
      replace: boolean
    ) => {
      if (!onCatalogRoute) {
        return;
      }

      const nextParams = buildCatalogSearchParams(
        nextSearchQuery,
        nextOauthFilter,
        CATALOG_CATEGORY_ALL,
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
      current === locationCategory.category ? current : locationCategory.category
    );
    setSortOrderState((current) =>
      current === nextFilters.sortOrder ? current : nextFilters.sortOrder
    );

    const normalizedParams = buildCatalogSearchParams(
      nextFilters.searchQuery,
      nextFilters.oauthFilter,
      CATALOG_CATEGORY_ALL,
      nextFilters.sortOrder
    );

    if (locationCategory.fromLegacyParam) {
      navigate(
        {
          pathname: getCatalogCategoryPath(locationCategory.category),
          search: toSearch(normalizedParams),
        },
        { replace: true }
      );
    } else if (!catalogParamsMatch(searchParams, normalizedParams)) {
      setSearchParams(normalizedParams, { replace: true });
    }
  }, [categories, locationCategory, navigate, onCatalogRoute, searchParams, setSearchParams]);

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
        trackEvent('catalog_search', { query_length: normalizedNextQuery.length });
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
      trackEvent('catalog_filter_auth', { filter: nextOauthFilter });
    },
    [oauthFilter]
  );

  /** Search, auth and sort as the query string every catalog and category link carries. */
  const filterSearch = useMemo(
    () => toSearch(buildCatalogSearchParams(normalizedSearchQuery, oauthFilter, CATALOG_CATEGORY_ALL, sortOrder)),
    [normalizedSearchQuery, oauthFilter, sortOrder]
  );

  // Selecting a category navigates to its page, keeping the other filters.
  const setCategory = useCallback(
    (nextCategory: string) => {
      if (nextCategory === category) {
        return;
      }

      setCategoryState(nextCategory);
      trackEvent('catalog_filter_category', { category: nextCategory });
      if (onCatalogRoute) {
        navigate({ pathname: getCatalogPathForCategory(nextCategory), search: filterSearch });
      }
    },
    [category, filterSearch, navigate, onCatalogRoute]
  );

  const setSortOrder = useCallback(
    (nextSortOrder: CatalogSortOrder) => {
      if (nextSortOrder === sortOrder) {
        return;
      }

      pushNextCatalogParamsRef.current = true;
      setSortOrderState(nextSortOrder);
      trackEvent('catalog_sort', { sort: nextSortOrder });
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
    categoryNotFound,
    filterSearch,
    sortOrder,
    setSortOrder,
  };
};
