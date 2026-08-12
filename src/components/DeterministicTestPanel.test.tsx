import React, { act } from 'react';
import { createRoot, type Root } from 'react-dom/client';
import { afterAll, afterEach, beforeAll, beforeEach, describe, expect, it, vi } from 'vitest';
import { generateDeterministicTestPlan, serializeDeterministicTestPlan } from '../utils/deterministicTests';
import DeterministicTestPanel from './DeterministicTestPanel';

describe('DeterministicTestPanel', () => {
  let container: HTMLDivElement;
  let root: Root;

  beforeAll(() => {
    (globalThis as typeof globalThis & { IS_REACT_ACT_ENVIRONMENT: boolean }).IS_REACT_ACT_ENVIRONMENT = true;
  });

  afterAll(() => {
    (globalThis as typeof globalThis & { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = false;
  });

  beforeEach(() => {
    container = document.createElement('div');
    document.body.appendChild(container);
    root = createRoot(container);
  });

  afterEach(() => {
    act(() => root.unmount());
    container.remove();
  });

  const renderPanel = async (toolName: string, callTool = vi.fn().mockResolvedValue({ content: [] })) => {
    await act(async () => {
      root.render(
        <DeterministicTestPanel
          open
          onClose={vi.fn()}
          tools={[{ name: toolName, inputSchema: { type: 'object' } }]}
          client={{ callTool } as any}
          serverUrl="https://mcp.example.test/mcp"
          connectionSummary="Streamable HTTP · modern session"
        />
      );
    });
    return callTool;
  };

  const changeText = async (element: HTMLTextAreaElement, value: string) => {
    await act(async () => {
      Object.getOwnPropertyDescriptor(HTMLTextAreaElement.prototype, 'value')?.set?.call(element, value);
      element.dispatchEvent(new Event('input', { bubbles: true }));
    });
  };

  const importPlan = async (contents: string, name = 'fixtures.json') => {
    const input = container.querySelector<HTMLInputElement>('input[type="file"]')!;
    const file = { name, text: vi.fn().mockResolvedValue(contents) } as unknown as File;
    Object.defineProperty(input, 'files', { configurable: true, value: [file] });
    await act(async () => input.dispatchEvent(new Event('change', { bubbles: true })));
  };

  it('shows all generated fixture families and explains connected-session execution', async () => {
    await renderPanel('lookup');

    expect(container.textContent).toContain('Runs use this connected session and require no model or API key.');
    expect(container.textContent).toContain('Happy Path');
    expect(container.textContent).toContain('Validation');
    expect(container.textContent).toContain('Empty Result');
    expect(container.textContent).toContain('Upstream Error');
    expect(container.textContent).toContain('Timeout');
    expect(container.textContent).toContain('Output Shape');
    expect(container.textContent).toContain('Cancellation');
    expect(container.querySelector<HTMLButtonElement>('.deterministic-tests-footer .btn-primary')?.disabled).toBe(false);
  });

  it('requires a fresh explicit confirmation before enabling an inferred destructive tool', async () => {
    const callTool = await renderPanel('delete_account');
    const runButton = container.querySelector<HTMLButtonElement>('.deterministic-tests-footer .btn-primary');
    const confirmation = container.querySelector<HTMLInputElement>('.unsafe-confirmation input');

    expect(container.textContent).toContain('Confirmation required');
    expect(runButton?.disabled).toBe(true);
    expect(confirmation).not.toBeNull();

    await act(async () => confirmation?.click());
    expect(runButton?.disabled).toBe(false);
    expect(callTool).not.toHaveBeenCalled();
  });

  it('invalidates unsafe confirmation when selected fixtures or fixture contents change and after execution', async () => {
    const callTool = await renderPanel('delete_account');
    const confirmation = container.querySelector<HTMLInputElement>('.unsafe-confirmation input')!;
    const runButton = container.querySelector<HTMLButtonElement>('.deterministic-tests-footer .btn-primary')!;
    const selectionInputs = container.querySelectorAll<HTMLInputElement>('.test-case-heading input[type="checkbox"]');

    await act(async () => confirmation.click());
    await act(async () => selectionInputs[1].click());
    expect(confirmation.checked).toBe(false);
    expect(runButton.disabled).toBe(true);

    await act(async () => confirmation.click());
    await act(async () => container.querySelector<HTMLButtonElement>('.test-case-heading .btn-link')?.click());
    const argumentsDraft = container.querySelector<HTMLTextAreaElement>('.test-case-editor textarea')!;
    await changeText(argumentsDraft, '{"accountId":"fixture-2"}');
    expect(confirmation.checked).toBe(false);
    expect(runButton.disabled).toBe(true);

    await act(async () => confirmation.click());
    await act(async () => runButton.click());
    expect(callTool).toHaveBeenCalledTimes(3);
    expect(confirmation.checked).toBe(false);
    expect(runButton.disabled).toBe(true);
  });

  it('invalidates unsafe confirmation when the panel closes or the connected client changes', async () => {
    const firstClient = { callTool: vi.fn().mockResolvedValue({ content: [] }) };
    const render = async (open: boolean, client: typeof firstClient) => {
      await act(async () => {
        root.render(
          <DeterministicTestPanel
            open={open}
            onClose={vi.fn()}
            tools={[{ name: 'delete_account', inputSchema: { type: 'object' } }]}
            client={client as any}
            serverUrl="https://mcp.example.test/mcp"
            connectionSummary="Streamable HTTP · modern session"
          />
        );
      });
    };

    await render(true, firstClient);
    let confirmation = container.querySelector<HTMLInputElement>('.unsafe-confirmation input')!;
    await act(async () => confirmation.click());
    await render(false, firstClient);
    await render(true, firstClient);
    confirmation = container.querySelector<HTMLInputElement>('.unsafe-confirmation input')!;
    expect(confirmation.checked).toBe(false);

    await act(async () => confirmation.click());
    const secondClient = { callTool: vi.fn().mockResolvedValue({ content: [] }) };
    await render(true, secondClient);
    confirmation = container.querySelector<HTMLInputElement>('.unsafe-confirmation input')!;
    expect(confirmation.checked).toBe(false);
  });

  it('keeps argument and assertion draft errors independent and blocks run and export', async () => {
    await renderPanel('lookup');
    await act(async () => container.querySelector<HTMLButtonElement>('.test-case-heading .btn-link')?.click());
    const drafts = container.querySelectorAll<HTMLTextAreaElement>('.test-case-editor textarea');
    const runButton = container.querySelector<HTMLButtonElement>('.deterministic-tests-footer .btn-primary')!;
    const exportButton = [...container.querySelectorAll<HTMLButtonElement>('.deterministic-tests-toolbar button')]
      .find(button => button.textContent === 'Export JSON')!;

    await changeText(drafts[0], '{');
    await changeText(drafts[1], '[]');
    expect(container.textContent).toContain('Invalid fixture arguments');
    expect(runButton.disabled).toBe(true);
    expect(exportButton.disabled).toBe(true);

    await changeText(drafts[0], '{}');
    await changeText(drafts[1], '[{"path":"$.content","operator":"subjective"}]');
    expect(container.textContent).toContain('malformed structural assertion');
    expect(runButton.disabled).toBe(true);
    expect(exportButton.disabled).toBe(true);

    await changeText(drafts[1], '[{"path":"$.content","operator":"type","value":"array"}]');
    expect(container.textContent).not.toContain('malformed structural assertion');
    expect(runButton.disabled).toBe(false);
    expect(exportButton.disabled).toBe(false);
  });

  it('rejects an imported plan containing tools outside the discovered surface', async () => {
    await renderPanel('lookup');
    const imported = generateDeterministicTestPlan(
      [{ name: 'undiscovered_tool' }],
      'https://mcp.example.test/mcp',
      '2026-08-11T00:00:00.000Z',
    );

    await importPlan(serializeDeterministicTestPlan(imported), 'undiscovered.json');

    expect(container.querySelector('.deterministic-tests-notice')?.textContent)
      .toContain('Import failed: Plan contains tools not advertised by the connected server: undiscovered_tool.');
    expect(container.querySelector('.test-tool summary span')?.textContent).toBe('lookup');
  });

  it('runs selected read-only fixtures and renders pass/fail evidence', async () => {
    const callTool = await renderPanel('lookup');
    const runButton = container.querySelector<HTMLButtonElement>('.deterministic-tests-footer .btn-primary');

    await act(async () => runButton?.click());

    expect(callTool).toHaveBeenCalledTimes(2);
    expect(container.querySelectorAll('.test-result')).toHaveLength(2);
    expect(container.textContent).toContain('Redacted request');
    expect(container.textContent).toContain('Reproducible case');
  });
});
