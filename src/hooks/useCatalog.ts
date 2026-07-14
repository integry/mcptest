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

const getOAuthFilterFromParams = (params: URLSearchParams): OAuthFilter => {
  const authParam = params.get('auth');
  return isOAuthFilter(authParam) ? authParam : 'all';
};

const getCatalogFiltersFromParams = (params: URLSearchParams) => {
  return {
    searchQuery: params.get('q') ?? '',
    oauthFilter: getOAuthFilterFromParams(params),
    category: params.get('category') ?? CATALOG_CATEGORY_ALL,
  };
};

const buildCatalogSearchParams = (
  searchQuery: string,
  oauthFilter: OAuthFilter,
  category: string
) => {
  const params = new URLSearchParams();
  const trimmedQuery = searchQuery.trim();

  if (trimmedQuery) {
    params.set('q', trimmedQuery);
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
  return pathname === '/catalog' || pathname.startsWith('/catalog/');
};

export const useCatalog = () => {
  const location = useLocation();
  const [searchParams, setSearchParams] = useSearchParams();
  const initialFilters = getCatalogFiltersFromParams(searchParams);
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

      if (nextParams.toString() !== searchParams.toString()) {
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

    if (normalizedParams.toString() !== searchParams.toString()) {
      setSearchParams(normalizedParams, { replace: true });
    }
  }, [onCatalogRoute, searchParams, setSearchParams]);

  const setSearchQuery = useCallback(
    (nextSearchQuery: string) => {
      setSearchQueryState(nextSearchQuery);
      syncCatalogParams(nextSearchQuery, oauthFilter, category);
      logEvent('catalog_search', { query_length: nextSearchQuery.length });
    },
    [category, oauthFilter, syncCatalogParams]
  );

  const setOauthFilter = useCallback(
    (nextOauthFilter: OAuthFilter) => {
      setOauthFilterState(nextOauthFilter);
      syncCatalogParams(searchQuery, nextOauthFilter, category);
      logEvent('catalog_filter_oauth', { filter: nextOauthFilter });
    },
    [category, searchQuery, syncCatalogParams]
  );

  const setCategory = useCallback(
    (nextCategory: string) => {
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
