export const TOOL_SELECTION_DATASET_VERSION = '1.0' as const;
export const TOOL_SELECTION_REPORT_VERSION = '1.0' as const;

export type JsonSchema = Record<string, unknown>;

export interface EvalTool {
  name: string;
  description?: string;
  inputSchema: JsonSchema;
}

export type ArgumentAssertionOperator =
  | 'equals'
  | 'notEquals'
  | 'present'
  | 'absent'
  | 'type'
  | 'matches'
  | 'includes';

export interface ArgumentAssertion {
  tool?: string;
  path: string;
  operator: ArgumentAssertionOperator;
  value?: unknown;
}

export interface EvalFixtureOutput {
  toolCalls?: Array<{
    name: string;
    arguments: unknown;
    result?: unknown;
  }>;
  finalAnswer?: string;
  inputTokens?: number;
  outputTokens?: number;
  latencyMs?: number;
}

export interface ToolSelectionCase {
  id: string;
  prompt: string;
  acceptableTools?: string[];
  forbiddenTools?: string[];
  expectedNoTool?: boolean;
  argumentAssertions?: ArgumentAssertion[];
  tags?: string[];
  notes?: string;
  toolReturnedData?: unknown;
  expectedFigures?: Array<string | number>;
  fixture?: EvalFixtureOutput | EvalFixtureOutput[];
}

export interface SyntheticSuggestion extends ToolSelectionCase {
  synthetic: true;
  reviewStatus: 'unreviewed' | 'approved' | 'rejected';
}

export interface ToolSelectionDatasetV1 {
  version: typeof TOOL_SELECTION_DATASET_VERSION;
  id: string;
  name: string;
  descriptionRevision: string;
  schemaRevision: string;
  description?: string;
  tools: EvalTool[];
  cases: ToolSelectionCase[];
  suggestions?: SyntheticSuggestion[];
}

export type EvalArm = 'with-mcp' | 'without-mcp' | 'plain-context';
export type EvalProviderId = 'fixture' | 'openai' | 'anthropic';

export interface ToolCallObservation {
  name: string;
  arguments: unknown;
  result?: unknown;
}

export interface ProviderObservation {
  toolCalls: ToolCallObservation[];
  finalAnswer?: string;
  latencyMs: number;
  inputTokens?: number;
  outputTokens?: number;
  error?: string;
}

export interface EvalProviderRequest {
  case: ToolSelectionCase;
  tools: EvalTool[];
  arm: EvalArm;
  model: string;
  trial: number;
}

export interface EvalProvider {
  id: EvalProviderId;
  run(request: EvalProviderRequest): Promise<ProviderObservation>;
}

export interface EvalRunConfig {
  provider: EvalProviderId;
  model: string;
  arms: EvalArm[];
  trials: number;
  inputCostPerMillionTokens?: number;
  outputCostPerMillionTokens?: number;
}

export interface AssertionResult {
  assertion: ArgumentAssertion;
  passed: boolean;
  actual?: unknown;
  message?: string;
}

export interface EvalTrialResult {
  caseId: string;
  prompt: string;
  tags: string[];
  arm: EvalArm;
  trial: number;
  expectedTools: string[];
  expectedNoTool: boolean;
  observedTools: string[] | null;
  forbiddenToolCalled: boolean | null;
  selectionPassed: boolean | null;
  noToolPassed: boolean | null;
  argumentSchemaValid: boolean | null;
  assertionResults: AssertionResult[];
  expectedToolCalled: boolean | null;
  figuresGrounded: boolean | null;
  finalAnswer?: string;
  latencyMs: number | null;
  inputTokens?: number;
  outputTokens?: number;
  approximateCost?: number;
  error?: string;
}

export interface DistributionSummary {
  mean: number | null;
  min: number | null;
  max: number | null;
  p50: number | null;
  p95: number | null;
  spread: number | null;
}

export interface ConfusionPair {
  expected: string;
  observed: string;
  count: number;
}

export interface EvalMetrics {
  selectionAccuracy: number | null;
  noToolAccuracy: number | null;
  argumentSchemaValidity: number | null;
  assertionAccuracy: number | null;
  expectedToolCallRate: number | null;
  figureGroundingAccuracy: number | null;
  latencyMs: DistributionSummary;
  approximateTokenCost: number | null;
  inputTokens: number;
  outputTokens: number;
  confusionPairs: ConfusionPair[];
}

export interface EvalRunReportV1 {
  version: typeof TOOL_SELECTION_REPORT_VERSION;
  id: string;
  createdAt: string;
  dataset: {
    id: string;
    name: string;
    version: string;
    descriptionRevision: string;
    schemaRevision: string;
  };
  configuration: EvalRunConfig;
  notice: string;
  metrics: EvalMetrics;
  results: EvalTrialResult[];
}

export interface EvalRunComparison {
  baselineRunId: string;
  candidateRunId: string;
  descriptionRevisionChanged: boolean;
  schemaRevisionChanged: boolean;
  metricDeltas: Partial<Record<keyof Pick<
    EvalMetrics,
    'selectionAccuracy' | 'noToolAccuracy' | 'argumentSchemaValidity' |
    'assertionAccuracy' | 'expectedToolCallRate' | 'figureGroundingAccuracy' |
    'approximateTokenCost'
  >, number | null>>;
  latencyMeanDeltaMs: number | null;
  regressions: string[];
}
