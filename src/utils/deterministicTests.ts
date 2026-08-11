import type {
  AssertionEvidence,
  DeterministicAssertion,
  DeterministicCaseKind,
  DeterministicCaseResult,
  DeterministicErrorType,
  DeterministicTestCaseV1,
  DeterministicTestPlanV1,
  DeterministicToolPlanV1,
  NormalizedTestError,
  StructuralValueType,
} from '../types/deterministicTests';
import { DETERMINISTIC_TEST_PLAN_VERSION } from '../types/deterministicTests';

type RecordValue = Record<string, unknown>;

export interface DiscoveredTool {
  name: string;
  description?: string;
  inputSchema?: RecordValue;
  outputSchema?: RecordValue;
  annotations?: {
    readOnlyHint?: boolean;
    destructiveHint?: boolean;
  };
}

export interface DeterministicToolClient {
  callTool(
    request: { name: string; arguments: Record<string, unknown> },
    options?: { signal?: AbortSignal; timeout?: number; maxTotalTimeout?: number }
  ): Promise<unknown>;
}

const WRITE_ACTIONS = new Set([
  'add', 'archive', 'cancel', 'create', 'delete', 'disable', 'edit', 'install', 'invite', 'move',
  'publish', 'remove', 'rename', 'reset', 'revoke', 'run', 'send', 'set', 'submit', 'terminate',
  'transfer', 'truncate', 'uninstall', 'update', 'upload', 'wipe', 'write',
]);
const DESTRUCTIVE_ACTIONS = new Set([
  'archive', 'cancel', 'delete', 'disable', 'remove', 'reset', 'revoke', 'terminate', 'transfer',
  'truncate', 'uninstall', 'wipe',
]);
const SENSITIVE_KEY = /(?:^|[_-])(?:authorization|proxy[_-]?authorization|cookie|set[_-]?cookie|token|access[_-]?token|refresh[_-]?token|api[_-]?key|x[_-]?api[_-]?key|password|passwd|secret|client[_-]?secret)(?:$|[_-])/i;
const IDENTIFIER_KEY = /^(?:request[_-]?id|trace[_-]?id|correlation[_-]?id|error[_-]?id|incident[_-]?id|resource[_-]?id|operation[_-]?id|job[_-]?id)$/i;
const ERROR_CODE_KEYS = ['code', 'errorCode', 'error_code', 'status', 'statusCode'];

const isRecord = (value: unknown): value is RecordValue => (
  typeof value === 'object' && value !== null && !Array.isArray(value)
);

const actionForms = (action: string): string[] => {
  const forms = [action, `${action}s`];
  if (action.endsWith('e')) forms.push(`${action}d`, `${action.slice(0, -1)}ing`);
  else forms.push(`${action}ed`, `${action}ing`);
  const last = action[action.length - 1];
  if (last) forms.push(`${action}${last}ed`, `${action}${last}ing`);
  if (action === 'send') forms.push('sent');
  if (action === 'write') forms.push('wrote', 'written');
  if (action === 'run') forms.push('ran');
  return forms;
};

const containsAction = (text: string, actions: Set<string>): boolean => {
  const matches = text
    .replace(/([a-z0-9])([A-Z])/g, '$1 $2')
    .toLowerCase()
    .match(/[a-z0-9]+/g);
  const tokens: string[] = matches ? Array.from(matches) : [];
  return [...actions].some(action => actionForms(action).some(form => tokens.includes(form)));
};

const slug = (value: string): string => value
  .toLowerCase()
  .replace(/[^a-z0-9]+/g, '-')
  .replace(/^-+|-+$/g, '') || 'tool';

const schemaExample = (schema: unknown, requiredOnly = false): unknown => {
  if (!isRecord(schema)) return undefined;
  if (schema.default !== undefined) return schema.default;
  if (schema.const !== undefined) return schema.const;
  if (Array.isArray(schema.enum) && schema.enum.length > 0) return schema.enum[0];

  const type = schema.type;
  if (type === 'object' || isRecord(schema.properties)) {
    const result: RecordValue = {};
    const required = new Set(Array.isArray(schema.required) ? schema.required.filter(v => typeof v === 'string') : []);
    if (isRecord(schema.properties)) {
      for (const [key, child] of Object.entries(schema.properties)) {
        if (requiredOnly && !required.has(key)) continue;
        const example = schemaExample(child, requiredOnly);
        if (example !== undefined) result[key] = example;
      }
    }
    return result;
  }
  if (type === 'array') {
    const item = schemaExample(schema.items, requiredOnly);
    return item === undefined ? [] : [item];
  }
  if (type === 'boolean') return false;
  if (type === 'integer' || type === 'number') return typeof schema.minimum === 'number' ? schema.minimum : 0;
  if (type === 'null') return null;
  if (type === 'string' || type === undefined) {
    if (schema.format === 'email') return 'fixture@example.com';
    if (schema.format === 'uri' || schema.format === 'url') return 'https://example.com/fixture';
    return typeof schema.minLength === 'number' && schema.minLength > 1
      ? 'fixture'.padEnd(schema.minLength, 'x')
      : 'fixture';
  }
  return undefined;
};

const happyArguments = (tool: DiscoveredTool): Record<string, unknown> => {
  const generated = schemaExample(tool.inputSchema || { type: 'object' }, true);
  return isRecord(generated) ? generated : {};
};

const validationArguments = (tool: DiscoveredTool): Record<string, unknown> => {
  const args = happyArguments(tool);
  const required = Array.isArray(tool.inputSchema?.required)
    ? tool.inputSchema.required.filter((value): value is string => typeof value === 'string')
    : [];
  if (required[0]) delete args[required[0]];
  else args.__invalid_fixture_argument__ = { unexpected: true };
  return args;
};

export const inferToolSafety = (tool: DiscoveredTool): DeterministicToolPlanV1['safety'] => {
  const searchable = `${tool.name} ${tool.description || ''}`;
  const reasons: string[] = [];
  const annotatedWrite = tool.annotations?.readOnlyHint === false;
  const annotatedDestructive = tool.annotations?.destructiveHint === true;
  const inferredWrite = containsAction(searchable, WRITE_ACTIONS);
  const inferredDestructive = containsAction(searchable, DESTRUCTIVE_ACTIONS);
  if (annotatedWrite) reasons.push('Tool declares readOnlyHint=false.');
  if (annotatedDestructive) reasons.push('Tool declares destructiveHint=true.');
  if (inferredDestructive) reasons.push('Name or description contains a destructive action.');
  else if (inferredWrite) reasons.push('Name or description contains a write action.');
  return {
    writeCapable: annotatedWrite || annotatedDestructive || inferredWrite || inferredDestructive,
    destructive: annotatedDestructive || inferredDestructive,
    reasons,
  };
};

const defaultCase = (
  tool: DiscoveredTool,
  kind: DeterministicCaseKind,
  args: Record<string, unknown>,
  assertions: DeterministicAssertion[],
  expectedError?: DeterministicErrorType
): DeterministicTestCaseV1 => ({
  id: `${slug(tool.name)}--${kind}`,
  toolName: tool.name,
  name: kind.split('-').map(part => part[0].toUpperCase() + part.slice(1)).join(' '),
  kind,
  selected: kind === 'happy-path' || kind === 'output-shape',
  arguments: args,
  assertions,
  ...(expectedError ? { expectedError } : {}),
  timeoutMs: kind === 'timeout' ? 250 : 30_000,
  ...(kind === 'cancellation' ? { cancelAfterMs: 100 } : {}),
});

const outputSchemaAssertions = (tool: DiscoveredTool): DeterministicAssertion[] => {
  const schema = tool.outputSchema;
  if (!isRecord(schema)) return [
    { path: '$', operator: 'type', value: 'object' },
    { path: '$.content', operator: 'type', value: 'array' },
  ];
  const assertions: DeterministicAssertion[] = [
    { path: '$', operator: 'type', value: 'object' },
    { path: '$.content', operator: 'type', value: 'array' },
    { path: '$.structuredContent', operator: 'exists' },
  ];
  if (['object', 'array', 'string', 'number', 'boolean', 'null'].includes(String(schema.type))) {
    assertions.push({
      path: '$.structuredContent',
      operator: 'type',
      value: schema.type as StructuralValueType,
    });
  }
  if (schema.type === 'object' && Array.isArray(schema.required)) {
    for (const key of schema.required.filter((value): value is string => typeof value === 'string')) {
      assertions.push({ path: `$.structuredContent.${key}`, operator: 'exists' });
    }
  }
  return assertions;
};

export const generateDeterministicTestPlan = (
  tools: readonly DiscoveredTool[],
  serverUrl: string,
  generatedAt = new Date().toISOString()
): DeterministicTestPlanV1 => ({
  version: DETERMINISTIC_TEST_PLAN_VERSION,
  name: `Deterministic tests for ${serverUrl || 'MCP server'}`,
  serverUrl,
  generatedAt,
  tools: tools.map(tool => {
    const args = happyArguments(tool);
    return {
      toolName: tool.name,
      ...(tool.description ? { description: tool.description } : {}),
      safety: inferToolSafety(tool),
      cases: [
        defaultCase(tool, 'happy-path', args, [{ path: '$.content', operator: 'type', value: 'array' }]),
        defaultCase(tool, 'validation', validationArguments(tool), [], 'validation'),
        defaultCase(tool, 'empty-result', args, [{ path: '$.content', operator: 'length', value: 0 }]),
        defaultCase(tool, 'upstream-error', args, [], 'upstream'),
        defaultCase(tool, 'timeout', args, [], 'timeout'),
        defaultCase(tool, 'output-shape', args, outputSchemaAssertions(tool)),
        defaultCase(tool, 'cancellation', args, [], 'cancelled'),
      ],
    };
  }),
});

export const redactTestData = (value: unknown, seen = new WeakSet<object>()): unknown => {
  if (typeof value === 'string') {
    return value
      .replace(/\bBearer\s+[A-Za-z0-9._~+\/-]+=*/gi, 'Bearer [REDACTED]')
      .replace(/([?&](?:token|api[_-]?key|secret|password)=)[^&#\s]+/gi, '$1[REDACTED]');
  }
  if (value === null || typeof value !== 'object') return value;
  if (seen.has(value)) return '[Circular]';
  seen.add(value);
  if (Array.isArray(value)) return value.map(item => redactTestData(item, seen));
  return Object.fromEntries(Object.entries(value as RecordValue).map(([key, item]) => [
    key,
    SENSITIVE_KEY.test(key.replace(/([a-z0-9])([A-Z])/g, '$1_$2')) ? '[REDACTED]' : redactTestData(item, seen),
  ]));
};

const collectIdentifiers = (value: unknown, output: Record<string, string>, depth = 0): void => {
  if (depth > 5 || !value || typeof value !== 'object') return;
  for (const [key, item] of Object.entries(value as RecordValue)) {
    if (IDENTIFIER_KEY.test(key) && (typeof item === 'string' || typeof item === 'number')) {
      output[key] = String(item);
    } else collectIdentifiers(item, output, depth + 1);
  }
};

const findErrorCode = (value: unknown): string | number | undefined => {
  if (!isRecord(value)) return undefined;
  for (const key of ERROR_CODE_KEYS) {
    if (typeof value[key] === 'string' || typeof value[key] === 'number') return value[key] as string | number;
  }
  if (isRecord(value.error)) return findErrorCode(value.error);
  if (isRecord(value.data)) return findErrorCode(value.data);
  return undefined;
};

const errorMessage = (value: unknown): string => {
  if (value instanceof Error) return value.message;
  if (isRecord(value)) {
    if (typeof value.message === 'string') return value.message;
    if (isRecord(value.error) && typeof value.error.message === 'string') return value.error.message;
  }
  return typeof value === 'string' ? value : 'Unknown tool error';
};

export const normalizeTestError = (value: unknown): NormalizedTestError => {
  const message = errorMessage(value);
  const code = findErrorCode(value);
  const searchable = `${String(code ?? '')} ${message}`.toLowerCase();
  let type: DeterministicErrorType = 'unknown';
  if ((typeof DOMException !== 'undefined' && value instanceof DOMException && value.name === 'AbortError') || /\babort(?:ed)?\b|cancel(?:led|ed)/.test(searchable)) type = 'cancelled';
  else if (/requesttimeout|timed?\s*out|timeout|-32001/.test(searchable)) type = 'timeout';
  else if (/\b401\b|\b403\b|authori[sz]ation|authentication|unauthori[sz]ed|forbidden|permission|insufficient.scope|invalid.token|expired.token/.test(searchable)) type = 'authorization';
  else if (/\b404\b|not.found|missing.resource|resource.not.found/.test(searchable)) type = 'missing-resource';
  else if (/\b400\b|\b422\b|-32602|invalid.params|validation|required/.test(searchable)) type = 'validation';
  else if (/\b429\b|\b5\d\d\b|upstream|bad.gateway|service.unavailable|rate.limit/.test(searchable)) type = 'upstream';
  else if (/malformed|parse.error|invalid.response|unexpected.format/.test(searchable)) type = 'malformed-response';
  const identifiers: Record<string, string> = {};
  collectIdentifiers(value, identifiers);
  return {
    type,
    ...(code !== undefined ? { code } : {}),
    message,
    retryable: type === 'timeout' || type === 'upstream' || /\b429\b/.test(searchable),
    identifiers,
  };
};

const responseError = (response: unknown): NormalizedTestError | undefined => {
  if (!isRecord(response) || response.isError !== true) return undefined;
  let detail: unknown = response;
  if (response.structuredContent !== undefined) detail = response.structuredContent;
  else if (Array.isArray(response.content)) {
    const text = response.content
      .filter(isRecord)
      .map(item => typeof item.text === 'string' ? item.text : '')
      .filter(Boolean)
      .join('\n');
    if (text) {
      try { detail = JSON.parse(text); } catch { detail = { message: text }; }
    }
  }
  return normalizeTestError(detail);
};

const malformedResponseError = (response: unknown): NormalizedTestError | undefined => {
  if (!isRecord(response) || !Array.isArray(response.content)
    || response.content.some(item => !isRecord(item) || typeof item.type !== 'string' || !item.type)) {
    return {
      type: 'malformed-response',
      code: 'INVALID_TOOL_RESULT',
      message: 'Tool response must be an object with a content array.',
      retryable: false,
      identifiers: {},
    };
  }
  return undefined;
};

const getPath = (root: unknown, path: string): { found: boolean; value?: unknown } => {
  if (path === '$' || path === '') return { found: true, value: root };
  if (!path.startsWith('$.')) return { found: false };
  let current = root;
  for (const segment of path.slice(2).split('.')) {
    const match = /^(.*?)(?:\[(\d+)\])?$/.exec(segment);
    if (!match || !isRecord(current) && !Array.isArray(current)) return { found: false };
    const key = match[1];
    if (key && !(key in (current as RecordValue))) return { found: false };
    current = key ? (current as RecordValue)[key] : current;
    if (match[2] !== undefined) {
      const index = Number(match[2]);
      if (!Array.isArray(current) || index >= current.length) return { found: false };
      current = current[index];
    }
  }
  return { found: true, value: current };
};

const valueType = (value: unknown): StructuralValueType => {
  if (value === null) return 'null';
  if (Array.isArray(value)) return 'array';
  return typeof value as StructuralValueType;
};

export const evaluateAssertions = (
  response: unknown,
  assertions: readonly DeterministicAssertion[]
): AssertionEvidence[] => assertions.map(assertion => {
  const actual = getPath(response, assertion.path);
  let passed = false;
  if (assertion.operator === 'exists') passed = actual.found;
  else if (assertion.operator === 'not-exists') passed = !actual.found;
  else if (assertion.operator === 'type') passed = actual.found && valueType(actual.value) === assertion.value;
  else if (assertion.operator === 'equals') passed = actual.found && JSON.stringify(actual.value) === JSON.stringify(assertion.value);
  else {
    const length = typeof actual.value === 'string' || Array.isArray(actual.value)
      ? actual.value.length
      : isRecord(actual.value) ? Object.keys(actual.value).length : undefined;
    if (assertion.operator === 'length') passed = length === assertion.value;
    if (assertion.operator === 'min-length') passed = length !== undefined && length >= assertion.value;
    if (assertion.operator === 'max-length') passed = length !== undefined && length <= assertion.value;
  }
  return {
    assertion,
    passed,
    ...(actual.found ? { actual: redactTestData(actual.value) } : {}),
    message: passed
      ? `${assertion.path} satisfied ${assertion.operator}.`
      : `${assertion.path} did not satisfy ${assertion.operator}.`,
  };
});

export const runDeterministicCase = async (
  client: DeterministicToolClient,
  testCase: DeterministicTestCaseV1,
  externalSignal?: AbortSignal
): Promise<DeterministicCaseResult> => {
  const started = Date.now();
  const startedAt = new Date(started).toISOString();
  const controller = new AbortController();
  const relayAbort = () => controller.abort(externalSignal?.reason);
  externalSignal?.addEventListener('abort', relayAbort, { once: true });
  if (externalSignal?.aborted) relayAbort();
  let cancellationTimer: ReturnType<typeof setTimeout> | undefined;
  if (testCase.cancelAfterMs !== undefined) {
    cancellationTimer = setTimeout(() => controller.abort('Fixture cancellation'), testCase.cancelAfterMs);
  }
  const request = { name: testCase.toolName, arguments: testCase.arguments };
  let response: unknown;
  let error: NormalizedTestError | undefined;
  let assertionEvidence: AssertionEvidence[] = [];
  try {
    response = await client.callTool(request, {
      signal: controller.signal,
      timeout: testCase.timeoutMs,
      maxTotalTimeout: testCase.timeoutMs,
    });
    error = responseError(response) || malformedResponseError(response);
    assertionEvidence = error ? [] : evaluateAssertions(response, testCase.assertions);
  } catch (cause) {
    error = normalizeTestError(cause);
  } finally {
    if (cancellationTimer) clearTimeout(cancellationTimer);
    externalSignal?.removeEventListener('abort', relayAbort);
  }
  const expectedErrorMatched = testCase.expectedError !== undefined && error?.type === testCase.expectedError;
  const passed = testCase.expectedError
    ? expectedErrorMatched
    : !error && assertionEvidence.every(assertion => assertion.passed);
  const externallyCancelled = externalSignal?.aborted && error?.type === 'cancelled';
  return {
    caseId: testCase.id,
    toolName: testCase.toolName,
    caseName: testCase.name,
    status: externallyCancelled ? 'cancelled' : passed ? 'passed' : 'failed',
    durationMs: Date.now() - started,
    request: redactTestData(request),
    ...(response !== undefined ? { response: redactTestData(response) } : {}),
    ...(error ? { error: { ...error, message: String(redactTestData(error.message)) } } : {}),
    assertions: assertionEvidence,
    reproducibleCase: redactTestData(testCase) as DeterministicTestCaseV1,
    startedAt,
  };
};

export const runDeterministicPlan = async (
  client: DeterministicToolClient,
  plan: DeterministicTestPlanV1,
  options: {
    caseIds?: readonly string[];
    confirmedUnsafeToolNames?: readonly string[];
    unsafeToolNames?: readonly string[];
    signal?: AbortSignal;
    onResult?: (result: DeterministicCaseResult) => void;
  } = {}
): Promise<DeterministicCaseResult[]> => {
  const selected = new Set(options.caseIds || plan.tools.flatMap(tool => tool.cases.filter(item => item.selected).map(item => item.id)));
  const confirmed = new Set(options.confirmedUnsafeToolNames || []);
  const independentlyUnsafe = new Set(options.unsafeToolNames || []);
  const results: DeterministicCaseResult[] = [];
  for (const tool of plan.tools) {
    for (const testCase of tool.cases) {
      if (!selected.has(testCase.id)) continue;
      let result: DeterministicCaseResult;
      const executionToolName = testCase.toolName;
      const planInference = inferToolSafety({ name: executionToolName, description: tool.description });
      const unsafe = tool.safety.writeCapable || tool.safety.destructive
        || planInference.writeCapable || planInference.destructive
        || independentlyUnsafe.has(tool.toolName) || independentlyUnsafe.has(executionToolName);
      if (unsafe && !confirmed.has(executionToolName)) {
        result = {
          caseId: testCase.id,
          toolName: tool.toolName,
          caseName: testCase.name,
          status: 'blocked',
          durationMs: 0,
          request: redactTestData({ name: tool.toolName, arguments: testCase.arguments }),
          error: {
            type: 'authorization',
            code: 'EXPLICIT_CONFIRMATION_REQUIRED',
            message: 'This tool may write or destroy data and requires explicit confirmation before it can run.',
            retryable: false,
            identifiers: {},
          },
          assertions: [],
          reproducibleCase: redactTestData(testCase) as DeterministicTestCaseV1,
          startedAt: new Date().toISOString(),
        };
      } else if (options.signal?.aborted) {
        break;
      } else {
        result = await runDeterministicCase(client, testCase, options.signal);
      }
      results.push(result);
      options.onResult?.(result);
      if (options.signal?.aborted) break;
    }
    if (options.signal?.aborted) break;
  }
  return results;
};

export const parseDeterministicTestPlan = (text: string): DeterministicTestPlanV1 => {
  const parsed: unknown = JSON.parse(text);
  if (!isRecord(parsed) || parsed.version !== DETERMINISTIC_TEST_PLAN_VERSION) {
    throw new Error(`Unsupported test plan version. Expected ${DETERMINISTIC_TEST_PLAN_VERSION}.`);
  }
  if (typeof parsed.name !== 'string' || typeof parsed.serverUrl !== 'string' || typeof parsed.generatedAt !== 'string' || !Array.isArray(parsed.tools)) {
    throw new Error('Test plan metadata is malformed.');
  }
  const caseIds = new Set<string>();
  const validKinds: DeterministicCaseKind[] = ['happy-path', 'validation', 'empty-result', 'upstream-error', 'timeout', 'output-shape', 'cancellation'];
  const validErrors: DeterministicErrorType[] = ['authorization', 'validation', 'missing-resource', 'upstream', 'timeout', 'cancelled', 'malformed-response', 'unknown'];
  for (const tool of parsed.tools) {
    if (!isRecord(tool) || typeof tool.toolName !== 'string' || !isRecord(tool.safety) || !Array.isArray(tool.cases)
      || typeof tool.safety.writeCapable !== 'boolean' || typeof tool.safety.destructive !== 'boolean'
      || !Array.isArray(tool.safety.reasons) || !tool.safety.reasons.every(reason => typeof reason === 'string')) {
      throw new Error('Test plan contains a malformed tool entry.');
    }
    for (const testCase of tool.cases) {
      if (!isRecord(testCase) || typeof testCase.id !== 'string' || typeof testCase.toolName !== 'string'
        || typeof testCase.name !== 'string' || typeof testCase.kind !== 'string' || !validKinds.includes(testCase.kind as DeterministicCaseKind)
        || typeof testCase.selected !== 'boolean'
        || !isRecord(testCase.arguments) || !Array.isArray(testCase.assertions)
        || typeof testCase.timeoutMs !== 'number' || !Number.isFinite(testCase.timeoutMs) || testCase.timeoutMs <= 0
        || (testCase.cancelAfterMs !== undefined && (typeof testCase.cancelAfterMs !== 'number' || !Number.isFinite(testCase.cancelAfterMs) || testCase.cancelAfterMs < 0))
        || (testCase.expectedError !== undefined && !validErrors.includes(testCase.expectedError as DeterministicErrorType))) {
        throw new Error(`Test plan contains a malformed case for ${tool.toolName}.`);
      }
      if (caseIds.has(testCase.id)) throw new Error(`Test plan contains duplicate case id ${testCase.id}.`);
      caseIds.add(testCase.id);
      if (testCase.toolName !== tool.toolName) {
        throw new Error(`Case ${testCase.id} must target its containing tool ${tool.toolName}.`);
      }
      for (const assertion of testCase.assertions) {
        if (!isRecord(assertion) || typeof assertion.path !== 'string'
          || !['exists', 'not-exists', 'type', 'equals', 'length', 'min-length', 'max-length'].includes(String(assertion.operator))) {
          throw new Error(`Case ${testCase.id} contains a malformed structural assertion.`);
        }
        if (assertion.operator === 'type' && !['array', 'object', 'string', 'number', 'boolean', 'null'].includes(String(assertion.value))) {
          throw new Error(`Case ${testCase.id} contains an invalid type assertion.`);
        }
        if (['length', 'min-length', 'max-length'].includes(String(assertion.operator))
          && (typeof assertion.value !== 'number' || !Number.isFinite(assertion.value) || assertion.value < 0)) {
          throw new Error(`Case ${testCase.id} contains an invalid length assertion.`);
        }
      }
    }
  }
  return parsed as unknown as DeterministicTestPlanV1;
};

export const serializeDeterministicTestPlan = (plan: DeterministicTestPlanV1): string => (
  `${JSON.stringify(plan, null, 2)}\n`
);
