/**
 * Typed access to `clientCompatibility.json`: what each MCP client documents
 * about transports, protocol versions, authorization, headers, capabilities
 * and configuration. Every cell carries the page that states it and the day
 * it was checked; a value the vendor does not document is `unknown`.
 *
 * This module has no runtime imports besides the JSON file so the Node build
 * script can load it through native `require` (see generate-seo-pages.js).
 */
import rawData from './clientCompatibility.json' with { type: 'json' };
import type { HostId } from '../compatibility/types.ts';

export type Unknown = 'unknown';
/**
 * `limited` means documented but restricted (beta, plan-gated, or a subset of
 * accounts); the compatibility engine does not rely on limited support.
 */
export type SupportLevel = 'supported' | 'limited' | 'unsupported' | 'bridge-required' | Unknown;

export interface SourcedCell<T> {
  value: T | Unknown;
  /** Page that states the value, or that was checked and does not state it. */
  source: string;
  /** ISO date the source was last read for this cell. */
  verifiedOn: string;
  note?: string;
}

export interface SourcedText {
  /** Inline Markdown; wrap commands and paths in backticks. */
  text: string;
  source: string;
  verifiedOn: string;
}

export type ConfigurationKind = 'ui' | 'file' | 'cli';

export interface ConfigurationSurface extends SourcedText {
  kind: ConfigurationKind;
}

export interface ClientSourceLink {
  title: string;
  url: string;
}

/** Client runtime a callback belongs to, for clients whose desktop and hosted surfaces differ. */
export type ClientRuntime = 'desktop' | 'web' | 'agents' | 'cli';

export interface OAuthCallback {
  uri: string;
  /**
   * `required`: the client always uses this URI on its runtimes, so a server
   * registers every required URI. `conditional`: the client uses it only in
   * some connection modes (the note says which), so registering it neither
   * proves nor rules out compatibility.
   */
  use: 'required' | 'conditional';
  /** Runtimes that use this URI; omitted when every runtime of the client does. */
  runtimes?: readonly ClientRuntime[];
}

export type CapabilityName =
  | 'tools'
  | 'resources'
  | 'prompts'
  | 'resourceSubscriptions'
  | 'sampling'
  | 'elicitation'
  | 'tasks';

export interface ClientCompatibilityEntry {
  id: string;
  name: string;
  vendor: string;
  /** Product version or documentation revision the row describes. */
  version: SourcedCell<string>;
  /** Host profile in `src/compatibility` built from this entry, if any. */
  hostProfileId?: HostId;
  /** Use-track guide for this client. */
  guidePath?: string;
  documentationUrl: string;
  /** Oldest `verifiedOn` of any cell in the entry. */
  verifiedOn: string;
  sources: readonly ClientSourceLink[];
  transports: {
    streamableHttp: SourcedCell<SupportLevel>;
    legacySse: SourcedCell<SupportLevel>;
    stdio: SourcedCell<SupportLevel>;
  };
  protocolVersions: SourcedCell<readonly string[]>;
  auth: {
    oauthDcr: SourcedCell<SupportLevel>;
    preRegisteredClient: SourcedCell<SupportLevel>;
    cimd: SourcedCell<SupportLevel>;
    bearerToken: SourcedCell<SupportLevel>;
    apiKeyHeader: SourcedCell<SupportLevel>;
    none: SourcedCell<SupportLevel>;
  };
  /** Exact OAuth redirect URIs the client uses. Patterns with a variable port are notes, not values. */
  oauthCallbacks: SourcedCell<readonly OAuthCallback[]>;
  headers: {
    custom: SourcedCell<SupportLevel>;
    /** Headers the client requires the server or its network path to accept. */
    required: SourcedCell<readonly string[]>;
  };
  /** Whether the client can reach a server on a private network or localhost. */
  privateHosts: SourcedCell<SupportLevel>;
  capabilities: Record<CapabilityName, SourcedCell<SupportLevel>>;
  limitations: readonly SourcedText[];
  configuration: readonly ConfigurationSurface[];
}

export interface ClientCompatibilityData {
  schemaVersion: 1;
  clients: readonly ClientCompatibilityEntry[];
}

export const CLIENT_COMPAT_MAX_AGE_DAYS = 90;

const DATE_PATTERN = /^\d{4}-\d{2}-\d{2}$/;
const SUPPORT_LEVELS = new Set(['supported', 'limited', 'unsupported', 'bridge-required', 'unknown']);
const CALLBACK_USES = new Set(['required', 'conditional']);
const CLIENT_RUNTIMES = new Set(['desktop', 'web', 'agents', 'cli']);
const CONFIGURATION_KINDS = new Set(['ui', 'file', 'cli']);
export const CAPABILITY_NAMES: readonly CapabilityName[] = [
  'tools', 'resources', 'prompts', 'resourceSubscriptions', 'sampling', 'elicitation', 'tasks',
];

type CellKind = 'support' | 'text' | 'text-list' | 'callbacks';

/**
 * Every sourced cell an entry must have, with the kind of value it holds.
 * Validation and traversal both start from this list, so a cell that loses
 * its `source` or `value` is reported rather than skipped.
 */
export const CLIENT_CELL_PATHS: ReadonlyArray<readonly [path: string, kind: CellKind]> = [
  ['version', 'text'],
  ['transports.streamableHttp', 'support'],
  ['transports.legacySse', 'support'],
  ['transports.stdio', 'support'],
  ['protocolVersions', 'text-list'],
  ['auth.oauthDcr', 'support'],
  ['auth.preRegisteredClient', 'support'],
  ['auth.cimd', 'support'],
  ['auth.bearerToken', 'support'],
  ['auth.apiKeyHeader', 'support'],
  ['auth.none', 'support'],
  ['oauthCallbacks', 'callbacks'],
  ['headers.custom', 'support'],
  ['headers.required', 'text-list'],
  ['privateHosts', 'support'],
  ...CAPABILITY_NAMES.map((name) => [`capabilities.${name}`, 'support'] as const),
];

const isRecord = (value: unknown): value is Record<string, unknown> => (
  Boolean(value) && typeof value === 'object' && !Array.isArray(value)
);

const readPath = (value: unknown, path: string): unknown => path.split('.').reduce<unknown>(
  (current, key) => (isRecord(current) ? current[key] : undefined),
  value
);

const textItems = (entry: ClientCompatibilityEntry) => (['limitations', 'configuration'] as const).flatMap((key) => {
  const items: unknown = entry[key];
  return Array.isArray(items) ? items.map((item, index) => ({ path: `${key}[${index}]`, item: item as unknown })) : [];
});

/** Every sourced cell in an entry with a dotted path, for validation and freshness checks. */
export const listCells = (entry: ClientCompatibilityEntry): Array<{ path: string; cell: SourcedCell<unknown> | SourcedText }> => [
  ...CLIENT_CELL_PATHS.flatMap(([path]) => {
    const cell = readPath(entry, path);
    return isRecord(cell) ? [{ path, cell: cell as unknown as SourcedCell<unknown> }] : [];
  }),
  ...textItems(entry).flatMap(({ path, item }) => (isRecord(item) ? [{ path, cell: item as unknown as SourcedText }] : [])),
];

const isHttpsUrl = (value: unknown): boolean => {
  if (typeof value !== 'string') return false;
  try {
    return new URL(value).protocol === 'https:';
  } catch {
    return false;
  }
};

const isNonEmptyString = (value: unknown): value is string => typeof value === 'string' && value.trim() !== '';

const isStringList = (value: unknown): boolean => Array.isArray(value) && value.every(isNonEmptyString);

const isAbsoluteUrl = (value: unknown): boolean => {
  if (!isNonEmptyString(value)) return false;
  try {
    return ['https:', 'http:'].includes(new URL(value).protocol);
  } catch {
    return false;
  }
};

const callbackProblems = (value: unknown): string[] => {
  if (!Array.isArray(value)) return ['must be a list of callbacks'];
  return value.flatMap((callback, index) => {
    if (!isRecord(callback)) return [`[${index}] must be an object`];
    const problems: string[] = [];
    if (!isAbsoluteUrl(callback.uri)) problems.push(`[${index}].uri must be an absolute http(s) URL`);
    if (!CALLBACK_USES.has(callback.use as string)) problems.push(`[${index}].use must be required or conditional`);
    if (callback.runtimes !== undefined && !(
      Array.isArray(callback.runtimes)
      && callback.runtimes.length > 0
      && callback.runtimes.every((runtime) => CLIENT_RUNTIMES.has(runtime as string))
    )) {
      problems.push(`[${index}].runtimes must list ${[...CLIENT_RUNTIMES].join(', ')}`);
    }
    return problems;
  });
};

const valueProblem = (kind: CellKind, value: unknown): string | undefined => {
  if (kind === 'support') return SUPPORT_LEVELS.has(value as string) ? undefined : `has invalid support level ${String(value)}`;
  if (value === 'unknown') return undefined;
  if (kind === 'text') return isNonEmptyString(value) ? undefined : 'must be a string or unknown';
  if (kind === 'text-list') return isStringList(value) ? undefined : 'must be a list of strings or unknown';
  const problems = callbackProblems(value);
  return problems.length > 0 ? problems.join('; ') : undefined;
};

/** Required fields, cells and field-specific value types of one entry. */
const entryShapeProblems = (entry: Record<string, unknown>, where: (path: string) => string): string[] => {
  const problems: string[] = [];
  for (const key of ['id', 'name', 'vendor'] as const) {
    if (!isNonEmptyString(entry[key])) problems.push(`${where(key)} must be a non-empty string.`);
  }
  for (const key of ['hostProfileId', 'guidePath'] as const) {
    if (entry[key] !== undefined && !isNonEmptyString(entry[key])) problems.push(`${where(key)} must be a non-empty string.`);
  }
  if (!isHttpsUrl(entry.documentationUrl)) problems.push(`${where('documentationUrl')} must be an https URL.`);
  if (typeof entry.verifiedOn !== 'string' || !DATE_PATTERN.test(entry.verifiedOn)) problems.push(`${where('verifiedOn')} must be YYYY-MM-DD.`);
  if (!Array.isArray(entry.sources) || !entry.sources.every((link) => isRecord(link) && isNonEmptyString(link.title) && isHttpsUrl(link.url))) {
    problems.push(`${where('sources')} must list { title, url } with https URLs.`);
  }
  for (const [path, kind] of CLIENT_CELL_PATHS) {
    const cell = readPath(entry, path);
    if (!isRecord(cell)) {
      problems.push(`${where(path)} is missing.`);
      continue;
    }
    if (!('value' in cell)) problems.push(`${where(path)} has no value.`);
    else {
      const problem = valueProblem(kind, cell.value);
      if (problem) problems.push(`${where(path)} ${problem}.`);
    }
    if (cell.note !== undefined && typeof cell.note !== 'string') problems.push(`${where(path)}.note must be a string.`);
  }
  for (const key of ['limitations', 'configuration'] as const) {
    const items = entry[key];
    if (!Array.isArray(items)) {
      problems.push(`${where(key)} must be a list.`);
      continue;
    }
    items.forEach((item, index) => {
      const path = `${key}[${index}]`;
      if (!isRecord(item)) problems.push(`${where(path)} must be an object.`);
      else {
        if (!isNonEmptyString(item.text)) problems.push(`${where(path)}.text must be a non-empty string.`);
        if (key === 'configuration' && !CONFIGURATION_KINDS.has(item.kind as string)) {
          problems.push(`${where(path)}.kind must be ui, file or cli.`);
        }
      }
    });
  }
  return problems;
};

/** Structural problems in the data set; empty when the data is valid. */
export const validateClientCompatibility = (data: unknown): string[] => {
  if (!isRecord(data) || data.schemaVersion !== 1 || !Array.isArray(data.clients)) {
    return ['Client compatibility data must be { schemaVersion: 1, clients: [...] }.'];
  }
  const problems: string[] = [];
  const ids = new Set<string>();
  data.clients.forEach((raw: unknown, index) => {
    if (!isRecord(raw)) {
      problems.push(`clients[${index}] must be an object.`);
      return;
    }
    const id = isNonEmptyString(raw.id) ? raw.id : `clients[${index}]`;
    const where = (path: string) => `${id}${path ? `.${path}` : ''}`;
    if (ids.has(id)) problems.push(`Duplicate client id ${id}.`);
    ids.add(id);
    problems.push(...entryShapeProblems(raw, where));

    const entry = raw as unknown as ClientCompatibilityEntry;
    const cells = listCells(entry);
    for (const { path, cell } of cells) {
      if (!isHttpsUrl(cell.source)) problems.push(`${where(path)} needs an https source URL.`);
      if (typeof cell.verifiedOn !== 'string' || !DATE_PATTERN.test(cell.verifiedOn)) {
        problems.push(`${where(path)} needs verifiedOn as YYYY-MM-DD.`);
      }
    }
    const oldest = cells.map(({ cell }) => cell.verifiedOn).filter((date) => typeof date === 'string').sort()[0];
    if (oldest && oldest !== entry.verifiedOn) {
      problems.push(`${where('verifiedOn')} is ${entry.verifiedOn} but its oldest cell was verified on ${oldest}.`);
    }
    const sourceUrls = new Set(Array.isArray(entry.sources) ? entry.sources.map((link) => link?.url) : []);
    for (const { path, cell } of cells) {
      if (isHttpsUrl(cell.source) && !sourceUrls.has(cell.source)) {
        problems.push(`${where(path)} cites ${cell.source}, which is not listed in sources.`);
      }
    }
  });
  return problems;
};

const DAY_MS = 24 * 60 * 60 * 1000;

/** Cells whose `verifiedOn` is more than `maxAgeDays` before `today` (YYYY-MM-DD). */
export const findStaleClientCompatibilityCells = (
  data: ClientCompatibilityData,
  today: string,
  maxAgeDays = CLIENT_COMPAT_MAX_AGE_DAYS
): Array<{ clientId: string; path: string; verifiedOn: string; ageDays: number }> => {
  const now = Date.parse(`${today}T00:00:00Z`);
  return data.clients.flatMap((entry) => listCells(entry).flatMap(({ path, cell }) => {
    const ageDays = Math.floor((now - Date.parse(`${cell.verifiedOn}T00:00:00Z`)) / DAY_MS);
    return ageDays > maxAgeDays ? [{ clientId: entry.id, path, verifiedOn: cell.verifiedOn, ageDays }] : [];
  }));
};

// The JSON import is untyped at runtime, so validate it before anything reads it.
const problems = validateClientCompatibility(rawData);
if (problems.length > 0) {
  throw new Error(`clientCompatibility.json is invalid:\n${problems.join('\n')}`);
}

export const CLIENT_COMPATIBILITY = rawData as unknown as ClientCompatibilityData;

export const CLIENT_COMPATIBILITY_IDS: readonly string[] = CLIENT_COMPATIBILITY.clients.map(({ id }) => id);

export const getClientCompatibility = (id: string): ClientCompatibilityEntry | undefined =>
  CLIENT_COMPATIBILITY.clients.find((entry) => entry.id === id);

export const getClientCompatibilityForHost = (hostId: HostId): ClientCompatibilityEntry => {
  const entry = CLIENT_COMPATIBILITY.clients.find(({ hostProfileId }) => hostProfileId === hostId);
  if (!entry) throw new Error(`clientCompatibility.json has no entry for host profile ${hostId}.`);
  return entry;
};

/** Title of the listed source for a URL, falling back to its host name. */
export const getSourceTitle = (entry: ClientCompatibilityEntry, url: string): string =>
  entry.sources.find((source) => source.url === url)?.title ?? new URL(url).hostname;
