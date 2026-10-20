import React, { act } from 'react';
import { createRoot, type Root } from 'react-dom/client';
import { afterEach, beforeAll, beforeEach, describe, expect, it, vi } from 'vitest';

const connectionMocks = vi.hoisted(() => ({ attempt: vi.fn() }));
const oauthMocks = vi.hoisted(() => ({
  begin: vi.fn(),
  actualBegin: undefined as undefined | ((serverUrl: string, options?: any) => Promise<any>),
}));

vi.mock('../utils/transportDetection', async (importOriginal) => {
  const actual = await importOriginal<typeof import('../utils/transportDetection')>();
  return { ...actual, attemptParallelConnections: connectionMocks.attempt };
});

vi.mock('../context/AuthContext', () => ({
  useAuth: () => ({ currentUser: null, loading: false }),
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
  OAUTH_FORBIDDEN_EXPLANATION,
  loadOAuthAuthorization,
} from '../utils/oauthFlow';
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

const ENDPOINT = 'https://challenges.example/mcp';
const ISSUER = 'https://auth.challenges.example/';

const renderConnectionHook = () => {
  let connection: ReturnType<typeof useConnection> | undefined;
  const container = document.createElement('div');
  const root: Root = createRoot(container);
  const addLogEntry = vi.fn();
  const Probe = () => {
    connection = useConnection(addLogEntry, false);
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

const seedAuthorization = (refreshToken?: string) => {
  const provider = new BrowserOAuthProvider(ENDPOINT);
  provider.saveDiscoveryState({
    authorizationServerUrl: ISSUER,
    resourceMetadata: { resource: ENDPOINT, authorization_servers: [ISSUER] },
    authorizationServerMetadata: {
      issuer: ISSUER,
      authorization_endpoint: `${ISSUER}authorize`,
      token_endpoint: `${ISSUER}token`,
      response_types_supported: ['code'],
      code_challenge_methods_supported: ['S256'],
    },
  });
  provider.saveClientInformation({ client_id: 'public-client', issuer: ISSUER }, { issuer: ISSUER });
  provider.saveTokens({
    access_token: 'stored-access-token',
    token_type: 'Bearer',
    scope: 'read',
    ...(refreshToken ? { refresh_token: refreshToken } : {}),
  }, { issuer: ISSUER });
};

const targetChallenge = (status: 401 | 403, wwwAuthenticate?: string, scope?: string) => (
  new TransportConnectionError([
    new ProxiedAuthenticationError(
      status,
      'target',
      new Error(`MCP target returned HTTP ${status}`),
      { method: 'POST', url: ENDPOINT },
      wwwAuthenticate ? { 'www-authenticate': wwwAuthenticate } : undefined,
      undefined,
      scope
    ),
  ])
);

const connected = () => ({
  client: { close: vi.fn().mockResolvedValue(undefined) },
  url: ENDPOINT,
  transportType: 'streamable-http',
  protocolEra: 'modern',
});

describe('OAuth challenge handling during connection', () => {
  beforeEach(() => {
    vi.useFakeTimers();
    localStorage.clear();
    sessionStorage.clear();
    connectionMocks.attempt.mockReset();
    oauthMocks.begin.mockReset();
  });

  afterEach(() => {
    vi.clearAllTimers();
    vi.useRealTimers();
    vi.restoreAllMocks();
  });

  it('surfaces an authorized bare 403 once with its explanation and stops', async () => {
    seedAuthorization('stored-refresh-token');
    connectionMocks.attempt.mockRejectedValue(targetChallenge(403));
    const view = renderConnectionHook();

    await act(async () => {
      await view.connection.handleConnect(vi.fn(), vi.fn(), vi.fn(), ENDPOINT);
    });

    expect(connectionMocks.attempt).toHaveBeenCalledOnce();
    expect(oauthMocks.begin).not.toHaveBeenCalled();
    expect(view.connection.isAuthFlowActive).toBe(false);
    expect(view.connection.connectionStatus).not.toBe('Authorization required');
    expect(view.connection.connectionError?.error).toContain(OAUTH_FORBIDDEN_EXPLANATION);
    expect(getStoredOAuthTrace(ENDPOINT, sessionStorage)?.outcome).toMatchObject({
      status: 'failed',
      explanation: OAUTH_FORBIDDEN_EXPLANATION,
    });
    // The stored authorization is kept; nothing was silently retried or revoked.
    expect(loadOAuthAuthorization(ENDPOINT)?.accessToken).toBe('stored-access-token');
    view.unmount();
  });

  it('starts a step-up authorization for a 403 insufficient_scope challenge', async () => {
    seedAuthorization('stored-refresh-token');
    connectionMocks.attempt.mockRejectedValueOnce(targetChallenge(
      403,
      'Bearer error="insufficient_scope", scope="[REDACTED]"',
      'write'
    ));
    oauthMocks.begin.mockResolvedValueOnce('REDIRECT');
    const view = renderConnectionHook();

    await act(async () => {
      await view.connection.handleConnect(vi.fn(), vi.fn(), vi.fn(), ENDPOINT);
    });

    expect(oauthMocks.begin).toHaveBeenCalledOnce();
    const options = oauthMocks.begin.mock.calls[0][1];
    expect(options).toMatchObject({ stepUp: true, scope: 'write' });
    expect(options.refreshOnly).toBeUndefined();
    expect(view.connection.connectionError).toBeNull();
    view.unmount();
  });

  it('refreshes an expired token once and retries the connection once', async () => {
    seedAuthorization('stored-refresh-token');
    const refreshRequests: URLSearchParams[] = [];
    oauthMocks.begin.mockImplementationOnce((serverUrl, options) => oauthMocks.actualBegin!(serverUrl, {
      ...options,
      fetchFn: async (_input: unknown, init?: RequestInit) => {
        refreshRequests.push(new URLSearchParams(String(init?.body)));
        return new Response(JSON.stringify({
          access_token: 'refreshed-access-token',
          token_type: 'Bearer',
        }), { headers: { 'Content-Type': 'application/json' } });
      },
      redirect: () => { throw new Error('Refresh must not redirect'); },
    }));
    connectionMocks.attempt
      .mockRejectedValueOnce(targetChallenge(401, 'Bearer error="invalid_token"'))
      .mockRejectedValueOnce(targetChallenge(401, 'Bearer error="invalid_token"'));
    const view = renderConnectionHook();

    await act(async () => {
      await view.connection.handleConnect(vi.fn(), vi.fn(), vi.fn(), ENDPOINT);
    });

    expect(oauthMocks.begin).toHaveBeenCalledOnce();
    expect(oauthMocks.begin.mock.calls[0][1]).toMatchObject({ refreshOnly: true });
    expect(refreshRequests).toHaveLength(1);
    expect(refreshRequests[0].get('grant_type')).toBe('refresh_token');
    // One original attempt plus exactly one retry with the refreshed token.
    expect(connectionMocks.attempt).toHaveBeenCalledTimes(2);
    expect(connectionMocks.attempt.mock.calls[1][2]).toBe('refreshed-access-token');
    expect(view.connection.connectionError).not.toBeNull();
    view.unmount();
  });

  it('connects after a successful refresh', async () => {
    seedAuthorization('stored-refresh-token');
    oauthMocks.begin.mockImplementationOnce((serverUrl, options) => oauthMocks.actualBegin!(serverUrl, {
      ...options,
      fetchFn: async () => new Response(JSON.stringify({
        access_token: 'refreshed-access-token',
        token_type: 'Bearer',
      }), { headers: { 'Content-Type': 'application/json' } }),
    }));
    connectionMocks.attempt
      .mockRejectedValueOnce(targetChallenge(401))
      .mockResolvedValueOnce(connected());
    const view = renderConnectionHook();

    await act(async () => {
      await view.connection.handleConnect(vi.fn(), vi.fn(), vi.fn(), ENDPOINT);
    });

    expect(view.connection.connectionStatus).toBe('Connected');
    expect(connectionMocks.attempt.mock.calls[1][2]).toBe('refreshed-access-token');
    view.unmount();
  });

  it('prompts re-authorization with a reason when the refresh token is rejected', async () => {
    seedAuthorization('revoked-refresh-token');
    oauthMocks.begin.mockImplementationOnce((serverUrl, options) => oauthMocks.actualBegin!(serverUrl, {
      ...options,
      fetchFn: async () => new Response(JSON.stringify({ error: 'invalid_grant' }), {
        status: 400,
        headers: { 'Content-Type': 'application/json' },
      }),
      redirect: () => { throw new Error('A failed refresh must not redirect silently'); },
    }));
    connectionMocks.attempt.mockRejectedValueOnce(targetChallenge(401));
    const view = renderConnectionHook();

    await act(async () => {
      await view.connection.handleConnect(vi.fn(), vi.fn(), vi.fn(), ENDPOINT);
    });

    expect(connectionMocks.attempt).toHaveBeenCalledOnce();
    expect(view.connection.needsOAuthConfig).toBe(true);
    expect(view.connection.oauthPrerequisite).toMatchObject({
      kind: 'reauthorization_required',
      explanation: expect.stringContaining('invalid_grant'),
    });
    expect(loadOAuthAuthorization(ENDPOINT)).toBeUndefined();
    view.unmount();
  });

  it('re-authorizes without refresh when no refresh token is stored', async () => {
    seedAuthorization();
    oauthMocks.begin.mockResolvedValueOnce('REDIRECT');
    connectionMocks.attempt.mockRejectedValueOnce(targetChallenge(401));
    const view = renderConnectionHook();

    await act(async () => {
      await view.connection.handleConnect(vi.fn(), vi.fn(), vi.fn(), ENDPOINT);
    });

    expect(oauthMocks.begin.mock.calls[0][1]).toMatchObject({ forceReauthorization: true });
    expect(oauthMocks.begin.mock.calls[0][1].refreshOnly).toBeUndefined();
    view.unmount();
  });
});
