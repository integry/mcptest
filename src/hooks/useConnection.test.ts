import React, { act } from 'react';
import { createRoot, type Root } from 'react-dom/client';
import { afterEach, beforeAll, beforeEach, describe, expect, it, vi } from 'vitest';

const connectionMocks = vi.hoisted(() => ({ attempt: vi.fn() }));
const oauthMocks = vi.hoisted(() => ({
  begin: vi.fn(),
  actualBegin: undefined as undefined | ((serverUrl: string, options?: any) => Promise<any>),
}));
const authMocks = vi.hoisted(() => ({ currentUser: null as null | { getIdToken: () => Promise<string> } }));

vi.mock('../utils/transportDetection', async (importOriginal) => {
  const actual = await importOriginal<typeof import('../utils/transportDetection')>();
  return { ...actual, attemptParallelConnections: connectionMocks.attempt };
});

vi.mock('../context/AuthContext', () => ({
  useAuth: () => ({ currentUser: authMocks.currentUser, loading: false }),
}));

vi.mock('../utils/analytics', () => ({ logEvent: vi.fn() }));

vi.mock('../utils/oauthFlow', async (importOriginal) => {
  const actual = await importOriginal<typeof import('../utils/oauthFlow')>();
  oauthMocks.actualBegin = actual.beginOAuthFlow;
  return { ...actual, beginOAuthFlow: oauthMocks.begin };
});

import { useConnection } from './useConnection';
import {
  BrowserOAuthProvider,
  completeOAuthFlow,
  loadOAuthAuthorization,
  OAuthPrerequisiteError,
} from '../utils/oauthFlow';
import {
  getStoredOAuthTrace,
  OAUTH_TRACE_STORAGE_PREFIX,
  recordOAuthAuthenticationChallenge,
} from '../utils/oauthTrace';
import {
  ProxiedAuthenticationError,
  TransportConnectionError,
} from '../utils/transportDetection';
import { loadHostedOAuthAuthorization } from '../utils/hostedOAuth';

beforeAll(() => {
  (
    globalThis as typeof globalThis & { IS_REACT_ACT_ENVIRONMENT: boolean }
  ).IS_REACT_ACT_ENVIRONMENT = true;
});

const renderConnectionHook = (
  requestHeaders?: Record<string, string>,
  useProxy = false
) => {
  let connection: ReturnType<typeof useConnection> | undefined;
  const container = document.createElement('div');
  const root: Root = createRoot(container);
  const addLogEntry = vi.fn();

  const Probe = () => {
    connection = useConnection(addLogEntry, useProxy, undefined, requestHeaders);
    return null;
  };

  act(() => {
    root.render(React.createElement(Probe));
  });

  return {
    addLogEntry,
    get connection() {
      if (!connection) throw new Error('Connection hook was not rendered');
      return connection;
    },
    unmount() {
      act(() => root.unmount());
    },
  };
};

const storeHostedGrant = (serverUrl: string, grant = 'stored-hosted-grant'): void => {
  const url = new URL(serverUrl);
  url.pathname = url.pathname.replace(/\/+$/, '') || '/';
  const resource = `${url.origin}${url.pathname}`;
  sessionStorage.setItem(
    `mcp_hosted_oauth_v1:${encodeURIComponent(resource)}`,
    JSON.stringify({ grant, issuer: 'https://mcp.slack.com' })
  );
};

describe('connection URL finalization', () => {
  beforeEach(() => {
    vi.useFakeTimers();
    localStorage.clear();
    sessionStorage.clear();
    connectionMocks.attempt.mockReset();
    oauthMocks.begin.mockReset();
    authMocks.currentUser = null;
  });

  afterEach(() => {
    vi.clearAllTimers();
    vi.useRealTimers();
    vi.unstubAllEnvs();
    vi.restoreAllMocks();
  });

  it.each(['https://mcp.sentry.dev/', 'https://mcp.sentry.dev/mcp'])(
    'binds anonymous OAuth, callback tokens and proxy reconnect to the challenged endpoint from %s', async originalUrl => {
      const endpoint = 'https://mcp.sentry.dev/mcp';
      const issuer = 'https://mcp.sentry.dev';
      const metadataUrl = `${issuer}/.well-known/oauth-protected-resource/mcp`;
      const proxyUrl = 'https://proxy.mcptest.test/';
      vi.stubEnv('VITE_PROXY_URL', proxyUrl);
      let authorizationUrl: URL | undefined;
      const json = (value: unknown) => new Response(JSON.stringify(value), {
        headers: { 'Content-Type': 'application/json', 'X-MCP-Proxy-Response-Source': 'target' },
      });
      const fetchMock = vi.spyOn(globalThis, 'fetch').mockImplementation(async (input, init) => {
        const url = new URL(String(input));
        // Metadata is accessible only through the anonymous proxy, as in production.
        if (url.origin !== new URL(proxyUrl).origin) throw new TypeError('Failed to fetch');
        expect(new Headers(init?.headers).get('authorization')).toBeNull();
        const target = url.searchParams.get('target');
        if (target === metadataUrl) return json({ resource: endpoint, authorization_servers: [issuer] });
        if (target === `${issuer}/.well-known/oauth-authorization-server`) return json({
          issuer, authorization_endpoint: `${issuer}/authorize`, token_endpoint: `${issuer}/token`,
          registration_endpoint: `${issuer}/register`, response_types_supported: ['code'],
          code_challenge_methods_supported: ['S256'], token_endpoint_auth_methods_supported: ['none'],
        });
        if (url.pathname === '/oauth/register') return json({
          ...JSON.parse(String(init?.body)), client_id: 'sentry-test-client',
        });
        if (url.pathname === '/oauth/token') {
          const body = new URLSearchParams(String(init?.body));
          expect(body.get('resource')).toBe(endpoint);
          expect(body.get('code_verifier')).toBeTruthy();
          return json({ access_token: 'sentry-target-token', token_type: 'Bearer' });
        }
        throw new Error(`Unexpected OAuth request ${url}`);
      });
      oauthMocks.begin.mockImplementationOnce((serverUrl, options) => oauthMocks.actualBegin?.(serverUrl, {
        ...options, redirectUrl: 'https://mcptest.io/oauth/callback',
        // This suite runs on localhost; enable the relay used on the production origin.
        tokenProxy: { url: proxyUrl },
        redirect: (url: URL) => { authorizationUrl = url; },
      }));
      connectionMocks.attempt
        .mockRejectedValueOnce(new TypeError('Failed to fetch'))
        .mockRejectedValueOnce(new TransportConnectionError([
          new ProxiedAuthenticationError(401, 'target', new Error('Unauthorized'), {
            method: 'POST', url: `${proxyUrl}?target=${encodeURIComponent(endpoint)}`, targetUrl: endpoint,
          }, undefined, metadataUrl),
        ]));
      const before = renderConnectionHook(undefined, true);
      await act(async () => {
        await before.connection.handleConnect(vi.fn(), vi.fn(), vi.fn(), originalUrl);
      });
      expect(before.connection.connectionError).toBeNull();
      expect(before.connection.oauthPrerequisite).toBeNull();
      expect(oauthMocks.begin).toHaveBeenCalledWith(endpoint, expect.anything());
      expect(authorizationUrl?.pathname).toBe('/authorize');
      expect(authorizationUrl?.searchParams.get('resource')).toBe(endpoint);
      expect(authorizationUrl?.searchParams.get('code_challenge_method')).toBe('S256');
      expect(sessionStorage.getItem('oauth_server_url')).toBe(endpoint);
      before.unmount();

      const completed = await completeOAuthFlow(
        `https://mcptest.io/oauth/callback?code=provider-code&state=${authorizationUrl?.searchParams.get('state')}`,
        { tokenProxy: { url: proxyUrl } }
      );
      expect(completed.serverUrl).toBe(endpoint);
      expect(loadOAuthAuthorization(endpoint)?.accessToken).toBe('sentry-target-token');
      expect(loadOAuthAuthorization('https://mcp.sentry.dev/')).toBeUndefined();
      connectionMocks.attempt
        .mockRejectedValueOnce(new TypeError('Failed to fetch'))
        .mockResolvedValueOnce({
          client: { close: vi.fn().mockResolvedValue(undefined) },
          url: `${proxyUrl}?target=${encodeURIComponent(endpoint)}`,
          transportType: 'streamable-http', protocolEra: 'stateless',
        });
      const after = renderConnectionHook(undefined, true);
      await act(async () => {
        await after.connection.handleConnect(vi.fn(), vi.fn(), vi.fn(), completed.serverUrl);
      });
      expect(connectionMocks.attempt.mock.calls[2][0]).toBe(endpoint);
      expect(connectionMocks.attempt.mock.calls[2][2]).toBe('sentry-target-token');
      expect(connectionMocks.attempt.mock.calls[3].slice(0, 5)).toEqual([
        `${proxyUrl}?target=${encodeURIComponent(endpoint)}`, expect.anything(), undefined,
        { Authorization: 'Bearer sentry-target-token' }, true,
      ]);
      expect(after.connection.connectionStatus).toBe('Connected');
      expect(after.connection.serverUrl).toBe(endpoint);
      expect(oauthMocks.begin).toHaveBeenCalledOnce();
      expect(getStoredOAuthTrace(endpoint, sessionStorage)?.outcome?.status).toBe('authorized');
      expect(fetchMock).toHaveBeenCalled();
      after.unmount();
    }
  );

  it.each(['https://unrelated.example/mcp', 'https://mcp.sentry.dev/other'])(
    'still rejects unrelated protected-resource metadata %s', async resource => {
      const endpoint = 'https://mcp.sentry.dev/mcp';
      connectionMocks.attempt.mockRejectedValueOnce(new ProxiedAuthenticationError(
        401, 'target', new Error('Unauthorized'), { method: 'POST', url: endpoint, targetUrl: endpoint },
        undefined, 'https://mcp.sentry.dev/.well-known/oauth-protected-resource/mcp'
      ));
      const redirect = vi.fn();
      oauthMocks.begin.mockImplementationOnce((serverUrl, options) => oauthMocks.actualBegin?.(serverUrl, {
        ...options, redirect,
        fetchFn: vi.fn(async (input) => new Response(JSON.stringify(
          String(input).includes('oauth-protected-resource')
            ? { resource, authorization_servers: ['https://mcp.sentry.dev'] }
            : {
                issuer: 'https://mcp.sentry.dev', authorization_endpoint: 'https://mcp.sentry.dev/authorize',
                token_endpoint: 'https://mcp.sentry.dev/token', response_types_supported: ['code'],
                code_challenge_methods_supported: ['S256'], client_id_metadata_document_supported: true,
              }
        ), { headers: { 'Content-Type': 'application/json' } })),
      }));
      const view = renderConnectionHook();
      await act(async () => {
        await view.connection.handleConnect(vi.fn(), vi.fn(), vi.fn(), 'https://mcp.sentry.dev/');
      });
      expect(redirect).not.toHaveBeenCalled();
      expect(view.connection.connectionError?.error).toContain('does not match expected');
      expect(loadOAuthAuthorization(endpoint)).toBeUndefined();
      view.unmount();
    }
  );

  it('surfaces an OAuth failure at the candidate while retaining the original input', async () => {
    vi.stubEnv('VITE_PROXY_URL', 'https://proxy.example/');
    const endpoint = 'https://mcp.sentry.dev/mcp';
    connectionMocks.attempt.mockRejectedValueOnce(new TypeError('Failed to fetch'))
      .mockRejectedValueOnce(new ProxiedAuthenticationError(401, 'target', new Error('Unauthorized'), {
        method: 'POST', url: 'https://proxy.example/?target=' + encodeURIComponent(endpoint), targetUrl: endpoint,
      }));
    oauthMocks.begin.mockRejectedValueOnce(new Error('Protected resource mismatch'));
    const view = renderConnectionHook(undefined, true);
    await act(async () => {
      await view.connection.handleConnect(vi.fn(), vi.fn(), vi.fn(), 'https://mcp.sentry.dev/');
    });
    expect(view.connection.connectionError).toMatchObject({
      failureStage: 'oauth', serverUrl: endpoint, originalServerUrl: 'https://mcp.sentry.dev/',
      error: 'OAuth authorization failed: Protected resource mismatch',
    });
    view.unmount();
  });

  it('starts a first connection with a blank endpoint', () => {
    const view = renderConnectionHook();

    expect(view.connection.serverUrl).toBe('');
    expect(view.connection.recentServers).toEqual([]);
    view.unmount();
  });

  it.each([
    ['URL-valued', 'https://tenant.example/account'],
    ['ordinary', 'production'],
  ])('keeps a direct custom endpoint with a %s target parameter in connection state', async (_, target) => {
    const endpoint = new URL('https://mcp.example/custom/endpoint');
    endpoint.searchParams.set('target', target);
    endpoint.searchParams.set('tenant', 'acme');
    connectionMocks.attempt.mockResolvedValueOnce({
      client: { close: vi.fn().mockResolvedValue(undefined) },
      url: endpoint.toString(),
      transportType: 'streamable-http',
      protocolEra: 'modern',
    });
    const view = renderConnectionHook();

    await act(async () => {
      await view.connection.handleConnect(
        vi.fn(),
        vi.fn(),
        vi.fn(),
        endpoint.toString()
      );
    });

    expect(connectionMocks.attempt).toHaveBeenCalledOnce();
    expect(oauthMocks.begin).not.toHaveBeenCalled();
    expect(connectionMocks.attempt.mock.calls[0][0]).toBe(endpoint.toString());
    expect(connectionMocks.attempt.mock.calls[0][4]).toBe(false);
    expect(view.connection.serverUrl).toBe(endpoint.toString());
    expect(view.connection.connectionStatus).toBe('Connected');
    expect(getStoredOAuthTrace(endpoint.toString(), sessionStorage)).toBeUndefined();
    expect(JSON.parse(localStorage.getItem('mcpRecentServers') || '[]')).toContainEqual({
      url: endpoint.toString(),
    });
    view.unmount();
  });

  it('discovers OAuth only after the MCP target returns an authentication challenge', async () => {
    const endpoint = 'https://secure.example/custom/mcp';
    const challengeRequest = {
      method: 'POST',
      url: `${endpoint}?operation=initialize`,
      startedAt: '2026-08-11T14:59:58.000Z',
      durationMs: 23,
    };
    oauthMocks.begin.mockImplementationOnce(async (serverUrl, options) => {
      const issuer = 'https://auth-secure.example/';
      return oauthMocks.actualBegin?.(serverUrl, {
        ...options,
        fetchFn: vi.fn().mockResolvedValue(new Response('{}', {
          status: 200,
          headers: { 'Content-Type': 'application/json' },
        })),
        authenticate: async (provider: BrowserOAuthProvider, authOptions: any) => {
          await authOptions.fetchFn(`${issuer}.well-known/oauth-authorization-server`);
          provider.saveDiscoveryState({
            authorizationServerUrl: issuer,
            authorizationServerMetadata: {
              issuer,
              authorization_endpoint: `${issuer}authorize`,
              token_endpoint: `${issuer}token`,
              response_types_supported: ['code'],
              code_challenge_methods_supported: ['S256'],
            },
          });
          provider.saveTokens(
            { access_token: 'sdk-token', token_type: 'Bearer', issuer },
            { issuer }
          );

          const otherIssuer = 'https://auth-other.example/';
          const otherProvider = new BrowserOAuthProvider('https://secure.example/other/mcp');
          otherProvider.saveDiscoveryState({
            authorizationServerUrl: otherIssuer,
            authorizationServerMetadata: {
              issuer: otherIssuer,
              authorization_endpoint: `${otherIssuer}authorize`,
              token_endpoint: `${otherIssuer}token`,
              response_types_supported: ['code'],
              code_challenge_methods_supported: ['S256'],
            },
          });
          otherProvider.saveTokens(
            { access_token: 'other-resource-token', token_type: 'Bearer', issuer: otherIssuer },
            { issuer: otherIssuer }
          );
          return 'AUTHORIZED';
        },
      });
    });
    const successfulRetry = {
      client: { close: vi.fn().mockResolvedValue(undefined) },
      url: endpoint,
      transportType: 'streamable-http',
      protocolEra: 'modern',
    };
    connectionMocks.attempt
      .mockRejectedValueOnce(new TransportConnectionError([
        new ProxiedAuthenticationError(
          401,
          'target',
          new Error('The MCP target requires authorization'),
          challengeRequest
        )
      ]))
      .mockImplementationOnce(async (...args: any[]) => {
        args[6]?.({
          method: 'GET',
          url: `${endpoint}/sse`,
          candidateUrl: `${endpoint}/sse`,
          transportType: 'legacy-sse',
          status: 500,
          outcome: 'failed',
        });
        const winningRequest = {
          method: 'POST',
          url: `${endpoint}/`,
          candidateUrl: endpoint,
          transportType: 'streamable-http' as const,
          startedAt: '2026-08-11T15:00:00.000Z',
          durationMs: 9,
          status: 200,
          outcome: 'succeeded' as const,
        };
        args[6]?.(winningRequest);
        return { ...successfulRetry, observedRequests: [winningRequest] };
      });
    const view = renderConnectionHook();

    await act(async () => {
      await view.connection.handleConnect(vi.fn(), vi.fn(), vi.fn(), endpoint);
    });

    expect(connectionMocks.attempt.mock.calls[0][2]).toBeUndefined();
    expect(oauthMocks.begin).toHaveBeenCalledWith(endpoint, expect.objectContaining({
      deferAuthorizedTraceOutcome: true,
      trace: expect.anything(),
    }));
    expect(oauthMocks.begin.mock.invocationCallOrder[0]).toBeGreaterThan(
      connectionMocks.attempt.mock.invocationCallOrder[0]
    );
    expect(connectionMocks.attempt).toHaveBeenLastCalledWith(
      endpoint,
      expect.anything(),
      'sdk-token',
      undefined,
      false,
      undefined,
      expect.any(Function)
    );
    expect(view.connection.connectionStatus).toBe('Connected');
    expect(getStoredOAuthTrace(endpoint, sessionStorage)?.events).toEqual(expect.arrayContaining([
      expect.objectContaining({
        type: 'target_challenge',
        provenance: 'direct_target',
        request: {
          method: challengeRequest.method,
          url: challengeRequest.url,
        },
        response: { status: 401 },
        timing: {
          startedAt: challengeRequest.startedAt,
          durationMs: challengeRequest.durationMs,
        },
      }),
      expect.objectContaining({
        type: 'authorization_server_metadata',
        outcome: 'succeeded',
      }),
      expect.objectContaining({
        type: 'mcp_retry',
        outcome: 'succeeded',
        route: 'direct',
        request: { method: 'POST', url: `${endpoint}/` },
        response: expect.objectContaining({
          status: 200,
          metadata: expect.objectContaining({
            protocolEra: 'modern',
            protocolEraHint: 'automatic',
          }),
        }),
        timing: {
          startedAt: '2026-08-11T15:00:00.000Z',
          durationMs: 9,
        },
      }),
    ]));
    expect(getStoredOAuthTrace(endpoint, sessionStorage)?.outcome?.status).toBe('authorized');
    const finalEvents = getStoredOAuthTrace(endpoint, sessionStorage)?.events || [];
    expect(finalEvents[finalEvents.length - 1]).toMatchObject({
      type: 'terminal_outcome',
      outcome: 'succeeded',
    });
    view.unmount();
  });

  it('retries with the OAuth token when trace persistence is unavailable', async () => {
    const endpoint = 'https://trace-storage.example/mcp';
    const issuer = 'https://auth-trace-storage.example/';
    const nativeSetItem = Storage.prototype.setItem;
    const rejectedTraceWrites: string[] = [];
    vi.spyOn(Storage.prototype, 'setItem').mockImplementation(function (
      this: Storage,
      key: string,
      value: string
    ) {
      if (this === sessionStorage && key.startsWith(OAUTH_TRACE_STORAGE_PREFIX)) {
        rejectedTraceWrites.push(key);
        throw new DOMException('Trace storage quota exceeded', 'QuotaExceededError');
      }
      nativeSetItem.call(this, key, value);
    });
    oauthMocks.begin.mockImplementationOnce(async (serverUrl, options) => (
      oauthMocks.actualBegin?.(serverUrl, {
        ...options,
        fetchFn: vi.fn().mockResolvedValue(new Response('{}', {
          status: 200,
          headers: { 'Content-Type': 'application/json' },
        })),
        authenticate: async (provider: BrowserOAuthProvider) => {
          provider.saveDiscoveryState({
            authorizationServerUrl: issuer,
            authorizationServerMetadata: {
              issuer,
              authorization_endpoint: `${issuer}authorize`,
              token_endpoint: `${issuer}token`,
              response_types_supported: ['code'],
              code_challenge_methods_supported: ['S256'],
            },
          });
          provider.saveTokens(
            { access_token: 'quota-safe-token', token_type: 'Bearer', issuer },
            { issuer }
          );
          return 'AUTHORIZED';
        },
      })
    ));
    connectionMocks.attempt
      .mockRejectedValueOnce(new TransportConnectionError([
        new ProxiedAuthenticationError(
          401,
          'target',
          new Error('Authorization required'),
          { method: 'POST', url: endpoint }
        ),
      ]))
      .mockResolvedValueOnce({
        client: { close: vi.fn().mockResolvedValue(undefined) },
        url: endpoint,
        transportType: 'streamable-http',
        protocolEra: 'modern',
      });
    const view = renderConnectionHook();

    await act(async () => {
      await view.connection.handleConnect(vi.fn(), vi.fn(), vi.fn(), endpoint);
    });

    expect(rejectedTraceWrites.length).toBeGreaterThan(0);
    expect(sessionStorage.getItem(
      `mcp_oauth_v2:${encodeURIComponent(new URL(endpoint).toString())}`
    )).not.toBeNull();
    expect(connectionMocks.attempt).toHaveBeenLastCalledWith(
      endpoint,
      expect.anything(),
      'quota-safe-token',
      undefined,
      false,
      undefined,
      expect.any(Function)
    );
    expect(connectionMocks.attempt).toHaveBeenCalledTimes(2);
    expect(view.connection.connectionStatus).toBe('Connected');
    expect(view.connection.connectionError).toBeNull();
    expect(getStoredOAuthTrace(endpoint, sessionStorage)).toBeUndefined();
    view.unmount();
  });

  it('finalizes a failed authenticated retry with its observed request facts', async () => {
    const endpoint = 'https://retry-failure.example/mcp';
    const issuer = 'https://auth-retry-failure.example/';
    oauthMocks.begin.mockImplementationOnce(async () => {
      const provider = new BrowserOAuthProvider(endpoint);
      provider.saveDiscoveryState({
        authorizationServerUrl: issuer,
        authorizationServerMetadata: {
          issuer,
          authorization_endpoint: `${issuer}authorize`,
          token_endpoint: `${issuer}token`,
          response_types_supported: ['code'],
          code_challenge_methods_supported: ['S256'],
        },
      });
      provider.saveTokens(
        { access_token: 'retry-token', token_type: 'Bearer', issuer },
        { issuer }
      );
      return 'AUTHORIZED';
    });
    const retryUrl = `${endpoint}/`;
    connectionMocks.attempt
      .mockRejectedValueOnce(new TransportConnectionError([
        new ProxiedAuthenticationError(
          401,
          'target',
          new Error('Authorization required'),
          { method: 'GET', url: endpoint }
        ),
      ]))
      .mockImplementationOnce(async (...args: any[]) => {
        args[6]?.({ method: 'POST', url: retryUrl });
        throw new TransportConnectionError([
          new ProxiedAuthenticationError(
            403,
            'target',
            new Error('Authenticated request forbidden'),
            { method: 'POST', url: retryUrl }
          ),
        ]);
      });
    const view = renderConnectionHook();

    await act(async () => {
      await view.connection.handleConnect(vi.fn(), vi.fn(), vi.fn(), endpoint);
    });

    const trace = getStoredOAuthTrace(endpoint, sessionStorage);
    expect(trace?.events).toEqual(expect.arrayContaining([
      expect.objectContaining({
        type: 'target_challenge',
        request: { method: 'GET', url: endpoint },
      }),
      expect.objectContaining({
        type: 'mcp_retry',
        outcome: 'failed',
        route: 'direct',
        request: { method: 'POST', url: retryUrl },
        response: expect.objectContaining({ status: 403 }),
        timing: expect.objectContaining({
          startedAt: expect.any(String),
          durationMs: expect.any(Number),
        }),
        explanation: expect.stringContaining('authenticated MCP retry failed'),
      }),
    ]));
    expect(trace?.events.some((event) => (
      event.type === 'mcp_retry' && event.outcome === 'started'
    ))).toBe(false);
    expect(trace?.outcome).toMatchObject({
      status: 'failed',
      explanation: expect.stringContaining('authenticated MCP retry failed'),
    });
    view.unmount();
  });

  it('finalizes a user-aborted authenticated retry as cancelled', async () => {
    const endpoint = 'https://retry-cancelled.example/mcp';
    const issuer = 'https://auth-retry-cancelled.example/';
    const provider = new BrowserOAuthProvider(endpoint);
    provider.saveDiscoveryState({
      authorizationServerUrl: issuer,
      authorizationServerMetadata: {
        issuer,
        authorization_endpoint: `${issuer}authorize`,
        token_endpoint: `${issuer}token`,
        response_types_supported: ['code'],
        code_challenge_methods_supported: ['S256'],
      },
    });
    provider.saveTokens(
      { access_token: 'cancelled-retry-token', token_type: 'Bearer', issuer },
      { issuer }
    );
    const trace = recordOAuthAuthenticationChallenge({
      targetUrl: endpoint,
      status: 401,
      source: 'target',
      route: 'direct',
      storage: sessionStorage,
    });
    trace.setAuthenticatedMcpRetryState('pending');
    connectionMocks.attempt.mockRejectedValueOnce(new Error('Connection aborted by user'));
    const view = renderConnectionHook();

    await act(async () => {
      await view.connection.handleConnect(vi.fn(), vi.fn(), vi.fn(), endpoint);
    });

    const completedTrace = getStoredOAuthTrace(endpoint, sessionStorage);
    expect(completedTrace?.authenticatedMcpRetry).toBeUndefined();
    expect(completedTrace?.outcome?.status).toBe('cancelled');
    expect(completedTrace?.events.filter(({ type }) => type === 'mcp_retry')).toEqual([
      expect.objectContaining({ outcome: 'cancelled' }),
    ]);
    expect(completedTrace?.events.filter(({ type }) => type === 'terminal_outcome')).toEqual([
      expect.objectContaining({ outcome: 'cancelled' }),
    ]);
    view.unmount();
  });

  it('keeps an authenticated retry pending when direct failure falls back to proxy success', async () => {
    const endpoint = 'https://retry-proxy-fallback.example/mcp';
    const issuer = 'https://auth-retry-proxy-fallback.example/';
    const proxyUrl = 'https://proxy.mcptest.test/';
    const provider = new BrowserOAuthProvider(endpoint);
    provider.saveDiscoveryState({
      authorizationServerUrl: issuer,
      authorizationServerMetadata: {
        issuer,
        authorization_endpoint: `${issuer}authorize`,
        token_endpoint: `${issuer}token`,
        response_types_supported: ['code'],
        code_challenge_methods_supported: ['S256'],
      },
    });
    provider.saveTokens(
      { access_token: 'proxy-fallback-token', token_type: 'Bearer', issuer },
      { issuer }
    );
    const trace = recordOAuthAuthenticationChallenge({
      targetUrl: endpoint,
      status: 401,
      source: 'target',
      route: 'direct',
      storage: sessionStorage,
    });
    trace.setAuthenticatedMcpRetryState('pending');
    vi.stubEnv('VITE_PROXY_URL', proxyUrl);
    authMocks.currentUser = { getIdToken: vi.fn().mockResolvedValue('proxy-session-token') };

    const proxyRequestUrl = `${proxyUrl}?target=${encodeURIComponent(endpoint)}`;
    connectionMocks.attempt
      .mockImplementationOnce(async (...args: any[]) => {
        args[6]?.({
          method: 'POST',
          url: endpoint,
          status: 0,
          outcome: 'failed',
        });
        throw new Error('CORS failed to fetch');
      })
      .mockImplementationOnce(async (...args: any[]) => {
        const request = {
          method: 'POST',
          url: proxyRequestUrl,
          status: 200,
          outcome: 'succeeded' as const,
        };
        args[6]?.(request);
        return {
          client: { close: vi.fn().mockResolvedValue(undefined) },
          url: proxyRequestUrl,
          transportType: 'streamable-http',
          protocolEra: 'modern',
          observedRequests: [request],
        };
      });
    const view = renderConnectionHook(undefined, true);

    await act(async () => {
      await view.connection.handleConnect(vi.fn(), vi.fn(), vi.fn(), endpoint);
    });

    const completedTrace = getStoredOAuthTrace(endpoint, sessionStorage);
    expect(connectionMocks.attempt).toHaveBeenCalledTimes(2);
    expect(oauthMocks.begin).not.toHaveBeenCalled();
    expect(completedTrace?.outcome?.status).toBe('authorized');
    expect(completedTrace?.events.filter(({ type }) => type === 'mcp_retry')).toEqual([
      expect.objectContaining({
        outcome: 'succeeded',
        route: 'proxy',
        provenance: 'authenticated_proxy',
      }),
    ]);
    expect(completedTrace?.events.filter(({ type }) => type === 'terminal_outcome')).toEqual([
      expect.objectContaining({ outcome: 'succeeded' }),
    ]);
    view.unmount();
  });

  it('records a proxy-observed challenge and the following direct retry on their actual routes', async () => {
    const endpoint = 'https://proxy-challenge.example/mcp';
    const proxyUrl = 'https://proxy.mcptest.test/';
    const issuer = 'https://auth-proxy-challenge.example/';
    vi.stubEnv('VITE_PROXY_URL', proxyUrl);
    authMocks.currentUser = { getIdToken: vi.fn().mockResolvedValue('proxy-session-token') };
    oauthMocks.begin.mockImplementationOnce(async () => {
      const provider = new BrowserOAuthProvider(endpoint);
      provider.saveDiscoveryState({
        authorizationServerUrl: issuer,
        authorizationServerMetadata: {
          issuer,
          authorization_endpoint: `${issuer}authorize`,
          token_endpoint: `${issuer}token`,
          response_types_supported: ['code'],
          code_challenge_methods_supported: ['S256'],
        },
      });
      provider.saveTokens(
        { access_token: 'proxy-challenge-token', token_type: 'Bearer', issuer },
        { issuer }
      );
      return 'AUTHORIZED';
    });
    const observedProxyUrl = `${proxyUrl}?target=${encodeURIComponent(endpoint)}`;
    connectionMocks.attempt
      .mockRejectedValueOnce(new Error('CORS failed to fetch'))
      .mockRejectedValueOnce(new TransportConnectionError([
        new ProxiedAuthenticationError(
          401,
          'target',
          new Error('Target authorization required through proxy'),
          { method: 'GET', url: observedProxyUrl, targetUrl: endpoint }
        ),
      ]))
      .mockImplementationOnce(async (...args: any[]) => {
        args[6]?.({ method: 'POST', url: endpoint });
        return {
          client: { close: vi.fn().mockResolvedValue(undefined) },
          url: endpoint,
          transportType: 'streamable-http',
          protocolEra: 'modern',
        };
      });
    const view = renderConnectionHook(undefined, true);

    await act(async () => {
      await view.connection.handleConnect(vi.fn(), vi.fn(), vi.fn(), new URL(endpoint).origin + '/');
    });

    expect(oauthMocks.begin).toHaveBeenCalledWith(endpoint, expect.anything());
    expect(connectionMocks.attempt.mock.calls[2][0]).toBe(endpoint);
    expect(connectionMocks.attempt.mock.calls[2][2]).toBe('proxy-challenge-token');
    const trace = getStoredOAuthTrace(endpoint, sessionStorage);
    expect(trace?.events).toEqual(expect.arrayContaining([
      expect.objectContaining({
        type: 'target_challenge',
        route: 'proxy',
        request: { method: 'GET', url: observedProxyUrl },
      }),
      expect.objectContaining({
        type: 'mcp_retry',
        outcome: 'succeeded',
        route: 'direct',
        provenance: 'direct_target',
        request: { method: 'POST', url: endpoint },
      }),
    ]));
    view.unmount();
  });

  it('keeps the stateful retry hint after challenge-driven OAuth', async () => {
    const endpoint = 'https://stateful.example/mcp';
    oauthMocks.begin.mockImplementationOnce(async () => {
      const issuer = 'https://auth-stateful.example/';
      const provider = new BrowserOAuthProvider(endpoint);
      provider.saveDiscoveryState({
        authorizationServerUrl: issuer,
        authorizationServerMetadata: {
          issuer,
          authorization_endpoint: `${issuer}authorize`,
          token_endpoint: `${issuer}token`,
          response_types_supported: ['code'],
          code_challenge_methods_supported: ['S256'],
        },
      });
      provider.saveTokens(
        { access_token: 'stateful-token', token_type: 'Bearer', issuer },
        { issuer }
      );
      return 'AUTHORIZED';
    });
    connectionMocks.attempt
      .mockRejectedValueOnce(new TransportConnectionError([
        new ProxiedAuthenticationError(401, 'target', new Error('Authorization required')),
      ]))
      .mockImplementationOnce(async (...args: any[]) => {
        args[6]?.({ method: 'POST', url: endpoint });
        return {
          client: { close: vi.fn().mockResolvedValue(undefined) },
          url: endpoint,
          transportType: 'streamable-http',
          protocolEra: 'stateful',
          protocolVersion: '2025-11-25',
        };
      });
    const view = renderConnectionHook();

    await act(async () => {
      await view.connection.handleConnect(
        vi.fn(),
        vi.fn(),
        vi.fn(),
        endpoint,
        undefined,
        'stateful'
      );
    });

    expect(connectionMocks.attempt).toHaveBeenLastCalledWith(
      endpoint,
      expect.anything(),
      'stateful-token',
      undefined,
      false,
      'stateful',
      expect.any(Function)
    );
    expect(getStoredOAuthTrace(endpoint, sessionStorage)?.events).toEqual(expect.arrayContaining([
      expect.objectContaining({
        type: 'mcp_retry',
        outcome: 'succeeded',
        response: expect.objectContaining({
          metadata: expect.objectContaining({
            protocolEra: 'stateful',
            protocolEraHint: 'stateful',
          }),
        }),
      }),
    ]));
    view.unmount();
  });

  it.each([
    { label: 'stateful successful', hint: 'stateful' as const, succeeds: true },
    { label: 'stateless successful', hint: 'stateless' as const, succeeds: true },
    { label: 'stateful failed', hint: 'stateful' as const, succeeds: false },
    { label: 'stateless failed', hint: 'stateless' as const, succeeds: false },
  ])('preserves one redirect OAuth trace through a $label MCP retry', async ({ hint, succeeds }) => {
    const endpoint = `https://redirect-${hint || 'stateless'}-${succeeds ? 'success' : 'failure'}.example/mcp`;
    const issuer = `https://auth-${hint || 'stateless'}-${succeeds ? 'success' : 'failure'}.example/`;
    let callbackState = '';

    oauthMocks.begin.mockImplementationOnce(async (serverUrl, options) => (
      oauthMocks.actualBegin?.(serverUrl, {
        ...options,
        fetchFn: vi.fn().mockResolvedValue(new Response('{}', {
          status: 200,
          headers: { 'Content-Type': 'application/json' },
        })),
        authenticate: async (provider: BrowserOAuthProvider, authOptions: any) => {
          await authOptions.fetchFn(`${issuer}.well-known/oauth-authorization-server`);
          provider.saveDiscoveryState({
            authorizationServerUrl: issuer,
            authorizationServerMetadata: {
              issuer,
              authorization_endpoint: `${issuer}authorize`,
              token_endpoint: `${issuer}token`,
              response_types_supported: ['code'],
              code_challenge_methods_supported: ['S256'],
            },
          });
          callbackState = provider.state();
          provider.saveCodeVerifier('redirect-verifier-secret');
          const authorizationUrl = new URL(`${issuer}authorize`);
          authorizationUrl.searchParams.set('state', callbackState);
          authorizationUrl.searchParams.set('code_challenge', 'challenge-secret');
          await provider.redirectToAuthorization(authorizationUrl);
          return 'REDIRECT';
        },
        redirect: vi.fn(),
      })
    ));
    connectionMocks.attempt.mockRejectedValueOnce(new TransportConnectionError([
      new ProxiedAuthenticationError(
        401,
        'target',
        new Error('Authorization required'),
        { method: 'POST', url: endpoint }
      ),
    ]));

    const beforeRedirect = renderConnectionHook();
    await act(async () => {
      await beforeRedirect.connection.handleConnect(
        vi.fn(),
        vi.fn(),
        vi.fn(),
        endpoint,
        undefined,
        hint
      );
    });
    expect(getStoredOAuthTrace(endpoint, sessionStorage)).toMatchObject({
      authenticatedMcpRetry: { phase: 'awaiting_callback' },
    });
    beforeRedirect.unmount();

    await completeOAuthFlow(
      `https://mcptest.io/oauth/callback?code=redirect-code-secret&state=${callbackState}&iss=${encodeURIComponent(issuer)}`,
      {
        fetchFn: vi.fn().mockResolvedValue(new Response(JSON.stringify({
          access_token: 'redirect-access-secret',
          token_type: 'Bearer',
        }), {
          status: 200,
          headers: { 'Content-Type': 'application/json' },
        })),
        authenticate: async (provider: BrowserOAuthProvider, authOptions: any) => {
          await authOptions.fetchFn(`${issuer}token`, {
            method: 'POST',
            body: new URLSearchParams({
              grant_type: 'authorization_code',
              code: 'redirect-code-secret',
            }),
          });
          provider.saveTokens(
            { access_token: 'redirect-access-secret', token_type: 'Bearer', issuer },
            { issuer }
          );
          return 'AUTHORIZED';
        },
        redirect: vi.fn(),
      }
    );
    expect(getStoredOAuthTrace(endpoint, sessionStorage)).toMatchObject({
      authenticatedMcpRetry: { phase: 'pending' },
    });

    const observedRetry = {
      method: 'POST',
      url: `${endpoint}?operation=initialize`,
      candidateUrl: endpoint,
      transportType: 'streamable-http' as const,
      startedAt: '2026-08-11T16:00:00.000Z',
      durationMs: 17,
      status: succeeds ? 200 : 502,
      outcome: succeeds ? 'succeeded' as const : 'failed' as const,
    };
    connectionMocks.attempt.mockImplementationOnce(async (...args: any[]) => {
      args[6]?.(observedRetry);
      if (!succeeds) throw new Error('Authenticated MCP negotiation failed');
      return {
        client: { close: vi.fn().mockResolvedValue(undefined) },
        url: endpoint,
        transportType: 'streamable-http',
        protocolEra: hint === 'stateful' ? 'stateful' : 'modern',
        protocolVersion: hint === 'stateful' ? '2025-11-25' : '2026-07-28',
        observedRequests: [observedRetry],
      };
    });

    const afterCallback = renderConnectionHook();
    await act(async () => {
      await afterCallback.connection.handleConnect(
        vi.fn(),
        vi.fn(),
        vi.fn(),
        endpoint,
        undefined,
        hint
      );
    });

    const trace = getStoredOAuthTrace(endpoint, sessionStorage);
    expect(trace?.events.map(({ type }) => type)).toEqual([
      'target_challenge',
      'authorization_server_metadata',
      'protected_resource_metadata',
      'client_establishment',
      'pkce',
      'authorization_redirect',
      'callback',
      'token_exchange',
      'mcp_retry',
      'terminal_outcome',
    ]);
    expect(trace?.events.map(({ sequence }) => sequence).every(
      (sequence, index) => sequence === index + 1
    )).toBe(true);
    expect(trace?.events.find(({ type }) => type === 'mcp_retry')).toMatchObject({
      outcome: succeeds ? 'succeeded' : 'failed',
      route: 'direct',
      request: { method: 'POST', url: `${endpoint}?operation=initialize` },
      response: {
        status: succeeds ? 200 : 502,
        metadata: expect.objectContaining({
          protocolEraHint: hint,
        }),
      },
      timing: {
        startedAt: '2026-08-11T16:00:00.000Z',
        durationMs: 17,
      },
    });
    expect(trace?.outcome?.status).toBe(succeeds ? 'authorized' : 'failed');
    if (!succeeds) {
      expect(trace?.outcome?.explanation).toContain('authenticated MCP retry failed');
      expect(trace?.outcome?.explanation).toContain('HTTP 502');
    }
    expect(trace?.authenticatedMcpRetry).toBeUndefined();
    expect(JSON.stringify(trace)).not.toContain('redirect-code-secret');
    expect(JSON.stringify(trace)).not.toContain('redirect-access-secret');
    afterCallback.unmount();

    const retryEventCount = trace?.events.filter(({ type }) => type === 'mcp_retry').length;
    connectionMocks.attempt.mockImplementationOnce(async (...args: any[]) => {
      args[6]?.({ method: 'POST', url: endpoint, status: 200, outcome: 'succeeded' });
      return {
        client: { close: vi.fn().mockResolvedValue(undefined) },
        url: endpoint,
        transportType: 'streamable-http',
        protocolEra: 'modern',
      };
    });
    const ordinaryTokenConnection = renderConnectionHook();
    await act(async () => {
      await ordinaryTokenConnection.connection.handleConnect(
        vi.fn(),
        vi.fn(),
        vi.fn(),
        endpoint
      );
    });
    expect(getStoredOAuthTrace(endpoint, sessionStorage)?.events.filter(
      ({ type }) => type === 'mcp_retry'
    )).toHaveLength(retryEventCount || 0);
    ordinaryTokenConnection.unmount();
  });

  it('shows manual client configuration only after challenge-driven automatic OAuth fails', async () => {
    const endpoint = 'https://manual-client.example/mcp';
    connectionMocks.attempt.mockRejectedValueOnce(new TransportConnectionError([
      new ProxiedAuthenticationError(
        401,
        'target',
        new Error('The MCP target requires authorization')
      )
    ]));
    oauthMocks.begin.mockRejectedValueOnce(
      new Error('authorization server does not support dynamic client registration')
    );
    const view = renderConnectionHook();

    await act(async () => {
      await view.connection.handleConnect(vi.fn(), vi.fn(), vi.fn(), endpoint);
    });

    expect(connectionMocks.attempt).toHaveBeenCalledOnce();
    expect(oauthMocks.begin).toHaveBeenCalledOnce();
    expect(view.connection.needsOAuthConfig).toBe(true);
    expect(view.connection.oauthConfigServerUrl).toBe(endpoint);
    expect(view.connection.connectionStatus).toBe('Authorization required');
    view.unmount();
  });

  it('passes exact challenge metadata and scope into OAuth discovery without serializing them', async () => {
    const endpoint = 'https://challenge.example/mcp/';
    const metadataUrl = 'https://challenge.example/.well-known/oauth-protected-resource/mcp/?token=challenge-secret';
    oauthMocks.begin.mockResolvedValueOnce('REDIRECT');
    connectionMocks.attempt.mockRejectedValueOnce(new TransportConnectionError([
      new ProxiedAuthenticationError(
        401,
        'target',
        new Error('Authorization required'),
        { method: 'POST', url: endpoint },
        { 'www-authenticate': 'Bearer resource_metadata="[sanitized]"' },
        metadataUrl,
        'channels:read chat:write'
      ),
    ]));
    const view = renderConnectionHook();

    await act(async () => {
      await view.connection.handleConnect(vi.fn(), vi.fn(), vi.fn(), endpoint);
    });

    expect(oauthMocks.begin).toHaveBeenCalledWith(endpoint, expect.objectContaining({
      resourceMetadataUrl: metadataUrl,
      scope: 'channels:read chat:write',
    }));
    const trace = getStoredOAuthTrace(endpoint, sessionStorage);
    expect(JSON.stringify(trace)).not.toContain('challenge-secret');
    view.unmount();
  });

  it('keeps discovery and token exchange direct outside the production origin', async () => {
    const endpoint = 'https://direct-discovery.example/mcp';
    const getIdToken = vi.fn().mockResolvedValue('proxy-session-token');
    vi.stubEnv('VITE_PROXY_URL', 'https://proxy.mcptest.test/');
    authMocks.currentUser = { getIdToken };
    oauthMocks.begin.mockResolvedValueOnce('REDIRECT');
    connectionMocks.attempt.mockRejectedValueOnce(new TransportConnectionError([
      new ProxiedAuthenticationError(
        401,
        'target',
        new Error('Authorization required')
      ),
    ]));
    const view = renderConnectionHook(undefined, false);

    await act(async () => {
      await view.connection.handleConnect(vi.fn(), vi.fn(), vi.fn(), endpoint);
    });

    expect(getIdToken).not.toHaveBeenCalled();
    expect(oauthMocks.begin).toHaveBeenCalledWith(endpoint, expect.not.objectContaining({
      discoveryProxy: expect.anything(),
    }));
    expect(oauthMocks.begin).toHaveBeenCalledWith(endpoint, expect.not.objectContaining({
      tokenProxy: expect.anything(),
    }));
    view.unmount();
  });

  it('does not launch target OAuth for a proxy-owned authentication failure', async () => {
    const endpoint = 'https://public.example/mcp';
    connectionMocks.attempt.mockRejectedValueOnce(new TransportConnectionError([
      new ProxiedAuthenticationError(
        401,
        'proxy',
        new Error('The proxy session expired')
      )
    ]));
    const view = renderConnectionHook();

    await act(async () => {
      await view.connection.handleConnect(vi.fn(), vi.fn(), vi.fn(), endpoint);
    });

    expect(oauthMocks.begin).not.toHaveBeenCalled();
    expect(view.connection.needsOAuthConfig).toBe(true);
    expect(view.connection.oauthPrerequisite).toMatchObject({
      kind: 'proxy_authentication_required',
    });
    expect(view.connection.connectionError).toBeNull();
    expect(getStoredOAuthTrace(endpoint, sessionStorage)).toMatchObject({
      outcome: { status: 'proxy_authentication_required' },
      events: expect.arrayContaining([expect.objectContaining({
        type: 'target_challenge',
        provenance: 'authenticated_proxy',
        route: 'proxy',
      })]),
    });
    view.unmount();
  });

  it.each([
    ['an expired grant', 401],
    ['a grant bound to the previous Firebase user in the same tab', 403],
  ] as const)('clears %s and surfaces hosted authorization again', async (_, rejectionStatus) => {
    const endpoint = 'https://mcp.slack.com/mcp';
    const proxyUrl = 'https://proxy.mcptest.test/';
    const grant = 'stored-hosted-grant';
    vi.stubEnv('VITE_PROXY_URL', proxyUrl);
    authMocks.currentUser = { getIdToken: vi.fn().mockResolvedValue('new-user-firebase-token') };
    storeHostedGrant(endpoint, grant);
    oauthMocks.begin.mockRejectedValueOnce(new OAuthPrerequisiteError({
      kind: 'pre_registered_client_required',
      serverUrl: endpoint,
      providerName: 'Slack',
      explanation: 'Slack requires the operator-owned confidential OAuth client.',
      issuer: 'https://mcp.slack.com',
      requiredScopes: ['channels:read'],
      pkceS256: true,
      publicClientSecretSupported: false,
      canConfigureClient: false,
      configurationMode: 'operator-confidential',
      hostedProvider: 'slack',
      hostedScope: 'channels:read',
    }));
    connectionMocks.attempt
      .mockRejectedValueOnce(new TransportConnectionError([
        new ProxiedAuthenticationError(
          rejectionStatus,
          'proxy',
          new Error('Hosted grant rejected'),
          undefined,
          { 'www-authenticate': 'HostedGrant error="invalid_token"' }
        ),
      ]))
      .mockRejectedValueOnce(new TransportConnectionError([
        new ProxiedAuthenticationError(
          401,
          'target',
          new Error('Slack authorization required')
        ),
      ]));
    const view = renderConnectionHook(undefined, true);

    await act(async () => {
      await view.connection.handleConnect(vi.fn(), vi.fn(), vi.fn(), endpoint);
    });

    expect(connectionMocks.attempt).toHaveBeenCalledTimes(2);
    expect(connectionMocks.attempt.mock.calls[0]).toEqual(expect.arrayContaining([
      `${proxyUrl}?target=${encodeURIComponent(endpoint)}`,
      expect.anything(),
      'new-user-firebase-token',
      expect.objectContaining({ 'X-MCP-Hosted-Grant': grant }),
      true,
    ]));
    expect(connectionMocks.attempt.mock.calls[1][0]).toBe(endpoint);
    expect(connectionMocks.attempt.mock.calls[1][3]).toBeUndefined();
    expect(loadHostedOAuthAuthorization(endpoint, sessionStorage)).toBeUndefined();
    expect(oauthMocks.begin).toHaveBeenCalledWith(endpoint, expect.objectContaining({
      deferAuthorizedTraceOutcome: true,
    }));
    expect(view.connection.needsOAuthConfig).toBe(true);
    expect(view.connection.oauthPrerequisite).toMatchObject({
      hostedProvider: 'slack',
      configurationMode: 'operator-confidential',
    });
    expect(view.connection.connectionStatus).toBe('Authorization prerequisite');
    view.unmount();
  });

  it('honors proxy opt-out after a clean-browser Slack CORS failure', async () => {
    const endpoint = 'https://mcp.slack.com/mcp';
    vi.stubEnv('VITE_PROXY_URL', 'https://proxy.mcptest.test/');
    connectionMocks.attempt.mockRejectedValueOnce(new TransportConnectionError([
      new TypeError('Failed to fetch'),
    ]));
    const view = renderConnectionHook(undefined, false);

    await act(async () => {
      await view.connection.handleConnect(vi.fn(), vi.fn(), vi.fn(), endpoint);
    });

    expect(connectionMocks.attempt).toHaveBeenCalledOnce();
    expect(oauthMocks.begin).not.toHaveBeenCalled();
    expect(view.connection.needsOAuthConfig).toBe(false);
    expect(view.connection.oauthPrerequisite).toBeNull();
    expect(view.connection.connectionError).toMatchObject({
      transportEvidence: 'streamable-http',
      expectedAuthentication: 'oauth',
      attempts: [expect.objectContaining({
        route: 'direct',
        candidateUrl: endpoint,
        failureKind: 'browser-unreadable',
        browserUnreadable: true,
      })],
    });
    view.unmount();
  });

  it('falls back to the proxy without a login and attaches no proxy token', async () => {
    const endpoint = 'https://mcp.slack.com/mcp';
    const proxyUrl = 'https://proxy.mcptest.test/';
    vi.stubEnv('VITE_PROXY_URL', proxyUrl);
    connectionMocks.attempt
      .mockRejectedValueOnce(new TransportConnectionError([new TypeError('Failed to fetch')]))
      .mockResolvedValueOnce({
        client: { close: vi.fn().mockResolvedValue(undefined) },
        url: `${proxyUrl}?target=${encodeURIComponent(endpoint)}`,
        transportType: 'streamable-http',
        protocolEra: 'modern',
      });
    const view = renderConnectionHook(undefined, true);

    await act(async () => {
      await view.connection.handleConnect(vi.fn(), vi.fn(), vi.fn(), endpoint);
    });

    expect(connectionMocks.attempt).toHaveBeenCalledTimes(2);
    expect(connectionMocks.attempt.mock.calls[1][0]).toBe(
      `${proxyUrl}?target=${encodeURIComponent(endpoint)}`
    );
    expect(connectionMocks.attempt.mock.calls[1][2]).toBeUndefined();
    expect(connectionMocks.attempt.mock.calls[1][4]).toBe(true);
    expect(view.connection.connectionStatus).toBe('Connected');
    expect(view.connection.oauthPrerequisite).toBeNull();
    expect(view.connection.connectionError).toBeNull();
    view.unmount();
  });

  it('shows a sign-in-to-lift message when the anonymous proxy limit is hit', async () => {
    const endpoint = 'https://mcp.slack.com/mcp';
    const proxyUrl = 'https://proxy.mcptest.test/';
    const proxyRequestUrl = `${proxyUrl}?target=${encodeURIComponent(endpoint)}`;
    const limitError = new Error('Streamable HTTP error: 429');
    vi.stubEnv('VITE_PROXY_URL', proxyUrl);
    connectionMocks.attempt
      .mockRejectedValueOnce(new TransportConnectionError([new TypeError('Failed to fetch')]))
      .mockRejectedValueOnce(new TransportConnectionError([limitError], [{
        candidateUrl: proxyRequestUrl,
        transportType: 'streamable-http',
        error: limitError,
        observedRequests: [{
          method: 'POST',
          url: proxyRequestUrl,
          status: 429,
          responseSource: 'proxy',
          proxyLimit: { tier: 'anonymous', retryAfterSeconds: 60 },
          outcome: 'failed',
        }],
      }]));
    const view = renderConnectionHook(undefined, true);
    const addLogEntry = view.addLogEntry;

    await act(async () => {
      await view.connection.handleConnect(vi.fn(), vi.fn(), vi.fn(), endpoint);
    });

    expect(oauthMocks.begin).not.toHaveBeenCalled();
    expect(view.connection.connectionStatus).toBe('Proxy limit reached');
    expect(view.connection.connectionError).toBeNull();
    expect(view.connection.needsOAuthConfig).toBe(true);
    expect(view.connection.oauthPrerequisite).toMatchObject({
      kind: 'proxy_limit_reached',
      explanation: expect.stringContaining('Sign in with Google to lift the limit'),
    });
    expect(addLogEntry).toHaveBeenCalledWith({
      type: 'warning',
      data: expect.stringContaining('Anonymous mcptest proxy limit reached'),
    });
    view.unmount();
  });

  it('uses the authenticated proxy after Slack direct attempts receive no HTTP response', async () => {
    const endpoint = 'https://mcp.slack.com/mcp';
    const proxyUrl = 'https://proxy.mcptest.test/';
    const getIdToken = vi.fn().mockResolvedValue('firebase-session-token');
    vi.stubEnv('VITE_PROXY_URL', proxyUrl);
    authMocks.currentUser = { getIdToken };
    connectionMocks.attempt
      .mockRejectedValueOnce(new TransportConnectionError([new TypeError('Failed to fetch')]))
      .mockResolvedValueOnce({
        client: { close: vi.fn().mockResolvedValue(undefined) },
        url: `${proxyUrl}?target=${encodeURIComponent(endpoint)}`,
        transportType: 'streamable-http',
        protocolEra: 'modern',
      });
    const view = renderConnectionHook(undefined, true);

    await act(async () => {
      await view.connection.handleConnect(vi.fn(), vi.fn(), vi.fn(), endpoint);
    });

    expect(connectionMocks.attempt).toHaveBeenCalledTimes(2);
    expect(connectionMocks.attempt.mock.calls[1]).toEqual(expect.arrayContaining([
      `${proxyUrl}?target=${encodeURIComponent(endpoint)}`,
      expect.anything(),
      'firebase-session-token',
      expect.any(Object),
      true,
    ]));
    expect(getIdToken).toHaveBeenCalledOnce();
    expect(view.connection.connectionStatus).toBe('Connected');
    expect(view.connection.connectionError).toBeNull();
    view.unmount();
  });

  it('retries the exact candidate after readable initialize and a later browser-unreadable request', async () => {
    const endpoint = 'https://gateway.mcpservers.org/yahoo-finance/mcp';
    const proxyUrl = 'https://proxy.mcptest.test/';
    const getIdToken = vi.fn().mockResolvedValue('firebase-session-token');
    const terminalError = new TypeError('Failed to fetch');
    const directError = new TransportConnectionError([terminalError], [{
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
    }]);
    vi.stubEnv('VITE_PROXY_URL', proxyUrl);
    authMocks.currentUser = { getIdToken };
    connectionMocks.attempt
      .mockRejectedValueOnce(directError)
      .mockResolvedValueOnce({
        client: { close: vi.fn().mockResolvedValue(undefined) },
        url: `${proxyUrl}?target=${encodeURIComponent(endpoint)}`,
        transportType: 'streamable-http',
        protocolEra: 'stateful',
        protocolVersion: '2025-11-25',
      });
    const view = renderConnectionHook({ 'X-Target-Tenant': 'finance' }, true);

    await act(async () => {
      await view.connection.handleConnect(
        vi.fn(), vi.fn(), vi.fn(), endpoint, undefined, 'stateful', 'streamable-http'
      );
    });

    expect(connectionMocks.attempt).toHaveBeenCalledTimes(2);
    expect(connectionMocks.attempt.mock.calls[1]).toEqual([
      `${proxyUrl}?target=${encodeURIComponent(endpoint)}`,
      expect.any(AbortSignal),
      'firebase-session-token',
      { 'X-Target-Tenant': 'finance' },
      true,
      'stateful',
      expect.any(Function),
      'streamable-http',
    ]);
    expect(view.connection.connectionStatus).toBe('Connected');
    view.unmount();
  });

  it('retries the same mid-handshake failure through the proxy without a login', async () => {
    const endpoint = 'https://gateway.mcpservers.org/yahoo-finance/mcp';
    const proxyUrl = 'https://proxy.mcptest.test/';
    const terminalError = new TypeError('Failed to fetch');
    vi.stubEnv('VITE_PROXY_URL', proxyUrl);
    connectionMocks.attempt
      .mockRejectedValueOnce(new TransportConnectionError(
        [terminalError],
        [{
          candidateUrl: endpoint,
          transportType: 'streamable-http',
          error: terminalError,
          observedRequests: [
            { method: 'POST', mcpMethod: 'initialize', url: endpoint, status: 200, outcome: 'succeeded' },
            { method: 'POST', mcpMethod: 'notifications/initialized', url: endpoint, outcome: 'failed' },
          ],
        }]
      ))
      .mockResolvedValueOnce({
        client: { close: vi.fn().mockResolvedValue(undefined) },
        url: `${proxyUrl}?target=${encodeURIComponent(endpoint)}`,
        transportType: 'streamable-http',
        protocolEra: 'stateful',
      });
    const view = renderConnectionHook(undefined, true);

    await act(async () => {
      await view.connection.handleConnect(vi.fn(), vi.fn(), vi.fn(), endpoint);
    });

    expect(connectionMocks.attempt).toHaveBeenCalledTimes(2);
    expect(view.connection.connectionStatus).toBe('Connected');
    expect(view.connection.oauthPrerequisite).toBeNull();
    expect(view.connection.connectionError).toBeNull();
    view.unmount();
  });

  it('does not replace an explicit API credential with OAuth discovery', async () => {
    const endpoint = 'https://api-key.example/mcp';
    connectionMocks.attempt.mockRejectedValueOnce(new TransportConnectionError([
      new ProxiedAuthenticationError(
        401,
        'target',
        new Error('The API key was rejected')
      )
    ]));
    const view = renderConnectionHook({ 'X-API-Key': 'incorrect-key' });

    await act(async () => {
      await view.connection.handleConnect(vi.fn(), vi.fn(), vi.fn(), endpoint);
    });

    expect(oauthMocks.begin).not.toHaveBeenCalled();
    expect(view.connection.needsOAuthConfig).toBe(false);
    view.unmount();
  });
});
