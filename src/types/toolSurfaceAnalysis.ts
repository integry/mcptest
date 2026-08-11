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
  | 'prompt-like-description';

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

export interface ToolSurfaceMetricsV1 {
  toolListStatus: 'present' | 'empty' | 'missing' | 'malformed';
  toolCount: number;
  validToolCount: number;
  malformedToolCount: number;
  resourceCount: number;
  promptCount: number;
  serializedDefinitionBytes: number;
  estimatedContextTokens: number;
  descriptions: ToolDescriptionMetricsV1;
  schemas: ToolSchemaMetricsV1;
  ambiguity: ToolAmbiguityMetricsV1;
  riskSignals: ToolRiskSignalMetricsV1;
}

export interface ToolSurfaceFingerprintV1 {
  algorithm: 'fnv1a-64-v1';
  value: string;
  canonicalBytes: number;
}

export type ToolSurfaceFindingsBySeverityV1 = Record<
  ToolSurfaceSeverity,
  ToolSurfaceFindingV1[]
>;

export interface ToolSurfaceAnalysisV1 {
  version: ToolSurfaceAnalysisVersion;
  metrics: ToolSurfaceMetricsV1;
  fingerprint: ToolSurfaceFingerprintV1;
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
