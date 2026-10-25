import React, { act } from 'react';
import { createRoot, type Root } from 'react-dom/client';
import { MemoryRouter } from 'react-router-dom';
import { afterEach, beforeAll, beforeEach, describe, expect, it, vi } from 'vitest';

// Firebase is a lazily loaded chunk; the mock resolves its runtime on demand
// and reports the auth state only when the test calls back.
const authMocks = vi.hoisted(() => ({
  listener: null as null | ((user: unknown) => void),
  loads: 0,
}));

vi.mock('./firebase', async (importOriginal) => {
  const actual = await importOriginal<typeof import('./firebase')>();
  return {
    ...actual,
    loadFirebase: vi.fn(async () => {
      authMocks.loads += 1;
      return {
        app: null,
        auth: {},
        analytics: null,
        GoogleAuthProvider: class {},
        logEvent: vi.fn(),
        onAuthStateChanged: (_auth: unknown, listener: (user: unknown) => void) => {
          authMocks.listener = listener;
          return () => {};
        },
        signInWithPopup: vi.fn(),
        signOut: vi.fn(),
      };
    }),
  };
});
vi.mock('./utils/analytics', async (importOriginal) => {
  const actual = await importOriginal<typeof import('./utils/analytics')>();
  return { ...actual, trackEvent: vi.fn(), logPageView: vi.fn() };
});

import App from './App';
import { AuthProvider } from './context/AuthContext';
import { AUTH_SESSION_HINT_KEY } from './firebase';
import { preloadViewsForPath } from './views/deferredViews';

beforeAll(async () => {
  (
    globalThis as typeof globalThis & { IS_REACT_ACT_ENVIRONMENT: boolean }
  ).IS_REACT_ACT_ENVIRONMENT = true;
  // main.tsx fetches the playground chunk before mounting on "/".
  await preloadViewsForPath('/');
});

let root: Root | undefined;
let container: HTMLDivElement;

const snapshot = () => ({
  header: Boolean(container.querySelector('.app-header')),
  sidebarLinks: Array.from(
    container.querySelectorAll('.desktop-sidebar .app-sidenav .sidenav-group:first-child .sidenav-list > .nav-item > a.nav-link'),
    link => link.textContent?.trim()
  ),
  dashboards: Array.from(
    container.querySelectorAll('.desktop-sidebar .dashboard-name'),
    name => name.textContent
  ),
  tabs: Array.from(container.querySelectorAll('.playground-tabs-wrapper [role="tab"]'), tab => tab.textContent),
  landing: container.querySelector('.view-panel:not(.d-none) .landing-title')?.textContent,
  connectionPanel: Boolean(container.querySelector('.view-panel:not(.d-none) .connection-console')),
});

const mount = () => {
  root = createRoot(container);
  act(() => root!.render(
    <MemoryRouter initialEntries={['/']}>
      <AuthProvider>
        <App />
      </AuthProvider>
    </MemoryRouter>
  ));
};

const FIRST_FRAME = {
  header: true,
  sidebarLinks: ['Playground', 'Catalog', 'Reports', 'Breaking changes', 'Discovery check'],
  dashboards: ['My first dashboard'],
  tabs: ['New Connection'],
  landing: 'Inspect, debug and evaluate remote MCP servers in your browser',
  connectionPanel: false,
};

describe('App first render', () => {
  beforeEach(() => {
    localStorage.clear();
    sessionStorage.clear();
    authMocks.listener = null;
    authMocks.loads = 0;
    vi.spyOn(console, 'log').mockImplementation(() => {});
    vi.stubEnv('VITE_FIREBASE_AUTH_ENABLED', 'true');
    container = document.createElement('div');
    document.body.appendChild(container);
  });

  afterEach(() => {
    act(() => root?.unmount());
    root = undefined;
    container.remove();
    vi.unstubAllEnvs();
    vi.restoreAllMocks();
  });

  it('renders the shell and landing for a new visitor, then settles signed out without loading Firebase', async () => {
    mount();

    const firstFrame = snapshot();
    expect(firstFrame).toEqual(FIRST_FRAME);
    const landingInput = container.querySelector('.view-panel:not(.d-none) #serverUrl');
    await act(async () => {});

    // Signed out: same frame, same mounted input, sign-in button in the placeholder's place.
    expect(snapshot()).toEqual(firstFrame);
    expect(container.querySelector('.view-panel:not(.d-none) #serverUrl')).toBe(landingInput);
    expect(container.querySelector('.app-header .app-auth-placeholder')).toBeNull();
    expect(container.querySelector('.app-header')?.textContent).toContain('Login with Google');
    expect(authMocks.loads, 'the Firebase chunk is not fetched for a new visitor').toBe(0);
  });

  it('keeps saved tabs and the workspace from the first commit through delayed signed-out auth', async () => {
    localStorage.setItem(AUTH_SESSION_HINT_KEY, '1');
    // Tabs must survive even when no dashboards have been saved.
    localStorage.setItem('mcpConnectionTabs', JSON.stringify([
      { id: 'default-tab', title: 'New Connection', serverUrl: '', connectionStatus: 'Disconnected' },
      { id: 'server', title: 'mcp.context7.com', serverUrl: 'https://mcp.context7.com/mcp', connectionStatus: 'Connected' },
    ]));
    localStorage.setItem('mcpRecentServers', JSON.stringify([{ url: 'https://mcp.context7.com/mcp' }]));
    mount();
    const first = snapshot();
    expect(first).toMatchObject({ landing: undefined, connectionPanel: true, tabs: ['New Connection', 'mcp.context7.com'] });
    await act(async () => {});
    expect(snapshot()).toEqual(first);
    act(() => authMocks.listener!(null));
    await act(async () => {});
    expect(snapshot()).toEqual(first);
    expect(JSON.parse(localStorage.getItem('mcpConnectionTabs')!)).toHaveLength(2);
  });

  it('renders the shell and landing while a remembered session loads, and keeps them when auth resolves', async () => {
    localStorage.setItem(AUTH_SESSION_HINT_KEY, '1');
    mount();

    const whileLoading = snapshot();
    expect(whileLoading).toEqual(FIRST_FRAME);
    // The sign-in control holds its place without offering a stale action.
    expect(container.querySelector('.app-header .app-auth-placeholder')).not.toBeNull();
    expect(container.querySelector('.app-header')?.textContent).not.toContain('Logout');

    const landingInput = container.querySelector('.view-panel:not(.d-none) #serverUrl');
    // The Firebase chunk arrives and subscribes; the frame does not change.
    await act(async () => {});
    expect(authMocks.loads).toBe(1);
    expect(authMocks.listener).toBeTypeOf('function');
    expect(snapshot()).toEqual(whileLoading);
    expect(container.querySelector('.app-header .app-auth-placeholder')).not.toBeNull();

    act(() => authMocks.listener!(null));

    // Signed out: same frame, same mounted input, sign-in button in the placeholder's place.
    expect(snapshot()).toEqual(whileLoading);
    expect(container.querySelector('.view-panel:not(.d-none) #serverUrl')).toBe(landingInput);
    expect(container.querySelector('.app-header .app-auth-placeholder')).toBeNull();
    expect(container.querySelector('.app-header')?.textContent).toContain('Login with Google');
    expect(localStorage.getItem(AUTH_SESSION_HINT_KEY), 'a signed-out report clears the session hint').toBeNull();
  });
});
