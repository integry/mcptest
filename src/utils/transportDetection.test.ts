import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import {
  CANDIDATE_GROUP_TIMEOUT_MS,
  ProxiedAuthenticationError,
  TransportConnectionError,
  attemptParallelConnections,
  getObservedAuthenticationChallenge,
  getProxyCallerLimit,
  getRequestHeadersForCandidate,
  getTransportCandidates,
  inspectSafeTargetError,
  sanitizeAuthenticationChallenge,
  shouldRetryMcpConnectionThroughProxy,
} from './transportDetection';

const connectionMocks = vi.hoisted(() => ({
  connect: async (_transport: {
    endpoint: URL;
    fetch?: (input: RequestInfo | URL, init?: RequestInit) => Promise<Response>;
  }, _options?: { prior?: { kind: string } }) => {},
}));

vi.mock('./mcpClient', () => {
  const createClient = () => {
    const client = {
      connect: vi.fn((transport: { endpoint: URL }, options?: { prior?: { kind: string } }) => (
        connectionMocks.connect(transport, options)
      )),
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
    readonly fetch?: (input: RequestInfo | URL, init?: RequestInit) => Promise<Response>;

    constructor(readonly endpoint: URL, options?: { fetch?: typeof fetch }) {
      this.fetch = options?.fetch;
    }
  },
}));

vi.mock('./corsAwareSseTransport', () => ({
  CorsAwareSSETransport: class {
    readonly fetch?: (input: RequestInfo | URL, init?: RequestInit) => Promise<Response>;

    constructor(readonly endpoint: URL, options?: { fetch?: typeof fetch }) {
      this.fetch = options?.fetch;
    }
  },
}));

beforeEach(() => {
  connectionMocks.connect = async () => {};
});

afterEach(() => {
  vi.useRealTimers();
  vi.unstubAllGlobals();
});

describe('transport candidate generation', () => {
  it('tries definitive endpoint transport evidence before a contradictory path suffix', () => {
    expect(getTransportCandidates(
      'https://example.com/sse',
      false,
      'streamable-http'
    )).toEqual([
      { url: 'https://example.com/sse', transportType: 'streamable-http' },
    ]);
  });

  it('uses only the catalog-selected Streamable HTTP transport', () => {
    expect(getTransportCandidates(
      'https://mcp.slack.com/mcp',
      false,
      'streamable-http'
    )).toEqual([
      { url: 'https://mcp.slack.com/mcp', transportType: 'streamable-http' },
    ]);
  });
  it('strictly redacts challenge parameters and credential variants in metadata URLs', () => {
    const sanitized = sanitizeAuthenticationChallenge(
      'Bearer realm="private-tenant", error="invalid_token", error_description="token rejected for alice@example.com", '
      + 'resource_metadata="https://auth.example/metadata?device_code=device-secret&user_code=user-secret&code_verifier=verifier-secret&client_assertion=assertion-secret&registration_access_token=registration-secret&custom_secret=custom-secret&signed_request=signed-secret&login_hint=alice%40example.com&x-amz-signature=aws-secret&tenant=acme"'
    );

    expect(sanitized).toContain('realm="[REDACTED]"');
    expect(sanitized).toContain('error="invalid_token"');
    expect(sanitized).toContain('error_description="[REDACTED]"');
    expect(sanitized).toContain('tenant=acme');
    for (const secret of [
      'private-tenant',
      'token rejected for alice@example.com',
      'device-secret',
      'user-secret',
      'verifier-secret',
      'assertion-secret',
      'registration-secret',
      'custom-secret',
      'signed-secret',
      'alice@example.com',
      'aws-secret',
    ]) {
      expect(decodeURIComponent(sanitized)).not.toContain(secret);
    }
  });

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
      'https://proxy.mcptest.io/?target=https%3A%2F%2Fexample.com%2Fcustom%2Fendpoint',
      true
    );

    expect(candidates).toHaveLength(4);
    expect(candidates.every(({ url }) => url.startsWith('https://proxy.mcptest.io/'))).toBe(true);
    expect(candidates.every(({ url }) => (
      new URL(url).searchParams.get('target')?.startsWith('https://example.com/custom/endpoint')
    ))).toBe(true);
  });

  it.each([
    ['URL-valued', 'https://tenant.example/account'],
    ['ordinary', 'production'],
  ])('preserves a direct custom endpoint with a %s target parameter', (_, target) => {
    const endpoint = new URL('https://mcp.example/custom/endpoint');
    endpoint.searchParams.set('target', target);
    endpoint.searchParams.set('tenant', 'acme');

    const candidates = getTransportCandidates(endpoint.toString(), false);

    expect(candidates[0].url).toBe(endpoint.toString());
    expect(candidates.every(({ url }) => new URL(url).origin === endpoint.origin)).toBe(true);
    expect(candidates.every(({ url }) => new URL(url).searchParams.get('target') === target)).toBe(true);
    expect(candidates.every(({ url }) => new URL(url).searchParams.get('tenant') === 'acme')).toBe(true);
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
    expect(attemptedUrls).toEqual(['https://example.com/mcp']);
  });

  it('tries a slash variant only after the exact endpoint fails', async () => {
    const attemptedUrls: string[] = [];
    connectionMocks.connect = async ({ endpoint }) => {
      attemptedUrls.push(endpoint.toString());
      if (endpoint.pathname === '/mcp') throw new Error('exact endpoint failed');
    };

    const connection = await attemptParallelConnections('https://example.com/mcp');

    expect(connection).toMatchObject({
      url: 'https://example.com/mcp/',
      transportType: 'streamable-http',
    });
    expect(attemptedUrls).toEqual([
      'https://example.com/mcp',
      'https://example.com/mcp/',
    ]);
  });

  it('skips modern discovery when a catalog entry is known to be stateful', async () => {
    let connectOptions: { prior?: { kind: string } } | undefined;
    connectionMocks.connect = async (_transport, options) => {
      connectOptions = options;
    };

    await attemptParallelConnections(
      'https://example.com/mcp',
      undefined,
      undefined,
      undefined,
      false,
      'stateful'
    );

    expect(connectOptions).toEqual({ prior: { kind: 'legacy' } });
  });

  it('keeps modern negotiation when a catalog entry is known to be stateless', async () => {
    let connectOptions: { prior?: { kind: string } } | undefined;
    connectionMocks.connect = async (_transport, options) => {
      connectOptions = options;
    };

    await attemptParallelConnections(
      'https://example.com/mcp',
      undefined,
      undefined,
      undefined,
      false,
      'stateless'
    );

    expect(connectOptions).toBeUndefined();
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

  it('preserves a settled authentication error when its slash sibling times out', async () => {
    vi.useFakeTimers();
    const targetAuthError = Object.assign(new Error('Target requires authentication'), {
      status: 401,
    });
    connectionMocks.connect = async ({ endpoint }) => {
      if (endpoint.pathname === '/mcp') throw targetAuthError;
      if (endpoint.pathname === '/mcp/') await new Promise(() => {});
      throw new Error('Fallback endpoint failed');
    };

    const connectionPromise = attemptParallelConnections('https://example.com/mcp');
    const connectionOutcome = connectionPromise.catch((error) => error);
    await vi.advanceTimersByTimeAsync(CANDIDATE_GROUP_TIMEOUT_MS);

    const connectionError: unknown = await connectionOutcome;

    const findAuthenticationCandidate = (error: unknown): { candidateUrl: string } | undefined => {
      if (!(error instanceof TransportConnectionError)) return undefined;
      const match = error.candidateFailures.find(({ error: candidateError }) => (
        (candidateError as { status?: number }).status === 401
      ));
      if (match) return match;
      for (const nestedError of error.errors) {
        const nestedMatch = findAuthenticationCandidate(nestedError);
        if (nestedMatch) return nestedMatch;
      }
      return undefined;
    };

    expect(connectionError).toBeInstanceOf(TransportConnectionError);
    expect(findAuthenticationCandidate(connectionError)).toMatchObject({
      candidateUrl: 'https://example.com/mcp',
      error: targetAuthError,
    });
  });

  it('keeps target Authorization separate from proxy authentication', () => {
    const proxyHeaders = getRequestHeadersForCandidate(
      'https://proxy.mcptest.io/?target=https%3A%2F%2Fexample.com%2Fmcp',
      { Authorization: 'Bearer target-secret', 'x-api-key': 'api-secret' },
      true
    );
    const directHeaders = getRequestHeadersForCandidate(
      'https://example.com/custom?target=https%3A%2F%2Ftenant.example',
      { Authorization: 'Bearer target-secret' },
      false
    );

    expect(proxyHeaders.get('authorization')).toBeNull();
    expect(proxyHeaders.get('x-mcp-authorization')).toBe('Bearer target-secret');
    expect(proxyHeaders.get('x-api-key')).toBe('api-secret');
    expect(directHeaders.get('authorization')).toBe('Bearer target-secret');
  });

  it('retains structured HTTP failures from candidate attempts', async () => {
    const targetAuthError = Object.assign(new Error('Target requires authentication'), {
      status: 401,
    });
    connectionMocks.connect = async () => {
      throw targetAuthError;
    };

    let connectionError: unknown;
    try {
      await attemptParallelConnections('https://example.com/custom');
    } catch (error) {
      connectionError = error;
    }

    expect(connectionError).toBeInstanceOf(TransportConnectionError);
    const containsTargetError = (error: unknown): boolean => (
      error === targetAuthError
      || (
        error instanceof TransportConnectionError
        && error.errors.some(containsTargetError)
      )
    );
    expect(containsTargetError(connectionError)).toBe(true);
  });

  it('records the anonymous proxy caller limit without treating it as a target error', async () => {
    vi.stubGlobal('fetch', vi.fn().mockImplementation(async () => new Response(JSON.stringify({
      error: 'rate_limited',
      tier: 'anonymous',
      signInLiftsLimit: true,
    }), {
      status: 429,
      headers: {
        'Content-Type': 'application/json',
        'Retry-After': '60',
        'X-MCP-Proxy-Limit': 'anonymous',
        'X-MCP-Proxy-Response-Source': 'proxy',
      },
    })));
    connectionMocks.connect = async ({ endpoint, fetch }) => {
      const response = await fetch?.(endpoint);
      throw Object.assign(new Error('Streamable HTTP error'), { status: response?.status });
    };

    let connectionError: unknown;
    try {
      await attemptParallelConnections(
        'https://proxy.mcptest.io/?target=https%3A%2F%2Fexample.com%2Fmcp',
        undefined,
        undefined,
        undefined,
        true
      );
    } catch (error) {
      connectionError = error;
    }

    expect(getProxyCallerLimit(connectionError)).toEqual({ tier: 'anonymous', retryAfterSeconds: 60 });
    expect(getObservedAuthenticationChallenge(connectionError)).toBeUndefined();
  });

  it('records a proxy limit that cut off a streamed target response without a declared length', async () => {
    const encoder = new TextEncoder();
    vi.stubGlobal('fetch', vi.fn().mockImplementation(async () => new Response(new ReadableStream({
      start(controller) {
        controller.enqueue(encoder.encode('{"jsonrpc":"2.0","id":1,"result":{"padding":"'));
        controller.enqueue(encoder.encode(
          '\u0000mcptest-proxy-limit:signal-token\n{"error":"rate_limited","tier":"anonymous","limit":"response_bytes","signInLiftsLimit":true}'
        ));
        controller.close();
      },
    }), {
      status: 200,
      headers: {
        'Content-Type': 'application/json',
        'X-MCP-Proxy-Response-Source': 'target',
        'X-MCP-Proxy-Limit-Signal': 'signal-token',
      },
    })));
    connectionMocks.connect = async ({ endpoint, fetch }) => {
      const response = await fetch!(endpoint);
      await response.json();
    };

    let connectionError: unknown;
    try {
      await attemptParallelConnections(
        'https://proxy.mcptest.io/?target=https%3A%2F%2Fexample.com%2Fmcp',
        undefined,
        undefined,
        undefined,
        true
      );
    } catch (error) {
      connectionError = error;
    }

    expect(getProxyCallerLimit(connectionError)).toEqual({ tier: 'anonymous', kind: 'response_bytes' });
  });

  it('ignores a target 429 that carries no proxy limit marker', async () => {
    vi.stubGlobal('fetch', vi.fn().mockImplementation(async () => new Response('Too many', {
      status: 429,
      headers: { 'X-MCP-Proxy-Response-Source': 'target', 'X-MCP-Proxy-Limit': 'anonymous' },
    })));
    connectionMocks.connect = async ({ endpoint, fetch }) => {
      const response = await fetch?.(endpoint);
      throw Object.assign(new Error('Streamable HTTP error'), { status: response?.status });
    };

    let connectionError: unknown;
    try {
      await attemptParallelConnections(
        'https://proxy.mcptest.io/?target=https%3A%2F%2Fexample.com%2Fmcp',
        undefined,
        undefined,
        undefined,
        true
      );
    } catch (error) {
      connectionError = error;
    }

    expect(connectionError).toBeDefined();
    expect(getProxyCallerLimit(connectionError)).toBeUndefined();
  });

  it('preserves a target authentication challenge observed through the proxy', async () => {
    const responseBody = JSON.stringify({
      jsonrpc: '2.0',
      error: { code: -32000, message: 'Invalid Origin: mcptest.io' },
      id: null,
    });
    vi.stubGlobal('fetch', vi.fn().mockResolvedValue(new Response(responseBody, {
      status: 403,
      headers: {
        'Content-Type': 'application/json',
        'X-MCP-Proxy-Response-Source': 'target',
      },
    })));
    connectionMocks.connect = async ({ endpoint, fetch }) => {
      const response = await fetch?.(endpoint);
      expect(await response?.text()).toBe(responseBody);
      throw Object.assign(new Error('Connection rejected'), { status: response?.status });
    };

    let connectionError: unknown;
    try {
      await attemptParallelConnections(
        'https://proxy.mcptest.io/?target=https%3A%2F%2Fexample.com%2Fcustom',
        undefined,
        'firebase-jwt',
        undefined,
        true
      );
    } catch (error) {
      connectionError = error;
    }

    const findProxiedAuthenticationError = (
      error: unknown
    ): ProxiedAuthenticationError | undefined => {
      if (error instanceof ProxiedAuthenticationError) return error;
      if (error instanceof TransportConnectionError) {
        for (const nestedError of error.errors) {
          const match = findProxiedAuthenticationError(nestedError);
          if (match) return match;
        }
      }
      return undefined;
    };
    expect(findProxiedAuthenticationError(connectionError)).toMatchObject({
      status: 403,
      responseSource: 'target',
      targetError: {
        code: -32000,
        message: 'Invalid Origin: mcptest.io',
      },
    });
  });

  it('extracts only bounded redacted target errors without consuming the response', async () => {
    const secret = 'sk_live_targetcredential123456';
    const body = JSON.stringify({
      error: {
        code: -32001,
        message: `Vendor value tenant-credential-value; Authorization: Bearer ${secret}; Cookie: session=private-cookie`,
      },
    });
    const response = new Response(body, {
      status: 403,
      headers: { 'Content-Type': 'application/json; charset=utf-8' },
    });

    const detail = await inspectSafeTargetError(response, ['tenant-credential-value']);

    expect(detail).toMatchObject({ code: -32001 });
    expect(detail?.message).toContain('Vendor value [REDACTED]');
    expect(detail?.message).toContain('[REDACTED]');
    expect(JSON.stringify(detail)).not.toContain(secret);
    expect(JSON.stringify(detail)).not.toContain('private-cookie');
    expect(JSON.stringify(detail)).not.toContain('tenant-credential-value');
    await expect(response.text()).resolves.toBe(body);
  });

  it('rejects oversized and HTML target bodies', async () => {
    const oversized = 'x'.repeat(9 * 1024);
    const oversizedResponse = new Response(oversized, {
      status: 500,
      headers: {
        'Content-Type': 'text/plain',
        'Content-Length': String(oversized.length),
      },
    });
    const htmlResponse = new Response('<html><body>secret page</body></html>', {
      status: 500,
      headers: { 'Content-Type': 'text/html' },
    });
    const disguisedHtmlResponse = new Response('<script>token = "secret"</script>', {
      status: 500,
      headers: { 'Content-Type': 'text/plain' },
    });

    await expect(inspectSafeTargetError(oversizedResponse)).resolves.toBeUndefined();
    await expect(inspectSafeTargetError(htmlResponse)).resolves.toBeUndefined();
    await expect(inspectSafeTargetError(disguisedHtmlResponse)).resolves.toBeUndefined();
    await expect(oversizedResponse.text()).resolves.toBe(oversized);
  });

  it('preserves a direct authentication challenge from the HTTP response', async () => {
    vi.stubGlobal('fetch', vi.fn().mockResolvedValue(new Response('Unauthorized', {
      status: 401,
    })));
    connectionMocks.connect = async ({ endpoint, fetch }) => {
      await fetch?.(endpoint);
      throw new Error('Connection rejected');
    };

    let connectionError: unknown;
    try {
      await attemptParallelConnections('https://example.com/custom');
    } catch (error) {
      connectionError = error;
    }

    const findAuthenticationError = (
      error: unknown
    ): ProxiedAuthenticationError | undefined => {
      if (error instanceof ProxiedAuthenticationError) return error;
      if (error instanceof TransportConnectionError) {
        for (const nestedError of error.errors) {
          const match = findAuthenticationError(nestedError);
          if (match) return match;
        }
      }
      return undefined;
    };

    expect(findAuthenticationError(connectionError)).toMatchObject({
      status: 401,
      responseSource: 'target',
    });
  });

  it.each([
    ['Streamable HTTP', 'https://example.com/mcp'],
    ['legacy SSE', 'https://example.com/sse'],
  ])('preserves a real %s challenge even when the SDK connection stalls', async (
    _label,
    endpoint
  ) => {
    vi.stubGlobal('fetch', vi.fn().mockResolvedValue(new Response('Unauthorized', {
      status: 401,
      headers: {
        'WWW-Authenticate': 'Bearer resource_metadata="https://example.com/.well-known/oauth-protected-resource"',
      },
    })));
    connectionMocks.connect = async ({ endpoint: candidateEndpoint, fetch }) => {
      await fetch?.(candidateEndpoint);
      await new Promise(() => {});
    };

    const connectionError = await attemptParallelConnections(endpoint).catch((error) => error);
    const challenge = getObservedAuthenticationChallenge(connectionError);

    expect(challenge).toMatchObject({
      status: 401,
      source: 'target',
      responseHeaders: {
        'www-authenticate': expect.stringContaining('Bearer'),
      },
    });
  });

  it('retains direct target provenance for requests made after connection', async () => {
    vi.stubGlobal('fetch', vi.fn().mockResolvedValue(new Response('Forbidden', {
      status: 403,
      headers: {
        'WWW-Authenticate': 'Bearer realm="mcp", resource_metadata="https://auth.example/metadata?token=header-secret", access_token="raw-secret"',
      },
    })));

    const connection = await attemptParallelConnections('https://example.com/custom');
    const mockTransport = connection.transport as typeof connection.transport & {
      fetch?: typeof fetch;
    };
    await mockTransport.fetch?.(connection.url);

    const challenge = connection.takeAuthenticationChallenge();
    expect(challenge).toMatchObject({
      status: 403,
      source: 'target',
      method: 'GET',
      requestUrl: 'https://example.com/custom',
      responseHeaders: {
        'www-authenticate': expect.stringContaining('resource_metadata='),
      },
    });
    expect(challenge?.resourceMetadataUrl).toBe(
      'https://auth.example/metadata?token=header-secret'
    );
    expect(JSON.stringify(challenge)).not.toContain('header-secret');
    expect(JSON.stringify(challenge)).not.toContain('raw-secret');
    expect(connection.takeAuthenticationChallenge()).toBeUndefined();
  });

  it('retains proxy response provenance for requests made after connection', async () => {
    vi.stubGlobal('fetch', vi.fn().mockResolvedValue(new Response('Unauthorized', {
      status: 401,
      headers: { 'X-MCP-Proxy-Response-Source': 'target' },
    })));

    const connection = await attemptParallelConnections(
      'https://proxy.mcptest.io/?target=https%3A%2F%2Fexample.com%2Fcustom',
      undefined,
      'firebase-jwt',
      undefined,
      true
    );
    const mockTransport = connection.transport as typeof connection.transport & {
      fetch?: typeof fetch;
    };
    await mockTransport.fetch?.(connection.url);

    expect(connection.observedRequests?.[connection.observedRequests.length - 1]).toMatchObject({
      status: 401,
      responseSource: 'target',
    });

    expect(connection.takeAuthenticationChallenge()).toMatchObject({
      status: 401,
      source: 'target',
      method: 'GET',
      requestUrl: 'https://proxy.mcptest.io/?target=https%3A%2F%2Fexample.com%2Fcustom',
    });
    expect(connection.takeAuthenticationChallenge()).toBeUndefined();
  });

  it('retains proxy provenance for a non-authentication proxy response', async () => {
    vi.stubGlobal('fetch', vi.fn().mockResolvedValue(new Response('Bad gateway', {
      status: 502,
      headers: {
        'X-MCP-Proxy-Response-Source': 'proxy',
        'Retry-After': '12',
      },
    })));

    const connection = await attemptParallelConnections(
      'https://proxy.mcptest.io/?target=https%3A%2F%2Fexample.com%2Fcustom',
      undefined,
      'firebase-jwt',
      undefined,
      true
    );
    const mockTransport = connection.transport as typeof connection.transport & {
      fetch?: typeof fetch;
    };
    await mockTransport.fetch?.(connection.url);

    expect(connection.observedRequests?.[connection.observedRequests.length - 1]).toMatchObject({
      status: 502,
      outcome: 'failed',
      responseSource: 'proxy',
      retryAfter: '12',
    });
  });

  it('records JSON-RPC stage and header names without retaining header values', async () => {
    vi.stubGlobal('fetch', vi.fn().mockResolvedValue(new Response('', { status: 200 })));
    connectionMocks.connect = async ({ endpoint, fetch }) => {
      await fetch?.(endpoint, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          'MCP-Protocol-Version': '2025-11-25',
          Authorization: 'Bearer must-not-be-recorded',
        },
        body: JSON.stringify({
          jsonrpc: '2.0',
          method: 'notifications/initialized',
        }),
      });
    };

    const connection = await attemptParallelConnections(
      'https://example.com/mcp',
      undefined,
      undefined,
      undefined,
      false,
      'stateful',
      undefined,
      'streamable-http'
    );

    expect(connection.observedRequests[0]).toMatchObject({
      method: 'POST',
      mcpMethod: 'notifications/initialized',
      status: 200,
      outcome: 'succeeded',
      requestHeaders: ['authorization', 'content-type', 'mcp-protocol-version'],
    });
    expect(JSON.stringify(connection.observedRequests)).not.toContain('must-not-be-recorded');
  });
});

describe('authenticated proxy retry classification', () => {
  const endpoint = 'https://gateway.example/yahoo-finance/mcp';

  const handshakeFailure = (terminalError: unknown) => new TransportConnectionError(
    [terminalError],
    [{
      candidateUrl: endpoint,
      transportType: 'streamable-http',
      error: terminalError,
      observedRequests: [
        {
          method: 'POST',
          mcpMethod: 'initialize',
          url: endpoint,
          status: 200,
          outcome: 'succeeded',
        },
        {
          method: 'POST',
          mcpMethod: 'notifications/initialized',
          url: endpoint,
          requestHeaders: ['content-type', 'mcp-protocol-version', 'mcp-session-id'],
          outcome: 'failed',
        },
      ],
    }]
  );

  it('retries when initialize was readable but the required next request was not', () => {
    expect(shouldRetryMcpConnectionThroughProxy(
      handshakeFailure(new TypeError('Failed to fetch'))
    )).toBe(true);
  });

  it('retries a CORS failure when a sibling candidate timed out with an AbortError', () => {
    const error = new TransportConnectionError([
      handshakeFailure(new TypeError('Failed to fetch')),
      new DOMException('The operation was aborted.', 'AbortError'),
    ]);

    expect(shouldRetryMcpConnectionThroughProxy(error)).toBe(true);
  });

  it.each([
    Object.assign(new Error('Target returned HTTP 404'), { status: 404 }),
    new ProxiedAuthenticationError(401, 'target', new Error('OAuth required')),
    new Error('Connection aborted by user'),
  ])('does not retry a readable target error, target challenge, or abort', (error) => {
    expect(shouldRetryMcpConnectionThroughProxy(error)).toBe(false);
  });
});


describe('challenge endpoint binding', () => {
  it.each([false, true])('records the discovered candidate with proxy=%s', async (usesProxy) => {
    const root = 'https://mcp.sentry.dev/';
    const endpoint = `${root}mcp`;
    vi.stubGlobal('fetch', vi.fn(async (input) => {
      const url = new URL(String(input));
      const target = usesProxy ? url.searchParams.get('target') : url.toString();
      return new Response('', {
        status: target === endpoint ? 401 : 405,
        headers: { 'X-MCP-Proxy-Response-Source': 'target',
          'WWW-Authenticate': 'Bearer resource_metadata="https://unrelated.example/metadata"' },
      });
    }));
    connectionMocks.connect = async ({ endpoint, fetch }) => {
      await fetch?.(endpoint, { method: 'POST' });
      throw new Error('Connection failed');
    };
    const error = await attemptParallelConnections(
      usesProxy ? `https://proxy.example/?target=${encodeURIComponent(root)}` : root,
      undefined, undefined, undefined, usesProxy
    ).catch(error => error);
    expect(getObservedAuthenticationChallenge(error)).toMatchObject({
      source: 'target', targetUrl: endpoint,
      resourceMetadataUrl: 'https://unrelated.example/metadata',
    });
  });

  it('does not unwrap a direct publisher target query or trust metadata as the endpoint', async () => {
    const endpoint = 'https://publisher.example/mcp?target=https%3A%2F%2Funrelated.example%2F';
    vi.stubGlobal('fetch', vi.fn(async () => new Response('', {
      status: 401,
      headers: { 'WWW-Authenticate': 'Bearer resource_metadata="https://unrelated.example/metadata"' },
    })));
    connectionMocks.connect = async ({ endpoint, fetch }) => {
      await fetch?.(endpoint);
      throw new Error('Unauthorized');
    };
    const error = await attemptParallelConnections(endpoint).catch(error => error);
    expect(getObservedAuthenticationChallenge(error)?.targetUrl).toBe(endpoint);
  });

  it.each([false, true])('never probes sibling audiences with target credentials (proxy=%s)', async usesProxy => {
    const endpoint = 'https://publisher.example/mcp';
    const calls: string[] = [];
    connectionMocks.connect = async ({ endpoint }) => {
      calls.push(endpoint.toString());
      throw new Error('Failed');
    };
    await attemptParallelConnections(
      usesProxy ? `https://proxy.example/?target=${encodeURIComponent(endpoint)}` : endpoint,
      undefined, usesProxy ? undefined : 'target-token',
      usesProxy ? { Authorization: 'Bearer target-token' } : undefined, usesProxy
    ).catch(() => {});
    expect(calls).toHaveLength(1);
    expect(usesProxy ? new URL(calls[0]).searchParams.get('target') : calls[0]).toBe(endpoint);
  });
});
