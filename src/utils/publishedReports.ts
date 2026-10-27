// Client for the Worker's public report permalinks (cloudflare-worker/src/publishedReportRoutes.js).
//
// Publishing sends exactly the redacted JSON artifact the download produces. The
// removal token returned at publish time is shown once and kept only in this
// browser's localStorage so the publisher can delete the snapshot later.
import type { EvaluationReport } from './evaluation';
import type { OAuthTraceV1 } from './oauthTrace';
import { createReportDownload } from './reportDownloads';
import { redactReportString, safeParsePublicReport, type PublicReport } from './reportArtifact';
import { createCompatibilityMatrix, createReleaseDecision } from './releaseReadiness';
import {
  normalizePublishedEndpoint,
  type PublishedReportEntry,
} from './publishedReportIdentity';

export type { PublishedReportEntry, PublishedReportSummary } from './publishedReportIdentity';

export const PUBLISHED_REPORT_REMOVAL_TOKENS_KEY = 'mcpPublishedReportRemovalTokensV1';

/** One stored change of the weekly watch, as the Worker's index exposes it. */
export interface PublishedWatchChange {
  id: string;
  observedAt: string;
  contentHash: string;
  toolCount: number;
  summary: string;
  baseline?: boolean;
  severity?: 'breaking' | 'risky' | 'safe';
  counts?: { breaking: number; risky: number; safe: number };
  findingCount?: number;
}

export interface PublishedWatchState {
  state: 'baseline' | 'unchanged' | 'breaking' | 'risky' | 'safe' | 'auth-required' | 'unreachable' | 'error' | 'skipped';
  checkedAt: string;
  changedAt?: string;
  summary?: string;
  message?: string;
}

/** The weekly watch of an endpoint (cloudflare-worker/src/weeklyWatch.js). */
export interface PublishedWatchSummary {
  enabled: boolean;
  plan?: string;
  optedInAt?: string;
  state: PublishedWatchState | null;
  lastChange: PublishedWatchChange | null;
  changesFeedUrl: string;
}

/** The outcome of turning the watch on or off; `reason` explains a refusal. */
export interface PublishedWatchToggle {
  enabled: boolean;
  plan?: string;
  interval?: string;
  reason?: string;
}

export interface PublishedReportIndex {
  endpoint: string;
  retention: number;
  snapshots: PublishedReportEntry[];
  watch?: PublishedWatchSummary;
}

export interface PublishReportResult {
  id: string;
  url: string;
  reportUrl: string;
  badgeUrl: string;
  endpoint: string;
  deduplicated: boolean;
  entry: PublishedReportEntry;
  snapshotCount: number;
  retention: number;
  removalToken?: string;
  watch?: PublishedWatchToggle;
  changesFeedUrl?: string;
}

export class PublishedReportError extends Error {
  constructor(message: string, readonly status: number, readonly code: string) {
    super(message);
    this.name = 'PublishedReportError';
  }
}

interface RequestOptions {
  apiBase?: string;
  fetchImpl?: typeof fetch;
}

/** Base URL of the main Worker; publishing is unavailable when it is not configured. */
export const getPublishedReportsApiBase = (): string | undefined => {
  const configured = import.meta.env.VITE_CLOUDFLARE_WORKER_URL as string | undefined;
  const trimmed = configured?.trim().replace(/\/+$/, '');
  return trimmed ? trimmed : undefined;
};

const resolveBase = (options: RequestOptions): string | undefined => (
  options.apiBase === undefined ? getPublishedReportsApiBase() : options.apiBase.replace(/\/+$/, '')
);

const readError = async (response: Response): Promise<PublishedReportError> => {
  let code = 'request_failed';
  let message = `The published report service answered ${response.status}.`;
  try {
    const body = await response.json() as { error?: string; message?: string };
    if (typeof body.error === 'string') code = body.error;
    if (typeof body.message === 'string') message = body.message;
  } catch {
    // Non-JSON error bodies keep the generic message.
  }
  return new PublishedReportError(message, response.status, code);
};

/** The exact redacted JSON the "Download JSON" action produces; this is what gets published. */
export const createPublishableReportJson = (
  report: EvaluationReport,
  oauthTrace?: OAuthTraceV1,
  generatedAt?: string | Date
): string => {
  const compatibilityMatrix = createCompatibilityMatrix(report, oauthTrace);
  const releaseDecision = createReleaseDecision(report, compatibilityMatrix, report.toolSurfaceAnalysis, oauthTrace);
  return createReportDownload(report, 'json', generatedAt, {
    releaseDecision,
    compatibilityMatrix,
    toolSurfaceAnalysis: report.toolSurfaceAnalysis,
    oauthTrace,
  }).content;
};

/**
 * The one endpoint identity publishing, history reads and links share: the
 * endpoint as the redacted artifact records it (`target.testedEndpoint`, with
 * query credentials replaced by the redaction marker), normalized the way the
 * Worker normalizes it before hashing. Undefined when the endpoint cannot have
 * published reports (non-public http(s) host). Never carries raw credentials.
 */
export const publishedEndpointIdentity = (endpoint: string): string | undefined => (
  normalizePublishedEndpoint(redactReportString(endpoint.trim()))
);

/** Whether an endpoint can have published reports at all (public http(s) host). */
export const isPublishableEndpoint = (endpoint: string): boolean => (
  publishedEndpointIdentity(endpoint) !== undefined
);

interface IndexRequestOptions extends RequestOptions {
  /**
   * Bypass HTTP caches. The index is served with a short max-age, so a read
   * right after a publish or delete must not reuse the response cached before
   * the mutation.
   */
  fresh?: boolean;
}

/** Lists published snapshots for an endpoint; undefined when publishing is not configured. */
export const fetchPublishedReportIndex = async (
  endpoint: string,
  options: IndexRequestOptions = {}
): Promise<PublishedReportIndex | undefined> => {
  const base = resolveBase(options);
  const identity = publishedEndpointIdentity(endpoint);
  if (!base || !identity) return undefined;
  const fetchImpl = options.fetchImpl ?? fetch;
  const response = await fetchImpl(`${base}/r/endpoint/${encodeURIComponent(identity)}`, {
    headers: { Accept: 'application/json' },
    ...(options.fresh ? { cache: 'no-store' as RequestCache } : {}),
  });
  if (!response.ok) throw await readError(response);
  const body = await response.json() as PublishedReportIndex;
  return {
    endpoint: body.endpoint,
    retention: body.retention,
    snapshots: Array.isArray(body.snapshots) ? body.snapshots : [],
    ...(body.watch ? { watch: body.watch } : {}),
  };
};

/** Loads one published artifact and validates it as a public report before use. */
export const fetchPublishedReport = async (
  id: string,
  options: RequestOptions = {}
): Promise<PublicReport> => {
  const base = resolveBase(options);
  if (!base) throw new PublishedReportError('Published reports are not configured.', 0, 'not_configured');
  const fetchImpl = options.fetchImpl ?? fetch;
  const response = await fetchImpl(`${base}/r/${encodeURIComponent(id)}`, {
    headers: { Accept: 'application/json' },
  });
  if (!response.ok) throw await readError(response);
  const parsed = safeParsePublicReport(await response.json());
  if (!parsed.success) {
    throw new PublishedReportError('The published artifact is not a valid public report.', response.status, 'invalid_artifact');
  }
  return parsed.data;
};

export const publishReport = async (
  artifactJson: string,
  options: RequestOptions & { watchWeekly?: boolean } = {}
): Promise<PublishReportResult> => {
  const base = resolveBase(options);
  if (!base) throw new PublishedReportError('Published reports are not configured.', 0, 'not_configured');
  const fetchImpl = options.fetchImpl ?? fetch;
  const response = await fetchImpl(`${base}/r${options.watchWeekly ? '?watch=weekly' : ''}`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', Accept: 'application/json' },
    body: artifactJson,
  });
  if (!response.ok) throw await readError(response);
  return await response.json() as PublishReportResult;
};

export const deletePublishedReport = async (
  id: string,
  removalToken: string,
  options: RequestOptions = {}
): Promise<void> => {
  const base = resolveBase(options);
  if (!base) throw new PublishedReportError('Published reports are not configured.', 0, 'not_configured');
  const fetchImpl = options.fetchImpl ?? fetch;
  const response = await fetchImpl(`${base}/r/${encodeURIComponent(id)}`, {
    method: 'DELETE',
    headers: { 'X-Removal-Token': removalToken, Accept: 'application/json' },
  });
  if (!response.ok && response.status !== 404) throw await readError(response);
};

/** Turns the weekly watch on or off; any snapshot's removal token authorizes it. */
export const setPublishedReportWatch = async (
  id: string,
  removalToken: string,
  watch: boolean,
  options: RequestOptions = {}
): Promise<PublishedWatchToggle> => {
  const base = resolveBase(options);
  if (!base) throw new PublishedReportError('Published reports are not configured.', 0, 'not_configured');
  const fetchImpl = options.fetchImpl ?? fetch;
  const response = await fetchImpl(`${base}/r/${encodeURIComponent(id)}/watch`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', 'X-Removal-Token': removalToken, Accept: 'application/json' },
    body: JSON.stringify({ watch }),
  });
  if (!response.ok) throw await readError(response);
  return (await response.json() as { watch: PublishedWatchToggle }).watch;
};

export interface PublishedAlertStatus {
  kind: 'slack' | 'discord' | 'webhook';
  host: string;
  enabled: boolean;
  failures: number;
  lastDelivery: { status: 'ok' | 'failed'; httpStatus: number | null; timestamp: string } | null;
}

export async function publishedReportAlerts(
  id: string, removalToken: string,
  action: 'status' | 'save' | 'test' | 'remove', url?: string,
  options: RequestOptions = {}
): Promise<{ alert: PublishedAlertStatus | null; signingSecret?: string }> {
  const base = resolveBase(options);
  if (!base) throw new PublishedReportError('Published reports are not configured.', 0, 'not_configured');
  const response = await (options.fetchImpl ?? fetch)(`${base}/r/${encodeURIComponent(id)}/alerts${action === 'test' ? '/test' : ''}`, {
    method: action === 'status' ? 'GET' : action === 'remove' ? 'DELETE' : 'POST',
    headers: { 'Content-Type': 'application/json', 'X-Removal-Token': removalToken },
    cache: 'no-store',
    ...(action === 'save' ? { body: JSON.stringify({ url }) } : {}),
  });
  if (!response.ok) throw await readError(response);
  return response.json();
}

type TokenStorage = Pick<Storage, 'getItem' | 'setItem' | 'removeItem'>;

/** Removal tokens by snapshot id; only ever stored in this browser. */
export const loadRemovalTokens = (storage: Pick<Storage, 'getItem'> = localStorage): Record<string, string> => {
  try {
    const parsed = JSON.parse(storage.getItem(PUBLISHED_REPORT_REMOVAL_TOKENS_KEY) || '{}') as unknown;
    if (!parsed || typeof parsed !== 'object' || Array.isArray(parsed)) return {};
    return Object.fromEntries(Object.entries(parsed).filter(
      (pair): pair is [string, string] => typeof pair[1] === 'string' && pair[1].length > 0
    ));
  } catch {
    return {};
  }
};

export const saveRemovalToken = (id: string, token: string, storage: TokenStorage = localStorage): void => {
  storage.setItem(PUBLISHED_REPORT_REMOVAL_TOKENS_KEY, JSON.stringify({ ...loadRemovalTokens(storage), [id]: token }));
};

export const forgetRemovalToken = (id: string, storage: TokenStorage = localStorage): void => {
  const { [id]: _removed, ...rest } = loadRemovalTokens(storage);
  if (Object.keys(rest).length === 0) storage.removeItem(PUBLISHED_REPORT_REMOVAL_TOKENS_KEY);
  else storage.setItem(PUBLISHED_REPORT_REMOVAL_TOKENS_KEY, JSON.stringify(rest));
};
