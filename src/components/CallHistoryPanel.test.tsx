import React, { act, useState } from 'react';
import { createRoot, type Root } from 'react-dom/client';
import { afterEach, beforeAll, beforeEach, describe, expect, it, vi } from 'vitest';
import CallHistoryPanel from './CallHistoryPanel';
import InterfaceChangeStrip from './InterfaceChangeStrip';
import ParamsPanel from './ParamsPanel';
import { createCallHistoryEntry, type CallHistoryEntry } from '../utils/callHistory';
import { createInterfaceSnapshot } from '../utils/interfaceSnapshot';
import { diffInterfaceSnapshots } from '../utils/reportDiff';
import { INTERFACE_SNAPSHOT_SETTLE_MS, usePlaygroundHistory } from '../hooks/usePlaygroundHistory';

beforeAll(() => {
  (globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true;
});

let root: Root | null = null;
let container: HTMLDivElement | null = null;

const mount = (element: React.ReactElement) => {
  container = document.createElement('div');
  document.body.appendChild(container);
  root = createRoot(container);
  act(() => root!.render(element));
};

beforeEach(() => localStorage.clear());

afterEach(() => {
  act(() => root?.unmount());
  container?.remove();
  root = null;
  container = null;
  vi.useRealTimers();
});

const call = (overrides: Partial<CallHistoryEntry> = {}): CallHistoryEntry => ({
  ...createCallHistoryEntry({
    toolName: 'weather',
    arguments: { city: 'Riga' },
    result: { type: 'tool_result', data: [], timestamp: '', toolCall: {
      result: { content: [{ type: 'text', text: 'Sunny' }] },
      contract: { toolName: 'weather', status: 'pass', violations: [], hasStructuredContent: true, isError: false },
    } },
    durationMs: 42,
  }),
  ...overrides,
});

const button = (label: string) => [...container!.querySelectorAll('button')]
  .find((candidate) => candidate.textContent?.trim() === label || candidate.getAttribute('aria-label') === label);

const click = (target: Element | undefined) => {
  act(() => { (target as HTMLElement).click(); });
};

describe('CallHistoryPanel', () => {
  it('lists calls with outcome, verdict, duration and arguments', () => {
    mount(
      <CallHistoryPanel
        calls={[call(), call({ id: 'err', toolName: 'gone', isError: true, outputVerdict: undefined, resultSummary: 'boom' })]}
        availableToolNames={new Set(['weather'])}
        canRun
        onReplay={vi.fn()}
        onClearServer={vi.fn()}
        onClearAll={vi.fn()}
      />
    );
    const items = container!.querySelectorAll('.call-history-item');
    expect(items).toHaveLength(2);
    expect(items[0].textContent).toContain('weather');
    expect(items[0].textContent).toContain('Output schema met');
    expect(items[0].textContent).toContain('42 ms');
    expect(items[0].textContent).toContain('city: "Riga"');
    expect(items[1].textContent).toContain('Error');
    expect(container!.textContent).toContain('2 of the last 50 calls · 1 failure');
    expect(button('Replay: gone')?.hasAttribute('disabled')).toBe(true);
  });

  it('replays, copies as JSON-RPC and clears', async () => {
    const onReplay = vi.fn();
    const onClearServer = vi.fn();
    const onClearAll = vi.fn();
    const writeText = vi.fn().mockResolvedValue(undefined);
    Object.defineProperty(navigator, 'clipboard', { value: { writeText }, configurable: true });
    const entry = call();
    mount(
      <CallHistoryPanel
        calls={[entry]}
        availableToolNames={new Set(['weather'])}
        canRun
        onReplay={onReplay}
        onClearServer={onClearServer}
        onClearAll={onClearAll}
      />
    );
    click(button('Replay: weather'));
    expect(onReplay).toHaveBeenCalledWith(entry);

    await act(async () => { button('Copy weather call as JSON-RPC')!.click(); });
    expect(JSON.parse(writeText.mock.calls[0][0])).toMatchObject({
      method: 'tools/call', params: { name: 'weather', arguments: { city: 'Riga' } },
    });
    expect(container!.textContent).toContain('Copied');

    click(button('Clear this server'));
    click(button('Clear all servers'));
    expect(onClearServer).toHaveBeenCalledTimes(1);
    expect(onClearAll).toHaveBeenCalledTimes(1);
  });

  it('offers to load, not run, arguments that lost redacted values', () => {
    mount(
      <CallHistoryPanel
        calls={[call({ arguments: { apiKey: '[REDACTED]' }, argumentsRedacted: true })]}
        availableToolNames={new Set(['weather'])}
        canRun
        onReplay={vi.fn()}
        onClearServer={vi.fn()}
        onClearAll={vi.fn()}
      />
    );
    expect(button('Load arguments: weather')).toBeDefined();
  });
});

describe('ParamsPanel history view', () => {
  it('switches between the request form and the history', () => {
    const noop = vi.fn();
    mount(
      <ParamsPanel
        selectedTool={{ name: 'weather', inputSchema: { type: 'object', properties: {} } }}
        selectedResourceTemplate={null}
        selectedPrompt={null}
        toolParams={{}}
        resourceArgs={{}}
        promptParams={{}}
        isConnected
        isConnecting={false}
        handleParamChange={noop}
        handleResourceArgChange={noop}
        handleExecuteTool={noop}
        handleExecutePrompt={noop}
        handleAccessResource={noop}
        parseUriTemplateArgs={() => []}
        toolHistory={[]}
        resourceHistory={[]}
        setToolParams={noop}
        setResourceArgs={noop}
        isExecuting={false}
        executionStartTime={null}
        callHistoryCount={3}
        renderCallHistory={(showRequest) => <button type="button" onClick={showRequest}>history body</button>}
      />
    );
    expect(button('Run tool')).toBeDefined();
    click(button('History (3)'));
    expect(button('History (3)')?.getAttribute('aria-pressed')).toBe('true');
    expect(button('Run tool')).toBeUndefined();
    click(button('history body'));
    expect(button('Run tool')).toBeDefined();
  });
});

describe('InterfaceChangeStrip', () => {
  it('summarizes changes and expands the full diff', () => {
    const before = createInterfaceSnapshot({
      tools: [{ name: 'a', inputSchema: { type: 'object' } }, { name: 'b', inputSchema: { type: 'object' } }],
      resources: [], resourceTemplates: [], prompts: [{ name: 'p' }],
      observedAt: '2026-10-01T12:00:00.000Z',
    });
    const after = createInterfaceSnapshot({
      tools: [{ name: 'a', description: 'now documented', inputSchema: { type: 'object' } }, { name: 'c', inputSchema: { type: 'object' } }],
      resources: [], resourceTemplates: [], prompts: [{ name: 'p' }],
    });
    const onDismiss = vi.fn();
    mount(<InterfaceChangeStrip diff={diffInterfaceSnapshots(before, after)} onDismiss={onDismiss} />);
    const chips = [...container!.querySelectorAll('.interface-change-chip')].map((node) => node.textContent);
    expect(chips).toEqual(['−1 tool removed', '+1 tool added', '1 description changed']);
    expect(container!.querySelector('time')?.getAttribute('datetime')).toBe('2026-10-01T12:00:00.000Z');

    const toggle = button('View full diff')!;
    click(toggle);
    expect(toggle.getAttribute('aria-expanded')).toBe('true');
    expect(container!.textContent).toContain('Tool removed: b');
    expect(container!.textContent).toContain('your last visit');

    click(button('Dismiss interface changes'));
    expect(onDismiss).toHaveBeenCalled();
  });

  it('renders nothing without changes', () => {
    const snapshot = createInterfaceSnapshot({ tools: [], resources: [], resourceTemplates: [], prompts: [] });
    mount(<InterfaceChangeStrip diff={diffInterfaceSnapshots(snapshot, snapshot)} onDismiss={vi.fn()} />);
    expect(container!.innerHTML).toBe('');
  });
});

describe('usePlaygroundHistory', () => {
  type FakeTool = { name: string; inputSchema: Record<string, unknown> };
  const tools: FakeTool[] = [{ name: 'weather', inputSchema: { type: 'object', properties: { city: { type: 'string' } } } }];

  const Harness: React.FC<{
    execute: (params: Record<string, unknown>) => void;
    onReady: (api: ReturnType<typeof usePlaygroundHistory>) => void;
    toolList?: FakeTool[];
  }> = ({ execute, onReady, toolList = tools }) => {
    const [selectedTool, setSelectedTool] = useState<{ name: string } | null>(null);
    const [toolParams, setToolParams] = useState<Record<string, unknown>>({});
    const api = usePlaygroundHistory({
      serverUrl: 'https://mcp.example.com/mcp',
      isConnected: true,
      tools: toolList,
      resources: [],
      resourceTemplates: [],
      prompts: [],
      selectedTool,
      toolParams,
      selectTool: (tool) => { setSelectedTool(tool); setToolParams({}); },
      setToolParams,
      executeTool: () => execute(toolParams),
    });
    onReady(api);
    return null;
  };

  it('records calls and replays one by refilling arguments, then running', () => {
    const execute = vi.fn();
    let api!: ReturnType<typeof usePlaygroundHistory>;
    mount(<Harness execute={execute} onReady={(value) => { api = value; }} />);

    act(() => api.recordCall('weather', { city: 'Oslo' }, null, 12));
    expect(api.calls).toHaveLength(1);
    expect(api.calls[0]).toMatchObject({ toolName: 'weather', isError: true, durationMs: 12 });

    act(() => { api.replayCall(api.calls[0]); });
    expect(execute).toHaveBeenCalledTimes(1);
    expect(execute).toHaveBeenCalledWith({ city: 'Oslo' });

    act(() => api.clearServerHistory());
    expect(api.calls).toEqual([]);
  });

  it('refills without running when arguments were redacted', () => {
    const execute = vi.fn();
    let api!: ReturnType<typeof usePlaygroundHistory>;
    mount(<Harness execute={execute} onReady={(value) => { api = value; }} />);
    act(() => api.recordCall('weather', { city: 'Oslo', password: 'hunter2hunter2' }, null, 1));
    expect(api.calls[0].argumentsRedacted).toBe(true);
    act(() => { api.replayCall(api.calls[0]); });
    expect(execute).not.toHaveBeenCalled();
  });

  it('diffs against the previous visit once the lists settle', () => {
    vi.useFakeTimers();
    let api!: ReturnType<typeof usePlaygroundHistory>;
    mount(<Harness execute={vi.fn()} onReady={(value) => { api = value; }} />);
    act(() => { vi.advanceTimersByTime(INTERFACE_SNAPSHOT_SETTLE_MS); });
    expect(api.interfaceDiff).toBeNull();
    act(() => root!.unmount());

    root = createRoot(container!);
    act(() => root!.render(
      <Harness
        execute={vi.fn()}
        onReady={(value) => { api = value; }}
        toolList={[...tools, { name: 'forecast', inputSchema: { type: 'object', properties: {} } }]}
      />
    ));
    act(() => { vi.advanceTimersByTime(INTERFACE_SNAPSHOT_SETTLE_MS); });
    expect(api.interfaceDiff?.changes.map((change) => change.title)).toEqual(['Tool added: forecast']);

    act(() => api.dismissInterfaceDiff());
    expect(api.interfaceDiff).toBeNull();
  });
});
