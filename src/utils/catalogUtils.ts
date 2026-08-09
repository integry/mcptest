import serverCatalog from '../data/serverCatalog.json';
import catalogValidation from '../data/catalogValidation.json';
import {
  CATALOG_CATEGORY_ALL,
  type CatalogFilters,
  type CatalogAuthType,
  type CatalogProtocolEra,
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

export const getCatalogCategories = (servers: CatalogServer[]): string[] => {
  return Array.from(new Set(servers.map((server) => server.category))).sort((a, b) =>
    a.localeCompare(b)
  );
};
