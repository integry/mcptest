import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

const connectionMocks = vi.hoisted(() => ({ attempt: vi.fn() }));

vi.mock('./transportDetection', async (importOriginal) => {
  const actual = await importOriginal<typeof import('./transportDetection')>();
  return { ...actual, attemptParallelConnections: connectionMocks.attempt };
});

import { evaluateServer } from './evaluation';
import { TransportConnectionError, type ObservedTransportRequest } from './transportDetection';
import { transportDiagnosticsFromSections } from './transportDiagnostics';
import { createCompatibilityMatrix, createReleaseDecision } from './releaseReadiness';

const ENDPOINT = 'https://stateful.example/mcp';
const PROXIED = `https://proxy.mcptest.test/?target=${encodeURIComponent(ENDPOINT)}`;

const createClient = () => {
  const client = {
    request: vi.fn(),
    close: vi.fn().mockResolvedValue(undefined),
  };
  client.request.mockImplementation(({ method }: { method: string }) => ({
    'tools/list': { tools: [] },
    'resources/list': { resources: [] },
    'resources/templates/list': { resourceTemplates: [] },
    'prompts/list': { prompts: [] },
  }[method]));
  return client;
};

const observed = (overrides: Partial<ObservedTransportRequest>): ObservedTransportRequest => ({
  method: 'POST',
  mcpMethod: 'initialize',
  url: ENDPOINT,
  candidateUrl: ENDPOINT,
  targetUrl: ENDPOINT,
  transportType: 'streamable-http',
  startedAt: '2026-10-20T00:00:00.000Z',
  status: 200,
  responseSource: 'target',
  responseContentType: 'application/json',
  crossOrigin: true,
  outcome: 'succeeded',
  ...overrides,
});

describe('evaluation transport diagnostics', () => {
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

  it('reports a missing Expose-Headers as a finding on a failed stateful connection', async () => {
    const failure = Object.assign(new Error('Error POSTing to endpoint: HTTP 400'), { status: 400 });
    connectionMocks.attempt.mockRejectedValueOnce(new TransportConnectionError([failure], [{
      candidateUrl: ENDPOINT,
      transportType: 'streamable-http',
      error: failure,
      observedRequests: [
        observed({ readableResponseHeaders: [] }),
        observed({ mcpMethod: 'notifications/initialized', status: 400, outcome: 'failed' }),
      ],
    }]));

    const report = await evaluateServer(ENDPOINT, undefined, vi.fn());

    expect(report.outcome).toBe('failed');
    expect(transportDiagnosticsFromSections(report.sections)).toEqual([
      expect.objectContaining({ id: 'transport.cors-expose-headers-missing', status: 'detected', severity: 'error' }),
    ]);
    const decision = createReleaseDecision(report, createCompatibilityMatrix(report));
    expect(decision.priorities.map(({ id }) => id)).toContain('transport.cors-expose-headers-missing');
    // The diagnostic is evidence only; it does not change the scoring contract.
    expect(report.sections.transport.status).toBe('skipped');
  });

  it('reports a GET 405 warning and an explicit "not checked" Expose-Headers note through the proxy', async () => {
    const unreadable = new TypeError('Failed to fetch');
    connectionMocks.attempt
      .mockRejectedValueOnce(new TransportConnectionError([unreadable], [{
        candidateUrl: ENDPOINT,
        transportType: 'streamable-http',
        error: unreadable,
        observedRequests: [observed({ status: undefined, responseSource: undefined, outcome: 'failed' })],
      }]))
      .mockResolvedValueOnce({
        client: createClient(),
        url: PROXIED,
        transportType: 'streamable-http',
        protocolEra: 'stateful',
        protocolVersion: '2025-11-25',
        observedRequests: [
          observed({ url: PROXIED, candidateUrl: PROXIED, crossOrigin: true }),
          observed({ url: PROXIED, candidateUrl: PROXIED, method: 'GET', mcpMethod: undefined, status: 405, responseContentType: undefined }),
        ],
      });

    const report = await evaluateServer(ENDPOINT, undefined, vi.fn());

    expect(report.outcome).toBe('scored');
    const diagnostics = transportDiagnosticsFromSections(report.sections);
    expect(diagnostics).toEqual([
      expect.objectContaining({ id: 'transport.get-stream-405', status: 'detected', severity: 'warning' }),
      expect.objectContaining({
        id: 'transport.cors-expose-headers-missing',
        status: 'not-checked',
        notCheckedReason: expect.stringContaining('mcptest proxy'),
      }),
    ]);
    expect(diagnostics[0].evidence[0]).toMatchObject({ route: 'proxy', endpoint: ENDPOINT, status: 405 });
    expect(report.sections.transport.score).toBe(15);

    const decision = createReleaseDecision(report, createCompatibilityMatrix(report));
    expect(decision.priorities.filter(({ id }) => id.startsWith('transport.'))).toEqual([
      expect.objectContaining({ id: 'transport.get-stream-405', severity: 'medium' }),
    ]);
  });

  it('records a readable session header as passing browser evidence', async () => {
    connectionMocks.attempt.mockResolvedValueOnce({
      client: createClient(),
      url: ENDPOINT,
      transportType: 'streamable-http',
      protocolEra: 'stateful',
      protocolVersion: '2025-11-25',
      observedRequests: [observed({ readableResponseHeaders: ['mcp-session-id', 'mcp-protocol-version'] })],
    });

    const report = await evaluateServer(ENDPOINT, undefined, vi.fn());

    expect(transportDiagnosticsFromSections(report.sections)).toEqual([]);
    expect(report.sections.cors.details.map(({ text }) => text)).toContain(
      '✓ The browser could read Mcp-Session-Id on the initialize response'
    );
  });
});
