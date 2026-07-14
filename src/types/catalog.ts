/**
 * Sentinel category value used by the catalog UI to represent an unfiltered
 * category selection.
 */
export const CATALOG_CATEGORY_ALL = 'all' as const;

/**
 * Remote MCP transport variants the catalog can advertise or validate.
 */
export type CatalogTransport = 'streamable-http' | 'legacy-sse';

/**
 * Transport result values produced by catalog validation. Validation can prove
 * support for both transports, or fail to prove either one.
 */
export type CatalogValidationTransport = CatalogTransport | 'both' | 'unknown';

/**
 * Reachability state for a catalog server after validation. The unknown state
 * is intentional because browser CORS restrictions can prevent proving whether
 * a server is actually down.
 */
export type CatalogServerStatus = 'online' | 'offline' | 'unknown';

/**
 * Three-state OAuth filter used by the searchable catalog UI.
 */
export type OAuthFilter = 'all' | 'oauth' | 'no-auth';

/**
 * Hand-curated or crawled catalog entry before validation data is merged in.
 * This is the source-of-truth shape for seed files maintained outside the UI.
 */
export interface CatalogServerSeed {
  /** Stable identifier used to merge seed and validation data. */
  id: string;
  /** Human-readable server name shown in the catalog. */
  name: string;
  /** Base URL users can connect to from the playground. */
  url: string;
  /** Short summary of what the server provides. */
  description: string;
  /** Primary grouping used by the category filter. */
  category: string;
  /** Searchable keywords, capabilities, or ecosystem labels. */
  tags: string[];
  /** Known or preferred transport for this remote server. */
  transport: CatalogTransport;
  /** Whether the server requires an OAuth flow before testing. */
  requiresOAuth: boolean;
  /** Optional logo path or URL for catalog and suggested-server surfaces. */
  logoUrl?: string;
  /** Optional project, product, or documentation homepage. */
  homepageUrl?: string;
  /** Optional source repository or package URL for the server. */
  sourceUrl?: string;
}

/**
 * Output produced by the build-time catalog validation script for a single
 * server. Validation results are merged with seed data for UI display.
 */
export interface CatalogValidationResult {
  /** Seed entry identifier this validation result belongs to. */
  serverId: string;
  /** Best-known reachability state from the validation run. */
  status: CatalogServerStatus;
  /** Transport support detected during validation. */
  transport: CatalogValidationTransport;
  /** Whether validation detected OAuth or the curated seed already required it. */
  requiresOAuth: boolean;
  /** ISO timestamp for when validation completed. */
  checkedAt: string;
  /** Optional machine-readable failure code for diagnostics. */
  errorCode?: string;
  /** Optional human-readable validation detail for maintainers. */
  message?: string;
}

/**
 * UI-facing catalog server after seed data has been combined with validation
 * output and any derived display metadata.
 */
export interface CatalogServer extends Omit<CatalogServerSeed, 'transport'> {
  /** Transport support from validation, or unknown when validation is missing. */
  transport: CatalogValidationTransport;
  /** Current catalog reachability state. */
  status: CatalogServerStatus;
  /** ISO timestamp for the latest validation result, when available. */
  checkedAt?: string;
  /** Optional validation detail surfaced to maintainers or debug views. */
  validationMessage?: string;
}

/**
 * Filter state for the searchable catalog UI and related hooks.
 */
export interface CatalogFilters {
  /** Free-text search over names, descriptions, URLs, categories, and tags. */
  query: string;
  /** Selected category, or CATALOG_CATEGORY_ALL for every category. */
  category: string;
  /** Three-state OAuth requirement filter. */
  oauth: OAuthFilter;
}
