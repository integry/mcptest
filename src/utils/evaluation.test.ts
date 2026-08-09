import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

const connectionMocks = vi.hoisted(() => ({ attempt: vi.fn() }));

vi.mock('./transportDetection', async (importOriginal) => {
  const actual = await importOriginal<typeof import('./transportDetection')>();
  return { ...actual, attemptParallelConnections: connectionMocks.attempt };
});

import {
  evaluateServer,
  fetchForEvaluation,
  getEvaluationCorsHeaders,
  getEvaluationMaxScore,
  getEvaluationPercentage,
  getEvaluationProxyHeaders,
  getEvaluationTargetUrl,
  getEvaluationTransportProbeUrl,
} from './evaluation';
import { getRequestHeadersForCandidate } from './transportDetection';

const createClient = () => ({
  listTools: vi.fn().mockResolvedValue({ tools: [] }),
  listResources: vi.fn().mockResolvedValue({ resources: [] }),
  listPrompts: vi.fn().mockResolvedValue({ prompts: [] }),
  close: vi.fn().mockResolvedValue(undefined),
});

describe('dual-era server evaluation', () => {
  beforeEach(() => {
    vi.stubEnv('VITE_PROXY_URL', 'https://proxy.mcptest.test/');
    vi.stubGlobal('fetch', vi.fn(async () => new Response('Not found', { status: 404 })));
    connectionMocks.attempt.mockReset();
  });

  afterEach(() => {
    vi.unstubAllEnvs();
    vi.unstubAllGlobals();
  });

  it('keeps Firebase and target OAuth credentials in separate headers', () => {
    const headers = getEvaluationProxyHeaders(
      { 'Content-Type': 'application/json' },
      'firebase-jwt',
      'oauth-access-token'
    );

    expect(headers.get('authorization')).toBe('Bearer firebase-jwt');
    expect(headers.get('x-mcp-authorization')).toBe('Bearer oauth-access-token');
    expect(headers.get('x-oauth-token')).toBeNull();
    expect(headers.get('content-type')).toBe('application/json');
  });

  it('tries a direct fetch before falling back to the proxy', async () => {
    const fetchMock = vi.mocked(fetch);
    fetchMock
      .mockRejectedValueOnce(new Error('Direct CORS failure'))
      .mockResolvedValueOnce(new Response('proxied'));

    const response = await fetchForEvaluation(
      'https://mcp.example/custom/endpoint',
      'firebase-jwt',
      { headers: { Accept: 'application/json' } },
      'oauth-access-token'
    );

    expect(await response.text()).toBe('proxied');
    expect(fetchMock).toHaveBeenCalledTimes(2);
    expect(String(fetchMock.mock.calls[0][0])).toBe('https://mcp.example/custom/endpoint');
    const [proxyTarget, proxyInit] = fetchMock.mock.calls[1];
    expect(new URL(String(proxyTarget)).searchParams.get('target')).toBe(
      'https://mcp.example/custom/endpoint'
    );
    const proxyHeaders = new Headers(proxyInit?.headers);
    expect(proxyHeaders.get('authorization')).toBe('Bearer firebase-jwt');
    expect(proxyHeaders.get('x-mcp-authorization')).toBe('Bearer oauth-access-token');
  });

  it('rewrites only a terminal conventional path for comparison probes', () => {
    const probeUrl = getEvaluationTransportProbeUrl(
      'https://proxy.mcptest.test/?target=https%3A%2F%2Fmcp.example%2Fmcp',
      'sse'
    );

    expect(new URL(probeUrl).searchParams.get('target')).toBe('https://mcp.example/sse');
    expect(getEvaluationTransportProbeUrl('https://mcp.example/custom/grid', 'sse')).toBe(
      'https://mcp.example/custom/grid'
    );
  });

  it('uses Firebase for the proxy hop and OAuth only for the MCP target', async () => {
    const client = createClient();
    connectionMocks.attempt
      .mockRejectedValueOnce(new Error('Direct CORS failure'))
      .mockResolvedValueOnce({
        client,
        url: 'https://proxy.mcptest.test/?target=https%3A%2F%2Fmcp.example%2Fcustom%2Fendpoint',
        transportType: 'streamable-http',
        protocolEra: 'modern',
        protocolVersion: '2026-07-28',
      });

    const report = await evaluateServer(
      'https://mcp.example/custom/endpoint',
      'firebase-jwt',
      vi.fn(),
      'oauth-access-token'
    );

    expect(connectionMocks.attempt).toHaveBeenCalledTimes(2);
    const [proxyUrl, , proxyAuthToken, targetHeaders] = connectionMocks.attempt.mock.calls[1];
    expect(proxyAuthToken).toBe('firebase-jwt');
    const outgoingTargetHeaders = getRequestHeadersForCandidate(proxyUrl, targetHeaders);
    expect(outgoingTargetHeaders.get('authorization')).toBeNull();
    expect(outgoingTargetHeaders.get('x-mcp-authorization')).toBe('Bearer oauth-access-token');
    expect(report.sections.protocol.details[0].metadata).toMatchObject({
      protocolEra: 'modern',
      protocolVersion: '2026-07-28',
      endpoint: 'https://mcp.example/custom/endpoint',
    });
    expect(report.sections.transport.details[0].text).toContain('Streamable HTTP');
    expect(report.sections.cors.score).toBe(0);
    expect(report.sections.cors.details[0].text).toContain('proxy was required');
    expect(client.close).toHaveBeenCalledOnce();
  });

  it('reports a stateful legacy-SSE connection without inventing pre-standard endpoints', async () => {
    const client = createClient();
    connectionMocks.attempt.mockResolvedValueOnce({
      client,
      url: 'https://mcp.example/custom/events',
      transportType: 'legacy-sse',
      protocolEra: 'legacy',
      protocolVersion: '2025-11-25',
    });

    const report = await evaluateServer(
      'https://mcp.example/custom/events',
      'firebase-jwt',
      vi.fn()
    );

    expect(report.sections.protocol.details[0].text).toContain('stateful initialize');
    expect(report.sections.transport.score).toBe(6);
    expect(report.sections.transport.details[0].text).toContain('Deprecated HTTP+SSE');
    expect(report.sections.cors.score).toBe(15);
    expect(report.sections.cors.details[0].text).toContain('Direct browser');
    expect(JSON.stringify(report)).not.toContain('/mcp/v1/');
    expect(getEvaluationTargetUrl('https://mcp.example/custom/events')).toBe(
      'https://mcp.example/custom/events'
    );
  });

  it('uses era-specific CORS headers', () => {
    expect(getEvaluationCorsHeaders('modern', false)).toEqual([
      'content-type',
      'accept',
      'mcp-protocol-version',
      'mcp-method',
      'mcp-name',
    ]);
    expect(getEvaluationCorsHeaders('legacy', true)).toEqual([
      'content-type',
      'accept',
      'mcp-protocol-version',
      'mcp-session-id',
      'last-event-id',
      'authorization',
    ]);
  });

  it('surfaces authentication failures without probing /mcp/v1 routes', async () => {
    connectionMocks.attempt
      .mockRejectedValueOnce(new Error('HTTP 401 Unauthorized'))
      .mockRejectedValueOnce(new Error('HTTP 401 Unauthorized'));

    const report = await evaluateServer('https://mcp.example/mcp', 'firebase-jwt', vi.fn());

    expect(report.sections.auth).toBeDefined();
    expect(report.sections.protocol.score).toBe(0);
    expect(JSON.stringify(report)).not.toContain('/mcp/v1/');
  });

  it('normalizes report scores from the sections included in that run', () => {
    const report = {
      serverUrl: 'https://mcp.example/mcp',
      finalScore: 55,
      sections: {
        protocol: { name: 'Protocol', description: '', score: 15, maxScore: 15, details: [] },
        security: { name: 'Security', description: '', score: 20, maxScore: 40, details: [] },
        auth: { name: 'Auth', description: '', score: 0, maxScore: 1, details: [] },
      },
    };

    expect(getEvaluationMaxScore(report)).toBe(55);
    expect(getEvaluationPercentage(report)).toBe(100);
  });
});
