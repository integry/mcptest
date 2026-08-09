import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

const connectionMocks = vi.hoisted(() => ({
  attempt: vi.fn(),
}));

vi.mock('./transportDetection', async (importOriginal) => {
  const actual = await importOriginal<typeof import('./transportDetection')>();
  return {
    ...actual,
    attemptParallelConnections: connectionMocks.attempt,
  };
});

import {
  evaluateServer,
  fetchForEvaluation,
  getEvaluationProxyHeaders,
} from './evaluation';
import { getRequestHeadersForCandidate } from './transportDetection';

describe('evaluation proxy authentication', () => {
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

  it('uses the isolated target header when direct evaluation fetch falls back', async () => {
    const fetchMock = vi.mocked(fetch);
    fetchMock
      .mockRejectedValueOnce(new Error('Direct CORS failure'))
      .mockResolvedValueOnce(new Response('proxied'));

    const response = await fetchForEvaluation(
      'https://mcp.example/mcp',
      'firebase-jwt',
      { headers: { Accept: 'application/json' } },
      'oauth-access-token'
    );

    expect(await response.text()).toBe('proxied');
    expect(fetchMock).toHaveBeenCalledTimes(2);
    const [proxyTarget, proxyInit] = fetchMock.mock.calls[1];
    expect(new URL(String(proxyTarget)).searchParams.get('target')).toBe(
      'https://mcp.example/mcp'
    );
    const proxyHeaders = new Headers(proxyInit?.headers);
    expect(proxyHeaders.get('authorization')).toBe('Bearer firebase-jwt');
    expect(proxyHeaders.get('x-mcp-authorization')).toBe('Bearer oauth-access-token');
  });

  it('uses Firebase for the proxy hop and OAuth only for the MCP target', async () => {
    const client = {
      listTools: vi.fn().mockResolvedValue({ tools: [] }),
      listResources: vi.fn().mockResolvedValue({ resources: [] }),
      listPrompts: vi.fn().mockResolvedValue({ prompts: [] }),
      setLoggingLevel: vi.fn().mockResolvedValue(undefined),
      close: vi.fn().mockResolvedValue(undefined),
    };
    connectionMocks.attempt
      .mockRejectedValueOnce(new Error('Direct CORS failure'))
      .mockResolvedValueOnce({
        client,
        url: 'https://proxy.mcptest.test/?target=https%3A%2F%2Fmcp.example%2Fmcp',
        transportType: 'streamable-http',
      });

    await evaluateServer(
      'https://mcp.example/mcp',
      'firebase-jwt',
      vi.fn(),
      'oauth-access-token'
    );

    expect(connectionMocks.attempt).toHaveBeenCalledTimes(2);
    const [proxyUrl, , proxyAuthToken, targetHeaders] = connectionMocks.attempt.mock.calls[1];
    expect(proxyUrl).toBe(
      'https://proxy.mcptest.test/?target=https%3A%2F%2Fmcp.example%2Fmcp'
    );
    expect(proxyAuthToken).toBe('firebase-jwt');

    const outgoingTargetHeaders = getRequestHeadersForCandidate(proxyUrl, targetHeaders);
    expect(outgoingTargetHeaders.get('authorization')).toBeNull();
    expect(outgoingTargetHeaders.get('x-mcp-authorization')).toBe(
      'Bearer oauth-access-token'
    );
    expect(client.close).toHaveBeenCalledOnce();
  });
});
