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
const EVIDENCE_FIELD_CHARACTER_LIMIT = 2_000;
const SCHEMA_PATH_SEGMENT_CHARACTER_LIMIT = 256;
const SHORT_DESCRIPTION_CHARACTERS = 24;
const LONG_DESCRIPTION_CHARACTERS = 1_000;
const TEXT_ANALYSIS_CHARACTER_LIMIT = 4_000;
const TOOL_ANALYSIS_LIMIT = 2_000;
const CANONICAL_DEPTH_LIMIT = 64;
const CANONICAL_NODE_LIMIT = 100_000;
const CANONICAL_BYTE_LIMIT = 2_000_000;
const CANONICAL_ORDER_NODE_LIMIT = 4_096;
const CANONICAL_ORDER_BYTE_LIMIT = 32_000;
const SCHEMA_DEPTH_LIMIT = 64;
const SCHEMA_NODE_LIMIT = 50_000;
const SCHEMA_EVIDENCE_RETENTION_LIMIT = EVIDENCE_LIMIT;
const SIMILARITY_COMPARISON_LIMIT = 50_000;
const OVERLAP_PAIR_RETENTION_LIMIT = EVIDENCE_LIMIT;

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
  textTruncated: boolean;
  raw: unknown;
  valid: boolean;
}

interface PairEvidence {
  left: string;
  right: string;
  score: number;
}

interface PairAnalysis {
  comparisonCount: number;
  comparisonLimitReached: boolean;
  pairCount: number;
  retainedPairs: PairEvidence[];
}

interface CanonicalResult {
  serialized: string;
  nodeCount: number;
  truncationReasons: Set<'depth' | 'nodes' | 'bytes'>;
}

interface CanonicalCollectionResult {
  serialized: string;
  truncationReasons: Set<'depth' | 'nodes' | 'bytes'>;
  omittedValueCount: number;
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
  malformedEvidenceCount: number;
  unconstrainedEvidence: ToolSurfaceEvidenceV1[];
  missingDescriptionEvidence: ToolSurfaceEvidenceV1[];
  depthEvidence: ToolSurfaceEvidenceV1[];
  widthEvidence: ToolSurfaceEvidenceV1[];
  depthLimitReached: boolean;
  nodeLimitReached: boolean;
  budgetEvidence: ToolSurfaceEvidenceV1[];
}

interface FindingInput {
  id: string;
  category: ToolSurfaceFindingCategory;
  severity: ToolSurfaceSeverity;
  kind: ToolSurfaceFindingKind;
  title: string;
  summary: string;
  evidence: ToolSurfaceEvidenceV1[];
  omittedEvidenceCount?: number;
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

const boundedOwnKeys = (
  value: Record<string, unknown>,
  maximumKeys: number,
  include: (key: string) => boolean = () => true
): { keys: string[]; truncated: boolean } => {
  const keys: string[] = [];
  let matchingKeyCount = 0;

  const restoreMaximumHeap = (startIndex: number): void => {
    let parentIndex = startIndex;
    while (true) {
      const leftIndex = parentIndex * 2 + 1;
      const rightIndex = leftIndex + 1;
      let maximumIndex = parentIndex;
      if (leftIndex < keys.length && compareText(keys[leftIndex], keys[maximumIndex]) > 0) {
        maximumIndex = leftIndex;
      }
      if (rightIndex < keys.length && compareText(keys[rightIndex], keys[maximumIndex]) > 0) {
        maximumIndex = rightIndex;
      }
      if (maximumIndex === parentIndex) return;
      [keys[parentIndex], keys[maximumIndex]] = [keys[maximumIndex], keys[parentIndex]];
      parentIndex = maximumIndex;
    }
  };

  for (const key in value) {
    if (!Object.prototype.hasOwnProperty.call(value, key) || !include(key)) continue;
    matchingKeyCount += 1;
    if (maximumKeys <= 0) continue;
    if (keys.length < maximumKeys) {
      keys.push(key);
      let childIndex = keys.length - 1;
      while (childIndex > 0) {
        const parentIndex = Math.floor((childIndex - 1) / 2);
        if (compareText(keys[parentIndex], keys[childIndex]) >= 0) break;
        [keys[parentIndex], keys[childIndex]] = [keys[childIndex], keys[parentIndex]];
        childIndex = parentIndex;
      }
    } else if (compareText(key, keys[0]) < 0) {
      keys[0] = key;
      restoreMaximumHeap(0);
    }
  }
  keys.sort(compareText);
  return { keys, truncated: matchingKeyCount > keys.length };
};

const utf8ByteLength = (value: string): number => new TextEncoder().encode(value).length;

type CanonicalWorkItem =
  | { kind: 'value'; value: unknown; depth: number }
  | { kind: 'key'; value: string }
  | { kind: 'text'; value: string }
  | { kind: 'exit'; value: object; close: ']' | '}' };

/** Iterative canonicalization keeps ordinary output byte-for-byte compatible. */
const canonicalStringify = (
  value: unknown,
  maximumNodes: number,
  maximumBytes: number
): CanonicalResult => {
  const output: string[] = [];
  const ancestors = new Set<object>();
  const work: CanonicalWorkItem[] = [{ kind: 'value', value, depth: 0 }];
  const truncationReasons = new Set<'depth' | 'nodes' | 'bytes'>();
  let nodeCount = 0;
  let byteCount = 0;
  let aborted = false;

  const append = (text: string): boolean => {
    const bytes = utf8ByteLength(text);
    if (byteCount + bytes > maximumBytes) return false;
    output.push(text);
    byteCount += bytes;
    return true;
  };

  const abort = (reason: 'nodes' | 'bytes'): void => {
    truncationReasons.add(reason);
    output.push(JSON.stringify(`[Truncated: canonical-${reason}-limit]`));
    for (let index = work.length - 1; index >= 0; index -= 1) {
      const item = work[index];
      if (item.kind === 'exit') output.push(item.close);
    }
    aborted = true;
  };

  while (work.length > 0 && !aborted) {
    const item = work.pop() as CanonicalWorkItem;
    if (item.kind === 'text') {
      if (!append(item.value)) abort('bytes');
      continue;
    }
    if (item.kind === 'key') {
      if (item.value.length > maximumBytes - byteCount) {
        abort('bytes');
        continue;
      }
      if (!append(`${JSON.stringify(item.value)}:`)) abort('bytes');
      continue;
    }
    if (item.kind === 'exit') {
      ancestors.delete(item.value);
      if (!append(item.close)) abort('bytes');
      continue;
    }

    if (nodeCount >= maximumNodes) {
      abort('nodes');
      continue;
    }
    nodeCount += 1;

    if (item.depth > CANONICAL_DEPTH_LIMIT) {
      truncationReasons.add('depth');
      if (!append(JSON.stringify('[Truncated: canonical-depth-limit]'))) abort('bytes');
      continue;
    }

    const current = item.value;
    let primitive: string | null = null;
    if (current === null) primitive = 'null';
    else if (typeof current === 'string') {
      if (current.length > maximumBytes - byteCount) {
        abort('bytes');
        continue;
      }
      primitive = JSON.stringify(current);
    } else if (typeof current === 'boolean') primitive = current ? 'true' : 'false';
    else if (typeof current === 'number') primitive = Number.isFinite(current) ? String(current) : 'null';
    else if (typeof current === 'bigint') primitive = JSON.stringify(current.toString());
    else if (typeof current !== 'object') primitive = 'null';

    if (primitive !== null) {
      if (!append(primitive)) abort('bytes');
      continue;
    }

    const objectValue = current as object;
    if (ancestors.has(objectValue)) {
      if (!append(JSON.stringify('[Circular]'))) abort('bytes');
      continue;
    }
    ancestors.add(objectValue);

    if (Array.isArray(current)) {
      if (!append('[')) {
        abort('bytes');
        continue;
      }
      work.push({ kind: 'exit', value: current, close: ']' });
      const retainedLength = Math.min(current.length, Math.max(0, maximumNodes - nodeCount));
      if (retainedLength < current.length) {
        truncationReasons.add('nodes');
        work.push({ kind: 'value', value: '[Truncated: canonical-nodes-limit]', depth: item.depth + 1 });
        if (retainedLength > 0) work.push({ kind: 'text', value: ',' });
      }
      for (let index = retainedLength - 1; index >= 0; index -= 1) {
        if (index < retainedLength - 1) work.push({ kind: 'text', value: ',' });
        work.push({ kind: 'value', value: current[index], depth: item.depth + 1 });
      }
      continue;
    }

    const record = current as Record<string, unknown>;
    const boundedKeys = boundedOwnKeys(
      record,
      Math.max(0, maximumNodes - nodeCount),
      (key) => {
        const child = record[key];
        return child !== undefined && typeof child !== 'function' && typeof child !== 'symbol';
      }
    );
    const keys = boundedKeys.keys;
    if (!append('{')) {
      abort('bytes');
      continue;
    }
    work.push({ kind: 'exit', value: record, close: '}' });
    if (boundedKeys.truncated) {
      truncationReasons.add('nodes');
      work.push({ kind: 'value', value: true, depth: item.depth + 1 });
      work.push({ kind: 'text', value: `${JSON.stringify('[Truncated: canonical-nodes-limit]')}:` });
      if (keys.length > 0) work.push({ kind: 'text', value: ',' });
    }
    for (let index = keys.length - 1; index >= 0; index -= 1) {
      if (index < keys.length - 1) work.push({ kind: 'text', value: ',' });
      const key = keys[index];
      work.push({ kind: 'value', value: record[key], depth: item.depth + 1 });
      work.push({ kind: 'key', value: key });
    }
  }

  return { serialized: output.join(''), nodeCount, truncationReasons };
};

interface CanonicallyOrderedValue {
  value: unknown;
  orderKey: string;
}

const canonicalOrderKey = (value: unknown): string => canonicalStringify(
  value,
  CANONICAL_ORDER_NODE_LIMIT,
  CANONICAL_ORDER_BYTE_LIMIT
).serialized;

const compareCanonicallyOrderedValues = (
  left: CanonicallyOrderedValue,
  right: CanonicallyOrderedValue
): number => compareText(left.orderKey, right.orderKey);

const orderCanonicalValues = (values: readonly unknown[]): CanonicallyOrderedValue[] => values
  .map((value) => ({ value, orderKey: canonicalOrderKey(value) }))
  .sort(compareCanonicallyOrderedValues);

const selectCanonicalValues = (
  values: readonly unknown[],
  limit: number
): CanonicallyOrderedValue[] => {
  const selected: CanonicallyOrderedValue[] = [];

  const restoreMaximumHeap = (startIndex: number): void => {
    let parentIndex = startIndex;
    while (true) {
      const leftIndex = parentIndex * 2 + 1;
      const rightIndex = leftIndex + 1;
      let maximumIndex = parentIndex;
      if (
        leftIndex < selected.length
        && compareCanonicallyOrderedValues(selected[leftIndex], selected[maximumIndex]) > 0
      ) {
        maximumIndex = leftIndex;
      }
      if (
        rightIndex < selected.length
        && compareCanonicallyOrderedValues(selected[rightIndex], selected[maximumIndex]) > 0
      ) {
        maximumIndex = rightIndex;
      }
      if (maximumIndex === parentIndex) return;
      [selected[parentIndex], selected[maximumIndex]] = [selected[maximumIndex], selected[parentIndex]];
      parentIndex = maximumIndex;
    }
  };

  for (const value of values) {
    const candidate = { value, orderKey: canonicalOrderKey(value) };
    if (selected.length < limit) {
      selected.push(candidate);
      let childIndex = selected.length - 1;
      while (childIndex > 0) {
        const parentIndex = Math.floor((childIndex - 1) / 2);
        if (compareCanonicallyOrderedValues(selected[parentIndex], selected[childIndex]) >= 0) break;
        [selected[parentIndex], selected[childIndex]] = [selected[childIndex], selected[parentIndex]];
        childIndex = parentIndex;
      }
    } else if (limit > 0 && compareCanonicallyOrderedValues(candidate, selected[0]) < 0) {
      selected[0] = candidate;
      restoreMaximumHeap(0);
    }
  }

  return selected.sort(compareCanonicallyOrderedValues);
};

const canonicalizeCollection = (
  values: readonly unknown[],
  emptyValue: string
): CanonicalCollectionResult => {
  const orderedValues = orderCanonicalValues(values);
  const entries: string[] = [];
  const truncationReasons = new Set<'depth' | 'nodes' | 'bytes'>();
  let remainingNodes = CANONICAL_NODE_LIMIT;
  let remainingBytes = CANONICAL_BYTE_LIMIT;
  let omittedValueCount = 0;

  for (let index = 0; index < orderedValues.length; index += 1) {
    if (remainingNodes <= 0 || remainingBytes <= 0) {
      omittedValueCount = orderedValues.length - index;
      if (remainingNodes <= 0) truncationReasons.add('nodes');
      if (remainingBytes <= 0) truncationReasons.add('bytes');
      break;
    }
    const result = canonicalStringify(orderedValues[index].value, remainingNodes, remainingBytes);
    entries.push(result.serialized);
    remainingNodes -= result.nodeCount;
    remainingBytes -= Math.min(remainingBytes, utf8ByteLength(result.serialized));
    result.truncationReasons.forEach((reason) => truncationReasons.add(reason));
  }

  if (omittedValueCount > 0) {
    entries.push(JSON.stringify(`[Truncated: ${omittedValueCount} canonical values omitted]`));
  }
  if (orderedValues.length === 0) return { serialized: emptyValue, truncationReasons, omittedValueCount };
  return {
    serialized: `[${entries.sort(compareText).join(',')}]`,
    truncationReasons,
    omittedValueCount,
  };
};

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

const boundedLabel = (value: string, limit: number): string => (
  value.length <= limit ? value : `${value.slice(0, limit)}…`
);

const schemaPathSegment = (value: string): string => (
  boundedLabel(value, SCHEMA_PATH_SEGMENT_CHARACTER_LIMIT)
);

const evidence = (tool: string, path: string, detail: string): ToolSurfaceEvidenceV1 => ({
  tool: boundedLabel(tool, EVIDENCE_FIELD_CHARACTER_LIMIT),
  path: boundedLabel(path, EVIDENCE_FIELD_CHARACTER_LIMIT),
  detail: boundedLabel(detail, EVIDENCE_FIELD_CHARACTER_LIMIT),
});

const retainSchemaEvidence = (
  target: ToolSurfaceEvidenceV1[],
  item: ToolSurfaceEvidenceV1
): void => {
  if (target.length < SCHEMA_EVIDENCE_RETENTION_LIMIT) target.push(item);
};

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
    omittedEvidenceCount: (input.omittedEvidenceCount || 0)
      + sortedEvidence.length - selectedEvidence.length,
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
      textTruncated: false,
      raw,
      valid: false,
    };
  }

  const nameText = typeof raw.name === 'string'
    ? raw.name.slice(0, TEXT_ANALYSIS_CHARACTER_LIMIT + 1).trim()
    : '';
  const descriptionText = typeof raw.description === 'string'
    ? raw.description.slice(0, TEXT_ANALYSIS_CHARACTER_LIMIT + 1).trim()
    : '';
  const name = nameText ? nameText.slice(0, TEXT_ANALYSIS_CHARACTER_LIMIT) : null;
  const description = descriptionText
    ? descriptionText.slice(0, TEXT_ANALYSIS_CHARACTER_LIMIT)
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
    textTruncated: (typeof raw.name === 'string' && raw.name.length > TEXT_ANALYSIS_CHARACTER_LIMIT)
      || (typeof raw.description === 'string' && raw.description.length > TEXT_ANALYSIS_CHARACTER_LIMIT),
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
  accumulator.malformedEvidenceCount += 1;
  retainSchemaEvidence(
    accumulator.malformedEvidence,
    evidence(tool.displayName, displayPath(path), detail)
  );
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
    retainSchemaEvidence(
      accumulator.depthEvidence,
      evidence(tool.displayName, displayPath(path), `Schema reaches depth ${depth}.`)
    );
  }
};

type SchemaWorkItem =
  | { kind: 'visit'; schema: unknown; path: string; depth: number }
  | { kind: 'exit'; schema: object };

const visitSchema = (
  schema: unknown,
  tool: ToolRecord,
  path: string,
  depth: number,
  accumulator: SchemaAccumulator
): void => {
  const ancestors = new Set<object>();
  const work: SchemaWorkItem[] = [{ kind: 'visit', schema, path, depth }];
  let scheduledVisitCount = 1;
  const markNodeLimit = (budgetTool: ToolRecord, budgetPath: string): void => {
    if (!accumulator.nodeLimitReached) {
      retainSchemaEvidence(
        accumulator.budgetEvidence,
        evidence(
          budgetTool.displayName,
          displayPath(budgetPath),
          `Schema traversal stopped after ${SCHEMA_NODE_LIMIT} schema visits.`
        )
      );
    }
    accumulator.nodeLimitReached = true;
  };

  while (work.length > 0) {
    const item = work.pop() as SchemaWorkItem;
    if (item.kind === 'exit') {
      ancestors.delete(item.schema);
      continue;
    }
    scheduledVisitCount -= 1;

    if (accumulator.schemaNodeCount >= SCHEMA_NODE_LIMIT) {
      markNodeLimit(tool, item.path);
      continue;
    }
    accumulator.schemaNodeCount += 1;

    if (item.depth > SCHEMA_DEPTH_LIMIT) {
      if (!accumulator.depthLimitReached) {
        retainSchemaEvidence(
          accumulator.budgetEvidence,
          evidence(
            tool.displayName,
            displayPath(item.path),
            `Schema traversal stopped at the deterministic depth limit of ${SCHEMA_DEPTH_LIMIT}.`
          )
        );
      }
      accumulator.depthLimitReached = true;
      continue;
    }

    if (typeof item.schema === 'boolean') {
      recordSchemaDepth(accumulator, tool, item.path, item.depth);
      continue;
    }
    if (!isRecord(item.schema)) {
      markMalformedSchema(accumulator, tool, item.path, 'Schema node must be an object or boolean.');
      continue;
    }
    if (ancestors.has(item.schema)) {
      markMalformedSchema(accumulator, tool, item.path, 'Circular schema reference cannot be serialized as JSON.');
      continue;
    }

    const current = item.schema;
    ancestors.add(current);
    recordSchemaDepth(accumulator, tool, item.path, item.depth);
    const childrenToVisit: Array<{ schema: unknown; path: string }> = [];
    const maximumChildren = Math.max(
      0,
      SCHEMA_NODE_LIMIT - accumulator.schemaNodeCount - scheduledVisitCount
    );
    const addChild = (child: { schema: unknown; path: string }): void => {
      if (childrenToVisit.length >= maximumChildren) {
        markNodeLimit(tool, child.path);
        return;
      }
      childrenToVisit.push(child);
      scheduledVisitCount += 1;
    };

    if (
      current.type !== undefined
      && typeof current.type !== 'string'
      && !(Array.isArray(current.type) && current.type.every((type) => typeof type === 'string'))
    ) {
      markMalformedSchema(accumulator, tool, `${item.path}.type`, 'Schema type must be a string or string array.');
    }

    const properties = current.properties;
    const objectLike = current.type === 'object' || isRecord(properties);
    if (properties !== undefined && !isRecord(properties)) {
      markMalformedSchema(accumulator, tool, `${item.path}.properties`, 'Schema properties must be an object.');
    }

    const requiredValue = current.required;
    const validRequired = requiredValue === undefined
      || (Array.isArray(requiredValue) && requiredValue.every((name) => typeof name === 'string'));
    if (!validRequired) {
      markMalformedSchema(accumulator, tool, `${item.path}.required`, 'Schema required must be an array of property names.');
    }
    const required = new Set<string>(validRequired && Array.isArray(requiredValue) ? requiredValue : []);

    let propertyNames: string[] = [];
    if (isRecord(properties)) {
      const boundedProperties = boundedOwnKeys(properties, maximumChildren);
      propertyNames = boundedProperties.keys;
      if (boundedProperties.truncated) markNodeLimit(tool, `${item.path}.properties`);
      const width = propertyNames.length;
      if (width > accumulator.maximumWidth) {
        accumulator.maximumWidth = width;
        accumulator.widthEvidence = [evidence(
          tool.displayName,
          displayPath(item.path),
          `Object declares ${width} properties.`
        )];
      } else if (width > 0 && width === accumulator.maximumWidth) {
        retainSchemaEvidence(
          accumulator.widthEvidence,
          evidence(tool.displayName, displayPath(item.path), `Object declares ${width} properties.`)
        );
      }
      accumulator.propertyCount += width;

      for (const requiredName of required) {
        if (!Object.prototype.hasOwnProperty.call(properties, requiredName)) {
          markMalformedSchema(
            accumulator,
            tool,
            `${item.path}.required`,
            `Required property "${schemaPathSegment(requiredName)}" is not declared in properties.`
          );
        }
      }

      for (const propertyName of propertyNames) {
        const propertySchema = properties[propertyName];
        if (required.has(propertyName)) accumulator.requiredPropertyCount += 1;
        else accumulator.optionalPropertyCount += 1;
        if (!isRecord(propertySchema) || typeof propertySchema.description !== 'string' || !propertySchema.description.trim()) {
          accumulator.propertiesMissingDescriptions += 1;
          retainSchemaEvidence(
            accumulator.missingDescriptionEvidence,
            evidence(
              tool.displayName,
              `${item.path}.properties.${schemaPathSegment(propertyName)}`,
              `Property "${schemaPathSegment(propertyName)}" has no description.`
            )
          );
        }
        addChild({
          schema: propertySchema,
          path: `${item.path}.properties.${schemaPathSegment(propertyName)}`,
        });
      }
    }

    const hasStringType = current.type === 'string'
      || (Array.isArray(current.type) && current.type.includes('string'));
    if (hasStringType) {
      const hasConstraint = [
        'const',
        'enum',
        'format',
        'maxLength',
        'minLength',
        'pattern',
      ].some((key) => current[key] !== undefined);
      if (!hasConstraint) {
        accumulator.unconstrainedStringCount += 1;
        retainSchemaEvidence(
          accumulator.unconstrainedEvidence,
          evidence(
            tool.displayName,
            displayPath(item.path),
            'String accepts arbitrary text without a format, pattern, length, enum, or const constraint.'
          )
        );
      }
    }

    if (objectLike && (!isRecord(properties) || propertyNames.length === 0)) {
      if (current.additionalProperties !== false) {
        accumulator.unconstrainedObjectCount += 1;
        retainSchemaEvidence(
          accumulator.unconstrainedEvidence,
          evidence(
            tool.displayName,
            displayPath(item.path),
            'Object accepts unspecified fields and declares no properties.'
          )
        );
      }
    }

    for (const key of ['items', 'contains'] as const) {
      if (current[key] !== undefined) {
        addChild({ schema: current[key], path: `${item.path}.${key}` });
      }
    }
    if (typeof current.additionalProperties === 'object' && current.additionalProperties !== null) {
      addChild({
        schema: current.additionalProperties,
        path: `${item.path}.additionalProperties`,
      });
    }
    for (const key of ['not', 'if', 'then', 'else'] as const) {
      if (current[key] !== undefined) {
        addChild({ schema: current[key], path: `${item.path}.${key}` });
      }
    }

    for (const keyword of ['allOf', 'anyOf', 'oneOf', 'prefixItems'] as const) {
      const keywordChildren = current[keyword];
      if (keywordChildren === undefined) continue;
      if (!Array.isArray(keywordChildren)) {
        markMalformedSchema(accumulator, tool, `${item.path}.${keyword}`, `${keyword} must be an array.`);
        continue;
      }
      const retainedLength = Math.min(
        keywordChildren.length,
        Math.max(0, maximumChildren - childrenToVisit.length)
      );
      for (let index = 0; index < retainedLength; index += 1) {
        addChild({
          schema: keywordChildren[index],
          path: `${item.path}.${keyword}[${index}]`,
        });
      }
      if (retainedLength < keywordChildren.length) {
        markNodeLimit(tool, `${item.path}.${keyword}[${retainedLength}]`);
      }
    }

    for (const keyword of ['$defs', 'definitions', 'dependentSchemas', 'patternProperties'] as const) {
      const keywordChildren = current[keyword];
      if (keywordChildren === undefined) continue;
      if (!isRecord(keywordChildren)) {
        markMalformedSchema(accumulator, tool, `${item.path}.${keyword}`, `${keyword} must be an object.`);
        continue;
      }
      const boundedChildren = boundedOwnKeys(
        keywordChildren,
        Math.max(0, maximumChildren - childrenToVisit.length)
      );
      for (const key of boundedChildren.keys) {
        addChild({
          schema: keywordChildren[key],
          path: `${item.path}.${keyword}.${schemaPathSegment(key)}`,
        });
      }
      if (boundedChildren.truncated) markNodeLimit(tool, `${item.path}.${keyword}`);
    }

    work.push({ kind: 'exit', schema: current });
    for (let index = childrenToVisit.length - 1; index >= 0; index -= 1) {
      const child = childrenToVisit[index];
      work.push({ kind: 'visit', schema: child.schema, path: child.path, depth: item.depth + 1 });
    }
  }
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

const duplicateGroupLabel = (group: readonly string[]): string => {
  const retained = group.slice(0, EVIDENCE_LIMIT).join(', ');
  return group.length <= EVIDENCE_LIMIT
    ? retained
    : `${retained}, … (${group.length - EVIDENCE_LIMIT} more)`;
};

const findOverlappingPairs = (
  tools: readonly ToolRecord[],
  select: (tool: ToolRecord) => string | null,
  stopWords: Set<string>,
  threshold: number,
  minimumOverlap: number
): PairAnalysis => {
  const values = tools
    .map((tool) => {
      const selected = select(tool);
      return selected ? { tool, normalized: normalizeText(selected), tokens: similarityTokens(selected, stopWords) } : null;
    })
    .filter((value): value is NonNullable<typeof value> => Boolean(value))
    .sort((left, right) => (
      compareText(left.normalized, right.normalized)
        || compareText(left.tool.displayName, right.tool.displayName)
    ));
  const retainedPairs: PairEvidence[] = [];
  let comparisonCount = 0;
  let pairCount = 0;

  const pairOrder = (left: PairEvidence, right: PairEvidence): number => (
    compareText(`${left.left}, ${left.right}`, `${right.left}, ${right.right}`)
      || compareText(String(left.score), String(right.score))
  );

  const retainPair = (pair: PairEvidence): void => {
    const insertionIndex = retainedPairs.findIndex((retained) => pairOrder(pair, retained) < 0);
    if (insertionIndex === -1) retainedPairs.push(pair);
    else retainedPairs.splice(insertionIndex, 0, pair);
    if (retainedPairs.length > OVERLAP_PAIR_RETENTION_LIMIT) retainedPairs.pop();
  };

  for (let leftIndex = 0; leftIndex < values.length; leftIndex += 1) {
    for (let rightIndex = leftIndex + 1; rightIndex < values.length; rightIndex += 1) {
      if (comparisonCount >= SIMILARITY_COMPARISON_LIMIT) {
        return {
          comparisonCount,
          comparisonLimitReached: true,
          pairCount,
          retainedPairs,
        };
      }
      comparisonCount += 1;
      const left = values[leftIndex];
      const right = values[rightIndex];
      if (left.normalized === right.normalized) continue;
      const similarity = diceSimilarity(left.tokens, right.tokens);
      if (similarity.overlap >= minimumOverlap && similarity.score >= threshold) {
        const names = [left.tool.displayName, right.tool.displayName]
          .sort(compareText);
        pairCount += 1;
        retainPair({ left: names[0], right: names[1], score: round(similarity.score, 3) });
      }
    }
  }

  return {
    comparisonCount,
    comparisonLimitReached: false,
    pairCount,
    retainedPairs,
  };
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
  if (
    index === 0
    || ['and', 'can', 'may', 'must', 'or', 'should', 'then', 'to', 'will'].includes(previous)
  ) {
    return true;
  }

  const preceding = tokens.slice(Math.max(0, index - 3), index);
  if (preceding.some((token) => ['from', 'in', 'of', 'through', 'within'].includes(token))) {
    return false;
  }
  if (previous === 'a' || previous === 'an' || previous === 'the') return false;
  return false;
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
  const analyzedRawTools = selectCanonicalValues(extracted.tools, TOOL_ANALYSIS_LIMIT);
  const tools = analyzedRawTools.map((entry, index) => normalizeTool(entry.value, index));
  const omittedToolCount = extracted.tools.length - analyzedRawTools.length;
  const findings = emptyFindings();

  const canonicalDefinitions = canonicalizeCollection(tools.map((tool) => tool.raw), '');
  const serializedDefinitions = canonicalDefinitions.serialized;
  const serializedDefinitionBytes = canonicalDefinitions.truncationReasons.has('bytes')
    ? CANONICAL_BYTE_LIMIT
    : utf8ByteLength(serializedDefinitions);
  const estimatedContextTokens = serializedDefinitionBytes === 0
    ? 0
    : Math.ceil(serializedDefinitionBytes / 4);

  const fingerprintResult = canonicalizeCollection(tools
    .map((tool) => ({
      description: tool.textTruncated && isRecord(tool.raw)
        ? tool.raw.description
        : tool.description,
      inputSchema: tool.inputSchema,
      name: tool.textTruncated && isRecord(tool.raw) ? tool.raw.name : tool.name,
      outputSchema: tool.outputSchema,
    })), '[]');
  const canonicalFingerprint = fingerprintResult.serialized;

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
    malformedEvidenceCount: 0,
    unconstrainedEvidence: [],
    missingDescriptionEvidence: [],
    depthEvidence: [],
    widthEvidence: [],
    depthLimitReached: false,
    nodeLimitReached: false,
    budgetEvidence: [],
  };

  for (const tool of tools) {
    if (schemaAccumulator.schemaNodeCount >= SCHEMA_NODE_LIMIT) break;
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
    visitSchema(tool.inputSchema, tool, '$.inputSchema', 1, schemaAccumulator);
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

  const budgetEvidence: ToolSurfaceEvidenceV1[] = [];
  if (omittedToolCount > 0) {
    budgetEvidence.push(evidence(
      '<surface>',
      '$.tools',
      `Analyzed ${tools.length} of ${extracted.tools.length} tools; ${omittedToolCount} were omitted by the deterministic tool limit of ${TOOL_ANALYSIS_LIMIT}.`
    ));
  }
  const truncatedTextCount = tools.filter((tool) => tool.textTruncated).length;
  if (truncatedTextCount > 0) {
    budgetEvidence.push(evidence(
      '<surface>',
      '$.tools[*].name|description',
      `Text analysis used at most ${TEXT_ANALYSIS_CHARACTER_LIMIT} characters for ${truncatedTextCount} tools; canonical serialization retained its independent byte budget.`
    ));
  }
  const canonicalReasons = new Set([
    ...canonicalDefinitions.truncationReasons,
    ...fingerprintResult.truncationReasons,
  ]);
  if (canonicalReasons.size > 0 || canonicalDefinitions.omittedValueCount > 0 || fingerprintResult.omittedValueCount > 0) {
    const limits = [
      canonicalReasons.has('depth') ? `depth ${CANONICAL_DEPTH_LIMIT}` : null,
      canonicalReasons.has('nodes') ? `${CANONICAL_NODE_LIMIT} nodes` : null,
      canonicalReasons.has('bytes') ? `${CANONICAL_BYTE_LIMIT} bytes` : null,
    ].filter((limit): limit is string => Boolean(limit));
    budgetEvidence.push(evidence(
      '<surface>',
      '$.tools',
      `Canonical serialization was truncated at deterministic ${limits.join(', ')} limit${limits.length === 1 ? '' : 's'}; the fingerprint covers the retained canonical representation only.`
    ));
  }
  budgetEvidence.push(...schemaAccumulator.budgetEvidence);
  if (overlappingNames.comparisonLimitReached) {
    budgetEvidence.push(evidence(
      '<surface>',
      '$.tools[*].name',
      `Name similarity stopped after ${overlappingNames.comparisonCount} comparisons (limit ${SIMILARITY_COMPARISON_LIMIT}); ${overlappingNames.pairCount} overlaps were observed and at most ${OVERLAP_PAIR_RETENTION_LIMIT} pairs were retained.`
    ));
  }
  if (overlappingDescriptions.comparisonLimitReached) {
    budgetEvidence.push(evidence(
      '<surface>',
      '$.tools[*].description',
      `Description similarity stopped after ${overlappingDescriptions.comparisonCount} comparisons (limit ${SIMILARITY_COMPARISON_LIMIT}); ${overlappingDescriptions.pairCount} overlaps were observed and at most ${OVERLAP_PAIR_RETENTION_LIMIT} pairs were retained.`
    ));
  }

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

  if (budgetEvidence.length > 0) {
    addFinding(findings, {
      id: 'analysis.incomplete-budget',
      category: 'availability',
      severity: 'medium',
      kind: 'review-signal',
      title: 'Analysis was truncated by deterministic budgets',
      summary: 'One or more deterministic safety budgets were reached, so metrics and the fingerprint describe only the analyzed portion of this tool surface.',
      evidence: budgetEvidence,
      remediation: 'Reduce or partition the tool surface and simplify oversized schemas, then analyze each bounded subset separately.',
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
      omittedEvidenceCount: schemaAccumulator.malformedEvidenceCount
        - schemaAccumulator.malformedEvidence.length,
      remediation: 'Validate every tool against the MCP Tool schema and each inputSchema against JSON Schema before publishing tools/list.',
    });
  }

  const surfaceSeverity = contextSeverity(extracted.tools.length, estimatedContextTokens);
  if (surfaceSeverity) {
    const serializationIncomplete = canonicalDefinitions.truncationReasons.size > 0
      || canonicalDefinitions.omittedValueCount > 0
      || omittedToolCount > 0;
    addFinding(findings, {
      id: 'context.large-tool-surface',
      category: 'context-cost',
      severity: surfaceSeverity,
      kind: 'measurement',
      title: 'Large tool surface increases context cost',
      summary: serializationIncomplete
        ? `${extracted.tools.length} definitions reached ${serializedDefinitionBytes} analyzed bytes (approximately ${estimatedContextTokens} tokens at four UTF-8 bytes per token) before deterministic analysis limits were applied.`
        : `${extracted.tools.length} definitions serialize to ${serializedDefinitionBytes} bytes (approximately ${estimatedContextTokens} tokens at four UTF-8 bytes per token).`,
      evidence: [evidence(
        '<surface>',
        '$.tools',
        serializationIncomplete
          ? `${extracted.tools.length} tools; at least ${serializedDefinitionBytes} analyzed serialized bytes before truncation.`
          : `${extracted.tools.length} tools; ${serializedDefinitionBytes} serialized bytes.`
      )],
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
      omittedEvidenceCount: schemaAccumulator.unconstrainedStringCount
        + schemaAccumulator.unconstrainedObjectCount
        - schemaAccumulator.unconstrainedEvidence.length,
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
      omittedEvidenceCount: schemaAccumulator.propertiesMissingDescriptions
        - schemaAccumulator.missingDescriptionEvidence.length,
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

  if (duplicateNameGroups.length > 0 || overlappingNames.pairCount > 0) {
    addFinding(findings, {
      id: 'ambiguity.names',
      category: 'ambiguity',
      severity: duplicateNameGroups.length > 0 ? 'high' : 'medium',
      kind: 'quality-signal',
      title: 'Tool names are duplicate or highly overlapping',
      summary: `${duplicateNameGroups.length} duplicate-name groups and ${overlappingNames.pairCount} highly overlapping name pairs were found${overlappingNames.comparisonLimitReached ? ' before the comparison budget was reached' : ''}.`,
      evidence: [
        ...duplicateNameGroups.map((group) => evidence(
          duplicateGroupLabel(group),
          '$.name',
          `Duplicate normalized name shared by ${group.length} definitions.`
        )),
        ...overlappingNames.retainedPairs.map((pair) => evidence(
          `${pair.left}, ${pair.right}`,
          '$.name',
          `Name token similarity is ${pair.score}.`
        )),
      ],
      omittedEvidenceCount: overlappingNames.pairCount - overlappingNames.retainedPairs.length,
      remediation: 'Give every tool a unique action-and-target name and encode the meaningful distinction in the name, not only the description.',
    });
  }

  if (duplicateDescriptionGroups.length > 0 || overlappingDescriptions.pairCount > 0) {
    addFinding(findings, {
      id: 'ambiguity.descriptions',
      category: 'ambiguity',
      severity: 'medium',
      kind: 'quality-signal',
      title: 'Descriptions do not clearly distinguish tools',
      summary: `${duplicateDescriptionGroups.length} duplicate-description groups and ${overlappingDescriptions.pairCount} highly overlapping description pairs were found${overlappingDescriptions.comparisonLimitReached ? ' before the comparison budget was reached' : ''}.`,
      evidence: [
        ...duplicateDescriptionGroups.map((group) => evidence(
          duplicateGroupLabel(group),
          '$.description',
          `Identical normalized description shared by ${group.length} definitions.`
        )),
        ...overlappingDescriptions.retainedPairs.map((pair) => evidence(
          `${pair.left}, ${pair.right}`,
          '$.description',
          `Description token similarity is ${pair.score}.`
        )),
      ],
      omittedEvidenceCount: overlappingDescriptions.pairCount - overlappingDescriptions.retainedPairs.length,
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
      toolCount: extracted.tools.length,
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
        overlappingNamePairCount: overlappingNames.pairCount,
        duplicateDescriptionGroupCount: duplicateDescriptionGroups.length,
        overlappingDescriptionPairCount: overlappingDescriptions.pairCount,
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
