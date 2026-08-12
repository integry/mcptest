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

const renderNewTab = (useProxy = true) => {
  const tab: ConnectionTab = {
    id: 'new-tab',
    title: 'New Connection',
    serverUrl: '',
    connectionStatus: 'Disconnected',
    useProxy,
  };
  const container = document.createElement('div');
  const root: Root = createRoot(container);

  act(() => {
    root.render(
      <MemoryRouter>
        <TabContent
          tab={tab}
          isActive
          onUpdateTab={vi.fn()}
          spaces={[]}
          onAddCardToSpace={vi.fn()}
        />
      </MemoryRouter>
    );
  });

  return {
    container,
    unmount: () => act(() => root.unmount()),
  };
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
