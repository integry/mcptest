import React, { act } from 'react';
import { JSDOM } from 'jsdom';
import { createRoot, type Root } from 'react-dom/client';
import { renderToStaticMarkup } from 'react-dom/server';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { LogEntry, Space } from '../types';
import OutputPanel, { describeCompletedCall } from './OutputPanel';

const result: LogEntry = {
  type: 'tool_result',
  data: [{ type: 'text', text: 'ok' }],
  timestamp: '2026-08-17T23:23:59Z',
  callContext: {
    serverUrl: 'https://mcp.example.com',
    type: 'tool',
    name: 'example_tool',
    params: {},
  },
};

const renderAddToDashboardButtons = (spaces: Space[]) => {
  const markup = renderToStaticMarkup(
    <OutputPanel
      lastResult={result}
      responses={[result]}
      autoScroll={true}
      setAutoScroll={vi.fn()}
      handleClearResponse={vi.fn()}
      isConnected={true}
      spaces={spaces}
      onAddCardToSpace={vi.fn()}
      serverUrl="https://mcp.example.com"
      selectedTool={null}
      selectedResourceTemplate={null}
      toolParams={{}}
      resourceArgs={{}}
    />
  );
  const document = new JSDOM(markup).window.document;

  return (Array.from(document.querySelectorAll('button')) as HTMLButtonElement[]).filter(
    (button) => button.textContent?.trim() === 'Add to dashboard'
  );
};

describe('OutputPanel add-to-dashboard actions', () => {
  it('uses the toolbar ghost treatment for a single dashboard', () => {
    const buttons = renderAddToDashboardButtons([
      { id: 'dashboard-1', name: 'Dashboard', cards: [] },
    ]);

    expect(buttons).toHaveLength(2);
    buttons.forEach((button) => {
      expect(button.classList.contains('btn-ghost')).toBe(true);
      expect(button.classList.contains('btn-outline-primary')).toBe(false);
    });
  });

  it('keeps the same treatment when the action opens a dashboard menu', () => {
    const buttons = renderAddToDashboardButtons([
      { id: 'dashboard-1', name: 'First dashboard', cards: [] },
      { id: 'dashboard-2', name: 'Second dashboard', cards: [] },
    ]);

    expect(buttons).toHaveLength(2);
    buttons.forEach((button) => {
      expect(button.classList.contains('btn-ghost')).toBe(true);
      expect(button.classList.contains('dropdown-toggle')).toBe(true);
      expect(button.classList.contains('btn-outline-primary')).toBe(false);
    });
  });
});

describe('OutputPanel call outcome announcements', () => {
  let host: HTMLDivElement;
  let field: HTMLInputElement;
  let root: Root;

  const panel = (lastResult: LogEntry | null) => (
    <OutputPanel
      lastResult={lastResult}
      responses={lastResult ? [lastResult] : []}
      autoScroll={true}
      setAutoScroll={vi.fn()}
      handleClearResponse={vi.fn()}
      isConnected={true}
      spaces={[]}
      onAddCardToSpace={vi.fn()}
      serverUrl="https://mcp.example.com"
      selectedTool={null}
      selectedResourceTemplate={null}
      toolParams={{}}
      resourceArgs={{}}
    />
  );

  const status = () => host.querySelector('.output-panel > [role="status"]')!;

  // A run started with Enter: focus is in a form field, the previous result is
  // cleared when the run starts, then a fresh result entry arrives.
  const runFromField = (entry: LogEntry) => {
    field.focus();
    act(() => root.render(panel(null)));
    act(() => root.render(panel(entry)));
  };

  const toolResult = (isError = false): LogEntry => ({
    ...result,
    toolCall: {
      result: { content: [{ type: 'text', text: 'ok' }], isError },
      contract: { toolName: 'example_tool', status: 'no-schema', violations: [], hasStructuredContent: false, isError },
    },
  });
  const failure = (): LogEntry => ({ type: 'error', data: 'Failed to execute tool example_tool: boom', timestamp: '2026-08-17T23:24:00Z' });

  beforeEach(() => {
    (globalThis as typeof globalThis & { IS_REACT_ACT_ENVIRONMENT: boolean }).IS_REACT_ACT_ENVIRONMENT = true;
    field = document.createElement('input');
    document.body.appendChild(field);
    host = document.createElement('div');
    document.body.appendChild(host);
    root = createRoot(host);
    act(() => root.render(panel(null)));
  });

  afterEach(() => {
    act(() => root.unmount());
    host.remove();
    field.remove();
  });

  it('changes the live region for consecutive successful runs of the same tool', () => {
    runFromField(toolResult());
    const first = status().textContent;
    expect(first).toBe('Call 1: example_tool returned a result.');
    runFromField(toolResult());
    expect(status().textContent).toBe('Call 2: example_tool returned a result.');
    expect(status().textContent).not.toBe(first);
    expect(document.activeElement).toBe(field);
  });

  it('changes the live region for consecutive failed calls', () => {
    runFromField(failure());
    expect(status().textContent).toBe('Call 1: The call failed. The result panel explains what happened.');
    runFromField(failure());
    expect(status().textContent).toBe('Call 2: The call failed. The result panel explains what happened.');
    expect(document.activeElement).toBe(field);
  });

  it('changes the live region for consecutive isError tool results', () => {
    runFromField(toolResult(true));
    runFromField(toolResult(true));
    expect(status().textContent).toBe('Call 2: example_tool reported an error result.');
  });

  it('does not count a re-render of the same result as another call', () => {
    const entry = toolResult();
    runFromField(entry);
    act(() => root.render(panel(entry)));
    expect(status().textContent).toBe('Call 1: example_tool returned a result.');
  });

  it('numbers the announcement text', () => {
    expect(describeCompletedCall(failure(), 7)).toBe('Call 7: The call failed. The result panel explains what happened.');
  });
});
