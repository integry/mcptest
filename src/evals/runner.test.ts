import { beforeEach, describe, expect, it, vi } from 'vitest';
import { LOCAL_TOOL_SELECTION_FIXTURE } from './fixtures';
import { createFixtureProvider, getSessionCredential, setSessionCredential } from './providers';
import { assertReportCredentialSafe, calculateMetrics, compareRuns, reportContainsCredential, runEvaluation } from './runner';
import type { EvalProvider, ToolSelectionDatasetV1 } from './types';

describe('tool-selection evaluation runner', () => {
  beforeEach(() => sessionStorage.clear());

  it('handles multiple acceptable tools, expected no-tool, and malformed arguments deterministically', async () => {
    const progress = vi.fn();
    const report = await runEvaluation(LOCAL_TOOL_SELECTION_FIXTURE, {
      provider: 'fixture',
      model: 'fixture-v1',
      arms: ['with-mcp'],
      trials: 2,
      inputCostPerMillionTokens: 1,
      outputCostPerMillionTokens: 2,
    }, createFixtureProvider(), progress);

    expect(report.results).toHaveLength(6);
    expect(progress).toHaveBeenLastCalledWith(6, 6);
    const alternate = report.results.find(result => result.caseId === 'multiple-acceptable-tools');
    expect(alternate).toMatchObject({ observedTools: ['get_forecast'], selectionPassed: true, expectedToolCalled: true });
    const noTool = report.results.find(result => result.caseId === 'expected-no-tool');
    expect(noTool).toMatchObject({ observedTools: [], noToolPassed: true });
    const malformed = report.results.find(result => result.caseId === 'malformed-arguments');
    expect(malformed).toMatchObject({ selectionPassed: true, argumentSchemaValid: false });
    expect(malformed?.assertionResults.find(item => item.assertion.path === 'days')?.passed).toBe(false);
    expect(report.metrics.selectionAccuracy).toBe(1);
    expect(report.metrics.noToolAccuracy).toBe(1);
    expect(report.metrics.argumentSchemaValidity).toBe(0.5);
    expect(report.metrics.figureGroundingAccuracy).toBe(1);
    expect(report.metrics.expectedToolCallRate).toBe(1);
    expect(report.metrics.latencyMs.p95).toBe(42);
    expect(report.notice).toContain('isolated model evaluation');
  });

  it('keeps selection applicability separate across all three arms', async () => {
    const report = await runEvaluation(LOCAL_TOOL_SELECTION_FIXTURE, {
      provider: 'fixture', model: 'fixture-v1', arms: ['with-mcp', 'without-mcp', 'plain-context'], trials: 1,
    }, createFixtureProvider());

    expect(calculateMetrics(report.results.filter(result => result.arm === 'with-mcp')).selectionAccuracy).toBe(1);
    expect(calculateMetrics(report.results.filter(result => result.arm === 'without-mcp')).selectionAccuracy).toBeNull();
    expect(calculateMetrics(report.results.filter(result => result.arm === 'plain-context')).selectionAccuracy).toBeNull();
    expect(report.results.filter(result => result.caseId === 'expected-no-tool').map(result => result.noToolPassed)).toEqual([true, null, null]);
    expect(report.metrics.noToolAccuracy).toBe(1);
  });

  it('supports deterministic mocked provider output and repeated-trial tails', async () => {
    const latencies = [10, 20, 100];
    const provider: EvalProvider = {
      id: 'fixture',
      run: vi.fn(async request => ({
        toolCalls: request.case.expectedNoTool ? [] : [{ name: request.case.acceptableTools![0], arguments: { city: 'Lisbon' } }],
        latencyMs: latencies[request.trial - 1],
        inputTokens: 10,
        outputTokens: 5,
      })),
    };
    const dataset: ToolSelectionDatasetV1 = {
      ...LOCAL_TOOL_SELECTION_FIXTURE,
      cases: [LOCAL_TOOL_SELECTION_FIXTURE.cases[0]],
    };
    const report = await runEvaluation(dataset, {
      provider: 'fixture', model: 'mock', arms: ['with-mcp'], trials: 3,
    }, provider);

    expect(provider.run).toHaveBeenCalledTimes(3);
    expect(report.metrics.latencyMs).toMatchObject({ mean: 130 / 3, p50: 20, p95: 100, spread: 90 });
  });

  it('stores credentials only in session storage and never includes them in reports', async () => {
    const secret = 'secret-session-key-123';
    setSessionCredential('openai', secret);
    expect(getSessionCredential('openai')).toBe(secret);
    expect(localStorage.length).toBe(0);
    const report = await runEvaluation(LOCAL_TOOL_SELECTION_FIXTURE, {
      provider: 'fixture', model: 'fixture-v1', arms: ['with-mcp'], trials: 1,
    }, createFixtureProvider());
    expect(reportContainsCredential(report, secret)).toBe(false);
    expect(JSON.stringify(report.configuration)).not.toContain('credential');
    expect(() => assertReportCredentialSafe({
      ...report,
      results: [{ ...report.results[0], finalAnswer: secret }],
    }, secret)).toThrow('contained the session credential');
  });

  it('recursively redacts reflected credentials before assertions and tool names reach a report', async () => {
    const secret = 'reflected-session-key';
    const provider: EvalProvider = {
      id: 'fixture',
      async run() {
        return {
          toolCalls: [
            { name: 'get_forecast', arguments: { city: secret, nested: { [secret]: secret }, days: 1 } },
            { name: `unexpected-${secret}`, arguments: { value: secret } },
          ],
          finalAnswer: secret,
          latencyMs: 12,
          inputTokens: 5,
          outputTokens: 2,
        };
      },
    };
    const dataset: ToolSelectionDatasetV1 = {
      ...LOCAL_TOOL_SELECTION_FIXTURE,
      cases: [LOCAL_TOOL_SELECTION_FIXTURE.cases[0]],
    };
    const report = await runEvaluation(dataset, {
      provider: 'fixture', model: 'mock', arms: ['with-mcp'], trials: 1,
    }, provider, undefined, secret);

    expect(reportContainsCredential(report, secret)).toBe(false);
    expect(report.results[0].observedTools).toEqual(['get_forecast', 'unexpected-[redacted]']);
    expect(report.results[0].assertionResults[0].actual).toBe('[redacted]');
    expect(JSON.stringify(report.results[0])).toContain('[redacted]');
  });

  it('keeps provider failures out of model accuracy, cost, and latency metrics', async () => {
    const provider: EvalProvider = {
      id: 'fixture',
      async run() { throw new Error('network unavailable'); },
    };
    const report = await runEvaluation(LOCAL_TOOL_SELECTION_FIXTURE, {
      provider: 'fixture', model: 'mock', arms: ['with-mcp'], trials: 1,
    }, provider);

    expect(report.results.every(result => (
      result.observedTools === null
      && result.selectionPassed === null
      && result.noToolPassed === null
      && result.argumentSchemaValid === null
      && result.expectedToolCalled === null
      && result.latencyMs === null
      && result.assertionResults.length === 0
      && result.error === 'network unavailable'
    ))).toBe(true);
    expect(report.metrics).toMatchObject({
      selectionAccuracy: null,
      noToolAccuracy: null,
      argumentSchemaValidity: null,
      assertionAccuracy: null,
      expectedToolCallRate: null,
      approximateTokenCost: null,
      latencyMs: { mean: null, p95: null },
      confusionPairs: [],
    });
  });

  it('compares run metrics and records description/schema revision changes', async () => {
    const config = { provider: 'fixture' as const, model: 'fixture-v1', arms: ['with-mcp' as const], trials: 1 };
    const first = await runEvaluation(LOCAL_TOOL_SELECTION_FIXTURE, config, createFixtureProvider());
    const revised = {
      ...LOCAL_TOOL_SELECTION_FIXTURE,
      descriptionRevision: 'weather-descriptions-v2',
      schemaRevision: 'weather-schemas-v2',
    };
    const second = await runEvaluation(revised, config, createFixtureProvider());
    const comparison = compareRuns(first, second);
    expect(comparison).toMatchObject({ descriptionRevisionChanged: true, schemaRevisionChanged: true });
    expect(comparison.metricDeltas.selectionAccuracy).toBe(0);
  });
});
