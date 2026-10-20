import { describe, expect, it, vi } from 'vitest';
import type { DeterministicTestCaseV1 } from '../types/deterministicTests';
import {
  evaluateAssertions,
  generateDeterministicTestPlan,
  parseDeterministicTestPlan,
  runDeterministicCase,
  runDeterministicPlan,
  serializeDeterministicTestPlan,
} from './deterministicTests';

const outputSchema = {
  type: 'object',
  properties: { total: { type: 'integer' }, items: { type: 'array', items: { type: 'string' } } },
  required: ['total', 'items'],
};

const liveTool = {
  name: 'search',
  annotations: { readOnlyHint: true },
  inputSchema: { type: 'object', properties: {} },
  outputSchema,
};

const schemaCase = (assertions: DeterministicTestCaseV1['assertions']): DeterministicTestCaseV1 => ({
  id: 'search-schema',
  toolName: 'search',
  name: 'Schema',
  kind: 'output-shape',
  selected: true,
  arguments: {},
  assertions,
  timeoutMs: 1_000,
});

const matchesSchema = { path: '$.structuredContent', operator: 'matches-output-schema' } as const;

describe('matches-output-schema assertion', () => {
  it('passes when structured output validates against the declared schema', () => {
    const [evidence] = evaluateAssertions(
      { content: [], structuredContent: { total: 1, items: ['a'] } },
      [matchesSchema],
      { outputSchema },
    );

    expect(evidence).toMatchObject({ passed: true, message: '$.structuredContent validates against the declared outputSchema.' });
  });

  it('fails with readable violations when structured output breaks the schema', () => {
    const [evidence] = evaluateAssertions(
      { content: [], structuredContent: { total: 1.5, items: [3] } },
      [matchesSchema],
      { outputSchema },
    );

    expect(evidence.passed).toBe(false);
    expect(evidence.violations).toEqual([
      { path: 'structuredContent.total', message: 'Expected integer but got number.' },
      { path: 'structuredContent.items[0]', message: 'Expected string but got number.' },
    ]);
    expect(evidence.message).toContain('structuredContent.items[0] — Expected string but got number.');
  });

  it('fails when structuredContent is missing or no schema is declared', () => {
    const [missing] = evaluateAssertions({ content: [] }, [matchesSchema], { outputSchema });
    const [undeclared] = evaluateAssertions({ content: [], structuredContent: {} }, [matchesSchema]);

    expect(missing).toMatchObject({ passed: false, message: '$.structuredContent is missing, but the tool declares an outputSchema.' });
    expect(undeclared.passed).toBe(false);
    expect(undeclared.message).toMatch(/declares no outputSchema/);
  });

  it('is generated for tools with a declared schema and survives plan export and import', () => {
    const plan = generateDeterministicTestPlan([liveTool], 'https://example.test', '2026-10-20T00:00:00.000Z');
    const imported = parseDeterministicTestPlan(serializeDeterministicTestPlan(plan));
    const outputShape = imported.tools[0].cases.find(item => item.kind === 'output-shape');

    expect(outputShape?.assertions).toContainEqual(matchesSchema);
    expect(imported.tools[0].outputSchema).toEqual(outputSchema);
  });

  it('rejects a plan with a malformed outputSchema snapshot', () => {
    const plan = generateDeterministicTestPlan([liveTool], 'https://example.test', '2026-10-20T00:00:00.000Z');
    const malformed = JSON.stringify({ ...plan, tools: [{ ...plan.tools[0], outputSchema: 'nope' }] });

    expect(() => parseDeterministicTestPlan(malformed)).toThrow(/malformed outputSchema/);
  });

  it('uses the live tool schema, bypasses SDK output validation and reports the contract', async () => {
    const callTool = vi.fn().mockResolvedValue({ content: [], structuredContent: { total: 'many' } });

    const result = await runDeterministicCase({ callTool }, schemaCase([matchesSchema]), undefined, liveTool);

    expect(callTool.mock.calls[0][1].toolDefinition).toEqual({
      name: 'search',
      annotations: { readOnlyHint: true },
      inputSchema: { type: 'object', properties: {} },
    });
    expect(result.status).toBe('failed');
    expect(result.error).toBeUndefined();
    expect(result.assertions[0].violations).toEqual([
      { path: 'structuredContent.items', message: 'Required property "items" is missing.' },
      { path: 'structuredContent.total', message: 'Expected integer but got string.' },
    ]);
    expect(result.outputContract).toMatchObject({ toolName: 'search', status: 'fail' });
  });

  it('still fails a case without the schema assertion when the live contract is broken', async () => {
    const callTool = vi.fn().mockResolvedValue({ content: [] });

    const result = await runDeterministicCase(
      { callTool },
      schemaCase([{ path: '$.content', operator: 'type', value: 'array' }]),
      undefined,
      liveTool,
    );

    expect(result.status).toBe('failed');
    expect(result.error).toMatchObject({ type: 'malformed-response' });
    expect(result.error?.message).toMatch(/returned no structuredContent/);
  });

  it('prefers live definitions over the plan snapshot when running a plan', async () => {
    const plan = generateDeterministicTestPlan([liveTool], 'https://example.test', '2026-10-20T00:00:00.000Z');
    const outputShape = plan.tools[0].cases.find(item => item.kind === 'output-shape')!;
    const callTool = vi.fn().mockResolvedValue({ content: [], structuredContent: { total: 2, items: ['a'] } });
    const relaxedLiveTool = { ...liveTool, outputSchema: { type: 'object', properties: { total: { type: 'string' } } } };

    const [snapshotRun] = await runDeterministicPlan({ callTool }, plan, { caseIds: [outputShape.id] });
    const [liveRun] = await runDeterministicPlan({ callTool }, plan, {
      caseIds: [outputShape.id],
      toolDefinitions: [relaxedLiveTool],
    });

    expect(snapshotRun.status).toBe('passed');
    expect(callTool.mock.calls[0][1].toolDefinition).toBeUndefined();
    expect(liveRun.status).toBe('failed');
    expect(liveRun.outputContract).toMatchObject({ status: 'fail' });
  });
});
