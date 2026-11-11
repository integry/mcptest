import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import {
  attemptParallelConnections,
  getObservedAuthenticationChallenge,
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

const PROXIED = `https://proxy.mcptest.io/?target=${encodeURIComponent(ENDPOINT)}`;
const CLOUDFLARE_CHALLENGE = '<!DOCTYPE html><html><head><title>Just a moment...</title></head><body><script src="/cdn-cgi/challenge-platform/h/g/orchestrate/chl_page/v1"></script></body></html>';

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

describe('bot protection, rate limits and 402 in the connection flow', () => {
  it('reports a Cloudflare challenge read through the proxy as bot protection, not as an OAuth challenge', async () => {
    const fetchMock = vi.fn().mockResolvedValue(new Response(CLOUDFLARE_CHALLENGE, {
      status: 403,
      headers: {
        'Content-Type': 'text/html; charset=UTF-8',
        'cf-mitigated': 'challenge',
        'X-MCP-Proxy-Response-Source': 'target',
      },
    }));
    vi.stubGlobal('fetch', fetchMock);

    const { error, observed } = await connect(PROXIED, true);

    expect(error).toBeDefined();
    // OAuth discovery would only hit the same rule, so no challenge is raised.
    expect(getObservedAuthenticationChallenge(error)).toBeUndefined();
    expect(observed[0].responseClass).toMatchObject({
      kind: 'bot-protection',
      confidence: 'confirmed',
      signature: 'cloudflare.cf-mitigated',
      headers: { 'cf-mitigated': 'challenge' },
    });
    const diagnostics = collectConnectionTransportDiagnostics([{ route: 'proxy', error }]);
    const diagnostic = diagnostics.find(({ id }) => id === 'transport.bot-protection-challenge');
    expect(diagnostic).toMatchObject({ status: 'detected', severity: 'error' });
    expect(diagnostic?.evidence[0]).toMatchObject({
      endpoint: ENDPOINT,
      status: 403,
      responseSource: 'target',
      headersSeen: { 'cf-mitigated': 'challenge', 'content-type': 'text/html; charset=UTF-8' },
    });
    expect(diagnostic?.evidence[0].observation).toContain('Bot protection is blocking MCP clients on /mcp (Cloudflare)');
  });

  it('keeps a 403 with WWW-Authenticate an authentication challenge', async () => {
    vi.stubGlobal('fetch', vi.fn().mockResolvedValue(new Response('<html>Forbidden</html>', {
      status: 403,
      headers: { 'Content-Type': 'text/html', 'WWW-Authenticate': 'Bearer error="insufficient_scope"' },
    })));

    const { error, observed } = await connect();

    expect(getObservedAuthenticationChallenge(error)).toMatchObject({ status: 403, source: 'target' });
    expect(observed[0].responseClass).toBeUndefined();
    expect(collectConnectionTransportDiagnostics([{ route: 'direct', error }])
      .some(({ id }) => id === 'transport.bot-protection-challenge')).toBe(false);
  });

  it('only suspects bot protection for an unbranded HTML 403', async () => {
    vi.stubGlobal('fetch', vi.fn().mockResolvedValue(new Response('<html><body>Request blocked</body></html>', {
      status: 403,
      headers: { 'Content-Type': 'text/html' },
    })));

    const { error } = await connect();

    expect(getObservedAuthenticationChallenge(error)).toBeUndefined();
    const diagnostic = collectConnectionTransportDiagnostics([{ route: 'direct', error }])
      .find(({ id }) => id === 'transport.bot-protection-challenge');
    expect(diagnostic).toMatchObject({ status: 'suspected', severity: 'error' });
    expect(diagnostic?.unconfirmedReason).toMatch(/^Not confirmed/);
  });

  it('reports an x402 response as payment required with its header as evidence', async () => {
    vi.stubGlobal('fetch', vi.fn().mockResolvedValue(new Response('{}', {
      status: 402,
      headers: { 'Content-Type': 'application/json', 'PAYMENT-REQUIRED': 'eyJ4NDAyVmVyc2lvbiI6Mn0=' },
    })));

    const { error } = await connect();

    const diagnostics = collectConnectionTransportDiagnostics([{ route: 'direct', error }]);
    expect(diagnostics[0]).toMatchObject({ id: 'transport.payment-required-402', status: 'detected', severity: 'error' });
    expect(diagnostics[0].evidence[0].headersSeen).toMatchObject({ 'payment-required': 'eyJ4NDAyVmVyc2lvbiI6Mn0=' });
    expect(diagnostics[0].evidence[0].responseClass).toMatchObject({ vendor: 'x402' });
  });

  it('keeps a JSON 429 from the MCP server a rate limit, not bot protection', async () => {
    vi.stubGlobal('fetch', vi.fn().mockResolvedValue(new Response('{"error":"slow down"}', {
      status: 429,
      headers: { 'Content-Type': 'application/json', 'Retry-After': '120' },
    })));

    const { error, observed } = await connect();

    expect(observed[0].responseClass).toMatchObject({ kind: 'rate-limited' });
    const ids = collectConnectionTransportDiagnostics([{ route: 'direct', error }]).map(({ id }) => id);
    expect(ids).toContain('transport.target-rate-limited-429');
    expect(ids).not.toContain('transport.bot-protection-challenge');
  });

  it('does not classify a real 404', async () => {
    vi.stubGlobal('fetch', vi.fn().mockResolvedValue(new Response('<html>Not Found</html>', {
      status: 404,
      headers: { 'Content-Type': 'text/html' },
    })));

    const { error, observed } = await connect();

    expect(observed[0].responseClass).toBeUndefined();
    expect(collectConnectionTransportDiagnostics([{ route: 'direct', error }])
      .filter(({ status }) => status !== 'not-checked')).toEqual([]);
  });

  it('never classifies the mcptest proxy\'s own responses against the target', async () => {
    vi.stubGlobal('fetch', vi.fn().mockResolvedValue(new Response('<html>blocked</html>', {
      status: 403,
      headers: { 'Content-Type': 'text/html', 'cf-mitigated': 'challenge', 'X-MCP-Proxy-Response-Source': 'proxy' },
    })));

    const { observed } = await connect(PROXIED, true);

    expect(observed[0].responseClass).toBeUndefined();
  });
});
