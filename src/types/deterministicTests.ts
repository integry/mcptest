import type { OutputContractResult, OutputContractViolation } from '../utils/outputContract';

export const DETERMINISTIC_TEST_PLAN_VERSION = '1.0.0' as const;

export type DeterministicCaseKind =
  | 'happy-path'
  | 'validation'
  | 'empty-result'
  | 'upstream-error'
  | 'timeout'
  | 'output-shape'
  | 'cancellation';

export type DeterministicErrorType =
  | 'authorization'
  | 'validation'
  | 'missing-resource'
  | 'upstream'
  | 'timeout'
  | 'cancelled'
  | 'malformed-response'
  | 'unknown';

export type StructuralValueType =
  | 'array'
  | 'object'
  | 'string'
  | 'number'
  | 'boolean'
  | 'null';

export type DeterministicAssertion =
  | { path: string; operator: 'exists' | 'not-exists' }
  | { path: string; operator: 'type'; value: StructuralValueType }
  | { path: string; operator: 'equals'; value: unknown }
  | { path: string; operator: 'length'; value: number }
  | { path: string; operator: 'min-length' | 'max-length'; value: number }
  /** Validates the value at `path` (normally `$.structuredContent`) against the tool's declared outputSchema. */
  | { path: string; operator: 'matches-output-schema' };

export interface DeterministicTestCaseV1 {
  id: string;
  toolName: string;
  name: string;
  kind: DeterministicCaseKind;
  selected: boolean;
  arguments: Record<string, unknown>;
  assertions: DeterministicAssertion[];
  expectedError?: DeterministicErrorType;
  timeoutMs: number;
  cancelAfterMs?: number;
}

export interface DeterministicToolPlanV1 {
  toolName: string;
  description?: string;
  safety: {
    writeCapable: boolean;
    destructive: boolean;
    reasons: string[];
  };
  /** The outputSchema declared when the plan was generated; live definitions take precedence. */
  outputSchema?: Record<string, unknown>;
  cases: DeterministicTestCaseV1[];
}

export interface DeterministicTestPlanV1 {
  version: typeof DETERMINISTIC_TEST_PLAN_VERSION;
  name: string;
  serverUrl: string;
  generatedAt: string;
  tools: DeterministicToolPlanV1[];
}

export interface NormalizedTestError {
  type: DeterministicErrorType;
  code?: string | number;
  message: string;
  retryable: boolean;
  identifiers: Record<string, string>;
}

export interface AssertionEvidence {
  assertion: DeterministicAssertion;
  passed: boolean;
  actual?: unknown;
  message: string;
  /** Schema violations for `matches-output-schema` assertions. */
  violations?: OutputContractViolation[];
}

export interface DeterministicCaseResult {
  caseId: string;
  toolName: string;
  caseName: string;
  status: 'passed' | 'failed' | 'cancelled' | 'blocked';
  durationMs: number;
  request: unknown;
  response?: unknown;
  error?: NormalizedTestError;
  assertions: AssertionEvidence[];
  redactedReproducibleCase: DeterministicTestCaseV1;
  reproducibleCase: DeterministicTestCaseV1;
  startedAt: string;
  /** Output-contract verdict when the tool's outputSchema was known for this run. */
  outputContract?: OutputContractResult;
}
