import { useMemo, useState } from 'react';
import { CATALOG_CATEGORY_ALL, type OAuthFilter } from '../types/catalog';
import {
  filterCatalogServers,
  getCatalogCategories,
  getCatalogServers,
} from '../utils/catalogUtils';

export const useCatalog = () => {
  const [allServers] = useState(() => getCatalogServers());
  const [searchQuery, setSearchQuery] = useState('');
  const [oauthFilter, setOauthFilter] = useState<OAuthFilter>('all');
  const [category, setCategory] = useState(CATALOG_CATEGORY_ALL);

  const categories = useMemo(() => {
    return getCatalogCategories(allServers);
  }, [allServers]);

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
