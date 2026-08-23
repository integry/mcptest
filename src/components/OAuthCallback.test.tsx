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
      state: { oauthSuccess: true },
      replace: true,
    });
  });
});
