import { describe, expect, it } from 'vitest';
import { createCallHistoryEntry, type CallHistoryEntry } from './callHistory';
import { evaluateAssertions, validateDeterministicTestPlan } from './deterministicTests';
import {
  CONTAINS_PREFIX_LIMIT,
  assertionsForCall,
  createTestPlanFromHistory,
  nonDeterministicReason,
  stableTextPrefix,
} from './historyTestPlan';

const serverUrl = 'https://plans.example/mcp';

const recorded = (
  overrides: { toolName?: string; arguments?: Record<string, unknown>; text?: string; content?: unknown[]; isError?: boolean; durationMs?: number } = {},
  calledAt = '2026-10-20T10:00:00.000Z',
): CallHistoryEntry => createCallHistoryEntry({
  toolName: overrides.toolName ?? 'weather',
  arguments: overrides.arguments ?? { city: 'Riga' },
  result: {
    type: 'tool_result',
    data: [],
    timestamp: '',
    toolCall: {
      result: {
        content: overrides.content ?? [{ type: 'text', text: overrides.text ?? 'Forecast for Riga: light rain' }],
        ...(overrides.isError ? { isError: true } : {}),
      },
      contract: { toolName: 'weather', status: 'no-schema', violations: [], hasStructuredContent: false, isError: Boolean(overrides.isError) },
    },
  },
  durationMs: overrides.durationMs ?? 12,
  calledAt,
});

const tools = [
  { name: 'weather', inputSchema: { type: 'object' }, annotations: { readOnlyHint: true } },
  {
    name: 'forecast',
    inputSchema: { type: 'object' },
    outputSchema: { type: 'object', properties: { days: { type: 'array' } }, required: ['days'] },
    annotations: { readOnlyHint: true },
  },
  { name: 'create_issue', description: 'Create an issue', inputSchema: { type: 'object' } },
];

describe('assertions generated from a recorded call', () => {
  it('asserts an ok result shape and isError false for every call', () => {
    const assertions = assertionsForCall(recorded({ text: '' }), tools[0]);
    expect(assertions).toEqual([
      { path: '$.content', operator: 'type', value: 'array' },
      { path: '$.isError', operator: 'not-equals', value: true },
    ]);
  });

  it('adds matches-output-schema only when the tool declares an outputSchema', () => {
    expect(assertionsForCall(recorded({ toolName: 'forecast', text: '' }), tools[1]))
      .toContainEqual({ path: '$.structuredContent', operator: 'matches-output-schema' });
    expect(assertionsForCall(recorded({ text: '' }), tools[0]).map((item) => item.operator))
      .not.toContain('matches-output-schema');
  });

  it('adds a contains assertion on a short stable prefix of deterministic text', () => {
    const contains = assertionsForCall(recorded({ text: 'Forecast for Riga: light rain and wind from the west all afternoon' }), tools[0])
      .find((item) => item.operator === 'contains');
    expect(contains).toEqual({ path: '$.content[0].text', operator: 'contains', value: 'Forecast for Riga: light rain and wind' });
    expect((contains as { value: string }).value.length).toBeLessThanOrEqual(CONTAINS_PREFIX_LIMIT);
  });

  it('points at the first text block when other blocks come first', () => {
    const contains = assertionsForCall(recorded({
      content: [{ type: 'image', data: 'AAAA', mimeType: 'image/png' }, { type: 'text', text: 'Chart of rainfall' }],
    }), tools[0]).find((item) => item.operator === 'contains');
    expect(contains).toMatchObject({ path: '$.content[1].text', value: 'Chart of rainfall' });
  });

  it.each([
    ['Updated at 2026-10-20 for Riga', 'a date'],
    ['Last sync 14:05 UTC', 'a time of day'],
    ['Generated 3 minutes ago', 'a relative time'],
    ['Created request 4c9e2b1a-7f00-4d2e-9a51-0b6f3c2d1e00', 'a UUID'],
    ['Commit 9fceb02d0ae598e95dc970b74767f19372d61af8', 'a hex identifier'],
    ['Order 1739182734 accepted', 'a long number such as an id or timestamp'],
    ['Temperature 21.4375 degrees', 'a precise measurement'],
    ['Session abc123def456ghi789jkl opened', 'a generated token'],
    ['{"temperature": 21}', 'structured JSON text'],
    ['token: [REDACTED]', 'redacted text'],
  ])('treats %j as non-deterministic (%s)', (text, reason) => {
    expect(nonDeterministicReason(text)).toBe(reason);
    expect(assertionsForCall(recorded({ text }), tools[0]).map((item) => item.operator)).not.toContain('contains');
  });

  it('treats ordinary prose as deterministic', () => {
    expect(nonDeterministicReason('Forecast for Riga: light rain')).toBeUndefined();
  });

  it('drops the content assertion when identical calls returned different text', () => {
    const first = recorded({ text: 'Riga is cloudy' }, '2026-10-20T10:00:00.000Z');
    const second = recorded({ text: 'Riga is sunny' }, '2026-10-20T10:01:00.000Z');
    expect(assertionsForCall(first, tools[0], [second, first]).map((item) => item.operator)).not.toContain('contains');
    const repeat = recorded({ text: 'Riga is cloudy' }, '2026-10-20T10:02:00.000Z');
    expect(assertionsForCall(first, tools[0], [repeat, first]).map((item) => item.operator)).toContain('contains');
  });

  it('uses only the first line and requires a meaningful prefix', () => {
    expect(stableTextPrefix('  Heading\nsecond line')).toBe('Heading');
    expect(stableTextPrefix('ok')).toBeUndefined();
  });

  it('produces assertions the runner accepts and that pass against the recorded result', () => {
    const assertions = assertionsForCall(recorded({ text: 'Forecast for Riga: light rain' }), tools[0]);
    const evidence = evaluateAssertions({ content: [{ type: 'text', text: 'Forecast for Riga: light rain' }] }, assertions);
    expect(evidence.every((item) => item.passed)).toBe(true);
    const failing = evaluateAssertions({ content: [{ type: 'text', text: 'Unknown city' }], isError: true }, assertions);
    expect(failing.filter((item) => !item.passed).map((item) => item.assertion.operator)).toEqual(['not-equals', 'contains']);
  });
});

describe('createTestPlanFromHistory', () => {
  it('converts all successful calls by default, oldest first, grouped by tool', () => {
    const calls = [
      recorded({ toolName: 'forecast', arguments: { days: 3 }, text: 'Three days' }, '2026-10-20T10:03:00.000Z'),
      recorded({ isError: true, text: 'boom' }, '2026-10-20T10:02:00.000Z'),
      recorded({ arguments: { city: 'Tallinn' } }, '2026-10-20T10:01:00.000Z'),
      recorded({ arguments: { city: 'Riga' } }, '2026-10-20T10:00:00.000Z'),
    ];
    const { plan, convertedCount } = createTestPlanFromHistory(calls, tools, serverUrl, { generatedAt: '2026-10-20T11:00:00.000Z' });
    validateDeterministicTestPlan(plan);
    expect(convertedCount).toBe(3);
    expect(plan.serverUrl).toBe(serverUrl);
    expect(plan.tools.map((tool) => tool.toolName)).toEqual(['weather', 'forecast']);
    expect(plan.tools[0].cases.map((testCase) => testCase.arguments)).toEqual([{ city: 'Riga' }, { city: 'Tallinn' }]);
    expect(plan.tools[0].cases.every((testCase) => testCase.selected && testCase.kind === 'happy-path')).toBe(true);
    expect(plan.tools[1].outputSchema).toEqual(tools[1].outputSchema);
  });

  it('converts only the selected calls and never failed ones', () => {
    const ok = recorded({ arguments: { city: 'Riga' } });
    const failed = recorded({ isError: true });
    const other = recorded({ arguments: { city: 'Oslo' } });
    const { plan } = createTestPlanFromHistory([other, failed, ok], tools, serverUrl, { callIds: [ok.id, failed.id] });
    expect(plan.tools.flatMap((tool) => tool.cases).map((testCase) => testCase.arguments)).toEqual([{ city: 'Riga' }]);
  });

  it('skips repeated calls and tools the server no longer lists', () => {
    const calls = [
      recorded({ arguments: { city: 'Riga' } }, '2026-10-20T10:02:00.000Z'),
      recorded({ toolName: 'removed_tool' }, '2026-10-20T10:01:00.000Z'),
      recorded({ arguments: { city: 'Riga' } }, '2026-10-20T10:00:00.000Z'),
    ];
    const result = createTestPlanFromHistory(calls, tools, serverUrl);
    expect(result).toMatchObject({ convertedCount: 1, duplicateCount: 1, unavailableCount: 1 });
  });

  it('keeps history redaction and leaves cases with redacted values unselected', () => {
    const entry = recorded({ arguments: { query: 'repos', apiKey: 'sk-live-1234567890abcdef', note: 'ghp_abcdefghijklmnopqrstuvwxyz0123456789' } });
    const { plan, redactedCount } = createTestPlanFromHistory([entry], tools, serverUrl);
    const [testCase] = plan.tools[0].cases;
    expect(JSON.stringify(plan)).not.toContain('sk-live-1234567890abcdef');
    expect(JSON.stringify(plan)).not.toContain('ghp_abcdefghijklmnopqrstuvwxyz0123456789');
    expect(testCase.arguments.query).toBe('repos');
    expect(testCase.selected).toBe(false);
    expect(testCase.name).toContain('redacted arguments');
    expect(redactedCount).toBe(1);
  });

  it('redacts credentials in the endpoint and keeps write-capable tools flagged', () => {
    const entry = recorded({ toolName: 'create_issue', arguments: { title: 'Bug' } });
    const { plan } = createTestPlanFromHistory([entry], tools, 'https://plans.example/mcp?api_key=secret-value');
    expect(plan.serverUrl).not.toContain('secret-value');
    expect(plan.tools[0].safety.writeCapable).toBe(true);
  });

  it('gives slow calls a proportionally longer timeout', () => {
    const { plan } = createTestPlanFromHistory([recorded({ durationMs: 20_000 })], tools, serverUrl);
    expect(plan.tools[0].cases[0].timeoutMs).toBe(60_000);
  });
});

describe('recorded result text excerpts', () => {
  it('keeps the uncollapsed first text block, redacted, for successful calls only', () => {
    const entry = recorded({ text: 'Line one\n  Authorization: Bearer abc.def.ghi\nLine three' });
    expect(entry.resultText?.index).toBe(0);
    expect(entry.resultText?.excerpt).toContain('Line one\n');
    expect(entry.resultText?.excerpt).not.toContain('abc.def.ghi');
    expect(recorded({ isError: true, text: 'Failure text' }).resultText).toBeUndefined();
  });

  it('bounds the excerpt and tolerates entries recorded before excerpts existed', () => {
    expect(recorded({ text: 'word '.repeat(200) }).resultText!.excerpt.length).toBeLessThanOrEqual(120);
    const legacy = { ...recorded(), resultText: undefined };
    expect(assertionsForCall(legacy, tools[0]).map((item) => item.operator)).not.toContain('contains');
  });
});
