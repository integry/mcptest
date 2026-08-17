import React from 'react';
import { JSDOM } from 'jsdom';
import { renderToStaticMarkup } from 'react-dom/server';
import { describe, expect, it, vi } from 'vitest';
import { LogEntry, Space } from '../types';
import OutputPanel from './OutputPanel';

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
