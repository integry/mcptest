import type { LogEntry } from '../types';
import { redactReportString, redactReportValue, REDACTED_VALUE } from './reportArtifact';
import { redactStandaloneCredentials } from './capabilityInventory';
import { endpointIdentity } from './endpointIdentity';

export const CALL_HISTORY_STORAGE_KEY = 'mcpPlaygroundCallHistoryV1';
export const CALL_HISTORY_LIMIT_PER_SERVER = 50;
export const CALL_HISTORY_SERVER_LIMIT = 20;
export const CALL_HISTORY_SUMMARY_LIMIT = 160;
export const CALL_HISTORY_TEXT_EXCERPT_LIMIT = 120;

export type CallOutputVerdict = 'pass' | 'fail';

export interface CallHistoryEntry {
  id: string;
  toolName: string;
  /** Arguments as sent on the wire (normalized), after report-snapshot redaction. */
  arguments: Record<string, unknown>;
  /** True when redaction replaced at least one argument value. */
  argumentsRedacted: boolean;
  resultSummary: string;
  durationMs: number;
  isError: boolean;
  outputVerdict?: CallOutputVerdict;
  outputViolationCount?: number;
  /**
   * The first text block of a successful result, uncollapsed and redacted, cut
   * to a short excerpt. Test plans derive `contains` assertions from it.
   */
  resultText?: { index: number; excerpt: string };
  calledAt: string;
}

interface CallHistoryStore {
  version: 1;
  servers: Array<{ endpoint: string; calls: CallHistoryEntry[] }>;
}

type ReadStorage = Pick<Storage, 'getItem'>;
type WriteStorage = Pick<Storage, 'getItem' | 'setItem' | 'removeItem'>;

const record = (value: unknown): Record<string, unknown> | undefined => (
  value && typeof value === 'object' && !Array.isArray(value) ? value as Record<string, unknown> : undefined
);

// Report redaction covers named secrets, URLs and JWTs; typed arguments can also
// hold bare provider tokens, which the capability inventory pattern catches.
export const redactHistoryText = (value: string): string => redactStandaloneCredentials(redactReportString(value));
const redactText = redactHistoryText;

export const redactArguments = (value: unknown): Record<string, unknown> => {
  const scrub = (child: unknown): unknown => {
    if (typeof child === 'string') return redactStandaloneCredentials(child);
    if (Array.isArray(child)) return child.map(scrub);
    const object = record(child);
    return object ? Object.fromEntries(Object.entries(object).map(([key, item]) => [key, scrub(item)])) : child;
  };
  return record(scrub(redactReportValue(value ?? {}))) ?? {};
};

export const containsRedaction = (value: unknown): boolean => {
  if (typeof value === 'string') return value.includes(REDACTED_VALUE);
  if (Array.isArray(value)) return value.some(containsRedaction);
  const object = record(value);
  return object ? Object.entries(object).some(([key, child]) => key.includes(REDACTED_VALUE) || containsRedaction(child)) : false;
};

const truncate = (value: string): string => {
  const singleLine = value.replace(/\s+/g, ' ').trim();
  return singleLine.length > CALL_HISTORY_SUMMARY_LIMIT
    ? `${singleLine.slice(0, CALL_HISTORY_SUMMARY_LIMIT - 1).trimEnd()}…`
    : singleLine;
};

const firstTextBlock = (content: unknown): { index: number; text: string } | undefined => {
  if (!Array.isArray(content)) return undefined;
  const index = content.findIndex((block) => record(block)?.type === 'text' && typeof record(block)?.text === 'string');
  return index >= 0 ? { index, text: String(record(content[index])!.text) } : undefined;
};

const contentSummary = (content: unknown): string | undefined => {
  if (!Array.isArray(content)) return undefined;
  const textBlock = content.map(record).find((block) => block?.type === 'text' && typeof block.text === 'string');
  if (textBlock) return String(textBlock.text);
  if (content.length === 0) return 'Empty result';
  const kinds = [...new Set(content.map((block) => String(record(block)?.type ?? 'unknown')))];
  return `${content.length} content ${content.length === 1 ? 'block' : 'blocks'} (${kinds.join(', ')})`;
};

/** Reduces a tools/call log entry to the outcome fields the history keeps. */
export const summarizeCallResult = (entry: LogEntry | null | undefined): Pick<
  CallHistoryEntry,
  'resultSummary' | 'isError' | 'outputVerdict' | 'outputViolationCount' | 'resultText'
> => {
  if (!entry) return { resultSummary: 'No result', isError: true };
  const result = entry.toolCall?.result;
  const contract = entry.toolCall?.contract;
  const isError = entry.type === 'error' || entry.type === 'warning' || result?.isError === true;
  const raw = entry.type === 'tool_result'
    ? contentSummary(result?.content ?? entry.data) ?? 'Result received'
    : typeof entry.data === 'string' ? entry.data : JSON.stringify(entry.data ?? null);
  const textBlock = entry.type === 'tool_result' && !isError ? firstTextBlock(result?.content ?? entry.data) : undefined;
  return {
    resultSummary: truncate(redactText(raw)),
    isError,
    ...(textBlock ? {
      resultText: {
        index: textBlock.index,
        // Redact before cutting so a secret split at the limit is still caught.
        excerpt: redactText(textBlock.text.slice(0, 4_096)).slice(0, CALL_HISTORY_TEXT_EXCERPT_LIMIT),
      },
    } : {}),
    ...(contract && (contract.status === 'pass' || contract.status === 'fail') ? {
      outputVerdict: contract.status,
      outputViolationCount: contract.violations.length,
    } : {}),
  };
};

const entryId = (calledAt: string): string => (
  typeof crypto !== 'undefined' && typeof crypto.randomUUID === 'function'
    ? `call-${crypto.randomUUID()}`
    : `call-${Date.parse(calledAt)}-${Math.random().toString(36).slice(2)}`
);

export interface CallHistoryInput {
  toolName: string;
  arguments: Record<string, unknown>;
  result: LogEntry | null | undefined;
  durationMs: number;
  calledAt?: string | Date;
}

/** Creates a history entry with arguments redacted like report snapshots. */
export const createCallHistoryEntry = (input: CallHistoryInput): CallHistoryEntry => {
  const calledAt = input.calledAt instanceof Date
    ? input.calledAt.toISOString()
    : input.calledAt ?? new Date().toISOString();
  const redactedArguments = redactArguments(input.arguments);
  return {
    id: entryId(calledAt),
    toolName: redactText(input.toolName),
    arguments: redactedArguments,
    argumentsRedacted: containsRedaction(redactedArguments),
    durationMs: Math.max(0, Math.round(input.durationMs)),
    calledAt,
    ...summarizeCallResult(input.result),
  };
};

const isEntry = (value: unknown): value is CallHistoryEntry => {
  const entry = record(value);
  return Boolean(entry)
    && typeof entry!.id === 'string'
    && typeof entry!.toolName === 'string'
    && Boolean(record(entry!.arguments))
    && typeof entry!.resultSummary === 'string'
    && typeof entry!.durationMs === 'number'
    && typeof entry!.isError === 'boolean'
    && typeof entry!.calledAt === 'string';
};

const validResultText = (value: unknown): CallHistoryEntry['resultText'] => {
  const text = record(value);
  return text && typeof text.index === 'number' && Number.isInteger(text.index) && text.index >= 0
    && typeof text.excerpt === 'string'
    ? { index: text.index, excerpt: redactText(text.excerpt.slice(0, CALL_HISTORY_TEXT_EXCERPT_LIMIT)) }
    : undefined;
};

const readStore = (storage: ReadStorage): CallHistoryStore => {
  try {
    const parsed = record(JSON.parse(storage.getItem(CALL_HISTORY_STORAGE_KEY) || 'null'));
    if (!parsed || parsed.version !== 1 || !Array.isArray(parsed.servers)) return { version: 1, servers: [] };
    return {
      version: 1,
      servers: parsed.servers.flatMap((server) => {
        const value = record(server);
        if (typeof value?.endpoint !== 'string' || !Array.isArray(value.calls)) return [];
        // Re-redact on read so entries written by older builds stay scrubbed.
        const calls = value.calls.filter(isEntry).slice(0, CALL_HISTORY_LIMIT_PER_SERVER).map((call) => {
          const { resultText, ...rest } = call;
          const text = validResultText(resultText);
          return {
            ...rest,
            arguments: redactArguments(call.arguments),
            resultSummary: redactText(call.resultSummary),
            ...(text ? { resultText: text } : {}),
          };
        });
        return [{ endpoint: value.endpoint, calls }];
      }),
    };
  } catch {
    return { version: 1, servers: [] };
  }
};

const writeStore = (store: CallHistoryStore, storage: WriteStorage): void => {
  const servers = store.servers.filter((server) => server.calls.length > 0);
  try {
    if (servers.length === 0) storage.removeItem(CALL_HISTORY_STORAGE_KEY);
    else storage.setItem(CALL_HISTORY_STORAGE_KEY, JSON.stringify({ version: 1, servers }));
  } catch {
    // A full quota drops this write; the in-memory list still reflects the call.
  }
};

/** Newest first. */
export const loadCallHistory = (serverUrl: string, storage: ReadStorage = localStorage): CallHistoryEntry[] => {
  const identity = endpointIdentity(serverUrl);
  return readStore(storage).servers.find((server) => server.endpoint === identity)?.calls ?? [];
};

export const recordCallHistoryEntry = (
  serverUrl: string,
  entry: CallHistoryEntry,
  storage: WriteStorage = localStorage
): CallHistoryEntry[] => {
  const identity = endpointIdentity(serverUrl);
  const store = readStore(storage);
  const existing = store.servers.find((server) => server.endpoint === identity)?.calls ?? [];
  const calls = [entry, ...existing.filter((call) => call.id !== entry.id)].slice(0, CALL_HISTORY_LIMIT_PER_SERVER);
  writeStore({
    version: 1,
    servers: [
      { endpoint: identity, calls },
      ...store.servers.filter((server) => server.endpoint !== identity),
    ].slice(0, CALL_HISTORY_SERVER_LIMIT),
  }, storage);
  return calls;
};

export const clearCallHistory = (serverUrl: string, storage: WriteStorage = localStorage): void => {
  const identity = endpointIdentity(serverUrl);
  const store = readStore(storage);
  writeStore({ version: 1, servers: store.servers.filter((server) => server.endpoint !== identity) }, storage);
};

export const clearAllCallHistory = (storage: Pick<Storage, 'removeItem'> = localStorage): void => {
  try {
    storage.removeItem(CALL_HISTORY_STORAGE_KEY);
  } catch {
    // Nothing to clear when storage is unavailable.
  }
};

export interface CallHistoryCounts {
  calls: number;
  failures: number;
}

/** Counts only: reports never include call contents. */
export const callHistoryCounts = (serverUrl: string, storage?: ReadStorage): CallHistoryCounts => {
  try {
    const source = storage ?? (typeof localStorage !== 'undefined' ? localStorage : undefined);
    if (!source) return { calls: 0, failures: 0 };
    const calls = loadCallHistory(serverUrl, source);
    return {
      calls: calls.length,
      failures: calls.filter((call) => call.isError || call.outputVerdict === 'fail').length,
    };
  } catch {
    return { calls: 0, failures: 0 };
  }
};

/** The replay payload: the stored arguments, ready to refill the request form. */
export const replayArguments = (entry: CallHistoryEntry): Record<string, unknown> => (
  JSON.parse(JSON.stringify(entry.arguments)) as Record<string, unknown>
);

/** A tools/call request equivalent to the recorded call, for pasting into other clients. */
export const toJsonRpcRequest = (entry: CallHistoryEntry, id: number | string = 1): string => JSON.stringify({
  jsonrpc: '2.0',
  id,
  method: 'tools/call',
  params: { name: entry.toolName, arguments: replayArguments(entry) },
}, null, 2);
