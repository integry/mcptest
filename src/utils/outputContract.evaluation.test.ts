import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

const connectionMocks = vi.hoisted(() => ({ attempt: vi.fn() }));

vi.mock('./transportDetection', async (importOriginal) => {
  const actual = await importOriginal<typeof import('./transportDetection')>();
  return { ...actual, attemptParallelConnections: connectionMocks.attempt };
});

import { evaluateServer } from './evaluation';
import {
  checkToolOutputContract,
  clearRecordedOutputContractResults,
  getRecordedOutputContractResults,
  recordOutputContractResult,
} from './outputContract';
import { createToolResultLogEntry } from './toolCallResult';
import { generateDeterministicTestPlan, runDeterministicPlan } from './deterministicTests';
import { createCompatibilityMatrix, createReleaseDecision } from './releaseReadiness';

const createClient = () => {
  const lists: Record<string, unknown> = {
    'tools/list': { tools: [] },
    'resources/list': { resources: [] },
    'resources/templates/list': { resourceTemplates: [] },
    'prompts/list': { prompts: [] },
  };
  return {
    request: vi.fn(async ({ method }: { method: string }) => lists[method]),
    close: vi.fn().mockResolvedValue(undefined),
  };
};

const serverUrl = 'https://contract.example/mcp';
const schema = { type: 'object', properties: { count: { type: 'number' } }, required: ['count'] };

describe('output contract evidence in evaluation runs', () => {
  beforeEach(() => {
    sessionStorage.clear();
    vi.stubGlobal('fetch', vi.fn(async () => new Response('Not found', { status: 404 })));
    connectionMocks.attempt.mockReset();
    connectionMocks.attempt.mockResolvedValue({
      client: createClient(),
      url: serverUrl,
      transportType: 'streamable-http',
      protocolEra: 'modern',
      protocolVersion: '2026-07-28',
    });
  });

  afterEach(() => {
    clearRecordedOutputContractResults();
    vi.unstubAllGlobals();
  });

  it('reports a recorded output-contract violation as a stable release finding', async () => {
    recordOutputContractResult(serverUrl, checkToolOutputContract(
      { name: 'count_items', outputSchema: schema },
      { content: [], structuredContent: { count: 'three' } },
    ));
    recordOutputContractResult(serverUrl, checkToolOutputContract(
      { name: 'list_items', outputSchema: schema },
      { content: [], structuredContent: { count: 3 } },
    ));

    const report = await evaluateServer(serverUrl, '', vi.fn(), null, undefined, undefined, { runtime: 'headless' });

    expect(report.outputContracts).toEqual({
      checkedToolCount: 2,
      passingTools: ['list_items'],
      violatingTools: [{
        toolName: 'count_items',
        violations: [{ path: 'structuredContent.count', message: 'Expected number but got string.' }],
        omittedViolationCount: 0,
      }],
    });
    const detail = report.sections.capabilities.details.find(item => (
      (item.metadata as { method?: string } | undefined)?.method === 'tools/call'
    ));
    expect(detail?.text).toBe('✗ 1 of 2 checked tools broke their declared output contract');
    expect(detail?.metadata).toMatchObject({ findingId: 'tool.output-contract-violation' });
    expect(report.sections.capabilities.score).toBe(10);

    const decision = createReleaseDecision(report, createCompatibilityMatrix(report));
    const finding = decision.priorities.find(item => item.id === 'tool.output-contract-violation');
    expect(decision.status).toBe('blocked');
    expect(finding).toMatchObject({ severity: 'high', source: 'Tool surface' });
    expect(finding?.detail).toContain('count_items');
    expect(finding?.detail).toContain('structuredContent.count: Expected number but got string.');
  });

  it('drops a recorded violation once the tool stops declaring an output schema', async () => {
    const failing = { content: [], structuredContent: { count: 'three' } };
    createToolResultLogEntry({ name: 'count_items', outputSchema: schema }, failing, {
      serverUrl, type: 'tool', name: 'count_items', params: {},
    });
    expect(getRecordedOutputContractResults(serverUrl)).toMatchObject([{ toolName: 'count_items', status: 'fail' }]);

    // The server removed the schema; the refreshed definition no longer carries it.
    const entry = createToolResultLogEntry({ name: 'count_items' }, failing, {
      serverUrl: 'contract.example/mcp', type: 'tool', name: 'count_items', params: {},
    });
    expect(entry.toolCall?.contract.status).toBe('no-schema');
    expect(getRecordedOutputContractResults(serverUrl)).toEqual([]);

    const report = await evaluateServer(serverUrl, '', vi.fn(), null, undefined, undefined, { runtime: 'headless' });

    expect(report.outputContracts).toBeUndefined();
    const decision = createReleaseDecision(report, createCompatibilityMatrix(report));
    expect(decision.priorities.map(item => item.id)).not.toContain('tool.output-contract-violation');
  });

  it('drops a recorded violation when a deterministic rerun follows removal of the output schema', async () => {
    const baseTool = { name: 'count_items', inputSchema: { type: 'object' }, annotations: { readOnlyHint: true } };
    const callTool = vi.fn().mockResolvedValue({ content: [], structuredContent: { count: 'three' } });
    // Mirrors DeterministicTestPanel, which records each result's contract verdict.
    const runAndRecord = async (tool: Record<string, unknown> & { name: string }) => {
      const plan = generateDeterministicTestPlan([tool], serverUrl, '2026-10-20T00:00:00.000Z');
      await runDeterministicPlan({ callTool }, plan, {
        toolDefinitions: [tool],
        onResult: result => {
          if (result.outputContract) recordOutputContractResult(serverUrl, result.outputContract);
        },
      });
    };

    await runAndRecord({ ...baseTool, outputSchema: schema });
    expect(getRecordedOutputContractResults(serverUrl)).toMatchObject([{ toolName: 'count_items', status: 'fail' }]);

    await runAndRecord(baseTool);
    expect(getRecordedOutputContractResults(serverUrl)).toEqual([]);

    const report = await evaluateServer(serverUrl, '', vi.fn(), null, undefined, undefined, { runtime: 'headless' });

    expect(report.outputContracts).toBeUndefined();
    const decision = createReleaseDecision(report, createCompatibilityMatrix(report));
    expect(decision.priorities.map(item => item.id)).not.toContain('tool.output-contract-violation');
  });

  it('accepts explicit contract results and omits the finding when every tool passes', async () => {
    const report = await evaluateServer(serverUrl, '', vi.fn(), null, undefined, undefined, {
      runtime: 'headless',
      outputContractResults: [checkToolOutputContract(
        { name: 'list_items', outputSchema: schema },
        { content: [], structuredContent: { count: 3 } },
      )],
    });

    expect(report.outputContracts?.violatingTools).toEqual([]);
    const decision = createReleaseDecision(report, createCompatibilityMatrix(report));
    expect(decision.priorities.map(item => item.id)).not.toContain('tool.output-contract-violation');
  });

  it('adds no output-contract evidence when no tool results were checked', async () => {
    const report = await evaluateServer(serverUrl, '', vi.fn(), null, undefined, undefined, { runtime: 'headless' });

    expect(report.outputContracts).toBeUndefined();
  });
});
