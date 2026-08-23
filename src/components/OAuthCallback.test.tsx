// @vitest-environment jsdom
// @vitest-environment-options {"url":"https://mcptest.io/oauth/callback"}

import React, { act } from 'react';
import { createRoot, type Root } from 'react-dom/client';
import { afterEach, beforeAll, beforeEach, describe, expect, it, vi } from 'vitest';

const callbackMocks = vi.hoisted(() => ({
  complete: vi.fn(),
  getIdToken: vi.fn(),
  navigate: vi.fn(),
}));
const authState = vi.hoisted(() => ({
  currentUser: null as null | { getIdToken: () => Promise<string> },
  loading: true,
}));

vi.mock('react-router-dom', () => ({
  useLocation: () => ({
    pathname: '/oauth/callback',
    search: '?code=restored-user-code&state=callback-state',
  }),
  useNavigate: () => callbackMocks.navigate,
}));

vi.mock('../context/AuthContext', () => ({
  useAuth: () => authState,
}));

vi.mock('../utils/oauthFlow', async (importOriginal) => {
  const actual = await importOriginal<typeof import('../utils/oauthFlow')>();
  return { ...actual, completeOAuthFlow: callbackMocks.complete };
});

import OAuthCallback from './OAuthCallback';
import { OAUTH_RECONNECT_REQUEST_KEY } from '../utils/oauthReconnect';

beforeAll(() => {
  (
    globalThis as typeof globalThis & { IS_REACT_ACT_ENVIRONMENT: boolean }
  ).IS_REACT_ACT_ENVIRONMENT = true;
});

let root: Root | undefined;

describe('OAuthCallback authentication restoration', () => {
  beforeEach(() => {
    sessionStorage.clear();
    vi.stubEnv('VITE_PROXY_URL', 'https://proxy.mcptest.test/');
    callbackMocks.complete.mockReset().mockResolvedValue({
      serverUrl: 'https://mcp.example/mcp',
    });
    callbackMocks.getIdToken.mockReset().mockResolvedValue('restored-firebase-token');
    callbackMocks.navigate.mockReset();
    authState.currentUser = null;
    authState.loading = true;
  });

  afterEach(() => {
    if (root) act(() => root?.unmount());
    root = undefined;
    vi.unstubAllEnvs();
    vi.restoreAllMocks();
  });

  it('waits for a signed-in user to be restored before completing the hosted callback', async () => {
    const container = document.createElement('div');
    root = createRoot(container);

    act(() => {
      root?.render(<OAuthCallback />);
    });

    expect(callbackMocks.complete).not.toHaveBeenCalled();

    authState.currentUser = { getIdToken: callbackMocks.getIdToken };
    act(() => {
      root?.render(<OAuthCallback />);
    });
    expect(callbackMocks.complete).not.toHaveBeenCalled();

    authState.loading = false;
    await act(async () => {
      root?.render(<OAuthCallback />);
      await Promise.resolve();
      await Promise.resolve();
    });

    expect(callbackMocks.getIdToken).toHaveBeenCalledOnce();
    expect(callbackMocks.complete).toHaveBeenCalledOnce();
    const [callbackUrl, options] = callbackMocks.complete.mock.calls[0];
    expect(callbackUrl.toString()).toBe(
      'https://mcptest.io/oauth/callback?code=restored-user-code&state=callback-state'
    );
    expect(options).toEqual({
      tokenProxy: {
        url: 'https://proxy.mcptest.test/',
        authorizationToken: 'restored-firebase-token',
      },
    });
    expect(callbackMocks.navigate).toHaveBeenCalledWith('/', {
      state: {
        oauthSuccess: true,
        authorizedServerUrl: 'https://mcp.example/mcp',
      },
      replace: true,
    });
    expect(JSON.parse(sessionStorage.getItem(OAUTH_RECONNECT_REQUEST_KEY) || '{}')).toEqual({
      serverUrl: 'https://mcp.example/mcp',
    });
    expect(sessionStorage.getItem(OAUTH_RECONNECT_REQUEST_KEY)).not.toContain(
      'restored-firebase-token'
    );
  });

  it.each([
    {
      label: 'dashboard',
      returnView: {
        activeView: 'dashboards',
        selectedSpaceId: 'space-1',
        selectedSpaceName: 'My Space',
      },
      path: '/space/my-space',
      state: {
        oauthSuccess: true,
        authorizedServerUrl: 'https://mcp.example/mcp',
        fromOAuthReturn: true,
        targetSpaceId: 'space-1',
      },
    },
    {
      label: 'report',
      returnView: {
        activeView: 'report',
        serverUrl: 'https://report-target.example/mcp',
      },
      path: '/report/https%3A%2F%2Freport-target.example%2Fmcp',
      state: {
        oauthSuccess: true,
        authorizedServerUrl: 'https://mcp.example/mcp',
        fromOAuthReturn: true,
        serverUrl: 'https://report-target.example/mcp',
      },
    },
  ])('preserves the saved $label return destination', async ({ returnView, path, state }) => {
    sessionStorage.setItem('oauth_return_view', JSON.stringify(returnView));
    authState.loading = false;
    const container = document.createElement('div');
    root = createRoot(container);

    await act(async () => {
      root?.render(<OAuthCallback />);
      await Promise.resolve();
      await Promise.resolve();
    });

    expect(callbackMocks.navigate).toHaveBeenCalledWith(path, {
      state,
      replace: true,
    });
  });

  it('uses navigation state when session storage cannot persist the reconnect request', async () => {
    vi.spyOn(Storage.prototype, 'setItem').mockImplementation(() => {
      throw new DOMException('Storage is unavailable', 'SecurityError');
    });
    authState.loading = false;
    const container = document.createElement('div');
    root = createRoot(container);

    await act(async () => {
      root?.render(<OAuthCallback />);
      await Promise.resolve();
      await Promise.resolve();
    });

    expect(callbackMocks.complete).toHaveBeenCalledOnce();
    expect(callbackMocks.navigate).toHaveBeenCalledWith('/', {
      state: {
        oauthSuccess: true,
        authorizedServerUrl: 'https://mcp.example/mcp',
      },
      replace: true,
    });
  });
});
