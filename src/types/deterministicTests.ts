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
  | { path: string; operator: 'min-length' | 'max-length'; value: number };

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
  reproducibleCase: DeterministicTestCaseV1;
  startedAt: string;
}
