import React, { act } from 'react';
import { createRoot, type Root } from 'react-dom/client';
import { MemoryRouter } from 'react-router-dom';
import { afterEach, beforeAll, beforeEach, describe, expect, it, vi } from 'vitest';

// Firebase reports the auth state only when the test calls back.
const authMocks = vi.hoisted(() => ({
  listener: null as null | ((user: unknown) => void),
}));

vi.mock('firebase/auth', () => ({
  onAuthStateChanged: vi.fn((_auth: unknown, listener: (user: unknown) => void) => {
    authMocks.listener = listener;
    return () => {};
  }),
  GoogleAuthProvider: class {},
  signInWithPopup: vi.fn(),
  signOut: vi.fn(),
}));
vi.mock('./firebase', () => ({ auth: {} }));
vi.mock('./utils/analytics', async (importOriginal) => {
  const actual = await importOriginal<typeof import('./utils/analytics')>();
  return { ...actual, logEvent: vi.fn(), logPageView: vi.fn() };
});

import App from './App';
import { AuthProvider } from './context/AuthContext';

beforeAll(() => {
  (
    globalThis as typeof globalThis & { IS_REACT_ACT_ENVIRONMENT: boolean }
  ).IS_REACT_ACT_ENVIRONMENT = true;
});

let root: Root | undefined;
let container: HTMLDivElement;

const snapshot = () => ({
  header: Boolean(container.querySelector('.app-header')),
  sidebarLinks: Array.from(
    container.querySelectorAll('.desktop-sidebar .app-sidenav > a.nav-link'),
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

describe('App first render', () => {
  beforeEach(() => {
    localStorage.clear();
    sessionStorage.clear();
    authMocks.listener = null;
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

  it('renders the shell and landing while auth is still loading, and keeps them when auth resolves', () => {
    root = createRoot(container);
    act(() => root!.render(
      <MemoryRouter initialEntries={['/']}>
        <AuthProvider>
          <App />
        </AuthProvider>
      </MemoryRouter>
    ));

    expect(authMocks.listener).toBeTypeOf('function');
    const whileLoading = snapshot();
    expect(whileLoading).toEqual({
      header: true,
      sidebarLinks: ['Playground', 'Server Catalog', 'Report'],
      dashboards: ['My first dashboard'],
      tabs: ['New Connection'],
      landing: 'Inspect, debug and evaluate remote MCP servers in your browser',
      connectionPanel: false,
    });
    // The sign-in control holds its place without offering a stale action.
    const placeholder = container.querySelector('.app-header .app-auth-placeholder');
    expect(placeholder).not.toBeNull();
    expect(container.querySelector('.app-header')?.textContent).not.toContain('Logout');

    const landingInput = container.querySelector('.view-panel:not(.d-none) #serverUrl');
    act(() => authMocks.listener!(null));

    // Signed out: same frame, same mounted input, sign-in button in the placeholder's place.
    expect(snapshot()).toEqual(whileLoading);
    expect(container.querySelector('.view-panel:not(.d-none) #serverUrl')).toBe(landingInput);
    expect(container.querySelector('.app-header .app-auth-placeholder')).toBeNull();
    expect(container.querySelector('.app-header')?.textContent).toContain('Login with Google');
  });
});
