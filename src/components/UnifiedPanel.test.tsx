import React, { act } from 'react';
import { createRoot, type Root } from 'react-dom/client';
import { afterEach, beforeAll, describe, expect, it, vi } from 'vitest';
import { UnifiedPanel } from './UnifiedPanel';

beforeAll(() => {
  (globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true;
});

let root: Root | null = null;
let container: HTMLDivElement | null = null;

afterEach(() => {
  act(() => root?.unmount());
  container?.remove();
  root = null;
  container = null;
});

const tools = [
  { name: 'search_issues', description: 'Search GitHub issues', inputSchema: { type: 'object' } },
  { name: 'create_issue', title: 'Create issue', description: 'Open a new issue', inputSchema: { type: 'object' } },
  { name: 'list_repos', description: 'List repositories', inputSchema: { type: 'object' } },
];
const resources = [{ name: 'readme', uri: 'file:///README.md', description: 'Project readme' }];
const prompts = [{ name: 'triage_issue', description: 'Triage an issue' }];

const renderPanel = (overrides: Partial<React.ComponentProps<typeof UnifiedPanel>> = {}) => {
  const handlers = {
    handleSelectTool: vi.fn(),
    handleSelectResource: vi.fn(),
    handleSelectResourceTemplate: vi.fn(),
    handleSelectPrompt: vi.fn(),
  };
  container = document.createElement('div');
  document.body.appendChild(container);
  root = createRoot(container);
  act(() => {
    root!.render(
      <UnifiedPanel
        tools={tools as never}
        resources={resources as never}
        resourceTemplates={[]}
        prompts={prompts as never}
        selectedTool={null}
        selectedResourceTemplate={null}
        selectedPrompt={null}
        connectionStatus="Connected"
        onRefreshLists={vi.fn()}
        isConnecting={false}
        shortcutEnabled
        {...handlers}
        {...overrides}
      />
    );
  });
  return handlers;
};

const search = () => container!.querySelector<HTMLInputElement>('input[type="search"]')!;

const type = (value: string) => {
  const input = search();
  const setter = Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, 'value')!.set!;
  act(() => {
    setter.call(input, value);
    input.dispatchEvent(new Event('input', { bubbles: true }));
  });
};

const press = (target: EventTarget, key: string) => {
  act(() => {
    target.dispatchEvent(new KeyboardEvent('keydown', { key, bubbles: true, cancelable: true }));
  });
};

const optionNames = () => [...container!.querySelectorAll('[role="option"] .item-name')].map((node) => node.textContent);

describe('UnifiedPanel search', () => {
  it('filters tools, resources and prompts together and shows counts per kind', () => {
    renderPanel();
    expect(container!.querySelector('.capability-search-summary')?.textContent).toBe('3 tools · 1 resource · 1 prompt');

    type('issue');
    expect(optionNames()).toEqual(['search_issues', 'create_issue', 'triage_issue']);
    expect(container!.querySelector('.capability-search-summary')?.textContent).toBe('2 tools · 0 resources · 1 prompt match');
    const summaries = [...container!.querySelectorAll('summary')].map((node) => node.textContent);
    expect(summaries).toEqual(['▶Tools (2 of 3)', '▶Resources (0 of 1)', '▶Prompts (1 of 1)']);
    expect(container!.textContent).toContain('No matching resources');
  });

  it('highlights matched characters', () => {
    renderPanel();
    type('lr');
    const marks = [...container!.querySelectorAll('[role="option"] .item-name mark')].map((node) => node.textContent);
    expect(optionNames()).toEqual(['list_repos']);
    expect(marks).toEqual(['l', 'r']);
  });

  it('moves through results with the arrow keys and selects with Enter', () => {
    const handlers = renderPanel();
    type('issue');
    const input = search();
    press(input, 'ArrowDown');
    press(input, 'ArrowDown');
    const active = container!.querySelector('[role="option"].active');
    expect(active?.querySelector('.item-name')?.textContent).toBe('create_issue');
    expect(input.getAttribute('aria-activedescendant')).toBe(active?.id);

    press(input, 'ArrowDown');
    press(input, 'ArrowDown');
    expect(container!.querySelector('[role="option"].active .item-name')?.textContent).toBe('triage_issue');
    press(input, 'Enter');
    expect(handlers.handleSelectPrompt).toHaveBeenCalledWith(prompts[0]);

    press(input, 'ArrowUp');
    press(input, 'Enter');
    expect(handlers.handleSelectTool).toHaveBeenCalledWith(tools[1]);
  });

  it('selects the best match on Enter without arrowing', () => {
    const handlers = renderPanel();
    type('readme');
    press(search(), 'Enter');
    expect(handlers.handleSelectResource).toHaveBeenCalledWith(resources[0]);
  });

  it('clears the query with Escape', () => {
    renderPanel();
    type('issue');
    press(search(), 'Escape');
    expect(search().value).toBe('');
    expect(optionNames()).toHaveLength(5);
  });

  it('focuses the search field with / when nothing editable has focus', () => {
    renderPanel();
    expect(document.activeElement).not.toBe(search());
    press(document.body, '/');
    expect(document.activeElement).toBe(search());
  });

  it('leaves / alone while another field has focus', () => {
    renderPanel();
    const other = document.createElement('textarea');
    document.body.appendChild(other);
    other.focus();
    press(other, '/');
    expect(document.activeElement).toBe(other);
    other.remove();
  });

  it('works while the closed navigation drawer is marked as a modal dialog', () => {
    renderPanel();
    const drawer = document.createElement('div');
    drawer.className = 'mobile-sidebar';
    drawer.setAttribute('role', 'dialog');
    drawer.setAttribute('aria-modal', 'true');
    document.body.appendChild(drawer);
    press(document.body, '/');
    expect(document.activeElement).toBe(search());
    drawer.remove();
  });

  it('leaves / to an open navigation drawer', () => {
    renderPanel();
    document.body.classList.add('menu-open');
    press(document.body, '/');
    expect(document.activeElement).not.toBe(search());
    document.body.classList.remove('menu-open');
  });

  it('leaves / to an open modal dialog', () => {
    renderPanel();
    const dialog = document.createElement('section');
    dialog.setAttribute('role', 'dialog');
    dialog.setAttribute('aria-modal', 'true');
    document.body.appendChild(dialog);
    press(document.body, '/');
    expect(document.activeElement).not.toBe(search());
    dialog.remove();
  });

  it('ignores / on inactive tabs', () => {
    renderPanel({ shortcutEnabled: false });
    press(document.body, '/');
    expect(document.activeElement).not.toBe(search());
  });

  it('keeps up with 500 synthetic tools', () => {
    const many = Array.from({ length: 500 }, (_, index) => ({
      name: `tool_${index}_${index % 2 ? 'read' : 'write'}`,
      description: `Synthetic tool ${index}`,
      inputSchema: { type: 'object' },
    }));
    renderPanel({ tools: many as never, resources: [], prompts: [] });
    const started = performance.now();
    type('tool_49');
    type('tool_499');
    const elapsed = performance.now() - started;
    expect(optionNames()).toEqual(['tool_499_read']);
    expect(elapsed).toBeLessThan(1000);
  });
});
