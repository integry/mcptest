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

/** MCP lifecycle style observed by validation. */
export type CatalogProtocolEra = 'stateless' | 'stateful' | 'legacy' | 'unknown';

/** Credential mechanism declared by a listing or detected during validation. */
export type CatalogAuthType = 'none' | 'oauth' | 'bearer-token' | 'api-key' | 'unknown';

/**
 * Reachability state for a catalog server after validation. The unknown state
 * is intentional because browser CORS restrictions can prevent proving whether
 * a server is actually down.
 */
export type CatalogServerStatus = 'online' | 'offline' | 'unknown';

/** Whether a hosted endpoint was verified from a browser, not just from Node. */
export type CatalogBrowserAccess = 'direct' | 'proxy-required' | 'unknown';

/**
 * Authentication-method filter used by the searchable catalog UI.
 */
export type OAuthFilter = 'all' | 'oauth' | 'bearer-token' | 'api-key' | 'no-auth';

/** Provenance category for a self-hosted catalog logo. */
export type CatalogLogoSourceKind =
  | 'official-brand'
  | 'official-site'
  | 'publisher-repository'
  | 'simple-icons'
  | 'generated-fallback';

export interface CatalogRequiredHeader {
  /** HTTP header name expected by the remote server. */
  name: string;
  /** Short setup guidance that is safe to render publicly. */
  description?: string;
  /** Whether the header must be supplied for a successful MCP connection. */
  required?: boolean;
  /** Whether the value is a credential and must never be stored or rendered. */
  secret?: boolean;
}

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
  /** Exact endpoint verified to work from the browser playground. */
  browserUrl?: string;
  /** Browser reachability observed separately from server-side validation. */
  browserAccess?: CatalogBrowserAccess;
  /** Short summary of what the server provides. */
  description: string;
  /** Optional search-result summary when the catalog description is not written as metadata. */
  seoDescription?: string;
  /** Primary grouping used by the category filter. */
  category: string;
  /** Searchable keywords, capabilities, or ecosystem labels. */
  tags: string[];
  /** Known or preferred transport for this remote server. */
  transport: CatalogTransport;
  /** Whether the server requires an OAuth flow before testing. */
  requiresOAuth: boolean;
  /** Declared authentication method; requiresOAuth remains for older seed compatibility. */
  authType?: CatalogAuthType;
  /** Non-secret header requirements documented by the server publisher. */
  requiredHeaders?: CatalogRequiredHeader[];
  /** Self-hosted logo path used by every catalog, profile, and SEO surface. */
  logoUrl: string;
  /** HTTPS page or asset from which the self-hosted logo was retrieved. */
  logoSourceUrl?: string;
  /** Publisher/source classification, or generated-fallback for a local monogram. */
  logoSourceKind: CatalogLogoSourceKind;
  /** ISO calendar date on which the source asset was retrieved or fallback generated. */
  logoRetrievedAt: string;
  /** Optional license, trademark, or usage context recorded during curation. */
  logoLicenseNote?: string;
  /** Optional project, product, or documentation homepage. */
  homepageUrl?: string;
  /** Optional source repository or package URL for the server. */
  sourceUrl?: string;
  /** Canonical server name in the official MCP Registry. */
  registryName?: string;
  /** Registry version used when this listing was last curated. */
  registryVersion?: string;
  /** Direct official MCP Registry API record for provenance. */
  registryUrl?: string;
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
  /** Authentication method inferred from metadata, challenges, and the curated seed. */
  authType?: CatalogAuthType;
  /** MCP lifecycle style negotiated by the probe. */
  protocolEra?: CatalogProtocolEra;
  /** Exact MCP protocol revision negotiated by the probe. */
  protocolVersion?: string;
  /** Exact endpoint URL that completed a protocol or authentication probe. */
  validatedUrl?: string;
  /** Authorization server issuers advertised by protected-resource metadata. */
  authorizationServers?: string[];
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
  /** Transport declared by the catalog source, even when a live probe is unavailable. */
  declaredTransport: CatalogTransport;
  /** Transport support from validation, or unknown when validation is missing. */
  transport: CatalogValidationTransport;
  /** Authentication method declared by the catalog source. */
  declaredAuthType: CatalogAuthType;
  /** Best-known authentication method after validation evidence is merged. */
  authType: CatalogAuthType;
  /** MCP lifecycle style observed by validation. */
  protocolEra: CatalogProtocolEra;
  /** Exact MCP revision observed by validation. */
  protocolVersion?: string;
  /** Exact endpoint that most recently completed a validation probe. */
  validatedUrl?: string;
  /** Authorization server issuers found during OAuth discovery. */
  authorizationServers?: string[];
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
  /** Authentication-method filter. */
  oauth: OAuthFilter;
}
