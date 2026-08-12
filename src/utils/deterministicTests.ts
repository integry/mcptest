import { CallToolResultSchema } from '@modelcontextprotocol/core';
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
import { getCapabilityInputSpec } from './capabilityParams';

type RecordValue = Record<string, unknown>;

export interface DiscoveredTool {
  name: string;
  description?: string;
  inputSchema?: RecordValue;
  input_schema?: RecordValue;
  arguments?: Array<{ name: string; [key: string]: unknown }>;
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
  'add', 'append', 'approve', 'archive', 'assign', 'ban', 'cancel', 'charge', 'commit', 'configure', 'create',
  'clear', 'deactivate', 'delete', 'deploy', 'destroy', 'disable', 'drop', 'edit', 'enable', 'erase', 'execute',
  'grant', 'import', 'insert', 'install', 'invite', 'issue', 'merge', 'modify', 'move', 'overwrite', 'patch', 'pay',
  'post', 'provision', 'publish', 'purchase', 'purge', 'remove', 'rename', 'replace', 'reset',
  'restore', 'refund', 'revoke', 'run', 'save', 'schedule',
  'send', 'set', 'start', 'stop', 'submit', 'sync', 'terminate', 'transfer', 'truncate',
  'uninstall', 'update', 'upload', 'wipe', 'write',
]);
const DESTRUCTIVE_ACTIONS = new Set([
  'archive', 'ban', 'cancel', 'clear', 'deactivate', 'delete', 'destroy', 'disable', 'drop', 'erase', 'kill',
  'overwrite', 'purge', 'remove', 'reset', 'revoke', 'terminate', 'transfer', 'truncate', 'uninstall',
  'wipe',
]);
const SENSITIVE_NAME_PATTERN = '(?:authorization|proxy[_ -]?authorization|cookie|set[_ -]?cookie|token|access[_ -]?token|refresh[_ -]?token|client[_ -]?token|api[_ -]?key|x[_ -]?api[_ -]?key|password|passwd|secret|client[_ -]?secret)';
const SENSITIVE_KEY = new RegExp(`(?:^|[_-])${SENSITIVE_NAME_PATTERN}(?:$|[_-])`, 'i');
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

const caseIdPrefix = (value: string): string => (
  [...value].map(character => character.codePointAt(0)?.toString(16)).join('-') || 'empty'
);

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

const normalizedInputSchema = (tool: DiscoveredTool): RecordValue => {
  const { definitions, required } = getCapabilityInputSpec(tool);
  return {
    type: 'object',
    properties: Object.fromEntries(definitions.map(({ name, required: _required, ...definition }) => [
      name,
      definition,
    ])),
    required,
  };
};

const happyArguments = (tool: DiscoveredTool): Record<string, unknown> => {
  const generated = schemaExample(normalizedInputSchema(tool), true);
  return isRecord(generated) ? generated : {};
};

const validationArguments = (tool: DiscoveredTool): Record<string, unknown> => {
  const args = happyArguments(tool);
  const { required } = getCapabilityInputSpec(tool);
  if (required[0]) delete args[required[0]];
  else args.__invalid_fixture_argument__ = { unexpected: true };
  return args;
};

export const inferToolSafety = (tool: DiscoveredTool): DeterministicToolPlanV1['safety'] => {
  const searchable = `${tool.name} ${tool.description || ''}`;
  const reasons: string[] = [];
  const explicitlyReadOnly = tool.annotations?.readOnlyHint === true;
  const annotatedWrite = !explicitlyReadOnly;
  const annotatedDestructive = tool.annotations?.destructiveHint === true;
  const inferredWrite = containsAction(searchable, WRITE_ACTIONS);
  const inferredDestructive = containsAction(searchable, DESTRUCTIVE_ACTIONS);
  if (tool.annotations?.readOnlyHint === false) reasons.push('Tool declares readOnlyHint=false.');
  else if (!explicitlyReadOnly) reasons.push('Tool does not explicitly declare readOnlyHint=true.');
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
  id: `tool-${caseIdPrefix(tool.name)}--${kind}`,
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
      const propertyPath = /^[A-Za-z_$][A-Za-z0-9_$]*$/.test(key)
        ? `$.structuredContent.${key}`
        : `$.structuredContent[${JSON.stringify(key)}]`;
      assertions.push({ path: propertyPath, operator: 'exists' });
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
    const trimmed = value.trim();
    if ((trimmed.startsWith('{') || trimmed.startsWith('['))) {
      try {
        const parsed: unknown = JSON.parse(value);
        if (parsed !== null && typeof parsed === 'object') {
          return JSON.stringify(redactTestData(parsed));
        }
      } catch {
        // Continue with text-oriented credential redaction for non-JSON content.
      }
    }
    return value
      .replace(new RegExp(`(\\b${SENSITIVE_NAME_PATTERN}\\b\\s*[:=]\\s*)(?:Bearer|Basic)\\s+[^\\s,;}]+`, 'gi'), '$1[REDACTED]')
      .replace(/\bBearer\s+[A-Za-z0-9._~+\/-]+=*/gi, 'Bearer [REDACTED]')
      .replace(/\bBasic\s+[A-Za-z0-9+/]+=*/gi, 'Basic [REDACTED]')
      .replace(new RegExp(`([?&#]${SENSITIVE_NAME_PATTERN}=)[^&#\\s]+`, 'gi'), '$1[REDACTED]')
      .replace(new RegExp(`("${SENSITIVE_NAME_PATTERN}"\\s*:\\s*)"(?:\\\\.|[^"\\\\])*"`, 'gi'), '$1"[REDACTED]"')
      .replace(new RegExp(`('${SENSITIVE_NAME_PATTERN}'\\s*:\\s*)'(?:\\\\.|[^'\\\\])*'`, 'gi'), "$1'[REDACTED]'")
      .replace(new RegExp(`(\\b${SENSITIVE_NAME_PATTERN}\\b\\s*[:=]\\s*)(?!\\[REDACTED\\])[^\\s,;}]+`, 'gi'), '$1[REDACTED]');
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

const errorTypeFromCode = (code: string | number | undefined): DeterministicErrorType | undefined => {
  if (code === undefined) return undefined;
  const normalized = String(code).trim().toLowerCase();
  if (/^-?\d+$/.test(normalized)) {
    const numeric = Number(normalized);
    if (numeric === 401 || numeric === 403) return 'authorization';
    if (numeric === 400 || numeric === 422 || numeric === -32602) return 'validation';
    if (numeric === 404) return 'missing-resource';
    if (numeric === 429 || (numeric >= 500 && numeric <= 599)) return 'upstream';
    if (numeric === -32001) return 'timeout';
  }

  const symbolic = normalized.replace(/[\s._-]+/g, '');
  if (['requesttimeout', 'timeout', 'etimedout'].includes(symbolic)) return 'timeout';
  if (['aborterror', 'aborted', 'cancelled', 'canceled'].includes(symbolic)) return 'cancelled';
  if ([
    'authorization', 'authentication', 'unauthorized', 'unauthorised', 'forbidden',
    'permissiondenied', 'insufficientscope', 'invalidtoken', 'expiredtoken',
  ].includes(symbolic)) return 'authorization';
  if (['notfound', 'missingresource', 'resourcenotfound'].includes(symbolic)) return 'missing-resource';
  if ([
    'badrequest', 'unprocessableentity', 'invalidparams', 'validation', 'validationerror',
  ].includes(symbolic)) return 'validation';
  if ([
    'upstream', 'badgateway', 'serviceunavailable', 'ratelimit', 'ratelimited', 'toomanyrequests',
  ].includes(symbolic)) return 'upstream';
  if (['malformed', 'parseerror', 'invalidresponse', 'unexpectedformat'].includes(symbolic)) {
    return 'malformed-response';
  }
  return undefined;
};

export const normalizeTestError = (value: unknown): NormalizedTestError => {
  const message = errorMessage(value);
  const code = findErrorCode(value);
  const searchable = message.toLowerCase();
  let type: DeterministicErrorType = errorTypeFromCode(code) || 'unknown';
  if (type === 'unknown') {
    if ((typeof DOMException !== 'undefined' && value instanceof DOMException && value.name === 'AbortError') || /\babort(?:ed)?\b|cancel(?:led|ed)/.test(searchable)) type = 'cancelled';
    else if (/requesttimeout|timed?\s*out|timeout|-32001/.test(searchable)) type = 'timeout';
    else if (/\b401\b|\b403\b|authori[sz]ation|authentication|unauthori[sz]ed|forbidden|permission|insufficient.scope|invalid.token|expired.token/.test(searchable)) type = 'authorization';
    else if (/\b404\b|not.found|missing.resource|resource.not.found/.test(searchable)) type = 'missing-resource';
    else if (/\b400\b|\b422\b|-32602|invalid.params|validation|required/.test(searchable)) type = 'validation';
    else if (/\b429\b|\b5\d\d\b|upstream|bad.gateway|service.unavailable|rate.limit/.test(searchable)) type = 'upstream';
    else if (/malformed|parse.error|invalid.response|unexpected.format/.test(searchable)) type = 'malformed-response';
  }
  const identifiers: Record<string, string> = {};
  collectIdentifiers(value, identifiers);
  return {
    type,
    ...(code !== undefined ? { code } : {}),
    message,
    retryable: type === 'timeout' || type === 'upstream',
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
    || !CallToolResultSchema.safeParse(response).success) {
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
  if (!path.startsWith('$')) return { found: false };
  const segments: Array<string | number> = [];
  let offset = 1;
  while (offset < path.length) {
    if (path[offset] === '.') {
      const start = ++offset;
      while (offset < path.length && path[offset] !== '.' && path[offset] !== '[') offset += 1;
      if (offset === start) return { found: false };
      segments.push(path.slice(start, offset));
      continue;
    }
    if (path[offset] !== '[') return { found: false };
    offset += 1;
    if (path[offset] === '"') {
      const start = offset;
      let escaped = false;
      offset += 1;
      while (offset < path.length) {
        const character = path[offset];
        if (!escaped && character === '"') break;
        escaped = !escaped && character === '\\';
        if (character !== '\\') escaped = false;
        offset += 1;
      }
      if (offset >= path.length) return { found: false };
      let key: unknown;
      try {
        key = JSON.parse(path.slice(start, offset + 1));
      } catch {
        return { found: false };
      }
      if (typeof key !== 'string') return { found: false };
      segments.push(key);
      offset += 1;
    } else {
      const start = offset;
      while (offset < path.length && /\d/.test(path[offset])) offset += 1;
      if (offset === start) return { found: false };
      segments.push(Number(path.slice(start, offset)));
    }
    if (path[offset] !== ']') return { found: false };
    offset += 1;
  }

  let current = root;
  for (const segment of segments) {
    if (typeof segment === 'number') {
      if (!Array.isArray(current) || !Object.prototype.hasOwnProperty.call(current, segment)) {
        return { found: false };
      }
      current = current[segment];
      continue;
    }
    if ((!isRecord(current) && !Array.isArray(current))
      || !Object.prototype.hasOwnProperty.call(current, segment)) {
      return { found: false };
    }
    current = (current as RecordValue)[segment];
  }
  return { found: true, value: current };
};

const valueType = (value: unknown): StructuralValueType => {
  if (value === null) return 'null';
  if (Array.isArray(value)) return 'array';
  return typeof value as StructuralValueType;
};

const jsonDeepEqual = (left: unknown, right: unknown): boolean => {
  if (left === right) return true;
  if (Array.isArray(left) || Array.isArray(right)) {
    return Array.isArray(left) && Array.isArray(right)
      && left.length === right.length
      && left.every((item, index) => jsonDeepEqual(item, right[index]));
  }
  if (!isRecord(left) || !isRecord(right)) return false;
  const leftKeys = Object.keys(left);
  const rightKeys = Object.keys(right);
  return leftKeys.length === rightKeys.length
    && leftKeys.every(key => Object.prototype.hasOwnProperty.call(right, key)
      && jsonDeepEqual(left[key], right[key]));
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
  else if (assertion.operator === 'equals') passed = actual.found && jsonDeepEqual(actual.value, assertion.value);
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
    cancellationTimer = setTimeout(() => {
      controller.abort(new DOMException('Fixture cancelled', 'AbortError'));
    }, testCase.cancelAfterMs);
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
    error = malformedResponseError(response) || responseError(response);
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
  validateDeterministicTestPlan(plan);
  const selected = new Set(options.caseIds || plan.tools.flatMap(tool => tool.cases.filter(item => item.selected).map(item => item.id)));
  const confirmed = new Set(options.confirmedUnsafeToolNames || []);
  const independentlyUnsafe = new Set(options.unsafeToolNames || []);
  const results: DeterministicCaseResult[] = [];
  for (const tool of plan.tools) {
    for (const testCase of tool.cases) {
      if (!selected.has(testCase.id)) continue;
      let result: DeterministicCaseResult;
      const executionToolName = testCase.toolName;
      const planInference = inferToolSafety({
        name: executionToolName,
        description: tool.description,
        // The plan safety snapshot already records annotation-based classification.
        // This second pass independently preserves name/description write inference.
        annotations: { readOnlyHint: true },
      });
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

export function validateDeterministicAssertions(
  assertions: unknown,
  caseId = 'fixture',
): asserts assertions is DeterministicAssertion[] {
  if (!Array.isArray(assertions)) throw new Error('Assertions must be a JSON array.');
  for (const assertion of assertions) {
    if (!isRecord(assertion) || typeof assertion.path !== 'string'
      || !['exists', 'not-exists', 'type', 'equals', 'length', 'min-length', 'max-length'].includes(String(assertion.operator))) {
      throw new Error(`Case ${caseId} contains a malformed structural assertion.`);
    }
    if (assertion.operator === 'type' && !['array', 'object', 'string', 'number', 'boolean', 'null'].includes(String(assertion.value))) {
      throw new Error(`Case ${caseId} contains an invalid type assertion.`);
    }
    if (assertion.operator === 'equals' && !Object.prototype.hasOwnProperty.call(assertion, 'value')) {
      throw new Error(`Case ${caseId} contains an equals assertion without a value.`);
    }
    if (['length', 'min-length', 'max-length'].includes(String(assertion.operator))
      && (typeof assertion.value !== 'number' || !Number.isFinite(assertion.value) || assertion.value < 0)) {
      throw new Error(`Case ${caseId} contains an invalid length assertion.`);
    }
  }
}

export function validateDeterministicTestPlan(plan: unknown): asserts plan is DeterministicTestPlanV1 {
  if (!isRecord(plan) || plan.version !== DETERMINISTIC_TEST_PLAN_VERSION) {
    throw new Error(`Unsupported test plan version. Expected ${DETERMINISTIC_TEST_PLAN_VERSION}.`);
  }
  if (typeof plan.name !== 'string' || typeof plan.serverUrl !== 'string' || typeof plan.generatedAt !== 'string' || !Array.isArray(plan.tools)) {
    throw new Error('Test plan metadata is malformed.');
  }
  const caseIds = new Set<string>();
  const validKinds: DeterministicCaseKind[] = ['happy-path', 'validation', 'empty-result', 'upstream-error', 'timeout', 'output-shape', 'cancellation'];
  const validErrors: DeterministicErrorType[] = ['authorization', 'validation', 'missing-resource', 'upstream', 'timeout', 'cancelled', 'malformed-response', 'unknown'];
  for (const tool of plan.tools) {
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
      validateDeterministicAssertions(testCase.assertions, testCase.id);
    }
  }
}

export const parseDeterministicTestPlan = (text: string): DeterministicTestPlanV1 => {
  const parsed: unknown = JSON.parse(text);
  validateDeterministicTestPlan(parsed);
  return parsed;
};

export const serializeDeterministicTestPlan = (plan: DeterministicTestPlanV1): string => {
  validateDeterministicTestPlan(plan);
  return `${JSON.stringify(plan, null, 2)}\n`;
};
