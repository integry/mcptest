import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import {
  CANDIDATE_GROUP_TIMEOUT_MS,
  attemptParallelConnections,
  getRequestHeadersForCandidate,
  getTransportCandidates,
} from './transportDetection';

const connectionMocks = vi.hoisted(() => ({
  connect: async (_transport: { endpoint: URL }) => {},
}));

vi.mock('./mcpClient', () => {
  const createClient = () => {
    const client = {
      connect: vi.fn((transport: { endpoint: URL }) => connectionMocks.connect(transport)),
      close: vi.fn().mockResolvedValue(undefined),
    };
    return client;
  };

  return {
    createLegacyMcpClient: vi.fn(createClient),
    createNegotiatingMcpClient: vi.fn(createClient),
    getProtocolDetails: vi.fn(() => ({ era: 'stateful', version: '2025-11-25' })),
  };
});

vi.mock('./corsAwareTransport', () => ({
  CorsAwareStreamableHTTPTransport: class {
    constructor(readonly endpoint: URL) {}
  },
}));

vi.mock('./corsAwareSseTransport', () => ({
  CorsAwareSSETransport: class {
    constructor(readonly endpoint: URL) {}
  },
}));

beforeEach(() => {
  connectionMocks.connect = async () => {};
});

afterEach(() => {
  vi.useRealTimers();
});

describe('transport candidate generation', () => {
  it('does not append paths to a custom publisher endpoint', () => {
    const candidates = getTransportCandidates('https://mcp.atlassian.com/v1/mcp/authv2');

    expect(candidates.map(({ url }) => url)).toEqual([
      'https://mcp.atlassian.com/v1/mcp/authv2',
      'https://mcp.atlassian.com/v1/mcp/authv2/',
      'https://mcp.atlassian.com/v1/mcp/authv2',
      'https://mcp.atlassian.com/v1/mcp/authv2/',
    ]);
    expect(candidates.some(({ url }) => url.includes('authv2/mcp'))).toBe(false);
  });

  it('preserves exact root endpoints and conventional transport paths', () => {
    const candidates = getTransportCandidates('https://mcp.deepwiki.com');

    expect(candidates).toContainEqual({
      url: 'https://mcp.deepwiki.com/',
      transportType: 'streamable-http',
    });
    expect(candidates).toContainEqual({
      url: 'https://mcp.deepwiki.com/mcp',
      transportType: 'streamable-http',
    });
    expect(candidates).toContainEqual({
      url: 'https://mcp.deepwiki.com/sse',
      transportType: 'legacy-sse',
    });
  });

  it('varies the target rather than the proxy endpoint', () => {
    const candidates = getTransportCandidates(
      'https://proxy.mcptest.io/?target=https%3A%2F%2Fexample.com%2Fcustom%2Fendpoint'
    );

    expect(candidates).toHaveLength(4);
    expect(candidates.every(({ url }) => url.startsWith('https://proxy.mcptest.io/'))).toBe(true);
    expect(candidates.every(({ url }) => (
      new URL(url).searchParams.get('target')?.startsWith('https://example.com/custom/endpoint')
    ))).toBe(true);
  });

  it('prefers a declared terminal SSE endpoint before its HTTP sibling', () => {
    expect(getTransportCandidates('https://example.com/sse')[0]).toEqual({
      url: 'https://example.com/sse',
      transportType: 'legacy-sse',
    });
  });

  it('does not let a faster fallback replace a successful exact endpoint', async () => {
    const attemptedUrls: string[] = [];
    connectionMocks.connect = async ({ endpoint }) => {
      attemptedUrls.push(endpoint.toString());
      const delay = endpoint.pathname.startsWith('/mcp') ? 20 : 1;
      await new Promise((resolve) => setTimeout(resolve, delay));
    };

    const connection = await attemptParallelConnections('https://example.com/mcp');

    expect(connection).toMatchObject({
      url: 'https://example.com/mcp',
      transportType: 'streamable-http',
    });
    expect(attemptedUrls).toEqual([
      'https://example.com/mcp',
      'https://example.com/mcp/',
    ]);
  });

  it('moves from a hanging root group to a succeeding endpoint fallback', async () => {
    vi.useFakeTimers();
    const attemptedUrls: string[] = [];
    connectionMocks.connect = async ({ endpoint }) => {
      attemptedUrls.push(endpoint.toString());
      if (endpoint.pathname === '/') {
        await new Promise(() => {});
      }
    };

    const connectionPromise = attemptParallelConnections('https://example.com');
    await vi.advanceTimersByTimeAsync(CANDIDATE_GROUP_TIMEOUT_MS);

    await expect(connectionPromise).resolves.toMatchObject({
      url: 'https://example.com/mcp',
      transportType: 'streamable-http',
    });
    expect(attemptedUrls).toEqual([
      'https://example.com/',
      'https://example.com/mcp',
      'https://example.com/mcp/',
    ]);
  });

  it('times out a group when one slash variant hangs after its peer fails', async () => {
    vi.useFakeTimers();
    connectionMocks.connect = async ({ endpoint }) => {
      if (endpoint.pathname === '/mcp') throw new Error('exact endpoint failed');
      if (endpoint.pathname === '/mcp/') await new Promise(() => {});
    };

    const connectionPromise = attemptParallelConnections('https://example.com/mcp');
    await vi.advanceTimersByTimeAsync(CANDIDATE_GROUP_TIMEOUT_MS);

    await expect(connectionPromise).resolves.toMatchObject({
      url: 'https://example.com/sse',
      transportType: 'legacy-sse',
    });
  });

  it('keeps target Authorization separate from proxy authentication', () => {
    const proxyHeaders = getRequestHeadersForCandidate(
      'https://proxy.mcptest.io/?target=https%3A%2F%2Fexample.com%2Fmcp',
      { Authorization: 'Bearer target-secret', 'x-api-key': 'api-secret' }
    );
    const directHeaders = getRequestHeadersForCandidate(
      'https://example.com/mcp',
      { Authorization: 'Bearer target-secret' }
    );

    expect(proxyHeaders.get('authorization')).toBeNull();
    expect(proxyHeaders.get('x-mcp-authorization')).toBe('Bearer target-secret');
    expect(proxyHeaders.get('x-api-key')).toBe('api-secret');
    expect(directHeaders.get('authorization')).toBe('Bearer target-secret');
  });
});
