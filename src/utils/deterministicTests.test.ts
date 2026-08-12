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
      annotations: { readOnlyHint: true },
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

  it('honors string length constraints in generated runnable fixtures', () => {
    const plan = generateDeterministicTestPlan([{
      name: 'short_lookup',
      annotations: { readOnlyHint: true },
      inputSchema: {
        type: 'object',
        properties: { query: { type: 'string', minLength: 2, maxLength: 3 } },
        required: ['query'],
      },
    }], 'https://example.test', '2026-08-11T00:00:00.000Z');

    const happyPath = plan.tools[0].cases.find(item => item.kind === 'happy-path');
    const outputShape = plan.tools[0].cases.find(item => item.kind === 'output-shape');
    expect(happyPath?.arguments).toEqual({ query: 'fix' });
    expect(outputShape?.arguments).toEqual({ query: 'fix' });
  });

  it('generates schema-valid fixtures for alternatives, patterns, and numeric bounds', () => {
    const plan = generateDeterministicTestPlan([{
      name: 'constrained_lookup',
      annotations: { readOnlyHint: true },
      inputSchema: {
        type: 'object',
        properties: {
          choice: { oneOf: [{ type: 'number', maximum: -1 }, { type: 'boolean' }] },
          code: { type: 'string', pattern: '^item-[A-Z]{2}-\\d{3}$' },
          ratio: { type: 'number', exclusiveMinimum: 2, exclusiveMaximum: 3 },
          ceiling: { type: 'integer', maximum: -2 },
          alternative: { anyOf: [{ type: 'integer', minimum: 4 }, { const: 'fallback' }] },
        },
        required: ['choice', 'code', 'ratio', 'ceiling', 'alternative'],
        additionalProperties: false,
      },
    }], 'https://example.test', '2026-08-11T00:00:00.000Z');

    const happyPath = plan.tools[0].cases.find(item => item.kind === 'happy-path');
    const outputShape = plan.tools[0].cases.find(item => item.kind === 'output-shape');
    expect(happyPath).toMatchObject({
      selected: true,
      arguments: {
        choice: -1,
        code: 'item-AA-000',
        ratio: 2.5,
        ceiling: -2,
        alternative: 4,
      },
    });
    expect(outputShape?.selected).toBe(true);
  });

  it('marks unsynthesizable fixtures for manual input and does not preselect them', () => {
    const plan = generateDeterministicTestPlan([{
      name: 'referenced_lookup',
      annotations: { readOnlyHint: true },
      inputSchema: {
        type: 'object',
        properties: { query: { $ref: '#/$defs/query' } },
        required: ['query'],
        $defs: { query: { type: 'string', const: 'from-reference' } },
      },
    }], 'https://example.test', '2026-08-11T00:00:00.000Z');

    const happyPath = plan.tools[0].cases.find(item => item.kind === 'happy-path');
    const outputShape = plan.tools[0].cases.find(item => item.kind === 'output-shape');
    expect(happyPath?.selected).toBe(false);
    expect(happyPath?.arguments).toEqual({});
    expect(happyPath?.name).toContain('manual fixture required');
    expect(outputShape).toMatchObject({ selected: false });
    expect(outputShape?.name).toContain('manual fixture required');
  });

  it.each([
    {
      schema: {
        input_schema: {
          type: 'object',
          properties: { query: { type: 'string' }, count: { type: 'integer' } },
          required: ['query', 'count'],
        },
      },
      expectedHappy: { query: 'fixture', count: 0 },
      expectedValidation: { count: 0 },
    },
    {
      schema: {
        arguments: [
          { name: 'query', type: 'string', required: true },
          { name: 'enabled', type: 'boolean', required: true },
        ],
      },
      expectedHappy: { query: 'fixture', enabled: false },
      expectedValidation: { enabled: false },
    },
  ])('derives fixtures from legacy input definitions: $schema', ({ schema, expectedHappy, expectedValidation }) => {
    const plan = generateDeterministicTestPlan([
      { name: 'legacy_lookup', annotations: { readOnlyHint: true }, ...schema },
    ], 'https://example.test', '2026-08-11T00:00:00.000Z');

    expect(plan.tools[0].cases.find(item => item.kind === 'happy-path')?.arguments).toEqual(expectedHappy);
    expect(plan.tools[0].cases.find(item => item.kind === 'validation')?.arguments).toEqual(expectedValidation);
  });

  it('infers write and destructive tools from annotations and language', () => {
    const plan = generateDeterministicTestPlan([
      { name: 'list_users', annotations: { readOnlyHint: true } },
      { name: 'update_user' },
      { name: 'records', description: 'Deletes a permanent record.' },
      { name: 'custom', annotations: { destructiveHint: true } },
      { name: 'permanentlyDeleteAccount' },
      { name: 'records', description: 'Deleting stale records.' },
      { name: 'modify_user' },
      { name: 'insert_record' },
      { name: 'post_message' },
      { name: 'charge_card' },
      { name: 'deploy_app' },
    ], 'https://example.test', '2026-08-11T00:00:00.000Z');

    expect(plan.tools.map(tool => tool.safety)).toMatchObject([
      { writeCapable: false, destructive: false },
      { writeCapable: true, destructive: false },
      { writeCapable: true, destructive: true },
      { writeCapable: true, destructive: true },
      { writeCapable: true, destructive: true },
      { writeCapable: true, destructive: true },
      { writeCapable: true, destructive: false },
      { writeCapable: true, destructive: false },
      { writeCapable: true, destructive: false },
      { writeCapable: true, destructive: false },
      { writeCapable: true, destructive: false },
    ]);
  });

  it.each([
    { name: 'lookup' },
    { name: 'lookup', annotations: { destructiveHint: false } },
    { name: 'lookup', annotations: { readOnlyHint: false } },
  ])('requires confirmation unless a tool explicitly declares readOnlyHint=true: %j', tool => {
    const plan = generateDeterministicTestPlan(
      [tool],
      'https://example.test',
      '2026-08-11T00:00:00.000Z',
    );

    expect(plan.tools[0].safety).toMatchObject({ writeCapable: true });
  });

  it('generates collision-free case IDs from exact tool identities', () => {
    const plan = generateDeterministicTestPlan([
      { name: 'foo.bar' },
      { name: 'foo-bar' },
    ], 'https://example.test', '2026-08-11T00:00:00.000Z');
    const ids = plan.tools.flatMap(tool => tool.cases.map(testCase => testCase.id));

    expect(new Set(ids).size).toBe(ids.length);
    expect(plan.tools[0].cases[0].id).not.toBe(plan.tools[1].cases[0].id);
    expect(parseDeterministicTestPlan(serializeDeterministicTestPlan(plan))).toEqual(plan);
  });

  it('round-trips versioned JSON and rejects cross-tool imported cases', () => {
    const plan = generateDeterministicTestPlan(
      [{ name: 'lookup', annotations: { readOnlyHint: true } }],
      'https://example.test',
      '2026-08-11T00:00:00.000Z',
    );
    expect(parseDeterministicTestPlan(serializeDeterministicTestPlan(plan))).toEqual(plan);
    plan.tools[0].cases[0].toolName = 'delete_everything';
    expect(() => parseDeterministicTestPlan(serializeDeterministicTestPlan(plan))).toThrow(/containing tool/);
  });

  it('validates edited structural assertions before export and round-trips valid edits', () => {
    const plan = generateDeterministicTestPlan(
      [{ name: 'lookup', annotations: { readOnlyHint: true } }],
      'https://example.test',
      '2026-08-11T00:00:00.000Z',
    );
    plan.tools[0].cases[0].assertions = [{ path: '$.content', operator: 'min-length', value: 2 }];
    expect(parseDeterministicTestPlan(serializeDeterministicTestPlan(plan))).toEqual(plan);

    plan.tools[0].cases[0].assertions = [{ path: '$.content', operator: 'subjective' } as any];
    expect(() => serializeDeterministicTestPlan(plan)).toThrow(/malformed structural assertion/);
  });
});

describe('deterministic runner safety and evidence', () => {
  it.each([
    { name: 'lookup' },
    { name: 'lookup', annotations: { destructiveHint: false } },
  ])('blocks an ambiguously annotated tool without explicit confirmation: %j', async tool => {
    const callTool = vi.fn().mockResolvedValue({ content: [] });
    const plan = generateDeterministicTestPlan([tool], 'https://example.test', '2026-08-11T00:00:00.000Z');

    const results = await runDeterministicPlan({ callTool }, plan, {
      caseIds: [plan.tools[0].cases[0].id],
    });

    expect(callTool).not.toHaveBeenCalled();
    expect(results[0]).toMatchObject({
      status: 'blocked',
      error: { code: 'EXPLICIT_CONFIRMATION_REQUIRED' },
    });
  });

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

  it('blocks deactivate tools despite contradictory read-only metadata', async () => {
    const callTool = vi.fn().mockResolvedValue({ content: [] });
    const plan = generateDeterministicTestPlan(
      [{ name: 'deactivate_account', annotations: { readOnlyHint: true } }],
      'https://example.test',
      '2026-08-11T00:00:00.000Z',
    );

    const results = await runDeterministicPlan({ callTool }, plan);

    expect(plan.tools[0].safety).toMatchObject({ writeCapable: true, destructive: true });
    expect(callTool).not.toHaveBeenCalled();
    expect(results).toHaveLength(2);
    expect(results.every(result => (
      result.status === 'blocked' && result.error?.code === 'EXPLICIT_CONFIRMATION_REQUIRED'
    ))).toBe(true);
  });

  it.each(['destroy_account', 'purge_records'])(
    'requires explicit confirmation for common destructive action %s',
    async toolName => {
      const callTool = vi.fn().mockResolvedValue({ content: [] });
      const plan = generateDeterministicTestPlan([{ name: toolName }], 'https://example.test', '2026-08-11T00:00:00.000Z');
      plan.tools[0].safety = { writeCapable: false, destructive: false, reasons: [] };

      const results = await runDeterministicPlan({ callTool }, plan, {
        caseIds: [plan.tools[0].cases[0].id],
      });

      expect(callTool).not.toHaveBeenCalled();
      expect(results[0]).toMatchObject({
        status: 'blocked',
        error: { code: 'EXPLICIT_CONFIRMATION_REQUIRED' },
      });
    },
  );

  it.each(['save_document', 'approve_request', 'refund_payment', 'ban_user'])(
    'requires explicit confirmation for common write action %s',
    async toolName => {
      const callTool = vi.fn().mockResolvedValue({ content: [] });
      const plan = generateDeterministicTestPlan([{ name: toolName }], 'https://example.test', '2026-08-11T00:00:00.000Z');
      plan.tools[0].safety = { writeCapable: false, destructive: false, reasons: [] };

      const results = await runDeterministicPlan({ callTool }, plan, {
        caseIds: [plan.tools[0].cases[0].id],
      });

      expect(callTool).not.toHaveBeenCalled();
      expect(results[0]).toMatchObject({
        status: 'blocked',
        error: { code: 'EXPLICIT_CONFIRMATION_REQUIRED' },
      });
    },
  );

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

  it('redacts secrets embedded in MCP text blocks and credential headers', () => {
    expect(redactTestData({
      content: [
        { type: 'text', text: '{"api_key":"secret","nested":{"clientSecret":"also-secret"}}' },
        { type: 'text', text: 'Authorization: Basic dXNlcjpwYXNz\nX-API-Key: header-secret' },
      ],
    })).toEqual({
      content: [
        { type: 'text', text: '{"api_key":"[REDACTED]","nested":{"clientSecret":"[REDACTED]"}}' },
        { type: 'text', text: 'Authorization: [REDACTED]\nX-API-Key: [REDACTED]' },
      ],
    });
  });

  it('redacts compound sensitive text keys and complete credential header values', () => {
    expect(redactTestData([
      'github_token=secret',
      'Cookie: session=secret-one; csrf=secret-two',
      'Set-Cookie: session=secret-one; Path=/; Secure',
      'Authorization: Digest username="user", response="secret"',
      'Proxy-Authorization: Custom part-one, part-two',
    ].join('\n'))).toBe([
      'github_token=[REDACTED]',
      'Cookie: [REDACTED]',
      'Set-Cookie: [REDACTED]',
      'Authorization: [REDACTED]',
      'Proxy-Authorization: [REDACTED]',
    ].join('\n'));
  });

  it('redacts credential URLs in request and response text-block evidence', async () => {
    const result = await runDeterministicCase(
      {
        callTool: vi.fn().mockResolvedValue({
          content: [{
            type: 'text',
            text: 'https://example.test/callback#refresh_token=response-secret&client_token=response-client-token&keep=response-value',
          }],
        }),
      },
      fixtureCase({
        arguments: {
          content: [{
            type: 'text',
            text: 'https://example.test/callback?access_token=request-secret&client_secret=request-client-secret&keep=request-value',
          }],
        },
      }),
    );

    expect(result.request).toMatchObject({
      arguments: {
        content: [{
          text: 'https://example.test/callback?access_token=[REDACTED]&client_secret=[REDACTED]&keep=request-value',
        }],
      },
    });
    expect(result.response).toMatchObject({
      content: [{
        text: 'https://example.test/callback#refresh_token=[REDACTED]&client_token=[REDACTED]&keep=response-value',
      }],
    });
  });

  it('redacts plain and percent-encoded URL authority credentials in request and response evidence', async () => {
    const result = await runDeterministicCase(
      {
        callTool: vi.fn().mockResolvedValue({
          content: [{ type: 'text', text: 'response https://bob%40team:p%40ss@example.test/private' }],
        }),
      },
      fixtureCase({
        arguments: { endpoint: 'https://alice:secret@example.test/path?keep=yes' },
      }),
    );

    expect(result.request).toMatchObject({
      arguments: { endpoint: 'https://[REDACTED]@example.test/path?keep=yes' },
    });
    expect(result.response).toMatchObject({
      content: [{ text: 'response https://[REDACTED]@example.test/private' }],
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
      fixtureCase({ kind: 'cancellation', expectedError: 'cancelled', cancelAfterMs: 1, assertions: [] }),
    );
    expect(result.status).toBe('passed');
    expect(result.error?.type).toBe('cancelled');
  });

  it('classifies fixture cancellation when the client propagates signal.reason', async () => {
    const callTool = vi.fn((_request, options) => new Promise((_resolve, reject) => {
      options?.signal?.addEventListener('abort', () => reject(options.signal?.reason), { once: true });
    }));
    const result = await runDeterministicCase(
      { callTool },
      fixtureCase({ kind: 'cancellation', expectedError: 'cancelled', cancelAfterMs: 1, assertions: [] }),
    );
    expect(result.status).toBe('passed');
    expect(result.error?.type).toBe('cancelled');
  });

  it('passes timeout fixtures only for a machine-readable timeout error', async () => {
    const result = await runDeterministicCase(
      { callTool: vi.fn().mockRejectedValue({ code: 'RequestTimeout', message: 'Timed out' }) },
      fixtureCase({ kind: 'timeout', expectedError: 'timeout', timeoutMs: 5, assertions: [] }),
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

  it.each([
    { content: [{ type: 'unknown', value: 'anything' }] },
    { content: [{ type: 'text' }] },
    { content: [{ type: 'image', data: 'abc' }] },
    { content: [{ type: 'resource', resource: { uri: 'file:///fixture' } }] },
  ])('rejects invalid content-block unions: %j', async response => {
    const result = await runDeterministicCase(
      { callTool: vi.fn().mockResolvedValue(response) },
      fixtureCase(),
    );
    expect(result.error?.type).toBe('malformed-response');
  });

  it('validates malformed error envelopes before interpreting isError', async () => {
    const result = await runDeterministicCase(
      { callTool: vi.fn().mockResolvedValue({ isError: true, content: [{ type: 'text' }] }) },
      fixtureCase({ expectedError: 'upstream' }),
    );
    expect(result.status).toBe('failed');
    expect(result.error).toMatchObject({ type: 'malformed-response', code: 'INVALID_TOOL_RESULT' });
  });

  it('classifies textual error details when structured content is generic', async () => {
    const result = await runDeterministicCase(
      { callTool: vi.fn().mockResolvedValue({
        isError: true,
        structuredContent: { items: [] },
        content: [{ type: 'text', text: JSON.stringify({ code: -32602, message: 'Missing required query' }) }],
      }) },
      fixtureCase({ expectedError: 'validation', assertions: [] }),
    );

    expect(result.status).toBe('passed');
    expect(result.error).toMatchObject({
      type: 'validation',
      code: -32602,
      message: 'Missing required query',
    });
  });

  it('requires structural assertions to pass for expected-error responses', async () => {
    const response = {
      isError: true,
      content: [{ type: 'text', text: JSON.stringify({ code: 503, message: 'Unavailable' }) }],
      structuredContent: { code: 503, items: [] },
    };
    const passing = await runDeterministicCase(
      { callTool: vi.fn().mockResolvedValue(response) },
      fixtureCase({
        expectedError: 'upstream',
        assertions: [{ path: '$.structuredContent.code', operator: 'equals', value: 503 }],
      }),
    );
    const failing = await runDeterministicCase(
      { callTool: vi.fn().mockResolvedValue(response) },
      fixtureCase({
        expectedError: 'upstream',
        assertions: [{ path: '$.structuredContent.items', operator: 'min-length', value: 1 }],
      }),
    );

    expect(passing.status).toBe('passed');
    expect(passing.assertions).toMatchObject([{ passed: true }]);
    expect(failing.status).toBe('failed');
    expect(failing.assertions).toMatchObject([{ passed: false }]);
  });

  it('fails expected thrown errors when response assertions cannot be satisfied', async () => {
    const result = await runDeterministicCase(
      { callTool: vi.fn().mockRejectedValue({ status: 503, message: 'Unavailable' }) },
      fixtureCase({
        expectedError: 'upstream',
        assertions: [{ path: '$.structuredContent', operator: 'exists' }],
      }),
    );

    expect(result.status).toBe('failed');
    expect(result.assertions).toMatchObject([{ passed: false }]);
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

  it('compares JSON objects independent of key order while preserving array order', () => {
    const evidence = evaluateAssertions({
      structuredContent: {
        object: { a: 1, nested: { b: 2, c: 3 } },
        array: [1, 2],
      },
    }, [
      {
        path: '$.structuredContent.object',
        operator: 'equals',
        value: { nested: { c: 3, b: 2 }, a: 1 },
      },
      { path: '$.structuredContent.array', operator: 'equals', value: [2, 1] },
    ]);

    expect(evidence.map(item => item.passed)).toEqual([true, false]);
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

  it.each([
    [{ status: 401, message: 'Authentication timed out' }, 'authorization'],
    [{ status: 403, message: 'Validation failed' }, 'authorization'],
    [{ status: 400, message: 'Upstream service unavailable' }, 'validation'],
    [{ status: 422, message: 'Request timed out' }, 'validation'],
    [{ status: 404, message: 'Authentication required' }, 'missing-resource'],
    [{ status: 429, message: 'Validation failed' }, 'upstream'],
    [{ status: 500, message: 'Invalid params' }, 'upstream'],
    [{ status: 503, message: 'Validation failed upstream' }, 'upstream'],
    [{ code: 'RequestTimeout', message: 'Unauthorized' }, 'timeout'],
    [{ code: 'INVALID_PARAMS', message: 'Service unavailable' }, 'validation'],
  ])('prioritizes machine-readable code in %j', (error, type) => {
    expect(normalizeTestError(error).type).toBe(type);
  });

  it('captures actionable identifiers', () => {
    expect(normalizeTestError({ status: 503, message: 'Unavailable', data: { trace_id: 'trace-8' } }).identifiers)
      .toEqual({ trace_id: 'trace-8' });
  });
});
