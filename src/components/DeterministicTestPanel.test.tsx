import React, { act } from 'react';
import { createRoot, type Root } from 'react-dom/client';
import { afterAll, afterEach, beforeAll, beforeEach, describe, expect, it, vi } from 'vitest';
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
