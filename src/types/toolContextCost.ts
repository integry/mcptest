/**
 * Estimated context cost of MCP tool definitions, per tool and per part.
 *
 * Every number is an estimate produced by the method named in `method`; none
 * is an exact token count for any specific model. Field names avoid the word
 * "token" on purpose: report redaction treats such keys as credentials.
 */
export const TOOL_CONTEXT_COST_VERSION = '1.0.0' as const;

export interface ToolContextCostMethodV1 {
  /** Stable identifier; deltas are only computed between equal methods. */
  id: string;
  /** Short label shown next to every number, e.g. "estimated tokens". */
  label: string;
  /** One or two sentences on how the estimate is made and how accurate it is. */
  description: string;
}

/**
 * The estimate of one tool split by where it comes from. The six parts always
 * add up to the tool's `estimate`.
 */
export interface ToolContextCostPartsV1 {
  /** `name`, `title` and `description`. */
  nameDescription: number;
  /** Every top-level `inputSchema.properties` entry. */
  parameters: number;
  /** The rest of `inputSchema`: type, required, $defs, additionalProperties… */
  inputSchema: number;
  outputSchema: number;
  annotations: number;
  /** Other fields (`_meta`, `icons`…) and the JSON punctuation that joins the parts. */
  other: number;
}

export interface ToolContextCostParameterV1 {
  name: string;
  estimate: number;
  required: boolean;
}

export interface ToolContextCostToolV1 {
  name: string;
  estimate: number;
  /** Fraction of the surface total, 0–1. */
  share: number;
  parts: ToolContextCostPartsV1;
  /** Heaviest first; bounded, see `omittedParameterCount`. */
  parameters: ToolContextCostParameterV1[];
  parameterCount: number;
  omittedParameterCount: number;
}

export type ToolContextCostFindingSeverity = 'high' | 'medium' | 'low' | 'info';

export type ToolContextCostFindingId =
  | 'context-cost.total-above-threshold'
  | 'context-cost.dominant-tool'
  | 'context-cost.heavy-tool'
  | 'context-cost.dominant-parameter'
  | 'context-cost.redundant-enum-text';

export interface ToolContextCostFindingV1 {
  id: ToolContextCostFindingId;
  severity: ToolContextCostFindingSeverity;
  title: string;
  summary: string;
  /** The tool, or `tool.parameter`, the finding is about; absent for surface-wide findings. */
  subject?: string;
  remediation: string;
}

export interface ToolContextCostV1 {
  version: typeof TOOL_CONTEXT_COST_VERSION;
  method: ToolContextCostMethodV1;
  /** Sum of every tool's estimate, including tools omitted from `tools`. */
  estimatedTotal: number;
  toolCount: number;
  medianPerTool: number;
  /** Heaviest first; bounded, see `omittedToolCount`. */
  tools: ToolContextCostToolV1[];
  omittedToolCount: number;
  /**
   * Set when the tools/list result the estimate came from was itself
   * incomplete (a later page failed, a cursor was left unfollowed, or analysis
   * limits dropped definitions): `estimatedTotal` covers only the tools
   * received, and a tool missing here may still exist on the server.
   */
  listingIncomplete?: true;
  findings: ToolContextCostFindingV1[];
}

export type ToolContextCostDeltaStatus = 'added' | 'removed' | 'changed';

export interface ToolContextCostToolDeltaV1 {
  name: string;
  status: ToolContextCostDeltaStatus;
  before: number;
  after: number;
  delta: number;
}

export interface ToolContextCostDeltaV1 {
  method: ToolContextCostMethodV1;
  before: number;
  after: number;
  delta: number;
  /** Fractional change of the total, or null when the earlier total was 0. */
  relativeChange: number | null;
  /** Largest absolute change first; bounded, see `omittedToolCount`. */
  tools: ToolContextCostToolDeltaV1[];
  omittedToolCount: number;
  /**
   * False when either side kept only part of its per-tool list, came from an
   * incomplete tools/list, or the two were obtained with different access;
   * added and removed tools are then not listed.
   */
  complete: boolean;
  /** What the estimate covers when it is narrower than full definitions. */
  limitation?: string;
}
