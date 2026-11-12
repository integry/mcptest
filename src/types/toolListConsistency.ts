/**
 * Repeated tools/list sampling within one evaluation.
 *
 * Servers behind blue/green deploys or stale replicas can answer tools/list
 * differently from request to request. The evaluation lists tools a few times
 * (on fresh connections where the transport allows it), hashes each complete
 * result canonically and records the comparison here. The record travels in
 * report section evidence under the `toolListConsistency` metadata key, so the
 * published report schema (v2) does not change.
 */
export const TOOL_LIST_CONSISTENCY_VERSION = 1 as const;

/** Stable finding id; release priorities and documentation key on it. */
export const TOOL_LIST_CONSISTENCY_FINDING_ID = 'tools.list-nondeterministic' as const;

/** Response headers that can identify the instance that answered. */
export const INSTANCE_IDENTIFYING_HEADERS = [
  'cf-ray',
  'fly-request-id',
  'x-vercel-id',
  'x-served-by',
  'via',
  'server',
] as const;

export type InstanceIdentifyingHeader = typeof INSTANCE_IDENTIFYING_HEADERS[number];

/** The fields a tool definition is compared on. */
export type ToolDefinitionField =
  | 'title'
  | 'description'
  | 'inputSchema'
  | 'outputSchema'
  | 'annotations';

export interface ToolListSampleV1 {
  /** 1-based position in the sampling sequence. */
  index: number;
  /** `evaluation` reuses the list the evaluation already fetched; `fresh` opened a new connection. */
  connection: 'evaluation' | 'fresh' | 'same';
  status: 'complete' | 'failed';
  /** Canonical hash of the complete list; present when `status` is complete. */
  hash?: string;
  toolCount?: number;
  /** tools/list pages followed for this sample. */
  pageCount?: number;
  /** Bounded failure message when the sample could not be read. */
  error?: string;
  /** Instance-identifying response headers readable on the tools/list response(s). */
  instanceHeaders?: Partial<Record<InstanceIdentifyingHeader, string>>;
  /** True when the response came from a cross-origin request where CORS limits readable headers. */
  crossOrigin?: boolean;
}

export interface ToolListDifferenceV1 {
  tool: string;
  /** `presence`: listed by some samples only; `definition`: listed by all, with differing fields. */
  kind: 'presence' | 'definition';
  /** Sample indexes that listed the tool. */
  presentIn: number[];
  /** Sample indexes that did not list it. */
  absentIn: number[];
  /** Fields whose value differed between samples that listed the tool. */
  changedFields: ToolDefinitionField[];
}

export interface ToolListConsistencyV1 {
  version: typeof TOOL_LIST_CONSISTENCY_VERSION;
  /**
   * `consistent`: at least two complete samples, all identical. `inconsistent`:
   * two complete samples differed. `not-checked`: fewer than two complete samples.
   */
  status: 'consistent' | 'inconsistent' | 'not-checked';
  /** Whether the lists were requested with target credentials. */
  authentication: 'authenticated' | 'unauthenticated';
  route: 'direct' | 'proxy';
  transportType: 'streamable-http' | 'legacy-sse';
  requestedSamples: number;
  samples: ToolListSampleV1[];
  /** Distinct canonical hashes among complete samples. */
  distinctHashes: number;
  differences: ToolListDifferenceV1[];
  /** Why the comparison was not made, for `not-checked`. */
  notCheckedReason?: string;
  /** Explains missing or proxy-supplied instance headers. */
  headerNote?: string;
}
