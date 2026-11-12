/**
 * Report text, evidence and release priority for the repeated tools/list
 * check. Kept free of runtime imports so report views can read the result
 * without loading the hashing or connection code.
 */
import {
  INSTANCE_IDENTIFYING_HEADERS,
  TOOL_LIST_CONSISTENCY_FINDING_ID,
  TOOL_LIST_CONSISTENCY_VERSION,
  type ToolListConsistencyV1,
  type ToolListDifferenceV1,
} from '../types/toolListConsistency';

export const TOOL_LIST_CONSISTENCY_SECTION_ID = 'toolListConsistency';
export const TOOL_LIST_INCONSISTENT_TITLE = 'Tool list is not deterministic (likely mixed deploy or stale replica)';

const samplesLabel = (indexes: readonly number[]): string => (
  `${indexes.length === 1 ? 'request' : 'requests'} ${indexes.join(', ')}`
);

/** One line per differing tool, e.g. "search: missing from request 2" or "search: description, inputSchema differ". */
export const describeToolListDifference = (difference: ToolListDifferenceV1): string => {
  const parts: string[] = [];
  if (difference.kind === 'presence') {
    parts.push(`listed by ${samplesLabel(difference.presentIn)}, missing from ${samplesLabel(difference.absentIn)}`);
  }
  if (difference.changedFields.length > 0) {
    parts.push(`${difference.changedFields.join(', ')} ${difference.changedFields.length === 1 ? 'differs' : 'differ'} between requests`);
  }
  return `${difference.tool}: ${parts.join('; ') || 'definition differs between requests'}`;
};

const sampleHeaderSummary = (result: ToolListConsistencyV1): string | undefined => {
  const lines = result.samples.flatMap((sample) => {
    if (!sample.instanceHeaders) return [];
    const values = Object.entries(sample.instanceHeaders).map(([name, value]) => `${name}: ${value}`);
    return [`request ${sample.index} (${values.join(', ')})`];
  });
  return lines.length > 0 ? `Instance headers: ${lines.join('; ')}.` : undefined;
};

const accessLabel = (result: ToolListConsistencyV1): string => (
  result.authentication === 'authenticated' ? 'authenticated' : 'unauthenticated'
);

export const toolListConsistencySummary = (result: ToolListConsistencyV1): string => {
  const complete = result.samples.filter((sample) => sample.status === 'complete').length;
  if (result.status === 'consistent') {
    return `tools/list returned identical definitions on ${complete} of ${result.samples.length} requests (${accessLabel(result)})`;
  }
  if (result.status === 'inconsistent') {
    return `${TOOL_LIST_INCONSISTENT_TITLE}: ${result.distinctHashes} different results across ${complete} requests (${accessLabel(result)})`;
  }
  return `Tool list consistency was not checked (${accessLabel(result)})`;
};

export const toolListConsistencyContext = (result: ToolListConsistencyV1): string => {
  const failed = result.samples.filter((sample) => sample.status === 'failed');
  return [
    result.status === 'inconsistent'
      ? `Differences: ${result.differences.map(describeToolListDifference).join(' | ') || 'tool order or duplicate entries changed'}.`
      : undefined,
    result.status === 'consistent'
      ? `Each complete result had the canonical hash ${result.samples.find((sample) => sample.hash)?.hash}.`
      : undefined,
    result.notCheckedReason,
    failed.length > 0
      ? `${failed.length} ${failed.length === 1 ? 'request' : 'requests'} failed: ${failed.map((sample) => `request ${sample.index}: ${sample.error}`).join('; ')}.`
      : undefined,
    sampleHeaderSummary(result),
    result.headerNote,
    `Lists were requested ${accessLabel(result)}; compare them only with lists obtained the same way.`,
  ].filter(Boolean).join(' ');
};

/** The section evidence item that carries the full result under one metadata key. */
export const toolListConsistencyReportDetail = (result: ToolListConsistencyV1): {
  text: string;
  context: string;
  metadata: { method: string; findingId?: string; toolListConsistency: ToolListConsistencyV1 };
} => ({
  text: `${result.status === 'consistent' ? '✓' : result.status === 'inconsistent' ? '⚠' : 'ℹ'} ${toolListConsistencySummary(result)}`,
  context: toolListConsistencyContext(result),
  metadata: {
    method: 'tools/list consistency',
    ...(result.status === 'inconsistent' ? { findingId: TOOL_LIST_CONSISTENCY_FINDING_ID } : {}),
    toolListConsistency: result,
  },
});

const isPlainObject = (value: unknown): value is Record<string, unknown> => (
  Boolean(value) && typeof value === 'object' && !Array.isArray(value)
);
const isOptional = (value: unknown, check: (item: unknown) => boolean): boolean => value === undefined || check(value);
const isString = (value: unknown): value is string => typeof value === 'string';
const isCount = (value: unknown): value is number => typeof value === 'number' && Number.isInteger(value) && value >= 0;
const isCountList = (value: unknown): boolean => Array.isArray(value) && value.every(isCount);
const TOOL_DEFINITION_FIELDS: ReadonlySet<unknown> = new Set(['title', 'description', 'inputSchema', 'outputSchema', 'annotations']);
const INSTANCE_HEADERS: ReadonlySet<string> = new Set(INSTANCE_IDENTIFYING_HEADERS);

const isInstanceHeaders = (value: unknown): boolean => (
  isPlainObject(value)
  && Object.entries(value).every(([name, header]) => INSTANCE_HEADERS.has(name) && isString(header))
);

const isSample = (value: unknown): boolean => {
  if (!isPlainObject(value)) return false;
  return isCount(value.index)
    && (value.connection === 'evaluation' || value.connection === 'fresh' || value.connection === 'same')
    && (value.status === 'complete' || value.status === 'failed')
    && isOptional(value.hash, isString)
    && isOptional(value.toolCount, isCount)
    && isOptional(value.pageCount, isCount)
    && isOptional(value.error, isString)
    && isOptional(value.instanceHeaders, isInstanceHeaders)
    && isOptional(value.crossOrigin, (flag) => typeof flag === 'boolean');
};

const isDifference = (value: unknown): boolean => {
  if (!isPlainObject(value)) return false;
  return isString(value.tool)
    && (value.kind === 'presence' || value.kind === 'definition')
    && isCountList(value.presentIn)
    && isCountList(value.absentIn)
    && Array.isArray(value.changedFields)
    && value.changedFields.every((field) => TOOL_DEFINITION_FIELDS.has(field));
};

/**
 * Evidence metadata is unrestricted JSON in published and imported reports, so
 * every member the views read is checked before the record is trusted.
 */
const isConsistencyRecord = (value: unknown): value is ToolListConsistencyV1 => {
  if (!isPlainObject(value)) return false;
  return value.version === TOOL_LIST_CONSISTENCY_VERSION
    && (value.status === 'consistent' || value.status === 'inconsistent' || value.status === 'not-checked')
    && (value.authentication === 'authenticated' || value.authentication === 'unauthenticated')
    && (value.route === 'direct' || value.route === 'proxy')
    && (value.transportType === 'streamable-http' || value.transportType === 'legacy-sse')
    && isCount(value.requestedSamples)
    && isCount(value.distinctHashes)
    && Array.isArray(value.samples) && value.samples.every(isSample)
    && Array.isArray(value.differences) && value.differences.every(isDifference)
    && isOptional(value.notCheckedReason, isString)
    && isOptional(value.headerNote, isString);
};

/** Reads the recorded result from evaluation sections or public report sections. */
export const toolListConsistencyFromSections = (
  sections:
    | Record<string, { details: ReadonlyArray<{ metadata?: unknown }> }>
    | ReadonlyArray<{ evidence: ReadonlyArray<{ metadata?: unknown }> }>
    | undefined
): ToolListConsistencyV1 | undefined => {
  if (!sections) return undefined;
  const items = Array.isArray(sections)
    ? (sections as ReadonlyArray<{ evidence?: ReadonlyArray<{ metadata?: unknown }> }>).flatMap((section) => section.evidence ?? [])
    : Object.values(sections as Record<string, { details?: ReadonlyArray<{ metadata?: unknown }> }>).flatMap((section) => section.details ?? []);
  return items
    .map((item) => (item?.metadata as { toolListConsistency?: unknown } | undefined)?.toolListConsistency)
    .find(isConsistencyRecord);
};

/** A non-deterministic list asks for review; it is transient, so it does not block release by itself. */
export const toolListConsistencyPriority = (result: ToolListConsistencyV1 | undefined): {
  id: string;
  severity: 'medium';
  title: string;
  detail: string;
  remediation: string;
  source: 'Evaluation';
} | undefined => {
  if (result?.status !== 'inconsistent') return undefined;
  return {
    id: TOOL_LIST_CONSISTENCY_FINDING_ID,
    severity: 'medium',
    title: TOOL_LIST_INCONSISTENT_TITLE,
    detail: `${toolListConsistencySummary(result)}. ${toolListConsistencyContext(result)}`,
    remediation: 'Finish or roll back the deploy so every replica serves the same build, drain stale instances, and make tool registration deterministic (no per-request or per-instance feature flags). Rerun the report to confirm a stable list.',
    source: 'Evaluation',
  };
};
