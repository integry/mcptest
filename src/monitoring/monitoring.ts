import { runReleaseGate } from '../cli/releaseGate';
import {
  redactReportString,
  redactReportValue,
  safeParsePublicReport,
  type PublicReport,
} from '../utils/reportArtifact';
import { diffPublicReports, type ReportDiffChange } from '../utils/reportDiff';
import { monitoringArtifactPathPart } from './fileStore';
import {
  MONITORING_ALERT_VERSION,
  MONITORING_SNAPSHOT_VERSION,
  MONITORING_STATE_VERSION,
  type FailureProvenance,
  type MonitoringAggregateStatus,
  type MonitoringAlertEvidence,
  type MonitoringAlertKind,
  type MonitoringAlertV1,
  type MonitoringFailure,
  type MonitoringNotificationAdapter,
  type MonitoringObservation,
  type MonitoringProbe,
  type MonitoringProbeResult,
  type MonitoringRetentionPolicy,
  type MonitoringRetryPolicy,
  type MonitoringRunResult,
  type MonitoringServerState,
  type MonitoringSnapshotV1,
  type MonitoringStateV1,
  type MonitoringStatus,
  type MonitoringStore,
  type MonitoringTarget,
  type MonitoringTargetRunResult,
} from './types';

export const DEFAULT_MONITORING_CONCURRENCY = 4;
export const DEFAULT_MONITORING_TIMEOUT_MS = 30_000;
export const DEFAULT_MONITORING_RETRY_POLICY: MonitoringRetryPolicy = {
  maxAttempts: 3,
  baseDelayMs: 1_000,
  maxDelayMs: 30_000,
};
export const DEFAULT_MONITORING_RETENTION: MonitoringRetentionPolicy = {
  perServer: 30,
  total: 200,
};

const DEFAULT_FAILURE_MESSAGE: Record<FailureProvenance, string> = {
  target: 'The MCP target could not complete the scheduled probe.',
  proxy: 'The configured proxy could not complete the scheduled probe.',
  checker: 'The monitoring checker could not complete the scheduled probe.',
};

const nowIso = (now: () => Date): string => now().toISOString();

const randomId = (prefix: string, at: string): string => {
  if (typeof crypto !== 'undefined' && typeof crypto.randomUUID === 'function') {
    return `${prefix}-${crypto.randomUUID()}`;
  }
  return `${prefix}-${Date.parse(at)}-${Math.random().toString(36).slice(2)}`;
};

const headerSecrets = (headers: HeadersInit | undefined): string[] => {
  if (!headers) return [];
  return [...new Headers(headers).values()]
    .flatMap((value) => [value, value.match(/^Bearer\s+(.+)$/i)?.[1]])
    .filter((value): value is string => Boolean(value))
    .sort((left, right) => right.length - left.length);
};

const safeMessage = (value: string, secrets: readonly string[] = []): string => redactReportString(
  secrets.reduce((message, secret) => message.split(secret).join('[REDACTED]'), value)
);

const safeEndpoint = (endpoint: string): string => redactReportString(endpoint.trim());

const positiveInteger = (value: number, name: string): number => {
  if (!Number.isInteger(value) || value < 1) throw new TypeError(`${name} must be a positive integer.`);
  return value;
};

const reportLink = (
  target: MonitoringTarget,
  snapshotId: string,
  store: MonitoringStore
): string => {
  const serverId = encodeURIComponent(monitoringArtifactPathPart(target.id));
  const encodedSnapshotId = encodeURIComponent(monitoringArtifactPathPart(snapshotId));
  if (!target.reportBaseUrl) {
    return store.snapshotReportUrl?.(target.id, snapshotId)
      || `reports/${serverId}/${encodedSnapshotId}.json`;
  }
  if (target.reportBaseUrl.includes(':serverId') || target.reportBaseUrl.includes(':snapshotId')) {
    return redactReportString(target.reportBaseUrl
      .split(':serverId').join(serverId)
      .split(':snapshotId').join(encodedSnapshotId));
  }
  return `${redactReportString(target.reportBaseUrl).replace(/\/$/, '')}/${serverId}/${encodedSnapshotId}.json`;
};

interface HttpFailureSignal {
  status?: number;
  retryAfter?: string;
  responseSource?: 'target' | 'proxy';
}

const httpFailureSignal = (value: unknown): HttpFailureSignal | undefined => {
  if (!value || typeof value !== 'object' || Array.isArray(value)) return undefined;
  const record = value as Record<string, unknown>;
  const status = typeof record.status === 'number' && Number.isInteger(record.status)
    ? record.status
    : typeof record.httpStatus === 'number' && Number.isInteger(record.httpStatus)
      ? record.httpStatus
      : undefined;
  const responseHeaders = record.responseHeaders && typeof record.responseHeaders === 'object'
    && !Array.isArray(record.responseHeaders)
    ? record.responseHeaders as Record<string, unknown>
    : undefined;
  const retryAfter = typeof record.retryAfter === 'string'
    ? record.retryAfter
    : responseHeaders
      ? Object.entries(responseHeaders)
        .find(([key, header]) => key.toLowerCase() === 'retry-after' && typeof header === 'string')?.[1] as string | undefined
      : undefined;
  const rawSource = typeof record.responseSource === 'string'
    ? record.responseSource.toLowerCase()
    : responseHeaders
      ? Object.entries(responseHeaders).find(([key, header]) => (
        key.toLowerCase() === 'x-mcp-proxy-response-source' && typeof header === 'string'
      ))?.[1]?.toString().toLowerCase()
      : undefined;
  const responseSource = rawSource === 'proxy' || rawSource === 'target' ? rawSource : undefined;
  if (status === undefined && retryAfter === undefined && responseSource === undefined) return undefined;
  return { status, retryAfter, responseSource };
};

const decisiveHttpFailure = (report: PublicReport): HttpFailureSignal | undefined => {
  for (const section of report.sections) {
    if (section.status !== 'failed' && section.status !== 'prerequisite') continue;
    for (let index = section.evidence.length - 1; index >= 0; index -= 1) {
      const metadata = section.evidence[index].metadata;
      if (!metadata || typeof metadata !== 'object' || Array.isArray(metadata)) continue;
      const record = metadata as Record<string, unknown>;
      if (Array.isArray(record.routeFailures) && record.routeFailures.length > 0) {
        const terminal = httpFailureSignal(record.routeFailures[record.routeFailures.length - 1]);
        if (terminal) return terminal;
      }
      const direct = httpFailureSignal(record);
      if (direct) return direct;
    }
  }
  return undefined;
};

const retryAfterMilliseconds = (value: string | undefined, at: Date): number | undefined => {
  if (!value) return undefined;
  const seconds = Number(value.trim());
  if (Number.isFinite(seconds) && seconds >= 0) return Math.round(seconds * 1_000);
  const date = Date.parse(value);
  return Number.isNaN(date) ? undefined : Math.max(0, date - at.getTime());
};

const retryAt = (at: Date, milliseconds: number | undefined): string | undefined => (
  milliseconds === undefined ? undefined : new Date(at.getTime() + milliseconds).toISOString()
);

export interface ClassifiedReport {
  status: MonitoringStatus;
  failure?: MonitoringFailure;
  retryAfterMs?: number;
}

/** Maps report evidence to operational health without treating expected target OAuth as downtime. */
export const classifyMonitoringReport = (
  report: PublicReport,
  checkedAt: Date = new Date()
): ClassifiedReport => {
  if (report.outcome.status === 'scored') return { status: 'healthy' };

  const signal = decisiveHttpFailure(report);
  const retryAfterMs = retryAfterMilliseconds(signal?.retryAfter, checkedAt);
  const httpStatus = signal?.status;
  const authorizationState = report.outcome.authorizationPrerequisite?.state;

  if (authorizationState === 'authorization-required') {
    return { status: 'authorization-required' };
  }
  if (authorizationState === 'proxy-authentication-required') {
    return {
      status: 'proxy-failure',
      failure: {
        provenance: 'proxy',
        message: 'The monitoring proxy requires authorization before it can reach the target.',
        ...(httpStatus ? { httpStatus } : {}),
      },
    };
  }
  if (httpStatus === 429 && signal?.responseSource !== 'proxy') {
    return {
      status: 'degraded',
      retryAfterMs,
      failure: {
        provenance: 'target',
        message: 'The MCP target is rate limited; retry guidance will be honored.',
        httpStatus: 429,
        ...(retryAt(checkedAt, retryAfterMs) ? { retryAt: retryAt(checkedAt, retryAfterMs) } : {}),
      },
    };
  }
  if (report.outcome.status === 'partial') {
    return {
      status: 'degraded',
      failure: { provenance: 'target', message: 'The MCP target completed only part of the probe.' },
    };
  }

  const proxyFailure = report.outcome.status === 'failed'
    && report.provenance.route === 'authenticated-proxy'
    && signal?.responseSource !== 'target';
  const provenance: FailureProvenance = proxyFailure ? 'proxy' : 'target';
  return {
    status: proxyFailure ? 'proxy-failure' : 'unavailable',
    failure: {
      provenance,
      message: DEFAULT_FAILURE_MESSAGE[provenance],
      ...(httpStatus ? { httpStatus } : {}),
    },
  };
};

const classifyProbeFailure = (
  failure: NonNullable<MonitoringProbeResult['failure']>,
  checkedAt: Date,
  secrets: readonly string[]
): ClassifiedReport => {
  const provenance = failure.provenance || 'checker';
  const rateLimited = failure.httpStatus === 429 && provenance === 'target';
  return {
    status: rateLimited
      ? 'degraded'
      : provenance === 'target'
        ? 'unavailable'
        : provenance === 'proxy'
          ? 'proxy-failure'
          : 'checker-failure',
    retryAfterMs: failure.retryAfterMs,
    failure: {
      provenance,
      message: safeMessage(failure.message || DEFAULT_FAILURE_MESSAGE[provenance], secrets),
      ...(failure.httpStatus !== undefined ? { httpStatus: failure.httpStatus } : {}),
      ...(retryAt(checkedAt, failure.retryAfterMs)
        ? { retryAt: retryAt(checkedAt, failure.retryAfterMs) }
        : {}),
    },
  };
};

export const createReleaseGateMonitoringProbe = (): MonitoringProbe => {
  return async (target, context) => {
    if (context.signal.aborted) throw context.signal.reason;
    const result = await runReleaseGate({
      endpoints: [target.endpoint],
      headers: target.headers,
      generatedAt: context.checkedAt,
      policy: { failOnResults: new Set(), failOnSeverity: 'none' },
    });
    const outcome = result.targets[0];
    if (outcome?.report) return { report: outcome.report };
    return {
      failure: {
        provenance: 'checker',
        message: outcome?.error || 'The release-gate checker returned no report.',
      },
    };
  };
};

const emptyState = (updatedAt: string): MonitoringStateV1 => ({
  version: MONITORING_STATE_VERSION,
  updatedAt,
  servers: Object.create(null) as Record<string, MonitoringServerState>,
});

const normalizeState = (value: MonitoringStateV1 | undefined, at: string): MonitoringStateV1 => {
  if (!value || value.version !== MONITORING_STATE_VERSION || !value.servers) return emptyState(at);
  const servers = Object.create(null) as Record<string, MonitoringServerState>;
  for (const [serverId, server] of Object.entries(value.servers)) {
    if (!server || !server.summary || !Array.isArray(server.snapshots)) continue;
    const snapshots = server.snapshots.flatMap((snapshot) => {
      if (!snapshot || snapshot.version !== MONITORING_SNAPSHOT_VERSION
          || typeof snapshot.id !== 'string' || typeof snapshot.checkedAt !== 'string'
          || Number.isNaN(Date.parse(snapshot.checkedAt))) return [];
      if (snapshot.report) {
        const parsed = safeParsePublicReport(redactReportValue(snapshot.report));
        if (!parsed.success) return [];
        return [{ ...snapshot, report: parsed.data }];
      }
      return [snapshot];
    }).sort((left, right) => Date.parse(right.checkedAt) - Date.parse(left.checkedAt));
    const summary = server.summary;
    servers[serverId] = {
      summary: {
        ...summary,
        serverId: safeMessage(summary.serverId || serverId),
        endpoint: safeEndpoint(summary.endpoint || ''),
        ...(summary.lastFailure ? {
          lastFailure: {
            ...summary.lastFailure,
            message: safeMessage(summary.lastFailure.message),
          },
        } : {}),
      },
      snapshots: snapshots.map((snapshot) => ({
        ...snapshot,
        endpoint: safeEndpoint(snapshot.endpoint),
        reportUrl: redactReportString(snapshot.reportUrl),
        ...(snapshot.failure ? {
          failure: { ...snapshot.failure, message: safeMessage(snapshot.failure.message) },
        } : {}),
      })),
    };
  }
  return { version: MONITORING_STATE_VERSION, updatedAt: at, servers };
};

const applyRetention = (
  state: MonitoringStateV1,
  retention: MonitoringRetentionPolicy,
  protectedSnapshots: readonly MonitoringSnapshotV1[]
): void => {
  const snapshotKey = (snapshot: MonitoringSnapshotV1): string => JSON.stringify([
    snapshot.serverId,
    snapshot.id,
  ]);
  const protectedKeys = new Set(protectedSnapshots.map(snapshotKey));
  for (const server of Object.values(state.servers)) {
    server.snapshots.sort((left, right) => Date.parse(right.checkedAt) - Date.parse(left.checkedAt));
    server.snapshots = server.snapshots.filter((snapshot, index) => (
      index < retention.perServer || protectedKeys.has(snapshotKey(snapshot))
    ));
  }
  const all = Object.values(state.servers).flatMap((server) => server.snapshots)
    .sort((left, right) => Date.parse(right.checkedAt) - Date.parse(left.checkedAt));
  const retainedKeys = new Set<string>();
  // A newly emitted alert may temporarily require current + baseline + before evidence.
  // Keeping all such references can exceed the configured total by at most one snapshot
  // per active target; the next run drops the exception once that alert is no longer new.
  for (const snapshot of protectedSnapshots) {
    retainedKeys.add(snapshotKey(snapshot));
  }
  for (const snapshot of all) {
    if (retainedKeys.size >= retention.total) break;
    retainedKeys.add(snapshotKey(snapshot));
  }
  for (const server of Object.values(state.servers)) {
    server.snapshots = server.snapshots.filter((snapshot) => retainedKeys.has(snapshotKey(snapshot)));
  }
};

const monitoredDiffChanges = (before: PublicReport, after: PublicReport): ReportDiffChange[] => (
  diffPublicReports(before, after).changes.filter((change) => (
    change.category === 'transport'
    || change.category === 'protocol'
    || change.category === 'tools'
    || (change.category === 'latency' && change.classification === 'risk')
    || (change.category === 'findings'
      && change.title.startsWith('New finding:')
      && /\b(?:high|critical|error) finding\b/i.test(change.detail))
  ))
);

const evidenceForChange = (change: ReportDiffChange): MonitoringAlertEvidence => ({
  category: change.category,
  path: change.path,
  message: `${change.title}: ${change.detail}`,
});

const statusKind = (status: MonitoringStatus): MonitoringAlertKind => {
  if (status === 'healthy') return 'recovery';
  if (status === 'authorization-required') return 'authorization';
  return 'reachability';
};

const alertSeverity = (
  status: MonitoringStatus,
  changes: readonly ReportDiffChange[]
): MonitoringAlertV1['severity'] => {
  if (['unavailable', 'proxy-failure', 'checker-failure'].includes(status)
      || changes.some((change) => change.breaking)) return 'high';
  if (status !== 'healthy' || changes.some((change) => change.classification === 'risk')) {
    return 'warning';
  }
  return 'info';
};

const buildAlert = (
  target: MonitoringTarget,
  snapshot: MonitoringSnapshotV1,
  previousStatus: MonitoringSnapshotV1 | undefined,
  previousReport: MonitoringSnapshotV1 | undefined,
  changes: readonly ReportDiffChange[],
  createId: (prefix: string, at: string) => string
): MonitoringAlertV1 | undefined => {
  const firstProblem = !previousStatus && snapshot.status !== 'healthy';
  const statusChanged = Boolean(previousStatus && previousStatus.status !== snapshot.status);
  if (!firstProblem && !statusChanged && changes.length === 0) return undefined;
  const before = changes.length > 0 ? previousReport : previousStatus;

  const kinds = new Set<MonitoringAlertKind>();
  const evidence: MonitoringAlertEvidence[] = [];
  if (firstProblem || statusChanged) {
    kinds.add('status-change');
    kinds.add(statusKind(snapshot.status));
    evidence.push({
      category: 'status',
      path: 'status',
      message: previousStatus
        ? `Status changed from ${previousStatus.status} to ${snapshot.status}.`
        : `Initial scheduled status is ${snapshot.status}.`,
    });
  }
  for (const change of changes) {
    if (change.category === 'transport') kinds.add('transport-drift');
    if (change.category === 'protocol') kinds.add('protocol-drift');
    if (change.category === 'tools') kinds.add('tool-schema-drift');
    if (change.category === 'latency') kinds.add('latency-regression');
    if (change.category === 'findings') kinds.add('new-high-severity-finding');
    evidence.push(evidenceForChange(change));
  }

  const safeEvidence = evidence.slice(0, 25);
  const title = statusChanged || firstProblem
    ? `${target.id} is ${snapshot.status}`
    : `${target.id} report drift detected`;
  return redactReportValue({
    version: MONITORING_ALERT_VERSION,
    id: createId('alert', snapshot.checkedAt),
    serverId: target.id,
    endpoint: snapshot.endpoint,
    createdAt: snapshot.checkedAt,
    severity: alertSeverity(snapshot.status, changes),
    kinds: [...kinds],
    title,
    summary: `${safeEvidence.length} monitored change${safeEvidence.length === 1 ? '' : 's'} detected for ${snapshot.endpoint}.`,
    evidence: safeEvidence,
    ...(before ? {
      before: {
        snapshotId: before.id,
        generatedAt: before.checkedAt,
        url: before.reportUrl,
      },
    } : {}),
    after: {
      snapshotId: snapshot.id,
      generatedAt: snapshot.checkedAt,
      url: snapshot.reportUrl,
    },
  }) as MonitoringAlertV1;
};

const aggregate = (targets: readonly MonitoringTargetRunResult[]): MonitoringRunResult['aggregate'] => {
  const counts: MonitoringRunResult['aggregate']['counts'] = {};
  for (const target of targets) {
    const status = target.result === 'skipped' ? 'skipped' : target.snapshot?.status;
    if (status) counts[status] = (counts[status] || 0) + 1;
  }
  const statuses = targets.flatMap((target) => target.snapshot ? [target.snapshot.status] : []);
  let status: MonitoringAggregateStatus;
  if (statuses.length === 0) status = 'skipped';
  else if (statuses.some((item) => ['unavailable', 'proxy-failure', 'checker-failure'].includes(item))) {
    status = 'unavailable';
  } else if (statuses.includes('degraded')) status = 'degraded';
  else if (statuses.includes('authorization-required')) status = 'attention';
  else if (targets.some((target) => target.result === 'skipped')) status = 'degraded';
  else status = 'healthy';
  return { status, counts };
};

const mapConcurrent = async <T, R>(
  values: readonly T[],
  concurrency: number,
  action: (value: T, index: number) => Promise<R>
): Promise<R[]> => {
  const results = new Array<R>(values.length);
  let nextIndex = 0;
  const worker = async () => {
    while (nextIndex < values.length) {
      const index = nextIndex;
      nextIndex += 1;
      results[index] = await action(values[index], index);
    }
  };
  await Promise.all(Array.from({ length: Math.min(concurrency, values.length) }, worker));
  return results;
};

const delay = (milliseconds: number): Promise<void> => new Promise((resolve) => {
  setTimeout(resolve, milliseconds);
});

export interface MonitoringRunnerOptions {
  targets: readonly MonitoringTarget[];
  store: MonitoringStore;
  probe?: MonitoringProbe;
  notifications?: readonly MonitoringNotificationAdapter[];
  concurrency?: number;
  timeoutMs?: number;
  retry?: Partial<MonitoringRetryPolicy>;
  retention?: Partial<MonitoringRetentionPolicy>;
}

export interface MonitoringRunnerDependencies {
  now?: () => Date;
  sleep?: (milliseconds: number) => Promise<void>;
  createId?: (prefix: string, at: string) => string;
  setTimeout?: typeof globalThis.setTimeout;
  clearTimeout?: typeof globalThis.clearTimeout;
}

interface ProbeOutcome {
  target: MonitoringTarget;
  skipped?: true;
  observation?: MonitoringObservation;
}

export class MonitoringRunner {
  private readonly options: Required<Pick<MonitoringRunnerOptions, 'concurrency' | 'timeoutMs'>>
    & Omit<MonitoringRunnerOptions, 'concurrency' | 'timeoutMs' | 'retry' | 'retention'>;
  private readonly retry: MonitoringRetryPolicy;
  private readonly retention: MonitoringRetentionPolicy;
  private readonly now: () => Date;
  private readonly sleep: (milliseconds: number) => Promise<void>;
  private readonly createId: (prefix: string, at: string) => string;
  private readonly timers: Pick<MonitoringRunnerDependencies, 'setTimeout' | 'clearTimeout'>;
  private activeRun?: Promise<MonitoringRunResult>;
  private readonly activeProbes = new Map<string, Promise<MonitoringProbeResult>>();
  private credentialedTail: Promise<void> = Promise.resolve();

  constructor(options: MonitoringRunnerOptions, dependencies: MonitoringRunnerDependencies = {}) {
    if (options.targets.length === 0) throw new TypeError('At least one monitoring target is required.');
    const ids = new Set<string>();
    for (const target of options.targets) {
      if (!target.id.trim()) throw new TypeError('Every monitoring target requires an id.');
      if (ids.has(target.id)) throw new TypeError(`Duplicate monitoring target id: ${target.id}`);
      ids.add(target.id);
      const url = new URL(target.endpoint);
      if (!['http:', 'https:'].includes(url.protocol)) throw new TypeError('Monitoring targets must use HTTP or HTTPS.');
    }
    this.options = {
      targets: [...options.targets],
      store: options.store,
      probe: options.probe || createReleaseGateMonitoringProbe(),
      notifications: options.notifications || [],
      concurrency: positiveInteger(options.concurrency || DEFAULT_MONITORING_CONCURRENCY, 'concurrency'),
      timeoutMs: positiveInteger(options.timeoutMs || DEFAULT_MONITORING_TIMEOUT_MS, 'timeoutMs'),
    };
    this.retry = {
      ...DEFAULT_MONITORING_RETRY_POLICY,
      ...options.retry,
    };
    this.retention = {
      ...DEFAULT_MONITORING_RETENTION,
      ...options.retention,
    };
    positiveInteger(this.retry.maxAttempts, 'retry.maxAttempts');
    positiveInteger(this.retry.baseDelayMs, 'retry.baseDelayMs');
    positiveInteger(this.retry.maxDelayMs, 'retry.maxDelayMs');
    positiveInteger(this.retention.perServer, 'retention.perServer');
    positiveInteger(this.retention.total, 'retention.total');
    const requiredBaselineCapacity = options.targets.length * 2;
    if (this.retention.total < requiredBaselineCapacity) {
      throw new TypeError(
        `retention.total must be at least ${requiredBaselineCapacity} `
        + 'to retain the current and last scored baseline for every monitoring target.'
      );
    }
    this.now = dependencies.now || (() => new Date());
    this.sleep = dependencies.sleep || delay;
    this.createId = dependencies.createId || randomId;
    this.timers = {
      setTimeout: dependencies.setTimeout || globalThis.setTimeout,
      clearTimeout: dependencies.clearTimeout || globalThis.clearTimeout,
    };
  }

  runOnce(): Promise<MonitoringRunResult> {
    if (this.activeRun) {
      return Promise.resolve(this.skippedRun('run-already-active'));
    }
    const run = this.executeRunWithLease();
    this.activeRun = run;
    void run.finally(() => {
      if (this.activeRun === run) this.activeRun = undefined;
    }).catch(() => {});
    return run;
  }

  private skippedRun(reason: 'run-already-active' | 'store-lease-held'): MonitoringRunResult {
    const at = nowIso(this.now);
    const targets = this.options.targets.map<MonitoringTargetRunResult>((target) => ({
      serverId: target.id,
      endpoint: safeEndpoint(target.endpoint),
      result: 'skipped',
      skipReason: reason,
      alerts: [],
    }));
    return {
      startedAt: at,
      finishedAt: at,
      targets,
      aggregate: aggregate(targets),
      notificationErrors: [],
    };
  }

  private async executeRunWithLease(): Promise<MonitoringRunResult> {
    const lease = await this.options.store.acquireRunLease?.();
    if (this.options.store.acquireRunLease && !lease) return this.skippedRun('store-lease-held');
    try {
      return await this.executeRun();
    } finally {
      await lease?.release();
    }
  }

  private async probeWithTimeout(
    target: MonitoringTarget,
    attempt: number,
    checkedAt: string
  ): Promise<MonitoringProbeResult> {
    // The release gate scopes credentialed SDK fetches through a process-global fetch seam.
    // Acquire that slot before starting this target's independent timeout window.
    const releaseCredentialedSlot = await this.acquireCredentialedSlot(target);
    const controller = new AbortController();
    let probe: Promise<MonitoringProbeResult>;
    try {
      probe = this.options.probe(target, { signal: controller.signal, attempt, checkedAt });
    } catch (error) {
      releaseCredentialedSlot();
      throw error;
    }
    this.activeProbes.set(target.id, probe);
    void probe.finally(() => {
      if (this.activeProbes.get(target.id) === probe) this.activeProbes.delete(target.id);
      releaseCredentialedSlot();
    }).catch(() => {});

    let timeout: ReturnType<typeof globalThis.setTimeout> | undefined;
    const timedOut = new Promise<MonitoringProbeResult>((resolve) => {
      timeout = this.timers.setTimeout!(() => {
        controller.abort(new Error(`Probe exceeded the ${this.options.timeoutMs} ms timeout.`));
        resolve({ failure: {
          provenance: 'checker',
          message: `Probe exceeded the ${this.options.timeoutMs} ms timeout.`,
        } });
      }, this.options.timeoutMs);
    });
    try {
      return await Promise.race([probe, timedOut]);
    } finally {
      if (timeout !== undefined) this.timers.clearTimeout!(timeout);
    }
  }

  private async acquireCredentialedSlot(target: MonitoringTarget): Promise<() => void> {
    if (!target.headers || [...new Headers(target.headers).keys()].length === 0) return () => {};
    const previous = this.credentialedTail.catch(() => {});
    let release!: () => void;
    const held = new Promise<void>((resolve) => {
      release = resolve;
    });
    this.credentialedTail = previous.then(() => held);
    await previous;
    return release;
  }

  private async observeTarget(target: MonitoringTarget): Promise<ProbeOutcome> {
    if (this.activeProbes.has(target.id)) return { target, skipped: true };
    const secrets = headerSecrets(target.headers);
    let observation: MonitoringObservation | undefined;
    for (let attempt = 1; attempt <= this.retry.maxAttempts; attempt += 1) {
      const checkedAt = nowIso(this.now);
      let result: MonitoringProbeResult;
      try {
        result = await this.probeWithTimeout(target, attempt, checkedAt);
      } catch (error) {
        result = { failure: {
          provenance: 'checker',
          message: safeMessage(error instanceof Error ? error.message : String(error), secrets),
        } };
      }
      const checkedDate = new Date(checkedAt);
      let classified: ClassifiedReport;
      let report: PublicReport | undefined;
      if (result.report) {
        const parsed = safeParsePublicReport(redactReportValue(result.report));
        if (parsed.success) {
          report = parsed.data;
          classified = classifyMonitoringReport(report, checkedDate);
        } else {
          classified = classifyProbeFailure({
            provenance: 'checker', message: 'The checker produced an invalid public report.',
          }, checkedDate, secrets);
        }
      } else {
        classified = classifyProbeFailure(result.failure || {
          provenance: 'checker', message: 'The checker produced no monitoring result.',
        }, checkedDate, secrets);
      }
      observation = {
        status: classified.status,
        attempts: attempt,
        ...(report ? { report } : {}),
        ...(classified.failure ? { failure: classified.failure } : {}),
      };
      const retryable = ['degraded', 'unavailable', 'checker-failure'].includes(classified.status)
        || (classified.status === 'proxy-failure'
          && classified.failure?.httpStatus !== 401
          && classified.failure?.httpStatus !== 403);
      if (!retryable || attempt === this.retry.maxAttempts || this.activeProbes.has(target.id)) break;
      const exponential = Math.min(
        this.retry.maxDelayMs,
        this.retry.baseDelayMs * (2 ** (attempt - 1))
      );
      await this.sleep(Math.max(exponential, classified.retryAfterMs || 0));
    }
    return { target, observation: observation! };
  }

  private async executeRun(): Promise<MonitoringRunResult> {
    const startedAt = nowIso(this.now);
    const state = normalizeState(await this.options.store.load(), startedAt);
    const outcomes = await mapConcurrent(
      this.options.targets,
      this.options.concurrency,
      (target) => this.observeTarget(target)
    );
    const targets: MonitoringTargetRunResult[] = [];
    const alerts: MonitoringAlertV1[] = [];

    for (const outcome of outcomes) {
      const target = outcome.target;
      if (outcome.skipped || !outcome.observation) {
        targets.push({
          serverId: target.id,
          endpoint: safeEndpoint(target.endpoint),
          result: 'skipped',
          skipReason: 'prior-probe-still-running',
          alerts: [],
        });
        continue;
      }
      const checkedAt = outcome.observation.report?.generatedAt || nowIso(this.now);
      const snapshotId = this.createId('monitor', checkedAt);
      const snapshot: MonitoringSnapshotV1 = {
        version: MONITORING_SNAPSHOT_VERSION,
        id: snapshotId,
        serverId: target.id,
        endpoint: safeEndpoint(target.endpoint),
        checkedAt,
        status: outcome.observation.status,
        attempts: outcome.observation.attempts,
        reportUrl: reportLink(target, snapshotId, this.options.store),
        ...(outcome.observation.report ? { report: outcome.observation.report } : {}),
        ...(outcome.observation.failure ? { failure: outcome.observation.failure } : {}),
      };
      const server = Object.prototype.hasOwnProperty.call(state.servers, target.id)
        ? state.servers[target.id]
        : {
          summary: { serverId: target.id, endpoint: snapshot.endpoint },
          snapshots: [],
        };
      const previousStatus = server.snapshots[0];
      const previousReport = server.snapshots.find((candidate) => (
        candidate.report?.outcome.status === 'scored'
      ));
      const changes = previousReport?.report && snapshot.report?.outcome.status === 'scored'
        ? monitoredDiffChanges(previousReport.report, snapshot.report)
        : [];
      const alert = buildAlert(
        target,
        snapshot,
        previousStatus,
        previousReport,
        changes,
        this.createId
      );
      if (alert) alerts.push(alert);

      server.snapshots.unshift(snapshot);
      server.summary = {
        ...server.summary,
        serverId: target.id,
        endpoint: snapshot.endpoint,
        currentStatus: snapshot.status,
        lastRunAt: snapshot.checkedAt,
        ...(snapshot.status === 'healthy' ? { lastGoodRunAt: snapshot.checkedAt } : {}),
        ...((alert || changes.length > 0) ? { lastChangeAt: snapshot.checkedAt } : {}),
        ...(snapshot.failure ? {
          lastFailure: { ...snapshot.failure, checkedAt: snapshot.checkedAt },
        } : {}),
      };
      state.servers[target.id] = server;
      targets.push({
        serverId: target.id,
        endpoint: snapshot.endpoint,
        result: 'completed',
        snapshot,
        alerts: alert ? [alert] : [],
      });
    }

    state.updatedAt = nowIso(this.now);
    const protectedSnapshots = this.options.targets.flatMap((target) => {
      const server = state.servers[target.id];
      if (!server) return [];
      const current = server.snapshots[0];
      const lastScored = server.snapshots.find((snapshot) => (
        snapshot.report?.outcome.status === 'scored'
      ));
      return [current, lastScored].filter(
        (snapshot): snapshot is MonitoringSnapshotV1 => Boolean(snapshot)
      );
    });
    protectedSnapshots.push(...targets.flatMap((target) => {
      if (!target.snapshot) return [];
      const referencedIds = new Set(target.alerts.flatMap((alert) => (
        [alert.before?.snapshotId, alert.after.snapshotId].filter((id): id is string => Boolean(id))
      )));
      const server = state.servers[target.serverId];
      return server.snapshots.filter((snapshot) => (
        snapshot.id === target.snapshot!.id || referencedIds.has(snapshot.id)
      ));
    }));
    applyRetention(state, this.retention, protectedSnapshots);
    for (const target of targets) {
      if (target.snapshot) await this.options.store.saveSnapshot?.(target.snapshot);
    }
    await this.options.store.save(state);
    await this.options.store.pruneSnapshots?.(state);

    const notificationErrors: MonitoringRunResult['notificationErrors'] = [];
    for (const alert of alerts) {
      for (const adapter of this.options.notifications) {
        try {
          await adapter.send(alert);
        } catch (error) {
          notificationErrors.push({
            adapter: adapter.name,
            alertId: alert.id,
            message: redactReportString(error instanceof Error ? error.message : String(error)),
          });
        }
      }
    }
    const finishedAt = nowIso(this.now);
    return { startedAt, finishedAt, targets, aggregate: aggregate(targets), notificationErrors };
  }
}

export interface MonitoringSchedulerOptions {
  intervalMs: number;
  runImmediately?: boolean;
  onRun?: (result: MonitoringRunResult) => void;
  onError?: (error: unknown) => void;
}

export interface MonitoringSchedulerDependencies {
  setTimeout?: typeof globalThis.setTimeout;
  clearTimeout?: typeof globalThis.clearTimeout;
}

/** Completion-based scheduling prevents interval ticks from stacking slow probes. */
export class MonitoringScheduler {
  private timer?: ReturnType<typeof globalThis.setTimeout>;
  private stopped = true;
  private readonly setTimer: typeof globalThis.setTimeout;
  private readonly clearTimer: typeof globalThis.clearTimeout;

  constructor(
    private readonly runner: Pick<MonitoringRunner, 'runOnce'>,
    private readonly options: MonitoringSchedulerOptions,
    dependencies: MonitoringSchedulerDependencies = {}
  ) {
    positiveInteger(options.intervalMs, 'intervalMs');
    this.setTimer = dependencies.setTimeout || globalThis.setTimeout;
    this.clearTimer = dependencies.clearTimeout || globalThis.clearTimeout;
  }

  start(): void {
    if (!this.stopped) return;
    this.stopped = false;
    if (this.options.runImmediately !== false) void this.tick();
    else this.schedule();
  }

  stop(): void {
    this.stopped = true;
    if (this.timer !== undefined) this.clearTimer(this.timer);
    this.timer = undefined;
  }

  /** Manual triggers use the same runner overlap guard as scheduled triggers. */
  trigger(): Promise<MonitoringRunResult> {
    return this.runner.runOnce();
  }

  private schedule(): void {
    if (this.stopped) return;
    this.timer = this.setTimer(() => void this.tick(), this.options.intervalMs);
  }

  private async tick(): Promise<void> {
    try {
      const result = await this.runner.runOnce();
      this.options.onRun?.(result);
    } catch (error) {
      this.options.onError?.(error);
    } finally {
      this.schedule();
    }
  }
}

export class MemoryMonitoringStore implements MonitoringStore {
  private state?: MonitoringStateV1;
  readonly reports = new Map<string, MonitoringSnapshotV1>();

  async load(): Promise<MonitoringStateV1 | undefined> {
    return this.state ? structuredClone(this.state) : undefined;
  }

  async save(state: MonitoringStateV1): Promise<void> {
    this.state = structuredClone(state);
  }

  async saveSnapshot(snapshot: MonitoringSnapshotV1): Promise<void> {
    this.reports.set(snapshot.id, structuredClone(snapshot));
  }

  async pruneSnapshots(state: MonitoringStateV1): Promise<void> {
    const retained = new Set(Object.values(state.servers)
      .flatMap((server) => server.snapshots.map((snapshot) => snapshot.id)));
    for (const id of this.reports.keys()) {
      if (!retained.has(id)) this.reports.delete(id);
    }
  }
}
