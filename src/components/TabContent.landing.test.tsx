import React, { act } from 'react';
import { createRoot, type Root } from 'react-dom/client';
import { MemoryRouter } from 'react-router-dom';
import { afterEach, beforeAll, beforeEach, describe, expect, it, vi } from 'vitest';
import type { ConnectionTab } from '../types';

const connectionMocks = vi.hoisted(() => ({ attempt: vi.fn() }));

vi.mock('../utils/transportDetection', async (importOriginal) => {
  const actual = await importOriginal<typeof import('../utils/transportDetection')>();
  return { ...actual, attemptParallelConnections: connectionMocks.attempt };
});

vi.mock('../context/AuthContext', () => ({
  useAuth: () => ({ currentUser: null, loading: false, loginWithGoogle: vi.fn() }),
}));

vi.mock('../utils/analytics', () => ({ logEvent: vi.fn() }));

import TabContent from './TabContent';
import { selectLandingQuickPicks } from './LandingHero';
import { getCatalogServers } from '../utils/catalogUtils';
import { getPreferredCatalogEndpoint } from '../utils/clientSetup';
import { TransportConnectionError } from '../utils/transportDetection';

beforeAll(() => {
  (
    globalThis as typeof globalThis & { IS_REACT_ACT_ENVIRONMENT: boolean }
  ).IS_REACT_ACT_ENVIRONMENT = true;
});

const newTab: ConnectionTab = {
  id: 'new-tab',
  title: 'New Connection',
  serverUrl: '',
  connectionStatus: 'Disconnected',
  useProxy: false,
};

let root: Root | undefined;

const renderTab = (tab: ConnectionTab) => {
  const container = document.createElement('div');
  const onUpdateTab = vi.fn();
  root = createRoot(container);
  act(() => root!.render(
    <MemoryRouter>
      <TabContent
        tab={tab}
        isActive
        onUpdateTab={onUpdateTab}
        spaces={[]}
        onAddCardToSpace={vi.fn()}
      />
    </MemoryRouter>
  ));
  return { container, onUpdateTab };
};

const setInputValue = (input: HTMLInputElement, value: string) => {
  Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, 'value')?.set?.call(input, value);
  input.dispatchEvent(new Event('input', { bubbles: true }));
};

describe('playground landing', () => {
  beforeEach(() => {
    localStorage.clear();
    sessionStorage.clear();
    connectionMocks.attempt.mockReset();
    connectionMocks.attempt.mockRejectedValue(new TransportConnectionError([
      new TypeError('Failed to fetch'),
    ]));
  });

  afterEach(() => {
    act(() => root?.unmount());
    root = undefined;
  });

  it('renders the landing when there are no tabs with servers and no recent connections', () => {
    const { container } = renderTab(newTab);

    expect(container.querySelector('.landing')).not.toBeNull();
    expect(container.querySelector('.connection-console')).toBeNull();
    expect(container.querySelector('.playground-layout')).toBeNull();
    expect(container.querySelector('.suggested-servers-panel')).toBeNull();
  });

  it('keeps the landing while a first-time visitor types a URL', () => {
    const { container } = renderTab(newTab);

    act(() => setInputValue(container.querySelector<HTMLInputElement>('#serverUrl')!, 'https://example.com/mcp'));

    expect(container.querySelector('.landing')).not.toBeNull();
    expect(container.querySelector<HTMLInputElement>('#serverUrl')?.value).toBe('https://example.com/mcp');
  });

  it('renders the playground unchanged for returning users with recent connections', () => {
    localStorage.setItem('mcpRecentServers', JSON.stringify(['https://returning.example/mcp']));
    const { container } = renderTab(newTab);

    expect(container.querySelector('.landing')).toBeNull();
    expect(container.querySelector('.connection-console')).not.toBeNull();
    expect(container.querySelector('.playground-layout.playground-idle')).not.toBeNull();
    expect(container.querySelector('.recent-servers-panel, .awaiting-connection-panel')).not.toBeNull();
  });

  it('renders the playground unchanged for a tab that already has a server', () => {
    const { container } = renderTab({ ...newTab, id: 'existing', serverUrl: 'https://existing.example/mcp' });

    expect(container.querySelector('.landing')).toBeNull();
    expect(container.querySelector('.connection-console')).not.toBeNull();
    expect(container.querySelector<HTMLInputElement>('#serverUrl')?.value).toBe('https://existing.example/mcp');
  });

  it('connects quick picks and manual entry through the same connection path', async () => {
    const [pick] = selectLandingQuickPicks(getCatalogServers());
    const endpoint = getPreferredCatalogEndpoint(pick);

    const manual = renderTab(newTab);
    act(() => setInputValue(manual.container.querySelector<HTMLInputElement>('#serverUrl')!, endpoint.url));
    await act(async () => {
      manual.container.querySelector('#connectBtn')?.dispatchEvent(
        new MouseEvent('click', { bubbles: true })
      );
    });
    expect(connectionMocks.attempt).toHaveBeenCalledOnce();
    const manualCall = connectionMocks.attempt.mock.calls[0];
    expect(manualCall[0]).toBe(endpoint.url);
    expect(manual.container.querySelector('.landing')).toBeNull();
    act(() => root?.unmount());

    localStorage.clear();
    connectionMocks.attempt.mockClear();
    const quick = renderTab(newTab);
    await act(async () => {
      quick.container.querySelector(`[data-server-id="${pick.id}"]`)?.dispatchEvent(
        new MouseEvent('click', { bubbles: true })
      );
    });
    expect(connectionMocks.attempt).toHaveBeenCalledOnce();
    expect(connectionMocks.attempt.mock.calls[0][0]).toBe(manualCall[0]);
    expect(quick.onUpdateTab).toHaveBeenCalledWith('new-tab', expect.objectContaining({
      serverUrl: endpoint.url,
    }));
    expect(quick.container.querySelector('.landing')).toBeNull();
    expect(quick.container.querySelector<HTMLInputElement>('#serverUrl')?.value).toBe(endpoint.url);
  });
});
