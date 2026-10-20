import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import {
  MAX_AUTOMATIC_RATE_LIMIT_WAIT_MS,
  attemptParallelConnections,
  type ObservedTransportRequest,
} from './transportDetection';
import { collectConnectionTransportDiagnostics } from './connectionDiagnostics';

type TransportFetch = (input: RequestInfo | URL, init?: RequestInit) => Promise<Response>;

const connectionMocks = vi.hoisted(() => ({
  connect: async (_transport: { endpoint: URL; fetch?: TransportFetch }) => {},
}));

vi.mock('./mcpClient', () => {
  const createClient = () => ({
    connect: vi.fn((transport: { endpoint: URL; fetch?: TransportFetch }) => connectionMocks.connect(transport)),
    close: vi.fn().mockResolvedValue(undefined),
  });
  return {
    createLegacyMcpClient: vi.fn(createClient),
    createNegotiatingMcpClient: vi.fn(createClient),
    getProtocolDetails: vi.fn(() => ({ era: 'stateful', version: '2025-11-25' })),
  };
});

vi.mock('./corsAwareTransport', () => ({
  CorsAwareStreamableHTTPTransport: class {
    readonly fetch?: TransportFetch;
    constructor(readonly endpoint: URL, options?: { fetch?: TransportFetch }) {
      this.fetch = options?.fetch;
    }
  },
}));

vi.mock('./corsAwareSseTransport', () => ({
  CorsAwareSSETransport: class {
    readonly fetch?: TransportFetch;
    constructor(readonly endpoint: URL, options?: { fetch?: TransportFetch }) {
      this.fetch = options?.fetch;
    }
  },
}));

const ENDPOINT = 'https://mcp.example.com/mcp';
const initializeBody = JSON.stringify({ jsonrpc: '2.0', id: 1, method: 'initialize', params: {} });

/** Connects by POSTing initialize once through the observed transport fetch. */
const postInitialize = () => {
  connectionMocks.connect = async ({ endpoint, fetch }) => {
    const response = await fetch?.(endpoint, {
      method: 'POST',
      headers: { Accept: 'application/json, text/event-stream', 'Content-Type': 'application/json' },
      body: initializeBody,
    });
    if (!response?.ok) {
      throw Object.assign(new Error(`Error POSTing to endpoint: HTTP ${response?.status}`), { status: response?.status });
    }
  };
};

const rateLimited = (headers: Record<string, string> = {}) => new Response('{"error":"slow down"}', {
  status: 429,
  headers: { 'Content-Type': 'application/json', ...headers },
});

const ok = () => new Response('{}', {
  status: 200,
  headers: { 'Content-Type': 'application/json', 'Mcp-Session-Id': 'session-1' },
});

const connect = async (url = ENDPOINT, usesProxy = false) => {
  const observed: ObservedTransportRequest[] = [];
  try {
    const result = await attemptParallelConnections(
      url,
      undefined,
      undefined,
      undefined,
      usesProxy,
      undefined,
      (request) => observed.push(request),
      'streamable-http'
    );
    return { result, observed };
  } catch (error) {
    return { error, observed };
  }
};

beforeEach(() => {
  postInitialize();
});

afterEach(() => {
  vi.useRealTimers();
  vi.unstubAllGlobals();
});

describe('target HTTP 429 retry', () => {
  it('honors Retry-After seconds and retries exactly once', async () => {
    const fetchMock = vi.fn()
      .mockResolvedValueOnce(rateLimited({ 'Retry-After': '1' }))
      .mockResolvedValueOnce(ok());
    vi.stubGlobal('fetch', fetchMock);

    const startedAt = Date.now();
    const { result, observed } = await connect();

    expect(result).toBeDefined();
    expect(Date.now() - startedAt).toBeGreaterThanOrEqual(950);
    expect(fetchMock).toHaveBeenCalledTimes(2);
    expect(observed).toHaveLength(2);
    expect(observed[0]).toMatchObject({
      status: 429,
      retryAfter: '1',
      rateLimitRetry: { action: 'retried', waitMs: 1000 },
    });
    expect(observed[1]).toMatchObject({
      status: 200,
      automaticRetry: { reason: 'target-rate-limit', waitMs: 1000 },
      readableResponseHeaders: ['mcp-session-id'],
    });
    // The retried body is the same initialize request.
    expect(fetchMock.mock.calls[1][1]?.body).toBe(initializeBody);
  });

  it('honors a Retry-After HTTP-date', async () => {
    vi.stubGlobal('fetch', vi.fn()
      .mockResolvedValueOnce(rateLimited({ 'Retry-After': new Date(Date.now() + 1000).toUTCString() }))
      .mockResolvedValueOnce(ok()));

    const { result, observed } = await connect();

    expect(result).toBeDefined();
    expect(observed[0].rateLimitRetry?.action).toBe('retried');
    expect(observed[0].rateLimitRetry?.waitMs).toBeGreaterThanOrEqual(0);
    expect(observed[0].rateLimitRetry?.waitMs).toBeLessThanOrEqual(MAX_AUTOMATIC_RATE_LIMIT_WAIT_MS);
  });

  it('never retries a second time when the retry is rate-limited again', async () => {
    const fetchMock = vi.fn().mockImplementation(async () => rateLimited({ 'Retry-After': '0' }));
    vi.stubGlobal('fetch', fetchMock);

    const { error, observed } = await connect();

    expect(error).toBeDefined();
    expect(fetchMock).toHaveBeenCalledTimes(2);
    expect(observed[1].rateLimitRetry).toEqual({
      action: 'not-retried',
      waitMs: 0,
      reason: 'mcptest retries a rate-limited request at most once.',
    });
    const [diagnostic] = collectConnectionTransportDiagnostics([{ route: 'direct', error }]);
    expect(diagnostic).toMatchObject({ id: 'transport.target-rate-limited-429', severity: 'error', retryAfterSeconds: 0 });
  });

  it('does not wait for a Retry-After longer than one attempt and surfaces it instead', async () => {
    const fetchMock = vi.fn().mockResolvedValue(rateLimited({ 'Retry-After': '120' }));
    vi.stubGlobal('fetch', fetchMock);

    const { error, observed } = await connect();

    expect(fetchMock).toHaveBeenCalledTimes(1);
    expect(observed[0].rateLimitRetry).toMatchObject({ action: 'not-retried', waitMs: 120_000 });
    const [diagnostic] = collectConnectionTransportDiagnostics([{ route: 'direct', error }]);
    expect(diagnostic).toMatchObject({ id: 'transport.target-rate-limited-429', retryAfterSeconds: 120 });
  });

  it('does not retry the mcptest proxy caller limit', async () => {
    const fetchMock = vi.fn().mockResolvedValue(new Response('limited', {
      status: 429,
      headers: {
        'X-MCP-Proxy-Response-Source': 'proxy',
        'X-MCP-Proxy-Limit': 'anonymous',
        'Retry-After': '1',
      },
    }));
    vi.stubGlobal('fetch', fetchMock);

    const { error } = await connect(`https://proxy.mcptest.io/?target=${encodeURIComponent(ENDPOINT)}`, true);

    expect(fetchMock).toHaveBeenCalledTimes(1);
    const diagnostics = collectConnectionTransportDiagnostics([{ route: 'proxy', error }]);
    expect(diagnostics.some(({ id }) => id === 'transport.target-rate-limited-429')).toBe(false);
  });
});

describe('observed transport evidence', () => {
  it('records negotiation headers and Content-Type without credential values', async () => {
    vi.stubGlobal('fetch', vi.fn().mockResolvedValue(new Response('not acceptable', {
      status: 406,
      headers: { 'Content-Type': 'text/plain' },
    })));
    connectionMocks.connect = async ({ endpoint, fetch }) => {
      const response = await fetch?.(endpoint, {
        method: 'POST',
        headers: {
          Accept: 'application/json, text/event-stream',
          'Content-Type': 'application/json',
          Authorization: 'Bearer secret-token-value',
        },
        body: initializeBody,
      });
      throw Object.assign(new Error('HTTP 406'), { status: response?.status });
    };

    const { error, observed } = await connect();

    expect(observed[0]).toMatchObject({
      requestAccept: 'application/json, text/event-stream',
      requestContentType: 'application/json',
      responseContentType: 'text/plain',
      crossOrigin: true,
    });
    expect(JSON.stringify(observed)).not.toContain('secret-token-value');
    const [diagnostic] = collectConnectionTransportDiagnostics([{ route: 'direct', error }]);
    expect(diagnostic.id).toBe('transport.accept-header-406');
    expect(JSON.stringify(diagnostic)).not.toContain('secret-token-value');
  });
});
