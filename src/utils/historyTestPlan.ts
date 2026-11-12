import type {
  DeterministicAssertion,
  DeterministicTestCaseV1,
  DeterministicTestPlanV1,
  DeterministicToolPlanV1,
} from '../types/deterministicTests';
import { DETERMINISTIC_TEST_PLAN_VERSION } from '../types/deterministicTests';
import { replayArguments, type CallHistoryEntry } from './callHistory';
import { caseIdPrefix, inferToolSafety, type DiscoveredTool } from './deterministicTests';
import { endpointIdentity } from './endpointIdentity';
import { REDACTED_VALUE } from './reportArtifact';

/** Longest text prefix a recorded call turns into a `contains` assertion. */
export const CONTAINS_PREFIX_LIMIT = 40;
const CONTAINS_PREFIX_MINIMUM = 4;
const RECORDED_CASE_TIMEOUT_MS = 30_000;
const RECORDED_CASE_TIMEOUT_LIMIT_MS = 120_000;

/** Calls a plan can start from: the server answered, and any declared output schema held. */
export const isSuccessfulCall = (entry: CallHistoryEntry): boolean => (
  !entry.isError && entry.outputVerdict !== 'fail'
);

const VOLATILE_TEXT: Array<{ pattern: RegExp; reason: string }> = [
  { pattern: /\d{4}-\d{2}-\d{2}/, reason: 'a date' },
  { pattern: /\b\d{1,2}:\d{2}(?::\d{2})?\b/, reason: 'a time of day' },
  { pattern: /\b(?:jan|feb|mar|apr|may|jun|jul|aug|sep|sept|oct|nov|dec)[a-z]*\.?\s+\d{1,2}\b/i, reason: 'a date' },
  { pattern: /\b\d+\s+(?:ms|milliseconds?|seconds?|secs?|minutes?|mins?|hours?|days?|weeks?)\s+ago\b|\b(?:just now|today|yesterday|tomorrow)\b/i, reason: 'a relative time' },
  { pattern: /\b[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}\b/i, reason: 'a UUID' },
  { pattern: /\b[0-9a-f]{12,}\b/i, reason: 'a hex identifier' },
  { pattern: /\d{5,}/, reason: 'a long number such as an id or timestamp' },
  { pattern: /\d+\.\d{3,}/, reason: 'a precise measurement' },
  { pattern: /\b(?=[A-Za-z0-9_-]*\d)(?=[A-Za-z0-9_-]*[A-Za-z])[A-Za-z0-9_-]{16,}\b/, reason: 'a generated token' },
];

/**
 * Why a recorded text result should not be asserted on, or undefined when it
 * looks stable. Structured JSON text is left to schema assertions, and redacted
 * text cannot be matched against the real response.
 */
export const nonDeterministicReason = (text: string): string | undefined => {
  const trimmed = text.trim();
  if (!trimmed) return 'empty text';
  if (trimmed.includes(REDACTED_VALUE) || trimmed.includes('[REDACTED')) return 'redacted text';
  if (/^[[{]/.test(trimmed)) return 'structured JSON text';
  return VOLATILE_TEXT.find(({ pattern }) => pattern.test(trimmed))?.reason;
};

/** A short prefix of the first line, cut at a word boundary, or undefined when too short to mean anything. */
export const stableTextPrefix = (text: string): string | undefined => {
  const firstLine = text.trimStart().split(/\r?\n/, 1)[0].trimEnd();
  let prefix = firstLine;
  if (prefix.length > CONTAINS_PREFIX_LIMIT) {
    const cut = prefix.slice(0, CONTAINS_PREFIX_LIMIT);
    const boundary = cut.search(/\s\S*$/);
    prefix = (boundary >= CONTAINS_PREFIX_MINIMUM ? cut.slice(0, boundary) : cut).trimEnd();
  }
  return prefix.length >= CONTAINS_PREFIX_MINIMUM ? prefix : undefined;
};

const stableJson = (value: unknown): string => JSON.stringify(value, (_key, item: unknown) => (
  item && typeof item === 'object' && !Array.isArray(item)
    ? Object.fromEntries(Object.entries(item as Record<string, unknown>).sort(([a], [b]) => a.localeCompare(b)))
    : item
));

const callKey = (entry: CallHistoryEntry): string => `${entry.toolName}\u0000${stableJson(entry.arguments)}`;

/**
 * The `contains` assertion for a recorded call, when its text looks
 * deterministic. Repeated identical calls whose text differed are volatile even
 * if each text looks stable on its own.
 */
export const textAssertionForCall = (
  entry: CallHistoryEntry,
  siblings: readonly CallHistoryEntry[] = [],
): DeterministicAssertion | undefined => {
  if (!entry.resultText || nonDeterministicReason(entry.resultText.excerpt)) return undefined;
  const prefix = stableTextPrefix(entry.resultText.excerpt);
  if (!prefix) return undefined;
  const key = callKey(entry);
  // A successful repeat without the text block (an image-only answer, say) varied too.
  const varied = siblings.some((other) => other.id !== entry.id && isSuccessfulCall(other) && callKey(other) === key
    && (other.resultText === undefined
      || other.resultText.index !== entry.resultText!.index || !other.resultText.excerpt.includes(prefix)));
  if (varied) return undefined;
  return { path: `$.content[${entry.resultText.index}].text`, operator: 'contains', value: prefix };
};

/** The assertion set a recorded successful call implies. */
export const assertionsForCall = (
  entry: CallHistoryEntry,
  tool: DiscoveredTool | undefined,
  siblings: readonly CallHistoryEntry[] = [],
): DeterministicAssertion[] => {
  const assertions: DeterministicAssertion[] = [
    { path: '$.content', operator: 'type', value: 'array' },
    { path: '$.isError', operator: 'not-equals', value: true },
  ];
  if (tool?.outputSchema && typeof tool.outputSchema === 'object') {
    assertions.push({ path: '$.structuredContent', operator: 'matches-output-schema' });
  }
  const text = textAssertionForCall(entry, siblings);
  if (text) assertions.push(text);
  return assertions;
};

export interface HistoryPlanResult {
  plan: DeterministicTestPlanV1;
  /** Selected calls that became cases. */
  convertedCount: number;
  /** Identical tool name and arguments as an earlier selected call. */
  duplicateCount: number;
  /** The connected server no longer lists the tool. */
  unavailableCount: number;
  /** Cases left unselected because redaction replaced argument values. */
  redactedCount: number;
}

/**
 * Converts recorded calls into deterministic cases, oldest first. Without
 * `callIds` every successful call is used; failed calls never become cases,
 * because the plan asserts the recorded success.
 */
export const createTestPlanFromHistory = (
  calls: readonly CallHistoryEntry[],
  tools: readonly DiscoveredTool[],
  serverUrl: string,
  options: { callIds?: Iterable<string>; generatedAt?: string } = {},
): HistoryPlanResult => {
  const wanted = options.callIds ? new Set(options.callIds) : undefined;
  const chosen = [...calls].reverse().filter((entry) => isSuccessfulCall(entry) && (!wanted || wanted.has(entry.id)));
  const toolsByName = new Map(tools.map((tool) => [tool.name, tool]));
  const seen = new Set<string>();
  const plans = new Map<string, DeterministicToolPlanV1>();
  let duplicateCount = 0;
  let unavailableCount = 0;
  let redactedCount = 0;
  for (const entry of chosen) {
    const tool = toolsByName.get(entry.toolName);
    if (!tool) {
      unavailableCount += 1;
      continue;
    }
    const key = callKey(entry);
    if (seen.has(key)) {
      duplicateCount += 1;
      continue;
    }
    seen.add(key);
    let toolPlan = plans.get(tool.name);
    if (!toolPlan) {
      toolPlan = {
        toolName: tool.name,
        ...(tool.description ? { description: tool.description } : {}),
        safety: inferToolSafety(tool),
        ...(tool.outputSchema && typeof tool.outputSchema === 'object' ? { outputSchema: structuredClone(tool.outputSchema) } : {}),
        cases: [],
      };
      plans.set(tool.name, toolPlan);
    }
    const index = toolPlan.cases.length + 1;
    if (entry.argumentsRedacted) redactedCount += 1;
    const testCase: DeterministicTestCaseV1 = {
      id: `history-${caseIdPrefix(tool.name)}--${index}`,
      toolName: tool.name,
      name: `Recorded call ${index}${entry.argumentsRedacted ? ' (redacted arguments, edit before running)' : ''}`,
      kind: 'happy-path',
      // A redacted value would be sent as the literal placeholder.
      selected: !entry.argumentsRedacted,
      arguments: replayArguments(entry),
      assertions: assertionsForCall(entry, tool, calls),
      timeoutMs: Math.min(RECORDED_CASE_TIMEOUT_LIMIT_MS, Math.max(RECORDED_CASE_TIMEOUT_MS, entry.durationMs * 3)),
    };
    toolPlan.cases.push(testCase);
  }
  const endpoint = endpointIdentity(serverUrl);
  const generatedAt = options.generatedAt ?? new Date().toISOString();
  const convertedCount = [...plans.values()].reduce((total, tool) => total + tool.cases.length, 0);
  return {
    plan: {
      version: DETERMINISTIC_TEST_PLAN_VERSION,
      name: `Recorded calls for ${endpoint || 'MCP server'}`,
      serverUrl: endpoint,
      generatedAt,
      tools: [...plans.values()],
    },
    convertedCount,
    duplicateCount,
    unavailableCount,
    redactedCount,
  };
};
