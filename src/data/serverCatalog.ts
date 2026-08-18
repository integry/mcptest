import serverCatalog from './serverCatalog.json';
import catalogValidation from './catalogValidation.json';
import catalogCapabilities from './catalogCapabilities.json';
import type { CapabilityInventoryV1 } from '../types/capabilityInventory';
import type { CatalogServer, CatalogServerSeed, CatalogValidationResult } from '../types/catalog';
import { getCatalogServers } from '../utils/catalogUtils';

export const CATALOG_SEEDS: CatalogServerSeed[] = serverCatalog as CatalogServerSeed[];
export const CATALOG_VALIDATION: CatalogValidationResult[] = catalogValidation as CatalogValidationResult[];
export const CATALOG_CAPABILITIES = catalogCapabilities as Record<string, CapabilityInventoryV1>;
export const CATALOG_SERVERS: CatalogServer[] = getCatalogServers();
