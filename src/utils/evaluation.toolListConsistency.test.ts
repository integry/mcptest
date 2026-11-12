import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import Ajv2020 from 'ajv/dist/2020';
import addFormats from 'ajv-formats';
import publicJsonSchema from '../../public/schemas/report/v2.schema.json';

const connectionMocks = vi.hoisted(() => ({ attempt: vi.fn() }));

vi.mock('./transportDetection', async (importOriginal) => {
  const actual = await importOriginal<typeof import('./transportDetection')>();
  return { ...actual, attemptParallelConnections: connectionMocks.attempt };
});

import { evaluateServer } from './evaluation';
import type { ObservedTransportRequest } from './transportDetection';
import { createCompatibilityMatrix, createReleaseDecision } from './releaseReadiness';
import {
  createPublicReport,
  parsePublicReportJson,
  serializePublicReportJson,
  serializePublicReportMarkdown,
} from './reportArtifact';
import { toolListConsistencyFromSections } from './toolListConsistencyReport';
import { diffPublicReports } from './reportDiff';

const ENDPOINT = 'https://replicas.example/mcp';
const PROXIED = `https://proxy.mcptest.test/?target=${encodeURIComponent(ENDPOINT)}`;

const LIST_A = [
  { name: 'search', description: 'Search documents', inputSchema: { type: 'object', properties: { q: { type: 'string' } } } },
  { name: 'fetch', description: 'Fetch a document', inputSchema: { type: 'object', properties: { id: { type: 'string' } } } },
];
// The other build: `fetch` is missing and `search` was reworded.
const LIST_B = [
  { name: 'search', description: 'Search all documents', inputSchema: { type: 'object', properties: { q: { type: 'string' } } } },
];

/**
 * A mocked server behind two replicas. Each connection lands on the next
 * replica in turn and answers tools/list with that replica's build, reporting
 * an instance header the way an edge network would.
 */
const replicaServer = (lists: ReadonlyArray<readonly unknown[]>, options: { pageSize?: number } = {}) => {
  let connections = 0;
  const clients: Array<{ request: ReturnType<typeof vi.fn>; close: ReturnType<typeof vi.fn> }> = [];
  const connect = (
    _url: string,
    _signal?: AbortSignal,
    _token?: string,
    _headers?: HeadersInit,
    _proxy?: boolean,
    _era?: string,
    onRequest?: (request: ObservedTransportRequest) => void
  ) => {
    const replica = connections % lists.length;
    connections += 1;
    const tools = lists[replica];
    const observedRequests: ObservedTransportRequest[] = [];
    const client = {
      request: vi.fn(async ({ method, params }: { method: string; params?: { cursor?: string } }) => {
        if (method === 'tools/list') {
          const request: ObservedTransportRequest = {
            method: 'POST', mcpMethod: 'tools/list', url: ENDPOINT, status: 200, outcome: 'succeeded',
            crossOrigin: false, instanceHeaders: { 'fly-request-id': `replica-${replica + 1}` },
          };
          observedRequests.push(request);
          onRequest?.(request);
          const size = options.pageSize ?? tools.length;
          const start = params?.cursor ? Number(params.cursor) : 0;
          const next = start + size;
          return { tools: tools.slice(start, next), ...(next < tools.length ? { nextCursor: String(next) } : {}) };
        }
        return {
          'resources/list': { resources: [] },
          'resources/templates/list': { resourceTemplates: [] },
          'prompts/list': { prompts: [] },
        }[method];
      }),
      close: vi.fn().mockResolvedValue(undefined),
    };
    clients.push(client);
    return Promise.resolve({
      client,
      url: _proxy ? PROXIED : ENDPOINT,
      transportType: 'streamable-http',
      protocolEra: 'legacy',
      protocolVersion: '2025-11-25',
      observedRequests,
      takeAuthenticationChallenge: () => undefined,
    });
  };
  return { connect, clients, connections: () => connections };
};

const evaluate = (options: Parameters<typeof evaluateServer>[6] = {}, headers?: HeadersInit) => evaluateServer(
  ENDPOINT, undefined, vi.fn(), null, headers, undefined,
  { runtime: 'headless', toolListConsistency: { spacingMs: 0 }, ...options }
);

describe('tool list consistency during an evaluation', () => {
  beforeEach(() => {
    sessionStorage.clear();
    vi.stubEnv('VITE_PROXY_URL', 'https://proxy.mcptest.test/');
    vi.stubGlobal('fetch', vi.fn(async () => new Response('Not found', { status: 404 })));
    connectionMocks.attempt.mockReset();
  });

  afterEach(() => {
    vi.unstubAllEnvs();
    vi.unstubAllGlobals();
  });

  it('reports a non-deterministic tool list with a correct diff when replicas alternate', async () => {
    const server = replicaServer([LIST_A, LIST_B]);
    connectionMocks.attempt.mockImplementation(server.connect);

    const report = await evaluate();

    // One evaluation connection plus two fresh connections, each listing tools once.
    expect(server.connections()).toBe(3);
    const freshCalls = connectionMocks.attempt.mock.calls.slice(1);
    for (const call of freshCalls) {
      expect(call[0]).toBe(ENDPOINT);
      expect(call[4]).toBe(false);
      expect(call[5]).toBe('stateful');
      expect(call[7]).toBe('streamable-http');
    }
    // Only tools/list is repeated: nothing else, and never tools/call.
    for (const client of server.clients.slice(1)) {
      expect(client.request.mock.calls.map(([request]) => request.method)).toEqual(['tools/list']);
      expect(client.close).toHaveBeenCalledOnce();
    }

    const result = toolListConsistencyFromSections(report.sections);
    expect(result).toMatchObject({
      status: 'inconsistent',
      authentication: 'unauthenticated',
      route: 'direct',
      distinctHashes: 2,
      differences: [
        { tool: 'fetch', kind: 'presence', presentIn: [1, 3], absentIn: [2], changedFields: [] },
        { tool: 'search', kind: 'definition', presentIn: [1, 2, 3], absentIn: [], changedFields: ['description'] },
      ],
    });
    expect(result?.samples.map(({ connection, toolCount, instanceHeaders }) => [connection, toolCount, instanceHeaders]))
      .toEqual([
        ['evaluation', 2, { 'fly-request-id': 'replica-1' }],
        ['fresh', 1, { 'fly-request-id': 'replica-2' }],
        ['fresh', 2, { 'fly-request-id': 'replica-1' }],
      ]);
    expect(result?.samples[0].hash).toBe(result?.samples[2].hash);
    expect(result?.samples[0].hash).not.toBe(result?.samples[1].hash);

    const decision = createReleaseDecision(report, createCompatibilityMatrix(report));
    expect(decision.priorities).toContainEqual(expect.objectContaining({
      id: 'tools.list-nondeterministic',
      severity: 'medium',
      title: 'Tool list is not deterministic (likely mixed deploy or stale replica)',
    }));
    expect(report.outcome).toBe('scored');
  });

  it('passes a stable server and keeps the passed check in the published report', async () => {
    const server = replicaServer([LIST_A, LIST_A], { pageSize: 1 });
    connectionMocks.attempt.mockImplementation(server.connect);

    const report = await evaluate();
    const result = toolListConsistencyFromSections(report.sections);
    expect(result?.status).toBe('consistent');
    expect(result?.samples.map(({ pageCount }) => pageCount)).toEqual([undefined, 2, 2]);
    expect(report.sections.toolListConsistency.details[0].text).toBe(
      '✓ tools/list returned identical definitions on 3 of 3 requests (unauthenticated)'
    );
    expect(report.sections.toolListConsistency.maxScore).toBe(0);

    const decision = createReleaseDecision(report, createCompatibilityMatrix(report));
    expect(decision.priorities.map(({ id }) => id)).not.toContain('tools.list-nondeterministic');

    const artifact = createPublicReport(report, { generatedAt: '2026-11-11T00:00:00.000Z', releaseDecision: decision });
    const json = serializePublicReportJson(artifact);
    const ajv = new Ajv2020({ allErrors: true, strict: false });
    addFormats(ajv);
    const validate = ajv.compile(publicJsonSchema);
    expect(validate(JSON.parse(json)), JSON.stringify(validate.errors)).toBe(true);
    const parsed = parsePublicReportJson(json);
    expect(toolListConsistencyFromSections(parsed.sections)).toMatchObject({
      status: 'consistent',
      samples: [
        { hash: result?.samples[0].hash, instanceHeaders: { 'fly-request-id': 'replica-1' } },
        { hash: result?.samples[0].hash },
        { hash: result?.samples[0].hash },
      ],
    });
    expect(serializePublicReportMarkdown(parsed)).toContain('tools/list returned identical definitions on 3 of 3 requests');
  });

  it('sends no extra requests when the first tools/list fails', async () => {
    const client = {
      request: vi.fn(async ({ method }: { method: string }) => {
        if (method === 'tools/list') throw new Error('Internal error');
        return { resources: [], resourceTemplates: [], prompts: [] };
      }),
      close: vi.fn().mockResolvedValue(undefined),
    };
    connectionMocks.attempt.mockResolvedValueOnce({
      client, url: ENDPOINT, transportType: 'streamable-http', protocolEra: 'legacy', observedRequests: [],
    });

    const report = await evaluate();

    expect(connectionMocks.attempt).toHaveBeenCalledTimes(1);
    expect(client.request.mock.calls.filter(([request]) => request.method === 'tools/list')).toHaveLength(1);
    expect(toolListConsistencyFromSections(report.sections)).toMatchObject({
      status: 'not-checked',
      samples: [],
      notCheckedReason: 'The first tools/list did not complete, so no extra requests were sent.',
    });
  });

  it('can be disabled', async () => {
    const server = replicaServer([LIST_A, LIST_B]);
    connectionMocks.attempt.mockImplementation(server.connect);

    const report = await evaluate({ toolListConsistency: false });

    expect(server.connections()).toBe(1);
    expect(report.sections.toolListConsistency).toBeUndefined();
  });

  it('reuses the evaluation route and credentials for fresh connections through the proxy', async () => {
    const server = replicaServer([LIST_A]);
    connectionMocks.attempt
      .mockRejectedValueOnce(new Error('Direct CORS failure'))
      .mockImplementation(server.connect);

    const report = await evaluateServer(
      ENDPOINT, 'firebase-jwt', vi.fn(), 'oauth-access-token', undefined, undefined,
      { toolListConsistency: { spacingMs: 0, samples: 2 } }
    );

    expect(connectionMocks.attempt).toHaveBeenCalledTimes(3);
    const [url, , token, headers, usesProxy] = connectionMocks.attempt.mock.calls[2];
    expect(url).toBe(PROXIED);
    expect(token).toBe('firebase-jwt');
    expect(usesProxy).toBe(true);
    expect(new Headers(headers).get('authorization')).toBe('Bearer oauth-access-token');
    expect(toolListConsistencyFromSections(report.sections)).toMatchObject({
      status: 'consistent', authentication: 'authenticated', route: 'proxy',
    });
  });

  it('records a failed follow-up connection without failing the evaluation', async () => {
    const server = replicaServer([LIST_A]);
    connectionMocks.attempt
      .mockImplementationOnce(server.connect)
      .mockRejectedValueOnce(new Error('HTTP 503 from a draining replica'));

    const report = await evaluate();

    expect(connectionMocks.attempt).toHaveBeenCalledTimes(2);
    expect(report.outcome).toBe('scored');
    expect(toolListConsistencyFromSections(report.sections)).toMatchObject({
      status: 'not-checked',
      samples: [{ status: 'complete' }, { status: 'failed', error: 'HTTP 503 from a draining replica' }],
    });
  });

  it('does not treat a change between authenticated and unauthenticated lists as drift', async () => {
    connectionMocks.attempt.mockImplementation(replicaServer([LIST_B]).connect);
    const anonymous = await evaluate();
    connectionMocks.attempt.mockReset();
    connectionMocks.attempt.mockImplementation(replicaServer([LIST_A]).connect);
    const signedIn = await evaluate({}, { Authorization: 'Bearer test-credential-value' });

    const publish = (report: typeof anonymous, generatedAt: string) => createPublicReport(report, {
      generatedAt,
      releaseDecision: createReleaseDecision(report, createCompatibilityMatrix(report)),
    });
    const before = publish(signedIn, '2026-11-10T00:00:00.000Z');
    const after = publish(anonymous, '2026-11-11T00:00:00.000Z');
    expect(before.capabilityInventory?.authentication).toBe('authenticated');
    expect(after.capabilityInventory?.authentication).toBe('unauthenticated');

    const diff = diffPublicReports(before, after);
    expect(diff.changes).toContainEqual(expect.objectContaining({
      category: 'authentication', path: 'capabilityInventory.authentication', classification: 'unknown',
    }));
    expect(diff.changes.find(({ path }) => path === 'tools.fetch')).toMatchObject({ classification: 'unknown', breaking: false });
    expect(diff.hasBreakingChanges).toBe(false);

    // Same access state: the removal is a real, breaking change.
    const sameAccess = diffPublicReports({ ...before, capabilityInventory: after.capabilityInventory }, after);
    expect(sameAccess.changes.find(({ path }) => path === 'tools.fetch')).toMatchObject({ classification: 'removal', breaking: true });
  });
});
