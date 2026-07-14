import { useCallback, useEffect, useMemo, useState } from 'react';
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

const getOAuthFilterFromParams = (params: URLSearchParams): OAuthFilter => {
  const authParam = params.get('auth');
  return isOAuthFilter(authParam) ? authParam : 'all';
};

export const getCatalogFiltersFromParams = (params: URLSearchParams) => {
  return {
    searchQuery: normalizeSearchQuery(params.get('q') ?? ''),
    oauthFilter: getOAuthFilterFromParams(params),
    category: params.get('category') ?? CATALOG_CATEGORY_ALL,
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
  const [initialFilters] = useState(() => getCatalogFiltersFromParams(searchParams));
  const [allServers] = useState(() => getCatalogServers());
  const [searchQuery, setSearchQueryState] = useState(initialFilters.searchQuery);
  const [oauthFilter, setOauthFilterState] = useState<OAuthFilter>(initialFilters.oauthFilter);
  const [category, setCategoryState] = useState(initialFilters.category);
  const onCatalogRoute = isCatalogRoute(location.pathname);

  const categories = useMemo(() => {
    return getCatalogCategories(allServers);
  }, [allServers]);

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

    const nextFilters = getCatalogFiltersFromParams(searchParams);

    setSearchQueryState((current) =>
      current === nextFilters.searchQuery ? current : nextFilters.searchQuery
    );
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
  }, [onCatalogRoute, searchParams, setSearchParams]);

  const setSearchQuery = useCallback(
    (nextSearchQuery: string) => {
      const normalizedQuery = normalizeSearchQuery(nextSearchQuery);

      if (normalizedQuery === searchQuery) {
        return;
      }

      setSearchQueryState(normalizedQuery);
      syncCatalogParams(normalizedQuery, oauthFilter, category);
      logEvent('catalog_search', { query_length: normalizedQuery.length });
    },
    [category, oauthFilter, searchQuery, syncCatalogParams]
  );

  const setOauthFilter = useCallback(
    (nextOauthFilter: OAuthFilter) => {
      if (nextOauthFilter === oauthFilter) {
        return;
      }

      setOauthFilterState(nextOauthFilter);
      syncCatalogParams(searchQuery, nextOauthFilter, category);
      logEvent('catalog_filter_oauth', { filter: nextOauthFilter });
    },
    [category, oauthFilter, searchQuery, syncCatalogParams]
  );

  const setCategory = useCallback(
    (nextCategory: string) => {
      if (nextCategory === category) {
        return;
      }

      setCategoryState(nextCategory);
      syncCatalogParams(searchQuery, oauthFilter, nextCategory);
      logEvent('catalog_filter_category', { category: nextCategory });
    },
    [oauthFilter, searchQuery, syncCatalogParams]
  );

  const filteredServers = useMemo(() => {
    return filterCatalogServers(allServers, {
      query: searchQuery,
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
