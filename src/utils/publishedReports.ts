// Client for the Worker's public report permalinks (cloudflare-worker/src/publishedReportRoutes.js).
//
// Publishing sends exactly the redacted JSON artifact the download produces. The
// removal token returned at publish time is shown once and kept only in this
// browser's localStorage so the publisher can delete the snapshot later.
import type { EvaluationReport } from './evaluation';
import type { OAuthTraceV1 } from './oauthTrace';
import { createReportDownload } from './reportDownloads';
import { safeParsePublicReport, type PublicReport } from './reportArtifact';
import { createCompatibilityMatrix, createReleaseDecision } from './releaseReadiness';
import {
  normalizePublishedEndpoint,
  type PublishedReportEntry,
} from './publishedReportIdentity';

export type { PublishedReportEntry, PublishedReportSummary } from './publishedReportIdentity';

export const PUBLISHED_REPORT_REMOVAL_TOKENS_KEY = 'mcpPublishedReportRemovalTokensV1';

export interface PublishedReportIndex {
  endpoint: string;
  retention: number;
  snapshots: PublishedReportEntry[];
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

/** Whether an endpoint can have published reports at all (public http(s) host). */
export const isPublishableEndpoint = (endpoint: string): boolean => (
  normalizePublishedEndpoint(endpoint) !== undefined
);

/** Lists published snapshots for an endpoint; undefined when publishing is not configured. */
export const fetchPublishedReportIndex = async (
  endpoint: string,
  options: RequestOptions = {}
): Promise<PublishedReportIndex | undefined> => {
  const base = resolveBase(options);
  const normalized = normalizePublishedEndpoint(endpoint);
  if (!base || !normalized) return undefined;
  const fetchImpl = options.fetchImpl ?? fetch;
  const response = await fetchImpl(`${base}/r/endpoint/${encodeURIComponent(normalized)}`, {
    headers: { Accept: 'application/json' },
  });
  if (!response.ok) throw await readError(response);
  const body = await response.json() as PublishedReportIndex;
  return {
    endpoint: body.endpoint,
    retention: body.retention,
    snapshots: Array.isArray(body.snapshots) ? body.snapshots : [],
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
  options: RequestOptions = {}
): Promise<PublishReportResult> => {
  const base = resolveBase(options);
  if (!base) throw new PublishedReportError('Published reports are not configured.', 0, 'not_configured');
  const fetchImpl = options.fetchImpl ?? fetch;
  const response = await fetchImpl(`${base}/r`, {
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
