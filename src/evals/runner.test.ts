import { beforeEach, describe, expect, it, vi } from 'vitest';
import { LOCAL_TOOL_SELECTION_FIXTURE } from './fixtures';
import {
  createAnthropicProvider,
  createFixtureProvider,
  createOpenAiProvider,
  getSessionCredential,
  setSessionCredential,
} from './providers';
import {
  assertReportCredentialSafe,
  calculateMetrics,
  compareRuns,
  redactReportCredential,
  reportContainsCredential,
  runEvaluation,
  evaluateAssertion,
} from './runner';
import type { EvalProvider, EvalProviderId, EvalRunReportV1, ToolSelectionDatasetV1 } from './types';

describe('tool-selection evaluation runner', () => {
  beforeEach(() => sessionStorage.clear());

  it('compares reordered and nested JSON objects structurally for equality assertions', () => {
    const actual = {
      payload: {
        outer: { first: 1, nested: { enabled: true, labels: ['a', { code: 2 }] } },
      },
    };
    const reordered = {
      nested: { labels: ['a', { code: 2 }], enabled: true },
      first: 1,
    };

    expect(evaluateAssertion(actual, { path: 'payload.outer', operator: 'equals', value: reordered }).passed).toBe(true);
    expect(evaluateAssertion(actual, { path: 'payload.outer', operator: 'notEquals', value: reordered }).passed).toBe(false);
    expect(evaluateAssertion(actual, {
      path: 'payload.outer',
      operator: 'notEquals',
      value: { nested: { enabled: false, labels: ['a', { code: 2 }] }, first: 1 },
    }).passed).toBe(true);
  });

  it.each(['toString', 'constructor'])(
    'does not treat inherited %s members as observed argument properties',
    path => {
      expect(evaluateAssertion({}, { path, operator: 'present' }).passed).toBe(false);
      expect(evaluateAssertion({}, { path, operator: 'equals', value: Object.prototype[path as keyof Object] }).passed).toBe(false);
      expect(evaluateAssertion({}, { path, operator: 'absent' }).passed).toBe(true);
    }
  );

  it('requires own properties at every nested assertion path segment', () => {
    const argumentsValue = { request: Object.create({ inherited: 42 }) };
    expect(evaluateAssertion(argumentsValue, {
      path: 'request.inherited', operator: 'equals', value: 42,
    }).passed).toBe(false);
  });

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

  it('scores figures only when the arm supplied them through an eligible grounding source', async () => {
    const dataset: ToolSelectionDatasetV1 = {
      ...LOCAL_TOOL_SELECTION_FIXTURE,
      cases: [LOCAL_TOOL_SELECTION_FIXTURE.cases[0]],
    };
    const sourced = await runEvaluation(dataset, {
      provider: 'fixture', model: 'fixture-v1', arms: ['with-mcp', 'without-mcp', 'plain-context'], trials: 1,
    }, createFixtureProvider());

    expect(sourced.results.map(result => [result.arm, result.figuresGrounded])).toEqual([
      ['with-mcp', true],
      ['without-mcp', null],
      ['plain-context', true],
    ]);

    const guessed = await runEvaluation(dataset, {
      provider: 'fixture', model: 'mock', arms: ['with-mcp'], trials: 1,
    }, {
      id: 'fixture',
      async run() {
        return { toolCalls: [], finalAnswer: 'The chance of rain is 32%.', latencyMs: 1 };
      },
    });
    expect(guessed.results[0].figuresGrounded).toBeNull();

    const failedToolResult = await runEvaluation(dataset, {
      provider: 'fixture', model: 'mock', arms: ['with-mcp'], trials: 1,
    }, {
      id: 'fixture',
      async run() {
        return {
          toolCalls: [{ name: 'get_forecast', arguments: { city: 'Lisbon', days: 1 }, result: { rainChancePercent: 32 } }],
          finalAnswer: 'The chance of rain is 32%.',
          latencyMs: 1,
          error: 'Tool-result turn failed.',
        };
      },
    });
    expect(failedToolResult.results[0].figuresGrounded).toBeNull();
  });

  it('scores a successful Anthropic tool-result follow-up as grounded', async () => {
    const fetcher = vi.fn()
      .mockResolvedValueOnce(new Response(JSON.stringify({
        content: [{
          type: 'tool_use', id: 'tool-1', name: 'get_forecast', input: { city: 'Lisbon', days: 1 },
        }],
        usage: { input_tokens: 18, output_tokens: 6 },
      }), { status: 200 }))
      .mockResolvedValueOnce(new Response(JSON.stringify({
        content: [{ type: 'text', text: 'The chance of rain is 32%.' }],
        usage: { input_tokens: 22, output_tokens: 7 },
      }), { status: 200 }));
    const dataset: ToolSelectionDatasetV1 = {
      ...LOCAL_TOOL_SELECTION_FIXTURE,
      cases: [LOCAL_TOOL_SELECTION_FIXTURE.cases[0]],
    };

    const report = await runEvaluation(dataset, {
      provider: 'anthropic', model: 'mock-claude', arms: ['with-mcp'], trials: 1,
    }, createAnthropicProvider('session-secret', fetcher as typeof fetch));

    expect(report.results[0].figuresGrounded).toBe(true);
    expect(report.metrics.figureGroundingAccuracy).toBe(1);
  });

  it.each([undefined, '', '   '])(
    'scores a missing or empty final answer (%j) as ungrounded when figures were supplied',
    async finalAnswer => {
      const dataset: ToolSelectionDatasetV1 = {
        ...LOCAL_TOOL_SELECTION_FIXTURE,
        cases: [LOCAL_TOOL_SELECTION_FIXTURE.cases[0]],
      };
      const report = await runEvaluation(dataset, {
        provider: 'fixture', model: 'mock', arms: ['with-mcp'], trials: 1,
      }, {
        id: 'fixture',
        async run() {
          return {
            toolCalls: [{
              name: 'get_forecast',
              arguments: { city: 'Lisbon', days: 1 },
              result: { rainChancePercent: 32 },
            }],
            finalAnswer,
            latencyMs: 1,
          };
        },
      });

      expect(report.results[0].figuresGrounded).toBe(false);
      expect(report.metrics.figureGroundingAccuracy).toBe(0);
    }
  );

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

  it('publishes malformed provider token usage as unavailable', async () => {
    const dataset: ToolSelectionDatasetV1 = {
      ...LOCAL_TOOL_SELECTION_FIXTURE,
      cases: [LOCAL_TOOL_SELECTION_FIXTURE.cases[0]],
    };
    const provider: EvalProvider = {
      id: 'fixture',
      async run(request) {
        return {
          toolCalls: [{ name: 'get_forecast', arguments: { city: 'Lisbon', days: 1 } }],
          latencyMs: 1,
          inputTokens: request.trial === 1 ? -1 : 2.5,
          outputTokens: request.trial === 1 ? 1.5 : Number.MAX_SAFE_INTEGER + 1,
        };
      },
    };
    const report = await runEvaluation(dataset, {
      provider: 'fixture',
      model: 'mock',
      arms: ['with-mcp'],
      trials: 2,
      inputCostPerMillionTokens: 1,
      outputCostPerMillionTokens: 1,
    }, provider);

    expect(report.results.every(result => (
      result.inputTokens === undefined
      && result.outputTokens === undefined
      && result.approximateCost === undefined
    ))).toBe(true);
    expect(report.metrics).toMatchObject({ inputTokens: 0, outputTokens: 0, approximateTokenCost: null });
  });

  it.each([
    ['input', 'inputCostPerMillionTokens', -1],
    ['input', 'inputCostPerMillionTokens', Number.NaN],
    ['input', 'inputCostPerMillionTokens', Number.POSITIVE_INFINITY],
    ['output', 'outputCostPerMillionTokens', -1],
    ['output', 'outputCostPerMillionTokens', Number.NEGATIVE_INFINITY],
  ] as const)('rejects invalid %s token prices before running trials', async (_, key, price) => {
    const provider: EvalProvider = { id: 'fixture', run: vi.fn() };
    const config = {
      provider: 'fixture' as const,
      model: 'fixture-v1',
      arms: ['with-mcp' as const],
      trials: 1,
      [key]: price,
    };

    await expect(runEvaluation(LOCAL_TOOL_SELECTION_FIXTURE, config, provider)).rejects.toThrow('finite, non-negative');
    expect(provider.run).not.toHaveBeenCalled();
  });

  it('rejects invalid dataset schemas before running trials or producing argument metrics', async () => {
    const provider: EvalProvider = { id: 'fixture', run: vi.fn() };
    const dataset: ToolSelectionDatasetV1 = {
      ...LOCAL_TOOL_SELECTION_FIXTURE,
      tools: LOCAL_TOOL_SELECTION_FIXTURE.tools.map((tool, index) => index === 0 ? {
        ...tool,
        inputSchema: { type: 'not-a-json-schema-type' },
      } : tool),
    };

    await expect(runEvaluation(dataset, {
      provider: 'fixture', model: 'fixture-v1', arms: ['with-mcp'], trials: 1,
    }, provider)).rejects.toThrow('Invalid evaluation dataset');
    expect(provider.run).not.toHaveBeenCalled();
  });

  it.each(['array', 'string'])('rejects %s-root tool schemas before any provider request', async type => {
    const provider: EvalProvider = { id: 'fixture', run: vi.fn() };
    const dataset: ToolSelectionDatasetV1 = {
      ...LOCAL_TOOL_SELECTION_FIXTURE,
      tools: LOCAL_TOOL_SELECTION_FIXTURE.tools.map((tool, index) => index === 0 ? {
        ...tool,
        inputSchema: { type },
      } : tool),
    };

    await expect(runEvaluation(dataset, {
      provider: 'fixture', model: 'fixture-v1', arms: ['with-mcp'], trials: 1,
    }, provider)).rejects.toThrow('must declare an object root');
    expect(provider.run).not.toHaveBeenCalled();
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

  it('fails a trial closed when credential redaction would alter assertion or tool-selection evidence', async () => {
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
    expect(report.results[0]).toMatchObject({
      observedTools: null,
      selectionPassed: null,
      expectedToolCalled: null,
      assertionResults: [],
      error: 'Credential redaction changed tool-selection scoring evidence and the trial was blocked.',
    });
    expect(report.metrics.selectionAccuracy).toBeNull();
  });

  it('fails a trial closed when redaction would reverse an assertion against the redaction marker', async () => {
    const secret = 'assertion-reflection-secret';
    const dataset: ToolSelectionDatasetV1 = {
      ...LOCAL_TOOL_SELECTION_FIXTURE,
      cases: [{
        ...LOCAL_TOOL_SELECTION_FIXTURE.cases[0],
        argumentAssertions: [{ path: 'city', operator: 'equals', value: '[redacted]' }],
      }],
    };
    const provider: EvalProvider = {
      id: 'fixture',
      async run() {
        return {
          toolCalls: [{ name: 'get_forecast', arguments: { city: secret } }],
          latencyMs: 1,
        };
      },
    };

    const report = await runEvaluation(dataset, {
      provider: 'fixture', model: 'mock', arms: ['with-mcp'], trials: 1,
    }, provider, undefined, secret);

    expect(JSON.stringify(report)).not.toContain(secret);
    expect(report.results[0]).toMatchObject({
      observedTools: null,
      selectionPassed: null,
      assertionResults: [],
      error: 'Credential redaction changed assertion scoring evidence and the trial was blocked.',
    });
    expect(report.metrics.assertionAccuracy).toBeNull();
  });

  it('fails a trial closed when redaction would change grounding evidence', async () => {
    const secret = 'grounding-reflection-secret';
    const dataset: ToolSelectionDatasetV1 = {
      ...LOCAL_TOOL_SELECTION_FIXTURE,
      cases: [{
        ...LOCAL_TOOL_SELECTION_FIXTURE.cases[0],
        argumentAssertions: [],
        toolReturnedData: { status: '[redacted]' },
        expectedFigures: ['[redacted]'],
      }],
    };
    const provider: EvalProvider = {
      id: 'fixture',
      async run() {
        return {
          toolCalls: [{
            name: 'get_forecast',
            arguments: { city: 'Lisbon', days: 1 },
            result: { status: '[redacted]' },
          }],
          finalAnswer: secret,
          latencyMs: 1,
        };
      },
    };

    const report = await runEvaluation(dataset, {
      provider: 'fixture', model: 'mock', arms: ['with-mcp'], trials: 1,
    }, provider, undefined, secret);

    expect(JSON.stringify(report)).not.toContain(secret);
    expect(report.results[0]).toMatchObject({
      observedTools: null,
      figuresGrounded: null,
      error: 'Credential redaction changed grounding scoring evidence and the trial was blocked.',
    });
    expect(report.metrics.figureGroundingAccuracy).toBeNull();
  });

  it.each([
    {
      providerId: 'openai' as const,
      createProvider: (secret: string, fetcher: typeof fetch) => createOpenAiProvider(secret, fetcher),
      responseBody: (secret: string) => ({
        choices: [{ message: {
          role: 'assistant',
          content: `Reflected answer ${secret}`,
          tool_calls: [
            {
              id: 'call-1',
              type: 'function',
              function: {
                name: 'get_forecast',
                arguments: JSON.stringify({ city: secret, days: 1, nested: { [secret]: secret } }),
              },
            },
            {
              id: 'call-2',
              type: 'function',
              function: { name: `unexpected-${secret}`, arguments: JSON.stringify({ value: secret }) },
            },
          ],
        } }],
        usage: { prompt_tokens: 9, completion_tokens: 4 },
      }),
    },
    {
      providerId: 'anthropic' as const,
      createProvider: (secret: string, fetcher: typeof fetch) => createAnthropicProvider(secret, fetcher),
      responseBody: (secret: string) => ({
        content: [
          { type: 'text', text: `Reflected answer ${secret}` },
          {
            type: 'tool_use',
            id: 'tool-1',
            name: 'get_forecast',
            input: { city: secret, days: 1, nested: { [secret]: secret } },
          },
          { type: 'tool_use', id: 'tool-2', name: `unexpected-${secret}`, input: { value: secret } },
        ],
        usage: { input_tokens: 9, output_tokens: 4 },
      }),
    },
  ])('fails mocked $providerId trials closed when reflected credentials alter scoring evidence', async ({
    providerId,
    createProvider,
    responseBody,
  }) => {
    const secret = `${providerId}-reflected-session-key`;
    const fetcher = vi.fn().mockResolvedValue(new Response(JSON.stringify(responseBody(secret)), { status: 200 }));
    const dataset: ToolSelectionDatasetV1 = {
      ...LOCAL_TOOL_SELECTION_FIXTURE,
      cases: [{
        ...LOCAL_TOOL_SELECTION_FIXTURE.cases[0],
        toolReturnedData: undefined,
        expectedFigures: undefined,
      }],
    };
    const report = await runEvaluation(dataset, {
      provider: providerId as EvalProviderId,
      model: 'mock-provider-model',
      arms: ['with-mcp'],
      trials: 1,
    }, createProvider(secret, fetcher as typeof fetch), undefined, secret);

    const serialized = JSON.stringify(report);
    expect(serialized).not.toContain(secret);
    expect(report.results[0]).toMatchObject({
      observedTools: null,
      selectionPassed: null,
      expectedToolCalled: null,
      figuresGrounded: null,
      assertionResults: [],
      error: 'Credential redaction changed tool-selection scoring evidence and the trial was blocked.',
    });
  });

  it('fails closed when a report cannot be safely redacted or serialized', async () => {
    const report = await runEvaluation(LOCAL_TOOL_SELECTION_FIXTURE, {
      provider: 'fixture', model: 'fixture-v1', arms: ['with-mcp'], trials: 1,
    }, createFixtureProvider());
    const cyclicReport = { ...report };
    (cyclicReport as unknown as Record<string, unknown>).cycle = cyclicReport;

    expect(() => redactReportCredential(cyclicReport, 'session-key'))
      .toThrow('could not be safely redacted');
  });

  it.each(['id', 'metrics', '1.0'])(
    'blocks a fixture report rather than rewriting trusted report content matching credential %s',
    async credential => {
      await expect(runEvaluation(LOCAL_TOOL_SELECTION_FIXTURE, {
        provider: 'fixture', model: 'fixture-v1', arms: ['with-mcp'], trials: 1,
      }, createFixtureProvider(), undefined, credential))
        .rejects.toThrow('blocked');
    }
  );

  it.each([
    ['tool name', 'get_forecast', LOCAL_TOOL_SELECTION_FIXTURE],
    ['prompt', 'Will it rain in Lisbon tomorrow?', LOCAL_TOOL_SELECTION_FIXTURE],
    ['assertion value', 'assertion-only-secret', {
      ...LOCAL_TOOL_SELECTION_FIXTURE,
      cases: [{
        ...LOCAL_TOOL_SELECTION_FIXTURE.cases[0],
        prompt: 'Check the weather.',
        argumentAssertions: [{ path: 'city', operator: 'equals' as const, value: 'assertion-only-secret' }],
      }],
    }],
    ['dataset metadata', 'metadata-only-secret', {
      ...LOCAL_TOOL_SELECTION_FIXTURE,
      name: 'metadata-only-secret',
    }],
  ] as Array<[string, string, ToolSelectionDatasetV1]>)(
    'blocks credentials matching trusted %s without changing expectations or making a provider request',
    async (_label, credential, dataset) => {
      const provider: EvalProvider = { id: 'fixture', run: vi.fn() };
      await expect(runEvaluation(dataset, {
        provider: 'fixture', model: 'fixture-v1', arms: ['with-mcp'], trials: 1,
      }, provider, undefined, credential)).rejects.toThrow('overlaps trusted evaluation');
      expect(provider.run).not.toHaveBeenCalled();
    }
  );

  it('blocks report export when redacted provider-derived property names would collide', async () => {
    const credential = 'reflected-key';
    const report = await runEvaluation(LOCAL_TOOL_SELECTION_FIXTURE, {
      provider: 'fixture', model: 'fixture-v1', arms: ['with-mcp'], trials: 1,
    }, createFixtureProvider());
    const collidingReport = {
      ...report,
      results: report.results.map((result, index) => index === 0 ? {
        ...result,
        assertionResults: result.assertionResults.map((assertionResult, assertionIndex) => (
          assertionIndex === 0 ? {
            ...assertionResult,
            actual: { [credential]: 'credential key', '[redacted]': 'existing key' },
          } : assertionResult
        )),
      } : result),
    };

    expect(() => redactReportCredential(collidingReport, credential))
      .toThrow('could not be safely redacted');
  });

  it('blocks reports whose metrics disagree with their post-redaction results', async () => {
    const report = await runEvaluation(LOCAL_TOOL_SELECTION_FIXTURE, {
      provider: 'fixture', model: 'fixture-v1', arms: ['with-mcp'], trials: 1,
    }, createFixtureProvider());
    const inconsistentReport = {
      ...report,
      metrics: { ...report.metrics, selectionAccuracy: 0 },
    };

    expect(() => redactReportCredential(inconsistentReport, 'unrelated-session-key'))
      .toThrow('metrics disagreed');
  });

  it('blocks post-redaction selection, no-tool, expected-call, grounding, and assertion contradictions', async () => {
    const report = await runEvaluation(LOCAL_TOOL_SELECTION_FIXTURE, {
      provider: 'fixture', model: 'fixture-v1', arms: ['with-mcp'], trials: 1,
    }, createFixtureProvider());
    const selectionIndex = report.results.findIndex(result => result.selectionPassed !== null);
    const noToolIndex = report.results.findIndex(result => result.noToolPassed !== null);
    const mutations: Array<(candidate: EvalRunReportV1) => void> = [
      candidate => { candidate.results[selectionIndex].selectionPassed = false; },
      candidate => { candidate.results[noToolIndex].noToolPassed = false; },
      candidate => { candidate.results[selectionIndex].expectedToolCalled = false; },
      candidate => {
        candidate.results[selectionIndex].figuresGrounded = true;
        candidate.results[selectionIndex].finalAnswer = '';
      },
      candidate => { candidate.results[selectionIndex].assertionResults[0].passed = false; },
    ];

    mutations.forEach(mutate => {
      const candidate = structuredClone(report);
      mutate(candidate);
      expect(() => redactReportCredential(candidate, 'unrelated-session-key')).toThrow('blocked');
    });
  });

  it('rejects fractional and negative per-trial usage even when aggregates look valid', async () => {
    const report = await runEvaluation(LOCAL_TOOL_SELECTION_FIXTURE, {
      provider: 'fixture', model: 'fixture-v1', arms: ['with-mcp'], trials: 2,
    }, createFixtureProvider());
    const results = report.results.map((result, index) => ({
      ...result,
      inputTokens: index === 0 ? -0.5 : index === 1 ? 1.5 : result.inputTokens,
      approximateCost: index === 0 ? -0.25 : index === 1 ? 0.25 : result.approximateCost,
    }));
    const malformed = { ...report, results, metrics: calculateMetrics(results) };

    expect(malformed.metrics.inputTokens).toBeGreaterThanOrEqual(0);
    expect(malformed.metrics.approximateTokenCost).toBeGreaterThanOrEqual(0);
    expect(() => redactReportCredential(malformed, '')).toThrow('could not be safely redacted');
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

  it('rejects comparisons between different dataset identities', async () => {
    const config = { provider: 'fixture' as const, model: 'fixture-v1', arms: ['with-mcp' as const], trials: 1 };
    const baseline = await runEvaluation(LOCAL_TOOL_SELECTION_FIXTURE, config, createFixtureProvider());
    const candidate = await runEvaluation({
      ...LOCAL_TOOL_SELECTION_FIXTURE,
      id: 'different-weather-eval',
    }, config, createFixtureProvider());

    expect(() => compareRuns(baseline, candidate)).toThrow('different dataset identities');
  });
});
