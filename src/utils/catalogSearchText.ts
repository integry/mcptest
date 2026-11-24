import type { CatalogServer } from '../types/catalog';

export const getCatalogSearchText = (server: CatalogServer): string => (
  [
    server.name,
    server.description,
    server.url,
    server.category,
    server.authType,
    server.declaredAuthType,
    server.protocolEra,
    server.protocolVersion,
    server.registryName,
    ...(server.alternativeAuthTypes ?? []),
    ...(server.alternativeEndpoints ?? []).flatMap(({ url, authType, description }) => [
      url,
      authType,
      description,
    ]),
    ...(server.caveats ?? []),
    ...server.tags,
  ].join(' ').toLowerCase()
);

export const matchesCatalogSearch = (text: string, query: string): boolean =>
  text.includes(query) || text.replace(/-/g, ' ').includes(query);
