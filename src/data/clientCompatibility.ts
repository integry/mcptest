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
  oauthCallbacks: SourcedCell<readonly string[]>;
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
export const CAPABILITY_NAMES: readonly CapabilityName[] = [
  'tools', 'resources', 'prompts', 'resourceSubscriptions', 'sampling', 'elicitation', 'tasks',
];

const isCell = (value: unknown): value is SourcedCell<unknown> => (
  Boolean(value)
  && typeof value === 'object'
  && 'value' in (value as Record<string, unknown>)
  && 'source' in (value as Record<string, unknown>)
);

/** Every sourced cell in an entry with a dotted path, for validation and freshness checks. */
export const listCells = (entry: ClientCompatibilityEntry): Array<{ path: string; cell: SourcedCell<unknown> | SourcedText }> => {
  const cells: Array<{ path: string; cell: SourcedCell<unknown> | SourcedText }> = [];
  const visit = (value: unknown, path: string) => {
    if (isCell(value)) {
      cells.push({ path, cell: value });
      return;
    }
    if (Array.isArray(value)) {
      value.forEach((item, index) => {
        if (item && typeof item === 'object' && 'text' in item) cells.push({ path: `${path}[${index}]`, cell: item as SourcedText });
      });
      return;
    }
    if (value && typeof value === 'object') {
      for (const [key, child] of Object.entries(value)) visit(child, path ? `${path}.${key}` : key);
    }
  };
  const { version, transports, protocolVersions, auth, oauthCallbacks, headers, privateHosts, capabilities, limitations, configuration } = entry;
  visit({ version, transports, protocolVersions, auth, oauthCallbacks, headers, privateHosts, capabilities, limitations, configuration }, '');
  return cells;
};

const isHttpsUrl = (value: unknown): boolean => {
  if (typeof value !== 'string') return false;
  try {
    return new URL(value).protocol === 'https:';
  } catch {
    return false;
  }
};

/** Structural problems in the data set; empty when the data is valid. */
export const validateClientCompatibility = (data: ClientCompatibilityData): string[] => {
  const problems: string[] = [];
  const ids = new Set<string>();
  for (const entry of data.clients) {
    const where = (path: string) => `${entry.id}${path ? `.${path}` : ''}`;
    if (ids.has(entry.id)) problems.push(`Duplicate client id ${entry.id}.`);
    ids.add(entry.id);
    if (!isHttpsUrl(entry.documentationUrl)) problems.push(`${where('documentationUrl')} must be an https URL.`);
    if (!DATE_PATTERN.test(entry.verifiedOn)) problems.push(`${where('verifiedOn')} must be YYYY-MM-DD.`);
    const cells = listCells(entry);
    for (const { path, cell } of cells) {
      if (!isHttpsUrl(cell.source)) problems.push(`${where(path)} needs an https source URL.`);
      if (!DATE_PATTERN.test(cell.verifiedOn)) problems.push(`${where(path)} needs verifiedOn as YYYY-MM-DD.`);
      if ('value' in cell) {
        const value = cell.value;
        const isSupportCell = /^(transports|auth|capabilities)\.|^(headers\.custom|privateHosts)$/.test(path);
        if (isSupportCell && !SUPPORT_LEVELS.has(value as string)) {
          problems.push(`${where(path)} has invalid support level ${String(value)}.`);
        }
        if (value !== 'unknown' && !isSupportCell && !(typeof value === 'string' || Array.isArray(value))) {
          problems.push(`${where(path)} has an invalid value.`);
        }
      }
    }
    const oldest = cells.map(({ cell }) => cell.verifiedOn).sort()[0];
    if (oldest && oldest !== entry.verifiedOn) {
      problems.push(`${where('verifiedOn')} is ${entry.verifiedOn} but its oldest cell was verified on ${oldest}.`);
    }
    for (const capability of CAPABILITY_NAMES) {
      if (!entry.capabilities[capability]) problems.push(`${where(`capabilities.${capability}`)} is missing.`);
    }
    const sourceUrls = new Set(entry.sources.map(({ url }) => url));
    for (const { path, cell } of cells) {
      if (!sourceUrls.has(cell.source)) problems.push(`${where(path)} cites ${cell.source}, which is not listed in sources.`);
    }
  }
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

export const CLIENT_COMPATIBILITY = rawData as unknown as ClientCompatibilityData;

const problems = validateClientCompatibility(CLIENT_COMPATIBILITY);
if (problems.length > 0) {
  throw new Error(`clientCompatibility.json is invalid:\n${problems.join('\n')}`);
}

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
