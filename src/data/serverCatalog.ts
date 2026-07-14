import serverCatalog from './serverCatalog.json';
import catalogValidation from './catalogValidation.json';
import type { CatalogServer, CatalogServerSeed, CatalogValidationResult } from '../types/catalog';

export const CATALOG_SEEDS: CatalogServerSeed[] = serverCatalog as CatalogServerSeed[];
export const CATALOG_VALIDATION: CatalogValidationResult[] = catalogValidation as CatalogValidationResult[];

const validationByServerId = new Map(
  CATALOG_VALIDATION.map((result) => [result.serverId, result])
);

export const CATALOG_SERVERS: CatalogServer[] = CATALOG_SEEDS.map((seed) => {
  const validation = validationByServerId.get(seed.id);

  return {
    ...seed,
    status: validation?.status ?? 'unknown',
    transport:
      validation?.transport === 'streamable-http' || validation?.transport === 'legacy-sse'
        ? validation.transport
        : seed.transport,
    requiresOAuth: seed.requiresOAuth || validation?.requiresOAuth === true,
    checkedAt: validation?.checkedAt,
    validationMessage: validation?.message,
  };
});
