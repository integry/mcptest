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
  HostedGrantRejectedError,
  isAuthenticationRequired,
  isScoredEvaluation,
  resolveEvaluationOutcome,
} from './evaluation';
import {
  ProxiedAuthenticationError,
  TransportConnectionError,
  getRequestHeadersForCandidate,
} from './transportDetection';
import {
  getStoredOAuthTrace,
  recordOAuthAuthenticationChallenge,
} from './oauthTrace';

const createClient = () => ({
  listTools: vi.fn().mockResolvedValue({ tools: [] }),
  listResources: vi.fn().mockResolvedValue({ resources: [] }),
  listPrompts: vi.fn().mockResolvedValue({ prompts: [] }),
  close: vi.fn().mockResolvedValue(undefined),
});

describe('dual-era server evaluation', () => {
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

  it('keeps a hosted grant on its isolated proxy header', () => {
    const headers = getEvaluationProxyHeaders(undefined, 'firebase-jwt', null, 'opaque-grant');
    expect(headers.get('authorization')).toBe('Bearer firebase-jwt');
    expect(headers.get('x-mcp-hosted-grant')).toBe('opaque-grant');
    expect(headers.get('x-mcp-authorization')).toBeNull();
  });

  it.each([
    ['an expired grant', 401],
    ['a grant bound to another Firebase user', 403],
  ] as const)('identifies %s from the proxy challenge', async (_, status) => {
    connectionMocks.attempt.mockRejectedValueOnce(new TransportConnectionError([
      new ProxiedAuthenticationError(
        status,
        'proxy',
        new Error('Hosted grant rejected'),
        undefined,
        { 'www-authenticate': 'HostedGrant error="invalid_token"' }
      ),
    ]));

    await expect(evaluateServer(
      'https://mcp.slack.com/mcp',
      'firebase-jwt',
      vi.fn(),
      null,
      undefined,
      undefined,
      'opaque-grant'
    )).rejects.toBeInstanceOf(HostedGrantRejectedError);

    expect(connectionMocks.attempt).toHaveBeenCalledOnce();
    expect(new Headers(connectionMocks.attempt.mock.calls[0][3]).get(
      'X-MCP-Hosted-Grant'
    )).toBe('opaque-grant');
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
      authorizationSchemes: ['oauth'],
      authorizationCredentialProvenance: ['cached-oauth'],
    });
    expect(JSON.stringify(report.sections.protocol.details[0].metadata)).not.toContain('oauth-access-token');
    expect(report.sections.transport.details[0].text).toContain('Streamable HTTP');
    expect(report.sections.cors.score).toBe(0);
    expect(report.sections.cors.details[0].text).toContain('proxy was required');
    expect(report.sections.security).toBeUndefined();
    expect(getEvaluationMaxScore(report)).toBe(70);
    expect(client.close).toHaveBeenCalledOnce();
  });

  it('uses the same evaluator headlessly without inventing a browser CORS result', async () => {
    const client = createClient();
    connectionMocks.attempt.mockResolvedValueOnce({
      client,
      url: 'https://headless.example/mcp',
      transportType: 'streamable-http',
      protocolEra: 'modern',
      protocolVersion: '2026-07-28',
    });

    const report = await evaluateServer(
      'https://headless.example/mcp',
      '',
      vi.fn(),
      null,
      undefined,
      undefined,
      { runtime: 'headless' }
    );

    expect(report.outcome).toBe('scored');
    expect(report.sections.cors).toBeUndefined();
    expect(getEvaluationMaxScore(report)).toBe(55);
    expect(report.sections.protocol.details[0].metadata).toMatchObject({
      evaluationRuntime: 'headless',
      route: 'direct',
    });
  });

  it.each([
    ['Authorization', 'Bearer report-bearer-token', 'bearer'],
    ['x-api-key', 'report-api-key', 'api-key'],
  ] as const)('passes the entered %s credential only as a target header', async (header, value, scheme) => {
    const client = createClient();
    connectionMocks.attempt.mockResolvedValueOnce({
      client,
      url: 'https://static-auth.example/mcp',
      transportType: 'streamable-http',
      protocolEra: 'modern',
    });

    const report = await evaluateServer(
      'https://static-auth.example/mcp',
      'firebase-jwt',
      vi.fn(),
      undefined,
      { [header]: value }
    );

    const directHeaders = new Headers(connectionMocks.attempt.mock.calls[0][3]);
    expect(directHeaders.get(header)).toBe(value);
    expect(connectionMocks.attempt.mock.calls[0][2]).toBeUndefined();
    expect(report.outcome).toBe('scored');
    expect(report.sections.protocol.details[0].metadata).toMatchObject({
      authorizationSchemes: [scheme],
      authorizationCredentialProvenance: ['target-header'],
    });
    expect(JSON.stringify(report.sections.protocol.details[0].metadata)).not.toContain(value);
    expect(report.sections.cors.details[1].metadata).toMatchObject({
      requiredHeaders: expect.arrayContaining([header.toLowerCase()]),
    });
  });

  it('keeps an API key on the target channel during proxy fallback', async () => {
    const client = createClient();
    connectionMocks.attempt
      .mockRejectedValueOnce(new Error('Direct CORS failure'))
      .mockResolvedValueOnce({
        client,
        url: 'https://proxy.mcptest.test/?target=https%3A%2F%2Fstatic-auth.example%2Fmcp',
        transportType: 'streamable-http',
        protocolEra: 'modern',
      });

    await evaluateServer(
      'https://static-auth.example/mcp',
      'firebase-jwt',
      vi.fn(),
      undefined,
      { 'x-api-key': 'report-api-key' }
    );

    const [proxyUrl, , proxyAuthToken, targetHeaders] = connectionMocks.attempt.mock.calls[1];
    const outgoingTargetHeaders = getRequestHeadersForCandidate(proxyUrl, targetHeaders, true);
    expect(proxyAuthToken).toBe('firebase-jwt');
    expect(outgoingTargetHeaders.get('x-api-key')).toBe('report-api-key');
    expect(outgoingTargetHeaders.get('authorization')).toBeNull();
  });

  it.each([
    ['Authorization', 'Bearer entered-bearer', 'x-mcp-authorization', 'Bearer entered-bearer'],
    ['x-api-key', 'entered-api-key', 'x-api-key', 'entered-api-key'],
  ] as const)(
    'does not combine cached OAuth with an explicitly entered %s credential',
    async (header, value, expectedHeader, expectedValue) => {
      const client = createClient();
      connectionMocks.attempt
        .mockRejectedValueOnce(new Error('Direct CORS failure'))
        .mockResolvedValueOnce({
          client,
          url: 'https://proxy.mcptest.test/?target=https%3A%2F%2Fstatic-auth.example%2Fmcp',
          transportType: 'streamable-http',
          protocolEra: 'modern',
        });

      const report = await evaluateServer(
        'https://static-auth.example/mcp',
        'firebase-jwt',
        vi.fn(),
        'stale-cached-oauth',
        { [header]: value }
      );

      expect(connectionMocks.attempt.mock.calls[0][2]).toBeUndefined();
      expect(new Headers(connectionMocks.attempt.mock.calls[0][3]).get(header)).toBe(value);
      const [proxyUrl, , proxyAuthToken, targetHeaders] = connectionMocks.attempt.mock.calls[1];
      const outgoingTargetHeaders = getRequestHeadersForCandidate(proxyUrl, targetHeaders, true);
      expect(proxyAuthToken).toBe('firebase-jwt');
      expect(outgoingTargetHeaders.get(expectedHeader)).toBe(expectedValue);
      expect(outgoingTargetHeaders.get('authorization')).toBeNull();
      if (header === 'x-api-key') {
        expect(outgoingTargetHeaders.get('x-mcp-authorization')).toBeNull();
      }
      expect(report.sections.protocol.details[0].metadata).toMatchObject({
        authorizationCredentialProvenance: ['target-header'],
      });
      expect(JSON.stringify(report)).not.toContain('stale-cached-oauth');
    }
  );

  it('finalizes a successful post-callback report retry with its actual request facts', async () => {
    const endpoint = 'https://report-retry.example/mcp';
    const trace = recordOAuthAuthenticationChallenge({
      targetUrl: endpoint,
      status: 401,
      source: 'target',
      route: 'direct',
      storage: sessionStorage,
    });
    trace.setAuthenticatedMcpRetryState('pending');
    const client = createClient();
    const retryRequest = {
      method: 'POST',
      url: `${endpoint}?operation=initialize`,
      candidateUrl: endpoint,
      transportType: 'streamable-http' as const,
      status: 200,
      outcome: 'succeeded' as const,
      startedAt: '2026-08-11T18:10:00.000Z',
      durationMs: 27,
    };
    connectionMocks.attempt.mockImplementationOnce(async (...args: any[]) => {
      args[6]?.(retryRequest);
      return {
        client,
        url: endpoint,
        transportType: 'streamable-http',
        protocolEra: 'modern',
        protocolVersion: '2026-07-28',
        observedRequests: [retryRequest],
      };
    });

    await evaluateServer(endpoint, 'firebase-jwt', vi.fn(), 'oauth-access-token');

    const stored = getStoredOAuthTrace(endpoint, sessionStorage);
    expect(stored?.events.find(({ type }) => type === 'mcp_retry')).toMatchObject({
      outcome: 'succeeded',
      route: 'direct',
      request: { method: 'POST', url: retryRequest.url },
      response: { status: 200 },
      timing: { startedAt: retryRequest.startedAt, durationMs: 27 },
    });
    expect(stored?.outcome?.status).toBe('authorized');
    expect(stored?.authenticatedMcpRetry).toBeUndefined();
  });

  it('does not cite a failed capability request as evidence for a successful report retry', async () => {
    const endpoint = 'https://partial-report-retry.example/mcp';
    const trace = recordOAuthAuthenticationChallenge({
      targetUrl: endpoint,
      status: 401,
      source: 'target',
      route: 'direct',
      storage: sessionStorage,
    });
    trace.setAuthenticatedMcpRetryState('pending');
    const observedRequests: Array<{
      method: string;
      url: string;
      status: number;
      outcome: 'failed';
    }> = [];
    const client = createClient();
    client.listPrompts.mockImplementationOnce(async () => {
      observedRequests.push({
        method: 'POST',
        url: `${endpoint}?operation=prompts-list`,
        status: 500,
        outcome: 'failed',
      });
      throw new Error('prompts/list returned HTTP 500');
    });
    connectionMocks.attempt.mockResolvedValueOnce({
      client,
      url: endpoint,
      transportType: 'streamable-http',
      protocolEra: 'modern',
      observedRequests,
    });

    const report = await evaluateServer(endpoint, 'firebase-jwt', vi.fn(), 'oauth-access-token');

    expect(report.outcome).toBe('partial');
    expect(report.sections.capabilities.status).toBe('partial');
    expect(report.toolSurfaceAnalysis?.findings.medium).toEqual(expect.arrayContaining([
      expect.objectContaining({
        id: 'analysis.incomplete-pagination',
        summary: expect.stringContaining('prompts/list'),
      }),
    ]));
    const stored = getStoredOAuthTrace(endpoint, sessionStorage);
    const retryEvent = stored?.events.find(({ type }) => type === 'mcp_retry');
    expect(retryEvent).toMatchObject({
      outcome: 'succeeded',
      route: 'direct',
      response: {
        metadata: {
          transportType: 'streamable-http',
          protocolEra: 'modern',
        },
      },
    });
    expect(retryEvent?.request).toBeUndefined();
    expect(retryEvent?.response?.status).toBeUndefined();
    expect(retryEvent?.explanation).not.toContain('HTTP 500');
  });

  it('finalizes a failed post-callback report retry and does not leave it for another connection', async () => {
    const endpoint = 'https://failed-report-retry.example/mcp';
    const trace = recordOAuthAuthenticationChallenge({
      targetUrl: endpoint,
      status: 401,
      source: 'target',
      route: 'direct',
      storage: sessionStorage,
    });
    trace.setAuthenticatedMcpRetryState('pending');
    const directRequest = {
      method: 'POST',
      url: endpoint,
      status: 502,
      outcome: 'failed' as const,
      startedAt: '2026-08-11T18:20:00.000Z',
      durationMs: 31,
    };
    const proxyRequest = {
      ...directRequest,
      url: `https://proxy.mcptest.test/?target=${encodeURIComponent(endpoint)}`,
      startedAt: '2026-08-11T18:20:01.000Z',
      durationMs: 44,
    };
    connectionMocks.attempt
      .mockImplementationOnce(async (...args: any[]) => {
        args[6]?.(directRequest);
        throw new Error('Direct authenticated retry failed');
      })
      .mockImplementationOnce(async (...args: any[]) => {
        args[6]?.(proxyRequest);
        throw new Error('Proxy authenticated retry failed');
      });

    await evaluateServer(endpoint, 'firebase-jwt', vi.fn(), 'oauth-access-token');

    const stored = getStoredOAuthTrace(endpoint, sessionStorage);
    expect(stored?.events.find(({ type }) => type === 'mcp_retry')).toMatchObject({
      outcome: 'failed',
      route: 'proxy',
      request: { method: 'POST', url: proxyRequest.url },
      response: { status: 502 },
      timing: { startedAt: proxyRequest.startedAt, durationMs: 44 },
    });
    expect(stored?.outcome).toMatchObject({
      status: 'failed',
      explanation: expect.stringContaining('authenticated MCP retry'),
    });
    expect(stored?.authenticatedMcpRetry).toBeUndefined();
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
    expect(getEvaluationCorsHeaders('modern', false, ['X-API-Key'])).toContain('x-api-key');
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

  it('records the observed outer proxy request facts for a target challenge', async () => {
    const targetUrl = 'https://mcp.example/custom/endpoint';
    const proxyRequestUrl = `https://proxy.mcptest.test/?target=${encodeURIComponent(targetUrl)}`;
    const challenge = new ProxiedAuthenticationError(
      401,
      'target',
      new Error('Target authorization required'),
      {
        method: 'POST',
        url: proxyRequestUrl,
        startedAt: '2026-08-11T16:30:00.000Z',
        durationMs: 23,
      }
    );
    connectionMocks.attempt
      .mockRejectedValueOnce(new Error('Direct CORS failure'))
      .mockRejectedValueOnce(new TransportConnectionError(
        [challenge],
        [{ candidateUrl: proxyRequestUrl, error: challenge }]
      ));

    const report = await evaluateServer(targetUrl, 'firebase-jwt', vi.fn());

    expect(report.outcome).toBe('authorization-required');
    expect(getStoredOAuthTrace(targetUrl, sessionStorage)?.events[0]).toMatchObject({
      type: 'target_challenge',
      route: 'proxy',
      provenance: 'direct_target',
      request: { method: 'POST', url: proxyRequestUrl },
      response: { status: 401 },
      timing: {
        startedAt: '2026-08-11T16:30:00.000Z',
        durationMs: 23,
      },
    });
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

  it('carries challenge discovery directives ephemerally on an authorization report', async () => {
    const endpoint = 'https://challenge.example/mcp';
    const metadataUrl = 'https://challenge.example/.well-known/oauth-protected-resource?token=challenge-secret';
    const challenge = new ProxiedAuthenticationError(
      401,
      'target',
      new Error('Target authorization required'),
      { method: 'POST', url: endpoint },
      { 'www-authenticate': 'Bearer resource_metadata="[sanitized]"' },
      metadataUrl,
      'channels:read chat:write'
    );
    connectionMocks.attempt
      .mockRejectedValueOnce(new TransportConnectionError([challenge]))
      .mockRejectedValueOnce(new Error('Proxy network failure'));

    const report = await evaluateServer(endpoint, 'firebase-jwt', vi.fn());

    expect(report.resourceMetadataUrl).toBe(metadataUrl);
    expect(report.scope).toBe('channels:read chat:write');
    expect(JSON.stringify(report)).not.toContain('challenge-secret');
  });

  it('does not mistake a proxy-hop authentication failure for target OAuth', async () => {
    const endpoint = 'https://mcp.example/mcp';
    const proxyRequest = {
      method: 'POST',
      url: `https://proxy.mcptest.test/?target=${encodeURIComponent(endpoint)}`,
      status: 401,
      outcome: 'failed' as const,
      startedAt: '2026-08-11T18:40:00.000Z',
      durationMs: 23,
    };
    const proxyAuthError = new ProxiedAuthenticationError(
      401,
      'proxy',
      new Error('Firebase token was rejected'),
      proxyRequest
    );
    connectionMocks.attempt
      .mockRejectedValueOnce(new Error('Direct CORS failure'))
      .mockRejectedValueOnce(new TransportConnectionError([proxyAuthError]));

    const report = await evaluateServer(endpoint, 'firebase-jwt', vi.fn());

    expect(report.sections.auth).toMatchObject({
      name: 'Proxy Authentication Required',
      maxScore: 0,
    });
    expect(report.authenticationRequirement).toMatchObject({ kind: 'proxy', status: 401 });
    expect(report.outcome).toBe('authorization-required');
    expect(isScoredEvaluation(report)).toBe(false);
    expect(report.sections.protocol).toBeUndefined();
    const stored = getStoredOAuthTrace(endpoint, sessionStorage);
    expect(stored?.events.find(({ type }) => type === 'target_challenge')).toMatchObject({
      outcome: 'challenged',
      provenance: 'authenticated_proxy',
      route: 'proxy',
      request: { method: 'POST', url: proxyRequest.url },
      response: { status: 401 },
      timing: { startedAt: proxyRequest.startedAt, durationMs: 23 },
    });
    expect(stored?.outcome).toMatchObject({
      status: 'proxy_authentication_required',
      explanation: expect.stringContaining('target OAuth discovery was not started'),
    });
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

  it('aggregates every discovery page before tool-surface analysis', async () => {
    const client = createClient();
    client.listTools
      .mockResolvedValueOnce({
        tools: [{ name: 'first_tool', inputSchema: { type: 'object' } }],
        nextCursor: 'tools-2',
      })
      .mockResolvedValueOnce({
        tools: [{ name: 'second_tool', inputSchema: { type: 'object' } }],
      });
    client.listResources
      .mockResolvedValueOnce({ resources: [{ uri: 'test://one', name: 'one' }], nextCursor: 'resources-2' })
      .mockResolvedValueOnce({ resources: [{ uri: 'test://two', name: 'two' }] });
    client.listPrompts
      .mockResolvedValueOnce({ prompts: [{ name: 'one' }], nextCursor: 'prompts-2' })
      .mockResolvedValueOnce({ prompts: [{ name: 'two' }] });
    connectionMocks.attempt.mockResolvedValueOnce({
      client,
      url: 'https://mcp.example/mcp',
      transportType: 'streamable-http',
      protocolEra: 'modern',
    });

    const report = await evaluateServer('https://mcp.example/mcp', 'firebase-jwt', vi.fn());

    expect(report.outcome).toBe('scored');
    expect(report.toolSurfaceAnalysis?.metrics).toMatchObject({
      toolCount: 2,
      resourceCount: 2,
      promptCount: 2,
    });
    expect(client.listTools).toHaveBeenNthCalledWith(2, { cursor: 'tools-2' });
    expect(client.listResources).toHaveBeenNthCalledWith(2, { cursor: 'resources-2' });
    expect(client.listPrompts).toHaveBeenNthCalledWith(2, { cursor: 'prompts-2' });
  });

  it.each([
    ['tools', 'tools/list'],
    ['resources', 'resources/list'],
    ['prompts', 'prompts/list'],
  ] as const)('marks a malformed first %s discovery page partial', async (capability, method) => {
    const client = createClient();
    const listMethod = capability === 'tools'
      ? client.listTools
      : capability === 'resources'
        ? client.listResources
        : client.listPrompts;
    listMethod.mockResolvedValueOnce({});
    connectionMocks.attempt.mockResolvedValueOnce({
      client,
      url: 'https://mcp.example/mcp',
      transportType: 'streamable-http',
      protocolEra: 'modern',
    });

    const report = await evaluateServer('https://mcp.example/mcp', 'firebase-jwt', vi.fn());

    expect(report.outcome).toBe('partial');
    expect(report.sections.capabilities.status).toBe('partial');
    expect(report.sections.capabilities.details).toContainEqual(expect.objectContaining({
      text: expect.not.stringContaining('succeeded'),
      metadata: expect.objectContaining({ method, paginationComplete: false }),
    }));
    expect(report.toolSurfaceAnalysis?.findings.medium).toEqual(expect.arrayContaining([
      expect.objectContaining({
        id: 'analysis.incomplete-pagination',
        summary: expect.stringContaining(method),
      }),
    ]));
  });

  it.each([
    ['resources', 'resources/list'],
    ['prompts', 'prompts/list'],
  ] as const)('marks an operational %s discovery failure incomplete', async (capability, method) => {
    const client = createClient();
    const listMethod = capability === 'resources' ? client.listResources : client.listPrompts;
    listMethod.mockRejectedValueOnce(new Error(`${method} temporarily unavailable`));
    connectionMocks.attempt.mockResolvedValueOnce({
      client,
      url: 'https://mcp.example/mcp',
      transportType: 'streamable-http',
      protocolEra: 'modern',
    });

    const report = await evaluateServer('https://mcp.example/mcp', 'firebase-jwt', vi.fn());

    expect(report.outcome).toBe('partial');
    expect(report.sections.capabilities.status).toBe('partial');
    expect(report.toolSurfaceAnalysis?.findings.medium).toEqual(expect.arrayContaining([
      expect.objectContaining({
        id: 'analysis.incomplete-pagination',
        summary: expect.stringContaining(method),
      }),
    ]));
  });

  it.each([
    ['tools', 'tools/list'],
    ['resources', 'resources/list'],
    ['prompts', 'prompts/list'],
  ] as const)('keeps method-not-found conclusive for %s discovery', async (capability, method) => {
    const client = createClient();
    const listMethod = capability === 'tools'
      ? client.listTools
      : capability === 'resources'
        ? client.listResources
        : client.listPrompts;
    listMethod.mockRejectedValueOnce(Object.assign(new Error('Method not found'), { code: -32601 }));
    connectionMocks.attempt.mockResolvedValueOnce({
      client,
      url: 'https://mcp.example/mcp',
      transportType: 'streamable-http',
      protocolEra: 'modern',
    });

    const report = await evaluateServer('https://mcp.example/mcp', 'firebase-jwt', vi.fn());

    expect(report.outcome).toBe('scored');
    expect(report.sections.capabilities.status).toBeUndefined();
    expect(report.sections.capabilities.details).toContainEqual(expect.objectContaining({
      text: `⚠ ${method} is not supported`,
    }));
    expect(report.toolSurfaceAnalysis?.findings.medium).not.toEqual(expect.arrayContaining([
      expect.objectContaining({ id: 'analysis.incomplete-pagination' }),
    ]));
  });

  it('marks the report partial when discovery pagination cannot complete', async () => {
    const client = createClient();
    client.listTools
      .mockResolvedValueOnce({
        tools: [{ name: 'first_tool', inputSchema: { type: 'object' } }],
        nextCursor: 'tools-2',
      })
      .mockRejectedValueOnce(new Error('page two unavailable'));
    connectionMocks.attempt.mockResolvedValueOnce({
      client,
      url: 'https://mcp.example/mcp',
      transportType: 'streamable-http',
      protocolEra: 'modern',
    });

    const report = await evaluateServer('https://mcp.example/mcp', 'firebase-jwt', vi.fn());

    expect(report.outcome).toBe('partial');
    expect(report.sections.capabilities.status).toBe('partial');
    expect(report.sections.capabilities.details[0]).toMatchObject({
      metadata: { paginationComplete: false, nextCursor: 'tools-2' },
    });
    expect(report.toolSurfaceAnalysis?.findings.medium).toEqual(expect.arrayContaining([
      expect.objectContaining({ id: 'analysis.incomplete-pagination' }),
    ]));
  });

  it('marks SDK pagination-limit failures partial instead of producing a definitive score', async () => {
    const client = createClient();
    client.listTools.mockRejectedValueOnce(Object.assign(
      new Error('Automatic list pagination exceeded the configured page limit.'),
      { code: 'LIST_PAGINATION_EXCEEDED' }
    ));
    connectionMocks.attempt.mockResolvedValueOnce({
      client,
      url: 'https://mcp.example/mcp',
      transportType: 'streamable-http',
      protocolEra: 'modern',
    });

    const report = await evaluateServer('https://mcp.example/mcp', 'firebase-jwt', vi.fn());

    expect(report.outcome).toBe('partial');
    expect(report.sections.capabilities.status).toBe('partial');
    expect(report.sections.capabilities.details[0]).toMatchObject({
      metadata: { method: 'tools/list', paginationComplete: false },
    });
    expect(report.toolSurfaceAnalysis?.findings.medium).toEqual(expect.arrayContaining([
      expect.objectContaining({ id: 'analysis.incomplete-pagination' }),
    ]));
  });

  it.each([
    ['resources', 'resources/list', 'resources-2'],
    ['prompts', 'prompts/list', 'prompts-2'],
  ] as const)(
    'labels tool-surface analysis partial when %s pagination cannot complete',
    async (capability, method, nextCursor) => {
      const client = createClient();
      const listMethod = capability === 'resources' ? client.listResources : client.listPrompts;
      listMethod
        .mockResolvedValueOnce({ [capability]: [{ name: 'retained' }], nextCursor })
        .mockRejectedValueOnce(new Error(`${capability} page two unavailable`));
      connectionMocks.attempt.mockResolvedValueOnce({
        client,
        url: 'https://mcp.example/mcp',
        transportType: 'streamable-http',
        protocolEra: 'modern',
      });

      const report = await evaluateServer('https://mcp.example/mcp', 'firebase-jwt', vi.fn());
      const paginationFinding = report.toolSurfaceAnalysis?.findings.medium.find(
        ({ id }) => id === 'analysis.incomplete-pagination'
      );

      expect(report.outcome).toBe('partial');
      expect(report.sections.capabilities.details).toContainEqual(expect.objectContaining({
        metadata: expect.objectContaining({ method, paginationComplete: false, nextCursor }),
      }));
      expect(paginationFinding).toMatchObject({
        summary: expect.stringContaining(method),
        evidence: expect.arrayContaining([
          expect.objectContaining({ path: `$.${capability}` }),
        ]),
      });
    }
  );

  it.each([
    ['resources', 'resources/list'],
    ['prompts', 'prompts/list'],
  ] as const)(
    'labels tool-surface analysis partial when %s hits an SDK pagination limit',
    async (capability, method) => {
      const client = createClient();
      const listMethod = capability === 'resources' ? client.listResources : client.listPrompts;
      listMethod.mockRejectedValueOnce(Object.assign(
        new Error('Automatic list pagination exceeded the configured page limit.'),
        { code: 'LIST_PAGINATION_EXCEEDED' }
      ));
      connectionMocks.attempt.mockResolvedValueOnce({
        client,
        url: 'https://mcp.example/mcp',
        transportType: 'streamable-http',
        protocolEra: 'modern',
      });

      const report = await evaluateServer('https://mcp.example/mcp', 'firebase-jwt', vi.fn());
      const paginationFinding = report.toolSurfaceAnalysis?.findings.medium.find(
        ({ id }) => id === 'analysis.incomplete-pagination'
      );

      expect(report.outcome).toBe('partial');
      expect(report.sections.capabilities.details).toContainEqual(expect.objectContaining({
        metadata: expect.objectContaining({ method, paginationComplete: false }),
      }));
      expect(paginationFinding?.summary).toContain(method);
    }
  );

  it('keeps tool-surface analysis unknown when tools/list fails operationally', async () => {
    const client = createClient();
    client.listTools.mockRejectedValueOnce(new Error('tools service temporarily unavailable'));
    connectionMocks.attempt.mockResolvedValueOnce({
      client,
      url: 'https://mcp.example/mcp',
      transportType: 'streamable-http',
      protocolEra: 'modern',
    });

    const report = await evaluateServer('https://mcp.example/mcp', 'firebase-jwt', vi.fn());

    expect(report.outcome).toBe('partial');
    expect(report.sections.capabilities.status).toBe('partial');
    expect(report.sections.capabilities.details[0]).toMatchObject({
      text: '✗ tools/list failed',
      metadata: { method: 'tools/list', error: 'tools service temporarily unavailable' },
    });
    expect(report.toolSurfaceAnalysis).toBeUndefined();
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
    const completedOptionalProbeReport = {
      ...evaluatedReport,
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
    expect(resolveEvaluationOutcome(completedOptionalProbeReport)).toBe('scored');
    expect(isScoredEvaluation(completedOptionalProbeReport)).toBe(true);
  });
});
