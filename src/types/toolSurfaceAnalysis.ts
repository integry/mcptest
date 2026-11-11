import type { ToolContextCostV1 } from './toolContextCost';

export const TOOL_SURFACE_ANALYSIS_VERSION = '1.0.0' as const;

export type ToolSurfaceAnalysisVersion = typeof TOOL_SURFACE_ANALYSIS_VERSION;

export type ToolSurfaceSeverity = 'critical' | 'high' | 'medium' | 'low' | 'info';

export type ToolSurfaceFindingCategory =
  | 'availability'
  | 'context-cost'
  | 'ambiguity'
  | 'description-quality'
  | 'schema-quality'
  | 'capability-risk'
  | 'prompt-like-description'
  | 'annotations';

/**
 * Stable ids of the tool-annotation findings. Each has a section in the
 * diagnostics reference under its release-priority id (`tool.<id>`).
 */
export const TOOL_ANNOTATION_FINDING_IDS = [
  'annotations.coverage',
  'annotations.missing-safety-hints',
  'annotations.missing-title',
  'annotations.hint-name-mismatch',
  'annotations.client-treatment',
] as const;

export type ToolAnnotationFindingId = typeof TOOL_ANNOTATION_FINDING_IDS[number];

export type ToolSurfaceFindingKind =
  | 'measurement'
  | 'quality-signal'
  | 'capability-signal'
  | 'review-signal';

export interface ToolSurfaceEvidenceV1 {
  tool: string;
  path: string;
  detail: string;
}

export interface ToolSurfaceFindingV1 {
  id: string;
  category: ToolSurfaceFindingCategory;
  severity: ToolSurfaceSeverity;
  kind: ToolSurfaceFindingKind;
  title: string;
  summary: string;
  evidence: ToolSurfaceEvidenceV1[];
  omittedEvidenceCount: number;
  remediation: string;
}

export interface ToolDescriptionMetricsV1 {
  describedToolCount: number;
  missingToolDescriptionCount: number;
  shortDescriptionCount: number;
  genericDescriptionCount: number;
  longDescriptionCount: number;
  totalCharacters: number;
  averageCharacters: number;
  minimumCharacters: number;
  maximumCharacters: number;
  qualityScore: number;
}

export interface ToolSchemaMetricsV1 {
  schemaNodeCount: number;
  propertyCount: number;
  requiredPropertyCount: number;
  optionalPropertyCount: number;
  requiredPropertyRatio: number;
  propertiesMissingDescriptions: number;
  unconstrainedStringCount: number;
  unconstrainedObjectCount: number;
  maximumDepth: number;
  maximumWidth: number;
  malformedSchemaCount: number;
}

export interface ToolAmbiguityMetricsV1 {
  duplicateNameGroupCount: number;
  overlappingNamePairCount: number;
  duplicateDescriptionGroupCount: number;
  overlappingDescriptionPairCount: number;
}

export interface ToolRiskSignalMetricsV1 {
  writeCapabilityToolCount: number;
  destructiveCapabilityToolCount: number;
  promptLikeDescriptionCount: number;
}

/** Server-level annotation coverage: how many analyzed tools declare each field. */
export interface ToolAnnotationMetricsV1 {
  /** Named tool definitions the annotation checks covered. */
  analyzedToolCount: number;
  annotatedToolCount: number;
  readOnlyHintCount: number;
  destructiveHintCount: number;
  idempotentHintCount: number;
  openWorldHintCount: number;
  annotationTitleCount: number;
  titleCount: number;
  /** Tools that declare readOnlyHint: true. */
  readOnlyToolCount: number;
  /** Tools that state their retry safety: readOnlyHint: true, idempotentHint: true, or both readOnlyHint and idempotentHint declared. */
  retryHintDeclaredCount: number;
  /** Tools with readOnlyHint: true or idempotentHint: true. */
  retryEligibleToolCount: number;
  hintMismatchToolCount: number;
}

export interface ToolSurfaceMetricsV1 {
  toolListStatus: 'present' | 'empty' | 'missing' | 'malformed';
  toolCount: number;
  validToolCount: number;
  malformedToolCount: number;
  resourceCount: number;
  promptCount: number;
  serializedDefinitionBytes: number;
  /** Equals `contextCost.estimatedTotal` when present; bytes / 4 in reports made before it. */
  estimatedContextTokens: number;
  descriptions: ToolDescriptionMetricsV1;
  schemas: ToolSchemaMetricsV1;
  ambiguity: ToolAmbiguityMetricsV1;
  riskSignals: ToolRiskSignalMetricsV1;
  /** Absent on analyses produced before annotation checks existed. */
  annotations?: ToolAnnotationMetricsV1;
}

export interface ToolSurfaceFingerprintV1 {
  algorithm: 'fnv1a-64-v1';
  value: string;
  canonicalBytes: number;
}

export interface ToolDefinitionSnapshotV1 {
  name: string;
  description?: string;
  inputSchema: unknown;
}

/**
 * A bounded copy of the contracts used for local semantic drift comparisons.
 * `partial` means at least one definition could not be retained losslessly, so
 * callers must report unknown instead of inferring removals from this list.
 */
export interface ToolDefinitionSnapshotSetV1 {
  status: 'complete' | 'partial' | 'unavailable';
  tools: ToolDefinitionSnapshotV1[];
}

export type ToolSurfaceFindingsBySeverityV1 = Record<
  ToolSurfaceSeverity,
  ToolSurfaceFindingV1[]
>;

export interface ToolSurfaceAnalysisV1 {
  version: ToolSurfaceAnalysisVersion;
  metrics: ToolSurfaceMetricsV1;
  fingerprint: ToolSurfaceFingerprintV1;
  toolDefinitions: ToolDefinitionSnapshotSetV1;
  /** Per-tool and per-parameter breakdown; absent from reports made before it existed. */
  contextCost?: ToolContextCostV1;
  findings: ToolSurfaceFindingsBySeverityV1;
  findingCount: number;
  interpretation: string;
}

export type ToolSurfaceDiscoveryCapability = 'tools' | 'resources' | 'prompts';

/**
 * The analyzer accepts a raw tools array, a tools/list-shaped result, or a
 * capability snapshot containing resources/prompts but no tools.
 */
export type ToolSurfaceAnalyzerInput =
  | readonly unknown[]
  | {
      tools?: unknown;
      resources?: unknown;
      prompts?: unknown;
      nextCursor?: string;
      incompleteDiscovery?: readonly ToolSurfaceDiscoveryCapability[];
    }
  | null
  | undefined;
