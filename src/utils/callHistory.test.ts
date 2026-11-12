import { describe, expect, it } from 'vitest';
import type { LogEntry } from '../types';
import {
  CALL_HISTORY_LIMIT_PER_SERVER,
  CALL_HISTORY_STORAGE_KEY,
  callHistoryCounts,
  clearAllCallHistory,
  clearCallHistory,
  createCallHistoryEntry,
  loadCallHistory,
  recordCallHistoryEntry,
  replayArguments,
  summarizeCallResult,
  toJsonRpcRequest,
} from './callHistory';

const memoryStorage = () => {
  const values = new Map<string, string>();
  return {
    getItem: (key: string) => values.get(key) ?? null,
    setItem: (key: string, value: string) => { values.set(key, value); },
    removeItem: (key: string) => { values.delete(key); },
    raw: () => values.get(CALL_HISTORY_STORAGE_KEY) ?? '',
  };
};

const toolResult = (overrides: Partial<LogEntry> = {}): LogEntry => ({
  type: 'tool_result',
  data: [{ type: 'text', text: 'Sunny, 21 °C' }],
  timestamp: '10:00:00',
  toolCall: {
    result: { content: [{ type: 'text', text: 'Sunny, 21 °C' }], structuredContent: { temp: 21 } },
    outputSchema: { type: 'object' },
    contract: { toolName: 'weather', status: 'pass', violations: [], hasStructuredContent: true, isError: false },
  },
  ...overrides,
});

const SERVER = 'https://mcp.example.com/mcp';

describe('createCallHistoryEntry', () => {
  it('keeps the call outcome, duration and structured-output verdict', () => {
    const entry = createCallHistoryEntry({
      toolName: 'weather',
      arguments: { city: 'Riga', days: 2 },
      result: toolResult(),
      durationMs: 123.6,
      calledAt: '2026-10-20T10:00:00.000Z',
    });
    expect(entry).toMatchObject({
      toolName: 'weather',
      arguments: { city: 'Riga', days: 2 },
      argumentsRedacted: false,
      resultSummary: 'Sunny, 21 °C',
      durationMs: 124,
      isError: false,
      outputVerdict: 'pass',
      outputViolationCount: 0,
      calledAt: '2026-10-20T10:00:00.000Z',
    });
  });

  it('redacts secrets in arguments the way report snapshots are redacted', () => {
    const entry = createCallHistoryEntry({
      toolName: 'deploy',
      arguments: {
        apiKey: 'sk-live-should-not-persist',
        headers: { Authorization: 'Bearer abc.def.ghi' },
        note: 'token=supersecretvalue',
        title: 'Rotate ghp_abcdefghijklmnopqrstuvwxyz0123456789 today',
        tags: ['AKIAABCDEFGHIJKLMNOP'],
        target: 'production',
      },
      result: toolResult(),
      durationMs: 10,
    });
    const serialized = JSON.stringify(entry);
    expect(serialized).not.toContain('sk-live-should-not-persist');
    expect(serialized).not.toContain('abc.def.ghi');
    expect(serialized).not.toContain('supersecretvalue');
    expect(serialized).not.toContain('ghp_abcdefghij');
    expect(serialized).not.toContain('AKIAABCDEFGHIJKLMNOP');
    expect(entry.arguments.title).toBe('Rotate [REDACTED] today');
    expect(entry.arguments.target).toBe('production');
    expect(entry.argumentsRedacted).toBe(true);
  });

  it('redacts secrets echoed in the result summary', () => {
    const entry = createCallHistoryEntry({
      toolName: 'whoami',
      arguments: {},
      result: toolResult({
        toolCall: {
          result: { content: [{ type: 'text', text: 'Use Authorization: Bearer eyJhbGciOi.eyJzdWIi.c2lnbmF0dXJl or sk-proj-abcdefghijklmnopqrstuvwx now' }] },
          contract: { toolName: 'whoami', status: 'no-schema', violations: [], hasStructuredContent: false, isError: false },
        },
      }),
      durationMs: 5,
    });
    expect(entry.resultSummary).not.toContain('eyJhbGciOi');
    expect(entry.resultSummary).not.toContain('sk-proj-abcdefghij');
    expect(entry.outputVerdict).toBeUndefined();
  });
});

describe('summarizeCallResult', () => {
  it('marks errors, isError results and broken output contracts', () => {
    expect(summarizeCallResult({ type: 'error', data: 'Failed to execute tool x: boom', timestamp: '' }))
      .toEqual({ resultSummary: 'Failed to execute tool x: boom', isError: true });
    expect(summarizeCallResult(toolResult({
      toolCall: {
        result: { content: [{ type: 'text', text: 'nope' }], isError: true },
        contract: { toolName: 'weather', status: 'not-checked', violations: [], hasStructuredContent: false, isError: true },
      },
    })).isError).toBe(true);
    expect(summarizeCallResult(toolResult({
      toolCall: {
        result: { content: [] },
        contract: {
          toolName: 'weather', status: 'fail', hasStructuredContent: false, isError: false,
          violations: [{ path: '$', message: 'missing structuredContent', keyword: 'required' } as never],
        },
      },
    }))).toMatchObject({ resultSummary: 'Empty result', outputVerdict: 'fail', outputViolationCount: 1 });
  });

  it('summarizes non-text content and truncates long text', () => {
    expect(summarizeCallResult(toolResult({
      toolCall: {
        result: { content: [{ type: 'image', data: 'x' }, { type: 'image', data: 'y' }] },
        contract: { toolName: 'weather', status: 'no-schema', violations: [], hasStructuredContent: false, isError: false },
      },
    })).resultSummary).toBe('2 content blocks (image)');
    const long = summarizeCallResult(toolResult({
      toolCall: {
        result: { content: [{ type: 'text', text: 'word '.repeat(100) }] },
        contract: { toolName: 'weather', status: 'no-schema', violations: [], hasStructuredContent: false, isError: false },
      },
    })).resultSummary;
    expect(long.length).toBeLessThanOrEqual(160);
    expect(long.endsWith('…')).toBe(true);
  });
});

describe('call history store', () => {
  const entry = (index: number, isError = false) => createCallHistoryEntry({
    toolName: `tool_${index}`,
    arguments: { index },
    result: isError ? { type: 'error', data: 'boom', timestamp: '' } : toolResult(),
    durationMs: index,
    calledAt: new Date(Date.UTC(2026, 9, 20, 10, 0, index)).toISOString(),
  });

  it(`keeps the newest ${CALL_HISTORY_LIMIT_PER_SERVER} calls per server, newest first`, () => {
    const storage = memoryStorage();
    for (let index = 0; index < CALL_HISTORY_LIMIT_PER_SERVER + 7; index += 1) {
      recordCallHistoryEntry(SERVER, entry(index), storage);
    }
    const calls = loadCallHistory(SERVER, storage);
    expect(calls).toHaveLength(CALL_HISTORY_LIMIT_PER_SERVER);
    expect(calls[0].toolName).toBe(`tool_${CALL_HISTORY_LIMIT_PER_SERVER + 6}`);
    expect(calls[calls.length - 1].toolName).toBe('tool_7');
  });

  it('groups servers by normalized endpoint and clears one or all', () => {
    const storage = memoryStorage();
    recordCallHistoryEntry('https://MCP.example.com/mcp', entry(1), storage);
    recordCallHistoryEntry('https://other.example.com/mcp', entry(2, true), storage);
    expect(loadCallHistory(SERVER, storage)).toHaveLength(1);
    expect(callHistoryCounts('https://other.example.com/mcp', storage)).toEqual({ calls: 1, failures: 1 });

    clearCallHistory(SERVER, storage);
    expect(loadCallHistory(SERVER, storage)).toEqual([]);
    expect(loadCallHistory('https://other.example.com/mcp', storage)).toHaveLength(1);

    clearAllCallHistory(storage);
    expect(storage.raw()).toBe('');
  });

  it('re-redacts entries written by older builds and drops malformed ones', () => {
    const storage = memoryStorage();
    storage.setItem(CALL_HISTORY_STORAGE_KEY, JSON.stringify({
      version: 1,
      servers: [{
        endpoint: SERVER,
        calls: [
          { ...entry(1), arguments: { password: 'hunter2hunter2' } },
          { id: 'broken' },
        ],
      }],
    }));
    const calls = loadCallHistory(SERVER, storage);
    expect(calls).toHaveLength(1);
    expect(JSON.stringify(calls)).not.toContain('hunter2hunter2');
  });

  it('survives corrupt storage', () => {
    const storage = memoryStorage();
    storage.setItem(CALL_HISTORY_STORAGE_KEY, '{not json');
    expect(loadCallHistory(SERVER, storage)).toEqual([]);
    expect(callHistoryCounts(SERVER, storage)).toEqual({ calls: 0, failures: 0 });
  });
});

describe('replay payloads', () => {
  const recorded = createCallHistoryEntry({
    toolName: 'weather',
    arguments: { city: 'Riga', options: { units: 'metric' } },
    result: toolResult(),
    durationMs: 1,
  });

  it('returns a copy of the stored arguments for refilling the form', () => {
    const args = replayArguments(recorded);
    expect(args).toEqual({ city: 'Riga', options: { units: 'metric' } });
    (args.options as Record<string, string>).units = 'imperial';
    expect(recorded.arguments).toEqual({ city: 'Riga', options: { units: 'metric' } });
  });

  it('serializes a tools/call JSON-RPC request', () => {
    expect(JSON.parse(toJsonRpcRequest(recorded, 7))).toEqual({
      jsonrpc: '2.0',
      id: 7,
      method: 'tools/call',
      params: { name: 'weather', arguments: { city: 'Riga', options: { units: 'metric' } } },
    });
  });
});
