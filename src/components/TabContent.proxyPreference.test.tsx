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

vi.mock('../utils/catalogUtils', async (importOriginal) => {
  const actual = await importOriginal<typeof import('../utils/catalogUtils')>();
  return {
    ...actual,
    getCatalogServers: () => actual.getCatalogServers().map((server) => (
      server.id === 'coingecko'
        ? {
            ...server,
            browserUrl: 'https://mcp.api.coingecko.com/sse',
            validatedUrl: 'https://mcp.api.coingecko.com/sse',
            transport: 'streamable-http' as const,
          }
        : server
    )),
  };
});

vi.mock('../context/AuthContext', () => ({
  useAuth: () => ({ currentUser: null, loading: false }),
}));

vi.mock('../utils/analytics', () => ({ logEvent: vi.fn() }));

import TabContent from './TabContent';
import { TransportConnectionError } from '../utils/transportDetection';

beforeAll(() => {
  (
    globalThis as typeof globalThis & { IS_REACT_ACT_ENVIRONMENT: boolean }
  ).IS_REACT_ACT_ENVIRONMENT = true;
});

const setInputValue = (input: HTMLInputElement, value: string) => {
  const setter = Object.getOwnPropertyDescriptor(
    HTMLInputElement.prototype,
    'value'
  )?.set;
  setter?.call(input, value);
  input.dispatchEvent(new Event('input', { bubbles: true }));
};

const renderTab = (tab: ConnectionTab, onUpdateTab = vi.fn()) => {
  const container = document.createElement('div');
  const root: Root = createRoot(container);
  const render = (nextTab: ConnectionTab) => {
    root.render(
      <MemoryRouter>
        <TabContent
          tab={nextTab}
          isActive
          onUpdateTab={onUpdateTab}
          spaces={[]}
          onAddCardToSpace={vi.fn()}
        />
      </MemoryRouter>
    );
  };

  act(() => render(tab));

  return {
    container,
    onUpdateTab,
    rerender: (nextTab: ConnectionTab) => act(() => render(nextTab)),
    unmount: () => act(() => root.unmount()),
  };
};

const renderNewTab = (useProxy = true) => {
  const tab: ConnectionTab = {
    id: 'new-tab',
    title: 'New Connection',
    serverUrl: '',
    connectionStatus: 'Disconnected',
    useProxy,
  };
  return renderTab(tab);
};

const connectToSlack = async (container: HTMLElement) => {
  const firstConnectionButton = Array.from(container.querySelectorAll('button')).find(
    (button) => button.textContent?.includes('Connect your first server')
  );
  expect(firstConnectionButton).toBeDefined();

  act(() => firstConnectionButton?.dispatchEvent(new MouseEvent('click', { bubbles: true })));

  const input = container.querySelector<HTMLInputElement>('#serverUrl');
  expect(input).not.toBeNull();
  act(() => setInputValue(input!, 'https://mcp.slack.com/mcp'));

  const connectButton = container.querySelector<HTMLButtonElement>('#connectBtn');
  expect(connectButton?.disabled).toBe(false);
  await act(async () => {
    connectButton?.dispatchEvent(new MouseEvent('click', { bubbles: true }));
  });
};

describe('rendered anonymous proxy preference', () => {
  beforeEach(() => {
    localStorage.clear();
    sessionStorage.clear();
    vi.stubEnv('VITE_PROXY_URL', 'https://proxy.mcptest.test/');
    connectionMocks.attempt.mockReset();
    connectionMocks.attempt.mockRejectedValue(new TransportConnectionError([
      new TypeError('Failed to fetch'),
    ]));
  });

  afterEach(() => {
    vi.useRealTimers();
    vi.unstubAllEnvs();
    vi.restoreAllMocks();
  });

  it('shows the proxy-login prerequisite from a default proxy-enabled new tab', async () => {
    const view = renderNewTab();

    await connectToSlack(view.container);

    expect(connectionMocks.attempt).toHaveBeenCalledOnce();
    expect(view.container.querySelector<HTMLInputElement>('#proxyFallbackCheck')?.checked).toBe(true);
    expect(view.container.textContent).toContain('mcptest proxy authentication required');
    expect(view.container.textContent).not.toContain('MCP Server Connection Failed');

    const connectionPanel = view.container.querySelector('.connection-console');
    const prerequisitePanel = view.container.querySelector('.oauth-prerequisite-panel');
    const playgroundLayout = view.container.querySelector('.playground-layout');
    expect(connectionPanel?.nextElementSibling).toBe(prerequisitePanel);
    expect(prerequisitePanel?.nextElementSibling).toBe(playgroundLayout);
    view.unmount();
  });

  it('shows the generic direct failure from an explicitly opted-out new tab', async () => {
    const view = renderNewTab(false);

    await connectToSlack(view.container);

    expect(connectionMocks.attempt).toHaveBeenCalledOnce();
    expect(view.container.querySelector<HTMLInputElement>('#proxyFallbackCheck')?.checked).toBe(false);
    expect(view.container.textContent).toContain('MCP Server Connection Failed');
    expect(view.container.textContent).not.toContain('mcptest proxy authentication required');
    view.unmount();
  });
});

describe('endpoint-scoped preferred transport hints', () => {
  beforeEach(() => {
    localStorage.clear();
    sessionStorage.clear();
    connectionMocks.attempt.mockReset();
    connectionMocks.attempt.mockRejectedValue(new Error('Connection failed'));
  });

  afterEach(() => {
    vi.useRealTimers();
    vi.restoreAllMocks();
  });

  it('uses the hint for the initial auto-connect without treating it as negotiated output', async () => {
    vi.useFakeTimers();
    const endpoint = 'https://initial.example/mcp';
    const tab: ConnectionTab = {
      id: 'initial-auto-connect',
      title: 'Initial connection',
      serverUrl: endpoint,
      connectionStatus: 'Disconnected',
      transportType: 'legacy-sse',
      preferredTransportHint: 'streamable-http',
      autoConnect: true,
      useProxy: false,
    };
    const view = renderTab(tab);

    await act(async () => {
      await vi.advanceTimersByTimeAsync(100);
    });

    expect(connectionMocks.attempt).toHaveBeenCalledOnce();
    expect(connectionMocks.attempt.mock.calls[0][0]).toBe(endpoint);
    expect(connectionMocks.attempt.mock.calls[0][7]).toBe('streamable-http');
    expect(view.onUpdateTab).toHaveBeenCalledWith(tab.id, expect.objectContaining({
      transportType: null,
    }));
    expect(view.onUpdateTab.mock.calls.some(([, updates]) => (
      Object.prototype.hasOwnProperty.call(updates, 'preferredTransportHint')
    ))).toBe(false);
    view.unmount();
  });

  it('uses definitive Streamable HTTP evidence for a suggested /sse endpoint', async () => {
    const view = renderNewTab(false);
    const firstConnectionButton = Array.from(view.container.querySelectorAll('button')).find(
      (button) => button.textContent?.includes('Connect your first server')
    );
    act(() => firstConnectionButton?.dispatchEvent(new MouseEvent('click', { bubbles: true })));

    const suggestedServerButton = Array.from(view.container.querySelectorAll('button')).find(
      (button) => button.textContent?.includes('CoinGecko')
    );
    expect(suggestedServerButton).toBeDefined();
    await act(async () => {
      suggestedServerButton?.dispatchEvent(new MouseEvent('click', { bubbles: true }));
    });

    const endpoint = 'https://mcp.api.coingecko.com/sse';
    expect(connectionMocks.attempt).toHaveBeenCalledOnce();
    expect(connectionMocks.attempt.mock.calls[0][0]).toBe(endpoint);
    expect(connectionMocks.attempt.mock.calls[0][7]).toBe('streamable-http');
    expect(view.onUpdateTab).toHaveBeenCalledWith('new-tab', {
      serverUrl: endpoint,
      title: 'mcp.api.coingecko.com',
      preferredTransportHint: 'streamable-http',
    });
    view.unmount();
  });

  it('uses a transport hint added after the matching tab is already mounted', async () => {
    const endpoint = 'https://existing.example/sse';
    const tab: ConnectionTab = {
      id: 'existing-tab',
      title: 'Existing connection',
      serverUrl: endpoint,
      connectionStatus: 'Disconnected',
      transportType: 'streamable-http',
      useProxy: false,
    };
    const view = renderTab(tab);

    view.rerender({ ...tab, preferredTransportHint: 'legacy-sse' });
    const connectButton = view.container.querySelector<HTMLButtonElement>('#connectBtn');
    expect(connectButton?.disabled).toBe(false);
    await act(async () => {
      connectButton?.dispatchEvent(new MouseEvent('click', { bubbles: true }));
    });

    expect(connectionMocks.attempt).toHaveBeenCalledOnce();
    expect(connectionMocks.attempt.mock.calls[0][0]).toBe(endpoint);
    expect(connectionMocks.attempt.mock.calls[0][7]).toBe('legacy-sse');
    view.unmount();
  });

  it('clears the hint when the tab endpoint changes', () => {
    const tab: ConnectionTab = {
      id: 'edited-endpoint',
      title: 'Edited endpoint',
      serverUrl: 'https://before.example/mcp',
      connectionStatus: 'Disconnected',
      preferredTransportHint: 'streamable-http',
      useProxy: false,
    };
    const view = renderTab(tab);
    view.onUpdateTab.mockClear();

    const input = view.container.querySelector<HTMLInputElement>('#serverUrl');
    expect(input).not.toBeNull();
    act(() => setInputValue(input!, 'https://after.example/sse'));

    expect(view.onUpdateTab).toHaveBeenCalledWith(tab.id, {
      preferredTransportHint: undefined,
    });
    view.unmount();
  });
});
