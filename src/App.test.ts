import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import {
  attachSavedCardOAuthChallenge,
  beginSavedCardOAuthFlow,
  classifySavedCardAuthenticationFailure,
  resumeSavedCardAuthenticatedMcpRetry,
} from './App';
import {
  ProxiedAuthenticationError,
  TransportConnectionError,
} from './utils/transportDetection';
import {
  beginOAuthFlow,
  getOAuthPrerequisite,
} from './utils/oauthFlow';
import {
  getStoredOAuthTrace,
  recordOAuthAuthenticationChallenge,
} from './utils/oauthTrace';

describe('saved card authentication failures', () => {
  beforeEach(() => {
    sessionStorage.clear();
  });

  afterEach(() => {
    vi.unstubAllGlobals();
    vi.restoreAllMocks();
  });

  it('uses the saved GitHub challenge and authenticated proxy after direct discovery is blocked by CORS', async () => {
    const target = 'https://api.githubcopilot.com/mcp/';
    const resourceMetadataUrl = 'https://api.githubcopilot.com/.well-known/oauth-protected-resource/mcp/';
    const issuer = 'https://github.com/login/oauth';
    const authorizationMetadataUrl = 'https://github.com/.well-known/oauth-authorization-server/login/oauth';
    const directCalls: string[] = [];
    const proxyTargets: string[] = [];
    const getIdToken = vi.fn().mockResolvedValue('firebase-session-token');
    const startFlow = vi.fn((serverUrl, options) => beginOAuthFlow(serverUrl, options));
    const savedError = attachSavedCardOAuthChallenge({
      authenticationSource: 'target',
    }, {
      resourceMetadataUrl,
      scope: 'repo read:user',
    });

    vi.stubGlobal('fetch', vi.fn(async (input: RequestInfo | URL, init?: RequestInit) => {
      const url = String(input);
      if (url.startsWith('https://proxy.mcptest.test/')) {
        const proxyRequest = new URL(url);
        proxyTargets.push(proxyRequest.searchParams.get('target') || '');
        expect(new Headers(init?.headers).get('authorization')).toBe(
          'Bearer firebase-session-token'
        );
        return new Response(JSON.stringify({
          issuer,
          authorization_endpoint: `${issuer}/authorize`,
          token_endpoint: `${issuer}/token`,
          response_types_supported: ['code'],
          code_challenge_methods_supported: ['S256'],
        }), {
          headers: {
            'Content-Type': 'application/json',
            'X-MCP-Proxy-Response-Source': 'target',
          },
        });
      }

      directCalls.push(url);
      if (url === resourceMetadataUrl) {
        return new Response(JSON.stringify({
          resource: target,
          authorization_servers: [issuer],
        }), { headers: { 'Content-Type': 'application/json' } });
      }
      if (url === authorizationMetadataUrl) {
        throw new TypeError('Failed to fetch');
      }
      return new Response('Not found', { status: 404 });
    }));

    let caught: unknown;
    try {
      await beginSavedCardOAuthFlow({
        serverUrl: target,
        challenge: savedError,
        proxyUrl: 'https://proxy.mcptest.test/',
        currentUser: { getIdToken },
        discoveryProxyApplicable: true,
        startFlow,
      });
    } catch (error) {
      caught = error;
    }

    expect(getIdToken).toHaveBeenCalledOnce();
    expect(startFlow).toHaveBeenCalledWith(target, expect.objectContaining({
      resourceMetadataUrl,
      scope: 'repo read:user',
      discoveryProxy: {
        url: 'https://proxy.mcptest.test/',
        authorizationToken: 'firebase-session-token',
      },
    }));
    expect(directCalls).toContain(resourceMetadataUrl);
    expect(directCalls).toContain(authorizationMetadataUrl);
    expect(proxyTargets).toEqual([authorizationMetadataUrl]);
    expect(getOAuthPrerequisite(caught)).toMatchObject({
      kind: 'pre_registered_client_required',
      providerName: 'GitHub',
    });
    expect(JSON.stringify(savedError)).not.toContain(resourceMetadataUrl);
  });

  it('does not request OAuth for a direct JSON-RPC Forbidden application error', () => {
    const error = new Error('MCP error -32000: Forbidden operation');

    expect(classifySavedCardAuthenticationFailure(error, false)).toBeUndefined();
  });

  it('does not treat application-defined JSON-RPC data as an HTTP challenge', () => {
    const error = Object.assign(new Error('MCP application error'), {
      data: { status: 403 },
    });

    expect(classifySavedCardAuthenticationFailure(error, false)).toBeUndefined();
  });

  it('classifies a structured direct HTTP authentication status as target OAuth', () => {
    const error = Object.assign(new Error('Request failed'), { status: 401 });

    expect(classifySavedCardAuthenticationFailure(error, false)).toEqual({
      status: 401,
      source: 'target',
    });
  });

  it('uses an observed direct response challenge for saved-card OAuth', () => {
    expect(classifySavedCardAuthenticationFailure(
      new Error('Transport rejected the request'),
      false,
      { status: 403, source: 'target' }
    )).toEqual({ status: 403, source: 'target' });
  });

  it('preserves target provenance through nested proxy connection failures', () => {
    const targetError = new ProxiedAuthenticationError(
      403,
      'target',
      new Error('Upstream denied the request')
    );

    expect(classifySavedCardAuthenticationFailure(
      new TransportConnectionError([targetError]),
      true
    )).toEqual({ status: 403, source: 'target' });
  });

  it('keeps proxy-owned authentication failures out of target OAuth', () => {
    const proxyError = new ProxiedAuthenticationError(
      401,
      'proxy',
      new Error('Proxy session expired')
    );

    expect(classifySavedCardAuthenticationFailure(proxyError, true)).toEqual({
      status: 401,
      source: 'proxy',
    });
  });

  it('does not guess the source of an unproven proxied HTTP status', () => {
    const ambiguousError = Object.assign(new Error('Request failed'), { status: 401 });

    expect(classifySavedCardAuthenticationFailure(ambiguousError, true)).toBeUndefined();
  });

  it.each([
    ['successful', 'succeeded', 200, 'authorized'],
    ['failed', 'failed', 503, 'failed'],
  ] as const)(
    'finalizes a %s saved-card post-callback retry with its actual request evidence',
    (_label, retryOutcome, status, terminalStatus) => {
      const endpoint = `https://${retryOutcome}-saved-card.example/mcp`;
      const trace = recordOAuthAuthenticationChallenge({
        targetUrl: endpoint,
        status: 401,
        source: 'target',
        route: 'direct',
        storage: sessionStorage,
      });
      trace.setAuthenticatedMcpRetryState('pending');
      const retry = resumeSavedCardAuthenticatedMcpRetry(
        endpoint,
        'oauth-access-token',
        sessionStorage
      );
      const request = {
        method: 'POST',
        url: `${endpoint}?operation=tools-call`,
        status,
        outcome: retryOutcome,
        startedAt: '2026-08-11T18:30:00.000Z',
        durationMs: 38,
        transportType: 'streamable-http' as const,
      };
      retry?.observeRequest('direct')(request);

      if (retryOutcome === 'succeeded') {
        retry?.succeed({
          route: 'direct',
          result: {
            url: endpoint,
            transportType: 'streamable-http',
            protocolEra: 'modern',
            observedRequests: [request],
          },
        });
      } else {
        retry?.fail({ route: 'direct', error: new Error('Saved-card tool call failed') });
      }

      const stored = getStoredOAuthTrace(endpoint, sessionStorage);
      expect(stored?.events.find(({ type }) => type === 'mcp_retry')).toMatchObject({
        outcome: retryOutcome,
        route: 'direct',
        request: { method: 'POST', url: request.url },
        response: { status },
        timing: { startedAt: request.startedAt, durationMs: 38 },
      });
      expect(stored?.outcome?.status).toBe(terminalStatus);
      expect(stored?.authenticatedMcpRetry).toBeUndefined();
    }
  );
});
