import { afterEach, describe, expect, it, vi } from 'vitest';
import { mkdir, mkdtemp, readFile, readdir, rm, stat, utimes, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import {
  MemoryMonitoringStore,
  MonitoringRunner,
  MonitoringScheduler,
  classifyMonitoringReport,
} from './monitoring';
import { FileMonitoringStore, monitoringArtifactPathPart } from './fileStore';
import { createWebhookNotificationAdapter } from './notifications';
import type { PublicReport } from '../utils/reportArtifact';

const schemaUrl = 'https://mcptest.io/schemas/report/v2.schema.json' as const;

const report = (options: {
  at?: string;
  endpoint?: string;
  outcome?: 'scored' | 'authorization-required' | 'partial' | 'failed';
  authorizationState?: 'authorization-required' | 'proxy-authentication-required';
  transport?: string;
  protocol?: string;
  latency?: number;
  status?: number;
  retryAfter?: string;
  toolRequired?: string[];
  route?: 'direct' | 'authenticated-proxy';
  responseSource?: 'target' | 'proxy';
  highFinding?: boolean;
} = {}): PublicReport => {
  const at = options.at || '2026-08-13T03:00:00.000Z';
  const outcome = options.outcome || 'scored';
  const scored = outcome === 'scored';
  const baseSections: PublicReport['sections'] = scored ? [
    {
      id: 'protocol', name: 'Protocol', description: '', status: 'evaluated',
      score: { earned: 1, maximum: 1 }, evidence: [],
    },
    {
      id: 'transport', name: 'Transport', description: '', status: 'evaluated',
      score: { earned: 1, maximum: 1 }, evidence: [],
    },
    {
      id: 'capabilities', name: 'Capabilities', description: '', status: 'evaluated',
      score: { earned: 1, maximum: 1 }, evidence: [],
    },
  ] : [{
    id: outcome === 'authorization-required' ? 'auth' : 'protocol',
    name: 'Probe', description: '',
    status: outcome === 'authorization-required' ? 'prerequisite' : 'failed',
    score: { earned: null, maximum: 0 },
    evidence: options.status ? [{
      message: `HTTP ${options.status}`,
      metadata: {
        status: options.status,
        ...(options.retryAfter ? { responseHeaders: { 'Retry-After': options.retryAfter } } : {}),
        ...(options.responseSource ? { responseSource: options.responseSource } : {}),
      },
    }] : [],
  }];
  return {
    $schema: schemaUrl,
    artifactType: 'mcptest.report',
    schemaVersion: '2.0.0',
    generatedAt: at,
    generator: { name: 'mcptest', version: '1.0.0' },
    target: { testedEndpoint: options.endpoint || 'https://one.example/mcp' },
    provenance: options.route === 'authenticated-proxy'
      ? { route: 'authenticated-proxy', proxyUsed: true }
      : { route: 'direct', proxyUsed: false },
    outcome: {
      status: outcome,
      summary: 'Probe result.',
      ...(outcome === 'authorization-required' ? {
        authorizationPrerequisite: {
          required: true as const,
          state: options.authorizationState || 'authorization-required',
          message: 'Authorization is required.',
        },
      } : {}),
    },
    score: scored ? { earned: 3, maximum: 3, percentage: 100 } : null,
    ...(scored ? {
      protocol: { era: options.protocol || 'modern', version: '2026-01-26' },
      transport: { type: options.transport || 'streamable-http' },
      timings: { connectionSetupMs: options.latency || 100, checks: [] },
      toolSurfaceAnalysis: {
        version: '1.0',
        metrics: { toolCount: 1, resourceCount: 0, promptCount: 0, estimatedContextTokens: 10 },
        fingerprint: { algorithm: 'sha256', value: 'fixture' },
        toolDefinitions: {
          status: 'complete' as const,
          namesComplete: true,
          tools: [{
            name: 'search',
            description: 'Search.',
            inputSchema: {
              type: 'object',
              properties: { query: { type: 'string' } },
              required: options.toolRequired || [],
            },
          }],
        },
        findings: {
          critical: [],
          high: options.highFinding ? [{
            id: 'unsafe-tool', category: 'capability-risk', severity: 'high',
            kind: 'capability-signal', title: 'Unsafe tool', summary: 'Review the tool.',
            evidence: [{ tool: 'search', path: 'name', detail: 'Sensitive operation.' }],
            omittedEvidenceCount: 0, remediation: 'Add safeguards.',
          }] : [],
          medium: [], low: [], info: [],
        },
        findingCount: options.highFinding ? 1 : 0,
        interpretation: 'Fixture.',
      },
    } : {}),
    sections: baseSections,
  };
};

afterEach(() => {
  vi.useRealTimers();
});

describe('monitoring classification', () => {
  it('does not turn an expected target OAuth 401 into downtime', () => {
    expect(classifyMonitoringReport(report({
      outcome: 'authorization-required', authorizationState: 'authorization-required', status: 401,
    }))).toEqual({ status: 'authorization-required' });
  });

  it('distinguishes proxy authorization and rate-limited target degradation', () => {
    expect(classifyMonitoringReport(report({
      outcome: 'authorization-required', authorizationState: 'proxy-authentication-required', status: 401,
    }))).toMatchObject({ status: 'proxy-failure', failure: { provenance: 'proxy' } });

    expect(classifyMonitoringReport(report({
      outcome: 'failed', status: 429, retryAfter: '5',
    }), new Date('2026-08-13T03:00:00.000Z'))).toMatchObject({
      status: 'degraded',
      retryAfterMs: 5_000,
      failure: { provenance: 'target', httpStatus: 429, retryAt: '2026-08-13T03:00:05.000Z' },
    });

    expect(classifyMonitoringReport(report({
      outcome: 'failed', status: 502, route: 'authenticated-proxy', responseSource: 'proxy',
    }))).toMatchObject({
      status: 'proxy-failure', failure: { provenance: 'proxy', httpStatus: 502 },
    });
  });

  it('uses the completed outcome and decisive failed route instead of incidental HTTP evidence', () => {
    const completed = report();
    completed.sections[0].evidence.push({
      message: 'An earlier optional request was rate limited.',
      metadata: { status: 429, responseHeaders: { 'Retry-After': '60' } },
    });
    expect(classifyMonitoringReport(completed)).toEqual({ status: 'healthy' });

    const proxyFailure = report({
      outcome: 'failed', route: 'authenticated-proxy', responseSource: 'proxy', status: 502,
    });
    proxyFailure.sections[0].evidence[0].metadata = {
      route: 'authenticated proxy',
      routeFailures: [
        { route: 'direct', status: 429, responseSource: 'target', retryAfter: '60' },
        { route: 'authenticated proxy', status: 502, responseSource: 'proxy' },
      ],
    };
    expect(classifyMonitoringReport(proxyFailure)).toMatchObject({
      status: 'proxy-failure', failure: { provenance: 'proxy', httpStatus: 502 },
    });
  });

  it('attributes a response-less authenticated-proxy transport rejection to the proxy', () => {
    expect(classifyMonitoringReport(report({
      outcome: 'failed', route: 'authenticated-proxy',
    }))).toMatchObject({
      status: 'proxy-failure', failure: { provenance: 'proxy' },
    });
  });
});

describe('MonitoringRunner', () => {
  it('honors retry guidance and keeps remotes independent under bounded concurrency', async () => {
    const store = new MemoryMonitoringStore();
    const attempts = new Map<string, number>();
    let active = 0;
    let maxActive = 0;
    const releases: Array<() => void> = [];
    const sleep = vi.fn(async () => {});
    const runner = new MonitoringRunner({
      targets: ['one', 'two', 'three'].map((id) => ({ id, endpoint: `https://${id}.example/mcp` })),
      store,
      concurrency: 2,
      probe: async (target) => {
        const attempt = (attempts.get(target.id) || 0) + 1;
        attempts.set(target.id, attempt);
        active += 1;
        maxActive = Math.max(maxActive, active);
        await new Promise<void>((resolve) => releases.push(resolve));
        active -= 1;
        if (target.id === 'one' && attempt === 1) {
          return { failure: {
            provenance: 'target' as const, message: 'rate limited', httpStatus: 429, retryAfterMs: 5_000,
          } };
        }
        return { report: report({ endpoint: target.endpoint }) };
      },
      retry: { maxAttempts: 2 },
    }, { sleep, createId: (prefix, at) => `${prefix}-${at}-${attempts.size}` });

    const running = runner.runOnce();
    await vi.waitFor(() => expect(releases).toHaveLength(2));
    releases.splice(0).forEach((release) => release());
    await vi.waitFor(() => expect(releases.length).toBeGreaterThanOrEqual(1));
    releases.splice(0).forEach((release) => release());
    const result = await running;

    expect(maxActive).toBe(2);
    expect(result.targets.map((target) => target.result)).toEqual(['completed', 'completed', 'completed']);
    expect(result.targets.map((target) => target.snapshot?.status)).toEqual(['healthy', 'healthy', 'healthy']);
    expect(sleep).toHaveBeenCalledWith(5_000);
  });

  it('starts each credentialed probe timeout after acquiring the serialized evaluation slot', async () => {
    vi.useFakeTimers();
    const starts: string[] = [];
    const runner = new MonitoringRunner({
      targets: ['one', 'two'].map((id) => ({
        id,
        endpoint: `https://${id}.example/mcp`,
        headers: { Authorization: `Bearer ${id}` },
      })),
      store: new MemoryMonitoringStore(),
      concurrency: 2,
      timeoutMs: 100,
      retry: { maxAttempts: 1 },
      probe: async (target) => {
        starts.push(target.id);
        await new Promise((resolve) => setTimeout(resolve, 75));
        return { report: report({ endpoint: target.endpoint }) };
      },
    });

    const running = runner.runOnce();
    await vi.advanceTimersByTimeAsync(0);
    expect(starts).toEqual(['one']);
    await vi.advanceTimersByTimeAsync(75);
    expect(starts).toEqual(['one', 'two']);
    await vi.advanceTimersByTimeAsync(75);

    expect((await running).targets.map((target) => target.snapshot?.status)).toEqual([
      'healthy', 'healthy',
    ]);
  });

  it('skips overlapping runs and does not stack a new probe after a timed-out transport is still active', async () => {
    vi.useFakeTimers();
    let resolveProbe!: (value: { report: PublicReport }) => void;
    const probe = vi.fn(() => new Promise<{ report: PublicReport }>((resolve) => {
      resolveProbe = resolve;
    }));
    const runner = new MonitoringRunner({
      targets: [{ id: 'slow', endpoint: 'https://slow.example/mcp' }],
      store: new MemoryMonitoringStore(),
      probe,
      timeoutMs: 100,
      retry: { maxAttempts: 1 },
    });

    const first = runner.runOnce();
    const overlapping = await runner.runOnce();
    expect(overlapping.targets[0]).toMatchObject({
      result: 'skipped', skipReason: 'run-already-active',
    });
    await vi.advanceTimersByTimeAsync(100);
    expect((await first).targets[0].snapshot).toMatchObject({
      status: 'checker-failure', failure: { provenance: 'checker' },
    });

    const whileTransportLingers = await runner.runOnce();
    expect(whileTransportLingers.targets[0]).toMatchObject({
      result: 'skipped', skipReason: 'prior-probe-still-running',
    });
    expect(probe).toHaveBeenCalledTimes(1);
    resolveProbe({ report: report() });
    await Promise.resolve();
  });

  it('does not report a healthy aggregate when one target is skipped', async () => {
    vi.useFakeTimers();
    let resolveSlow!: (value: { report: PublicReport }) => void;
    const runner = new MonitoringRunner({
      targets: ['slow', 'healthy'].map((id) => ({ id, endpoint: `https://${id}.example/mcp` })),
      store: new MemoryMonitoringStore(),
      timeoutMs: 100,
      retry: { maxAttempts: 1 },
      probe: async (target) => target.id === 'slow'
        ? new Promise<{ report: PublicReport }>((resolve) => { resolveSlow = resolve; })
        : { report: report({ endpoint: target.endpoint }) },
    });

    const first = runner.runOnce();
    await vi.advanceTimersByTimeAsync(100);
    await first;
    const mixed = await runner.runOnce();

    expect(mixed.targets.map((target) => target.result)).toEqual(['skipped', 'completed']);
    expect(mixed.aggregate).toMatchObject({
      status: 'degraded', counts: { skipped: 1, healthy: 1 },
    });
    resolveSlow({ report: report() });
    await Promise.resolve();
  });

  it('persists bounded history, status metadata, and before/after drift evidence', async () => {
    vi.useFakeTimers();
    vi.setSystemTime('2026-08-13T03:00:00.000Z');
    const store = new MemoryMonitoringStore();
    let current = report({ at: '2026-08-13T03:00:00.000Z' });
    let sequence = 0;
    const runner = new MonitoringRunner({
      targets: [{
        id: 'api', endpoint: 'https://api.example/mcp', reportBaseUrl: 'https://reports.example/:serverId/:snapshotId',
      }],
      store,
      probe: async () => ({ report: current }),
      retry: { maxAttempts: 1 },
      retention: { perServer: 2, total: 2 },
    }, { createId: (prefix) => `${prefix}-${++sequence}` });

    expect((await runner.runOnce()).targets[0].alerts).toHaveLength(0);
    vi.setSystemTime('2026-08-13T03:05:00.000Z');
    current = report({
      at: '2026-08-13T03:05:00.000Z', transport: 'sse', protocol: 'legacy', toolRequired: ['query'], latency: 400,
      highFinding: true,
    });
    const changed = await runner.runOnce();
    const alert = changed.targets[0].alerts[0];
    expect(alert.kinds).toEqual(expect.arrayContaining([
      'transport-drift', 'protocol-drift', 'tool-schema-drift', 'latency-regression',
      'new-high-severity-finding',
    ]));
    expect(alert.evidence.some(({ path }) => path.includes('inputSchema'))).toBe(true);
    expect(alert.before?.url).toBe('https://reports.example/api/monitor-1');
    expect(alert.after.url).toBe('https://reports.example/api/monitor-2');

    vi.setSystemTime('2026-08-13T03:10:00.000Z');
    current = report({ at: '2026-08-13T03:10:00.000Z' });
    await runner.runOnce();
    const state = await store.load();
    expect(state?.servers.api.snapshots).toHaveLength(2);
    expect(store.reports.size).toBe(2);
    expect(state?.servers.api.summary).toMatchObject({
      currentStatus: 'healthy',
      lastGoodRunAt: '2026-08-13T03:10:00.000Z',
      lastChangeAt: '2026-08-13T03:10:00.000Z',
    });
  });

  it('compares a recovered report with the last scored report across an outage', async () => {
    const store = new MemoryMonitoringStore();
    let current: { report?: PublicReport; failure?: { message: string; provenance: 'target' } } = {
      report: report({ at: '2026-08-13T03:00:00.000Z' }),
    };
    let sequence = 0;
    const runner = new MonitoringRunner({
      targets: [{ id: 'api', endpoint: 'https://api.example/mcp' }],
      store,
      retry: { maxAttempts: 1 },
      retention: { perServer: 1, total: 2 },
      probe: async () => current,
    }, { createId: (prefix) => `${prefix}-${++sequence}` });

    await runner.runOnce();
    current = { failure: { message: 'offline', provenance: 'target' } };
    await runner.runOnce();
    await runner.runOnce();
    current = {
      report: report({
        at: '2026-08-13T03:10:00.000Z', transport: 'sse', protocol: 'legacy',
      }),
    };
    const recovered = await runner.runOnce();
    const alert = recovered.targets[0].alerts[0];

    expect(alert.kinds).toEqual(expect.arrayContaining([
      'recovery', 'transport-drift', 'protocol-drift',
    ]));
    expect(alert.before?.snapshotId).toBe('monitor-1');
    expect(alert.evidence).toContainEqual(expect.objectContaining({
      message: 'Status changed from unavailable to healthy.',
    }));
  });

  it('retains current and newly alerted artifacts until notifications are delivered', async () => {
    const store = new MemoryMonitoringStore();
    let current = report({ at: '2026-08-13T03:00:00.000Z' });
    let sequence = 0;
    const observedArtifacts: boolean[] = [];
    const runner = new MonitoringRunner({
      targets: [{ id: 'api', endpoint: 'https://api.example/mcp' }],
      store,
      retry: { maxAttempts: 1 },
      retention: { perServer: 1, total: 2 },
      probe: async () => ({ report: current }),
      notifications: [{
        name: 'artifact-check',
        send: async (alert) => {
          observedArtifacts.push(Boolean(
            alert.before
            && store.reports.has(alert.before.snapshotId)
            && store.reports.has(alert.after.snapshotId)
          ));
        },
      }],
    }, { createId: (prefix) => `${prefix}-${++sequence}` });

    await runner.runOnce();
    current = report({ at: '2026-08-13T03:05:00.000Z', transport: 'sse' });
    const changed = await runner.runOnce();
    const state = await store.load();

    expect(changed.targets[0].alerts).toHaveLength(1);
    expect(observedArtifacts).toEqual([true]);
    expect(state?.servers.api.snapshots).toHaveLength(2);
    expect(store.reports.size).toBe(2);
  });

  it('retains the before artifact for consecutive non-scored status alerts at minimum retention', async () => {
    const store = new MemoryMonitoringStore();
    let current: { report?: PublicReport; failure?: {
      message: string;
      provenance: 'target' | 'proxy';
    } } = { report: report({ at: '2026-08-13T03:00:00.000Z' }) };
    const deliveredLinks: boolean[] = [];
    const runner = new MonitoringRunner({
      targets: [{ id: 'api', endpoint: 'https://api.example/mcp' }],
      store,
      retry: { maxAttempts: 1 },
      retention: { perServer: 1, total: 2 },
      probe: async () => current,
      notifications: [{
        name: 'artifact-check',
        send: async (alert) => {
          deliveredLinks.push(Boolean(
            alert.before
            && store.reports.has(alert.before.snapshotId)
            && store.reports.has(alert.after.snapshotId)
          ));
        },
      }],
    });

    const healthy = await runner.runOnce();
    current = { failure: { message: 'offline', provenance: 'target' } };
    const unavailable = await runner.runOnce();
    current = { failure: { message: 'proxy offline', provenance: 'proxy' } };
    const proxyFailure = await runner.runOnce();

    const alert = proxyFailure.targets[0].alerts[0];
    const state = await store.load();
    expect(alert.before?.snapshotId).toBe(unavailable.targets[0].snapshot?.id);
    expect(alert.after.snapshotId).toBe(proxyFailure.targets[0].snapshot?.id);
    expect(deliveredLinks).toEqual([true, true]);
    expect(state?.servers.api.snapshots.map(({ id }) => id)).toEqual(expect.arrayContaining([
      healthy.targets[0].snapshot!.id,
      unavailable.targets[0].snapshot!.id,
      proxyFailure.targets[0].snapshot!.id,
    ]));
    expect(store.reports.has(alert.before!.snapshotId)).toBe(true);
    expect(store.reports.has(alert.after.snapshotId)).toBe(true);
  });

  it('rejects retention that cannot hold active current and last-scored baselines', () => {
    const store = new MemoryMonitoringStore();
    expect(() => new MonitoringRunner({
      targets: ['one', 'two'].map((id) => ({ id, endpoint: `https://${id}.example/mcp` })),
      store,
      retention: { perServer: 1, total: 3 },
    })).toThrow(/retention\.total must be at least 4/);
  });

  it('keeps total retention bounded when the configured target set changes across runs', async () => {
    const store = new MemoryMonitoringStore();
    let sequence = 0;
    for (const [index, id] of ['one', 'two', 'three'].entries()) {
      const runner = new MonitoringRunner({
        targets: [{ id, endpoint: `https://${id}.example/mcp` }],
        store,
        retry: { maxAttempts: 1 },
        retention: { perServer: 1, total: 2 },
        probe: async (target) => ({ report: report({
          at: `2026-08-13T03:${String(index).padStart(2, '0')}:00.000Z`,
          endpoint: target.endpoint,
        }) }),
      }, { createId: (prefix) => `${prefix}-${++sequence}` });
      await runner.runOnce();
    }

    const state = await store.load();
    const retained = Object.values(state?.servers || {}).flatMap((server) => server.snapshots);
    expect(retained).toHaveLength(2);
    expect(retained.map((snapshot) => snapshot.serverId).sort()).toEqual(['three', 'two']);
    expect(store.reports.size).toBe(2);
  });

  it('never includes credentials in persisted errors or webhook payloads', async () => {
    const credential = 'elm-cobalt-73-secret';
    const bodies: string[] = [];
    const webhook = createWebhookNotificationAdapter({
      url: `https://hooks.example/${credential}`,
      headers: { Authorization: `Bearer ${credential}` },
      fetch: vi.fn(async (_input, init) => {
        bodies.push(String(init?.body));
        return new Response(null, { status: 204 });
      }),
    });
    const store = new MemoryMonitoringStore();
    const runner = new MonitoringRunner({
      targets: [{
        id: 'secret-test', endpoint: 'https://secret.example/mcp',
        headers: { Authorization: `Bearer ${credential}` },
      }],
      store,
      notifications: [webhook],
      retry: { maxAttempts: 1 },
      probe: async () => { throw new Error(`checker echoed ${credential}`); },
    });
    const result = await runner.runOnce();
    expect(JSON.stringify(result)).not.toContain(credential);
    expect(JSON.stringify(await store.load())).not.toContain(credential);
    expect(bodies.join('')).not.toContain(credential);
  });
});

describe('FileMonitoringStore', () => {
  it('serializes runner transactions across store instances and skips a competing run', async () => {
    const directory = await mkdtemp(join(tmpdir(), 'mcptest-monitor-lock-'));
    try {
      const options = { stateFile: join(directory, 'state.json') };
      let releaseProbe!: () => void;
      const firstProbe = vi.fn(async () => {
        await new Promise<void>((resolve) => { releaseProbe = resolve; });
        return { report: report() };
      });
      const secondProbe = vi.fn(async () => ({ report: report() }));
      const firstRunner = new MonitoringRunner({
        targets: [{ id: 'api', endpoint: 'https://api.example/mcp' }],
        store: new FileMonitoringStore(options),
        retry: { maxAttempts: 1 },
        probe: firstProbe,
      });
      const secondRunner = new MonitoringRunner({
        targets: [{ id: 'api', endpoint: 'https://api.example/mcp' }],
        store: new FileMonitoringStore(options),
        retry: { maxAttempts: 1 },
        probe: secondProbe,
      });

      const first = firstRunner.runOnce();
      await vi.waitFor(() => expect(firstProbe).toHaveBeenCalledTimes(1));
      const competing = await secondRunner.runOnce();
      expect(competing.targets[0]).toMatchObject({
        result: 'skipped', skipReason: 'store-lease-held',
      });
      expect(secondProbe).not.toHaveBeenCalled();

      releaseProbe();
      await first;
      expect((await secondRunner.runOnce()).targets[0].result).toBe('completed');
      const persisted = JSON.parse(await readFile(options.stateFile, 'utf8')) as {
        servers: { api: { snapshots: unknown[] } };
      };
      expect(persisted.servers.api.snapshots).toHaveLength(2);
    } finally {
      await rm(directory, { recursive: true, force: true });
    }
  });

  it('recovers a stale filesystem run lease', async () => {
    const directory = await mkdtemp(join(tmpdir(), 'mcptest-monitor-stale-lock-'));
    try {
      const store = new FileMonitoringStore({
        stateFile: join(directory, 'state.json'),
        lockStaleMs: 1_000,
      });
      const ownerFile = join(store.runLockDirectory, 'owner.json');
      await mkdir(store.runLockDirectory, { recursive: true });
      await writeFile(ownerFile, '{"token":"abandoned"}\n', 'utf8');
      const old = new Date(Date.now() - 10_000);
      await utimes(ownerFile, old, old);

      const lease = await store.acquireRunLease();
      expect(lease).toBeDefined();
      await lease!.release();
      await expect(stat(store.runLockDirectory)).rejects.toMatchObject({ code: 'ENOENT' });
    } finally {
      await rm(directory, { recursive: true, force: true });
    }
  });

  it('confines dot segments and safely persists inherited-property server ids', async () => {
    const directory = await mkdtemp(join(tmpdir(), 'mcptest-monitor-keys-'));
    try {
      const reportDirectory = join(directory, 'artifacts');
      const store = new FileMonitoringStore({
        stateFile: join(directory, 'state.json'),
        reportDirectory,
      });
      let sequence = 0;
      const ids = ['.', '..', '__proto__', 'constructor'];
      const runner = new MonitoringRunner({
        targets: ids.map((id, index) => ({
          id,
          endpoint: `https://server-${index}.example/mcp`,
        })),
        store,
        retry: { maxAttempts: 1 },
        probe: async (target) => ({ report: report({ endpoint: target.endpoint }) }),
      }, { createId: (prefix) => `${prefix}-${++sequence}` });

      const result = await runner.runOnce();
      const persisted = JSON.parse(await readFile(store.stateFile, 'utf8')) as {
        servers: Record<string, unknown>;
      };

      for (const id of ids) {
        expect(Object.prototype.hasOwnProperty.call(persisted.servers, id)).toBe(true);
      }
      expect((await readdir(reportDirectory)).sort()).toEqual(
        ids.map(monitoringArtifactPathPart).sort()
      );
      for (const target of result.targets) {
        const url = target.snapshot?.reportUrl;
        expect(url).toMatch(/^file:/);
        expect(JSON.parse(await readFile(new URL(url!), 'utf8'))).toMatchObject({
          serverId: target.serverId,
          id: target.snapshot?.id,
        });
      }
    } finally {
      await rm(directory, { recursive: true, force: true });
    }
  });

  it('derives default links from a custom relative report directory', () => {
    const store = new FileMonitoringStore({ reportDirectory: 'artifacts' });
    expect(store.snapshotReportUrl('api', 'monitor-1')).toBe('artifacts/api/monitor-1.json');
  });
});

describe('MonitoringScheduler', () => {
  it('uses fake time to schedule the next probe only after the current probe completes', async () => {
    vi.useFakeTimers();
    let finish!: () => void;
    const runOnce = vi.fn(() => new Promise<any>((resolve) => {
      finish = () => resolve({ targets: [] });
    }));
    const scheduler = new MonitoringScheduler({ runOnce }, { intervalMs: 1_000 });
    scheduler.start();
    expect(runOnce).toHaveBeenCalledTimes(1);
    await vi.advanceTimersByTimeAsync(5_000);
    expect(runOnce).toHaveBeenCalledTimes(1);
    finish();
    await Promise.resolve();
    await vi.advanceTimersByTimeAsync(999);
    expect(runOnce).toHaveBeenCalledTimes(1);
    await vi.advanceTimersByTimeAsync(1);
    expect(runOnce).toHaveBeenCalledTimes(2);
    scheduler.stop();
  });
});
