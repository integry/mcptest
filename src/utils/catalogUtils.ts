import serverCatalog from '../data/serverCatalog.json';
import catalogValidation from '../data/catalogValidation.json';
import {
  CATALOG_CATEGORY_ALL,
  type CatalogFilters,
  type CatalogAuthType,
  type CatalogProtocolEra,
  type CatalogServer,
  type CatalogServerSeed,
  type CatalogSortOrder,
  type CatalogValidationResult,
  type CatalogValidationTransport,
  type OAuthFilter,
} from '../types/catalog';

type CatalogFilterInput = Partial<Omit<CatalogFilters, 'oauth'>> & {
  oauth?: OAuthFilter;
  oauthFilter?: OAuthFilter;
};

const CATALOG_SEEDS = Array.isArray(serverCatalog) ? (serverCatalog as CatalogServerSeed[]) : [];
const CATALOG_VALIDATION = Array.isArray(catalogValidation)
  ? (catalogValidation as CatalogValidationResult[])
  : [];

const isValidationTransport = (transport: string | undefined): transport is CatalogValidationTransport => {
  return (
    transport === 'streamable-http' ||
    transport === 'legacy-sse' ||
    transport === 'both' ||
    transport === 'unknown'
  );
};

const isCatalogAuthType = (authType: string | undefined): authType is CatalogAuthType => {
  return (
    authType === 'none' ||
    authType === 'oauth' ||
    authType === 'bearer-token' ||
    authType === 'api-key' ||
    authType === 'unknown'
  );
};

const isCatalogProtocolEra = (era: string | undefined): era is CatalogProtocolEra => {
  return era === 'stateless' || era === 'stateful' || era === 'legacy' || era === 'unknown';
};

const getDeclaredAuthType = (seed: CatalogServerSeed): CatalogAuthType => {
  return isCatalogAuthType(seed.authType)
    ? seed.authType
    : seed.requiresOAuth
      ? 'oauth'
      : 'none';
};

const getSearchText = (server: CatalogServer): string => {
  return [
    server.name,
    server.description,
    server.url,
    server.category,
    server.authType,
    server.declaredAuthType,
    server.protocolEra,
    server.protocolVersion,
    server.registryName,
    ...server.tags,
  ].join(' ').toLowerCase();
};

export const getCatalogServers = (): CatalogServer[] => {
  const validationByServerId = new Map(
    CATALOG_VALIDATION.map((result) => [result.serverId, result])
  );

  return CATALOG_SEEDS.map((seed) => {
    const validation = validationByServerId.get(seed.id);
    const declaredAuthType = getDeclaredAuthType(seed);
    const authType = declaredAuthType === 'api-key' || declaredAuthType === 'bearer-token'
      ? declaredAuthType
      : isCatalogAuthType(validation?.authType)
        ? validation.authType
        : declaredAuthType;

    return {
      ...seed,
      declaredTransport: seed.transport,
      declaredAuthType,
      authType,
      status: validation?.status ?? 'unknown',
      transport: isValidationTransport(validation?.transport)
        ? validation.transport
        : 'unknown',
      requiresOAuth: authType === 'oauth',
      protocolEra: isCatalogProtocolEra(validation?.protocolEra)
        ? validation.protocolEra
        : 'unknown',
      protocolVersion: validation?.protocolVersion,
      validatedUrl: validation?.validatedUrl,
      authorizationServers: validation?.authorizationServers,
      checkedAt: validation?.checkedAt,
      validationMessage: validation?.message,
    };
  });
};

export const getCatalogServerById = (serverId: string): CatalogServer | undefined => {
  return getCatalogServers().find((server) => server.id === serverId);
};

export const filterCatalogServers = (
  servers: CatalogServer[],
  filters: CatalogFilterInput
): CatalogServer[] => {
  const query = filters.query?.trim().toLowerCase() ?? '';
  const category = filters.category ?? CATALOG_CATEGORY_ALL;
  const oauthFilter = filters.oauthFilter ?? filters.oauth ?? 'all';

  if (!query && category === CATALOG_CATEGORY_ALL && oauthFilter === 'all') {
    return servers;
  }

  return servers.filter((server) => {
    if (query && !getSearchText(server).includes(query)) {
      return false;
    }

    if (category !== CATALOG_CATEGORY_ALL && server.category !== category) {
      return false;
    }

    if (oauthFilter === 'oauth') {
      return server.authType === 'oauth';
    }

    if (oauthFilter === 'bearer-token') {
      return server.authType === 'bearer-token';
    }

    if (oauthFilter === 'api-key') {
      return server.authType === 'api-key';
    }

    if (oauthFilter === 'no-auth') {
      return server.authType === 'none';
    }

    return true;
  });
};

const compareCatalogNames = (a: CatalogServer, b: CatalogServer): number => {
  return a.name.localeCompare(b.name);
};

const getValidCheckedAt = (server: CatalogServer): number | null => {
  if (!server.checkedAt) {
    return null;
  }

  const timestamp = Date.parse(server.checkedAt);
  return Number.isNaN(timestamp) ? null : timestamp;
};

const BROWSER_ACCESS_RANK = {
  direct: 0,
  'proxy-required': 1,
  unknown: 2,
} as const;

/**
 * Stable-sort a copy of catalog results. Source data is never mutated and the
 * original index remains the final deterministic tie breaker.
 */
export const sortCatalogServers = (
  servers: CatalogServer[],
  order: CatalogSortOrder
): CatalogServer[] => {
  const indexedServers = servers.map((server, originalIndex) => ({ server, originalIndex }));

  if (order === 'catalog-order') {
    return indexedServers.map(({ server }) => server);
  }

  indexedServers.sort((a, b) => {
    if (order === 'recently-tested') {
      const aCheckedAt = getValidCheckedAt(a.server);
      const bCheckedAt = getValidCheckedAt(b.server);

      if (aCheckedAt !== null && bCheckedAt === null) return -1;
      if (aCheckedAt === null && bCheckedAt !== null) return 1;
      if (aCheckedAt !== null && bCheckedAt !== null && aCheckedAt !== bCheckedAt) {
        return bCheckedAt - aCheckedAt;
      }
    }

    if (order === 'browser-ready') {
      const aRank = BROWSER_ACCESS_RANK[a.server.browserAccess ?? 'unknown'];
      const bRank = BROWSER_ACCESS_RANK[b.server.browserAccess ?? 'unknown'];

      if (aRank !== bRank) return aRank - bRank;
    }

    const nameComparison = compareCatalogNames(a.server, b.server);
    return nameComparison || a.originalIndex - b.originalIndex;
  });

  return indexedServers.map(({ server }) => server);
};

export interface CatalogCategoryCount {
  category: string;
  count: number;
}

/**
 * Count categories after search/auth filtering while intentionally ignoring
 * the selected category. Supplying the full category set keeps zero rows in
 * the facet navigation.
 */
export const getCatalogCategoryCounts = (
  servers: CatalogServer[],
  filters: CatalogFilterInput,
  categories: string[] = getCatalogCategories(servers)
): { all: number; categories: CatalogCategoryCount[] } => {
  const matchingServers = filterCatalogServers(servers, {
    ...filters,
    category: CATALOG_CATEGORY_ALL,
  });
  const counts = new Map<string, number>();

  matchingServers.forEach((server) => {
    counts.set(server.category, (counts.get(server.category) ?? 0) + 1);
  });

  return {
    all: matchingServers.length,
    categories: categories.map((category) => ({
      category,
      count: counts.get(category) ?? 0,
    })),
  };
};

export const getCatalogCategories = (servers: CatalogServer[]): string[] => {
  return Array.from(new Set(servers.map((server) => server.category))).sort((a, b) =>
    a.localeCompare(b)
  );
};
