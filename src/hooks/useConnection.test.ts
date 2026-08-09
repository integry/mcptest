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

beforeAll(() => {
  (
    globalThis as typeof globalThis & { IS_REACT_ACT_ENVIRONMENT: boolean }
  ).IS_REACT_ACT_ENVIRONMENT = true;
});

const renderConnectionHook = (useOAuth = false) => {
  let connection: ReturnType<typeof useConnection> | undefined;
  const container = document.createElement('div');
  const root: Root = createRoot(container);
  const addLogEntry = vi.fn();

  const Probe = () => {
    connection = useConnection(addLogEntry, false, useOAuth);
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
    expect(connectionMocks.attempt.mock.calls[0][0]).toBe(endpoint.toString());
    expect(connectionMocks.attempt.mock.calls[0][4]).toBe(false);
    expect(view.connection.serverUrl).toBe(endpoint.toString());
    expect(view.connection.connectionStatus).toBe('Connected');
    expect(JSON.parse(localStorage.getItem('mcpRecentServers') || '[]')).toContainEqual({
      url: endpoint.toString(),
    });
    view.unmount();
  });

  it('authorizes through the SDK and uses the token for the requested endpoint', async () => {
    const endpoint = 'https://secure.example/custom/mcp';
    oauthMocks.begin.mockImplementationOnce(async () => {
      sessionStorage.setItem('oauth_access_token_secure.example', 'sdk-token');
      return 'AUTHORIZED';
    });
    connectionMocks.attempt.mockResolvedValueOnce({
      client: { close: vi.fn().mockResolvedValue(undefined) },
      url: endpoint,
      transportType: 'streamable-http',
      protocolEra: 'modern',
    });
    const view = renderConnectionHook(true);

    await act(async () => {
      await view.connection.handleConnect(vi.fn(), vi.fn(), vi.fn(), endpoint);
    });

    expect(oauthMocks.begin).toHaveBeenCalledWith(endpoint);
    expect(connectionMocks.attempt).toHaveBeenCalledWith(
      endpoint,
      expect.anything(),
      'sdk-token',
      undefined,
      false
    );
    expect(view.connection.connectionStatus).toBe('Connected');
    view.unmount();
  });
});
