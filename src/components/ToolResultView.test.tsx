import React, { act } from 'react';
import { createRoot, type Root } from 'react-dom/client';
import { renderToStaticMarkup } from 'react-dom/server';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import type { LogEntry } from '../types';
import { checkToolOutputContract } from '../utils/outputContract';
import ToolResultView from './ToolResultView';
import ToolSchemaDetails from './ToolSchemaDetails';

const outputSchema = {
  type: 'object',
  properties: { city: { type: 'string' }, temperature: { type: 'number' } },
  required: ['city', 'temperature'],
};

const toolResultEntry = (
  result: Record<string, unknown> & { content: unknown[] },
  schema: unknown = outputSchema
): LogEntry => (schema === null ? {
  type: 'tool_result',
  data: result.content,
  timestamp: '00:00:00',
  toolCall: { result, contract: checkToolOutputContract({ name: 'get_weather' }, result) },
} : {
  type: 'tool_result',
  data: result.content,
  timestamp: '00:00:00',
  callContext: { serverUrl: 'https://mcp.example.com', type: 'tool', name: 'get_weather', params: {} },
  toolCall: {
    result,
    outputSchema: schema,
    contract: checkToolOutputContract({ name: 'get_weather', outputSchema: schema }, result),
  },
});

describe('ToolSchemaDetails', () => {
  it('shows input and output schemas collapsed with JSON styling', () => {
    const markup = renderToStaticMarkup(
      <ToolSchemaDetails tool={{ inputSchema: { type: 'object' }, outputSchema }} />
    );
    const container = document.createElement('div');
    container.innerHTML = markup;
    const details = [...container.querySelectorAll('details')];

    expect(details.map(item => item.querySelector('summary')?.textContent)).toEqual(['Input schema', 'Output schema']);
    expect(details.every(item => !item.open)).toBe(true);
    expect(details[1].querySelector('.event-data pre code.language-json')?.textContent)
      .toBe(JSON.stringify(outputSchema, null, 2));
  });

  it('omits the output schema block when the tool declares none', () => {
    const markup = renderToStaticMarkup(<ToolSchemaDetails tool={{ inputSchema: { type: 'object' } }} />);

    expect(markup).toContain('Input schema');
    expect(markup).not.toContain('Output schema');
  });
});

describe('ToolResultView', () => {
  let container: HTMLDivElement;
  let root: Root;

  beforeEach(() => {
    (globalThis as typeof globalThis & { IS_REACT_ACT_ENVIRONMENT: boolean }).IS_REACT_ACT_ENVIRONMENT = true;
    container = document.createElement('div');
    document.body.appendChild(container);
    root = createRoot(container);
  });

  afterEach(() => {
    act(() => root.unmount());
    container.remove();
    (globalThis as typeof globalThis & { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = false;
  });

  const render = (entry: LogEntry) => act(() => root.render(<ToolResultView logEntry={entry} />));
  const tab = (label: string) => [...container.querySelectorAll<HTMLButtonElement>('[role="tab"]')]
    .find(button => button.textContent === label)!;

  it('renders structured content first and toggles to content blocks and the raw response', () => {
    const result = {
      content: [{ type: 'text', text: '**Sunny** in Oslo' }],
      structuredContent: { city: 'Oslo', temperature: 4 },
    };
    render(toolResultEntry(result));

    expect([...container.querySelectorAll('[role="tab"]')].map(item => item.textContent))
      .toEqual(['Structured', 'Content', 'JSON-RPC']);
    expect(tab('Structured').getAttribute('aria-selected')).toBe('true');
    expect(container.querySelector('[role="tabpanel"] code')?.textContent)
      .toBe(JSON.stringify(result.structuredContent, null, 2));
    expect(container.querySelector('.output-contract--pass')?.textContent)
      .toBe('Structured output matches the declared output schema.');

    act(() => tab('Content').click());
    expect(container.querySelector('[role="tabpanel"] strong')?.textContent).toBe('Sunny');

    act(() => tab('JSON-RPC').click());
    expect(JSON.parse(container.querySelector('[role="tabpanel"] code')?.textContent || '')).toEqual({
      jsonrpc: '2.0',
      result,
    });
  });

  it('lists violations in plain language when validation fails', () => {
    render(toolResultEntry({ content: [], structuredContent: { city: 7 } }));

    const verdict = container.querySelector('.output-contract--fail')!;
    expect(verdict.getAttribute('role')).toBe('alert');
    expect(verdict.textContent).toContain('Output contract broken: 2 problems found');
    const reference = verdict.querySelector<HTMLAnchorElement>('.output-contract-heading a');
    expect(reference?.getAttribute('href'))
      .toBe('/learn/mcp-transport-diagnostics-reference#tool-output-contract-violation');
    expect(reference?.textContent).toBe('tool.output-contract-violation Learn more');
    expect([...verdict.querySelectorAll('li')].map(item => [
      item.querySelector('code')?.textContent,
      item.querySelector('span')?.textContent,
    ])).toEqual([
      ['structuredContent.temperature', 'Required property "temperature" is missing.'],
      ['structuredContent.city', 'Expected string but got number.'],
    ]);
  });

  it('flags a missing structuredContent when a schema is declared', () => {
    render(toolResultEntry({ content: [{ type: 'text', text: 'Oslo, 4 degrees' }] }));

    expect(container.querySelector('.output-contract--fail')?.textContent)
      .toContain('declares an outputSchema but returned no structuredContent');
    expect([...container.querySelectorAll('[role="tab"]')].map(item => item.textContent))
      .toEqual(['Content', 'JSON-RPC']);
    expect(container.querySelector('[role="tabpanel"]')?.textContent).toContain('Oslo, 4 degrees');
  });

  it('shows structured content without a verdict when no schema is declared', () => {
    render(toolResultEntry({ content: [], structuredContent: { free: 'form' } }, null));

    expect(container.querySelector('.output-contract')).toBeNull();
    expect(container.textContent).toContain('declares no output schema');
    expect(tab('Structured').getAttribute('aria-selected')).toBe('true');
  });

  it('respects isError and skips validation for error results', () => {
    render(toolResultEntry({ content: [{ type: 'text', text: 'Upstream failed' }], isError: true }));

    expect(container.querySelector('.tool-result-error')?.textContent).toContain('isError: true');
    expect(container.querySelector('.output-contract--fail')).toBeNull();
    expect(container.querySelector('.output-contract--neutral')?.textContent).toContain('Not validated');
  });

  it('renders plain content results exactly as before', () => {
    const entry: LogEntry = {
      type: 'tool_result',
      data: [{ type: 'text', text: 'plain' }],
      timestamp: '00:00:00',
      toolCall: {
        result: { content: [{ type: 'text', text: 'plain' }] },
        contract: checkToolOutputContract({ name: 'echo' }, { content: [] }),
      },
    };
    render(entry);

    expect(container.querySelector('[role="tablist"]')).toBeNull();
    expect(container.querySelector('.spaces-mode')?.textContent).toContain('plain');
  });

  it('returns to the structured view when a new result arrives', () => {
    render(toolResultEntry({ content: [], structuredContent: { city: 'Oslo', temperature: 1 } }));
    act(() => tab('JSON-RPC').click());
    render(toolResultEntry({ content: [], structuredContent: { city: 'Bergen', temperature: 2 } }));

    expect(tab('Structured').getAttribute('aria-selected')).toBe('true');
  });
});
