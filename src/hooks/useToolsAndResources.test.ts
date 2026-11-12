import React, { act } from 'react';
import { createRoot, type Root } from 'react-dom/client';
import { afterEach, beforeAll, describe, expect, it, vi } from 'vitest';
import type { Client } from '@modelcontextprotocol/client';
import { useToolsAndResources } from './useToolsAndResources';
import { createCallHistoryEntry, toJsonRpcRequest } from '../utils/callHistory';

beforeAll(() => {
  (globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true;
});

let root: Root | null = null;

afterEach(() => {
  act(() => root?.unmount());
  root = null;
});

const deferred = <T,>() => {
  let resolve!: (value: T) => void;
  let reject!: (error: unknown) => void;
  const promise = new Promise<T>((res, rej) => { resolve = res; reject = rej; });
  return { promise, resolve, reject };
};

const renderHook = (client: Partial<Client>, connectionStatus = 'Connected') => {
  let hook!: ReturnType<typeof useToolsAndResources>;
  const Probe: React.FC<{ status: string }> = ({ status }) => {
    hook = useToolsAndResources(client as Client, vi.fn(), status, 'https://mcp.example.com/mcp');
    return null;
  };
  root = createRoot(document.createElement('div'));
  act(() => root!.render(React.createElement(Probe, { status: connectionStatus })));
  return {
    get hook() { return hook; },
    setStatus: (status: string) => act(() => root!.render(React.createElement(Probe, { status }))),
  };
};

describe('useToolsAndResources discovery status', () => {
  it('marks each list loading, then complete, partial or failed', async () => {
    const tools = deferred<{ tools: unknown[] }>();
    const client = {
      listTools: vi.fn(() => tools.promise),
      listResources: vi.fn(async () => ({ resources: [], nextCursor: 'page-2' })),
      listResourceTemplates: vi.fn(async () => { throw new Error('Method not found'); }),
      listPrompts: vi.fn(async () => ({ prompts: [] })),
    } as unknown as Partial<Client>;
    const view = renderHook(client);
    expect(view.hook.discovery.tools).toBe('idle');

    await act(async () => {
      void view.hook.handleListTools();
      await view.hook.handleListResources();
      await view.hook.handleListResourceTemplates();
      await view.hook.handleListPrompts();
    });
    expect(view.hook.discovery).toEqual({
      tools: 'loading', resources: 'partial', resourceTemplates: 'failed', prompts: 'complete',
    });

    await act(async () => { tools.resolve({ tools: [] }); });
    expect(view.hook.discovery.tools).toBe('complete');
  });

  it('ignores a list response from before a disconnect', async () => {
    const stale = deferred<{ tools: unknown[] }>();
    const client = { listTools: vi.fn(() => stale.promise) } as unknown as Partial<Client>;
    const view = renderHook(client);
    await act(async () => { void view.hook.handleListTools(); });
    view.setStatus('Disconnected');
    view.setStatus('Connected');
    await act(async () => { stale.resolve({ tools: [{ name: 'old', inputSchema: {} }] }); });
    expect(view.hook.discovery.tools).toBe('idle');
    expect(view.hook.tools).toEqual([]);
  });
});

describe('useToolsAndResources sent arguments', () => {
  const tool = {
    name: 'weather',
    inputSchema: {
      type: 'object',
      properties: {
        city: { type: 'string' },
        options: { type: 'object' },
        days: { type: 'array' },
        extra: { type: 'object' },
      },
    },
  };

  const executeWith = async (params: Record<string, unknown>) => {
    const callTool = vi.fn(async (_request: unknown) => ({ content: [{ type: 'text', text: 'ok' }] }));
    const view = renderHook({ callTool } as unknown as Partial<Client>);
    act(() => view.hook.handleSelectTool(tool));
    act(() => view.hook.setToolParams(params));
    const onRequestSent = vi.fn();
    await act(async () => { await view.hook.handleExecuteTool(onRequestSent); });
    return { callTool, onRequestSent };
  };

  it('reports the normalized arguments that were sent, and copies them as JSON', async () => {
    const { callTool, onRequestSent } = await executeWith({
      city: 'Riga', options: '{"units":"metric"}', days: '[1, 2]', extra: '  ',
    });
    const sent = { city: 'Riga', options: { units: 'metric' }, days: [1, 2] };
    expect(callTool.mock.calls[0][0]).toEqual({ name: 'weather', arguments: sent });
    expect(onRequestSent).toHaveBeenCalledWith(sent);

    const entry = createCallHistoryEntry({
      toolName: 'weather', arguments: onRequestSent.mock.calls[0][0], result: null, durationMs: 1,
    });
    expect(JSON.parse(toJsonRpcRequest(entry)).params.arguments).toEqual(sent);
  });

  it('does not report a request that failed local validation', async () => {
    const { callTool, onRequestSent } = await executeWith({ options: '{not json' });
    expect(callTool).not.toHaveBeenCalled();
    expect(onRequestSent).not.toHaveBeenCalled();
  });
});
