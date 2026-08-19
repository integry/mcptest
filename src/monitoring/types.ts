import type { PublicReport } from '../utils/reportArtifact';
import type { ReportDiffChange } from '../utils/reportDiff';

export const MONITORING_STATE_VERSION = 1 as const;
export const MONITORING_SNAPSHOT_VERSION = 1 as const;
export const MONITORING_ALERT_VERSION = 1 as const;

export type MonitoringStatus =
  | 'healthy'
  | 'authorization-required'
  | 'degraded'
  | 'unavailable'
  | 'proxy-failure'
  | 'checker-failure';

export type FailureProvenance = 'target' | 'proxy' | 'checker';

export interface MonitoringFailure {
  provenance: FailureProvenance;
  message: string;
  httpStatus?: number;
  retryAt?: string;
}

export interface MonitoringSnapshotV1 {
  version: typeof MONITORING_SNAPSHOT_VERSION;
  id: string;
  serverId: string;
  endpoint: string;
  checkedAt: string;
  status: MonitoringStatus;
  attempts: number;
  reportUrl: string;
  report?: PublicReport;
  failure?: MonitoringFailure;
}

export interface MonitoringServerSummary {
  serverId: string;
  endpoint: string;
  currentStatus?: MonitoringStatus;
  lastRunAt?: string;
  lastGoodRunAt?: string;
  lastChangeAt?: string;
  lastFailure?: MonitoringFailure & { checkedAt: string };
}

export interface MonitoringServerState {
  summary: MonitoringServerSummary;
  snapshots: MonitoringSnapshotV1[];
}

export interface MonitoringStateV1 {
  version: typeof MONITORING_STATE_VERSION;
  updatedAt: string;
  servers: Record<string, MonitoringServerState>;
}

export interface MonitoringRunLease {
  release(): Promise<void>;
}

export type MonitoringAlertKind =
  | 'status-change'
  | 'reachability'
  | 'authorization'
  | 'transport-drift'
  | 'protocol-drift'
  | 'tool-schema-drift'
  | 'latency-regression'
  | 'new-high-severity-finding'
  | 'recovery';

export interface MonitoringAlertEvidence {
  category: string;
  path: string;
  message: string;
}

export interface MonitoringReportLink {
  snapshotId: string;
  generatedAt: string;
  url: string;
}

export interface MonitoringAlertV1 {
  version: typeof MONITORING_ALERT_VERSION;
  id: string;
  serverId: string;
  endpoint: string;
  createdAt: string;
  severity: 'info' | 'warning' | 'high';
  kinds: MonitoringAlertKind[];
  title: string;
  summary: string;
  evidence: MonitoringAlertEvidence[];
  before?: MonitoringReportLink;
  after: MonitoringReportLink;
}

export interface MonitoringTarget {
  id: string;
  endpoint: string;
  /** Runtime-only target headers. They are never persisted or included in alerts. */
  headers?: HeadersInit;
  /** Base URL/directory for report links, or a template containing :serverId and :snapshotId. */
  reportBaseUrl?: string;
}

export interface MonitoringProbeResult {
  report?: PublicReport;
  failure?: {
    provenance?: FailureProvenance;
    message: string;
    httpStatus?: number;
    retryAfterMs?: number;
  };
}

export interface MonitoringProbeContext {
  signal: AbortSignal;
  attempt: number;
  checkedAt: string;
}

export type MonitoringProbe = (
  target: MonitoringTarget,
  context: MonitoringProbeContext
) => Promise<MonitoringProbeResult>;

export interface MonitoringStore {
  /** Atomically reserves the store for one complete monitoring transaction. */
  acquireRunLease?(): Promise<MonitoringRunLease | undefined>;
  load(): Promise<MonitoringStateV1 | undefined>;
  save(state: MonitoringStateV1): Promise<void>;
  /** Returns the link/path at which this store persists a snapshot artifact. */
  snapshotReportUrl?(serverId: string, snapshotId: string): string;
  /** Optional hook for stores that also expose each report as a separately linkable artifact. */
  saveSnapshot?(snapshot: MonitoringSnapshotV1): Promise<void>;
  /** Removes separately stored artifacts that are no longer present in bounded state. */
  pruneSnapshots?(state: MonitoringStateV1): Promise<void>;
}

export interface MonitoringNotificationAdapter {
  readonly name: string;
  send(alert: MonitoringAlertV1): Promise<void>;
}

export interface MonitoringRetryPolicy {
  maxAttempts: number;
  baseDelayMs: number;
  maxDelayMs: number;
}

export interface MonitoringRetentionPolicy {
  perServer: number;
  total: number;
}

export interface MonitoringTargetRunResult {
  serverId: string;
  endpoint: string;
  result: 'completed' | 'skipped';
  skipReason?: 'run-already-active' | 'store-lease-held' | 'prior-probe-still-running';
  snapshot?: MonitoringSnapshotV1;
  alerts: MonitoringAlertV1[];
}

export type MonitoringAggregateStatus =
  | 'healthy'
  | 'attention'
  | 'degraded'
  | 'unavailable'
  | 'skipped';

export interface MonitoringRunResult {
  startedAt: string;
  finishedAt: string;
  targets: MonitoringTargetRunResult[];
  aggregate: {
    status: MonitoringAggregateStatus;
    counts: Partial<Record<MonitoringStatus | 'skipped', number>>;
  };
  notificationErrors: Array<{ adapter: string; alertId: string; message: string }>;
}

export interface MonitoringObservation {
  status: MonitoringStatus;
  attempts: number;
  report?: PublicReport;
  failure?: MonitoringFailure;
}

export interface MonitoringDrift {
  changes: ReportDiffChange[];
}
