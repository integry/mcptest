import type { EvaluationReport } from './evaluation';
import type { OAuthTraceV1 } from './oauthTrace';
import {
  createPublicReport,
  redactReportString,
  redactReportValue,
  safeParsePublicReport,
  type PublicReport,
} from './reportArtifact';
import {
  createCompatibilityMatrix,
  createReleaseDecision,
} from './releaseReadiness';

export const REPORT_HISTORY_STORAGE_KEY = 'mcpReportSnapshotsV1';
export const REPORT_SNAPSHOT_RETENTION_PER_ENDPOINT = 10;
export const REPORT_SNAPSHOT_RETENTION_TOTAL = 20;
export const REPORT_SNAPSHOT_VERSION = 1 as const;

export interface ReportSnapshotV1 {
  version: typeof REPORT_SNAPSHOT_VERSION;
  id: string;
  endpoint: string;
  createdAt: string;
  report: PublicReport;
}

type ReadStorage = Pick<Storage, 'getItem'>;
type WriteStorage = Pick<Storage, 'getItem' | 'setItem' | 'removeItem'>;

const endpointIdentity = (value: string): string => {
  const redactedValue = redactReportString(value.trim());
  try {
    const url = new URL(redactedValue);
    url.hostname = url.hostname.toLowerCase();
    return url.toString();
  } catch {
    return redactedValue;
  }
};

const snapshotId = (createdAt: string): string => {
  if (typeof crypto !== 'undefined' && typeof crypto.randomUUID === 'function') {
    return `snapshot-${crypto.randomUUID()}`;
  }
  return `snapshot-${Date.parse(createdAt)}-${Math.random().toString(36).slice(2)}`;
};

const validateSnapshot = (value: unknown): ReportSnapshotV1 | undefined => {
  if (!value || typeof value !== 'object' || Array.isArray(value)) return undefined;
  const candidate = value as Partial<ReportSnapshotV1>;
  if (
    candidate.version !== REPORT_SNAPSHOT_VERSION
    || typeof candidate.id !== 'string'
    || typeof candidate.endpoint !== 'string'
    || typeof candidate.createdAt !== 'string'
    || Number.isNaN(Date.parse(candidate.createdAt))
  ) return undefined;
  // Redact at the report root so schema fields such as OAuth prerequisite
  // `state` retain their documented meaning while evidence remains scrubbed.
  const parsedReport = safeParsePublicReport(redactReportValue(candidate.report));
  if (!parsedReport.success) return undefined;
  const endpoint = endpointIdentity(parsedReport.data.target.testedEndpoint);
  return {
    version: REPORT_SNAPSHOT_VERSION,
    id: candidate.id,
    endpoint,
    createdAt: new Date(candidate.createdAt).toISOString(),
    report: parsedReport.data,
  };
};

const newestFirst = (left: ReportSnapshotV1, right: ReportSnapshotV1): number => (
  Date.parse(right.createdAt) - Date.parse(left.createdAt) || left.id.localeCompare(right.id)
);

const applyRetention = (snapshots: readonly ReportSnapshotV1[]): ReportSnapshotV1[] => {
  const endpointCounts = new Map<string, number>();
  const retained: ReportSnapshotV1[] = [];
  for (const snapshot of [...snapshots].sort(newestFirst)) {
    const identity = endpointIdentity(snapshot.endpoint);
    const count = endpointCounts.get(identity) || 0;
    if (count >= REPORT_SNAPSHOT_RETENTION_PER_ENDPOINT) continue;
    endpointCounts.set(identity, count + 1);
    retained.push(snapshot);
    if (retained.length >= REPORT_SNAPSHOT_RETENTION_TOTAL) break;
  }
  return retained;
};

const parseReportSnapshots = (raw: string | null): ReportSnapshotV1[] => {
  try {
    if (!raw) return [];
    const parsed = JSON.parse(raw) as unknown;
    if (!Array.isArray(parsed)) return [];
    return applyRetention(parsed.flatMap((value) => {
      const snapshot = validateSnapshot(value);
      return snapshot ? [snapshot] : [];
    }));
  } catch {
    return [];
  }
};

const readReportSnapshots = (storage: ReadStorage): ReportSnapshotV1[] => (
  parseReportSnapshots(storage.getItem(REPORT_HISTORY_STORAGE_KEY))
);

/** Loads only validated, redacted report artifacts from the dedicated history key. */
export const loadReportSnapshots = (storage: ReadStorage = localStorage): ReportSnapshotV1[] => {
  try {
    return readReportSnapshots(storage);
  } catch {
    return [];
  }
};

export const createReportSnapshot = (
  report: EvaluationReport,
  oauthTrace?: OAuthTraceV1,
  generatedAt: string | Date = new Date()
): ReportSnapshotV1 => {
  const compatibilityMatrix = createCompatibilityMatrix(report, oauthTrace);
  const releaseDecision = createReleaseDecision(
    report,
    compatibilityMatrix,
    report.toolSurfaceAnalysis,
    oauthTrace
  );
  const artifact = createPublicReport(report, {
    generatedAt,
    releaseDecision,
    compatibilityMatrix,
    toolSurfaceAnalysis: report.toolSurfaceAnalysis,
    oauthTrace,
  });
  return {
    version: REPORT_SNAPSHOT_VERSION,
    id: snapshotId(artifact.generatedAt),
    endpoint: endpointIdentity(artifact.target.testedEndpoint),
    createdAt: artifact.generatedAt,
    report: artifact,
  };
};

export const storeReportSnapshot = (
  snapshot: ReportSnapshotV1,
  storage: WriteStorage = localStorage
): ReportSnapshotV1[] => {
  const validated = validateSnapshot(snapshot);
  if (!validated) throw new Error('Report snapshot is invalid.');
  const retained = applyRetention([
    validated,
    ...readReportSnapshots(storage).filter((candidate) => candidate.id !== validated.id),
  ]);
  storage.setItem(REPORT_HISTORY_STORAGE_KEY, JSON.stringify(retained));
  return retained;
};

export const deleteReportSnapshot = (
  id: string,
  storage: WriteStorage = localStorage
): ReportSnapshotV1[] => {
  const retained = readReportSnapshots(storage).filter((snapshot) => snapshot.id !== id);
  if (retained.length === 0) storage.removeItem(REPORT_HISTORY_STORAGE_KEY);
  else storage.setItem(REPORT_HISTORY_STORAGE_KEY, JSON.stringify(retained));
  return retained;
};

/** Removes report snapshots without touching recent servers, tabs, spaces, or OAuth data. */
export const deleteAllReportSnapshots = (storage: Pick<Storage, 'removeItem'> = localStorage): void => {
  storage.removeItem(REPORT_HISTORY_STORAGE_KEY);
};

export const snapshotsForEndpoint = (
  snapshots: readonly ReportSnapshotV1[],
  endpoint: string
): ReportSnapshotV1[] => {
  const identity = endpointIdentity(endpoint);
  return snapshots.filter((snapshot) => endpointIdentity(snapshot.endpoint) === identity).sort(newestFirst);
};

export const serializeReportSnapshotHistory = (
  snapshots: readonly ReportSnapshotV1[]
): string => `${JSON.stringify({
  artifactType: 'mcptest.report-history',
  schemaVersion: '1.0.0',
  exportedAt: new Date().toISOString(),
  retention: {
    perEndpoint: REPORT_SNAPSHOT_RETENTION_PER_ENDPOINT,
    total: REPORT_SNAPSHOT_RETENTION_TOTAL,
  },
  snapshots: applyRetention(snapshots).flatMap((snapshot) => {
    const validated = validateSnapshot(snapshot);
    return validated ? [validated] : [];
  }),
}, null, 2)}\n`;

export const saveReportSnapshotHistoryDownload = (snapshots: readonly ReportSnapshotV1[]): void => {
  const content = serializeReportSnapshotHistory(snapshots);
  const objectUrl = URL.createObjectURL(new Blob([content], { type: 'application/json' }));
  const anchor = document.createElement('a');
  anchor.href = objectUrl;
  anchor.download = 'mcptest-report-history.json';
  anchor.click();
  URL.revokeObjectURL(objectUrl);
};
