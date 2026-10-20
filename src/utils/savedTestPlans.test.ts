import Ajv2020 from 'ajv/dist/2020';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import planSchema from '../../public/schemas/test-plan/v1.schema.json';
import type { DeterministicTestPlanV1 } from '../types/deterministicTests';
import { createCallHistoryEntry } from './callHistory';
import {
  generateDeterministicTestPlan,
  parseDeterministicTestPlan,
  serializeDeterministicTestPlan,
} from './deterministicTests';
import { createTestPlanFromHistory } from './historyTestPlan';
import {
  SAVED_TEST_PLANS_PER_SERVER,
  SAVED_TEST_PLANS_SERVER_LIMIT,
  SAVED_TEST_PLANS_STORAGE_KEY,
  SAVED_TEST_PLAN_BYTE_LIMIT,
  SAVED_TEST_PLAN_CASE_LIMIT,
  countPlanResults,
  deleteSavedTestPlan,
  latestSavedPlanRun,
  loadSavedTestPlans,
  recordSavedPlanRun,
  renameSavedTestPlan,
  runSavedTestPlan,
  runnableCaseIds,
  saveTestPlan,
  unsafePlanToolNames,
} from './savedTestPlans';

const serverUrl = 'https://plans.example/mcp';
const tools = [
  { name: 'weather', inputSchema: { type: 'object' }, annotations: { readOnlyHint: true } },
  { name: 'create_issue', description: 'Create an issue', inputSchema: { type: 'object' } },
];

const validatePlanSchema = new Ajv2020({ strict: false }).compile(planSchema);

const historyPlan = (): DeterministicTestPlanV1 => createTestPlanFromHistory([
  createCallHistoryEntry({
    toolName: 'weather',
    arguments: { city: 'Riga' },
    result: { type: 'tool_result', data: [], timestamp: '', toolCall: {
      result: { content: [{ type: 'text', text: 'Riga: light rain' }] },
      contract: { toolName: 'weather', status: 'no-schema', violations: [], hasStructuredContent: false, isError: false },
    } },
    durationMs: 5,
  }),
], tools, serverUrl, { generatedAt: '2026-10-20T10:00:00.000Z' }).plan;

const planWithCases = (count: number): DeterministicTestPlanV1 => {
  const plan = historyPlan();
  const [template] = plan.tools[0].cases;
  plan.tools[0].cases = Array.from({ length: count }, (_, index) => ({ ...template, id: `case-${index}`, arguments: { city: `City ${index}` } }));
  return plan;
};

beforeEach(() => localStorage.clear());

describe('saved test plans', () => {
  it('saves, lists, renames and deletes plans per normalized endpoint', () => {
    const saved = saveTestPlan('https://PLANS.example/mcp', historyPlan(), { now: '2026-10-20T10:00:00.000Z' });
    expect(loadSavedTestPlans(serverUrl).map((item) => item.id)).toEqual([saved.id]);
    expect(loadSavedTestPlans('https://other.example/mcp')).toEqual([]);

    const [renamed] = renameSavedTestPlan(serverUrl, saved.id, '  Smoke   tests ');
    expect(renamed.name).toBe('Smoke tests');
    expect(renamed.plan.name).toBe('Smoke tests');

    expect(deleteSavedTestPlan(serverUrl, saved.id)).toEqual([]);
    expect(localStorage.getItem(SAVED_TEST_PLANS_STORAGE_KEY)).toBeNull();
  });

  it('updates a plan in place by id and clears counts that described the old cases', () => {
    const saved = saveTestPlan(serverUrl, historyPlan(), { name: 'Smoke', now: '2026-10-20T10:00:00.000Z' });
    recordSavedPlanRun(serverUrl, saved.id, countPlanResults([{ status: 'passed' }], 'playground', '2026-10-20T10:05:00.000Z'));
    expect(loadSavedTestPlans(serverUrl)[0].lastRun?.passed).toBe(1);

    const updated = saveTestPlan(serverUrl, planWithCases(2), { id: saved.id, now: '2026-10-20T11:00:00.000Z' });
    const list = loadSavedTestPlans(serverUrl);
    expect(list).toHaveLength(1);
    expect(updated).toMatchObject({ id: saved.id, name: 'Smoke', savedAt: '2026-10-20T10:00:00.000Z', updatedAt: '2026-10-20T11:00:00.000Z' });
    expect(list[0].lastRun).toBeUndefined();
  });

  it('keeps at most the newest plans per endpoint and a bounded number of endpoints', () => {
    for (let index = 0; index < SAVED_TEST_PLANS_PER_SERVER + 3; index += 1) {
      saveTestPlan(serverUrl, historyPlan(), { name: `Plan ${index}`, now: new Date(Date.UTC(2026, 9, 20, 10, index)).toISOString() });
    }
    const names = loadSavedTestPlans(serverUrl).map((item) => item.name);
    expect(names).toHaveLength(SAVED_TEST_PLANS_PER_SERVER);
    expect(names[0]).toBe(`Plan ${SAVED_TEST_PLANS_PER_SERVER + 2}`);
    expect(names).not.toContain('Plan 0');

    for (let index = 0; index < SAVED_TEST_PLANS_SERVER_LIMIT + 2; index += 1) {
      saveTestPlan(`https://server-${index}.example/mcp`, historyPlan());
    }
    const stored = JSON.parse(localStorage.getItem(SAVED_TEST_PLANS_STORAGE_KEY)!);
    expect(stored.servers).toHaveLength(SAVED_TEST_PLANS_SERVER_LIMIT);
    expect(loadSavedTestPlans(serverUrl)).toEqual([]);
  });

  it('refuses plans above the case and size bounds', () => {
    expect(() => saveTestPlan(serverUrl, planWithCases(SAVED_TEST_PLAN_CASE_LIMIT + 1))).toThrow(/more than 200 cases/);
    const large = historyPlan();
    large.tools[0].cases[0].arguments = { text: 'x'.repeat(SAVED_TEST_PLAN_BYTE_LIMIT) };
    expect(() => saveTestPlan(serverUrl, large)).toThrow(/larger than 100 KB/);
    expect(loadSavedTestPlans(serverUrl)).toEqual([]);
  });

  it('reports a full storage quota as a save failure', () => {
    const storage = {
      getItem: () => null,
      setItem: () => { throw new DOMException('Quota exceeded', 'QuotaExceededError'); },
      removeItem: () => undefined,
    };
    expect(() => saveTestPlan(serverUrl, historyPlan(), {}, storage)).toThrow(/storage may be full/);
  });

  it('redacts arguments, assertions and the endpoint, and unselects cases that now hold placeholders', () => {
    const plan = historyPlan();
    plan.serverUrl = 'https://plans.example/mcp?token=url-secret';
    plan.tools[0].cases[0].arguments = { city: 'Riga', password: 'hunter2-hunter2', note: 'sk-proj-abcdefghijklmnopqrstuvwxyz012345' };
    plan.tools[0].cases[0].assertions.push({ path: '$.structuredContent.api_key', operator: 'equals', value: 'equal-secret' });
    const saved = saveTestPlan(serverUrl, plan);
    const raw = localStorage.getItem(SAVED_TEST_PLANS_STORAGE_KEY)!;
    for (const secret of ['url-secret', 'hunter2-hunter2', 'sk-proj-abcdefghijklmnopqrstuvwxyz012345', 'equal-secret']) {
      expect(raw).not.toContain(secret);
    }
    expect(saved.plan.tools[0].cases[0].arguments.city).toBe('Riga');
    expect(saved.plan.tools[0].cases[0].selected).toBe(false);
    expect(runnableCaseIds(saved.plan)).toEqual([]);
  });

  it('re-redacts and validates entries on read, dropping malformed ones', () => {
    const plan = historyPlan();
    plan.tools[0].cases[0].arguments = { secret: 'written-by-older-build' };
    localStorage.setItem(SAVED_TEST_PLANS_STORAGE_KEY, JSON.stringify({
      version: 1,
      servers: [{
        endpoint: serverUrl,
        plans: [
          { id: 'a', name: 'Old', savedAt: '2026-10-01T00:00:00.000Z', updatedAt: '2026-10-01T00:00:00.000Z', plan },
          { id: 'b', name: 'Broken', savedAt: 'x', updatedAt: 'x', plan: { version: '0.1' } },
        ],
      }],
    }));
    const plans = loadSavedTestPlans(serverUrl);
    expect(plans.map((item) => item.id)).toEqual(['a']);
    expect(JSON.stringify(plans)).not.toContain('written-by-older-build');
  });

  it('keeps run counts only and returns the newest run for the endpoint', () => {
    const first = saveTestPlan(serverUrl, historyPlan(), { name: 'First' });
    const second = saveTestPlan(serverUrl, historyPlan(), { name: 'Second' });
    recordSavedPlanRun(serverUrl, first.id, countPlanResults([{ status: 'passed' }, { status: 'failed' }], 'playground', '2026-10-20T12:00:00.000Z'));
    recordSavedPlanRun(serverUrl, second.id, countPlanResults([{ status: 'blocked' }], 'report', '2026-10-20T11:00:00.000Z'));
    expect(latestSavedPlanRun(serverUrl)).toEqual({
      total: 2, passed: 1, failed: 1, blocked: 0, cancelled: 0, ranAt: '2026-10-20T12:00:00.000Z', source: 'playground',
    });
    expect(latestSavedPlanRun('https://other.example/mcp')).toBeUndefined();
  });

  it('runs runnable cases, blocks unconfirmed write-capable tools and records the counts', async () => {
    const plan = historyPlan();
    plan.tools.push({
      toolName: 'create_issue',
      safety: { writeCapable: true, destructive: false, reasons: [] },
      cases: [{ ...plan.tools[0].cases[0], id: 'create', toolName: 'create_issue', arguments: { title: 'Bug' } }],
    });
    const saved = saveTestPlan(serverUrl, plan);
    expect(unsafePlanToolNames(saved.plan, tools)).toEqual(['create_issue']);
    const client = { callTool: vi.fn().mockResolvedValue({ content: [{ type: 'text', text: 'Riga: light rain today' }] }) };

    const counts = await runSavedTestPlan(client, serverUrl, saved, tools, { source: 'report' });
    expect(counts).toMatchObject({ total: 2, passed: 1, failed: 0, blocked: 1, source: 'report' });
    expect(client.callTool).toHaveBeenCalledTimes(1);
    expect(loadSavedTestPlans(serverUrl)[0].lastRun).toMatchObject({ passed: 1, blocked: 1 });

    const confirmed = await runSavedTestPlan(client, serverUrl, saved, tools, { source: 'report', confirmedUnsafeToolNames: ['create_issue'] });
    expect(confirmed).toMatchObject({ passed: 2, blocked: 0 });
  });
});

describe('plan JSON import and export', () => {
  it('round-trips a saved history plan through export and import unchanged', () => {
    const saved = saveTestPlan(serverUrl, historyPlan());
    const exported = serializeDeterministicTestPlan(saved.plan);
    expect(validatePlanSchema(JSON.parse(exported))).toBe(true);
    const imported = parseDeterministicTestPlan(exported);
    expect(imported).toEqual(saved.plan);
    const resaved = saveTestPlan(serverUrl, imported, { id: saved.id });
    expect(resaved.plan).toEqual(saved.plan);
  });

  it('publishes a schema that every exported generated plan satisfies', () => {
    const plan = generateDeterministicTestPlan([
      ...tools,
      { name: 'forecast', inputSchema: { type: 'object', properties: { days: { type: 'integer' } }, required: ['days'] }, outputSchema: { type: 'object', required: ['days'] } },
    ], serverUrl);
    expect(validatePlanSchema(JSON.parse(serializeDeterministicTestPlan(plan)))).toBe(true);
  });

  it('imports any schema-valid plan, including one that names its $schema', () => {
    const plan = {
      $schema: 'https://mcptest.io/schemas/test-plan/v1.schema.json',
      ...JSON.parse(serializeDeterministicTestPlan(historyPlan())),
    };
    expect(validatePlanSchema(plan)).toBe(true);
    expect(() => parseDeterministicTestPlan(JSON.stringify(plan))).not.toThrow();
  });

  it('rejects malformed contains and not-equals assertions in both the schema and the importer', () => {
    const plan = JSON.parse(serializeDeterministicTestPlan(historyPlan()));
    plan.tools[0].cases[0].assertions = [{ path: '$.content[0].text', operator: 'contains', value: '' }];
    expect(validatePlanSchema(plan)).toBe(false);
    expect(() => parseDeterministicTestPlan(JSON.stringify(plan))).toThrow(/contains assertion/);
    plan.tools[0].cases[0].assertions = [{ path: '$.isError', operator: 'not-equals' }];
    expect(validatePlanSchema(plan)).toBe(false);
    expect(() => parseDeterministicTestPlan(JSON.stringify(plan))).toThrow(/not-equals assertion without a value/);
  });
});
