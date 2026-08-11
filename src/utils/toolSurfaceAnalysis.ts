import {
  TOOL_SURFACE_ANALYSIS_VERSION,
  type ToolSurfaceAnalysisV1,
  type ToolSurfaceAnalyzerInput,
  type ToolSurfaceEvidenceV1,
  type ToolSurfaceFindingCategory,
  type ToolSurfaceFindingKind,
  type ToolSurfaceFindingV1,
  type ToolSurfaceFindingsBySeverityV1,
  type ToolSurfaceSeverity,
} from '../types/toolSurfaceAnalysis';

const EVIDENCE_LIMIT = 12;
const SHORT_DESCRIPTION_CHARACTERS = 24;
const LONG_DESCRIPTION_CHARACTERS = 1_000;

const SEVERITIES: readonly ToolSurfaceSeverity[] = [
  'critical',
  'high',
  'medium',
  'low',
  'info',
];

const GENERIC_DESCRIPTIONS = new Set([
  'a tool',
  'does stuff',
  'performs an action',
  'performs a task',
  'tool',
  'useful tool',
]);

const NAME_STOP_WORDS = new Set(['a', 'an', 'and', 'by', 'for', 'of', 'the', 'to']);
const DESCRIPTION_STOP_WORDS = new Set([
  ...NAME_STOP_WORDS,
  'allows',
  'from',
  'in',
  'is',
  'it',
  'on',
  'that',
  'this',
  'tool',
  'use',
  'used',
  'using',
  'with',
]);

const READ_ACTIONS = new Set([
  'check',
  'describe',
  'find',
  'get',
  'inspect',
  'list',
  'lookup',
  'read',
  'search',
  'show',
  'view',
]);

const WRITE_ACTIONS = new Set([
  'add',
  'approve',
  'archive',
  'assign',
  'cancel',
  'create',
  'deploy',
  'edit',
  'execute',
  'grant',
  'import',
  'install',
  'invite',
  'modify',
  'move',
  'publish',
  'rename',
  'run',
  'send',
  'set',
  'submit',
  'transfer',
  'update',
  'upload',
  'write',
]);

const DESTRUCTIVE_ACTIONS = new Set([
  'delete',
  'destroy',
  'disable',
  'drop',
  'erase',
  'kill',
  'overwrite',
  'purge',
  'remove',
  'reset',
  'revoke',
  'terminate',
  'truncate',
  'uninstall',
  'wipe',
]);

const NEGATIONS = new Set(['avoid', 'cannot', 'never', 'no', 'not', 'prevent', 'without']);

const DESCRIPTION_ACTION_FORMS: Readonly<Record<string, string>> = {
  adds: 'add',
  adding: 'add',
  approves: 'approve',
  approving: 'approve',
  archives: 'archive',
  archiving: 'archive',
  assigns: 'assign',
  assigning: 'assign',
  cancels: 'cancel',
  cancelling: 'cancel',
  creates: 'create',
  creating: 'create',
  deletes: 'delete',
  deleting: 'delete',
  deploys: 'deploy',
  deploying: 'deploy',
  destroys: 'destroy',
  destroying: 'destroy',
  disables: 'disable',
  disabling: 'disable',
  drops: 'drop',
  dropping: 'drop',
  edits: 'edit',
  editing: 'edit',
  erases: 'erase',
  erasing: 'erase',
  executes: 'execute',
  executing: 'execute',
  grants: 'grant',
  granting: 'grant',
  imports: 'import',
  importing: 'import',
  installs: 'install',
  installing: 'install',
  invites: 'invite',
  inviting: 'invite',
  kills: 'kill',
  killing: 'kill',
  modifies: 'modify',
  modifying: 'modify',
  moves: 'move',
  moving: 'move',
  overwrites: 'overwrite',
  overwriting: 'overwrite',
  publishes: 'publish',
  publishing: 'publish',
  purges: 'purge',
  purging: 'purge',
  removes: 'remove',
  removing: 'remove',
  renames: 'rename',
  renaming: 'rename',
  resets: 'reset',
  resetting: 'reset',
  revokes: 'revoke',
  revoking: 'revoke',
  runs: 'run',
  running: 'run',
  sends: 'send',
  sending: 'send',
  sets: 'set',
  setting: 'set',
  submits: 'submit',
  submitting: 'submit',
  terminates: 'terminate',
  terminating: 'terminate',
  transfers: 'transfer',
  transferring: 'transfer',
  truncates: 'truncate',
  truncating: 'truncate',
  uninstalls: 'uninstall',
  uninstalling: 'uninstall',
  updates: 'update',
  updating: 'update',
  uploads: 'upload',
  uploading: 'upload',
  wipes: 'wipe',
  wiping: 'wipe',
  writes: 'write',
  writing: 'write',
};

interface ToolRecord {
  index: number;
  displayName: string;
  name: string | null;
  description: string | null;
  inputSchema: unknown;
  outputSchema: unknown;
  readOnlyHint: boolean | null;
  destructiveHint: boolean | null;
  raw: unknown;
  valid: boolean;
}

interface PairEvidence {
  left: string;
  right: string;
  score: number;
}

interface SchemaAccumulator {
  schemaNodeCount: number;
  propertyCount: number;
  requiredPropertyCount: number;
  optionalPropertyCount: number;
  propertiesMissingDescriptions: number;
  unconstrainedStringCount: number;
  unconstrainedObjectCount: number;
  maximumDepth: number;
  maximumWidth: number;
  malformedToolIndexes: Set<number>;
  malformedEvidence: ToolSurfaceEvidenceV1[];
  unconstrainedEvidence: ToolSurfaceEvidenceV1[];
  missingDescriptionEvidence: ToolSurfaceEvidenceV1[];
  depthEvidence: ToolSurfaceEvidenceV1[];
  widthEvidence: ToolSurfaceEvidenceV1[];
}

interface FindingInput {
  id: string;
  category: ToolSurfaceFindingCategory;
  severity: ToolSurfaceSeverity;
  kind: ToolSurfaceFindingKind;
  title: string;
  summary: string;
  evidence: ToolSurfaceEvidenceV1[];
  remediation: string;
}

const isRecord = (value: unknown): value is Record<string, unknown> => (
  value !== null && typeof value === 'object' && !Array.isArray(value)
);

const round = (value: number, digits = 2): number => {
  const factor = 10 ** digits;
  return Math.round(value * factor) / factor;
};

const compareText = (left: string, right: string): number => (
  left < right ? -1 : left > right ? 1 : 0
);

const canonicalStringify = (value: unknown, ancestors = new Set<object>()): string => {
  if (value === null) return 'null';
  if (typeof value === 'string') return JSON.stringify(value);
  if (typeof value === 'boolean') return value ? 'true' : 'false';
  if (typeof value === 'number') return Number.isFinite(value) ? String(value) : 'null';
  if (typeof value === 'bigint') return JSON.stringify(value.toString());
  if (typeof value !== 'object') return 'null';

  if (ancestors.has(value)) return JSON.stringify('[Circular]');
  ancestors.add(value);

  let serialized: string;
  if (Array.isArray(value)) {
    serialized = `[${value.map((item) => canonicalStringify(item, ancestors)).join(',')}]`;
  } else {
    const entries = Object.keys(value as Record<string, unknown>)
      .filter((key) => {
        const item = (value as Record<string, unknown>)[key];
        return item !== undefined && typeof item !== 'function' && typeof item !== 'symbol';
      })
      .sort(compareText)
      .map((key) => `${JSON.stringify(key)}:${canonicalStringify(
        (value as Record<string, unknown>)[key],
        ancestors
      )}`);
    serialized = `{${entries.join(',')}}`;
  }

  ancestors.delete(value);
  return serialized;
};

const utf8ByteLength = (value: string): number => new TextEncoder().encode(value).length;

const fingerprint = (value: string): string => {
  let hash = 0xcbf29ce484222325n;
  const prime = 0x100000001b3n;
  const mask = 0xffffffffffffffffn;

  for (const byte of new TextEncoder().encode(value)) {
    hash ^= BigInt(byte);
    hash = (hash * prime) & mask;
  }

  return hash.toString(16).padStart(16, '0');
};

const wordTokens = (value: string): string[] => (
  value
    .replace(/([a-z0-9])([A-Z])/g, '$1 $2')
    .toLowerCase()
    .split(/[^a-z0-9]+/)
    .filter(Boolean)
);

const stemToken = (token: string): string => {
  if (token.length > 4 && token.endsWith('ies')) return `${token.slice(0, -3)}y`;
  if (token.length > 3 && token.endsWith('s') && !token.endsWith('ss')) return token.slice(0, -1);
  return token;
};

const similarityTokens = (value: string, stopWords: Set<string>): Set<string> => new Set(
  wordTokens(value)
    .filter((token) => !stopWords.has(token))
    .map(stemToken)
);

const diceSimilarity = (left: Set<string>, right: Set<string>): { score: number; overlap: number } => {
  if (left.size === 0 || right.size === 0) return { score: 0, overlap: 0 };
  let overlap = 0;
  for (const token of left) {
    if (right.has(token)) overlap += 1;
  }
  return { score: (2 * overlap) / (left.size + right.size), overlap };
};

const normalizeText = (value: string): string => value.trim().toLowerCase().replace(/\s+/g, ' ');

const displayPath = (path: string): string => path || '$';

const evidence = (tool: string, path: string, detail: string): ToolSurfaceEvidenceV1 => ({
  tool,
  path,
  detail,
});

const emptyFindings = (): ToolSurfaceFindingsBySeverityV1 => ({
  critical: [],
  high: [],
  medium: [],
  low: [],
  info: [],
});

const addFinding = (
  findings: ToolSurfaceFindingsBySeverityV1,
  input: FindingInput
): void => {
  const sortedEvidence = [...input.evidence].sort((left, right) => (
    compareText(left.tool, right.tool)
      || compareText(left.path, right.path)
      || compareText(left.detail, right.detail)
  ));
  const selectedEvidence = sortedEvidence.slice(0, EVIDENCE_LIMIT);
  findings[input.severity].push({
    ...input,
    evidence: selectedEvidence,
    omittedEvidenceCount: sortedEvidence.length - selectedEvidence.length,
  });
};

const extractTools = (input: ToolSurfaceAnalyzerInput): {
  tools: readonly unknown[];
  status: 'present' | 'empty' | 'missing' | 'malformed';
  resourceCount: number;
  promptCount: number;
} => {
  if (Array.isArray(input)) {
    return {
      tools: input,
      status: input.length > 0 ? 'present' : 'empty',
      resourceCount: 0,
      promptCount: 0,
    };
  }

  if (!isRecord(input) || input.tools === undefined) {
    return {
      tools: [],
      status: 'missing',
      resourceCount: isRecord(input) && Array.isArray(input.resources) ? input.resources.length : 0,
      promptCount: isRecord(input) && Array.isArray(input.prompts) ? input.prompts.length : 0,
    };
  }

  if (!Array.isArray(input.tools)) {
    return {
      tools: [],
      status: 'malformed',
      resourceCount: Array.isArray(input.resources) ? input.resources.length : 0,
      promptCount: Array.isArray(input.prompts) ? input.prompts.length : 0,
    };
  }

  return {
    tools: input.tools,
    status: input.tools.length > 0 ? 'present' : 'empty',
    resourceCount: Array.isArray(input.resources) ? input.resources.length : 0,
    promptCount: Array.isArray(input.prompts) ? input.prompts.length : 0,
  };
};

const normalizeTool = (raw: unknown, index: number): ToolRecord => {
  if (!isRecord(raw)) {
    return {
      index,
      displayName: `<tool #${index + 1}>`,
      name: null,
      description: null,
      inputSchema: null,
      outputSchema: null,
      readOnlyHint: null,
      destructiveHint: null,
      raw,
      valid: false,
    };
  }

  const name = typeof raw.name === 'string' && raw.name.trim() ? raw.name.trim() : null;
  const description = typeof raw.description === 'string' && raw.description.trim()
    ? raw.description.trim()
    : null;
  const inputSchema = raw.inputSchema;
  const annotations = isRecord(raw.annotations) ? raw.annotations : null;

  return {
    index,
    displayName: name || `<tool #${index + 1}>`,
    name,
    description,
    inputSchema,
    outputSchema: raw.outputSchema,
    readOnlyHint: typeof annotations?.readOnlyHint === 'boolean'
      ? annotations.readOnlyHint
      : null,
    destructiveHint: typeof annotations?.destructiveHint === 'boolean'
      ? annotations.destructiveHint
      : null,
    raw,
    valid: Boolean(name && isRecord(inputSchema)),
  };
};

const markMalformedSchema = (
  accumulator: SchemaAccumulator,
  tool: ToolRecord,
  path: string,
  detail: string
): void => {
  accumulator.malformedToolIndexes.add(tool.index);
  accumulator.malformedEvidence.push(evidence(tool.displayName, displayPath(path), detail));
};

const recordSchemaDepth = (
  accumulator: SchemaAccumulator,
  tool: ToolRecord,
  path: string,
  depth: number
): void => {
  if (depth > accumulator.maximumDepth) {
    accumulator.maximumDepth = depth;
    accumulator.depthEvidence = [evidence(
      tool.displayName,
      displayPath(path),
      `Schema reaches depth ${depth}.`
    )];
  } else if (depth === accumulator.maximumDepth) {
    accumulator.depthEvidence.push(evidence(
      tool.displayName,
      displayPath(path),
      `Schema reaches depth ${depth}.`
    ));
  }
};

const visitSchema = (
  schema: unknown,
  tool: ToolRecord,
  path: string,
  depth: number,
  accumulator: SchemaAccumulator,
  ancestors: Set<object>
): void => {
  if (typeof schema === 'boolean') {
    accumulator.schemaNodeCount += 1;
    recordSchemaDepth(accumulator, tool, path, depth);
    return;
  }

  if (!isRecord(schema)) {
    markMalformedSchema(accumulator, tool, path, 'Schema node must be an object or boolean.');
    return;
  }

  if (ancestors.has(schema)) {
    markMalformedSchema(accumulator, tool, path, 'Circular schema reference cannot be serialized as JSON.');
    return;
  }

  ancestors.add(schema);
  accumulator.schemaNodeCount += 1;
  recordSchemaDepth(accumulator, tool, path, depth);

  if (
    schema.type !== undefined
    && typeof schema.type !== 'string'
    && !(Array.isArray(schema.type) && schema.type.every((type) => typeof type === 'string'))
  ) {
    markMalformedSchema(accumulator, tool, `${path}.type`, 'Schema type must be a string or string array.');
  }

  const properties = schema.properties;
  const objectLike = schema.type === 'object' || isRecord(properties);
  if (properties !== undefined && !isRecord(properties)) {
    markMalformedSchema(accumulator, tool, `${path}.properties`, 'Schema properties must be an object.');
  }

  const requiredValue = schema.required;
  const validRequired = requiredValue === undefined
    || (Array.isArray(requiredValue) && requiredValue.every((name) => typeof name === 'string'));
  if (!validRequired) {
    markMalformedSchema(accumulator, tool, `${path}.required`, 'Schema required must be an array of property names.');
  }
  const required = new Set<string>(validRequired && Array.isArray(requiredValue) ? requiredValue : []);

  if (isRecord(properties)) {
    const propertyNames = Object.keys(properties).sort(compareText);
    const width = propertyNames.length;
    accumulator.maximumWidth = Math.max(accumulator.maximumWidth, width);
    if (width > 0) {
      accumulator.widthEvidence.push(evidence(
        tool.displayName,
        displayPath(path),
        `Object declares ${width} properties.`
      ));
    }
    accumulator.propertyCount += width;

    for (const requiredName of required) {
      if (!Object.prototype.hasOwnProperty.call(properties, requiredName)) {
        markMalformedSchema(
          accumulator,
          tool,
          `${path}.required`,
          `Required property "${requiredName}" is not declared in properties.`
        );
      }
    }

    for (const propertyName of propertyNames) {
      const propertySchema = properties[propertyName];
      if (required.has(propertyName)) accumulator.requiredPropertyCount += 1;
      else accumulator.optionalPropertyCount += 1;

      if (!isRecord(propertySchema) || typeof propertySchema.description !== 'string' || !propertySchema.description.trim()) {
        accumulator.propertiesMissingDescriptions += 1;
        accumulator.missingDescriptionEvidence.push(evidence(
          tool.displayName,
          `${path}.properties.${propertyName}`,
          `Property "${propertyName}" has no description.`
        ));
      }
      visitSchema(
        propertySchema,
        tool,
        `${path}.properties.${propertyName}`,
        depth + 1,
        accumulator,
        ancestors
      );
    }
  }

  const hasStringType = schema.type === 'string'
    || (Array.isArray(schema.type) && schema.type.includes('string'));
  if (hasStringType) {
    const hasConstraint = [
      'const',
      'enum',
      'format',
      'maxLength',
      'minLength',
      'pattern',
    ].some((key) => schema[key] !== undefined);
    if (!hasConstraint) {
      accumulator.unconstrainedStringCount += 1;
      accumulator.unconstrainedEvidence.push(evidence(
        tool.displayName,
        displayPath(path),
        'String accepts arbitrary text without a format, pattern, length, enum, or const constraint.'
      ));
    }
  }

  if (objectLike && (!isRecord(properties) || Object.keys(properties).length === 0)) {
    if (schema.additionalProperties !== false) {
      accumulator.unconstrainedObjectCount += 1;
      accumulator.unconstrainedEvidence.push(evidence(
        tool.displayName,
        displayPath(path),
        'Object accepts unspecified fields and declares no properties.'
      ));
    }
  }

  const visitChild = (key: string, child: unknown): void => {
    if (child !== undefined) {
      visitSchema(child, tool, `${path}.${key}`, depth + 1, accumulator, ancestors);
    }
  };
  visitChild('items', schema.items);
  visitChild('contains', schema.contains);
  visitChild('additionalProperties', typeof schema.additionalProperties === 'object'
    ? schema.additionalProperties
    : undefined);
  visitChild('not', schema.not);
  visitChild('if', schema.if);
  visitChild('then', schema.then);
  visitChild('else', schema.else);

  for (const keyword of ['allOf', 'anyOf', 'oneOf', 'prefixItems'] as const) {
    const children = schema[keyword];
    if (children === undefined) continue;
    if (!Array.isArray(children)) {
      markMalformedSchema(accumulator, tool, `${path}.${keyword}`, `${keyword} must be an array.`);
      continue;
    }
    children.forEach((child, index) => {
      visitSchema(child, tool, `${path}.${keyword}[${index}]`, depth + 1, accumulator, ancestors);
    });
  }

  for (const keyword of ['$defs', 'definitions', 'dependentSchemas', 'patternProperties'] as const) {
    const children = schema[keyword];
    if (children === undefined) continue;
    if (!isRecord(children)) {
      markMalformedSchema(accumulator, tool, `${path}.${keyword}`, `${keyword} must be an object.`);
      continue;
    }
    for (const key of Object.keys(children).sort(compareText)) {
      visitSchema(children[key], tool, `${path}.${keyword}.${key}`, depth + 1, accumulator, ancestors);
    }
  }

  ancestors.delete(schema);
};

const findDuplicateGroups = (
  tools: readonly ToolRecord[],
  select: (tool: ToolRecord) => string | null
): string[][] => {
  const groups = new Map<string, string[]>();
  for (const tool of tools) {
    const selected = select(tool);
    if (!selected) continue;
    const normalized = normalizeText(selected);
    const group = groups.get(normalized) || [];
    group.push(tool.displayName);
    groups.set(normalized, group);
  }
  return [...groups.values()]
    .filter((group) => group.length > 1)
    .map((group) => [...group].sort(compareText))
    .sort((left, right) => compareText(left.join('\u0000'), right.join('\u0000')));
};

const findOverlappingPairs = (
  tools: readonly ToolRecord[],
  select: (tool: ToolRecord) => string | null,
  stopWords: Set<string>,
  threshold: number,
  minimumOverlap: number
): PairEvidence[] => {
  const values = tools
    .map((tool) => {
      const selected = select(tool);
      return selected ? { tool, normalized: normalizeText(selected), tokens: similarityTokens(selected, stopWords) } : null;
    })
    .filter((value): value is NonNullable<typeof value> => Boolean(value));
  const pairs: PairEvidence[] = [];

  for (let leftIndex = 0; leftIndex < values.length; leftIndex += 1) {
    for (let rightIndex = leftIndex + 1; rightIndex < values.length; rightIndex += 1) {
      const left = values[leftIndex];
      const right = values[rightIndex];
      if (left.normalized === right.normalized) continue;
      const similarity = diceSimilarity(left.tokens, right.tokens);
      if (similarity.overlap >= minimumOverlap && similarity.score >= threshold) {
        const names = [left.tool.displayName, right.tool.displayName]
          .sort(compareText);
        pairs.push({ left: names[0], right: names[1], score: round(similarity.score, 3) });
      }
    }
  }

  return pairs.sort((left, right) => (
    compareText(left.left, right.left)
      || compareText(left.right, right.right)
      || right.score - left.score
  ));
};

const isNegatedAction = (tokens: readonly string[], index: number): boolean => {
  const preceding = tokens.slice(Math.max(0, index - 4), index);
  if (preceding.some((token) => NEGATIONS.has(token))) return true;
  const phrase = preceding.join(' ');
  return phrase.endsWith('how to') || phrase.endsWith('whether to');
};

const isActionUseOfArchive = (tokens: readonly string[], index: number): boolean => {
  const rawToken = tokens[index];
  if (['are', 'contains', 'is'].includes(tokens[index + 1])) return false;
  if (rawToken === 'archives' || rawToken === 'archiving') return true;

  const previous = tokens[index - 1];
  if (previous === 'and' || previous === 'or' || previous === 'then' || previous === 'to') {
    return true;
  }

  const preceding = tokens.slice(Math.max(0, index - 3), index);
  if (preceding.some((token) => ['from', 'in', 'of', 'through', 'within'].includes(token))) {
    return false;
  }
  if (previous === 'a' || previous === 'an' || previous === 'the') return false;
  return true;
};

const actionSignals = (tool: ToolRecord): { write: string[]; destructive: string[] } => {
  const write = new Set<string>();
  const destructive = new Set<string>();
  const nameTokens = tool.name ? wordTokens(tool.name).map(stemToken) : [];

  for (let index = 0; index < nameTokens.length; index += 1) {
    const token = nameTokens[index];
    if (
      token === 'archive'
      && nameTokens.slice(0, index).some((preceding) => READ_ACTIONS.has(preceding))
      && nameTokens[index - 1] !== 'and'
      && nameTokens[index - 1] !== 'or'
    ) continue;
    if (WRITE_ACTIONS.has(token)) write.add(token);
    if (DESTRUCTIVE_ACTIONS.has(token)) {
      destructive.add(token);
      write.add(token);
    }
  }

  const descriptionTokens = tool.description ? wordTokens(tool.description) : [];
  for (let index = 0; index < descriptionTokens.length; index += 1) {
    const rawToken = descriptionTokens[index];
    const action = DESCRIPTION_ACTION_FORMS[rawToken] || rawToken;
    if (isNegatedAction(descriptionTokens, index)) continue;
    if (action === 'archive' && !isActionUseOfArchive(descriptionTokens, index)) continue;
    if (WRITE_ACTIONS.has(action)) write.add(action);
    if (DESTRUCTIVE_ACTIONS.has(action)) {
      destructive.add(action);
      write.add(action);
    }
  }

  if (tool.readOnlyHint === true && tool.destructiveHint !== true) {
    write.clear();
    destructive.clear();
  } else {
    if (tool.readOnlyHint === false) write.add('annotation: readOnlyHint=false');
    if (tool.destructiveHint === false) {
      for (const action of destructive) write.add(action);
      destructive.clear();
    }
  }
  if (tool.destructiveHint === true) {
    destructive.add('annotation: destructiveHint=true');
    write.add('annotation: destructiveHint=true');
  }

  return {
    write: [...write].sort(compareText),
    destructive: [...destructive].sort(compareText),
  };
};

const promptLikeSignals = (description: string | null): string[] => {
  if (!description) return [];
  const patterns: Array<[string, RegExp]> = [
    ['asks the model to ignore other instructions', /\bignore\s+(?:all\s+)?(?:previous|prior|other|system)\s+(?:instructions?|prompts?|messages?)\b/i],
    ['uses a strong model-directed requirement', /\b(?:you|the assistant|the model)\s+must\b/i],
    ['uses an unconditional model-directed instruction', /\b(?:always|never)\s+(?:call|invoke|respond|reply|say|tell|use)\b/i],
    ['directs behavior before answering', /\bbefore\s+(?:answering|responding|replying)\b/i],
    ['directs the model not to disclose behavior', /\bdo\s+not\s+(?:mention|reveal|say|tell|disclose)\b/i],
  ];
  return patterns
    .filter(([, pattern]) => pattern.test(description))
    .map(([label]) => label);
};

const contextSeverity = (toolCount: number, tokenCount: number): ToolSurfaceSeverity | null => {
  if (toolCount >= 100 || tokenCount >= 20_000) return 'high';
  if (toolCount >= 40 || tokenCount >= 8_000) return 'medium';
  if (toolCount >= 20 || tokenCount >= 4_000) return 'low';
  return null;
};

/**
 * Deterministically analyzes MCP tool definitions without network, model, or API
 * calls. Findings describe observable surface signals; they are not vulnerability
 * determinations.
 */
export function analyzeToolSurface(input: ToolSurfaceAnalyzerInput): ToolSurfaceAnalysisV1 {
  const extracted = extractTools(input);
  const tools = extracted.tools.map(normalizeTool);
  const findings = emptyFindings();

  const canonicalDefinitions = tools
    .map((tool) => canonicalStringify(tool.raw))
    .sort(compareText);
  const serializedDefinitions = tools.length > 0 ? `[${canonicalDefinitions.join(',')}]` : '';
  const serializedDefinitionBytes = utf8ByteLength(serializedDefinitions);
  const estimatedContextTokens = serializedDefinitionBytes === 0
    ? 0
    : Math.ceil(serializedDefinitionBytes / 4);

  const fingerprintEntries = tools
    .map((tool) => canonicalStringify({
      description: tool.description,
      inputSchema: tool.inputSchema,
      name: tool.name,
      outputSchema: tool.outputSchema,
    }))
    .sort(compareText);
  const canonicalFingerprint = `[${fingerprintEntries.join(',')}]`;

  const malformedToolEvidence: ToolSurfaceEvidenceV1[] = [];
  for (const tool of tools) {
    if (!isRecord(tool.raw)) {
      malformedToolEvidence.push(evidence(tool.displayName, '$', 'Tool definition must be an object.'));
      continue;
    }
    if (!tool.name) {
      malformedToolEvidence.push(evidence(tool.displayName, '$.name', 'Tool name is missing or empty.'));
    }
    if (!isRecord(tool.inputSchema)) {
      malformedToolEvidence.push(evidence(
        tool.displayName,
        '$.inputSchema',
        'Tool inputSchema is missing or is not an object.'
      ));
    }
  }

  const describedTools = tools.filter((tool) => tool.description !== null);
  const descriptionLengths = describedTools.map((tool) => tool.description?.length || 0);
  const missingDescriptionTools = tools.filter((tool) => tool.description === null);
  const shortDescriptionTools = describedTools.filter(
    (tool) => (tool.description?.length || 0) < SHORT_DESCRIPTION_CHARACTERS
  );
  const genericDescriptionTools = describedTools.filter((tool) => (
    GENERIC_DESCRIPTIONS.has(normalizeText(tool.description || ''))
      || normalizeText(tool.description || '') === normalizeText(tool.name || '')
  ));
  const longDescriptionTools = describedTools.filter(
    (tool) => (tool.description?.length || 0) > LONG_DESCRIPTION_CHARACTERS
  );
  const adequateDescriptionCount = describedTools.length
    - shortDescriptionTools.length
    - genericDescriptionTools.filter((tool) => !shortDescriptionTools.includes(tool)).length;
  const descriptionCoverage = tools.length === 0 ? 1 : describedTools.length / tools.length;
  const descriptionAdequacy = tools.length === 0 ? 1 : Math.max(0, adequateDescriptionCount) / tools.length;
  const descriptionQualityScore = Math.round((descriptionCoverage * 0.6 + descriptionAdequacy * 0.4) * 100);

  const schemaAccumulator: SchemaAccumulator = {
    schemaNodeCount: 0,
    propertyCount: 0,
    requiredPropertyCount: 0,
    optionalPropertyCount: 0,
    propertiesMissingDescriptions: 0,
    unconstrainedStringCount: 0,
    unconstrainedObjectCount: 0,
    maximumDepth: 0,
    maximumWidth: 0,
    malformedToolIndexes: new Set(),
    malformedEvidence: [],
    unconstrainedEvidence: [],
    missingDescriptionEvidence: [],
    depthEvidence: [],
    widthEvidence: [],
  };

  for (const tool of tools) {
    if (!isRecord(tool.inputSchema)) {
      schemaAccumulator.malformedToolIndexes.add(tool.index);
      continue;
    }
    if (tool.inputSchema.type !== 'object') {
      markMalformedSchema(
        schemaAccumulator,
        tool,
        '$.inputSchema.type',
        'MCP tool inputSchema must declare type "object".'
      );
    }
    visitSchema(tool.inputSchema, tool, '$.inputSchema', 1, schemaAccumulator, new Set());
  }

  const duplicateNameGroups = findDuplicateGroups(tools, (tool) => tool.name);
  const duplicateDescriptionGroups = findDuplicateGroups(tools, (tool) => tool.description);
  const overlappingNames = findOverlappingPairs(
    tools,
    (tool) => tool.name,
    NAME_STOP_WORDS,
    0.75,
    2
  );
  const overlappingDescriptions = findOverlappingPairs(
    tools,
    (tool) => tool.description,
    DESCRIPTION_STOP_WORDS,
    0.85,
    4
  );

  const writeSignals: Array<{ tool: ToolRecord; actions: string[] }> = [];
  const destructiveSignals: Array<{ tool: ToolRecord; actions: string[] }> = [];
  const promptSignals: Array<{ tool: ToolRecord; signals: string[] }> = [];
  for (const tool of tools) {
    const actions = actionSignals(tool);
    if (actions.write.length > 0) writeSignals.push({ tool, actions: actions.write });
    if (actions.destructive.length > 0) destructiveSignals.push({ tool, actions: actions.destructive });
    const signals = promptLikeSignals(tool.description);
    if (signals.length > 0) promptSignals.push({ tool, signals });
  }

  if (extracted.status === 'missing' || extracted.status === 'empty') {
    const otherCapabilities = extracted.resourceCount + extracted.promptCount;
    addFinding(findings, {
      id: 'availability.no-tools',
      category: 'availability',
      severity: 'info',
      kind: 'measurement',
      title: extracted.status === 'missing' ? 'No tool list was provided' : 'Tool list is empty',
      summary: otherCapabilities > 0
        ? `No tools were exposed; the snapshot contains ${extracted.resourceCount} resources and ${extracted.promptCount} prompts.`
        : 'No MCP tools were available to analyze.',
      evidence: [evidence(
        '<surface>',
        '$.tools',
        extracted.status === 'missing' ? 'tools is absent.' : 'tools contains zero definitions.'
      )],
      remediation: 'No tool remediation is required; retain this status so later comparisons can detect capability changes.',
    });
  } else if (extracted.status === 'malformed') {
    addFinding(findings, {
      id: 'availability.malformed-tool-list',
      category: 'availability',
      severity: 'high',
      kind: 'quality-signal',
      title: 'Tool list is malformed',
      summary: 'The tools field is present but is not an array, so definitions could not be analyzed.',
      evidence: [evidence('<surface>', '$.tools', 'Expected an array of MCP tool definitions.')],
      remediation: 'Return a tools/list result whose tools field is an array, including an empty array when no tools are exposed.',
    });
  }

  if (malformedToolEvidence.length > 0 || schemaAccumulator.malformedEvidence.length > 0) {
    addFinding(findings, {
      id: 'schema.malformed-definitions',
      category: 'schema-quality',
      severity: 'high',
      kind: 'quality-signal',
      title: 'Malformed tool definitions or schemas',
      summary: `${tools.filter((tool) => !tool.valid).length} tool definitions are missing required fields; ${schemaAccumulator.malformedToolIndexes.size} input schemas contain structural problems.`,
      evidence: [...malformedToolEvidence, ...schemaAccumulator.malformedEvidence],
      remediation: 'Validate every tool against the MCP Tool schema and each inputSchema against JSON Schema before publishing tools/list.',
    });
  }

  const surfaceSeverity = contextSeverity(tools.length, estimatedContextTokens);
  if (surfaceSeverity) {
    addFinding(findings, {
      id: 'context.large-tool-surface',
      category: 'context-cost',
      severity: surfaceSeverity,
      kind: 'measurement',
      title: 'Large tool surface increases context cost',
      summary: `${tools.length} definitions serialize to ${serializedDefinitionBytes} bytes (approximately ${estimatedContextTokens} tokens at four UTF-8 bytes per token).`,
      evidence: [evidence('<surface>', '$.tools', `${tools.length} tools; ${serializedDefinitionBytes} serialized bytes.`)],
      remediation: 'Expose only task-relevant tools, shorten redundant descriptions, and consider capability discovery or namespaced subsets.',
    });
  }

  if (missingDescriptionTools.length > 0) {
    addFinding(findings, {
      id: 'description.missing',
      category: 'description-quality',
      severity: missingDescriptionTools.length === tools.length ? 'medium' : 'low',
      kind: 'quality-signal',
      title: 'Tool descriptions are missing',
      summary: `${missingDescriptionTools.length} of ${tools.length} tools have no usable description.`,
      evidence: missingDescriptionTools.map((tool) => evidence(
        tool.displayName,
        '$.description',
        'Description is missing or empty.'
      )),
      remediation: 'Add a concise description that states the operation, target, side effects, and important usage boundaries.',
    });
  }

  if (shortDescriptionTools.length > 0 || genericDescriptionTools.length > 0) {
    const weakTools = new Map<number, ToolRecord>();
    [...shortDescriptionTools, ...genericDescriptionTools].forEach((tool) => weakTools.set(tool.index, tool));
    addFinding(findings, {
      id: 'description.weak',
      category: 'description-quality',
      severity: 'low',
      kind: 'quality-signal',
      title: 'Descriptions provide limited disambiguation',
      summary: `${shortDescriptionTools.length} descriptions are shorter than ${SHORT_DESCRIPTION_CHARACTERS} characters and ${genericDescriptionTools.length} are generic or repeat the tool name.`,
      evidence: [...weakTools.values()].map((tool) => evidence(
        tool.displayName,
        '$.description',
        `Description is ${tool.description?.length || 0} characters: ${JSON.stringify(tool.description)}.`
      )),
      remediation: 'Describe when to use the tool, how it differs from nearby tools, and whether it changes external state.',
    });
  }

  if (longDescriptionTools.length > 0) {
    addFinding(findings, {
      id: 'description.long',
      category: 'context-cost',
      severity: 'low',
      kind: 'measurement',
      title: 'Long descriptions add persistent context cost',
      summary: `${longDescriptionTools.length} descriptions exceed ${LONG_DESCRIPTION_CHARACTERS} characters.`,
      evidence: longDescriptionTools.map((tool) => evidence(
        tool.displayName,
        '$.description',
        `Description is ${tool.description?.length || 0} characters.`
      )),
      remediation: 'Move examples and extended instructions to documentation, keeping the tool description concise and decision-relevant.',
    });
  }

  if (schemaAccumulator.maximumDepth >= 5 || schemaAccumulator.maximumWidth >= 20) {
    const severity: ToolSurfaceSeverity = schemaAccumulator.maximumDepth >= 8
      || schemaAccumulator.maximumWidth >= 50
      ? 'medium'
      : 'low';
    addFinding(findings, {
      id: 'schema.complexity',
      category: 'schema-quality',
      severity,
      kind: 'quality-signal',
      title: 'Input schemas are complex',
      summary: `Maximum schema depth is ${schemaAccumulator.maximumDepth} and maximum object width is ${schemaAccumulator.maximumWidth}.`,
      evidence: [
        ...schemaAccumulator.depthEvidence,
        ...schemaAccumulator.widthEvidence.filter((item) => item.detail === `Object declares ${schemaAccumulator.maximumWidth} properties.`),
      ],
      remediation: 'Flatten deeply nested inputs, split broad operations, or replace large free-form shapes with focused typed parameters.',
    });
  }

  if (schemaAccumulator.unconstrainedStringCount > 0 || schemaAccumulator.unconstrainedObjectCount > 0) {
    addFinding(findings, {
      id: 'schema.unconstrained-inputs',
      category: 'schema-quality',
      severity: schemaAccumulator.unconstrainedObjectCount > 0 ? 'medium' : 'low',
      kind: 'quality-signal',
      title: 'Inputs accept unconstrained values',
      summary: `${schemaAccumulator.unconstrainedStringCount} strings and ${schemaAccumulator.unconstrainedObjectCount} objects lack structural constraints.`,
      evidence: schemaAccumulator.unconstrainedEvidence,
      remediation: 'Add enums, formats, patterns, length limits, declared properties, and additionalProperties: false where the contract permits.',
    });
  }

  if (schemaAccumulator.propertiesMissingDescriptions > 0) {
    addFinding(findings, {
      id: 'schema.missing-property-descriptions',
      category: 'schema-quality',
      severity: 'low',
      kind: 'quality-signal',
      title: 'Input properties lack descriptions',
      summary: `${schemaAccumulator.propertiesMissingDescriptions} of ${schemaAccumulator.propertyCount} declared properties have no description.`,
      evidence: schemaAccumulator.missingDescriptionEvidence,
      remediation: 'Document the meaning, accepted units or format, and effect of each input property.',
    });
  }

  const totalProperties = schemaAccumulator.requiredPropertyCount + schemaAccumulator.optionalPropertyCount;
  if (
    totalProperties >= 4
    && (schemaAccumulator.requiredPropertyCount === 0 || schemaAccumulator.optionalPropertyCount === 0)
  ) {
    addFinding(findings, {
      id: 'schema.required-optional-balance',
      category: 'schema-quality',
      severity: 'low',
      kind: 'quality-signal',
      title: 'Required and optional inputs are imbalanced',
      summary: `${schemaAccumulator.requiredPropertyCount} of ${totalProperties} properties are required.`,
      evidence: [evidence('<surface>', '$.tools[*].inputSchema', `${schemaAccumulator.requiredPropertyCount} required; ${schemaAccumulator.optionalPropertyCount} optional.`)],
      remediation: schemaAccumulator.requiredPropertyCount === 0
        ? 'Mark inputs required when the operation cannot behave predictably without them.'
        : 'Make convenience or refinement inputs optional when safe defaults are available.',
    });
  }

  if (duplicateNameGroups.length > 0 || overlappingNames.length > 0) {
    addFinding(findings, {
      id: 'ambiguity.names',
      category: 'ambiguity',
      severity: duplicateNameGroups.length > 0 ? 'high' : 'medium',
      kind: 'quality-signal',
      title: 'Tool names are duplicate or highly overlapping',
      summary: `${duplicateNameGroups.length} duplicate-name groups and ${overlappingNames.length} highly overlapping name pairs were found.`,
      evidence: [
        ...duplicateNameGroups.map((group) => evidence(
          group.join(', '),
          '$.name',
          `Duplicate normalized name shared by ${group.length} definitions.`
        )),
        ...overlappingNames.map((pair) => evidence(
          `${pair.left}, ${pair.right}`,
          '$.name',
          `Name token similarity is ${pair.score}.`
        )),
      ],
      remediation: 'Give every tool a unique action-and-target name and encode the meaningful distinction in the name, not only the description.',
    });
  }

  if (duplicateDescriptionGroups.length > 0 || overlappingDescriptions.length > 0) {
    addFinding(findings, {
      id: 'ambiguity.descriptions',
      category: 'ambiguity',
      severity: 'medium',
      kind: 'quality-signal',
      title: 'Descriptions do not clearly distinguish tools',
      summary: `${duplicateDescriptionGroups.length} duplicate-description groups and ${overlappingDescriptions.length} highly overlapping description pairs were found.`,
      evidence: [
        ...duplicateDescriptionGroups.map((group) => evidence(
          group.join(', '),
          '$.description',
          `Identical normalized description shared by ${group.length} definitions.`
        )),
        ...overlappingDescriptions.map((pair) => evidence(
          `${pair.left}, ${pair.right}`,
          '$.description',
          `Description token similarity is ${pair.score}.`
        )),
      ],
      remediation: 'State each tool’s distinct intent, scope, side effects, and selection boundary in its description.',
    });
  }

  if (destructiveSignals.length > 0) {
    addFinding(findings, {
      id: 'risk.destructive-capabilities',
      category: 'capability-risk',
      severity: 'high',
      kind: 'capability-signal',
      title: 'Destructive capability signals require safeguards',
      summary: `${destructiveSignals.length} tools advertise verbs associated with destructive or difficult-to-reverse operations. This capability signal is not proof of a vulnerability or unsafe implementation.`,
      evidence: destructiveSignals.map(({ tool, actions }) => evidence(
        tool.displayName,
        '$.name|$.description|$.annotations',
        `Matched destructive action${actions.length === 1 ? '' : 's'}: ${actions.join(', ')}.`
      )),
      remediation: 'Require explicit authorization and confirmation, constrain target scope, support dry runs where practical, and document reversibility.',
    });
  }

  const nonDestructiveWriteSignals = writeSignals.filter(({ tool }) => (
    !destructiveSignals.some((signal) => signal.tool.index === tool.index)
  ));
  if (nonDestructiveWriteSignals.length > 0) {
    addFinding(findings, {
      id: 'risk.write-capabilities',
      category: 'capability-risk',
      severity: 'medium',
      kind: 'capability-signal',
      title: 'State-changing capability signals require review',
      summary: `${nonDestructiveWriteSignals.length} tools advertise write or execution actions. Capability presence alone does not establish a vulnerability.`,
      evidence: nonDestructiveWriteSignals.map(({ tool, actions }) => evidence(
        tool.displayName,
        '$.name|$.description|$.annotations',
        `Matched state-changing action${actions.length === 1 ? '' : 's'}: ${actions.join(', ')}.`
      )),
      remediation: 'Apply least-privilege authorization, validate inputs, make side effects explicit, and add idempotency or confirmation controls where appropriate.',
    });
  }

  if (promptSignals.length > 0) {
    addFinding(findings, {
      id: 'description.prompt-like-text',
      category: 'prompt-like-description',
      severity: 'medium',
      kind: 'review-signal',
      title: 'Descriptions contain prompt-like directives',
      summary: `${promptSignals.length} descriptions contain strong model-directed or imperative text. This is a review signal and does not imply malicious intent.`,
      evidence: promptSignals.map(({ tool, signals }) => evidence(
        tool.displayName,
        '$.description',
        `Description ${signals.join(' and ')}.`
      )),
      remediation: 'Rewrite descriptions as factual capability guidance and move agent-policy instructions to the appropriate trusted configuration layer.',
    });
  }

  for (const severity of SEVERITIES) {
    findings[severity].sort((left, right) => compareText(left.id, right.id));
  }

  const findingCount = SEVERITIES.reduce((count, severity) => count + findings[severity].length, 0);
  const requiredPropertyRatio = totalProperties === 0
    ? 0
    : round(schemaAccumulator.requiredPropertyCount / totalProperties, 4);

  return {
    version: TOOL_SURFACE_ANALYSIS_VERSION,
    metrics: {
      toolListStatus: extracted.status,
      toolCount: tools.length,
      validToolCount: tools.filter((tool) => tool.valid).length,
      malformedToolCount: tools.filter((tool) => !tool.valid).length,
      resourceCount: extracted.resourceCount,
      promptCount: extracted.promptCount,
      serializedDefinitionBytes,
      estimatedContextTokens,
      descriptions: {
        describedToolCount: describedTools.length,
        missingToolDescriptionCount: missingDescriptionTools.length,
        shortDescriptionCount: shortDescriptionTools.length,
        genericDescriptionCount: genericDescriptionTools.length,
        longDescriptionCount: longDescriptionTools.length,
        totalCharacters: descriptionLengths.reduce((total, length) => total + length, 0),
        averageCharacters: descriptionLengths.length === 0
          ? 0
          : round(descriptionLengths.reduce((total, length) => total + length, 0) / descriptionLengths.length),
        minimumCharacters: descriptionLengths.length === 0 ? 0 : Math.min(...descriptionLengths),
        maximumCharacters: descriptionLengths.length === 0 ? 0 : Math.max(...descriptionLengths),
        qualityScore: descriptionQualityScore,
      },
      schemas: {
        schemaNodeCount: schemaAccumulator.schemaNodeCount,
        propertyCount: schemaAccumulator.propertyCount,
        requiredPropertyCount: schemaAccumulator.requiredPropertyCount,
        optionalPropertyCount: schemaAccumulator.optionalPropertyCount,
        requiredPropertyRatio,
        propertiesMissingDescriptions: schemaAccumulator.propertiesMissingDescriptions,
        unconstrainedStringCount: schemaAccumulator.unconstrainedStringCount,
        unconstrainedObjectCount: schemaAccumulator.unconstrainedObjectCount,
        maximumDepth: schemaAccumulator.maximumDepth,
        maximumWidth: schemaAccumulator.maximumWidth,
        malformedSchemaCount: schemaAccumulator.malformedToolIndexes.size,
      },
      ambiguity: {
        duplicateNameGroupCount: duplicateNameGroups.length,
        overlappingNamePairCount: overlappingNames.length,
        duplicateDescriptionGroupCount: duplicateDescriptionGroups.length,
        overlappingDescriptionPairCount: overlappingDescriptions.length,
      },
      riskSignals: {
        writeCapabilityToolCount: writeSignals.length,
        destructiveCapabilityToolCount: destructiveSignals.length,
        promptLikeDescriptionCount: promptSignals.length,
      },
    },
    fingerprint: {
      algorithm: 'fnv1a-64-v1',
      value: fingerprint(canonicalFingerprint),
      canonicalBytes: utf8ByteLength(canonicalFingerprint),
    },
    findings,
    findingCount,
    interpretation: 'Findings describe observable context, quality, ambiguity, and capability signals. They do not prove a vulnerability, exploitation, or malicious intent.',
  };
}
