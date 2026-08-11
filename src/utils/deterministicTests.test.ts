import { describe, expect, it, vi } from 'vitest';
import type { DeterministicTestCaseV1 } from '../types/deterministicTests';
import {
  evaluateAssertions,
  generateDeterministicTestPlan,
  normalizeTestError,
  parseDeterministicTestPlan,
  redactTestData,
  runDeterministicCase,
  runDeterministicPlan,
  serializeDeterministicTestPlan,
} from './deterministicTests';

const fixtureCase = (overrides: Partial<DeterministicTestCaseV1> = {}): DeterministicTestCaseV1 => ({
  id: 'lookup--happy-path',
  toolName: 'lookup',
  name: 'Happy path',
  kind: 'happy-path',
  selected: true,
  arguments: { query: 'fixture' },
  assertions: [{ path: '$.content', operator: 'type', value: 'array' }],
  timeoutMs: 1_000,
  ...overrides,
});

describe('deterministic test plans', () => {
  it('generates every required case deterministically and derives fixtures from schemas', () => {
    const tools = [{
      name: 'lookup',
      inputSchema: {
        type: 'object',
        properties: { query: { type: 'string' }, limit: { type: 'integer', default: 3 } },
        required: ['query'],
      },
      outputSchema: {
        type: 'object',
        properties: { items: { type: 'array' } },
        required: ['items'],
      },
    }];
    const first = generateDeterministicTestPlan(tools, 'https://mcp.example.test', '2026-08-11T00:00:00.000Z');
    const second = generateDeterministicTestPlan(tools, 'https://mcp.example.test', '2026-08-11T00:00:00.000Z');

    expect(first).toEqual(second);
    expect(first.tools[0].cases.map(item => item.kind)).toEqual([
      'happy-path', 'validation', 'empty-result', 'upstream-error', 'timeout', 'output-shape', 'cancellation',
    ]);
    expect(first.tools[0].cases[0].arguments).toEqual({ query: 'fixture' });
    expect(first.tools[0].cases.find(item => item.kind === 'validation')?.arguments).toEqual({});
    expect(first.tools[0].cases.find(item => item.kind === 'output-shape')?.assertions).toContainEqual({
      path: '$.structuredContent.items', operator: 'exists',
    });
  });

  it('infers write and destructive tools from annotations and language', () => {
    const plan = generateDeterministicTestPlan([
      { name: 'list_users', annotations: { readOnlyHint: true } },
      { name: 'update_user' },
      { name: 'records', description: 'Deletes a permanent record.' },
      { name: 'custom', annotations: { destructiveHint: true } },
      { name: 'permanentlyDeleteAccount' },
      { name: 'records', description: 'Deleting stale records.' },
    ], 'https://example.test', '2026-08-11T00:00:00.000Z');

    expect(plan.tools.map(tool => tool.safety)).toMatchObject([
      { writeCapable: false, destructive: false },
      { writeCapable: true, destructive: false },
      { writeCapable: true, destructive: true },
      { writeCapable: true, destructive: true },
      { writeCapable: true, destructive: true },
      { writeCapable: true, destructive: true },
    ]);
  });

  it('round-trips versioned JSON and rejects cross-tool imported cases', () => {
    const plan = generateDeterministicTestPlan([{ name: 'lookup' }], 'https://example.test', '2026-08-11T00:00:00.000Z');
    expect(parseDeterministicTestPlan(serializeDeterministicTestPlan(plan))).toEqual(plan);
    plan.tools[0].cases[0].toolName = 'delete_everything';
    expect(() => parseDeterministicTestPlan(serializeDeterministicTestPlan(plan))).toThrow(/containing tool/);
  });
});

describe('deterministic runner safety and evidence', () => {
  it('blocks inferred unsafe tools without explicit confirmation, including imported safety downgrades', async () => {
    const callTool = vi.fn().mockResolvedValue({ content: [] });
    const plan = generateDeterministicTestPlan([{ name: 'delete_user' }], 'https://example.test', '2026-08-11T00:00:00.000Z');
    plan.tools[0].safety = { writeCapable: false, destructive: false, reasons: [] };
    const caseId = plan.tools[0].cases[0].id;

    const results = await runDeterministicPlan({ callTool }, plan, {
      caseIds: [caseId],
    });

    expect(callTool).not.toHaveBeenCalled();
    expect(results[0]).toMatchObject({
      status: 'blocked',
      error: { code: 'EXPLICIT_CONFIRMATION_REQUIRED' },
    });
  });

  it('runs confirmed unsafe cases through the supplied stateful client', async () => {
    const callTool = vi.fn().mockResolvedValue({ content: [] });
    const plan = generateDeterministicTestPlan([{ name: 'update_user' }], 'https://example.test', '2026-08-11T00:00:00.000Z');
    const caseId = plan.tools[0].cases[0].id;
    const results = await runDeterministicPlan({ callTool }, plan, {
      caseIds: [caseId],
      confirmedUnsafeToolNames: ['update_user'],
      unsafeToolNames: ['update_user'],
    });

    expect(callTool).toHaveBeenCalledOnce();
    expect(results[0].status).toBe('passed');
  });

  it('redacts nested secrets in requests and responses without changing ordinary values', () => {
    expect(redactTestData({
      authorization: 'Bearer abc.def',
      nested: { github_token: 'secret', clientSecret: 'also-secret', url: 'https://x.test/?token=secret&keep=yes' },
      query: 'normal',
    })).toEqual({
      authorization: '[REDACTED]',
      nested: { github_token: '[REDACTED]', clientSecret: '[REDACTED]', url: 'https://x.test/?token=[REDACTED]&keep=yes' },
      query: 'normal',
    });
  });

  it('reports malformed responses and preserves reproducible case data', async () => {
    const result = await runDeterministicCase(
      { callTool: vi.fn().mockResolvedValue({ unexpected: true }) },
      fixtureCase(),
    );
    expect(result.status).toBe('failed');
    expect(result.error).toMatchObject({ type: 'malformed-response', code: 'INVALID_TOOL_RESULT' });
    expect(result.reproducibleCase).toEqual(fixtureCase());
  });

  it('supports fixture cancellation using an abort signal', async () => {
    const callTool = vi.fn((_request, options) => new Promise((_resolve, reject) => {
      options?.signal?.addEventListener('abort', () => reject(new DOMException('Aborted', 'AbortError')), { once: true });
    }));
    const result = await runDeterministicCase(
      { callTool },
      fixtureCase({ kind: 'cancellation', expectedError: 'cancelled', cancelAfterMs: 1 }),
    );
    expect(result.status).toBe('passed');
    expect(result.error?.type).toBe('cancelled');
  });

  it('passes timeout fixtures only for a machine-readable timeout error', async () => {
    const result = await runDeterministicCase(
      { callTool: vi.fn().mockRejectedValue({ code: 'RequestTimeout', message: 'Timed out' }) },
      fixtureCase({ kind: 'timeout', expectedError: 'timeout', timeoutMs: 5 }),
    );
    expect(result.status).toBe('passed');
    expect(result.error).toMatchObject({ type: 'timeout', retryable: true });
  });

  it('rejects malformed content blocks', async () => {
    const result = await runDeterministicCase(
      { callTool: vi.fn().mockResolvedValue({ content: [{ text: 'missing type' }] }) },
      fixtureCase(),
    );
    expect(result.error?.type).toBe('malformed-response');
  });
});

describe('structural assertions and machine-readable errors', () => {
  it('evaluates paths, types, equality, and collection sizes without grading prose', () => {
    const evidence = evaluateAssertions({ structuredContent: { items: [{ id: 7 }], ok: true } }, [
      { path: '$.structuredContent.items', operator: 'type', value: 'array' },
      { path: '$.structuredContent.items', operator: 'min-length', value: 1 },
      { path: '$.structuredContent.items[0].id', operator: 'equals', value: 7 },
      { path: '$.structuredContent.ok', operator: 'exists' },
      { path: '$.structuredContent.missing', operator: 'not-exists' },
    ]);
    expect(evidence.every(item => item.passed)).toBe(true);
  });

  it.each([
    [{ status: 401, message: 'Unauthorized' }, 'authorization', false],
    [{ code: -32602, message: 'Invalid params' }, 'validation', false],
    [{ statusCode: 404, message: 'Resource not found' }, 'missing-resource', false],
    [{ status: 503, message: 'Upstream unavailable', requestId: 'req-7' }, 'upstream', true],
    [{ code: 'RequestTimeout', message: 'Timed out' }, 'timeout', true],
  ])('normalizes %j', (error, type, retryable) => {
    expect(normalizeTestError(error)).toMatchObject({ type, retryable });
  });

  it('captures actionable identifiers', () => {
    expect(normalizeTestError({ status: 503, message: 'Unavailable', data: { trace_id: 'trace-8' } }).identifiers)
      .toEqual({ trace_id: 'trace-8' });
  });
});
