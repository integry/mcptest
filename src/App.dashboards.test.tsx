import React, { act } from 'react';
import { createRoot, type Root } from 'react-dom/client';
import { MemoryRouter, useLocation } from 'react-router-dom';
import { afterEach, beforeAll, beforeEach, describe, expect, it, vi } from 'vitest';

vi.mock('./utils/analytics', async (importOriginal) => {
  const actual = await importOriginal<typeof import('./utils/analytics')>();
  return { ...actual, trackEvent: vi.fn(), logPageView: vi.fn() };
});

import App from './App';
import { AuthProvider } from './context/AuthContext';

let root: Root | undefined;
let container: HTMLDivElement;
let currentPath = '';

const LocationProbe = () => {
  currentPath = useLocation().pathname;
  return null;
};

const mount = async (path: string) => {
  root = createRoot(container);
  await act(async () => root!.render(
    <MemoryRouter initialEntries={[path]}>
      <AuthProvider>
        <App />
        <LocationProbe />
      </AuthProvider>
    </MemoryRouter>
  ));
};

const sidebar = () => container.querySelector('.desktop-sidebar .app-sidenav')!;
const dashboardNames = () => Array.from(sidebar().querySelectorAll('.dashboard-name'), name => name.textContent);

describe('App dashboards for new and existing visitors', () => {
  beforeAll(() => {
    (globalThis as typeof globalThis & { IS_REACT_ACT_ENVIRONMENT: boolean }).IS_REACT_ACT_ENVIRONMENT = true;
  });

  beforeEach(() => {
    localStorage.clear();
    sessionStorage.clear();
    vi.spyOn(console, 'log').mockImplementation(() => {});
    container = document.createElement('div');
    document.body.appendChild(container);
  });

  afterEach(() => {
    act(() => root?.unmount());
    root = undefined;
    container.remove();
    vi.restoreAllMocks();
  });

  it('does not save or show a default dashboard for a new visitor', async () => {
    await mount('/catalog');
    expect(dashboardNames()).toEqual([]);
    expect(sidebar().querySelector('.sidenav-dashboards a')?.getAttribute('href')).toBe('/space');
    expect(JSON.parse(localStorage.getItem('mcpSpaces') ?? 'null')).toEqual([]);
  });

  it('drops the untouched default an earlier version saved, and keeps dashboards the visitor made', async () => {
    localStorage.setItem('mcpSpaces', JSON.stringify([{ id: 'default', name: 'My first dashboard', cards: [] }]));
    await mount('/catalog');
    expect(dashboardNames()).toEqual([]);
    act(() => root?.unmount());
    root = undefined;

    localStorage.setItem('mcpSpaces', JSON.stringify([
      { id: 'default', name: 'My first dashboard', cards: [] },
      { id: '2', name: 'Staging', cards: [] },
    ]));
    await mount('/catalog');
    expect(dashboardNames()).toEqual(['My first dashboard', 'Staging']);
  });

  it('explains dashboards on /space and creates the first one from there', async () => {
    await mount('/space');
    const page = container.querySelector('.view-panel:not(.d-none) .dashboards-home')!;
    expect(page.querySelector('h1')?.textContent).toBe('Dashboards');
    expect(document.title).toBe('Dashboards | mcptest.io');
    expect(sidebar().querySelector('.sidenav-dashboards a')?.getAttribute('aria-current')).toBe('page');

    await act(async () => page.querySelector<HTMLButtonElement>('button[type="submit"]')!.click());
    expect(currentPath).toBe('/space/my-first-dashboard');
    expect(dashboardNames()).toEqual(['My first dashboard']);
    // DashboardsView is a lazy chunk.
    await vi.waitFor(async () => {
      await act(async () => {});
      expect(container.querySelector('.view-panel:not(.d-none) h2')?.textContent).toBe('My first dashboard');
    }, { timeout: 5000 });
  });

  it('sends a link to a dashboard the visitor does not have to the dashboards page', async () => {
    await mount('/space/my-first-dashboard');
    expect(currentPath).toBe('/space');
    expect(container.querySelector('.view-panel:not(.d-none) .dashboards-home')).not.toBeNull();
  });
});
