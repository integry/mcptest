/**
 * Context cost of MCP tool definitions: an estimate of how many tokens the
 * tools/list result adds to a model's context, broken down per tool and,
 * within a tool, per part (name + description, each top-level input
 * parameter, the rest of the input schema, the output schema, annotations).
 *
 * Choice of method (issue #565). A real tokenizer was evaluated and rejected:
 * the public BPE tokenizers ship 1–2 MB of vocabulary data, which is not
 * dependency-light, and none matches every model an MCP client may use (the
 * tokenizers of several hosted models are not public). Instead this module
 * uses a lexical approximation calibrated on JSON schema text: it counts word
 * pieces (splitting camelCase), digit groups, punctuation and non-ASCII
 * characters with weights fitted against two public BPE tokenizers
 * (cl100k_base and o200k_base) on ~600 tool definitions from the catalog plus
 * enum- and nesting-heavy synthetic schemas. On that corpus the per-parameter
 * mean error is about 5% and the total within 5%, where bytes / 4 overestimated
 * by 12–17%. Other models tokenize differently, so every number is labelled an
 * estimate and the method is stored with it; it is never an exact count.
 *
 * The module imports nothing but its own types, so the CLI, the Worker and
 * the browser all bundle the same few kilobytes and agree on every estimate.
 */
import {
  TOOL_CONTEXT_COST_VERSION,
  type ToolContextCostDeltaV1,
  type ToolContextCostFindingV1,
  type ToolContextCostMethodV1,
  type ToolContextCostParameterV1,
  type ToolContextCostPartsV1,
  type ToolContextCostToolDeltaV1,
  type ToolContextCostToolV1,
  type ToolContextCostV1,
} from '../types/toolContextCost';

export const CONTEXT_COST_METHOD: ToolContextCostMethodV1 = {
  id: 'lexical-json-v1',
  label: 'estimated tokens',
  description: 'Estimated from the compact JSON of each definition by counting word pieces, digit groups and punctuation, calibrated against public BPE tokenizers on MCP tool schemas (typically within 5–10%). Different models tokenize differently, so this is an estimate, not an exact count for any model.',
};

/**
 * Documented thresholds for context-cost findings. The total thresholds match
 * the tool-surface analysis (`context.large-tool-surface`).
 */
export const CONTEXT_COST_THRESHOLDS = {
  /** Estimated total for a low, medium and high finding. */
  total: { low: 4_000, medium: 8_000, high: 20_000 },
  /** A tool holding at least this share of the total dominates it… */
  dominantToolShare: 0.25,
  /** …when the server has at least this many tools… */
  dominantToolMinimumTools: 3,
  /** …and the total is at least this large. */
  dominantMinimumTotal: 1_000,
  /** A tool this large is heavy whatever its share. */
  heavyTool: 2_000,
  /** A parameter this large dominates when it is also half its tool or a tenth of the total. */
  dominantParameter: 300,
  dominantParameterShareOfTool: 0.5,
  dominantParameterShareOfTotal: 0.1,
  /** Enum values a description must repeat before the text is called redundant. */
  redundantEnumValues: 3,
} as const;

/** Stored lists stay bounded so reports remain small; totals always cover everything. */
export const DEFAULT_CONTEXT_COST_TOOL_LIMIT = 50;
export const DEFAULT_CONTEXT_COST_PARAMETER_LIMIT = 12;
const MAX_FINDINGS_PER_KIND = 5;
const MAX_NAME_LENGTH = 200;
/** Longer strings are sampled: the prefix is scanned and the result scaled. */
const MAX_SCANNED_CHARACTERS = 100_000;

// Weights fitted by least squares; see the module comment.
const WORD_PIECE = 1.15;
const LONG_WORD_LETTER = 0.05;
const LONG_WORD_FROM = 6;
const DIGIT_GROUP = 1.75;
const WHITESPACE_RUN = 1;
const NON_ASCII_CHARACTER = 1.1;
const PUNCTUATION_CHARACTER = 0.33;

const LEXEME = /[A-Za-z]+|[0-9]+|\s+|[\x21-\x2f\x3a-\x40\x5b-\x60\x7b-\x7e]+|[^\x00-\x7f]/gu;
const CAMEL_BOUNDARY = /(?<=[a-z])(?=[A-Z])/;

const scanText = (text: string): number => {
  let estimate = 0;
  for (const match of text.matchAll(LEXEME)) {
    const lexeme = match[0];
    const first = lexeme.charCodeAt(0);
    if ((first >= 65 && first <= 90) || (first >= 97 && first <= 122)) {
      for (const piece of lexeme.split(CAMEL_BOUNDARY)) {
        estimate += WORD_PIECE + Math.max(0, piece.length - LONG_WORD_FROM) * LONG_WORD_LETTER;
      }
    } else if (first >= 48 && first <= 57) {
      estimate += Math.ceil(lexeme.length / 3) * DIGIT_GROUP;
    } else if (/^\s/.test(lexeme)) {
      // A single space joins the next word piece in BPE vocabularies.
      if (lexeme !== ' ') estimate += WHITESPACE_RUN;
    } else if (first > 0x7f) {
      estimate += NON_ASCII_CHARACTER;
    } else {
      estimate += lexeme.length * PUNCTUATION_CHARACTER;
    }
  }
  return estimate;
};

/** Unrounded estimate for one string; parts are rounded once, after summing. */
const rawTextEstimate = (text: string): number => {
  if (text.length <= MAX_SCANNED_CHARACTERS) return scanText(text);
  return scanText(text.slice(0, MAX_SCANNED_CHARACTERS)) * (text.length / MAX_SCANNED_CHARACTERS);
};

const roundPart = (value: number, nonEmpty: boolean): number => (
  nonEmpty ? Math.max(1, Math.round(value)) : 0
);

/** Estimated tokens of a piece of text with {@link CONTEXT_COST_METHOD}. */
export const estimateTextTokens = (text: string): number => roundPart(rawTextEstimate(text), text.length > 0);

const isRecord = (value: unknown): value is Record<string, unknown> => (
  Boolean(value) && typeof value === 'object' && !Array.isArray(value)
);

const json = (value: unknown): string => {
  try {
    return JSON.stringify(value) ?? 'null';
  } catch {
    return String(value);
  }
};

const NAME_DESCRIPTION_KEYS = new Set(['name', 'title', 'description']);

interface ParameterMeasure extends ToolContextCostParameterV1 {
  schema: unknown;
}

interface ToolMeasure {
  name: string;
  estimate: number;
  parts: ToolContextCostPartsV1;
  parameters: ParameterMeasure[];
}

const toolName = (value: unknown, index: number): string => {
  const name = isRecord(value) && typeof value.name === 'string' && value.name.trim()
    ? value.name
    : `<tool ${index + 1}>`;
  return name.length > MAX_NAME_LENGTH ? `${name.slice(0, MAX_NAME_LENGTH - 1)}…` : name;
};

/**
 * Splits one definition into strings whose concatenation is its compact JSON,
 * estimates each, and rounds per part, so parts always add up to the tool.
 */
const measureTool = (definition: unknown, index: number): ToolMeasure => {
  const name = toolName(definition, index);
  const raw: Record<keyof ToolContextCostPartsV1, number> = {
    nameDescription: 0, parameters: 0, inputSchema: 0, outputSchema: 0, annotations: 0, other: 0,
  };
  const present: Record<keyof ToolContextCostPartsV1, boolean> = {
    nameDescription: false, parameters: false, inputSchema: false, outputSchema: false, annotations: false, other: false,
  };
  const add = (part: keyof ToolContextCostPartsV1, text: string) => {
    if (!text) return;
    raw[part] += rawTextEstimate(text);
    present[part] = true;
  };
  const parameters: ParameterMeasure[] = [];

  if (!isRecord(definition)) {
    add('other', json(definition));
  } else {
    const entries = Object.entries(definition).filter(([, value]) => value !== undefined);
    add('other', `{${','.repeat(Math.max(0, entries.length - 1))}}`);
    for (const [key, value] of entries) {
      const prefix = `${json(key)}:`;
      if (NAME_DESCRIPTION_KEYS.has(key)) {
        add('nameDescription', `${prefix}${json(value)}`);
      } else if (key === 'inputSchema' && isRecord(value) && isRecord(value.properties)) {
        const properties = Object.entries(value.properties).filter(([, schema]) => schema !== undefined);
        const required = new Set(Array.isArray(value.required)
          ? value.required.filter((item): item is string => typeof item === 'string')
          : []);
        const rest = json({ ...value, properties: {} });
        add('inputSchema', `${prefix}${rest}${','.repeat(Math.max(0, properties.length - 1))}`);
        for (const [parameter, schema] of properties) {
          const text = `${json(parameter)}:${json(schema)}`;
          const estimate = roundPart(rawTextEstimate(text), true);
          parameters.push({ name: parameter, estimate, required: required.has(parameter), schema });
        }
      } else if (key === 'inputSchema') {
        add('inputSchema', `${prefix}${json(value)}`);
      } else if (key === 'outputSchema') {
        add('outputSchema', `${prefix}${json(value)}`);
      } else if (key === 'annotations') {
        add('annotations', `${prefix}${json(value)}`);
      } else {
        add('other', `${prefix}${json(value)}`);
      }
    }
  }

  const parts: ToolContextCostPartsV1 = {
    nameDescription: roundPart(raw.nameDescription, present.nameDescription),
    // Each parameter is rounded on its own so the detail rows add up to this part.
    parameters: parameters.reduce((sum, parameter) => sum + parameter.estimate, 0),
    inputSchema: roundPart(raw.inputSchema, present.inputSchema),
    outputSchema: roundPart(raw.outputSchema, present.outputSchema),
    annotations: roundPart(raw.annotations, present.annotations),
    other: roundPart(raw.other, present.other),
  };
  parameters.sort((left, right) => right.estimate - left.estimate || compareText(left.name, right.name));
  return { name, estimate: sumParts(parts), parts, parameters };
};

/** Sum of the six parts; equals the tool's `estimate` for every computed tool. */
export const sumParts = (parts: ToolContextCostPartsV1): number => (
  parts.nameDescription + parts.parameters + parts.inputSchema
  + parts.outputSchema + parts.annotations + parts.other
);

const compareText = (left: string, right: string): number => (left < right ? -1 : left > right ? 1 : 0);

export const median = (values: readonly number[]): number => {
  if (values.length === 0) return 0;
  const sorted = [...values].sort((left, right) => left - right);
  const middle = Math.floor(sorted.length / 2);
  return sorted.length % 2 === 1
    ? sorted[middle]
    : Math.round((sorted[middle - 1] + sorted[middle]) / 2);
};

const share = (part: number, total: number): number => (total > 0 ? Math.round((part / total) * 10_000) / 10_000 : 0);

export const formatEstimate = (value: number): string => `≈${Math.round(value).toLocaleString('en-US')}`;

export const formatShare = (value: number): string => {
  const percent = value * 100;
  if (percent > 0 && percent < 1) return '<1%';
  return `${Math.round(percent)}%`;
};

const formatSigned = (value: number): string => (
  value > 0 ? `+${value.toLocaleString('en-US')}` : value < 0 ? `−${Math.abs(value).toLocaleString('en-US')}` : '±0'
);

const escapeRegExp = (value: string): string => value.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');

/** Enum values (top-level or of array items) that the parameter's own description repeats. */
const repeatedEnumValues = (schema: unknown): string[] => {
  if (!isRecord(schema) || typeof schema.description !== 'string') return [];
  const values = Array.isArray(schema.enum)
    ? schema.enum
    : isRecord(schema.items) && Array.isArray(schema.items.enum) ? schema.items.enum : [];
  const description = schema.description.toLowerCase();
  return values
    .filter((value): value is string => typeof value === 'string' && value.length >= 2)
    .filter((value) => new RegExp(`(^|[^a-z0-9_])${escapeRegExp(value.toLowerCase())}($|[^a-z0-9_])`).test(description));
};

const TOTAL_REMEDIATION = 'Expose only the tools a task needs: split rarely used tools into a separate server or namespaced subset, or defer them behind discovery. Then shorten the heaviest descriptions and remove enum lists that the prose repeats.';

const createFindings = (measures: readonly ToolMeasure[], total: number): ToolContextCostFindingV1[] => {
  const findings: ToolContextCostFindingV1[] = [];
  const thresholds = CONTEXT_COST_THRESHOLDS;
  const totalSeverity = total >= thresholds.total.high ? 'high'
    : total >= thresholds.total.medium ? 'medium'
      : total >= thresholds.total.low ? 'low' : null;
  if (totalSeverity) {
    const threshold = thresholds.total[totalSeverity];
    findings.push({
      id: 'context-cost.total-above-threshold',
      severity: totalSeverity,
      title: 'Tool definitions use a large share of the context window',
      summary: `${measures.length} tool definitions are ${formatEstimate(total)} ${CONTEXT_COST_METHOD.label}, at or above the ${threshold.toLocaleString('en-US')} threshold. Clients add them to every request before the user says anything.`,
      remediation: TOTAL_REMEDIATION,
    });
  }

  const ranked = [...measures].sort((left, right) => right.estimate - left.estimate || compareText(left.name, right.name));
  let toolFindings = 0;
  for (const tool of ranked) {
    if (toolFindings >= MAX_FINDINGS_PER_KIND) break;
    const toolShare = share(tool.estimate, total);
    const dominant = measures.length >= thresholds.dominantToolMinimumTools
      && total >= thresholds.dominantMinimumTotal
      && toolShare >= thresholds.dominantToolShare;
    if (!dominant && tool.estimate < thresholds.heavyTool) continue;
    const heaviestPart = tool.parts.parameters >= tool.parts.nameDescription
      ? (tool.parameters[0] ? `its largest parameter is ${tool.parameters[0].name} (${formatEstimate(tool.parameters[0].estimate)})` : 'most of it is input schema')
      : 'most of it is the description';
    findings.push({
      id: dominant ? 'context-cost.dominant-tool' : 'context-cost.heavy-tool',
      severity: dominant && toolShare >= 0.5 ? 'medium' : 'low',
      title: dominant ? `${tool.name} dominates the context cost` : `${tool.name} is a heavy tool definition`,
      summary: dominant
        ? `${tool.name} is ${formatEstimate(tool.estimate)} ${CONTEXT_COST_METHOD.label}, ${formatShare(toolShare)} of the ${measures.length}-tool total; ${heaviestPart}.`
        : `${tool.name} is ${formatEstimate(tool.estimate)} ${CONTEXT_COST_METHOD.label} on its own; ${heaviestPart}.`,
      subject: tool.name,
      remediation: 'Shorten the description and move long examples to documentation, drop enum values repeated in prose, and split the tool into focused tools or defer it if it is rarely used.',
    });
    toolFindings += 1;
  }

  const parameters = measures.flatMap((tool) => tool.parameters.map((parameter) => ({ tool, parameter })))
    .sort((left, right) => right.parameter.estimate - left.parameter.estimate
      || compareText(left.tool.name, right.tool.name)
      || compareText(left.parameter.name, right.parameter.name));
  let parameterFindings = 0;
  for (const { tool, parameter } of parameters) {
    if (parameterFindings >= MAX_FINDINGS_PER_KIND || parameter.estimate < thresholds.dominantParameter) break;
    const ofTool = share(parameter.estimate, tool.estimate);
    const ofTotal = share(parameter.estimate, total);
    if (ofTool < thresholds.dominantParameterShareOfTool && ofTotal < thresholds.dominantParameterShareOfTotal) continue;
    findings.push({
      id: 'context-cost.dominant-parameter',
      severity: 'low',
      title: `Parameter ${parameter.name} of ${tool.name} is unusually large`,
      summary: `${tool.name}.${parameter.name} is ${formatEstimate(parameter.estimate)} ${CONTEXT_COST_METHOD.label}: ${formatShare(ofTool)} of its tool and ${formatShare(ofTotal)} of the total.`,
      subject: `${tool.name}.${parameter.name}`,
      remediation: 'Shorten the parameter description, remove allowed values the enum already lists, and flatten or simplify deeply nested object schemas.',
    });
    parameterFindings += 1;
  }

  const redundant = measures.flatMap((tool) => tool.parameters
    .map((parameter) => ({ tool, parameter, repeated: repeatedEnumValues(parameter.schema) }))
    .filter(({ repeated }) => repeated.length >= thresholds.redundantEnumValues));
  if (redundant.length > 0) {
    const examples = redundant.slice(0, MAX_FINDINGS_PER_KIND).map(({ tool, parameter }) => `${tool.name}.${parameter.name}`);
    findings.push({
      id: 'context-cost.redundant-enum-text',
      severity: 'info',
      title: 'Descriptions repeat their enum values',
      summary: `${redundant.length} parameter${redundant.length === 1 ? '' : 's'} list the allowed values in both enum and the description (${examples.join(', ')}${redundant.length > examples.length ? ', …' : ''}).`,
      ...(redundant.length === 1 ? { subject: examples[0] } : {}),
      remediation: 'Keep the enum and describe only what the values mean; models read the enum, so the repeated list costs context without adding information.',
    });
  }
  return findings;
};

export interface ToolContextCostOptions {
  /** Tools kept in `tools` (heaviest first); the totals still cover all. */
  toolLimit?: number;
  /** Parameters kept per tool (heaviest first). */
  parameterLimit?: number;
  /** False when `definitions` is not the complete tools/list (see `listingIncomplete`). */
  listingComplete?: boolean;
}

/**
 * Estimates the context cost of a tools/list result. Accepts raw tool
 * definitions; non-object entries are counted as-is.
 */
export const computeToolContextCost = (
  definitions: readonly unknown[],
  options: ToolContextCostOptions = {}
): ToolContextCostV1 => {
  const toolLimit = options.toolLimit ?? DEFAULT_CONTEXT_COST_TOOL_LIMIT;
  const parameterLimit = options.parameterLimit ?? DEFAULT_CONTEXT_COST_PARAMETER_LIMIT;
  const measures = definitions.map(measureTool);
  const total = measures.reduce((sum, tool) => sum + tool.estimate, 0);
  const ranked = [...measures].sort((left, right) => right.estimate - left.estimate || compareText(left.name, right.name));
  const tools: ToolContextCostToolV1[] = ranked.slice(0, toolLimit).map((tool) => ({
    name: tool.name,
    estimate: tool.estimate,
    share: share(tool.estimate, total),
    parts: tool.parts,
    parameters: tool.parameters.slice(0, parameterLimit).map(({ name, estimate, required }) => ({ name, estimate, required })),
    parameterCount: tool.parameters.length,
    omittedParameterCount: Math.max(0, tool.parameters.length - parameterLimit),
  }));
  return {
    version: TOOL_CONTEXT_COST_VERSION,
    method: CONTEXT_COST_METHOD,
    estimatedTotal: total,
    toolCount: measures.length,
    medianPerTool: median(measures.map((tool) => tool.estimate)),
    tools,
    omittedToolCount: measures.length - tools.length,
    ...(options.listingComplete === false ? { listingIncomplete: true as const } : {}),
    findings: createFindings(measures, total),
  };
};

/** Per-tool estimates by name; duplicate names add up. */
const estimatesByName = (cost: ToolContextCostV1): Map<string, number> => {
  const byName = new Map<string, number>();
  for (const tool of cost.tools) byName.set(tool.name, (byName.get(tool.name) ?? 0) + tool.estimate);
  return byName;
};

export const DEFAULT_CONTEXT_COST_DELTA_LIMIT = 25;

/**
 * Before/after change of two estimates made with the same method: the total
 * and each tool whose estimate changed. Returns undefined when the methods
 * differ, since their numbers are not comparable.
 */
export const diffToolContextCost = (
  before: ToolContextCostV1,
  after: ToolContextCostV1,
  options: {
    toolLimit?: number;
    limitation?: string;
    /** False when the definitions an estimate came from were themselves incomplete. */
    beforeComplete?: boolean;
    afterComplete?: boolean;
  } = {}
): ToolContextCostDeltaV1 | undefined => {
  if (before.method.id !== after.method.id) return undefined;
  const left = estimatesByName(before);
  const right = estimatesByName(after);
  const beforeComplete = before.omittedToolCount === 0 && before.listingIncomplete !== true
    && options.beforeComplete !== false;
  const afterComplete = after.omittedToolCount === 0 && after.listingIncomplete !== true
    && options.afterComplete !== false;
  const incompleteSides = [
    ...(before.listingIncomplete === true ? ['earlier'] : []),
    ...(after.listingIncomplete === true ? ['later'] : []),
  ];
  const limitation = [
    incompleteSides.length > 0
      ? `Tool discovery for the ${incompleteSides.join(' and ')} listing did not complete, so its total covers only the tools received and added or removed tools are not listed.`
      : '',
    options.limitation ?? '',
  ].filter(Boolean).join(' ');
  const changes: ToolContextCostToolDeltaV1[] = [];
  for (const name of new Set([...left.keys(), ...right.keys()])) {
    const earlier = left.get(name);
    const later = right.get(name);
    if (earlier !== undefined && later !== undefined) {
      if (earlier !== later) changes.push({ name, status: 'changed', before: earlier, after: later, delta: later - earlier });
    } else if (later !== undefined && beforeComplete) {
      changes.push({ name, status: 'added', before: 0, after: later, delta: later });
    } else if (earlier !== undefined && afterComplete) {
      changes.push({ name, status: 'removed', before: earlier, after: 0, delta: -earlier });
    }
    // Otherwise the tool may sit in the other side's omitted tail: not comparable.
  }
  changes.sort((first, second) => Math.abs(second.delta) - Math.abs(first.delta) || compareText(first.name, second.name));
  const toolLimit = options.toolLimit ?? DEFAULT_CONTEXT_COST_DELTA_LIMIT;
  const delta = after.estimatedTotal - before.estimatedTotal;
  return {
    method: after.method,
    before: before.estimatedTotal,
    after: after.estimatedTotal,
    delta,
    relativeChange: before.estimatedTotal > 0 ? Math.round((delta / before.estimatedTotal) * 10_000) / 10_000 : null,
    tools: changes.slice(0, toolLimit),
    omittedToolCount: Math.max(0, changes.length - toolLimit),
    complete: beforeComplete && afterComplete,
    ...(limitation ? { limitation } : {}),
  };
};

/** "≈1,200 → ≈1,450 estimated tokens (+250, +21%)". */
export const describeContextCostDelta = (delta: ToolContextCostDeltaV1): string => {
  const relative = delta.relativeChange === null || delta.delta === 0
    ? ''
    : `, ${delta.relativeChange > 0 ? '+' : '−'}${formatShare(Math.abs(delta.relativeChange))}`;
  return `${formatEstimate(delta.before)} → ${formatEstimate(delta.after)} ${delta.method.label} (${formatSigned(delta.delta)}${relative})`;
};

/** "search: ≈120 → ≈340 (+220)", "close_issue: added (≈95, +95)". */
export const describeToolContextCostDelta = (tool: ToolContextCostToolDeltaV1): string => {
  if (tool.status === 'added') return `${tool.name}: added (${formatEstimate(tool.after)}, ${formatSigned(tool.delta)})`;
  if (tool.status === 'removed') return `${tool.name}: removed (${formatEstimate(tool.before)}, ${formatSigned(tool.delta)})`;
  return `${tool.name}: ${formatEstimate(tool.before)} → ${formatEstimate(tool.after)} (${formatSigned(tool.delta)})`;
};

/** Lines for terminals and Markdown: totals, then the heaviest `top` tools with their share. */
export const contextCostSummaryLines = (cost: ToolContextCostV1, top = 5): string[] => [
  `Total: ${formatEstimate(cost.estimatedTotal)} ${cost.method.label} across ${cost.toolCount} tool${cost.toolCount === 1 ? '' : 's'}${cost.listingIncomplete === true ? ' received (tool discovery did not complete, so the server may list more)' : ''}; median ${formatEstimate(cost.medianPerTool)} per tool (method ${cost.method.id}, an estimate, not an exact count for any model).`,
  ...cost.tools.slice(0, top).map((tool, index) => (
    `${index + 1}. ${tool.name}: ${formatEstimate(tool.estimate)} (${formatShare(tool.share)})`
  )),
];

/**
 * Whether a stored value looks like a context-cost object this version can
 * render. Older reports have none; future ones may change shape.
 */
export const isToolContextCost = (value: unknown): value is ToolContextCostV1 => (
  isRecord(value)
  && typeof value.estimatedTotal === 'number'
  && typeof value.toolCount === 'number'
  && typeof value.medianPerTool === 'number'
  && typeof value.omittedToolCount === 'number'
  && Array.isArray(value.tools)
  && Array.isArray(value.findings)
  && isRecord(value.method)
  && typeof value.method.id === 'string'
  && typeof value.method.label === 'string'
);

/** The fields of a breaking-change snapshot this module reads (structural, so no import). */
export interface ContextCostSurface {
  tools: readonly {
    name: string;
    title?: string;
    description?: string;
    inputSchema?: unknown;
    outputSchema?: unknown;
    /** Present when the schema was observed; the schema itself may not be stored. */
    outputSchemaFingerprint?: string;
    annotations?: Record<string, unknown>;
  }[];
  outputSchemasObserved: boolean;
  annotationsObserved: boolean;
  titlesObserved: boolean;
  /** How the listing was obtained, when recorded. */
  authentication?: 'authenticated' | 'unauthenticated';
}

export type ContextCostAccess = 'authenticated' | 'unauthenticated';

/**
 * Limitation for two listings obtained with different access, or undefined
 * when the access is the same or not recorded on both. Servers often list
 * different tools to signed-in callers, so membership differences between
 * such listings are not server changes.
 */
export const contextCostAccessLimitation = (
  before: ContextCostAccess | undefined,
  after: ContextCostAccess | undefined
): string | undefined => (
  before && after && before !== after
    ? `The earlier listing was obtained ${before} and the later one ${after}, so the totals cover different access scopes; servers often list different tools to signed-in callers, so added and removed tools are not listed.`
    : undefined
);

/**
 * Context-cost delta between two listings compared by the breaking-change
 * checker. A field only one side recorded (titles, output schemas,
 * annotations), or a schema one side kept only as a fingerprint, is left out
 * of both, so the delta reflects the server and not what each source happened
 * to keep.
 */
export const diffSurfaceContextCost = (
  before: ContextCostSurface,
  after: ContextCostSurface
): ToolContextCostDeltaV1 | undefined => {
  const titles = before.titlesObserved && after.titlesObserved;
  const outputs = before.outputSchemasObserved && after.outputSchemasObserved;
  const annotations = before.annotationsObserved && after.annotationsObserved;
  // A snapshot over its schema budget keeps only fingerprints. For a tool both
  // sides list, a schema one side did not keep is left out of both, so the
  // delta does not count the stored schema as a server change.
  const inputUnstored = (surface: ContextCostSurface) => new Set(
    surface.tools.filter((tool) => tool.inputSchema === undefined).map((tool) => tool.name)
  );
  const outputUnstored = (surface: ContextCostSurface) => new Set(
    surface.tools
      .filter((tool) => tool.outputSchema === undefined && tool.outputSchemaFingerprint !== undefined)
      .map((tool) => tool.name)
  );
  const beforeNames = new Set(before.tools.map((tool) => tool.name));
  const afterNames = new Set(after.tools.map((tool) => tool.name));
  const shared = (left: Set<string>, right: Set<string>) => new Set(
    [...left, ...right].filter((name) => beforeNames.has(name) && afterNames.has(name))
  );
  const skipInput = shared(inputUnstored(before), inputUnstored(after));
  const skipOutput = shared(outputUnstored(before), outputUnstored(after));
  const definitions = (surface: ContextCostSurface) => surface.tools.map((tool) => ({
    name: tool.name,
    ...(titles && tool.title !== undefined ? { title: tool.title } : {}),
    ...(tool.description !== undefined ? { description: tool.description } : {}),
    ...(tool.inputSchema !== undefined && !skipInput.has(tool.name) ? { inputSchema: tool.inputSchema } : {}),
    ...(outputs && tool.outputSchema !== undefined && !skipOutput.has(tool.name) ? { outputSchema: tool.outputSchema } : {}),
    ...(annotations && tool.annotations !== undefined ? { annotations: tool.annotations } : {}),
  }));
  const omitted = [
    ...(titles ? [] : ['titles']),
    ...(outputs ? [] : ['output schemas']),
    ...(annotations ? [] : ['annotations']),
  ];
  const accessLimitation = contextCostAccessLimitation(before.authentication, after.authentication);
  const missingSchemas = skipInput.size > 0 || skipOutput.size > 0
    || [...before.tools, ...after.tools].some((tool) => tool.inputSchema === undefined);
  const limitation = [
    omitted.length > 0
      ? `Only one listing recorded ${omitted.join(' and ')}, so they are left out of both estimates.`
      : '',
    missingSchemas
      ? 'Some schemas were stored only as fingerprints; for tools both listings include, those schemas are left out of both estimates, so a schema change there does not show in the context cost.'
      : '',
    accessLimitation ?? '',
  ].filter(Boolean).join(' ');
  return diffToolContextCost(
    computeToolContextCost(definitions(before), { toolLimit: Number.POSITIVE_INFINITY }),
    computeToolContextCost(definitions(after), { toolLimit: Number.POSITIVE_INFINITY }),
    {
      ...(limitation ? { limitation } : {}),
      ...(accessLimitation ? { beforeComplete: false, afterComplete: false } : {}),
    }
  );
};
