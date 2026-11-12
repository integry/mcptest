/**
 * Canonical tools/list hashing and the comparison of repeated samples.
 *
 * A tool definition is read exactly as the breaking-change checker reads it
 * (name, title, description, inputSchema, outputSchema, annotations) and
 * serialized with sorted object keys, so key order and tool order never change
 * the hash while any change to a definition, including a description-only
 * rewrite, does.
 */
import { stableString, toolDefinitionFromValue, type ToolDefinitionSnapshot } from './breakingChanges';
import {
  INSTANCE_IDENTIFYING_HEADERS,
  TOOL_LIST_CONSISTENCY_VERSION,
  type InstanceIdentifyingHeader,
  type ToolDefinitionField,
  type ToolListConsistencyV1,
  type ToolListDifferenceV1,
  type ToolListSampleV1,
} from '../types/toolListConsistency';

export const DEFAULT_TOOL_LIST_SAMPLES = 3;
export const MAX_TOOL_LIST_SAMPLES = 5;
export const DEFAULT_TOOL_LIST_SPACING_MS = 250;
/** Matches the evaluation's own discovery pagination limit. */
export const TOOL_LIST_PAGE_LIMIT = 64;

const COMPARED_FIELDS: readonly ToolDefinitionField[] = [
  'title', 'description', 'inputSchema', 'outputSchema', 'annotations',
];

const MAX_ERROR_LENGTH = 300;
const MAX_HEADER_LENGTH = 128;

/** The canonical, comparable form of one tools/list entry, or undefined without a name. */
export const canonicalToolDefinition = (value: unknown): ToolDefinitionSnapshot | undefined => (
  toolDefinitionFromValue(value)
);

/** Canonical definitions sorted by name, then by their canonical JSON. */
export const canonicalToolList = (tools: readonly unknown[]): ToolDefinitionSnapshot[] => (
  tools.flatMap((tool) => canonicalToolDefinition(tool) ?? [])
    .map((tool) => ({ tool, text: stableString(tool) }))
    .sort((left, right) => (
      left.tool.name < right.tool.name ? -1
        : left.tool.name > right.tool.name ? 1
          : left.text < right.text ? -1 : left.text > right.text ? 1 : 0
    ))
    .map(({ tool }) => tool)
);

/** Canonical JSON for a whole list. */
export const canonicalToolListJson = (tools: readonly unknown[]): string => (
  stableString(canonicalToolList(tools))
);

const fnv1a64 = (text: string): string => {
  // Two 32-bit FNV-1a lanes with different offsets; only used without WebCrypto.
  let left = 0x811c9dc5;
  let right = 0x01000193 ^ 0x9e3779b9;
  for (let index = 0; index < text.length; index += 1) {
    const code = text.charCodeAt(index);
    left = Math.imul(left ^ code, 0x01000193) >>> 0;
    right = Math.imul(right ^ code, 0x01000193) >>> 0;
  }
  return `${left.toString(16).padStart(8, '0')}${right.toString(16).padStart(8, '0')}`;
};

const digest = async (text: string): Promise<string> => {
  const subtle = globalThis.crypto?.subtle;
  if (subtle && typeof TextEncoder !== 'undefined') {
    try {
      const bytes = new Uint8Array(await subtle.digest('SHA-256', new TextEncoder().encode(text)));
      return `sha256:${Array.from(bytes, (byte) => byte.toString(16).padStart(2, '0')).join('')}`;
    } catch {
      // Fall through to the non-cryptographic hash; this is a change detector.
    }
  }
  return `fnv1a-64:${fnv1a64(text)}`;
};

/** Canonical hash of a complete tools/list result (all pages combined). */
export const hashToolList = (tools: readonly unknown[]): Promise<string> => (
  digest(canonicalToolListJson(tools))
);

export class ToolListPaginationError extends Error {
  constructor(message: string, readonly pageCount: number) {
    super(message);
    this.name = 'ToolListPaginationError';
  }
}

/**
 * Follows tools/list cursors until the list is complete. Repeated cursors,
 * malformed pages and the page limit are failures, never a silently short list.
 */
export const collectToolListPages = async (
  fetchPage: (cursor?: string) => Promise<unknown>,
  pageLimit = TOOL_LIST_PAGE_LIMIT
): Promise<{ tools: unknown[]; pageCount: number }> => {
  const tools: unknown[] = [];
  const seen = new Set<string>();
  let cursor: string | undefined;
  let pageCount = 0;
  do {
    if (pageCount >= pageLimit) {
      throw new ToolListPaginationError(`The ${pageLimit}-page tools/list safety limit was reached.`, pageCount);
    }
    const page = await fetchPage(cursor);
    pageCount += 1;
    if (!page || typeof page !== 'object' || Array.isArray(page)
        || !Array.isArray((page as { tools?: unknown }).tools)) {
      throw new ToolListPaginationError('A tools/list page was malformed.', pageCount);
    }
    const record = page as { tools: unknown[]; nextCursor?: unknown };
    tools.push(...record.tools);
    if (record.nextCursor === undefined || record.nextCursor === null) {
      cursor = undefined;
    } else if (typeof record.nextCursor !== 'string' || record.nextCursor.length === 0) {
      throw new ToolListPaginationError('A tools/list page returned a malformed nextCursor.', pageCount);
    } else if (seen.has(record.nextCursor)) {
      throw new ToolListPaginationError('The server repeated a tools/list cursor.', pageCount);
    } else {
      cursor = record.nextCursor;
      seen.add(cursor);
    }
  } while (cursor !== undefined);
  return { tools, pageCount };
};

const boundText = (value: string, length: number): string => {
  const normalized = value.replace(/[\u0000-\u001f\u007f]+/g, ' ').trim();
  return normalized.length > length ? `${normalized.slice(0, length - 1)}…` : normalized;
};

export const boundSampleError = (error: unknown): string => boundText(
  error instanceof Error ? error.message : String(error),
  MAX_ERROR_LENGTH
) || 'tools/list failed.';

/** Keeps only the allowlisted instance headers, with bounded values. */
export const pickInstanceHeaders = (
  headers: Headers | Record<string, string> | undefined
): Partial<Record<InstanceIdentifyingHeader, string>> | undefined => {
  if (!headers) return undefined;
  const read = (name: string): string | null | undefined => (
    headers instanceof Headers
      ? headers.get(name)
      : Object.entries(headers).find(([key]) => key.toLowerCase() === name)?.[1]
  );
  const picked: Partial<Record<InstanceIdentifyingHeader, string>> = {};
  for (const name of INSTANCE_IDENTIFYING_HEADERS) {
    const value = read(name);
    if (typeof value === 'string' && value.trim()) picked[name] = boundText(value, MAX_HEADER_LENGTH);
  }
  return Object.keys(picked).length > 0 ? picked : undefined;
};

/** One sample's raw observation, before hashing. */
export interface ToolListObservation {
  connection: ToolListSampleV1['connection'];
  tools?: readonly unknown[];
  pageCount?: number;
  error?: unknown;
  instanceHeaders?: ToolListSampleV1['instanceHeaders'];
  crossOrigin?: boolean;
}

/** Per-tool differences between complete samples. */
export const diffToolListSamples = (
  samples: ReadonlyArray<{ index: number; tools: readonly unknown[] }>
): ToolListDifferenceV1[] => {
  const byName = new Map<string, Map<number, string[]>>();
  const definitions = new Map<string, Map<number, ToolDefinitionSnapshot>>();
  for (const sample of samples) {
    for (const tool of canonicalToolList(sample.tools)) {
      const texts = byName.get(tool.name) ?? new Map<number, string[]>();
      texts.set(sample.index, [...(texts.get(sample.index) ?? []), stableString(tool)]);
      byName.set(tool.name, texts);
      const defs = definitions.get(tool.name) ?? new Map<number, ToolDefinitionSnapshot>();
      if (!defs.has(sample.index)) defs.set(sample.index, tool);
      definitions.set(tool.name, defs);
    }
  }
  const indexes = samples.map((sample) => sample.index);
  const differences: ToolListDifferenceV1[] = [];
  for (const name of [...byName.keys()].sort()) {
    const texts = byName.get(name)!;
    const presentIn = indexes.filter((index) => texts.has(index));
    const absentIn = indexes.filter((index) => !texts.has(index));
    const defs = [...definitions.get(name)!.values()];
    const changedFields = COMPARED_FIELDS.filter((field) => (
      new Set(defs.map((tool) => stableString(tool[field] ?? null))).size > 1
    ));
    const variants = new Set(presentIn.map((index) => texts.get(index)!.join('\n')));
    if (absentIn.length === 0 && variants.size <= 1) continue;
    differences.push({
      tool: name,
      kind: absentIn.length > 0 ? 'presence' : 'definition',
      presentIn,
      absentIn,
      changedFields,
    });
  }
  return differences;
};

export interface ToolListConsistencyContext {
  authentication: ToolListConsistencyV1['authentication'];
  route: ToolListConsistencyV1['route'];
  transportType: ToolListConsistencyV1['transportType'];
  requestedSamples: number;
}

const headerNote = (
  samples: readonly ToolListSampleV1[],
  route: ToolListConsistencyV1['route']
): string | undefined => {
  const complete = samples.filter((sample) => sample.status === 'complete');
  if (complete.length === 0) return undefined;
  const anyHeaders = complete.some((sample) => sample.instanceHeaders);
  if (route === 'proxy') {
    return anyHeaders
      ? 'Responses came through the mcptest proxy, so cf-ray and server may describe the proxy rather than the MCP server.'
      : 'No instance-identifying headers were readable through the mcptest proxy.';
  }
  if (anyHeaders) return undefined;
  return complete.some((sample) => sample.crossOrigin)
    ? 'No instance-identifying headers (cf-ray, fly-request-id, x-vercel-id, x-served-by, via, server) were readable. In the browser, CORS hides response headers the server does not list in Access-Control-Expose-Headers; run the headless CLI to see them.'
    : 'The server sent no instance-identifying headers (cf-ray, fly-request-id, x-vercel-id, x-served-by, via, server).';
};

/** Hashes each observation and compares the complete ones. */
export const assessToolListConsistency = async (
  observations: readonly ToolListObservation[],
  context: ToolListConsistencyContext
): Promise<ToolListConsistencyV1> => {
  const samples: ToolListSampleV1[] = [];
  const complete: Array<{ index: number; tools: readonly unknown[]; hash: string }> = [];
  for (const [position, observation] of observations.entries()) {
    const index = position + 1;
    const shared = {
      index,
      connection: observation.connection,
      ...(observation.pageCount !== undefined ? { pageCount: observation.pageCount } : {}),
      ...(observation.instanceHeaders ? { instanceHeaders: observation.instanceHeaders } : {}),
      ...(observation.crossOrigin !== undefined ? { crossOrigin: observation.crossOrigin } : {}),
    };
    if (observation.tools && observation.error === undefined) {
      const hash = await hashToolList(observation.tools);
      complete.push({ index, tools: observation.tools, hash });
      samples.push({ ...shared, status: 'complete', hash, toolCount: canonicalToolList(observation.tools).length });
    } else {
      samples.push({ ...shared, status: 'failed', error: boundSampleError(observation.error ?? 'tools/list failed.') });
    }
  }
  const distinctHashes = new Set(complete.map((sample) => sample.hash)).size;
  const status: ToolListConsistencyV1['status'] = complete.length < 2
    ? 'not-checked'
    : distinctHashes > 1 ? 'inconsistent' : 'consistent';
  const note = headerNote(samples, context.route);
  return {
    version: TOOL_LIST_CONSISTENCY_VERSION,
    status,
    authentication: context.authentication,
    route: context.route,
    transportType: context.transportType,
    requestedSamples: context.requestedSamples,
    samples,
    distinctHashes,
    differences: status === 'inconsistent' ? diffToolListSamples(complete) : [],
    ...(status === 'not-checked'
      ? { notCheckedReason: complete.length === 0
          ? 'No complete tools/list result was available to compare.'
          : 'Only one tools/list request completed, so there was nothing to compare it with.' }
      : {}),
    ...(note ? { headerNote: note } : {}),
  };
};

/** A result for when the evaluation's own tools/list did not complete; no extra requests are sent. */
export const notCheckedToolListConsistency = (
  context: ToolListConsistencyContext,
  reason: string
): ToolListConsistencyV1 => ({
  version: TOOL_LIST_CONSISTENCY_VERSION,
  status: 'not-checked',
  authentication: context.authentication,
  route: context.route,
  transportType: context.transportType,
  requestedSamples: context.requestedSamples,
  samples: [],
  distinctHashes: 0,
  differences: [],
  notCheckedReason: reason,
});

export interface ToolListSamplerOptions {
  /** Total samples including the evaluation's own list. Clamped to 2..MAX_TOOL_LIST_SAMPLES. */
  samples?: number;
  spacingMs?: number;
  signal?: AbortSignal;
  sleep?: (ms: number, signal?: AbortSignal) => Promise<void>;
}

const defaultSleep = (ms: number, signal?: AbortSignal): Promise<void> => new Promise((resolve) => {
  if (ms <= 0 || signal?.aborted) {
    resolve();
    return;
  }
  const timer = setTimeout(done, ms);
  function done() {
    clearTimeout(timer);
    signal?.removeEventListener('abort', done);
    resolve();
  }
  signal?.addEventListener('abort', done, { once: true });
});

export const clampToolListSamples = (value: number | undefined): number => (
  Math.min(MAX_TOOL_LIST_SAMPLES, Math.max(2, Math.floor(value ?? DEFAULT_TOOL_LIST_SAMPLES)))
);

/**
 * Collects the follow-up samples sequentially with a short pause between
 * them, stopping at the first failure. Each `takeSample` is expected to open its own connection where the
 * transport allows, so another replica may answer.
 */
export const sampleToolLists = async (
  first: ToolListObservation,
  takeSample: () => Promise<ToolListObservation>,
  options: ToolListSamplerOptions = {}
): Promise<ToolListObservation[]> => {
  const total = clampToolListSamples(options.samples);
  const sleep = options.sleep ?? defaultSleep;
  const observations: ToolListObservation[] = [first];
  for (let index = 1; index < total && !options.signal?.aborted; index += 1) {
    await sleep(options.spacingMs ?? DEFAULT_TOOL_LIST_SPACING_MS, options.signal);
    if (options.signal?.aborted) break;
    let observation: ToolListObservation;
    try {
      observation = await takeSample();
    } catch (error) {
      observation = { connection: 'fresh', error };
    }
    observations.push(observation);
    // Stay polite: a failing follow-up request ends the sampling.
    if (observation.error !== undefined || !observation.tools) break;
  }
  return observations;
};
