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
import { BrowserOAuthProvider } from '../utils/oauthFlow';
import { getStoredOAuthTrace } from '../utils/oauthTrace';
import {
  ProxiedAuthenticationError,
  TransportConnectionError,
} from '../utils/transportDetection';

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
    get connection() {
      if (!connection) throw new Error('Connection hook was not rendered');
      return connection;
    },
    unmount() {
      act(() => root.unmount());
    },
  };
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
          new Error('The MCP target requires authorization')
        )
      ]))
      .mockImplementationOnce(async (...args: any[]) => {
        args[6]?.({ method: 'POST', url: `${endpoint}/` });
        return successfulRetry;
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
        response: { status: 401 },
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
          metadata: expect.objectContaining({
            protocolEra: 'modern',
            protocolEraHint: 'automatic',
          }),
        }),
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
          { method: 'GET', url: observedProxyUrl }
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
      await view.connection.handleConnect(vi.fn(), vi.fn(), vi.fn(), endpoint);
    });

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
    expect(view.connection.needsOAuthConfig).toBe(false);
    expect(view.connection.connectionError).not.toBeNull();
    expect(getStoredOAuthTrace(endpoint, sessionStorage)).toMatchObject({
      outcome: { status: 'failed' },
      events: expect.arrayContaining([expect.objectContaining({
        type: 'target_challenge',
        provenance: 'authenticated_proxy',
        route: 'proxy',
      })]),
    });
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
