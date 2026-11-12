import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

const connectionMocks = vi.hoisted(() => ({ attempt: vi.fn() }));

vi.mock('./transportDetection', async (importOriginal) => {
  const actual = await importOriginal<typeof import('./transportDetection')>();
  return { ...actual, attemptParallelConnections: connectionMocks.attempt };
});

import type { DeterministicTestPlanV1 } from '../types/deterministicTests';
import { evaluateServer } from './evaluation';
import { createPublicReport } from './reportArtifact';
import { countPlanResults, loadSavedTestPlans, recordSavedPlanRun, saveTestPlan } from './savedTestPlans';

const serverUrl = 'https://plans-report.example/mcp';

const tools = [
  { name: 'lookup_city', inputSchema: { type: 'object' }, annotations: { readOnlyHint: true } },
  { name: 'delete_city', description: 'Delete a city', inputSchema: { type: 'object' } },
];

const createClient = (callTool: (request: { arguments: { city: string } }) => Promise<unknown>) => ({
  request: vi.fn(async ({ method }: { method: string }) => ({
    'tools/list': { tools },
    'resources/list': { resources: [] },
    'resources/templates/list': { resourceTemplates: [] },
    'prompts/list': { prompts: [] },
  } as Record<string, unknown>)[method]),
  callTool,
  close: vi.fn().mockResolvedValue(undefined),
});

const plan = (): DeterministicTestPlanV1 => ({
  version: '1.0.0',
  name: 'Recorded calls',
  serverUrl,
  generatedAt: '2026-10-20T10:00:00.000Z',
  tools: [
    {
      toolName: 'lookup_city',
      safety: { writeCapable: false, destructive: false, reasons: [] },
      cases: ['Tallinn', 'Atlantis'].map((city, index) => ({
        id: `lookup-${index}`,
        toolName: 'lookup_city',
        name: `Recorded call ${index + 1}`,
        kind: 'happy-path' as const,
        selected: true,
        arguments: { city },
        assertions: [
          { path: '$.isError', operator: 'not-equals' as const, value: true },
          { path: '$.content[0].text', operator: 'contains' as const, value: 'Capital city' },
        ],
        timeoutMs: 1_000,
      })),
    },
    {
      toolName: 'delete_city',
      safety: { writeCapable: true, destructive: true, reasons: ['Deletes'] },
      cases: [{
        id: 'delete-0', toolName: 'delete_city', name: 'Recorded call 1', kind: 'happy-path', selected: true,
        arguments: { city: 'Riga' }, assertions: [], timeoutMs: 1_000,
      }],
    },
  ],
});

const planEvidence = (report: Awaited<ReturnType<typeof evaluateServer>>) => (
  report.sections.capabilities.details.filter((detail) => (
    (detail.metadata as { savedPlanCases?: number } | undefined)?.savedPlanCases !== undefined
  ))
);

describe('saved test plans in evaluation runs', () => {
  let callTool: ReturnType<typeof vi.fn<(request: { arguments: { city: string } }) => Promise<unknown>>>;

  beforeEach(() => {
    localStorage.clear();
    sessionStorage.clear();
    vi.stubGlobal('fetch', vi.fn(async () => new Response('Not found', { status: 404 })));
    callTool = vi.fn(async ({ arguments: args }: { arguments: { city: string } }): Promise<unknown> => ({
      content: [{ type: 'text', text: args.city === 'Tallinn' ? 'Capital city of Estonia' : 'No such place' }],
    }));
    connectionMocks.attempt.mockReset();
    connectionMocks.attempt.mockResolvedValue({
      client: createClient(callTool),
      url: serverUrl,
      transportType: 'streamable-http',
      protocolEra: 'modern',
      protocolVersion: '2026-07-28',
    });
  });

  afterEach(() => {
    localStorage.clear();
    vi.unstubAllGlobals();
  });

  it('runs the saved plan on the report connection and publishes counts only', async () => {
    const saved = saveTestPlan(serverUrl, plan());
    const report = await evaluateServer(serverUrl, '', vi.fn(), null, undefined, undefined, {
      savedPlan: { id: saved.id, plan: saved.plan },
    });
    const [detail] = planEvidence(report);

    expect(detail.metadata).toEqual({
      savedPlanCases: 3, savedPlanPassed: 1, savedPlanFailed: 1, savedPlanBlocked: 1, savedPlanCancelled: 0,
    });
    expect(detail.text).toBe('ℹ Saved test plan: 1 passed, 1 failed, 1 blocked');
    expect(detail.context).toContain('during this report');
    // The destructive tool was not confirmed, so it never ran.
    expect(callTool).toHaveBeenCalledTimes(2);
    expect(loadSavedTestPlans(serverUrl)[0].lastRun).toMatchObject({ passed: 1, failed: 1, blocked: 1, source: 'report' });

    // Tool names appear in the report's own inventory; plan arguments, results and case names never do.
    const artifact = JSON.stringify(createPublicReport(report));
    expect(artifact).toContain('"savedPlanPassed":1');
    for (const content of ['Tallinn', 'Atlantis', 'Capital city', 'No such place', 'Recorded call', 'Recorded calls']) {
      expect(artifact).not.toContain(content);
    }
  });

  it('runs confirmed write-capable tools when the person allowed them', async () => {
    const saved = saveTestPlan(serverUrl, plan());
    const report = await evaluateServer(serverUrl, '', vi.fn(), null, undefined, undefined, {
      savedPlan: { id: saved.id, plan: saved.plan, confirmedUnsafeToolNames: ['delete_city'] },
    });
    expect(planEvidence(report)[0].metadata).toMatchObject({ savedPlanPassed: 2, savedPlanFailed: 1, savedPlanBlocked: 0 });
    expect(callTool).toHaveBeenCalledTimes(3);
  });

  it('includes the newest stored run counts when no plan runs, and nothing without one', async () => {
    expect(planEvidence(await evaluateServer(serverUrl, '', vi.fn(), null))).toEqual([]);

    const saved = saveTestPlan(serverUrl, plan());
    recordSavedPlanRun(serverUrl, saved.id, countPlanResults(
      [{ status: 'passed' }, { status: 'passed' }, { status: 'failed' }], 'playground', '2026-10-20T12:00:00.000Z',
    ));
    const report = await evaluateServer(serverUrl, '', vi.fn(), null);
    const [detail] = planEvidence(report);
    expect(detail.metadata).toMatchObject({ savedPlanCases: 3, savedPlanPassed: 2, savedPlanFailed: 1 });
    expect(detail.context).toContain('playground, 2026-10-20T12:00:00.000Z');
    expect(callTool).not.toHaveBeenCalled();

    const headless = await evaluateServer(serverUrl, '', vi.fn(), null, undefined, undefined, { runtime: 'headless' });
    expect(planEvidence(headless)).toEqual([]);
  });

  it('keeps the report when the plan cannot run', async () => {
    const saved = saveTestPlan(serverUrl, plan());
    const broken = { ...saved.plan, version: '0.0.1' } as unknown as DeterministicTestPlanV1;
    const onProgress = vi.fn();
    const report = await evaluateServer(serverUrl, '', onProgress, null, undefined, undefined, {
      savedPlan: { id: saved.id, plan: broken },
      savedPlanRunCounts: null,
    });
    expect(planEvidence(report)).toEqual([]);
    expect(report.sections.capabilities).toBeDefined();
    expect(onProgress).toHaveBeenCalledWith(expect.stringContaining('The saved test plan could not run'));
  });
});
