import serverCatalog from '../data/serverCatalog.json';
import catalogValidation from '../data/catalogValidation.json';
import {
  CATALOG_CATEGORY_ALL,
  type CatalogFilters,
  type CatalogServer,
  type CatalogServerSeed,
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

const getSearchText = (server: CatalogServer): string => {
  return [
    server.name,
    server.description,
    server.url,
    server.category,
    ...server.tags,
  ].join(' ').toLowerCase();
};

export const getCatalogServers = (): CatalogServer[] => {
  const validationByServerId = new Map(
    CATALOG_VALIDATION.map((result) => [result.serverId, result])
  );

  return CATALOG_SEEDS.map((seed) => {
    const validation = validationByServerId.get(seed.id);

    return {
      ...seed,
      status: validation?.status ?? 'unknown',
      transport: isValidationTransport(validation?.transport)
        ? validation.transport
        : 'unknown',
      requiresOAuth:
        typeof validation?.requiresOAuth === 'boolean'
          ? validation.requiresOAuth
          : seed.requiresOAuth,
      checkedAt: validation?.checkedAt,
      validationMessage: validation?.message,
    };
  });
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
      return server.requiresOAuth === true;
    }

    if (oauthFilter === 'no-auth') {
      return server.requiresOAuth === false;
    }

    return true;
  });
};

export const getCatalogCategories = (servers: CatalogServer[]): string[] => {
  return Array.from(new Set(servers.map((server) => server.category))).sort((a, b) =>
    a.localeCompare(b)
  );
};
