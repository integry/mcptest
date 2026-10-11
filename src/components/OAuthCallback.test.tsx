// @vitest-environment jsdom
// @vitest-environment-options {"url":"https://mcptest.io/oauth/callback"}

import React, { act } from 'react';
import { createRoot, type Root } from 'react-dom/client';
import { afterEach, beforeAll, beforeEach, describe, expect, it, vi } from 'vitest';

const callbackMocks = vi.hoisted(() => ({
  complete: vi.fn(),
  completeHosted: vi.fn(),
  getIdToken: vi.fn(),
  navigate: vi.fn(),
}));
const authState = vi.hoisted(() => ({
  currentUser: null as null | { getIdToken: () => Promise<string> },
  loading: true,
}));
const locationState = vi.hoisted(() => ({
  search: '?code=restored-user-code&state=callback-state',
}));

vi.mock('react-router-dom', () => ({
  useLocation: () => ({
    pathname: '/oauth/callback',
    search: locationState.search,
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

vi.mock('../utils/hostedOAuth', async (importOriginal) => {
  const actual = await importOriginal<typeof import('../utils/hostedOAuth')>();
  return { ...actual, completeHostedOAuthFlow: callbackMocks.completeHosted };
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
    locationState.search = '?code=restored-user-code&state=callback-state';
    callbackMocks.completeHosted.mockReset().mockResolvedValue({
      serverUrl: 'https://api.githubcopilot.com/mcp/',
      issuer: 'https://github.com/login/oauth',
    });
  });

  afterEach(() => {
    if (root) act(() => root?.unmount());
    root = undefined;
    vi.unstubAllEnvs();
    vi.restoreAllMocks();
  });

  it('hands the discovered endpoint back without losing the initiating playground tab', async () => {
    sessionStorage.setItem('oauth_tab_id', 'originating-tab');
    sessionStorage.setItem('oauth_tabs_before_redirect', JSON.stringify([
      { id: 'originating-tab', serverUrl: 'https://mcp.sentry.dev/' },
      { id: 'other-tab', serverUrl: 'https://other.example/mcp' },
    ]));
    callbackMocks.complete.mockResolvedValueOnce({ serverUrl: 'https://mcp.sentry.dev/mcp' });
    authState.loading = false;
    root = createRoot(document.createElement('div'));
    await act(async () => { root?.render(<OAuthCallback />); });
    expect(callbackMocks.getIdToken).not.toHaveBeenCalled();
    expect(sessionStorage.getItem('oauth_tab_id')).toBe('originating-tab');
    expect(JSON.parse(sessionStorage.getItem('oauth_tabs_before_redirect') || '[]')[0].serverUrl)
      .toBe('https://mcp.sentry.dev/');
    expect(callbackMocks.navigate).toHaveBeenCalledWith('/', {
      replace: true, state: { oauthSuccess: true, authorizedServerUrl: 'https://mcp.sentry.dev/mcp' },
    });
    expect(JSON.parse(sessionStorage.getItem(OAUTH_RECONNECT_REQUEST_KEY) || '{}').serverUrl)
      .toBe('https://mcp.sentry.dev/mcp');
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

describe('hosted OAuth callback return views', () => {
  beforeEach(() => {
    sessionStorage.clear();
    vi.stubEnv('VITE_PROXY_URL', 'https://proxy.mcptest.test/');
    callbackMocks.navigate.mockReset();
    callbackMocks.complete.mockReset();
    callbackMocks.getIdToken.mockReset().mockResolvedValue('firebase-token');
    callbackMocks.completeHosted.mockReset().mockResolvedValue({
      serverUrl: 'https://api.githubcopilot.com/mcp/',
      issuer: 'https://github.com/login/oauth',
    });
    authState.currentUser = { getIdToken: callbackMocks.getIdToken };
    authState.loading = false;
    locationState.search = '?hosted_result=opaque-result';
  });

  afterEach(() => {
    if (root) act(() => root?.unmount());
    root = undefined;
    vi.unstubAllEnvs();
  });

  const renderCallback = async () => {
    const container = document.createElement('div');
    root = createRoot(container);
    await act(async () => {
      root?.render(<OAuthCallback />);
      await Promise.resolve();
      await Promise.resolve();
    });
  };

  it('returns hosted completion to the originating report', async () => {
    const serverUrl = 'https://api.githubcopilot.com/mcp/';
    sessionStorage.setItem('oauth_return_view', JSON.stringify({
      activeView: 'report',
      serverUrl,
    }));

    await renderCallback();

    expect(callbackMocks.completeHosted).toHaveBeenCalledOnce();
    expect(callbackMocks.complete).not.toHaveBeenCalled();
    expect(callbackMocks.navigate).toHaveBeenCalledWith(
      `/report/${encodeURIComponent(serverUrl)}`,
      {
        state: {
          oauthSuccess: true,
          authorizedServerUrl: serverUrl,
          fromOAuthReturn: true,
          serverUrl,
        },
        replace: true,
      }
    );
  });

  it('returns hosted completion to the originating playground tab context', async () => {
    sessionStorage.setItem('oauth_tab_id', 'playground-tab-2');
    sessionStorage.setItem('oauth_return_view', JSON.stringify({
      activeView: 'playground',
      activeTabId: 'playground-tab-2',
    }));

    await renderCallback();

    expect(callbackMocks.completeHosted).toHaveBeenCalledOnce();
    expect(callbackMocks.complete).not.toHaveBeenCalled();
    expect(callbackMocks.navigate).toHaveBeenCalledWith('/', {
      state: {
        oauthSuccess: true,
        authorizedServerUrl: 'https://api.githubcopilot.com/mcp/',
      },
      replace: true,
    });
    expect(JSON.parse(sessionStorage.getItem('oauth_return_view') || 'null')).toEqual({
      activeView: 'playground',
      activeTabId: 'playground-tab-2',
    });
  });
});
