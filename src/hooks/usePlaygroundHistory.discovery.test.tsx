import React, { act, useMemo } from 'react';
import { createRoot, type Root } from 'react-dom/client';
import { afterEach, beforeAll, beforeEach, describe, expect, it, vi } from 'vitest';
import { usePlaygroundHistory } from './usePlaygroundHistory';
import type { DiscoveryState, DiscoveryStatus } from './useToolsAndResources';
import { loadInterfaceSnapshot } from '../utils/interfaceSnapshot';

const SERVER = 'https://mcp.example.com/mcp';

beforeAll(() => {
  (globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true;
});

let root: Root | null = null;
let container: HTMLDivElement | null = null;

beforeEach(() => localStorage.clear());

afterEach(() => {
  act(() => root?.unmount());
  container?.remove();
  root = null;
  container = null;
  vi.useRealTimers();
});

const tool = (name: string) => ({ name, inputSchema: { type: 'object', properties: {} } });
const resource = (uri: string) => ({ uri, name: uri });

interface Visit {
  tools?: unknown[];
  resources?: unknown[];
  resourceTemplates?: unknown[];
  prompts?: unknown[];
  discovery?: Partial<DiscoveryStatus>;
}

const status = (state: DiscoveryState, overrides: Partial<DiscoveryStatus> = {}): DiscoveryStatus => ({
  tools: state, resources: state, resourceTemplates: state, prompts: state, ...overrides,
});

let api!: ReturnType<typeof usePlaygroundHistory>;

const Harness: React.FC<{ visit: Visit }> = ({ visit }) => {
  // Stable per visit, like hook state, so the snapshot effect runs once per change.
  const lists = useMemo(() => ({
    tools: visit.tools ?? [],
    resources: visit.resources ?? [],
    resourceTemplates: visit.resourceTemplates ?? [],
    prompts: visit.prompts ?? [],
    discovery: status('complete', visit.discovery),
  }), [visit]);
  api = usePlaygroundHistory({
    serverUrl: SERVER,
    isConnected: true,
    ...lists,
    selectedTool: null,
    toolParams: {},
    selectTool: vi.fn(),
    setToolParams: vi.fn(),
    executeTool: vi.fn(),
  });
  return null;
};

/** Each visit is a fresh mount, so the baseline is read anew like a reconnect. */
const visitServer = (visit: Visit) => {
  act(() => root?.unmount());
  container?.remove();
  container = document.createElement('div');
  document.body.appendChild(container);
  root = createRoot(container);
  act(() => root!.render(<Harness visit={visit} />));
};

const titles = () => api.interfaceDiff?.changes.map((change) => change.title) ?? [];

describe('usePlaygroundHistory interface discovery', () => {
  const populated: Visit = {
    tools: [tool('forecast'), tool('weather')],
    resources: [resource('file:///readme')],
  };

  it('does not report or persist removals for a list whose request failed', () => {
    visitServer(populated);
    visitServer({ ...populated, tools: [], discovery: { tools: 'failed' } });
    expect(titles()).toEqual([]);
    expect(loadInterfaceSnapshot(SERVER)?.tools?.map((item) => item.name)).toEqual(['forecast', 'weather']);

    visitServer(populated);
    expect(titles()).toEqual([]);
  });

  it('treats a paginated list as unconfirmed', () => {
    visitServer(populated);
    visitServer({ ...populated, tools: [tool('weather')], discovery: { tools: 'partial' } });
    expect(titles()).toEqual([]);
    expect(loadInterfaceSnapshot(SERVER)?.tools?.map((item) => item.name)).toEqual(['forecast', 'weather']);
  });

  it('waits for pending lists regardless of elapsed time', () => {
    vi.useFakeTimers();
    visitServer(populated);
    const stored = loadInterfaceSnapshot(SERVER);
    visitServer({ ...populated, tools: [], discovery: { tools: 'loading' } });
    act(() => { vi.advanceTimersByTime(60_000); });
    expect(titles()).toEqual([]);
    expect(loadInterfaceSnapshot(SERVER)).toEqual(stored);

    act(() => root!.render(<Harness visit={{ ...populated, tools: [tool('weather')] }} />));
    expect(titles()).toEqual(['Tool removed: forecast']);
  });

  it('snapshots a successfully discovered empty interface', () => {
    visitServer(populated);
    visitServer({});
    expect(titles()).toEqual([
      'Tool removed: forecast',
      'Tool removed: weather',
      'Resource removed: file:///readme',
    ]);
    expect(loadInterfaceSnapshot(SERVER)).toMatchObject({ tools: [], resources: [], prompts: [] });

    visitServer({});
    expect(titles()).toEqual([]);
  });

  it('stores nothing when no list completed', () => {
    visitServer({ discovery: status('failed') });
    expect(loadInterfaceSnapshot(SERVER)).toBeUndefined();
    expect(api.interfaceDiff).toBeNull();
  });
});
