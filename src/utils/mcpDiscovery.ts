/**
 * The MCP discovery checker behind /tools/discovery: every way a domain
 * advertises a remote MCP server, each artifact validated.
 *
 *   1. Server Cards (SEP-2127): the .well-known paths from the SEP drafts and
 *      the wild, the AI Catalog the final SEP uses for domain-level discovery,
 *      and the reserved `<endpoint>/server-card` location of each endpoint found.
 *   2. OAuth protected resource metadata (RFC 9728) of each endpoint, and the
 *      authorization server metadata it points to.
 *   3. Official MCP Registry entries with a remote on the domain.
 *   4. mcptest.io catalog entries on the domain.
 *
 * Pure apart from the injected `fetch`: no DOM, storage or globals, so the same
 * module can run a scheduled check from a Worker or a script.
 */
import type { FetchLike } from '@modelcontextprotocol/client';
import { discoverOAuthMetadata } from './oauthMetadataDiscovery';
import {
  AI_CATALOG_MEDIA_TYPE,
  SERVER_CARD_MEDIA_TYPE,
  buildMinimalServerCard,
  resolveRemoteUrl,
  validateServerCard,
  type ServerCardValidation,
} from './serverCardValidation';
import { getServerUrl } from './urlUtils';

export const MCP_REGISTRY_ORIGIN = 'https://registry.modelcontextprotocol.io';
export const MCP_REGISTRY_SERVERS_PATH = '/v0.1/servers';
/** Endpoints checked for a server card and OAuth metadata, at most. */
export const MAX_DISCOVERY_ENDPOINTS = 5;
const MAX_AI_CATALOG_ENTRIES = 10;
const MAX_PREVIEW_CHARS = 4000;
const REGISTRY_PAGE_SIZE = 100;

export type DiscoveryRoute = 'direct' | 'proxy';
export type DiscoveryFailureKind = 'cors' | 'network' | 'timeout' | 'too-large' | 'not-allowed' | 'proxy-limit';

/** A response as the checker sees it: the body is already read, within a size cap. */
export interface DiscoveryResponse {
  /** The URL that answered, after redirects. */
  url: string;
  status: number;
  contentType?: string;
  body: string;
  /** `proxy` means the browser could not read the URL directly. */
  route: DiscoveryRoute;
}

export interface DiscoveryRequest {
  accept?: string;
  headers?: Record<string, string>;
}

export class DiscoveryFetchError extends Error {
  constructor(
    message: string,
    readonly kind: DiscoveryFailureKind,
    readonly route?: DiscoveryRoute
  ) {
    super(message);
    this.name = 'DiscoveryFetchError';
  }
}

/** GET `url`; rejects with DiscoveryFetchError when no response could be read. */
export type DiscoveryFetch = (url: string, request?: DiscoveryRequest) => Promise<DiscoveryResponse>;

export interface DiscoveryAttempt {
  url: string;
  route?: DiscoveryRoute;
  status?: number;
  contentType?: string;
  failure?: DiscoveryFailureKind;
  message?: string;
}

export type DiscoveryRowStatus = 'found' | 'not-found' | 'invalid' | 'unreachable' | 'skipped';
export type DiscoveryRowKind = 'server-card' | 'ai-catalog' | 'oauth' | 'registry' | 'catalog';

export interface DiscoveryLink {
  label: string;
  href: string;
  external?: boolean;
}

export interface DiscoveryRow {
  id: string;
  kind: DiscoveryRowKind;
  title: string;
  /** Which specification or convention defines the location. */
  source: string;
  status: DiscoveryRowStatus;
  /** The exact URL fetched (the one that answered, or the first tried). */
  url: string;
  attempts: DiscoveryAttempt[];
  summary: string;
  errors: string[];
  warnings: string[];
  links: DiscoveryLink[];
  /** Endpoints this artifact advertises. */
  endpoints: string[];
  /** The start of the document that was read, for display. */
  preview?: string;
}

export type DiscoveryTransport = 'streamable-http' | 'sse';

export interface DiscoveredEndpoint {
  url: string;
  transport: DiscoveryTransport;
  /** Titles of the rows that advertise it. */
  sources: string[];
  /** The playground route that opens and connects to it. */
  inspectorPath: string;
}

export interface DiscoveryReport {
  input: string;
  /** Host (and port, if any) that was checked. */
  domain: string;
  origin: string;
  checkedAt: string;
  rows: DiscoveryRow[];
  endpoints: DiscoveredEndpoint[];
}

export interface DiscoveryCatalogEntry {
  id: string;
  name: string;
  /** Server page on mcptest.io. */
  path: string;
  endpoints: Array<{ url: string; transport: DiscoveryTransport }>;
}

export interface DiscoveryDependencies {
  fetch: DiscoveryFetch;
  catalog?: readonly DiscoveryCatalogEntry[];
  now?: () => Date;
  discoverOAuth?: typeof discoverOAuthMetadata;
  maxEndpoints?: number;
}

export interface DiscoveryTarget {
  domain: string;
  hostname: string;
  origin: string;
}

const LOOPBACK_HOSTNAMES = new Set(['localhost', '127.0.0.1', '[::1]']);
const isLoopbackHostname = (hostname: string): boolean => (
  LOOPBACK_HOSTNAMES.has(hostname) || hostname.endsWith('.localhost')
);

/**
 * Reads a domain the way people type it: `example.com`, `https://example.com/mcp`,
 * `Example.COM.`. Paths are ignored. Loopback hosts are checked over plain http
 * (local development); every other host over https.
 */
export const normalizeDiscoveryTarget = (input: string): DiscoveryTarget | { error: string } => {
  const value = input.trim();
  if (!value) return { error: 'Enter a domain, for example example.com.' };
  const hasScheme = /^[a-z][a-z0-9+.-]*:\/\//i.test(value);
  let url: URL;
  try {
    url = new URL(hasScheme ? value : `https://${value}`);
  } catch {
    return { error: `${value} is not a domain name.` };
  }
  if (url.protocol !== 'https:' && url.protocol !== 'http:') {
    return { error: 'Enter a domain or an http(s) URL.' };
  }
  if (url.username || url.password) return { error: 'Leave credentials out of the domain.' };
  const hostname = url.hostname.toLowerCase().replace(/\.$/, '');
  const loopback = isLoopbackHostname(hostname);
  if (!loopback && (!hostname.includes('.') || hostname.startsWith('.') || hostname.includes('..'))) {
    return { error: `${hostname || value} is not a public domain name.` };
  }
  const protocol = loopback && !(hasScheme && url.protocol === 'https:') ? 'http:' : 'https:';
  const domain = url.port ? `${hostname}:${url.port}` : hostname;
  return { domain, hostname, origin: `${protocol}//${domain}` };
};

/** Whether `url` is served from `hostname` or one of its subdomains. */
export const isUrlOnDomain = (url: string, hostname: string): boolean => {
  try {
    const host = new URL(url).hostname.toLowerCase().replace(/\.$/, '');
    return host === hostname || host.endsWith(`.${hostname}`);
  } catch {
    return false;
  }
};

const normalizeEndpoint = (url: string): string | undefined => {
  try {
    const parsed = new URL(url);
    if (parsed.protocol !== 'https:' && parsed.protocol !== 'http:') return undefined;
    parsed.hash = '';
    return parsed.toString();
  } catch {
    return undefined;
  }
};

const preview = (body: string): string => (
  body.length > MAX_PREVIEW_CHARS ? `${body.slice(0, MAX_PREVIEW_CHARS)}\n…` : body
);

const attemptFromResponse = (response: DiscoveryResponse): DiscoveryAttempt => ({
  url: response.url,
  route: response.route,
  status: response.status,
  contentType: response.contentType,
});

const attemptFromError = (url: string, error: unknown): DiscoveryAttempt => (
  error instanceof DiscoveryFetchError
    ? { url, route: error.route, failure: error.kind, message: error.message }
    : { url, failure: 'network', message: error instanceof Error ? error.message : String(error) }
);

/** Plain-language reason a URL could not be read, honest about CORS. */
export const describeFailure = (attempt: DiscoveryAttempt): string => {
  switch (attempt.failure) {
    case 'cors':
      return 'The browser could not read the response. Either the URL sends no CORS headers (Access-Control-Allow-Origin), or the host could not be reached; a browser cannot tell the two apart, and the mcptest proxy was not available to check from outside.';
    case 'not-allowed':
      return 'The mcptest proxy only fetches MCP discovery documents (.well-known paths, /server-card and the registry API) and refused this URL. It was not readable directly from the browser either.';
    case 'timeout':
      return 'No response arrived before the timeout.';
    case 'too-large':
      return 'The response was larger than the size limit for a discovery document.';
    case 'proxy-limit':
      return 'The mcptest proxy rate limit was reached. Wait a minute, or sign in to lift the limit, and check again.';
    default:
      return `The host could not be reached${attempt.message ? ` (${attempt.message})` : ''}.`;
  }
};

const corsWarning = (response: DiscoveryResponse): string[] => (
  response.route === 'proxy'
    ? ['The browser could not read this URL directly, so mcptest read it through its proxy. Browser-based MCP clients cannot read it either: serve it with Access-Control-Allow-Origin: *.']
    : []
);

const mediaTypeOf = (contentType: string | undefined): string => (
  (contentType ?? '').split(';')[0].trim().toLowerCase()
);

const contentTypeWarning = (response: DiscoveryResponse, preferred: string): string[] => {
  const mediaType = mediaTypeOf(response.contentType);
  if (mediaType === preferred || mediaType === 'application/json') return [];
  return [`Served as ${mediaType || 'no Content-Type'}; use Content-Type: ${preferred} (or application/json).`];
};

type ParsedDocument =
  | { kind: 'json'; value: unknown; response: DiscoveryResponse }
  | { kind: 'missing'; summary: string; response?: DiscoveryResponse; attempt: DiscoveryAttempt }
  | { kind: 'bad'; summary: string; errors: string[]; response?: DiscoveryResponse; attempt: DiscoveryAttempt }
  | { kind: 'unreachable'; summary: string; attempt: DiscoveryAttempt };

const looksLikeHtml = (response: DiscoveryResponse): boolean => (
  mediaTypeOf(response.contentType) === 'text/html' || /^\s*</.test(response.body)
);

/**
 * Fetches a JSON discovery document and sorts the outcome into found (JSON),
 * missing (404 and friends, or an HTML catch-all page), bad and unreachable.
 */
const fetchJsonDocument = async (
  fetchDocument: DiscoveryFetch,
  url: string,
  accept: string,
  missingStatuses: ReadonlySet<number> = new Set([404, 410])
): Promise<ParsedDocument> => {
  let response: DiscoveryResponse;
  try {
    response = await fetchDocument(url, { accept });
  } catch (error) {
    const attempt = attemptFromError(url, error);
    return { kind: 'unreachable', summary: describeFailure(attempt), attempt };
  }
  const attempt = attemptFromResponse(response);
  if (missingStatuses.has(response.status)) {
    return { kind: 'missing', summary: `Nothing here (HTTP ${response.status}).`, response, attempt };
  }
  if (response.status < 200 || response.status > 299) {
    return {
      kind: 'bad',
      summary: `The server answered HTTP ${response.status}.`,
      errors: [`A discovery document must be served publicly with HTTP 200; this URL answered HTTP ${response.status}.`],
      response,
      attempt,
    };
  }
  try {
    return { kind: 'json', value: JSON.parse(response.body), response };
  } catch {
    if (looksLikeHtml(response)) {
      return {
        kind: 'missing',
        summary: 'The URL returns an HTML page (usually a site-wide catch-all), not a discovery document.',
        response,
        attempt,
      };
    }
    return {
      kind: 'bad',
      summary: 'The response is not valid JSON.',
      errors: ['The body is not valid JSON.'],
      response,
      attempt,
    };
  }
};

interface RowSeed {
  id: string;
  kind: DiscoveryRowKind;
  title: string;
  source: string;
  url: string;
}

const emptyRow = (seed: RowSeed, status: DiscoveryRowStatus, summary: string): DiscoveryRow => ({
  ...seed,
  status,
  attempts: [],
  summary,
  errors: [],
  warnings: [],
  links: [],
  endpoints: [],
});

/** The row for a document that did not parse as JSON. */
const rowForUnparsed = (seed: RowSeed, document: Exclude<ParsedDocument, { kind: 'json' }>): DiscoveryRow => {
  const status: DiscoveryRowStatus = document.kind === 'missing'
    ? 'not-found'
    : document.kind === 'bad' ? 'invalid' : 'unreachable';
  const row = emptyRow(seed, status, document.summary);
  row.attempts.push(document.attempt);
  if (document.attempt.url) row.url = document.attempt.url;
  if (document.kind === 'bad') {
    row.errors.push(...document.errors);
    if (document.response) {
      row.warnings.push(...corsWarning(document.response));
      if (document.response.body) row.preview = preview(document.response.body);
    }
  }
  return row;
};

const endpointsFromCard = (validation: ServerCardValidation): string[] => (
  (validation.card?.remotes ?? [])
    .map(remote => resolveRemoteUrl(remote))
    .filter((url): url is string => Boolean(url))
);

const transportsFromCard = (validation: ServerCardValidation): Map<string, DiscoveryTransport> => new Map(
  (validation.card?.remotes ?? []).flatMap(remote => {
    const url = resolveRemoteUrl(remote);
    const normalized = url ? normalizeEndpoint(url) : undefined;
    return normalized ? [[normalized, remote.type] as const] : [];
  })
);

/**
 * Endpoints in documents that are not Server Cards: older `.well-known/mcp.json`
 * files and early drafts used `endpoint`, `url`, `mcp_url`, `servers[]` or
 * an `mcpServers` map.
 */
const endpointsFromLegacyDocument = (value: unknown): string[] => {
  if (!value || typeof value !== 'object') return [];
  const record = value as Record<string, unknown>;
  const urls: unknown[] = [record.endpoint, record.url, record.mcp_url, record.mcpUrl, record.serverUrl];
  for (const key of ['servers', 'remotes', 'endpoints']) {
    const list = record[key];
    if (Array.isArray(list)) {
      for (const item of list) {
        urls.push(typeof item === 'string' ? item : (item as Record<string, unknown> | null)?.url);
      }
    }
  }
  const map = record.mcpServers;
  if (map && typeof map === 'object' && !Array.isArray(map)) {
    for (const item of Object.values(map as Record<string, unknown>)) {
      urls.push((item as Record<string, unknown> | null)?.url);
    }
  }
  return urls
    .filter((url): url is string => typeof url === 'string')
    .map(url => normalizeEndpoint(url))
    .filter((url): url is string => Boolean(url));
};

interface CardRowResult {
  row: DiscoveryRow;
  transports: Map<string, DiscoveryTransport>;
}

/** Validates one card document into a row. */
const cardRow = (
  seed: RowSeed,
  value: unknown,
  response: DiscoveryResponse | undefined,
  { legacy = false }: { legacy?: boolean } = {}
): CardRowResult => {
  const validation = validateServerCard(value);
  const transports = transportsFromCard(validation);
  const row = emptyRow(seed, validation.valid ? 'found' : 'invalid', '');
  if (response) {
    row.attempts.push(attemptFromResponse(response));
    row.url = response.url;
    row.preview = preview(response.body);
    row.warnings.push(...corsWarning(response), ...contentTypeWarning(response, SERVER_CARD_MEDIA_TYPE));
  }
  if (validation.valid && validation.card) {
    row.endpoints = endpointsFromCard(validation);
    const label = validation.card.title ?? validation.card.name;
    row.summary = `A valid Server Card for ${label} ${validation.card.version}`
      + (row.endpoints.length ? ` with ${row.endpoints.length} remote endpoint${row.endpoints.length === 1 ? '' : 's'}.` : '.');
    row.warnings.push(...validation.warnings);
    if (legacy) {
      row.warnings.push('This location is not part of the final SEP-2127; clients that follow the SEP look for an AI Catalog at /.well-known/ai-catalog.json and for <endpoint>/server-card.');
    }
    return { row, transports };
  }
  const legacyEndpoints = endpointsFromLegacyDocument(value);
  row.endpoints = legacyEndpoints;
  row.errors.push(...validation.errors);
  row.summary = legacyEndpoints.length
    ? `JSON that names ${legacyEndpoints.length} endpoint${legacyEndpoints.length === 1 ? '' : 's'}, but it is not a valid SEP-2127 Server Card.`
    : 'JSON, but not a valid SEP-2127 Server Card.';
  return { row, transports };
};

interface WellKnownLocation {
  id: string;
  path: string;
  title: string;
  source: string;
  list?: boolean;
  legacy?: boolean;
}

/** The domain-root card locations, in the order the page lists them. */
export const WELL_KNOWN_CARD_LOCATIONS: readonly WellKnownLocation[] = [
  { id: 'well-known-server-card', path: '/.well-known/mcp/server-card.json', title: 'Server Card', source: 'SEP-2127 draft location', legacy: true },
  { id: 'well-known-server-cards', path: '/.well-known/mcp/server-cards.json', title: 'Server Card list', source: 'SEP-2127 draft location', list: true, legacy: true },
  { id: 'legacy-mcp-server-card', path: '/.well-known/mcp-server-card', title: 'Legacy server card', source: 'Seen in the wild', legacy: true },
  { id: 'legacy-mcp-json', path: '/.well-known/mcp.json', title: 'Legacy mcp.json', source: 'Seen in the wild', legacy: true },
];
export const AI_CATALOG_PATH = '/.well-known/ai-catalog.json';
export const SERVER_CARD_SUFFIX = '/server-card';

const cardsInList = (value: unknown): unknown[] | undefined => {
  if (Array.isArray(value)) return value;
  if (!value || typeof value !== 'object') return undefined;
  const record = value as Record<string, unknown>;
  for (const key of ['cards', 'serverCards', 'servers']) {
    if (Array.isArray(record[key])) return record[key] as unknown[];
  }
  return undefined;
};

const checkWellKnownLocation = async (
  fetchDocument: DiscoveryFetch,
  origin: string,
  location: WellKnownLocation
): Promise<CardRowResult> => {
  const seed: RowSeed = {
    id: location.id,
    kind: 'server-card',
    title: location.title,
    source: location.source,
    url: `${origin}${location.path}`,
  };
  const document = await fetchJsonDocument(fetchDocument, seed.url, `${SERVER_CARD_MEDIA_TYPE}, application/json`);
  if (document.kind !== 'json') return { row: rowForUnparsed(seed, document), transports: new Map() };
  if (!location.list) return cardRow(seed, document.value, document.response, { legacy: location.legacy });

  const cards = cardsInList(document.value);
  if (!cards) {
    const row = emptyRow(seed, 'invalid', 'JSON, but not a list of Server Cards.');
    row.attempts.push(attemptFromResponse(document.response));
    row.url = document.response.url;
    row.preview = preview(document.response.body);
    row.errors.push('Expected an array of Server Cards (or an object with a "cards" array).');
    return { row, transports: new Map() };
  }
  const results = cards.slice(0, MAX_AI_CATALOG_ENTRIES).map((card, index) => cardRow(
    { ...seed, id: `${seed.id}-${index}` },
    card,
    undefined
  ));
  const invalid = results.filter(result => result.row.status !== 'found');
  const row = emptyRow(seed, cards.length > 0 && invalid.length === 0 ? 'found' : 'invalid', '');
  row.attempts.push(attemptFromResponse(document.response));
  row.url = document.response.url;
  row.preview = preview(document.response.body);
  row.warnings.push(...corsWarning(document.response), ...contentTypeWarning(document.response, SERVER_CARD_MEDIA_TYPE));
  row.warnings.push('This location is not part of the final SEP-2127; publish each card at <endpoint>/server-card and list it in /.well-known/ai-catalog.json.');
  results.forEach((result, index) => {
    row.errors.push(...result.row.errors.map(error => `cards[${index}] ${error}`));
    row.warnings.push(...result.row.warnings.map(warning => `cards[${index}] ${warning}`));
    row.endpoints.push(...result.row.endpoints);
  });
  row.summary = cards.length === 0
    ? 'An empty list of Server Cards.'
    : `${cards.length} card${cards.length === 1 ? '' : 's'}, ${cards.length - invalid.length} valid.`;
  if (cards.length === 0) row.errors.push('The list is empty.');
  return {
    row,
    transports: new Map(results.flatMap(result => [...result.transports])),
  };
};

const MCP_CARD_ENTRY_TYPE = SERVER_CARD_MEDIA_TYPE;

/** /.well-known/ai-catalog.json and the Server Cards its entries point to or embed. */
const checkAiCatalog = async (
  fetchDocument: DiscoveryFetch,
  origin: string
): Promise<CardRowResult[]> => {
  const seed: RowSeed = {
    id: 'ai-catalog',
    kind: 'ai-catalog',
    title: 'AI Catalog',
    source: 'SEP-2127 domain discovery',
    url: `${origin}${AI_CATALOG_PATH}`,
  };
  const document = await fetchJsonDocument(fetchDocument, seed.url, `${AI_CATALOG_MEDIA_TYPE}, application/json`);
  if (document.kind !== 'json') return [{ row: rowForUnparsed(seed, document), transports: new Map() }];

  const row = emptyRow(seed, 'found', '');
  row.attempts.push(attemptFromResponse(document.response));
  row.url = document.response.url;
  row.preview = preview(document.response.body);
  row.warnings.push(...corsWarning(document.response), ...contentTypeWarning(document.response, AI_CATALOG_MEDIA_TYPE));
  const catalog = document.value as { specVersion?: unknown; entries?: unknown } | null;
  if (!catalog || typeof catalog !== 'object' || !Array.isArray(catalog.entries)) {
    row.status = 'invalid';
    row.summary = 'JSON, but not an AI Catalog.';
    row.errors.push('An AI Catalog is an object with an "entries" array.');
    return [{ row, transports: new Map() }];
  }
  if (typeof catalog.specVersion !== 'string') row.warnings.push('specVersion is missing; AI Catalogs declare it (for example "1.0").');

  const entries = (catalog.entries as unknown[]).filter(entry => (
    (entry as { type?: unknown } | null)?.type === MCP_CARD_ENTRY_TYPE
  ));
  if (entries.length === 0) {
    row.status = 'not-found';
    row.summary = `An AI Catalog with ${catalog.entries.length} entr${catalog.entries.length === 1 ? 'y' : 'ies'}, none of type ${MCP_CARD_ENTRY_TYPE}.`;
    return [{ row, transports: new Map() }];
  }

  const cardResults = await Promise.all(entries.slice(0, MAX_AI_CATALOG_ENTRIES).map(async (entryValue, index) => {
    const entry = entryValue as { identifier?: unknown; url?: unknown; data?: unknown };
    const label = typeof entry.identifier === 'string' ? entry.identifier : `entries[${index}]`;
    const entrySeed: RowSeed = {
      id: `ai-catalog-entry-${index}`,
      kind: 'server-card',
      title: `Server Card: ${label}`,
      source: 'Listed in the AI Catalog',
      url: typeof entry.url === 'string' ? entry.url : row.url,
    };
    const entryErrors: string[] = [];
    if (typeof entry.identifier !== 'string' || !entry.identifier) entryErrors.push(`entries[${index}]: identifier is required.`);
    const hasUrl = entry.url !== undefined;
    const hasData = entry.data !== undefined;
    if (hasUrl === hasData) entryErrors.push(`entries[${index}]: exactly one of url or data is required.`);
    row.errors.push(...entryErrors);

    if (hasData && !hasUrl) {
      const result = cardRow({ ...entrySeed, source: 'Embedded in the AI Catalog' }, entry.data, undefined);
      result.row.summary = `${result.row.summary} (embedded)`;
      return result;
    }
    if (typeof entry.url !== 'string' || !normalizeEndpoint(entry.url)) {
      const invalid = emptyRow(entrySeed, 'invalid', 'The entry has no usable card URL.');
      invalid.errors.push(...entryErrors);
      return { row: invalid, transports: new Map<string, DiscoveryTransport>() };
    }
    const card = await fetchJsonDocument(fetchDocument, entry.url, SERVER_CARD_MEDIA_TYPE);
    if (card.kind !== 'json') {
      const unparsed = rowForUnparsed(entrySeed, card);
      if (unparsed.status === 'not-found') {
        unparsed.status = 'invalid';
        unparsed.errors.push('The AI Catalog points to a Server Card that does not exist.');
      }
      return { row: unparsed, transports: new Map<string, DiscoveryTransport>() };
    }
    return cardRow(entrySeed, card.value, card.response);
  }));

  const valid = cardResults.filter(result => result.row.status === 'found').length;
  row.summary = `An AI Catalog listing ${entries.length} MCP Server Card${entries.length === 1 ? '' : 's'}, ${valid} valid.`;
  if (row.errors.length > 0) row.status = 'invalid';
  return [{ row, transports: new Map() }, ...cardResults];
};

const endpointCardUrl = (endpoint: string): string => {
  const url = new URL(endpoint);
  url.pathname = `${url.pathname.replace(/\/+$/, '')}${SERVER_CARD_SUFFIX}`;
  url.search = '';
  return url.toString();
};

/** `GET <streamable-http-url>/server-card`, the location SEP-2127 reserves. */
const checkEndpointCard = async (
  fetchDocument: DiscoveryFetch,
  endpoint: string,
  index: number
): Promise<CardRowResult> => {
  const seed: RowSeed = {
    id: `endpoint-server-card-${index}`,
    kind: 'server-card',
    title: 'Server Card at the endpoint',
    source: 'SEP-2127 recommended location',
    url: endpointCardUrl(endpoint),
  };
  // An MCP endpoint without the route answers with whatever its router does for unknown paths.
  const document = await fetchJsonDocument(fetchDocument, seed.url, SERVER_CARD_MEDIA_TYPE, new Set([400, 404, 405, 406, 410]));
  if (document.kind !== 'json') return { row: rowForUnparsed(seed, document), transports: new Map() };
  return cardRow(seed, document.value, document.response);
};

/**
 * Adapts the checker's fetch to the SDK's FetchLike, recording each request.
 * A failure is a TypeError, which the SDK treats as "try the next location".
 */
const recordingFetchLike = (fetchDocument: DiscoveryFetch, attempts: DiscoveryAttempt[]): FetchLike => async (input, init) => {
  const url = String(input);
  const headers = new Headers(init?.headers);
  const protocolVersion = headers.get('MCP-Protocol-Version');
  try {
    const response = await fetchDocument(url, {
      accept: headers.get('Accept') ?? 'application/json',
      ...(protocolVersion ? { headers: { 'MCP-Protocol-Version': protocolVersion } } : {}),
    });
    attempts.push(attemptFromResponse(response));
    const nullBody = response.status === 204 || response.status === 304;
    return new Response(nullBody ? null : response.body, {
      status: response.status,
      headers: response.contentType ? { 'Content-Type': response.contentType } : {},
    });
  } catch (error) {
    attempts.push(attemptFromError(url, error));
    throw new TypeError(error instanceof Error ? error.message : 'Failed to fetch');
  }
};

const isResourceMetadataUrl = (url: string): boolean => url.includes('/.well-known/oauth-protected-resource');

const sameResource = (resource: string, endpoint: string): boolean => {
  const strip = (value: string) => value.replace(/\/+$/, '');
  try {
    const declared = new URL(resource);
    const actual = new URL(endpoint);
    return declared.origin === actual.origin
      && (strip(actual.pathname).startsWith(strip(declared.pathname)) || strip(declared.pathname) === '');
  } catch {
    return false;
  }
};

const checkOAuth = async (
  fetchDocument: DiscoveryFetch,
  discoverOAuth: typeof discoverOAuthMetadata,
  endpoint: string,
  index: number
): Promise<DiscoveryRow> => {
  const attempts: DiscoveryAttempt[] = [];
  const seedUrl = new URL(endpoint);
  const seed: RowSeed = {
    id: `oauth-${index}`,
    kind: 'oauth',
    title: 'OAuth protected resource metadata',
    source: 'RFC 9728 and RFC 8414',
    url: `${seedUrl.origin}/.well-known/oauth-protected-resource${seedUrl.pathname.replace(/\/+$/, '')}`,
  };
  const discovery = await discoverOAuth(endpoint, { fetchFn: recordingFetchLike(fetchDocument, attempts) });
  const row = emptyRow(seed, 'not-found', '');
  row.attempts = attempts;
  const resourceAttempts = attempts.filter(attempt => isResourceMetadataUrl(attempt.url));
  const answered = resourceAttempts.find(attempt => attempt.status !== undefined && attempt.status >= 200 && attempt.status < 300);
  row.url = answered?.url ?? resourceAttempts[0]?.url ?? seed.url;

  const metadata = discovery.resourceMetadata;
  if (!metadata) {
    if (answered) {
      row.status = 'invalid';
      row.summary = 'Protected resource metadata is served, but it is not valid.';
      row.errors.push(discovery.resourceMetadataError ?? 'The document could not be parsed.');
    } else if (resourceAttempts.length > 0 && resourceAttempts.every(attempt => attempt.failure)) {
      row.status = 'unreachable';
      row.summary = describeFailure(resourceAttempts[0]);
    } else {
      row.summary = 'No protected resource metadata. That is expected for a server without OAuth; a server that requires OAuth must serve it so clients can find its authorization server.';
    }
    return row;
  }

  if (resourceAttempts.some(attempt => attempt.route === 'proxy' && attempt.status !== undefined)) {
    row.warnings.push('The protected resource metadata is not readable from a browser (no CORS headers). Browser-based MCP clients cannot discover the authorization server; serve it with Access-Control-Allow-Origin: *.');
  }
  if (!sameResource(metadata.resource, endpoint)) {
    row.warnings.push(`resource is ${metadata.resource}, which does not identify ${endpoint}; clients reject metadata for a different resource.`);
  }
  if (discovery.authorizationServers.length === 0) {
    row.status = 'invalid';
    row.summary = 'Protected resource metadata is served, but it names no authorization server.';
    row.errors.push('authorization_servers is missing or empty.');
    return row;
  }
  const authorization = discovery.authorizationMetadata;
  if (!authorization) {
    row.status = 'invalid';
    row.summary = `Protected resource metadata names ${discovery.authorizationServers.join(', ')}, but no authorization server metadata was found there.`;
    row.errors.push(...discovery.authorizationErrors);
    return row;
  }

  row.status = 'found';
  row.summary = `Names ${discovery.authorizationServer}; its authorization server metadata is valid.`;
  row.links.push({ label: 'Authorization server', href: discovery.authorizationServer ?? authorization.issuer, external: true });
  if (!authorization.code_challenge_methods_supported?.includes('S256')) {
    row.warnings.push('The authorization server does not advertise S256 in code_challenge_methods_supported; MCP clients require PKCE with S256.');
  }
  const registration = authorization as { registration_endpoint?: unknown; client_id_metadata_document_supported?: unknown };
  if (!registration.registration_endpoint && registration.client_id_metadata_document_supported !== true) {
    row.warnings.push('No registration_endpoint and no client_id_metadata_document_supported: clients without a pre-registered client ID cannot sign in.');
  }
  return row;
};

interface RegistryServer {
  name?: unknown;
  title?: unknown;
  version?: unknown;
  remotes?: unknown;
}

interface RegistryEntry {
  server?: RegistryServer;
  _meta?: Record<string, { status?: unknown } | undefined>;
}

/** Name fragments the registry search matches for a domain: `com.example` and `example`. */
export const registrySearchTerms = (hostname: string): string[] => {
  const labels = hostname.split('.').filter(Boolean);
  // IP literals and loopback hosts have no reverse-DNS namespace.
  if (labels.length < 2 || isLoopbackHostname(hostname) || /^[\d.]+$|^\[/.test(hostname)) return [];
  const terms = [labels.slice().reverse().join('.')];
  let label = labels[labels.length - 2];
  // co.uk, com.au: the name is one label further in.
  if (label.length <= 3 && labels.length >= 3) label = labels[labels.length - 3];
  if (label.length >= 3 && !terms.includes(label)) terms.push(label);
  return terms;
};

export const registrySearchUrl = (term: string): string => {
  const url = new URL(MCP_REGISTRY_SERVERS_PATH, MCP_REGISTRY_ORIGIN);
  url.searchParams.set('search', term);
  url.searchParams.set('version', 'latest');
  url.searchParams.set('limit', String(REGISTRY_PAGE_SIZE));
  return url.toString();
};

const registryEntryUrl = (name: string): string => (
  `${MCP_REGISTRY_ORIGIN}${MCP_REGISTRY_SERVERS_PATH}/${encodeURIComponent(name)}/versions/latest`
);

interface RegistryRowResult {
  row: DiscoveryRow;
  transports: Map<string, DiscoveryTransport>;
}

const checkRegistry = async (fetchDocument: DiscoveryFetch, hostname: string): Promise<RegistryRowResult> => {
  const terms = registrySearchTerms(hostname);
  const seed: RowSeed = {
    id: 'registry',
    kind: 'registry',
    title: 'Official MCP Registry',
    source: 'registry.modelcontextprotocol.io',
    url: terms.length ? registrySearchUrl(terms[0]) : `${MCP_REGISTRY_ORIGIN}${MCP_REGISTRY_SERVERS_PATH}`,
  };
  const transports = new Map<string, DiscoveryTransport>();
  if (terms.length === 0) {
    return { row: emptyRow(seed, 'skipped', 'Registry names are reverse-DNS domain namespaces; this host has none to search.'), transports };
  }

  const row = emptyRow(seed, 'not-found', '');
  const documents = await Promise.all(terms.map(term => fetchJsonDocument(fetchDocument, registrySearchUrl(term), 'application/json')));
  const matches = new Map<string, { name: string; remotes: Array<{ url: string; type: DiscoveryTransport }>; status?: string }>();
  let truncated = false;
  for (const document of documents) {
    if (document.kind !== 'json') {
      row.attempts.push(document.attempt);
      if (document.kind === 'bad') row.errors.push(...document.errors);
      continue;
    }
    row.attempts.push(attemptFromResponse(document.response));
    const body = document.value as { servers?: unknown; metadata?: { nextCursor?: unknown } } | null;
    if (!body || !Array.isArray(body.servers)) {
      row.errors.push(`${document.response.url}: the response has no servers array.`);
      continue;
    }
    if (body.metadata?.nextCursor) truncated = true;
    for (const entry of body.servers as RegistryEntry[]) {
      const server = entry?.server;
      if (!server || typeof server.name !== 'string' || !Array.isArray(server.remotes)) continue;
      const remotes = (server.remotes as Array<{ url?: unknown; type?: unknown }>)
        .filter(remote => typeof remote?.url === 'string' && isUrlOnDomain(remote.url, hostname))
        .map(remote => ({
          url: normalizeEndpoint(remote.url as string) ?? (remote.url as string),
          type: (remote.type === 'sse' ? 'sse' : 'streamable-http') as DiscoveryTransport,
        }));
      if (remotes.length === 0) continue;
      const status = entry._meta?.['io.modelcontextprotocol.registry/official']?.status;
      matches.set(server.name, { name: server.name, remotes, status: typeof status === 'string' ? status : undefined });
    }
  }

  if (row.attempts.length > 0) row.url = row.attempts[0].url;
  const anyRead = documents.some(document => document.kind === 'json');
  if (!anyRead) {
    const failed = documents.every(document => document.kind === 'unreachable');
    row.status = failed ? 'unreachable' : 'invalid';
    row.summary = failed && row.attempts[0] ? describeFailure(row.attempts[0]) : 'The registry did not return a server list.';
    return { row, transports };
  }

  const active = [...matches.values()].filter(match => match.status !== 'deleted');
  for (const match of active) {
    row.links.push({ label: match.name, href: registryEntryUrl(match.name), external: true });
    if (match.status === 'deprecated') row.warnings.push(`${match.name} is marked deprecated in the registry.`);
    for (const remote of match.remotes) {
      if (!remote.url.startsWith('https://')) row.warnings.push(`${match.name}: ${remote.url} is not an https URL.`);
      if (!row.endpoints.includes(remote.url)) row.endpoints.push(remote.url);
      if (!transports.has(remote.url)) transports.set(remote.url, remote.type);
    }
  }
  if (truncated) row.warnings.push(`The search returned more than ${REGISTRY_PAGE_SIZE} names; only the first page was checked.`);
  if (active.length > 0) {
    row.status = 'found';
    row.summary = `${active.length} registry entr${active.length === 1 ? 'y publishes' : 'ies publish'} a remote endpoint on ${hostname}.`;
  } else {
    row.summary = `No registry entry named like ${terms.join(' or ')} publishes a remote on ${hostname}. The registry API searches names, so an entry published under an unrelated namespace would not appear here.`;
  }
  return { row, transports };
};

const checkCatalog = (
  catalog: readonly DiscoveryCatalogEntry[],
  hostname: string
): RegistryRowResult => {
  const seed: RowSeed = {
    id: 'catalog',
    kind: 'catalog',
    title: 'mcptest.io catalog',
    source: 'mcptest.io',
    url: '/catalog',
  };
  const transports = new Map<string, DiscoveryTransport>();
  const matches = catalog.filter(entry => entry.endpoints.some(endpoint => isUrlOnDomain(endpoint.url, hostname)));
  if (matches.length === 0) {
    const row = emptyRow(seed, 'not-found', `No catalog listing has an endpoint on ${hostname}.`);
    row.links.push({ label: 'Submit a server', href: '/submit' });
    return { row, transports };
  }
  const row = emptyRow(seed, 'found', `${matches.length} catalog listing${matches.length === 1 ? '' : 's'} on ${hostname}.`);
  for (const entry of matches) {
    row.links.push({ label: entry.name, href: entry.path });
    for (const endpoint of entry.endpoints.filter(candidate => isUrlOnDomain(candidate.url, hostname))) {
      const url = normalizeEndpoint(endpoint.url);
      if (!url) continue;
      if (!row.endpoints.includes(url)) row.endpoints.push(url);
      if (!transports.has(url)) transports.set(url, endpoint.transport);
    }
  }
  return { row, transports };
};

/**
 * One request per URL and Accept header per check: the SDK's CORS retry and the
 * root fallback of several endpoints on one origin ask for the same documents.
 */
const memoizeFetch = (fetchDocument: DiscoveryFetch): DiscoveryFetch => {
  const cache = new Map<string, Promise<DiscoveryResponse>>();
  return (url, request) => {
    const key = `${request?.accept ?? ''}\n${url}`;
    let pending = cache.get(key);
    if (!pending) {
      pending = fetchDocument(url, request);
      cache.set(key, pending);
    }
    return pending;
  };
};

export const checkMcpDiscovery = async (
  input: string,
  dependencies: DiscoveryDependencies
): Promise<DiscoveryReport> => {
  const target = normalizeDiscoveryTarget(input);
  if ('error' in target) throw new Error(target.error);
  const fetchDocument = memoizeFetch(dependencies.fetch);
  const discoverOAuth = dependencies.discoverOAuth ?? discoverOAuthMetadata;
  const maxEndpoints = dependencies.maxEndpoints ?? MAX_DISCOVERY_ENDPOINTS;
  const checkedAt = (dependencies.now?.() ?? new Date()).toISOString();

  const [wellKnown, aiCatalog, registry] = await Promise.all([
    Promise.all(WELL_KNOWN_CARD_LOCATIONS.map(location => checkWellKnownLocation(fetchDocument, target.origin, location))),
    checkAiCatalog(fetchDocument, target.origin),
    checkRegistry(fetchDocument, target.hostname),
  ]);
  const catalog = checkCatalog(dependencies.catalog ?? [], target.hostname);

  // Endpoints in the order their sources are listed; the first source names the transport.
  const endpoints = new Map<string, DiscoveredEndpoint>();
  const addEndpoints = (result: { row: DiscoveryRow; transports: Map<string, DiscoveryTransport> }) => {
    for (const url of result.row.endpoints) {
      const normalized = normalizeEndpoint(url);
      if (!normalized) continue;
      const existing = endpoints.get(normalized);
      if (existing) {
        if (!existing.sources.includes(result.row.title)) existing.sources.push(result.row.title);
        continue;
      }
      const transport = result.transports.get(normalized) ?? 'streamable-http';
      endpoints.set(normalized, {
        url: normalized,
        transport,
        sources: [result.row.title],
        inspectorPath: getServerUrl(normalized, transport === 'sse' ? 'sse' : undefined),
      });
    }
  };
  [...wellKnown, ...aiCatalog, registry, catalog].forEach(addEndpoints);

  const checked = [...endpoints.values()].slice(0, maxEndpoints);
  const [endpointCards, oauthRows] = await Promise.all([
    Promise.all(checked.map((endpoint, index) => checkEndpointCard(fetchDocument, endpoint.url, index))),
    Promise.all(checked.map((endpoint, index) => checkOAuth(fetchDocument, discoverOAuth, endpoint.url, index))),
  ]);
  endpointCards.forEach((result, index) => {
    result.row.title = `Server Card at ${checked[index].url}`;
    addEndpoints(result);
  });
  oauthRows.forEach((row, index) => {
    row.title = `OAuth metadata for ${checked[index].url}`;
  });

  const rows: DiscoveryRow[] = [
    ...wellKnown.map(result => result.row),
    ...aiCatalog.map(result => result.row),
    ...endpointCards.map(result => result.row),
  ];
  if (checked.length === 0) {
    rows.push(emptyRow(
      { id: 'endpoint-server-card', kind: 'server-card', title: 'Server Card at the endpoint', source: 'SEP-2127 recommended location', url: `${target.origin}/mcp${SERVER_CARD_SUFFIX}` },
      'skipped',
      'No endpoint was found to look for <endpoint>/server-card on.'
    ));
  }
  rows.push(...oauthRows);
  if (checked.length === 0) {
    rows.push(emptyRow(
      { id: 'oauth', kind: 'oauth', title: 'OAuth protected resource metadata', source: 'RFC 9728 and RFC 8414', url: `${target.origin}/.well-known/oauth-protected-resource` },
      'skipped',
      'Checked for each discovered endpoint; none was found.'
    ));
  }
  if (endpoints.size > checked.length) {
    oauthRows[oauthRows.length - 1]?.warnings.push(`${endpoints.size - checked.length} more endpoint${endpoints.size - checked.length === 1 ? ' was' : 's were'} found; only the first ${maxEndpoints} are checked.`);
  }
  rows.push(registry.row, catalog.row);

  return {
    input,
    domain: target.domain,
    origin: target.origin,
    checkedAt,
    rows,
    endpoints: [...endpoints.values()],
  };
};

/** Whether any location served a valid Server Card. */
export const hasValidServerCard = (report: DiscoveryReport): boolean => (
  report.rows.some(row => row.kind === 'server-card' && row.status === 'found')
);

export interface DiscoveryFixGuidance {
  /** The endpoint the example card advertises; a placeholder when none was found. */
  endpoint: string;
  endpointKnown: boolean;
  cardUrl: string;
  card: string;
  cardContentType: string;
  catalogUrl: string;
  catalog: string;
  catalogContentType: string;
  headers: string;
}

/** Copy-paste guidance for a domain without a valid Server Card. */
export const buildDiscoveryFixGuidance = (report: DiscoveryReport): DiscoveryFixGuidance => {
  const known = report.endpoints.find(endpoint => isUrlOnDomain(endpoint.url, report.domain.replace(/:\d+$/, '')))
    ?? report.endpoints[0];
  const endpoint = known?.url ?? `${report.origin}/mcp`;
  const cardUrl = endpointCardUrl(endpoint);
  const host = report.domain.replace(/:\d+$/, '');
  const card = buildMinimalServerCard(report.domain, endpoint);
  const catalog = {
    specVersion: '1.0',
    entries: [{
      identifier: `urn:air:${host}:mcp:${card.name.split('/')[1]}`,
      type: SERVER_CARD_MEDIA_TYPE,
      url: cardUrl,
    }],
  };
  return {
    endpoint,
    endpointKnown: Boolean(known),
    cardUrl,
    card: JSON.stringify(card, null, 2),
    cardContentType: SERVER_CARD_MEDIA_TYPE,
    catalogUrl: `${report.origin}${AI_CATALOG_PATH}`,
    catalog: JSON.stringify(catalog, null, 2),
    catalogContentType: AI_CATALOG_MEDIA_TYPE,
    headers: [
      'Access-Control-Allow-Origin: *',
      'Access-Control-Allow-Methods: GET',
      'Access-Control-Allow-Headers: Content-Type, If-None-Match',
      'Access-Control-Expose-Headers: ETag',
      'Cache-Control: public, max-age=3600',
    ].join('\n'),
  };
};
