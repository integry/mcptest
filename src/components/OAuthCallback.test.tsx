import React, { act } from 'react';
import { createRoot, type Root } from 'react-dom/client';
import { afterEach, beforeAll, beforeEach, describe, expect, it, vi } from 'vitest';

const routerMocks = vi.hoisted(() => ({ navigate: vi.fn() }));
const oauthMocks = vi.hoisted(() => ({
  completeHosted: vi.fn(),
  completeManual: vi.fn(),
}));
const currentUser = { getIdToken: vi.fn() };

vi.mock('react-router-dom', async (importOriginal) => {
  const actual = await importOriginal<typeof import('react-router-dom')>();
  return {
    ...actual,
    useLocation: () => ({ pathname: '/oauth/callback', search: '?hosted_result=opaque-result' }),
    useNavigate: () => routerMocks.navigate,
  };
});

vi.mock('../context/AuthContext', () => ({
  useAuth: () => ({ currentUser, loading: false }),
}));

vi.mock('../utils/hostedOAuth', () => ({
  completeHostedOAuthFlow: oauthMocks.completeHosted,
}));

vi.mock('../utils/oauthFlow', () => ({
  completeOAuthFlow: oauthMocks.completeManual,
}));

import OAuthCallback from './OAuthCallback';

beforeAll(() => {
  (
    globalThis as typeof globalThis & { IS_REACT_ACT_ENVIRONMENT: boolean }
  ).IS_REACT_ACT_ENVIRONMENT = true;
});

let root: Root | undefined;

describe('hosted OAuth callback return views', () => {
  beforeEach(() => {
    sessionStorage.clear();
    vi.stubEnv('VITE_PROXY_URL', 'https://proxy.mcptest.test/');
    routerMocks.navigate.mockReset();
    currentUser.getIdToken.mockReset().mockResolvedValue('firebase-token');
    oauthMocks.completeHosted.mockReset().mockResolvedValue({
      serverUrl: 'https://api.githubcopilot.com/mcp/',
      issuer: 'https://github.com/login/oauth',
    });
    oauthMocks.completeManual.mockReset();
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
    });
  };

  it('returns hosted completion to the originating report', async () => {
    const serverUrl = 'https://api.githubcopilot.com/mcp/';
    sessionStorage.setItem('oauth_return_view', JSON.stringify({
      activeView: 'report',
      serverUrl,
    }));

    await renderCallback();

    expect(oauthMocks.completeHosted).toHaveBeenCalledOnce();
    expect(oauthMocks.completeManual).not.toHaveBeenCalled();
    expect(routerMocks.navigate).toHaveBeenCalledWith(
      `/report/${encodeURIComponent(serverUrl)}`,
      {
        state: { oauthSuccess: true, fromOAuthReturn: true, serverUrl },
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

    expect(oauthMocks.completeHosted).toHaveBeenCalledOnce();
    expect(oauthMocks.completeManual).not.toHaveBeenCalled();
    expect(routerMocks.navigate).toHaveBeenCalledWith('/', {
      state: { oauthSuccess: true },
      replace: true,
    });
    expect(JSON.parse(sessionStorage.getItem('oauth_return_view') || 'null')).toEqual({
      activeView: 'playground',
      activeTabId: 'playground-tab-2',
    });
  });
});
