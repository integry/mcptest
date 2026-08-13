import { getRunnableCases, validateDataset } from './dataset';
import { redactCredential } from './providers';
import { validateJsonSchema } from './schema';
import {
  TOOL_SELECTION_REPORT_VERSION,
  type ArgumentAssertion,
  type AssertionResult,
  type ConfusionPair,
  type DistributionSummary,
  type EvalMetrics,
  type EvalProvider,
  type EvalRunComparison,
  type EvalRunConfig,
  type EvalRunReportV1,
  type EvalTrialResult,
  type ToolCallObservation,
  type ToolSelectionCase,
  type ToolSelectionDatasetV1,
} from './types';

const percentile = (sorted: number[], fraction: number): number => {
  if (!sorted.length) return 0;
  return sorted[Math.min(sorted.length - 1, Math.ceil(sorted.length * fraction) - 1)];
};

export const summarizeDistribution = (values: number[]): DistributionSummary => {
  if (!values.length) return { mean: null, min: null, max: null, p50: null, p95: null, spread: null };
  const sorted = [...values].sort((a, b) => a - b);
  const mean = values.reduce((sum, value) => sum + value, 0) / values.length;
  return {
    mean,
    min: sorted[0],
    max: sorted[sorted.length - 1],
    p50: percentile(sorted, 0.5),
    p95: percentile(sorted, 0.95),
    spread: sorted[sorted.length - 1] - sorted[0],
  };
};

const rate = (values: Array<boolean | null>): number | null => {
  const applicable = values.filter((value): value is boolean => value !== null);
  return applicable.length ? applicable.filter(Boolean).length / applicable.length : null;
};

const readPath = (value: unknown, path: string): { present: boolean; value?: unknown } => {
  const parts = path.replace(/^\$\.?/, '').split('.').filter(Boolean);
  let cursor: unknown = value;
  for (const part of parts) {
    if (!cursor || typeof cursor !== 'object' || !Object.prototype.hasOwnProperty.call(cursor, part)) {
      return { present: false };
    }
    cursor = (cursor as Record<string, unknown>)[part];
  }
  return { present: true, value: cursor };
};

const deepEqual = (left: unknown, right: unknown): boolean => {
  if (left === right) return true;
  if (left === null || right === null || typeof left !== 'object' || typeof right !== 'object') return false;
  if (Array.isArray(left) || Array.isArray(right)) {
    return Array.isArray(left)
      && Array.isArray(right)
      && left.length === right.length
      && left.every((item, index) => deepEqual(item, right[index]));
  }
  const leftRecord = left as Record<string, unknown>;
  const rightRecord = right as Record<string, unknown>;
  const leftKeys = Object.keys(leftRecord);
  const rightKeys = Object.keys(rightRecord);
  return leftKeys.length === rightKeys.length && leftKeys.every(key => (
    Object.prototype.hasOwnProperty.call(rightRecord, key)
    && deepEqual(leftRecord[key], rightRecord[key])
  ));
};

export const evaluateAssertion = (argumentsValue: unknown, assertion: ArgumentAssertion): AssertionResult => {
  const actual = readPath(argumentsValue, assertion.path);
  let passed = false;
  switch (assertion.operator) {
    case 'present': passed = actual.present; break;
    case 'absent': passed = !actual.present; break;
    case 'equals': passed = actual.present && deepEqual(actual.value, assertion.value); break;
    case 'notEquals': passed = actual.present && !deepEqual(actual.value, assertion.value); break;
    case 'type':
      passed = actual.present && (
        assertion.value === 'array' ? Array.isArray(actual.value)
          : assertion.value === 'null' ? actual.value === null
            : assertion.value === 'integer' ? typeof actual.value === 'number' && Number.isInteger(actual.value)
              : typeof actual.value === assertion.value
      );
      break;
    case 'matches':
      try { passed = actual.present && typeof actual.value === 'string' && new RegExp(String(assertion.value)).test(actual.value); } catch { passed = false; }
      break;
    case 'includes':
      passed = actual.present && (
        Array.isArray(actual.value) ? actual.value.some(item => deepEqual(item, assertion.value))
          : typeof actual.value === 'string' && actual.value.includes(String(assertion.value))
      );
      break;
  }
  return {
    assertion,
    passed,
    ...(actual.present ? { actual: actual.value } : {}),
    ...(passed ? {} : { message: actual.present ? 'Observed value did not satisfy the assertion.' : 'Argument path was not present.' }),
  };
};

const figuresFrom = (value: unknown): string[] => {
  if (typeof value === 'number') return [String(value)];
  if (Array.isArray(value)) return value.flatMap(figuresFrom);
  if (value && typeof value === 'object') return Object.values(value).flatMap(figuresFrom);
  return [];
};

const figureAppears = (answer: string, figure: string | number): boolean => {
  const escaped = String(figure).replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
  return new RegExp(`(^|[^0-9.])${escaped}([^0-9.]|$)`).test(answer);
};

const sourceContainsFigure = (source: unknown, figure: string | number): boolean => {
  if (typeof source === 'string' || typeof source === 'number') {
    return figureAppears(String(source), figure);
  }
  if (Array.isArray(source)) return source.some(value => sourceContainsFigure(value, figure));
  if (source && typeof source === 'object') {
    return Object.values(source).some(value => sourceContainsFigure(value, figure));
  }
  return false;
};

const scoreTrial = (
  evalCase: ToolSelectionCase,
  arm: EvalTrialResult['arm'],
  trial: number,
  observation: Awaited<ReturnType<EvalProvider['run']>>,
  tools: ToolSelectionDatasetV1['tools'],
  config: EvalRunConfig
): EvalTrialResult => {
  const expected = evalCase.acceptableTools || [];
  const forbidden = evalCase.forbiddenTools || [];
  const observed = observation.toolCalls.map(call => call.name);
  const callsExpected = observation.toolCalls.filter(call => expected.includes(call.name));
  const forbiddenToolCalled = observed.some(name => forbidden.includes(name));
  const isToolArm = arm === 'with-mcp';
  const expectedNoTool = evalCase.expectedNoTool === true;
  const selectionPassed = isToolArm && !expectedNoTool
    ? callsExpected.length > 0 && !forbiddenToolCalled
    : null;
  const noToolPassed = isToolArm && expectedNoTool ? observed.length === 0 : null;
  const schemaChecks = observation.toolCalls.map(call => {
    const tool = tools.find(candidate => candidate.name === call.name);
    return Boolean(tool) && validateJsonSchema(call.arguments, tool!.inputSchema).length === 0;
  });
  const argumentSchemaValid = observation.toolCalls.length ? schemaChecks.every(Boolean) : null;
  const assertions = isToolArm ? (evalCase.argumentAssertions || []) : [];
  const assertionResults = assertions.map(assertion => {
    const matchingCall = observation.toolCalls.find(call => !assertion.tool || assertion.tool === call.name);
    return matchingCall
      ? evaluateAssertion(matchingCall.arguments, assertion)
      : { assertion, passed: false, message: 'The asserted tool was not called.' };
  });
  const groundingSources = arm === 'plain-context' && evalCase.toolReturnedData !== undefined
    ? [evalCase.toolReturnedData]
    : arm === 'with-mcp' && !observation.error
      ? callsExpected.flatMap(call => call.result === undefined ? [] : [call.result])
      : [];
  const figures = evalCase.expectedFigures?.length
    ? evalCase.expectedFigures
    : groundingSources.flatMap(figuresFrom);
  const relevantSourceAvailable = figures.length > 0
    && figures.every(figure => groundingSources.some(source => sourceContainsFigure(source, figure)));
  // Grounding is not applicable when the arm did not supply the configured
  // figures. Once a relevant source is available, a missing answer or figure is
  // a response-quality failure.
  const finalAnswer = observation.finalAnswer?.trim();
  const figuresGrounded = relevantSourceAvailable
    ? Boolean(finalAnswer) && figures.every(figure => figureAppears(finalAnswer!, figure))
    : null;
  const inputTokens = observation.inputTokens || 0;
  const outputTokens = observation.outputTokens || 0;
  const approximateCost = (inputTokens * (config.inputCostPerMillionTokens || 0)
    + outputTokens * (config.outputCostPerMillionTokens || 0)) / 1_000_000;
  return {
    caseId: evalCase.id,
    prompt: evalCase.prompt,
    tags: evalCase.tags || [],
    arm,
    trial,
    expectedTools: expected,
    expectedNoTool,
    observedTools: observed,
    forbiddenToolCalled,
    selectionPassed,
    noToolPassed,
    argumentSchemaValid,
    assertionResults,
    expectedToolCalled: callsExpected.length > 0,
    figuresGrounded,
    finalAnswer: observation.finalAnswer,
    latencyMs: observation.latencyMs,
    inputTokens: observation.inputTokens,
    outputTokens: observation.outputTokens,
    ...(observation.inputTokens !== undefined || observation.outputTokens !== undefined ? { approximateCost } : {}),
    ...(observation.error ? { error: observation.error } : {}),
  };
};

const confusionPairs = (results: EvalTrialResult[]): ConfusionPair[] => {
  const counts = new Map<string, number>();
  results.filter(result => (
    result.arm === 'with-mcp' && result.expectedTools.length > 0 && result.observedTools !== null
  )).forEach(result => {
    const expected = result.expectedTools.join(' | ');
    const observedTools = result.observedTools!;
    const observed = observedTools.length ? observedTools.join(' + ') : '(no tool)';
    if (result.selectionPassed) return;
    const key = `${expected}\u0000${observed}`;
    counts.set(key, (counts.get(key) || 0) + 1);
  });
  return [...counts.entries()].map(([key, count]) => {
    const [expected, observed] = key.split('\u0000');
    return { expected, observed, count };
  }).sort((a, b) => b.count - a.count || a.expected.localeCompare(b.expected));
};

export const calculateMetrics = (results: EvalTrialResult[]): EvalMetrics => {
  const assertions = results.flatMap(result => result.assertionResults.map(item => item.passed));
  const costs = results.flatMap(result => result.approximateCost === undefined ? [] : [result.approximateCost]);
  return {
    selectionAccuracy: rate(results.map(result => result.selectionPassed)),
    noToolAccuracy: rate(results.map(result => result.noToolPassed)),
    argumentSchemaValidity: rate(results.map(result => result.argumentSchemaValid)),
    assertionAccuracy: assertions.length ? assertions.filter(Boolean).length / assertions.length : null,
    expectedToolCallRate: rate(results.map(result => (
      result.arm === 'with-mcp' && result.expectedTools.length > 0 ? result.expectedToolCalled : null
    ))),
    figureGroundingAccuracy: rate(results.map(result => result.figuresGrounded)),
    latencyMs: summarizeDistribution(results.flatMap(result => result.latencyMs === null ? [] : [result.latencyMs])),
    approximateTokenCost: costs.length ? costs.reduce((sum, cost) => sum + cost, 0) : null,
    inputTokens: results.reduce((sum, result) => sum + (result.inputTokens || 0), 0),
    outputTokens: results.reduce((sum, result) => sum + (result.outputTokens || 0), 0),
    confusionPairs: confusionPairs(results),
  };
};

const randomId = (): string => globalThis.crypto?.randomUUID?.() || `eval-${Date.now()}-${Math.random().toString(36).slice(2)}`;

export const runEvaluation = async (
  dataset: ToolSelectionDatasetV1,
  config: EvalRunConfig,
  provider: EvalProvider,
  onProgress?: (completed: number, total: number) => void,
  credential = ''
): Promise<EvalRunReportV1> => {
  if (provider.id !== config.provider) throw new Error('The selected provider does not match the run configuration.');
  if (!Number.isInteger(config.trials) || config.trials < 1 || config.trials > 20) throw new Error('Trials must be an integer from 1 to 20.');
  if (!config.arms.length) throw new Error('Select at least one comparison arm.');
  const tokenPrices = [
    ['Input', config.inputCostPerMillionTokens],
    ['Output', config.outputCostPerMillionTokens],
  ] as const;
  tokenPrices.forEach(([label, price]) => {
    if (price !== undefined && (!Number.isFinite(price) || price < 0)) {
      throw new Error(`${label} token price must be a finite, non-negative number.`);
    }
  });
  const datasetValidation = validateDataset(dataset);
  if (!datasetValidation.valid) throw new Error(`Invalid evaluation dataset:\n${datasetValidation.errors.join('\n')}`);
  const cases = getRunnableCases(dataset);
  if (!cases.length) throw new Error('The dataset has no manual or approved synthetic cases to run.');
  const total = cases.length * config.arms.length * config.trials;
  const results: EvalTrialResult[] = [];
  for (const evalCase of cases) {
    for (const arm of config.arms) {
      for (let trial = 1; trial <= config.trials; trial += 1) {
        try {
          const observation = redactCredential(await provider.run({
            case: evalCase,
            tools: arm === 'with-mcp' ? dataset.tools : [],
            arm,
            model: config.model,
            trial,
          }), credential);
          results.push(scoreTrial(evalCase, arm, trial, observation, dataset.tools, config));
        } catch (error) {
          results.push({
            caseId: evalCase.id,
            prompt: evalCase.prompt,
            tags: evalCase.tags || [],
            arm,
            trial,
            expectedTools: evalCase.acceptableTools || [],
            expectedNoTool: evalCase.expectedNoTool === true,
            observedTools: null,
            forbiddenToolCalled: null,
            selectionPassed: null,
            noToolPassed: null,
            argumentSchemaValid: null,
            assertionResults: [],
            expectedToolCalled: null,
            figuresGrounded: null,
            latencyMs: null,
            error: redactCredential(error instanceof Error ? error.message : String(error), credential),
          });
        }
        onProgress?.(results.length, total);
      }
    }
  }
  return redactReportCredential({
    version: TOOL_SELECTION_REPORT_VERSION,
    id: randomId(),
    createdAt: new Date().toISOString(),
    dataset: {
      id: dataset.id,
      name: dataset.name,
      version: dataset.version,
      descriptionRevision: dataset.descriptionRevision,
      schemaRevision: dataset.schemaRevision,
    },
    configuration: { ...config },
    notice: 'This is an isolated model evaluation. It does not measure or reproduce real ChatGPT, Claude, Cursor, or other MCP host behavior.',
    metrics: calculateMetrics(results),
    results,
  }, credential);
};

const comparableMetrics = [
  'selectionAccuracy', 'noToolAccuracy', 'argumentSchemaValidity', 'assertionAccuracy',
  'expectedToolCallRate', 'figureGroundingAccuracy', 'approximateTokenCost',
] as const;

export const compareRuns = (baseline: EvalRunReportV1, candidate: EvalRunReportV1): EvalRunComparison => {
  const metricDeltas: EvalRunComparison['metricDeltas'] = {};
  const regressions: string[] = [];
  comparableMetrics.forEach(metric => {
    const before = baseline.metrics[metric];
    const after = candidate.metrics[metric];
    metricDeltas[metric] = before === null || after === null ? null : after - before;
    if (metric !== 'approximateTokenCost' && metricDeltas[metric] !== null && metricDeltas[metric]! < 0) regressions.push(metric);
    if (metric === 'approximateTokenCost' && metricDeltas[metric] !== null && metricDeltas[metric]! > 0) regressions.push(metric);
  });
  const latencyMeanDeltaMs = baseline.metrics.latencyMs.mean === null || candidate.metrics.latencyMs.mean === null
    ? null
    : candidate.metrics.latencyMs.mean - baseline.metrics.latencyMs.mean;
  if (latencyMeanDeltaMs !== null && latencyMeanDeltaMs > 0) regressions.push('latencyMs.mean');
  return {
    baselineRunId: baseline.id,
    candidateRunId: candidate.id,
    descriptionRevisionChanged: baseline.dataset.descriptionRevision !== candidate.dataset.descriptionRevision,
    schemaRevisionChanged: baseline.dataset.schemaRevision !== candidate.dataset.schemaRevision,
    metricDeltas,
    latencyMeanDeltaMs,
    regressions,
  };
};

export const reportContainsCredential = (report: EvalRunReportV1, credential: string): boolean => (
  Boolean(credential) && JSON.stringify(report).includes(credential)
);

export const assertReportCredentialSafe = (report: EvalRunReportV1, credential: string): void => {
  let serialized: string;
  try {
    serialized = JSON.stringify(report);
  } catch {
    throw new Error('The evaluation report could not be safely serialized and was blocked.');
  }
  if (credential && serialized.includes(credential)) {
    throw new Error('The evaluation report contained the session credential and was blocked.');
  }
};

const isRecord = (value: unknown): value is Record<string, unknown> => (
  Boolean(value) && typeof value === 'object' && !Array.isArray(value)
);

const hasOnlyKeys = (value: Record<string, unknown>, keys: readonly string[]): boolean => {
  const allowed = new Set(keys);
  return Object.keys(value).every(key => allowed.has(key));
};

const isStringArray = (value: unknown): value is string[] => (
  Array.isArray(value) && value.every(item => typeof item === 'string')
);

const isFiniteNumber = (value: unknown): value is number => (
  typeof value === 'number' && Number.isFinite(value)
);

const isOptionalFiniteNumber = (value: unknown): boolean => (
  value === undefined || isFiniteNumber(value)
);

const isOptionalNonNegativeFiniteNumber = (value: unknown): boolean => (
  value === undefined || (isFiniteNumber(value) && value >= 0)
);

const isNullableFiniteNumber = (value: unknown): boolean => (
  value === null || isFiniteNumber(value)
);

const isNullableBoolean = (value: unknown): boolean => (
  value === null || typeof value === 'boolean'
);

const isArgumentAssertion = (value: unknown): value is ArgumentAssertion => {
  if (!isRecord(value)) return false;
  return hasOnlyKeys(value, ['tool', 'path', 'operator', 'value'])
    && (value.tool === undefined || typeof value.tool === 'string')
    && typeof value.path === 'string'
    && ['equals', 'notEquals', 'present', 'absent', 'type', 'matches', 'includes'].includes(String(value.operator));
};

const isAssertionResult = (value: unknown): boolean => {
  if (!isRecord(value)) return false;
  return hasOnlyKeys(value, ['assertion', 'passed', 'actual', 'message'])
    && isArgumentAssertion(value.assertion)
    && typeof value.passed === 'boolean'
    && (value.message === undefined || typeof value.message === 'string');
};

const isDistributionSummary = (value: unknown): boolean => {
  if (!isRecord(value)) return false;
  const keys = ['mean', 'min', 'max', 'p50', 'p95', 'spread'];
  return hasOnlyKeys(value, keys) && keys.every(key => isNullableFiniteNumber(value[key]));
};

const isEvalMetrics = (value: unknown): value is EvalMetrics => {
  if (!isRecord(value)) return false;
  if (!hasOnlyKeys(value, [
    'selectionAccuracy', 'noToolAccuracy', 'argumentSchemaValidity', 'assertionAccuracy',
    'expectedToolCallRate', 'figureGroundingAccuracy', 'latencyMs', 'approximateTokenCost',
    'inputTokens', 'outputTokens', 'confusionPairs',
  ])) return false;
  const rates = [
    value.selectionAccuracy,
    value.noToolAccuracy,
    value.argumentSchemaValidity,
    value.assertionAccuracy,
    value.expectedToolCallRate,
    value.figureGroundingAccuracy,
  ];
  return rates.every(rateValue => (
    rateValue === null || (isFiniteNumber(rateValue) && rateValue >= 0 && rateValue <= 1)
  ))
    && isDistributionSummary(value.latencyMs)
    && (value.approximateTokenCost === null || (isFiniteNumber(value.approximateTokenCost) && value.approximateTokenCost >= 0))
    && Number.isInteger(value.inputTokens) && Number(value.inputTokens) >= 0
    && Number.isInteger(value.outputTokens) && Number(value.outputTokens) >= 0
    && Array.isArray(value.confusionPairs)
    && value.confusionPairs.every(pair => (
      isRecord(pair)
      && hasOnlyKeys(pair, ['expected', 'observed', 'count'])
      && typeof pair.expected === 'string'
      && typeof pair.observed === 'string'
      && Number.isInteger(pair.count)
      && Number(pair.count) >= 1
    ));
};

const evalArms = new Set(['with-mcp', 'without-mcp', 'plain-context']);
const evalProviders = new Set(['fixture', 'openai', 'anthropic']);

const isEvalRunConfig = (value: unknown): value is EvalRunConfig => {
  if (!isRecord(value)) return false;
  return hasOnlyKeys(value, [
    'provider', 'model', 'arms', 'trials', 'inputCostPerMillionTokens', 'outputCostPerMillionTokens',
  ])
    && evalProviders.has(String(value.provider))
    && typeof value.model === 'string'
    && Array.isArray(value.arms)
    && value.arms.length > 0
    && value.arms.every(arm => evalArms.has(String(arm)))
    && Number.isInteger(value.trials)
    && Number(value.trials) >= 1
    && Number(value.trials) <= 20
    && isOptionalNonNegativeFiniteNumber(value.inputCostPerMillionTokens)
    && isOptionalNonNegativeFiniteNumber(value.outputCostPerMillionTokens);
};

const isEvalTrialResult = (value: unknown): value is EvalTrialResult => {
  if (!isRecord(value)) return false;
  return hasOnlyKeys(value, [
    'caseId', 'prompt', 'tags', 'arm', 'trial', 'expectedTools', 'expectedNoTool',
    'observedTools', 'forbiddenToolCalled', 'selectionPassed', 'noToolPassed',
    'argumentSchemaValid', 'assertionResults', 'expectedToolCalled', 'figuresGrounded',
    'finalAnswer', 'latencyMs', 'inputTokens', 'outputTokens', 'approximateCost', 'error',
  ])
    && typeof value.caseId === 'string'
    && typeof value.prompt === 'string'
    && isStringArray(value.tags)
    && evalArms.has(String(value.arm))
    && Number.isInteger(value.trial)
    && Number(value.trial) >= 1
    && isStringArray(value.expectedTools)
    && typeof value.expectedNoTool === 'boolean'
    && (value.observedTools === null || isStringArray(value.observedTools))
    && isNullableBoolean(value.forbiddenToolCalled)
    && isNullableBoolean(value.selectionPassed)
    && isNullableBoolean(value.noToolPassed)
    && isNullableBoolean(value.argumentSchemaValid)
    && Array.isArray(value.assertionResults)
    && value.assertionResults.every(isAssertionResult)
    && isNullableBoolean(value.expectedToolCalled)
    && isNullableBoolean(value.figuresGrounded)
    && (value.finalAnswer === undefined || typeof value.finalAnswer === 'string')
    && isNullableFiniteNumber(value.latencyMs)
    && isOptionalFiniteNumber(value.inputTokens)
    && isOptionalFiniteNumber(value.outputTokens)
    && isOptionalFiniteNumber(value.approximateCost)
    && (value.error === undefined || typeof value.error === 'string');
};

const isEvalRunReportV1 = (value: unknown): value is EvalRunReportV1 => {
  if (!isRecord(value) || !isRecord(value.dataset)) return false;
  return hasOnlyKeys(value, [
    'version', 'id', 'createdAt', 'dataset', 'configuration', 'notice', 'metrics', 'results',
  ])
    && hasOnlyKeys(value.dataset, [
      'id', 'name', 'version', 'descriptionRevision', 'schemaRevision',
    ])
    && value.version === TOOL_SELECTION_REPORT_VERSION
    && typeof value.id === 'string'
    && value.id.length > 0
    && typeof value.createdAt === 'string'
    && !Number.isNaN(Date.parse(value.createdAt))
    && typeof value.dataset.id === 'string'
    && typeof value.dataset.name === 'string'
    && typeof value.dataset.version === 'string'
    && typeof value.dataset.descriptionRevision === 'string'
    && typeof value.dataset.schemaRevision === 'string'
    && isEvalRunConfig(value.configuration)
    && typeof value.notice === 'string'
    && isEvalMetrics(value.metrics)
    && Array.isArray(value.results)
    && value.results.every(isEvalTrialResult);
};

export const redactReportCredential = (report: EvalRunReportV1, credential: string): EvalRunReportV1 => {
  let redacted: EvalRunReportV1;
  try {
    redacted = redactCredential(report, credential);
  } catch {
    throw new Error('The evaluation report could not be safely redacted and was blocked.');
  }
  if (!isEvalRunReportV1(redacted)) {
    throw new Error('The evaluation report failed post-redaction validation and was blocked.');
  }
  assertReportCredentialSafe(redacted, credential);
  return redacted;
};

export type { ToolCallObservation };
