import React, { act } from 'react';
import { createRoot, type Root } from 'react-dom/client';
import { afterEach, beforeAll, describe, expect, it, vi } from 'vitest';
import ConnectionProgress from './ConnectionProgress';
import ConnectedSummary, { chooseNextAction } from './ConnectedSummary';
import { UnifiedPanel } from './UnifiedPanel';
import ParamsPanel from './ParamsPanel';
import ResultPanel from './ResultPanel';
import ToolResultView from './ToolResultView';
import { connectionStages, reduceConnectionProgress, IDLE_CONNECTION_PROGRESS } from '../utils/connectionStages';
import { checkToolOutputContract } from '../utils/outputContract';
import type { LogEntry } from '../types';
import type { DiscoveryStatus } from '../hooks/useToolsAndResources';

beforeAll(() => {
  (globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true;
});

let root: Root | null = null;
let host: HTMLDivElement | null = null;
afterEach(() => {
  act(() => root?.unmount());
  host?.remove();
  root = null;
  host = null;
  document.body.innerHTML = '';
});

const mount = (element: React.ReactElement) => {
  host = document.createElement('div');
  document.body.appendChild(host);
  root = createRoot(host);
  act(() => root!.render(element));
  return host;
};

const COMPLETE: DiscoveryStatus = { tools: 'complete', resources: 'complete', resourceTemplates: 'complete', prompts: 'complete' };

describe('ConnectionProgress', () => {
  it('lists every stage with its status and announces the current one politely', () => {
    const progress = [{ type: 'start' } as const, { type: 'response', status: 200, ok: true } as const]
      .reduce(reduceConnectionProgress, IDLE_CONNECTION_PROGRESS);
    const view = mount(<ConnectionProgress stages={connectionStages(progress)} />);
    const items = [...view.querySelectorAll('li')];
    expect(items.map((item) => item.dataset.status)).toEqual(['done', 'active', 'pending', 'pending']);
    expect(items[0].textContent).toContain('Reach the endpoint: done');
    const live = view.querySelector('[role="status"]')!;
    expect(live.getAttribute('aria-live')).toBe('polite');
    expect(live.textContent).toBe('Negotiate the protocol version: Waiting for the handshake to finish.');
  });
});

describe('ConnectedSummary', () => {
  const props: React.ComponentProps<typeof ConnectedSummary> = {
    serverName: 'mcptest-e2e-mock',
    serverVersion: '1.0.0',
    serverUrl: 'http://127.0.0.1:4180/2026/mcp',
    protocolVersion: '2026-07-28',
    transportType: 'streamable-http',
    authMode: 'none',
    counts: { tools: { count: 2, offered: true }, resources: { count: 1, offered: true }, prompts: { count: 0, offered: false } },
    discovery: COMPLETE,
    listStage: { status: 'done', detail: '2 tools, 1 resource, 0 prompts' },
    nextAction: 'call-tool',
    reportHref: '/report/x',
    onCallTool: vi.fn(),
    connectionKey: 'a',
  };

  it('names the server, its session and capabilities, with one primary action', () => {
    const view = mount(<ConnectedSummary {...props} />);
    expect(view.querySelector('h2')?.textContent).toBe('mcptest-e2e-mockv1.0.0');
    expect([...view.querySelectorAll('[aria-label="Session"] .badge')].map((badge) => badge.textContent))
      .toEqual(['Connected', 'MCP 2026-07-28', 'Streamable HTTP', 'No auth']);
    expect([...view.querySelectorAll('[aria-label="Capabilities"] .badge')].map((badge) => badge.textContent))
      .toEqual(['2 tools', '1 resource', 'No prompts offered']);
    const actions = view.querySelectorAll('.connected-summary-next .btn');
    expect(actions).toHaveLength(1);
    act(() => (actions[0] as HTMLButtonElement).click());
    expect(props.onCallTool).toHaveBeenCalledOnce();
  });

  it('moves focus to the summary after connect when focus was lost, once per connection', () => {
    const view = mount(<ConnectedSummary {...props} />);
    expect(document.activeElement).toBe(view.querySelector('h2'));
    const other = document.createElement('button');
    document.body.appendChild(other);
    other.focus();
    act(() => root!.render(<ConnectedSummary {...props} nextAction="share-report" />));
    expect(document.activeElement).toBe(other);
  });

  it('offers the report with what is shared and redacted after a successful run', () => {
    const view = mount(<ConnectedSummary {...props} nextAction="share-report" />);
    const link = view.querySelector<HTMLAnchorElement>('.connected-summary-next a')!;
    expect(link.textContent).toContain('Share report');
    expect(link.getAttribute('href')).toBe('/report/x');
    expect(view.querySelector('.connected-summary-next p')?.textContent).toMatch(/redacted/);
  });

  it('shows the list progress while capabilities load and a failed list afterwards', () => {
    const view = mount(<ConnectedSummary {...props} listStage={{ status: 'active', detail: '1 of 4 lists received' }} />);
    expect(view.textContent).toContain('Listing capabilities');
    const offeredPrompts = { ...props.counts, prompts: { count: 0, offered: true } };
    act(() => root!.render(<ConnectedSummary {...props} counts={offeredPrompts} discovery={{ ...COMPLETE, prompts: 'failed' }} />));
    expect(view.textContent).toContain('prompts list failed');
    act(() => root!.render(<ConnectedSummary {...props} counts={offeredPrompts} discovery={{ ...COMPLETE, prompts: 'partial' }} />));
    expect(view.textContent).toContain('prompts list incomplete');
    // A capability the server never advertised is absent, not a failed list.
    act(() => root!.render(<ConnectedSummary {...props} discovery={{ ...COMPLETE, prompts: 'failed' }} />));
    expect(view.textContent).toContain('No prompts offered');
    expect(view.textContent).not.toContain('list failed');
  });

  it('shows the list stage advancing and completing after connect, and announces each step', () => {
    const view = mount(<ConnectedSummary {...props} listStage={{ status: 'active', detail: '1 of 4 lists received' }} />);
    const stage = () => view.querySelector<HTMLElement>('[data-stage="list"]')!;
    const live = () => view.querySelector('[role="status"]')!.textContent;
    expect(stage().dataset.status).toBe('active');
    expect(stage().textContent).toContain('List tools, resources and prompts: in progress');
    expect(stage().textContent).toContain('1 of 4 lists received');
    expect(live()).toBe('List tools, resources and prompts: 1 of 4 lists received.');
    act(() => root!.render(<ConnectedSummary {...props} listStage={{ status: 'active', detail: '3 of 4 lists received' }} />));
    expect(stage().textContent).toContain('3 of 4 lists received');
    expect(live()).toBe('List tools, resources and prompts: 3 of 4 lists received.');
    act(() => root!.render(<ConnectedSummary {...props} />));
    expect(stage().dataset.status).toBe('done');
    expect(stage().textContent).toContain('2 tools, 1 resource, 0 prompts');
    expect(live()).toBe('Connected. 2 tools, 1 resource, 0 prompts.');
  });

  it('offers a retry, not an absence claim, when the tools list failed', () => {
    const onRetryLists = vi.fn();
    const noTools = { ...props.counts, tools: { count: 0, offered: true } };
    const view = mount(<ConnectedSummary {...props} counts={noTools} discovery={{ ...COMPLETE, tools: 'failed' }} nextAction="retry-lists" onRetryLists={onRetryLists} />);
    const next = view.querySelector('.connected-summary-next')!;
    expect(next.textContent).toContain('Retry listing');
    expect(next.textContent).not.toContain('lists no tools');
    act(() => next.querySelector('button')!.click());
    expect(onRetryLists).toHaveBeenCalledOnce();
  });

  it.each([
    ['complete', 'run-report'],
    ['not-offered', 'run-report'],
    ['partial', 'run-report'],
    ['failed', 'retry-lists'],
  ] as const)('chooses the next action for an empty %s tools list', (toolsOutcome, action) => {
    expect(chooseNextAction({ hasSuccessfulRun: false, toolCount: 0, listing: false, toolsOutcome })).toBe(action);
    expect(chooseNextAction({ hasSuccessfulRun: false, toolCount: 0, listing: true, toolsOutcome })).toBe('call-tool');
    expect(chooseNextAction({ hasSuccessfulRun: true, toolCount: 0, listing: false, toolsOutcome })).toBe('share-report');
  });

  it('does not say the server lists no tools when the tools list is paged', () => {
    const noTools = { ...props.counts, tools: { count: 0, offered: true } };
    const view = mount(<ConnectedSummary {...props} counts={noTools} discovery={{ ...COMPLETE, tools: 'partial' }} nextAction="run-report" />);
    const next = view.querySelector('.connected-summary-next')!;
    expect(next.textContent).toContain('later pages');
    expect(next.textContent).not.toContain('lists no tools');
  });
});

const tools = [{ name: 'get_forecast', description: 'Forecast', inputSchema: { type: 'object' as const } }];
const panel = (overrides: Partial<React.ComponentProps<typeof UnifiedPanel>> = {}) => (
  <UnifiedPanel
    tools={tools}
    resources={[]}
    resourceTemplates={[]}
    prompts={[]}
    selectedTool={null}
    selectedResourceTemplate={null}
    selectedPrompt={null}
    handleSelectTool={vi.fn()}
    handleSelectResource={vi.fn()}
    handleSelectResourceTemplate={vi.fn()}
    handleSelectPrompt={vi.fn()}
    connectionStatus="Connected"
    onRefreshLists={vi.fn()}
    isConnecting={false}
    discovery={COMPLETE}
    {...overrides}
  />
);

describe('UnifiedPanel guidance', () => {
  it('highlights the tool list with a dismissible prompt on first run', () => {
    const onDismiss = vi.fn();
    const view = mount(panel({ guideToolPick: true, onDismissToolPickGuide: onDismiss }));
    const hint = view.querySelector('.onboarding-hint')!;
    expect(hint.textContent).toContain('Pick a tool to call');
    expect(view.querySelector('[role="listbox"][aria-label="Tools"]')?.getAttribute('aria-describedby')).toBe(hint.id);
    expect(view.querySelector('.capability-group--guided')).not.toBeNull();
    act(() => hint.querySelector('button')!.click());
    expect(onDismiss).toHaveBeenCalledOnce();
  });

  it('explains each capability the server does not offer once its list has loaded', () => {
    const view = mount(panel());
    const empty = [...view.querySelectorAll('.capability-empty-state')].map((item) => item.querySelector('.capability-empty-title')?.textContent);
    expect(empty).toEqual(['No resources', 'No prompts']);
    act(() => root!.render(panel({ discovery: { ...COMPLETE, prompts: 'loading' } })));
    expect([...view.querySelectorAll('.capability-empty-title')].map((item) => item.textContent)).toEqual(['No resources']);
  });

  it.each([
    ['failed', 'Tools list failed'],
    ['partial', 'Tools list incomplete'],
  ] as const)('reports a %s tools list instead of claiming the server has none', (state, title) => {
    const onRefreshLists = vi.fn();
    const view = mount(panel({ tools: [], discovery: { ...COMPLETE, tools: state }, onRefreshLists }));
    const titles = [...view.querySelectorAll('.capability-empty-title')].map((item) => item.textContent);
    expect(titles).toContain(title);
    expect(titles).not.toContain('No tools');
    expect(view.textContent).not.toContain('This server lists none, so there is nothing to run here');
    const retry = [...view.querySelectorAll('button')].find((button) => button.textContent === 'Retry listing');
    expect(Boolean(retry)).toBe(state === 'failed');
    if (retry) {
      act(() => retry.click());
      expect(onRefreshLists).toHaveBeenCalledOnce();
    }
  });

  it('treats a failed list for an unadvertised capability as absence', () => {
    const view = mount(panel({ discovery: { ...COMPLETE, prompts: 'failed' }, offered: { prompts: false } }));
    const titles = [...view.querySelectorAll('.capability-empty-title')].map((item) => item.textContent);
    expect(titles).toEqual(['No resources', 'No prompts']);
  });

  it('links an empty tool list to the no-tools article', () => {
    const view = mount(panel({ tools: [] }));
    const tool = [...view.querySelectorAll('.capability-empty-state')][0];
    expect(tool.textContent).toContain('No tools');
    expect(tool.querySelector('a')?.getAttribute('href')).toMatch(/mcp-server-connected-but-no-tools$/);
  });
});

describe('ParamsPanel guided form', () => {
  const render = (selectedTool: unknown, handleParamChange = vi.fn()) => mount(
    <ParamsPanel
      selectedTool={selectedTool}
      selectedResourceTemplate={null}
      selectedPrompt={null}
      toolParams={{}}
      resourceArgs={{}}
      promptParams={{}}
      isConnected
      isConnecting={false}
      handleParamChange={handleParamChange}
      handleResourceArgChange={vi.fn()}
      handleExecuteTool={vi.fn()}
      handleExecutePrompt={vi.fn()}
      handleAccessResource={vi.fn()}
      parseUriTemplateArgs={() => []}
      toolHistory={[]}
      resourceHistory={[]}
      setToolParams={vi.fn()}
      setResourceArgs={vi.fn()}
      isExecuting={false}
      executionStartTime={null}
    />
  );

  it('explains what to do before a tool is selected', () => {
    expect(render(null).textContent).toContain('Pick a tool from Capabilities to call it.');
  });

  it('shows the description, marks required fields and offers schema examples', () => {
    const change = vi.fn();
    const view = render({
      name: 'get_forecast',
      description: 'Returns a forecast.',
      inputSchema: {
        type: 'object',
        properties: { city: { type: 'string', examples: ['Oslo'] }, days: { type: 'integer' } },
        required: ['city'],
      },
    }, change);
    expect(view.querySelector('.capability-description-text')?.textContent).toBe('Returns a forecast.');
    expect(view.querySelector('.param-required-legend')?.textContent).toContain('are required');
    const city = view.querySelector<HTMLInputElement>('#param-city')!;
    expect(city.placeholder).toBe('e.g. Oslo');
    expect(city.getAttribute('aria-describedby')).toBe('param-city-example');
    act(() => view.querySelector<HTMLButtonElement>('.param-example-use')!.click());
    expect(change).toHaveBeenCalledWith('city', 'Oslo');
    expect(view.querySelector('#executeBtn')?.textContent).toBe('Run tool');
  });
});

const plainResult: LogEntry = {
  type: 'tool_result',
  data: [{ type: 'text', text: 'hello' }],
  timestamp: '00:00:00',
  callContext: { serverUrl: 'https://mcp.example.com', type: 'tool', name: 'echo', params: {} },
  toolCall: {
    result: { content: [{ type: 'text', text: 'hello' }] },
    contract: checkToolOutputContract({ name: 'echo' }, { content: [{ type: 'text', text: 'hello' }] }),
  },
};

describe('result explanations', () => {
  it('says what a plain result is and toggles the result JSON without inventing an envelope', () => {
    const view = mount(<ToolResultView logEntry={plainResult} />);
    expect(view.querySelector('.tool-result-explanation')?.textContent).toContain('no structured content');
    const toggle = view.querySelector<HTMLButtonElement>('.tool-result-raw-link')!;
    expect(toggle.textContent).toBe('View result JSON');
    expect(toggle.getAttribute('aria-pressed')).toBe('false');
    act(() => toggle.click());
    expect(toggle.getAttribute('aria-pressed')).toBe('true');
    const explanation = view.querySelector('.tool-result-explanation')?.textContent ?? '';
    expect(explanation).not.toMatch(/exactly as the server sent/i);
    expect(explanation).toContain('rebuilt from what the client parsed');
    expect(explanation).toContain('request id are not shown');
    const json = view.querySelector('.tool-result-view pre')?.textContent ?? '';
    expect(JSON.parse(json)).toEqual(plainResult.toolCall!.result);
    expect(view.textContent).not.toContain('"jsonrpc"');
  });

  it('labels the tabbed JSON-RPC view as reconstructed', () => {
    const result = { content: [{ type: 'text', text: 'hi' }], structuredContent: { ok: true } };
    const view = mount(<ToolResultView logEntry={{
      ...plainResult,
      toolCall: { result, contract: checkToolOutputContract({ name: 'echo' }, result) },
    }} />);
    act(() => view.querySelector<HTMLButtonElement>('.tool-result-raw-link')!.click());
    expect(view.querySelector('[role="tab"][aria-selected="true"]')?.textContent).toBe('JSON-RPC');
    const explanation = view.querySelector('.tool-result-explanation')?.textContent ?? '';
    expect(explanation).not.toMatch(/exactly as the server sent/i);
    expect(explanation).toContain('envelope is reconstructed');
    expect(explanation).toContain('original request id is not shown');
  });

  it('explains isError results without calling the connection broken', () => {
    const result = { content: [{ type: 'text', text: 'no' }], isError: true };
    const view = mount(<ToolResultView logEntry={{
      ...plainResult,
      toolCall: { result, contract: checkToolOutputContract({ name: 'echo' }, result) },
    }} />);
    expect(view.querySelector('.tool-result-explanation')?.textContent).toContain('the connection itself is fine');
    act(() => view.querySelector<HTMLButtonElement>('.tool-result-raw-link')!.click());
    expect(view.querySelector('[role="tab"][aria-selected="true"]')?.textContent).toBe('JSON-RPC');
  });
});

describe('ResultPanel', () => {
  const base = {
    isConnected: true, spaces: [], onAddCardToSpace: vi.fn(), selectedTool: null,
    selectedResourceTemplate: null, toolParams: {}, resourceArgs: {},
  };

  it('says what the panel is for before the first call', () => {
    expect(mount(<ResultPanel {...base} lastResult={null} />).textContent).toContain('No calls yet');
  });

  it('puts plain guidance before the raw error of a failed call', () => {
    const view = mount(<ResultPanel {...base} lastResult={{ type: 'error', data: 'Failed to execute tool x: MCP error -32602: Invalid params', timestamp: '' }} />);
    const failure = view.querySelector('.call-failure')!;
    expect(failure.getAttribute('data-guidance-id')).toBe('invalid-params');
    const text = failure.textContent!;
    expect(text.indexOf('The server rejected the arguments')).toBeLessThan(text.indexOf('MCP error -32602'));
    expect(failure.querySelector('.failure-guidance-learn a')?.getAttribute('href')).toMatch(/mcp-json-rpc-error-codes$/);
  });

  it('offers the share step after a successful run, dismissibly', () => {
    const onDismiss = vi.fn();
    const view = mount(<ResultPanel {...base} lastResult={plainResult} shareReportHref="/report/x" onDismissShareHint={onDismiss} />);
    const hint = view.querySelector('.onboarding-hint--share')!;
    expect(hint.querySelector('a')?.getAttribute('href')).toBe('/report/x');
    expect(hint.textContent).toMatch(/redacted/);
    act(() => hint.querySelector('button')!.click());
    expect(onDismiss).toHaveBeenCalledOnce();
  });
});
