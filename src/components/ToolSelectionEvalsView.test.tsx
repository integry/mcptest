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

  const setDatasetText = (value: string) => {
    const textarea = container.querySelector<HTMLTextAreaElement>('#eval-dataset')!;
    const setter = Object.getOwnPropertyDescriptor(HTMLTextAreaElement.prototype, 'value')?.set;
    setter?.call(textarea, value);
    textarea.dispatchEvent(new Event('input', { bubbles: true }));
  };

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

  it('disables every dataset mutation control while a run is in flight', async () => {
    renderView();
    act(() => button('Suggest cases')?.click());

    act(() => button('Run 27 trials')?.click());

    expect(container.querySelector<HTMLTextAreaElement>('#eval-dataset')?.disabled).toBe(true);
    ['Reset local fixture', 'Suggest cases', 'Validate and use dataset', 'Approve', 'Reject'].forEach(label => {
      expect((button(label) as HTMLButtonElement | undefined)?.disabled).toBe(true);
    });

    await act(async () => {});
  });

  it('preserves a baseline across revisions of the same dataset and resets it for a new identity', async () => {
    renderView();
    await act(async () => {
      button('Run 27 trials')?.click();
    });

    const textarea = container.querySelector<HTMLTextAreaElement>('#eval-dataset')!;
    const revised = JSON.parse(textarea.value);
    revised.descriptionRevision = 'weather-descriptions-v2';
    revised.schemaRevision = 'weather-schemas-v2';
    act(() => setDatasetText(JSON.stringify(revised, null, 2)));
    act(() => button('Validate and use dataset')?.click());

    expect(container.textContent).toContain('Latest results');
    await act(async () => {
      button('Run 27 trials')?.click();
    });
    expect(container.textContent).toContain('Compared with previous run');
    expect(container.textContent).toContain('Description revision changed; schema revision changed');

    const differentDataset = { ...revised, id: 'different-weather-eval' };
    act(() => setDatasetText(JSON.stringify(differentDataset, null, 2)));
    act(() => button('Validate and use dataset')?.click());
    expect(container.textContent).not.toContain('Latest results');
    expect(container.textContent).not.toContain('Compared with previous run');
  });
});
