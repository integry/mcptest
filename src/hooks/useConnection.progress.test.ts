import React, { act } from 'react';
import { createRoot, type Root } from 'react-dom/client';
import { afterEach, beforeAll, beforeEach, describe, expect, it, vi } from 'vitest';

const connectionMocks = vi.hoisted(() => ({ attempt: vi.fn() }));

vi.mock('../utils/transportDetection', async (importOriginal) => {
  const actual = await importOriginal<typeof import('../utils/transportDetection')>();
  return { ...actual, attemptParallelConnections: connectionMocks.attempt };
});
vi.mock('../context/AuthContext', () => ({ useAuth: () => ({ currentUser: null, loading: false }) }));
vi.mock('../utils/analytics', async (importOriginal) => ({
  ...await importOriginal<typeof import('../utils/analytics')>(),
  trackEvent: vi.fn(),
}));

import { useConnection } from './useConnection';
import { TransportConnectionError, type ObservedTransportRequest } from '../utils/transportDetection';
import { connectionStages } from '../utils/connectionStages';

beforeAll(() => {
  (globalThis as typeof globalThis & { IS_REACT_ACT_ENVIRONMENT: boolean }).IS_REACT_ACT_ENVIRONMENT = true;
});

const render = () => {
  let connection: ReturnType<typeof useConnection> | undefined;
  const root: Root = createRoot(document.createElement('div'));
  const Probe = () => {
    connection = useConnection(vi.fn(), false);
    return null;
  };
  act(() => root.render(React.createElement(Probe)));
  return {
    get connection() { return connection!; },
    unmount: () => act(() => root.unmount()),
  };
};

const statuses = (view: ReturnType<typeof render>) => Object.fromEntries(
  connectionStages(view.connection.connectionProgress).map(({ id, status }) => [id, status])
);

const endpoint = 'https://progress.example/mcp';

describe('connection stage reporting from the attempt', () => {
  beforeEach(() => {
    localStorage.clear();
    sessionStorage.clear();
    window.history.replaceState(null, '', '/');
    connectionMocks.attempt.mockReset();
  });
  afterEach(() => vi.restoreAllMocks());

  it('advances stages only when the transport reports a settled request', async () => {
    let settle!: (value: unknown) => void;
    let onResponse!: (request: ObservedTransportRequest) => void;
    connectionMocks.attempt.mockImplementationOnce((...args: unknown[]) => {
      onResponse = args[8] as typeof onResponse;
      return new Promise((resolve) => { settle = resolve; });
    });
    const view = render();
    let connecting!: Promise<void>;
    act(() => { connecting = view.connection.handleConnect(vi.fn(), vi.fn(), vi.fn(), endpoint); });
    await act(async () => {});

    // Before any response, only the first stage is in progress.
    expect(statuses(view)).toEqual({ reach: 'active', negotiate: 'pending', authorize: 'pending', list: 'pending' });

    // A fetch failure without a status proves nothing; the stage stays put.
    act(() => onResponse({ method: 'POST', url: endpoint, outcome: 'failed' }));
    expect(statuses(view).reach).toBe('active');

    act(() => onResponse({ method: 'POST', url: endpoint, mcpMethod: 'server/discover', status: 200, outcome: 'succeeded' }));
    expect(statuses(view)).toMatchObject({ reach: 'done', negotiate: 'active' });

    await act(async () => {
      settle({
        client: { close: vi.fn().mockResolvedValue(undefined) },
        url: endpoint,
        transportType: 'streamable-http',
        protocolEra: 'modern',
        protocolVersion: '2026-07-28',
      });
      await connecting;
    });
    const stages = connectionStages(view.connection.connectionProgress);
    expect(stages.map(({ status }) => status)).toEqual(['done', 'done', 'skipped', 'pending']);
    expect(stages[1].detail).toBe('MCP 2026-07-28 over Streamable HTTP');
    view.unmount();
  });

  it('marks the stage that was in progress as failed', async () => {
    connectionMocks.attempt.mockImplementationOnce(async (...args: unknown[]) => {
      const onResponse = args[8] as (request: ObservedTransportRequest) => void;
      onResponse({ method: 'POST', url: endpoint, mcpMethod: 'initialize', status: 500, outcome: 'failed' });
      throw new TransportConnectionError([new Error('HTTP 500')]);
    });
    const view = render();
    await act(async () => { await view.connection.handleConnect(vi.fn(), vi.fn(), vi.fn(), endpoint); });
    expect(statuses(view)).toMatchObject({ reach: 'done', negotiate: 'failed', authorize: 'pending' });
    expect(view.connection.connectionProgress.phase).toBe('failed');
    view.unmount();
  });

  it('ignores late responses from a superseded attempt', async () => {
    let lateResponse!: (request: ObservedTransportRequest) => void;
    connectionMocks.attempt.mockImplementationOnce(async (...args: unknown[]) => {
      lateResponse = args[8] as typeof lateResponse;
      throw new TransportConnectionError([new Error('unreachable')]);
    });
    const view = render();
    await act(async () => { await view.connection.handleConnect(vi.fn(), vi.fn(), vi.fn(), endpoint); });
    expect(statuses(view).reach).toBe('failed');

    connectionMocks.attempt.mockImplementationOnce(() => new Promise(() => {}));
    act(() => { void view.connection.handleConnect(vi.fn(), vi.fn(), vi.fn(), endpoint); });
    await act(async () => {});
    act(() => lateResponse({ method: 'POST', url: endpoint, status: 200, outcome: 'succeeded' }));
    expect(statuses(view).reach).toBe('active');
    view.unmount();
  });
});
