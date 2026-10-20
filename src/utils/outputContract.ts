import { Validator, type OutputUnit, type SchemaDraft } from '@cfworker/json-schema';

/**
 * Output-contract checks for MCP `tools/call` results.
 *
 * Validation uses @cfworker/json-schema, which interprets schemas directly
 * instead of generating code. The page CSP has no 'unsafe-eval', so
 * code-generating validators such as Ajv cannot run in the browser.
 */

export const OUTPUT_CONTRACT_FINDING_ID = 'tool.output-contract-violation';

/** Root label used for violation paths, so users see where in the result the problem is. */
const ROOT_PATH = 'structuredContent';
const MAX_RECORDED_VIOLATIONS = 50;

export interface OutputContractViolation {
  /** Location inside the result, for example `structuredContent.items[0].name`. */
  path: string;
  message: string;
}

/**
 * - `pass`: structuredContent validates against the declared outputSchema.
 * - `fail`: the declared contract was broken (invalid or missing structuredContent).
 * - `no-schema`: the tool declares no outputSchema, so there is no verdict.
 * - `not-checked`: the tool reported `isError`, which exempts the result from the contract.
 */
export type OutputContractStatus = 'pass' | 'fail' | 'no-schema' | 'not-checked';

export interface OutputContractResult {
  toolName: string;
  status: OutputContractStatus;
  violations: OutputContractViolation[];
  hasStructuredContent: boolean;
  isError: boolean;
}

export interface SchemaValidationOutcome {
  valid: boolean;
  violations: OutputContractViolation[];
}

const isRecord = (value: unknown): value is Record<string, unknown> => (
  typeof value === 'object' && value !== null && !Array.isArray(value)
);

const draftForSchema = (schema: unknown): SchemaDraft => {
  const declared = isRecord(schema) && typeof schema.$schema === 'string' ? schema.$schema : '';
  if (/draft-04/.test(declared)) return '4';
  if (/draft-0[67]/.test(declared)) return '7';
  if (/2019-09/.test(declared)) return '2019-09';
  // MCP defaults to JSON Schema 2020-12 when no dialect is declared.
  return '2020-12';
};

const decodePointerSegment = (segment: string): string => {
  let decoded = segment;
  try {
    decoded = decodeURI(segment);
  } catch {
    // Keep the raw segment when it is not valid percent-encoding.
  }
  return decoded.replace(/~1/g, '/').replace(/~0/g, '~');
};

const pointerSegments = (location: string): string[] => (
  location.replace(/^#/, '').split('/').slice(1).map(decodePointerSegment)
);

const appendSegment = (path: string, segment: string): string => {
  if (/^(?:0|[1-9]\d*)$/.test(segment)) return `${path}[${segment}]`;
  if (/^[A-Za-z_$][A-Za-z0-9_$]*$/.test(segment)) return `${path}.${segment}`;
  return `${path}[${JSON.stringify(segment)}]`;
};

export const formatInstancePath = (instanceLocation: string, root = ROOT_PATH): string => (
  pointerSegments(instanceLocation).reduce(appendSegment, root)
);

const describeExpectedTypes = (expected: string): string => (
  expected.split('", "').join(' or ')
);

const plainMessage = (unit: OutputUnit): string => {
  const typeMatch = unit.error.match(/^Instance type "([^"]+)" is invalid\. Expected "(.+)"\.$/);
  if (typeMatch) return `Expected ${describeExpectedTypes(typeMatch[2])} but got ${typeMatch[1]}.`;
  const enumMatch = unit.error.match(/^Instance does not match any of (.+)\.$/);
  if (enumMatch) return `Value is not one of the allowed values ${enumMatch[1]}.`;
  const constMatch = unit.error.match(/^Instance does not match (.+)\.$/);
  if (unit.keyword === 'const' && constMatch) return `Value must be exactly ${constMatch[1]}.`;
  return unit.error.replace(/^Instance /, 'Value ');
};

const isDescendantLocation = (location: string, ancestor: string): boolean => (
  location.startsWith(`${ancestor}/`)
);

/**
 * cfworker reports every level of a failure (for example "Property x does not
 * match schema" and then the real type error inside x). Keep the most specific
 * errors so users read one plain sentence per problem.
 */
export const toViolations = (errors: readonly OutputUnit[]): OutputContractViolation[] => {
  // anyOf/oneOf/not explain themselves; their per-branch errors are noise.
  const alternatives = errors.filter(unit => ['anyOf', 'oneOf', 'not'].includes(unit.keyword));
  const withoutBranchNoise = errors.filter(unit => !alternatives.some(alternative => (
    alternative !== unit && isDescendantLocation(unit.keywordLocation, alternative.keywordLocation)
  )));

  const realErrorAt = (instanceLocation: string) => withoutBranchNoise.some(unit => (
    unit.keyword !== 'false'
    && (isDescendantLocation(unit.instanceLocation, instanceLocation)
      || (unit.instanceLocation === instanceLocation
        && unit.keyword !== 'additionalProperties'
        && unit.keyword !== 'unevaluatedProperties'))
  ));

  const violations: OutputContractViolation[] = [];
  for (const unit of withoutBranchNoise) {
    // Boolean `false` schemas are reported through their parent keyword below.
    if (unit.keyword === 'false') continue;
    if (unit.keyword === 'additionalProperties' || unit.keyword === 'unevaluatedProperties') {
      const key = unit.error.match(/^Property "(.+)" does not match/)?.[1];
      if (key === undefined) continue;
      const propertyLocation = `${unit.instanceLocation}/${encodeURI(key.replace(/~/g, '~0').replace(/\//g, '~1'))}`;
      // cfworker also flags declared properties that failed their own schema;
      // the specific error inside the property is the useful one.
      if (realErrorAt(propertyLocation)) continue;
      violations.push({
        path: formatInstancePath(propertyLocation),
        message: `Property "${key}" is not allowed by the schema.`,
      });
      continue;
    }
    const hasDeeperError = withoutBranchNoise.some(other => (
      other !== unit
      && other.keyword !== 'false'
      && isDescendantLocation(other.keywordLocation, unit.keywordLocation)
    ));
    if (hasDeeperError) continue;
    if (unit.keyword === 'required') {
      const key = unit.error.match(/required property "(.+)"/)?.[1];
      if (key !== undefined) {
        violations.push({
          path: appendSegment(formatInstancePath(unit.instanceLocation), key),
          message: `Required property "${key}" is missing.`,
        });
        continue;
      }
    }
    violations.push({ path: formatInstancePath(unit.instanceLocation), message: plainMessage(unit) });
  }

  const seen = new Set<string>();
  return violations.filter(violation => {
    const key = `${violation.path}\u0000${violation.message}`;
    if (seen.has(key)) return false;
    seen.add(key);
    return true;
  });
};

/** Validates a value against a JSON Schema without runtime code generation. */
export const validateAgainstOutputSchema = (schema: unknown, value: unknown): SchemaValidationOutcome => {
  if (!isRecord(schema) && typeof schema !== 'boolean') {
    return {
      valid: false,
      violations: [{ path: '(schema)', message: 'The declared outputSchema is not a JSON Schema object.' }],
    };
  }
  try {
    const result = new Validator(schema as Record<string, unknown>, draftForSchema(schema), false).validate(value);
    if (result.valid) return { valid: true, violations: [] };
    const violations = toViolations(result.errors);
    return {
      valid: false,
      violations: violations.length > 0
        ? violations
        : [{ path: ROOT_PATH, message: 'Value does not match the declared outputSchema.' }],
    };
  } catch (error) {
    const reason = error instanceof Error ? error.message.split('\n')[0] : String(error);
    return {
      valid: false,
      violations: [{ path: '(schema)', message: `The declared outputSchema could not be used: ${reason}` }],
    };
  }
};

export interface OutputContractTool {
  name: string;
  outputSchema?: unknown;
}

/** Checks one tools/call result against the tool's declared output contract. */
export const checkToolOutputContract = (
  tool: OutputContractTool,
  result: unknown
): OutputContractResult => {
  const record = isRecord(result) ? result : {};
  const hasStructuredContent = record.structuredContent !== undefined;
  const isError = record.isError === true;
  const base = { toolName: tool.name, hasStructuredContent, isError };
  if (tool.outputSchema === undefined || tool.outputSchema === null) {
    return { ...base, status: 'no-schema', violations: [] };
  }
  if (isError) return { ...base, status: 'not-checked', violations: [] };
  if (!hasStructuredContent) {
    return {
      ...base,
      status: 'fail',
      violations: [{
        path: ROOT_PATH,
        message: 'The tool declares an outputSchema but returned no structuredContent. The MCP specification requires structured results from tools that declare an output schema.',
      }],
    };
  }
  const outcome = validateAgainstOutputSchema(tool.outputSchema, record.structuredContent);
  return {
    ...base,
    status: outcome.valid ? 'pass' : 'fail',
    violations: outcome.violations.slice(0, MAX_RECORDED_VIOLATIONS),
  };
};

/** Returns a copy of a tool definition the SDK will not validate output for. */
export const withoutOutputSchema = <T extends object>(tool: T): T => {
  const { outputSchema: _omitted, ...rest } = tool as T & { outputSchema?: unknown };
  return rest as T;
};

// --- Session record of contract results, consumed by the evaluator ---

const recordedResults = new Map<string, Map<string, OutputContractResult>>();

export const normalizeContractServerUrl = (value: string): string => {
  const trimmed = value.trim();
  try {
    const url = new URL(/^https?:\/\//i.test(trimmed) ? trimmed : `https://${trimmed}`);
    return url.toString();
  } catch {
    return trimmed;
  }
};

/** Remembers the latest verdict per tool so a later evaluation run can report it. */
export const recordOutputContractResult = (serverUrl: string, result: OutputContractResult): void => {
  if (!serverUrl || result.status === 'no-schema' || result.status === 'not-checked') return;
  const key = normalizeContractServerUrl(serverUrl);
  const byTool = recordedResults.get(key) ?? new Map<string, OutputContractResult>();
  byTool.set(result.toolName, result);
  recordedResults.set(key, byTool);
};

export const getRecordedOutputContractResults = (serverUrl: string): OutputContractResult[] => (
  [...(recordedResults.get(normalizeContractServerUrl(serverUrl))?.values() ?? [])]
);

export const clearRecordedOutputContractResults = (): void => {
  recordedResults.clear();
};

// --- Evaluation evidence ---

const MAX_EVIDENCE_VIOLATIONS = 5;

export interface OutputContractEvidenceV1 {
  /** Tools whose declared outputSchema was checked against a real result. */
  checkedToolCount: number;
  passingTools: string[];
  violatingTools: Array<{
    toolName: string;
    violations: OutputContractViolation[];
    omittedViolationCount: number;
  }>;
}

/** Summarizes recorded verdicts for an evaluation report; undefined when nothing was checked. */
export const summarizeOutputContracts = (
  results: readonly OutputContractResult[]
): OutputContractEvidenceV1 | undefined => {
  const latestByTool = new Map<string, OutputContractResult>();
  for (const result of results) {
    if (result.status === 'pass' || result.status === 'fail') latestByTool.set(result.toolName, result);
  }
  if (latestByTool.size === 0) return undefined;
  const checked = [...latestByTool.values()].sort((left, right) => left.toolName.localeCompare(right.toolName));
  return {
    checkedToolCount: checked.length,
    passingTools: checked.filter(result => result.status === 'pass').map(result => result.toolName),
    violatingTools: checked.filter(result => result.status === 'fail').map(result => ({
      toolName: result.toolName,
      violations: result.violations.slice(0, MAX_EVIDENCE_VIOLATIONS),
      omittedViolationCount: Math.max(0, result.violations.length - MAX_EVIDENCE_VIOLATIONS),
    })),
  };
};
