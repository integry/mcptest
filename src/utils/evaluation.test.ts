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
  isAuthenticationRequired,
  isScoredEvaluation,
  resolveEvaluationOutcome,
} from './evaluation';
import {
  ProxiedAuthenticationError,
  TransportConnectionError,
  getRequestHeadersForCandidate,
} from './transportDetection';

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
      'sse',
      true
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
    expect(connectionMocks.attempt.mock.calls[1][4]).toBe(true);
    const outgoingTargetHeaders = getRequestHeadersForCandidate(proxyUrl, targetHeaders, true);
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
    expect(report.sections.security).toBeUndefined();
    expect(getEvaluationMaxScore(report)).toBe(70);
    expect(client.close).toHaveBeenCalledOnce();
  });

  it('closes the connected client when a later evaluation step throws', async () => {
    const client = createClient();
    connectionMocks.attempt.mockResolvedValueOnce({
      client,
      url: 'https://mcp.example/custom/endpoint',
      transportType: 'streamable-http',
      protocolEra: 'modern',
      protocolVersion: '2026-07-28',
      takeAuthenticationChallenge: vi.fn(() => {
        throw new Error('Observer failed');
      }),
    });

    await expect(evaluateServer(
      'https://mcp.example/custom/endpoint',
      'firebase-jwt',
      vi.fn()
    )).rejects.toThrow('Observer failed');
    expect(client.close).toHaveBeenCalledOnce();
  });

  it.each([
    ['URL-valued', 'https://tenant.example/account'],
    ['ordinary', 'production'],
  ])('preserves a direct custom endpoint with a %s target parameter', async (_, target) => {
    const client = createClient();
    const endpoint = new URL('https://mcp.example/custom/endpoint');
    endpoint.searchParams.set('target', target);
    endpoint.searchParams.set('tenant', 'acme');
    connectionMocks.attempt.mockResolvedValueOnce({
      client,
      url: endpoint.toString(),
      transportType: 'streamable-http',
      protocolEra: 'modern',
    });

    const report = await evaluateServer(endpoint.toString(), 'firebase-jwt', vi.fn());

    expect(connectionMocks.attempt.mock.calls[0][0]).toBe(endpoint.toString());
    expect(connectionMocks.attempt.mock.calls[0][4]).toBe(false);
    expect(report.sections.protocol.details[0].metadata).toMatchObject({
      endpoint: endpoint.toString(),
      route: 'direct',
    });
    expect(getEvaluationTargetUrl(endpoint.toString(), false)).toBe(endpoint.toString());
  });

  it('unwraps target only for an explicitly confirmed configured-proxy URL', () => {
    const configuredProxy = (
      'https://proxy.mcptest.test/?target=https%3A%2F%2Fmcp.example%2Fcustom%3Ftenant%3Dacme'
    );
    const otherProxy = (
      'https://other-proxy.example/?target=https%3A%2F%2Fmcp.example%2Fcustom'
    );

    expect(getEvaluationTargetUrl(configuredProxy, true)).toBe(
      'https://mcp.example/custom?tenant=acme'
    );
    expect(getEvaluationTargetUrl(configuredProxy, false)).toBe(configuredProxy);
    expect(getEvaluationTargetUrl(otherProxy, true)).toBe(otherProxy);
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

  it('preserves a direct target authentication response when the proxy also fails', async () => {
    const targetAuthError = Object.assign(new Error('Direct target returned HTTP 401'), {
      status: 401,
    });
    connectionMocks.attempt
      .mockRejectedValueOnce(new TransportConnectionError([targetAuthError]))
      .mockRejectedValueOnce(new Error('Proxy network failure'));

    const report = await evaluateServer('https://mcp.example/mcp', 'firebase-jwt', vi.fn());

    expect(report.outcome).toBe('authorization-required');
    expect(isAuthenticationRequired(report)).toBe(true);
    expect(report.sections.auth).toBeDefined();
    expect(report.sections.auth.details[0].context).toBe(
      'The MCP endpoint returned HTTP 401 during unauthenticated negotiation.'
    );
    expect(report.sections.auth.details[0].metadata).toEqual({
      route: 'direct',
      status: 401,
      endpoint: 'https://mcp.example/mcp',
    });
    expect(Object.keys(report.sections)).toEqual(['auth']);
    expect(getEvaluationMaxScore(report)).toBe(0);
    expect(JSON.stringify(report)).not.toContain('/mcp/v1/');
  });

  it('uses the challenged fallback endpoint for authentication', async () => {
    const targetAuthError = Object.assign(new Error('Fallback returned HTTP 401'), {
      status: 401,
    });
    connectionMocks.attempt
      .mockRejectedValueOnce(new TransportConnectionError(
        [targetAuthError],
        [{ candidateUrl: 'https://mcp.example/mcp', error: targetAuthError }]
      ))
      .mockRejectedValueOnce(new Error('Proxy network failure'));

    const report = await evaluateServer('https://mcp.example', 'firebase-jwt', vi.fn());

    expect(report.serverUrl).toBe('https://mcp.example/');
    expect(report.authenticationUrl).toBe('https://mcp.example/mcp');
    expect(report.sections.auth.details[0].metadata).toEqual({
      route: 'direct',
      status: 401,
      endpoint: 'https://mcp.example/mcp',
    });
  });

  it('does not mistake a proxy-hop authentication failure for target OAuth', async () => {
    const proxyAuthError = new ProxiedAuthenticationError(
      401,
      'proxy',
      new Error('Firebase token was rejected')
    );
    connectionMocks.attempt
      .mockRejectedValueOnce(new Error('Direct CORS failure'))
      .mockRejectedValueOnce(new TransportConnectionError([proxyAuthError]));

    const report = await evaluateServer('https://mcp.example/mcp', 'firebase-jwt', vi.fn());

    expect(report.sections.auth).toBeUndefined();
    expect(report.outcome).toBe('failed');
    expect(isScoredEvaluation(report)).toBe(false);
    expect(report.sections.protocol.status).toBe('failed');
    expect(report.sections.protocol.details[0].metadata).toEqual({
      route: 'authenticated proxy',
      routeFailures: [
        { route: 'direct', message: 'Direct CORS failure' },
        {
          route: 'authenticated proxy',
          message: 'All connections failed: Authenticated proxy returned HTTP 401',
          status: 401,
          authenticationSource: 'proxy',
        },
      ],
    });
    expect(report.sections.protocol.details[0].text).toContain('Authenticated proxy:');
  });

  it('offers target OAuth for a verified upstream challenge observed through the proxy', async () => {
    const targetAuthError = new ProxiedAuthenticationError(
      403,
      'target',
      Object.assign(new Error('Upstream MCP target returned forbidden'), { status: 403 })
    );
    connectionMocks.attempt
      .mockRejectedValueOnce(new Error('Direct CORS failure'))
      .mockRejectedValueOnce(new TransportConnectionError([targetAuthError]));

    const report = await evaluateServer('https://mcp.example/mcp', 'firebase-jwt', vi.fn());

    expect(report.outcome).toBe('authorization-required');
    expect(report.sections.auth).toBeDefined();
    expect(report.sections.auth.details[0].context).toBe(
      'The MCP endpoint returned HTTP 403 during unauthenticated negotiation.'
    );
    expect(report.sections.auth.details[0].metadata).toEqual({
      route: 'proxy',
      status: 403,
      endpoint: 'https://mcp.example/mcp',
    });
  });

  it('offers target authentication when a post-connect capability request returns 401', async () => {
    const client = createClient();
    let observedChallenge: { status: 401 | 403; source: 'proxy' | 'target' } | undefined;
    client.listTools.mockImplementationOnce(async () => {
      observedChallenge = { status: 401, source: 'target' };
      throw new Error('tools/list returned HTTP 401');
    });
    const takeAuthenticationChallenge = vi.fn(() => {
      const challenge = observedChallenge;
      observedChallenge = undefined;
      return challenge;
    });
    connectionMocks.attempt.mockResolvedValueOnce({
      client,
      url: 'https://mcp.example/mcp',
      transportType: 'streamable-http',
      protocolEra: 'modern',
      takeAuthenticationChallenge,
    });

    const report = await evaluateServer('https://mcp.example/mcp', 'firebase-jwt', vi.fn());

    expect(report.outcome).toBe('authorization-required');
    expect(report.sections.auth).toBeDefined();
    expect(report.sections.auth.details[0]).toMatchObject({
      context: 'The MCP endpoint returned HTTP 401 for tools/list.',
      metadata: {
        method: 'tools/list',
        route: 'direct',
        status: 401,
        authenticationSource: 'target',
      },
    });
    expect(Object.keys(report.sections)).toEqual(['auth']);
    expect(client.listResources).toHaveBeenCalledOnce();
    expect(client.listPrompts).toHaveBeenCalledOnce();
  });

  it('does not treat a JSON-RPC error code as an HTTP authentication status', async () => {
    const client = createClient();
    client.listTools.mockRejectedValueOnce(Object.assign(
      new Error('tools/list returned a JSON-RPC application error'),
      { code: 401 }
    ));
    connectionMocks.attempt.mockResolvedValueOnce({
      client,
      url: 'https://mcp.example/mcp',
      transportType: 'streamable-http',
      protocolEra: 'modern',
    });

    const report = await evaluateServer('https://mcp.example/mcp', 'firebase-jwt', vi.fn());

    expect(report.sections.auth).toBeUndefined();
    expect(report.sections.capabilities.details[0].metadata).toEqual({
      method: 'tools/list',
      error: 'tools/list returned a JSON-RPC application error',
    });
    expect(report.sections.capabilities.score).toBe(6);
  });

  it('does not treat application-defined JSON-RPC data as an HTTP challenge', async () => {
    const client = createClient();
    client.listTools.mockRejectedValueOnce(Object.assign(
      new Error('tools/list returned a JSON-RPC application error'),
      { data: { status: 401 } }
    ));
    connectionMocks.attempt.mockResolvedValueOnce({
      client,
      url: 'https://mcp.example/mcp',
      transportType: 'streamable-http',
      protocolEra: 'modern',
    });

    const report = await evaluateServer('https://mcp.example/mcp', 'firebase-jwt', vi.fn());

    expect(report.sections.auth).toBeUndefined();
    expect(report.sections.capabilities.details[0].metadata).toEqual({
      method: 'tools/list',
      error: 'tools/list returned a JSON-RPC application error',
    });
    expect(report.sections.capabilities.score).toBe(6);
  });

  it('does not offer target OAuth for a post-connect proxy-hop challenge', async () => {
    const client = createClient();
    let observedChallenge: { status: 401 | 403; source: 'proxy' | 'target' } | undefined;
    client.listTools.mockImplementationOnce(async () => {
      observedChallenge = { status: 403, source: 'proxy' };
      throw Object.assign(new Error('Proxy rejected the Firebase token'), { status: 403 });
    });
    const takeAuthenticationChallenge = vi.fn(() => {
      const challenge = observedChallenge;
      observedChallenge = undefined;
      return challenge;
    });
    connectionMocks.attempt
      .mockRejectedValueOnce(new Error('Direct CORS failure'))
      .mockResolvedValueOnce({
        client,
        url: 'https://proxy.mcptest.test/?target=https%3A%2F%2Fmcp.example%2Fmcp',
        transportType: 'streamable-http',
        protocolEra: 'modern',
        takeAuthenticationChallenge,
      });

    const report = await evaluateServer('https://mcp.example/mcp', 'firebase-jwt', vi.fn());

    expect(report.sections.auth).toBeUndefined();
    expect(report.sections.capabilities.details[0].metadata).toMatchObject({
      method: 'tools/list',
      status: 403,
      authenticationSource: 'proxy',
      route: 'proxy',
    });
  });

  it('offers target OAuth for a post-connect upstream challenge through the proxy', async () => {
    const client = createClient();
    let observedChallenge: { status: 401 | 403; source: 'proxy' | 'target' } | undefined;
    client.listResources.mockImplementationOnce(async () => {
      observedChallenge = { status: 403, source: 'target' };
      throw Object.assign(new Error('Upstream target rejected resources/list'), { status: 403 });
    });
    const takeAuthenticationChallenge = () => {
      const challenge = observedChallenge;
      observedChallenge = undefined;
      return challenge;
    };
    connectionMocks.attempt
      .mockRejectedValueOnce(new Error('Direct CORS failure'))
      .mockResolvedValueOnce({
        client,
        url: 'https://proxy.mcptest.test/?target=https%3A%2F%2Fmcp.example%2Fmcp',
        transportType: 'streamable-http',
        protocolEra: 'modern',
        takeAuthenticationChallenge,
      });

    const report = await evaluateServer('https://mcp.example/mcp', 'firebase-jwt', vi.fn());

    expect(report.outcome).toBe('authorization-required');
    expect(report.sections.auth.details[0].metadata).toMatchObject({
      method: 'resources/list',
      route: 'proxy',
      status: 403,
      authenticationSource: 'target',
    });
    expect(Object.keys(report.sections)).toEqual(['auth']);
  });

  it('includes OAuth security posture when protected-resource metadata is supported', async () => {
    const client = createClient();
    connectionMocks.attempt.mockResolvedValueOnce({
      client,
      url: 'https://mcp.example/mcp',
      transportType: 'streamable-http',
      protocolEra: 'modern',
      protocolVersion: '2026-07-28',
    });
    vi.stubGlobal('fetch', vi.fn(async (input: RequestInfo | URL) => {
      const url = new URL(input instanceof Request ? input.url : input.toString());
      if (url.pathname.includes('/.well-known/oauth-protected-resource')) {
        return Response.json({
          resource: 'https://mcp.example/mcp',
          authorization_servers: ['https://auth.example'],
        });
      }
      if (url.hostname === 'auth.example') {
        return Response.json({
          issuer: 'https://auth.example',
          authorization_endpoint: 'https://auth.example/authorize',
          token_endpoint: 'https://auth.example/token',
          response_types_supported: ['code'],
          code_challenge_methods_supported: ['S256'],
        });
      }
      return new Response('Not found', { status: 404 });
    }));

    const report = await evaluateServer('https://mcp.example/mcp', 'firebase-jwt', vi.fn());

    expect(report.sections.security).toMatchObject({
      name: 'Security Posture',
      score: 40,
      maxScore: 40,
    });
    expect(report.sections.security.details.map(({ text }) => text)).toEqual(
      expect.arrayContaining([
        '✓ OAuth protected-resource metadata available',
        '✓ OAuth authorization-server metadata available',
        '✓ Token endpoint properly configured',
        '✓ PKCE support enabled',
      ])
    );
    expect(getEvaluationMaxScore(report)).toBe(110);
    expect(report.finalScore).toBe(110);
  });

  it('retains the OAuth assessment for legacy authorization-server metadata', async () => {
    const client = createClient();
    connectionMocks.attempt.mockResolvedValueOnce({
      client,
      url: 'https://mcp.example/mcp',
      transportType: 'streamable-http',
      protocolEra: 'legacy',
      protocolVersion: '2025-11-25',
    });
    vi.stubGlobal('fetch', vi.fn(async (input: RequestInfo | URL) => {
      const url = new URL(input instanceof Request ? input.url : input.toString());
      if (url.pathname === '/.well-known/oauth-authorization-server') {
        return Response.json({
          issuer: 'https://mcp.example',
          authorization_endpoint: 'https://mcp.example/authorize',
          token_endpoint: 'https://mcp.example/token',
          response_types_supported: ['code'],
          code_challenge_methods_supported: ['S256'],
        });
      }
      return new Response('Not found', { status: 404 });
    }));

    const report = await evaluateServer('https://mcp.example/mcp', 'firebase-jwt', vi.fn());

    expect(report.sections.security).toMatchObject({ score: 40, maxScore: 40 });
    expect(report.sections.security.details[0].text).toBe(
      '⚠ OAuth protected-resource metadata not available'
    );
    expect(getEvaluationMaxScore(report)).toBe(110);
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

  it('resolves legacy outcomes from whether their sections were actually evaluated', () => {
    const evaluatedReport = {
      serverUrl: 'https://legacy.example/mcp',
      finalScore: 15,
      sections: {
        protocol: {
          name: 'Protocol',
          description: '',
          score: 15,
          maxScore: 15,
          details: [{ text: '✓ MCP negotiation completed.' }],
        },
      },
    };
    const partialReport = {
      ...evaluatedReport,
      sections: {
        ...evaluatedReport.sections,
        capabilities: {
          name: 'Capabilities',
          description: '',
          score: 0,
          maxScore: 10,
          details: [{ text: '⚠ Capability checks were skipped after the connection closed.' }],
        },
      },
    };
    const failedReport = {
      ...evaluatedReport,
      finalScore: 0,
      sections: {
        protocol: {
          ...evaluatedReport.sections.protocol,
          score: 0,
          details: [{ text: '⚠ MCP negotiation failed: no MCP connection.' }],
        },
      },
    };
    const mixedPartialReport = {
      ...evaluatedReport,
      finalScore: 8,
      sections: {
        capabilities: {
          name: 'Capabilities',
          description: '',
          score: 8,
          maxScore: 10,
          details: [
            { text: '✓ Tool discovery completed.' },
            { text: '⚠ Resource checks were skipped after the connection closed.' },
          ],
        },
      },
    };
    const explicitlyScoredReport = {
      ...evaluatedReport,
      outcome: 'scored' as const,
      sections: {
        protocol: {
          ...evaluatedReport.sections.protocol,
          details: [{ text: '⚠ Unsupported optional probe was skipped; scored checks completed.' }],
        },
      },
    };

    expect(resolveEvaluationOutcome(evaluatedReport)).toBe('scored');
    expect(isScoredEvaluation(evaluatedReport)).toBe(true);
    expect(resolveEvaluationOutcome(partialReport)).toBe('partial');
    expect(isScoredEvaluation(partialReport)).toBe(false);
    expect(resolveEvaluationOutcome(failedReport)).toBe('failed');
    expect(isScoredEvaluation(failedReport)).toBe(false);
    expect(resolveEvaluationOutcome(mixedPartialReport)).toBe('partial');
    expect(isScoredEvaluation(mixedPartialReport)).toBe(false);
    expect(resolveEvaluationOutcome(explicitlyScoredReport)).toBe('scored');
    expect(isScoredEvaluation(explicitlyScoredReport)).toBe(true);
  });
});
