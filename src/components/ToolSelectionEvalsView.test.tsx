import React, { act } from 'react';
import { createRoot, type Root } from 'react-dom/client';
import { afterEach, beforeAll, describe, expect, it } from 'vitest';
import ToolSelectionEvalsView from './ToolSelectionEvalsView';

beforeAll(() => {
  (globalThis as typeof globalThis & { IS_REACT_ACT_ENVIRONMENT: boolean }).IS_REACT_ACT_ENVIRONMENT = true;
});

describe('ToolSelectionEvalsView local workflow', () => {
  let root: Root | undefined;
  let container: HTMLDivElement;

  afterEach(() => {
    if (root) act(() => root?.unmount());
    root = undefined;
  });

  const renderView = () => {
    container = document.createElement('div');
    root = createRoot(container);
    act(() => root?.render(<ToolSelectionEvalsView />));
  };

  const button = (text: string) => Array.from(container.querySelectorAll('button')).find(item => item.textContent?.includes(text));

  it('runs the complete fixture flow without a paid provider', async () => {
    renderView();
    expect(container.textContent).toContain('Local fixture (no API call)');
    expect(container.textContent).toContain('isolated model evaluations');
    expect(button('Run 27 trials')).toBeTruthy();

    await act(async () => {
      button('Run 27 trials')?.click();
    });

    expect(container.textContent).toContain('Latest results');
    expect(container.textContent).toContain('With MCP tools');
    expect(container.textContent).toContain('Without MCP tools');
    expect(container.textContent).toContain('Tool data as plain context');

    await act(async () => {
      button('Run 27 trials')?.click();
    });
    expect(container.textContent).toContain('Compared with previous run');
  });

  it('keeps generated cases out of the run until they are approved', () => {
    renderView();
    act(() => button('Suggest cases')?.click());
    expect(container.textContent).toContain('3 still need review');
    expect(button('Run 27 trials')).toBeTruthy();

    act(() => button('Approve')?.click());
    expect(container.textContent).toContain('2 still need review');
    expect(button('Run 36 trials')).toBeTruthy();
  });
});
