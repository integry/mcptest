import React, { act } from 'react';
import { createRoot, type Root } from 'react-dom/client';
import { afterEach, beforeAll, beforeEach, describe, expect, it, vi } from 'vitest';

const connectionMocks = vi.hoisted(() => ({ attempt: vi.fn() }));
const oauthMocks = vi.hoisted(() => ({ begin: vi.fn() }));

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
  return { ...actual, beginOAuthFlow: oauthMocks.begin };
});

import { useConnection } from './useConnection';
import { BrowserOAuthProvider } from '../utils/oauthFlow';
import {
  ProxiedAuthenticationError,
  TransportConnectionError,
} from '../utils/transportDetection';

beforeAll(() => {
  (
    globalThis as typeof globalThis & { IS_REACT_ACT_ENVIRONMENT: boolean }
  ).IS_REACT_ACT_ENVIRONMENT = true;
});

const renderConnectionHook = (requestHeaders?: Record<string, string>) => {
  let connection: ReturnType<typeof useConnection> | undefined;
  const container = document.createElement('div');
  const root: Root = createRoot(container);
  const addLogEntry = vi.fn();

  const Probe = () => {
    connection = useConnection(addLogEntry, false, undefined, requestHeaders);
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
  });

  afterEach(() => {
    vi.clearAllTimers();
    vi.useRealTimers();
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
    expect(JSON.parse(localStorage.getItem('mcpRecentServers') || '[]')).toContainEqual({
      url: endpoint.toString(),
    });
    view.unmount();
  });

  it('discovers OAuth only after the MCP target returns an authentication challenge', async () => {
    const endpoint = 'https://secure.example/custom/mcp';
    oauthMocks.begin.mockImplementationOnce(async () => {
      const issuer = 'https://auth-secure.example/';
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
    });
    connectionMocks.attempt
      .mockRejectedValueOnce(new TransportConnectionError([
        new ProxiedAuthenticationError(
          401,
          'target',
          new Error('The MCP target requires authorization')
        )
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

    expect(connectionMocks.attempt.mock.calls[0][2]).toBeUndefined();
    expect(oauthMocks.begin).toHaveBeenCalledWith(endpoint, {});
    expect(oauthMocks.begin.mock.invocationCallOrder[0]).toBeGreaterThan(
      connectionMocks.attempt.mock.invocationCallOrder[0]
    );
    expect(connectionMocks.attempt).toHaveBeenLastCalledWith(
      endpoint,
      expect.anything(),
      'sdk-token',
      undefined,
      false,
      undefined
    );
    expect(view.connection.connectionStatus).toBe('Connected');
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
