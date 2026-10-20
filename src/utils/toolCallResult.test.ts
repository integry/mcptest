import { afterEach, describe, expect, it } from 'vitest';
import { clearRecordedOutputContractResults, getRecordedOutputContractResults } from './outputContract';
import { createToolResultLogEntry } from './toolCallResult';

describe('createToolResultLogEntry', () => {
  afterEach(() => clearRecordedOutputContractResults());

  it('keeps content blocks as data, attaches the full result and records the verdict', () => {
    const result = { content: [{ type: 'text', text: 'ok' }], structuredContent: { count: 'one' } };
    const entry = createToolResultLogEntry(
      { name: 'count', outputSchema: { type: 'object', properties: { count: { type: 'number' } } } },
      result,
      { serverUrl: 'https://mcp.example.com/mcp', type: 'tool', name: 'count', params: {} },
    );

    expect(entry.type).toBe('tool_result');
    expect(entry.data).toBe(result.content);
    expect(entry.toolCall?.result).toBe(result);
    expect(entry.toolCall?.contract).toMatchObject({ status: 'fail' });
    expect(getRecordedOutputContractResults('https://mcp.example.com/mcp')).toEqual([entry.toolCall?.contract]);
  });
});
