import { runReleaseGate } from '../cli/releaseGate';
import {
  redactReportString,
  redactReportValue,
  safeParsePublicReport,
  type PublicReport,
} from '../utils/reportArtifact';
import { diffPublicReports, type ReportDiffChange } from '../utils/reportDiff';
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
  snapshotId: string
): string => {
  const serverId = encodeURIComponent(target.id);
  const encodedSnapshotId = encodeURIComponent(snapshotId);
  if (!target.reportBaseUrl) return `reports/${serverId}/${encodedSnapshotId}.json`;
  if (target.reportBaseUrl.includes(':serverId') || target.reportBaseUrl.includes(':snapshotId')) {
    return redactReportString(target.reportBaseUrl
      .split(':serverId').join(serverId)
      .split(':snapshotId').join(encodedSnapshotId));
  }
  return `${redactReportString(target.reportBaseUrl).replace(/\/$/, '')}/${serverId}/${encodedSnapshotId}.json`;
};

interface HttpSignals {
  statuses: number[];
  retryAfter?: string;
  proxyResponseObserved: boolean;
}

const collectHttpSignals = (value: unknown, signals: HttpSignals): void => {
  if (!value || typeof value !== 'object') return;
  if (Array.isArray(value)) {
    value.forEach((item) => collectHttpSignals(item, signals));
    return;
  }
  for (const [key, child] of Object.entries(value as Record<string, unknown>)) {
    const normalized = key.toLowerCase().replace(/[^a-z0-9]/g, '');
    if ((normalized === 'status' || normalized === 'httpstatus')
        && typeof child === 'number' && Number.isInteger(child)) {
      signals.statuses.push(child);
    }
    if (normalized === 'retryafter' && typeof child === 'string') signals.retryAfter = child;
    if ((normalized === 'xmcpproxyresponsesource' || normalized === 'responsesource')
        && typeof child === 'string' && child.toLowerCase() === 'proxy') {
      signals.proxyResponseObserved = true;
    }
    collectHttpSignals(child, signals);
  }
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
  const signals: HttpSignals = { statuses: [], proxyResponseObserved: false };
  collectHttpSignals(report.sections, signals);
  const retryAfterMs = retryAfterMilliseconds(signals.retryAfter, checkedAt);
  const httpStatus = signals.statuses[signals.statuses.length - 1];
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
  if (signals.statuses.includes(429)) {
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
  if (report.outcome.status === 'scored') return { status: 'healthy' };
  if (report.outcome.status === 'partial') {
    return {
      status: 'degraded',
      failure: { provenance: 'target', message: 'The MCP target completed only part of the probe.' },
    };
  }

  const proxyFailure = report.outcome.status === 'failed'
    && report.provenance.route === 'authenticated-proxy'
    && signals.proxyResponseObserved;
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
  // The release gate scopes credentialed SDK fetches through a process-global fetch seam.
  // Serialize only credentialed probes so credentials from independent targets cannot overlap.
  let credentialedTail: Promise<void> = Promise.resolve();
  return async (target, context) => {
    const evaluate = async (): Promise<MonitoringProbeResult> => {
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
    if (!target.headers || [...new Headers(target.headers).keys()].length === 0) return evaluate();
    const queued = credentialedTail.then(evaluate, evaluate);
    credentialedTail = queued.then(() => undefined, () => undefined);
    return queued;
  };
};

const emptyState = (updatedAt: string): MonitoringStateV1 => ({
  version: MONITORING_STATE_VERSION,
  updatedAt,
  servers: {},
});

const normalizeState = (value: MonitoringStateV1 | undefined, at: string): MonitoringStateV1 => {
  if (!value || value.version !== MONITORING_STATE_VERSION || !value.servers) return emptyState(at);
  const servers: Record<string, MonitoringServerState> = {};
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
  retention: MonitoringRetentionPolicy
): void => {
  for (const server of Object.values(state.servers)) {
    server.snapshots.sort((left, right) => Date.parse(right.checkedAt) - Date.parse(left.checkedAt));
    server.snapshots.splice(retention.perServer);
  }
  const all = Object.values(state.servers).flatMap((server) => server.snapshots)
    .sort((left, right) => Date.parse(right.checkedAt) - Date.parse(left.checkedAt));
  const retainedIds = new Set(all.slice(0, retention.total).map((snapshot) => snapshot.id));
  for (const server of Object.values(state.servers)) {
    server.snapshots = server.snapshots.filter((snapshot) => retainedIds.has(snapshot.id));
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
  previous: MonitoringSnapshotV1 | undefined,
  changes: readonly ReportDiffChange[],
  createId: (prefix: string, at: string) => string
): MonitoringAlertV1 | undefined => {
  const firstProblem = !previous && snapshot.status !== 'healthy';
  const statusChanged = Boolean(previous && previous.status !== snapshot.status);
  if (!firstProblem && !statusChanged && changes.length === 0) return undefined;

  const kinds = new Set<MonitoringAlertKind>();
  const evidence: MonitoringAlertEvidence[] = [];
  if (firstProblem || statusChanged) {
    kinds.add('status-change');
    kinds.add(statusKind(snapshot.status));
    evidence.push({
      category: 'status',
      path: 'status',
      message: previous
        ? `Status changed from ${previous.status} to ${snapshot.status}.`
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
    ...(previous ? {
      before: {
        snapshotId: previous.id,
        generatedAt: previous.checkedAt,
        url: previous.reportUrl,
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
      const at = nowIso(this.now);
      const targets = this.options.targets.map<MonitoringTargetRunResult>((target) => ({
        serverId: target.id,
        endpoint: safeEndpoint(target.endpoint),
        result: 'skipped',
        skipReason: 'run-already-active',
        alerts: [],
      }));
      return Promise.resolve({
        startedAt: at,
        finishedAt: at,
        targets,
        aggregate: aggregate(targets),
        notificationErrors: [],
      });
    }
    const run = this.executeRun();
    this.activeRun = run;
    void run.finally(() => {
      if (this.activeRun === run) this.activeRun = undefined;
    }).catch(() => {});
    return run;
  }

  private async probeWithTimeout(
    target: MonitoringTarget,
    attempt: number,
    checkedAt: string
  ): Promise<MonitoringProbeResult> {
    const controller = new AbortController();
    const probe = this.options.probe(target, { signal: controller.signal, attempt, checkedAt });
    this.activeProbes.set(target.id, probe);
    void probe.finally(() => {
      if (this.activeProbes.get(target.id) === probe) this.activeProbes.delete(target.id);
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
        reportUrl: reportLink(target, snapshotId),
        ...(outcome.observation.report ? { report: outcome.observation.report } : {}),
        ...(outcome.observation.failure ? { failure: outcome.observation.failure } : {}),
      };
      const server = state.servers[target.id] || {
        summary: { serverId: target.id, endpoint: snapshot.endpoint },
        snapshots: [],
      };
      const previous = server.snapshots[0];
      const changes = previous?.report?.outcome.status === 'scored'
        && snapshot.report?.outcome.status === 'scored'
        ? monitoredDiffChanges(previous.report, snapshot.report)
        : [];
      const alert = buildAlert(target, snapshot, previous, changes, this.createId);
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
    applyRetention(state, this.retention);
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
