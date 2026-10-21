import React, { act } from 'react';
import { createRoot, type Root } from 'react-dom/client';
import { afterEach, beforeAll, beforeEach, describe, expect, it, vi } from 'vitest';
import CallHistoryPanel from './CallHistoryPanel';
import DeterministicTestPanel from './DeterministicTestPanel';
import SavedPlanRunAction from './SavedPlanRunAction';
import { createCallHistoryEntry, type CallHistoryEntry } from '../utils/callHistory';
import { createTestPlanFromHistory } from '../utils/historyTestPlan';
import { countPlanResults, loadSavedTestPlans, recordSavedPlanRun, saveTestPlan } from '../utils/savedTestPlans';

beforeAll(() => {
  (globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true;
});

const serverUrl = 'https://saved-plans.example/mcp';
const tools = [
  { name: 'weather', inputSchema: { type: 'object' }, annotations: { readOnlyHint: true } },
  { name: 'create_issue', description: 'Create an issue', inputSchema: { type: 'object' } },
];

let root: Root | null = null;
let container: HTMLDivElement | null = null;

const mount = async (element: React.ReactElement) => {
  container = document.createElement('div');
  document.body.appendChild(container);
  root = createRoot(container);
  await act(async () => root!.render(element));
};

const button = (label: string) => [...container!.querySelectorAll('button')]
  .find((candidate) => candidate.textContent?.trim() === label || candidate.getAttribute('aria-label') === label) as HTMLButtonElement | undefined;

const click = async (target: Element | undefined) => {
  expect(target).toBeDefined();
  await act(async () => { (target as HTMLElement).click(); });
};

const call = (args: Record<string, unknown>, options: { isError?: boolean; toolName?: string } = {}): CallHistoryEntry => createCallHistoryEntry({
  toolName: options.toolName ?? 'weather',
  arguments: args,
  result: options.isError
    ? { type: 'error', data: 'boom', timestamp: '' }
    : { type: 'tool_result', data: [], timestamp: '', toolCall: {
      result: { content: [{ type: 'text', text: `Forecast for ${String(args.city)}` }] },
      contract: { toolName: 'weather', status: 'no-schema', violations: [], hasStructuredContent: false, isError: false },
    } },
  durationMs: 5,
});

beforeEach(() => localStorage.clear());

afterEach(() => {
  act(() => root?.unmount());
  container?.remove();
  root = null;
  container = null;
});

describe('Create test plan from history', () => {
  it('selects every successful call by default and passes the chosen ids', async () => {
    const calls = [call({ city: 'Riga' }), call({ city: 'Oslo' }, { isError: true }), call({ city: 'Tallinn' })];
    const onCreate = vi.fn();
    await mount(
      <CallHistoryPanel
        calls={calls}
        availableToolNames={new Set(['weather'])}
        canRun
        onReplay={vi.fn()}
        onClearServer={vi.fn()}
        onClearAll={vi.fn()}
        onCreateTestPlan={onCreate}
      />
    );
    const boxes = [...container!.querySelectorAll<HTMLInputElement>('.call-history-select input')];
    expect(boxes.map((box) => [box.checked, box.disabled])).toEqual([[true, false], [false, true], [true, false]]);
    expect(container!.textContent).toContain('2 of 2 successful calls selected');

    await click(boxes[2]);
    await click(button('Create test plan from history'));
    expect(onCreate).toHaveBeenCalledWith([calls[0].id]);

    await click(boxes[0]);
    expect(button('Create test plan from history')?.disabled).toBe(true);
  });
});

describe('DeterministicTestPanel saved plans', () => {
  const renderPanel = async (props: Partial<React.ComponentProps<typeof DeterministicTestPanel>> = {}, callTool = vi.fn().mockResolvedValue({ content: [{ type: 'text', text: 'Forecast for Riga' }] })) => {
    await mount(
      <DeterministicTestPanel
        open
        onClose={vi.fn()}
        tools={tools as never}
        client={{ callTool } as never}
        serverUrl={serverUrl}
        connectionSummary="Streamable HTTP"
        {...props}
      />
    );
    return callTool;
  };

  it('opens a plan built from history for editing, saves it and runs it again from the list', async () => {
    const { plan } = createTestPlanFromHistory([call({ city: 'Riga' })], tools, serverUrl);
    const callTool = await renderPanel({ initialPlan: plan, initialNotice: 'Created 1 case from call history.' });
    expect(container!.textContent).toContain('Created 1 case from call history.');
    expect(container!.textContent).toContain('Recorded call 1');
    expect(container!.textContent).toContain('Save a plan to run it again later');

    await click(button('Save plan'));
    const [saved] = loadSavedTestPlans(serverUrl);
    expect(saved.plan.tools[0].cases[0].arguments).toEqual({ city: 'Riga' });
    expect(container!.textContent).toContain(`Saved "${saved.name}" for this endpoint.`);
    expect(button('Save changes')).toBeDefined();

    await click(button(`Run ${saved.name}`));
    expect(callTool).toHaveBeenCalledWith({ name: 'weather', arguments: { city: 'Riga' } }, expect.anything());
    expect(loadSavedTestPlans(serverUrl)[0].lastRun).toMatchObject({ total: 1, passed: 1, source: 'playground' });
    expect(container!.textContent).toContain('1 passed · 0 failed');
  });

  it('renames and deletes saved plans', async () => {
    const { plan } = createTestPlanFromHistory([call({ city: 'Riga' })], tools, serverUrl);
    const saved = saveTestPlan(serverUrl, plan, { name: 'Smoke' });
    await renderPanel();
    await click(button('Rename Smoke'));
    const input = container!.querySelector<HTMLInputElement>('.saved-test-plan-rename input')!;
    await act(async () => {
      Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, 'value')?.set?.call(input, 'Nightly');
      input.dispatchEvent(new Event('input', { bubbles: true }));
    });
    await click(button('Save name'));
    expect(loadSavedTestPlans(serverUrl)[0]).toMatchObject({ id: saved.id, name: 'Nightly' });

    await click(button('Delete Nightly'));
    expect(loadSavedTestPlans(serverUrl)).toEqual([]);
    expect(container!.textContent).toContain('Deleted "Nightly".');
  });

  it('exports a saved plan as JSON', async () => {
    const { plan } = createTestPlanFromHistory([call({ city: 'Riga' })], tools, serverUrl);
    saveTestPlan(serverUrl, plan, { name: 'Smoke' });
    const urlStatics = URL as unknown as Record<'createObjectURL' | 'revokeObjectURL', unknown>;
    const original = { createObjectURL: urlStatics.createObjectURL, revokeObjectURL: urlStatics.revokeObjectURL };
    const createObjectURL = vi.fn((_blob: Blob) => 'blob:plan');
    urlStatics.createObjectURL = createObjectURL;
    urlStatics.revokeObjectURL = vi.fn();
    const clickSpy = vi.spyOn(HTMLAnchorElement.prototype, 'click').mockImplementation(() => undefined);
    try {
      await renderPanel();
      await click(button('Export Smoke as JSON'));
      const blob = createObjectURL.mock.calls[0][0];
      const text = await new Promise<string>((resolve) => {
        const reader = new FileReader();
        reader.onload = () => resolve(String(reader.result));
        reader.readAsText(blob);
      });
      expect(JSON.parse(text)).toMatchObject({ version: '1.0.0', name: 'Smoke' });
      expect(clickSpy).toHaveBeenCalled();
    } finally {
      clickSpy.mockRestore();
      Object.assign(urlStatics, original);
    }
  });

  it('loads a plan with write-capable tools without running it', async () => {
    const { plan } = createTestPlanFromHistory([call({ title: 'Bug' }, { toolName: 'create_issue' })], tools, serverUrl);
    const saved = saveTestPlan(serverUrl, plan, { name: 'Writes' });
    const callTool = await renderPanel();
    await click(button(`Run ${saved.name}`));
    expect(callTool).not.toHaveBeenCalled();
    expect(container!.textContent).toContain('confirm them below, then run');
  });
});

describe('SavedPlanRunAction', () => {
  it('stays hidden without a saved plan for the endpoint', async () => {
    await mount(<SavedPlanRunAction endpoint={serverUrl} disabled={false} onRun={vi.fn()} />);
    expect(container!.textContent).toBe('');
  });

  it('offers the newest plan and asks before running write-capable tools', async () => {
    const { plan } = createTestPlanFromHistory([
      call({ title: 'Bug' }, { toolName: 'create_issue' }),
      call({ city: 'Riga' }),
    ], tools, serverUrl);
    const saved = saveTestPlan(serverUrl, plan, { name: 'Smoke' });
    recordSavedPlanRun(serverUrl, saved.id, countPlanResults([{ status: 'passed' }, { status: 'failed' }], 'report'));
    const onRun = vi.fn();
    await mount(<SavedPlanRunAction endpoint={serverUrl} disabled={false} onRun={onRun} />);
    expect(container!.textContent).toContain('Smoke · 2 runnable cases · last run: 1 passed · 1 failed');

    await click(button('Run saved plan'));
    expect(onRun).toHaveBeenLastCalledWith(expect.objectContaining({ id: saved.id, endpoint: serverUrl, confirmedUnsafeToolNames: [] }));

    await click(container!.querySelector('.saved-plan-run-confirm input')!);
    await click(button('Run saved plan'));
    expect(onRun).toHaveBeenLastCalledWith(expect.objectContaining({ confirmedUnsafeToolNames: ['create_issue'] }));
  });
});
