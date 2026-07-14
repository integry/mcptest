import serverCatalog from './serverCatalog.json';
import catalogValidation from './catalogValidation.json';
import type { CatalogServer, CatalogServerSeed, CatalogValidationResult } from '../types/catalog';
import { getCatalogServers } from '../utils/catalogUtils';

export const CATALOG_SEEDS: CatalogServerSeed[] = serverCatalog as CatalogServerSeed[];
export const CATALOG_VALIDATION: CatalogValidationResult[] = catalogValidation as CatalogValidationResult[];
export const CATALOG_SERVERS: CatalogServer[] = getCatalogServers();
