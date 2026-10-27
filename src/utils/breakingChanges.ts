/**
 * Breaking-change classifier for MCP tool interfaces.
 *
 * Compares two snapshots of what a server lists (tools/list, and prompts and
 * resources when both snapshots recorded them) and explains each difference
 * from the point of view of a client that cached the earlier listing:
 *
 *   - breaking: a call or a result parser that worked against the old listing
 *     can now fail (a removed tool, a new required input, a narrowed type, a
 *     changed output contract);
 *   - risky: nothing fails validation, but behavior can change (a rewritten
 *     description changes tool selection, an annotation now allows writes);
 *   - safe: additive or loosening changes old callers never notice.
 *
 * Input-schema rules reuse the report diff's JSON Schema comparison
 * (schemaChanges in ./reportDiff), so the playground, the report history and
 * this classifier agree on what "narrowed" means. The module imports nothing
 * else at runtime but a path constant: the main Worker bundles it for the weekly watch.
 */
import { BREAKING_CHANGES_GUIDE_PATH } from './breakingChangesRoute';
import {
  redactedSchemaChanges,
  schemaChanges,
  type InterfaceSnapshot,
  type ReportDiffChange,
} from './reportDiff';

export type BreakingChangeSeverity = 'breaking' | 'risky' | 'safe';

export const BREAKING_CHANGE_SEVERITIES: readonly BreakingChangeSeverity[] = ['breaking', 'risky', 'safe'];

export type BreakingChangeRule =
  | 'tool-removed'
  | 'tool-renamed'
  | 'tool-added'
  | 'required-input-added'
  | 'input-removed'
  | 'input-removed-ignored'
  | 'input-type-narrowed'
  | 'input-type-loosened'
  | 'input-constrained'
  | 'enum-value-removed'
  | 'enum-restricted'
  | 'enum-value-added'
  | 'enum-relaxed'
  | 'extra-inputs-rejected'
  | 'extra-inputs-accepted'
  | 'optional-input-added'
  | 'input-now-optional'
  | 'input-default-changed'
  | 'input-guidance-changed'
  | 'output-schema-added'
  | 'output-schema-removed'
  | 'output-property-removed'
  | 'output-property-retyped'
  | 'output-property-optional'
  | 'output-property-added'
  | 'output-type-narrowed'
  | 'output-enum-value-added'
  | 'output-enum-value-removed'
  | 'description-changed'
  | 'description-reworded'
  | 'title-changed'
  | 'annotation-risk'
  | 'annotation-changed'
  | 'prompt-removed'
  | 'prompt-added'
  | 'prompt-argument-required'
  | 'prompt-argument-removed'
  | 'prompt-argument-added'
  | 'resource-removed'
  | 'resource-added'
  | 'schema-unclassified';

export type BreakingChangeSubjectKind = 'tool' | 'prompt' | 'resource' | 'resourceTemplate';

export interface BreakingChangeFinding {
  severity: BreakingChangeSeverity;
  rule: BreakingChangeRule;
  subjectKind: BreakingChangeSubjectKind;
  /** The tool, prompt or resource the finding belongs to (the old name for a rename). */
  subject: string;
  /** Dotted location, e.g. `tools.search.inputSchema.properties.limit`. */
  path: string;
  title: string;
  /** One plain-English sentence on why the change has this severity. */
  reason: string;
}

export interface BreakingChangeGroup {
  subjectKind: BreakingChangeSubjectKind;
  subject: string;
  /** The worst severity among the group's findings. */
  severity: BreakingChangeSeverity;
  findings: BreakingChangeFinding[];
}

export interface BreakingChangeReport {
  findings: BreakingChangeFinding[];
  groups: BreakingChangeGroup[];
  counts: Record<BreakingChangeSeverity, number>;
  /** "2 breaking, 1 risky, 4 safe", or "No changes". */
  summary: string;
  hasBreakingChanges: boolean;
  /** What could not be compared because one snapshot did not record it. */
  limitations: string[];
}

export interface ToolDefinitionSnapshot {
  name: string;
  title?: string;
  description?: string;
  /** Omitted when only a fingerprint was stored. */
  inputSchema?: unknown;
  inputSchemaFingerprint?: string;
  outputSchema?: unknown;
  /** Present when the tool declared an outputSchema but only its fingerprint was kept. */
  outputSchemaFingerprint?: string;
  annotations?: Record<string, unknown>;
}

export interface PromptArgumentSnapshot {
  name: string;
  required?: boolean;
}

export interface PromptSnapshot {
  name: string;
  description?: string;
  arguments?: PromptArgumentSnapshot[];
}

/**
 * One observation of a server's listed interface. A section that is
 * `undefined` was not observed, and is never compared; the `*Observed` flags
 * say which tool fields the source records at all (a report snapshot keeps no
 * output schemas, titles or annotations).
 */
export interface ToolSurfaceSnapshot {
  tools: ToolDefinitionSnapshot[];
  prompts?: PromptSnapshot[];
  resources?: string[];
  resourceTemplates?: string[];
  outputSchemasObserved: boolean;
  annotationsObserved: boolean;
  titlesObserved: boolean;
  promptArgumentsObserved: boolean;
}

// The guide explains each rule; findings link to its sections.
export { BREAKING_CHANGES_GUIDE_PATH, BREAKING_CHANGES_TOOL_PATH } from './breakingChangesRoute';

const RULE_ANCHORS: Record<BreakingChangeRule, string> = {
  'tool-removed': 'removing-or-renaming-a-tool',
  'tool-renamed': 'removing-or-renaming-a-tool',
  'tool-added': 'changes-that-are-safe',
  'required-input-added': 'adding-a-required-input',
  'input-removed': 'removing-an-input',
  'input-removed-ignored': 'removing-an-input',
  'input-type-narrowed': 'narrowing-an-input',
  'input-type-loosened': 'changes-that-are-safe',
  'input-constrained': 'narrowing-an-input',
  'enum-value-removed': 'narrowing-an-input',
  'enum-restricted': 'narrowing-an-input',
  'enum-value-added': 'changes-that-are-safe',
  'enum-relaxed': 'changes-that-are-safe',
  'extra-inputs-rejected': 'narrowing-an-input',
  'extra-inputs-accepted': 'changes-that-are-safe',
  'optional-input-added': 'changes-that-are-safe',
  'input-now-optional': 'changes-that-are-safe',
  'input-default-changed': 'rewriting-a-description',
  'input-guidance-changed': 'changes-that-are-safe',
  'output-schema-added': 'changing-the-output-contract',
  'output-schema-removed': 'changing-the-output-contract',
  'output-property-removed': 'changing-the-output-contract',
  'output-property-retyped': 'changing-the-output-contract',
  'output-property-optional': 'changing-the-output-contract',
  'output-property-added': 'changes-that-are-safe',
  'output-type-narrowed': 'changes-that-are-safe',
  'output-enum-value-added': 'changing-the-output-contract',
  'output-enum-value-removed': 'changes-that-are-safe',
  'description-changed': 'rewriting-a-description',
  'description-reworded': 'changes-that-are-safe',
  'title-changed': 'changes-that-are-safe',
  'annotation-risk': 'changing-annotations',
  'annotation-changed': 'changing-annotations',
  'prompt-removed': 'prompts-and-resources',
  'prompt-added': 'prompts-and-resources',
  'prompt-argument-required': 'prompts-and-resources',
  'prompt-argument-removed': 'prompts-and-resources',
  'prompt-argument-added': 'prompts-and-resources',
  'resource-removed': 'prompts-and-resources',
  'resource-added': 'prompts-and-resources',
  'schema-unclassified': 'changes-mcptest-cannot-classify',
};

export const BREAKING_CHANGE_RULES = Object.keys(RULE_ANCHORS) as BreakingChangeRule[];

/** The guide section that explains a finding's rule. */
export const explanationPathForRule = (rule: BreakingChangeRule): string => (
  `${BREAKING_CHANGES_GUIDE_PATH}#${RULE_ANCHORS[rule]}`
);

type JsonRecord = Record<string, unknown>;

const isRecord = (value: unknown): value is JsonRecord => (
  Boolean(value) && typeof value === 'object' && !Array.isArray(value)
);

const stableValue = (value: unknown): unknown => {
  if (Array.isArray(value)) return value.map(stableValue);
  if (isRecord(value)) {
    return Object.fromEntries(Object.keys(value).sort().map((key) => [key, stableValue(value[key])]));
  }
  return value;
};
const stableString = (value: unknown): string => JSON.stringify(stableValue(value ?? null));
const same = (left: unknown, right: unknown): boolean => stableString(left) === stableString(right);

const REDACTED_VALUE = '[REDACTED]';
const text = (value: unknown): string | undefined => (typeof value === 'string' && value ? value : undefined);
const quote = (value: string): string => `"${value}"`;
const display = (value: unknown): string => (typeof value === 'string' ? quote(value) : JSON.stringify(value));

const SEVERITY_RANK: Record<BreakingChangeSeverity, number> = { breaking: 0, risky: 1, safe: 2 };
const SUBJECT_KIND_RANK: Record<BreakingChangeSubjectKind, number> = {
  tool: 0, prompt: 1, resource: 2, resourceTemplate: 3,
};

const finding = (
  severity: BreakingChangeSeverity,
  rule: BreakingChangeRule,
  subjectKind: BreakingChangeSubjectKind,
  subject: string,
  path: string,
  title: string,
  reason: string
): BreakingChangeFinding => ({ severity, rule, subjectKind, subject, path, title, reason });

// --- Parsing pasted payloads ---

const toolFromValue = (value: unknown): ToolDefinitionSnapshot | undefined => {
  if (!isRecord(value)) return undefined;
  const name = text(value.name);
  if (!name) return undefined;
  return {
    name,
    ...(text(value.title) ? { title: value.title as string } : {}),
    ...(typeof value.description === 'string' ? { description: value.description } : {}),
    inputSchema: value.inputSchema ?? {},
    ...(value.outputSchema !== undefined ? { outputSchema: value.outputSchema } : {}),
    ...(isRecord(value.annotations) ? { annotations: value.annotations } : {}),
  };
};

const promptFromValue = (value: unknown): PromptSnapshot | undefined => {
  if (!isRecord(value)) return undefined;
  const name = text(value.name);
  if (!name) return undefined;
  const args = Array.isArray(value.arguments)
    ? value.arguments.flatMap((argument): PromptArgumentSnapshot[] => {
      if (!isRecord(argument) || !text(argument.name)) return [];
      return [{ name: argument.name as string, ...(argument.required === true ? { required: true } : {}) }];
    })
    : [];
  return {
    name,
    ...(typeof value.description === 'string' ? { description: value.description } : {}),
    arguments: args,
  };
};

const resourceName = (value: unknown, key: 'uri' | 'uriTemplate'): string[] => {
  if (typeof value === 'string' && value) return [value];
  if (!isRecord(value)) return [];
  const name = text(value[key]) ?? text(value.name);
  return name ? [name] : [];
};

const uniqueByName = <T extends { name: string }>(items: T[]): T[] => {
  const seen = new Set<string>();
  return items.filter((item) => (seen.has(item.name) ? false : (seen.add(item.name), true)));
};

export type ToolsListParseResult =
  | { ok: true; snapshot: ToolSurfaceSnapshot; error?: undefined }
  | { ok: false; error: string; snapshot?: undefined };

/**
 * Accepts what people paste: a tools/list result (`{"tools": [...]}`), the
 * whole JSON-RPC response around it, a bare array of tools, a batch of
 * responses, or one object combining `tools`, `prompts`, `resources` and
 * `resourceTemplates`.
 */
export const parseToolsListPayload = (input: string | unknown): ToolsListParseResult => {
  let value: unknown = input;
  if (typeof input === 'string') {
    if (!input.trim()) return { ok: false, error: 'Paste a tools/list result.' };
    try {
      value = JSON.parse(input);
    } catch (error) {
      return { ok: false, error: `This is not valid JSON: ${error instanceof Error ? error.message : String(error)}` };
    }
  }
  const sections: JsonRecord[] = [];
  const collect = (candidate: unknown): void => {
    if (Array.isArray(candidate)) {
      if (candidate.every((item) => isRecord(item) && ('jsonrpc' in item || 'result' in item))) {
        candidate.forEach(collect);
      } else {
        sections.push({ tools: candidate });
      }
      return;
    }
    if (!isRecord(candidate)) return;
    if (isRecord(candidate.result)) {
      collect(candidate.result);
      return;
    }
    sections.push(candidate);
  };
  collect(value);
  if (isRecord(value) && isRecord(value.error)) {
    return { ok: false, error: 'This is a JSON-RPC error response, not a tools/list result.' };
  }
  const listed = (key: string) => sections.filter((section) => Array.isArray(section[key]))
    .flatMap((section) => section[key] as unknown[]);
  const hasSection = (key: string) => sections.some((section) => Array.isArray(section[key]));
  if (!hasSection('tools')) {
    return { ok: false, error: 'No "tools" array found. Paste the result of a tools/list request.' };
  }
  const rawTools = listed('tools');
  const tools = uniqueByName(rawTools.flatMap((tool) => toolFromValue(tool) ?? []));
  if (tools.length < rawTools.length && tools.length === 0) {
    return { ok: false, error: 'The "tools" array has no entries with a name.' };
  }
  return {
    ok: true,
    snapshot: {
      tools,
      ...(hasSection('prompts') ? { prompts: uniqueByName(listed('prompts').flatMap((prompt) => promptFromValue(prompt) ?? [])) } : {}),
      ...(hasSection('resources') ? { resources: [...new Set(listed('resources').flatMap((resource) => resourceName(resource, 'uri')))] } : {}),
      ...(hasSection('resourceTemplates') ? { resourceTemplates: [...new Set(listed('resourceTemplates').flatMap((template) => resourceName(template, 'uriTemplate')))] } : {}),
      outputSchemasObserved: true,
      annotationsObserved: true,
      titlesObserved: true,
      promptArgumentsObserved: true,
    },
  };
};

/**
 * A stored playground or report snapshot as a classifier input. Report
 * snapshots record neither titles nor output schemas; neither records
 * annotations or prompt arguments. Undefined when the tool list is unknown.
 */
export const toolSurfaceFromInterfaceSnapshot = (snapshot: InterfaceSnapshot): ToolSurfaceSnapshot | undefined => {
  if (!snapshot.tools) return undefined;
  return {
    tools: snapshot.tools.map((tool) => ({
      name: tool.name,
      ...(tool.title ? { title: tool.title } : {}),
      ...(tool.description !== undefined ? { description: tool.description } : {}),
      ...(tool.inputSchema !== undefined ? { inputSchema: tool.inputSchema } : {}),
      inputSchemaFingerprint: tool.inputSchemaFingerprint,
      ...(tool.outputSchema !== undefined ? { outputSchema: tool.outputSchema } : {}),
      ...(tool.outputSchemaFingerprint ? { outputSchemaFingerprint: tool.outputSchemaFingerprint } : {}),
    })),
    ...(snapshot.prompts ? { prompts: snapshot.prompts.map((name) => ({ name })) } : {}),
    ...(snapshot.resources ? { resources: [...snapshot.resources] } : {}),
    ...(snapshot.resourceTemplates ? { resourceTemplates: [...snapshot.resourceTemplates] } : {}),
    outputSchemasObserved: snapshot.outputSchemasObserved,
    annotationsObserved: false,
    titlesObserved: snapshot.source === 'playground',
    promptArgumentsObserved: false,
  };
};

// --- Input schemas ---

/** `inputSchema.properties.filter.properties.kind` -> `filter.kind`; `items` reads as `[]`. */
const describeLocation = (path: string, root: string): string => {
  const relative = path.startsWith(`${root}.`) ? path.slice(root.length + 1) : path === root ? '' : path;
  const parts = relative.split('.');
  const names: string[] = [];
  for (let index = 0; index < parts.length; index += 1) {
    if (parts[index] === 'properties' && index + 1 < parts.length) {
      names.push(parts[index + 1]);
      index += 1;
    } else if (parts[index] === 'items' && names.length > 0) {
      names[names.length - 1] = `${names[names.length - 1]}[]`;
    } else if (parts[index] === 'items') {
      names.push('[]');
    }
  }
  return names.join('.');
};

const lastSegment = (path: string): string => path.slice(path.lastIndexOf('.') + 1);

const parentLocation = (path: string, root: string, trailing: number): string => (
  describeLocation(path.split('.').slice(0, -trailing).join('.'), root)
);

const inputFinding = (tool: string, change: ReportDiffChange, root: string): BreakingChangeFinding => {
  const path = change.path;
  const subject = `tools.${tool}.${path}`;
  const add = (severity: BreakingChangeSeverity, rule: BreakingChangeRule, title: string, reason: string) => (
    finding(severity, rule, 'tool', tool, subject, title, reason)
  );
  const where = (location: string) => (location ? ` ${quote(location)}` : '');
  const required = /\.required\.([^.]+)$/.exec(path);
  if (required) {
    const location = [parentLocation(path, root, 2), required[1]].filter(Boolean).join('.');
    if (change.classification === 'breaking') {
      return add('breaking', 'required-input-added', `Input${where(location)} is now required`,
        `Callers that cached the old schema do not send ${quote(location)}, so their calls will fail validation.`);
    }
    if (change.classification === 'change') {
      return add('safe', 'input-now-optional', `Input${where(location)} is now optional`,
        'Existing callers still send it, and new callers may leave it out.');
    }
  }
  const key = lastSegment(path);
  const location = describeLocation(path, root);
  if (/\.properties\.[^.]+$/.test(path)) {
    switch (change.classification) {
      case 'addition':
        return add('safe', 'optional-input-added', `Optional input${where(location)} added`,
          'Old callers never send it and the server must work without it, so nothing they do changes.');
      case 'breaking':
        return add('breaking', 'input-constrained', `Input${where(location)} now has a declared schema`,
          'Values old callers sent as an undeclared extra input may now fail the new property schema.');
      case 'removal':
        return add('breaking', 'input-removed', `Input${where(location)} removed`,
          'The schema rejects undeclared properties, so callers that still send this input will fail validation.');
      case 'change':
        return add('risky', 'input-removed-ignored', `Input${where(location)} removed`,
          'Callers that still send it pass validation, but the server now ignores what they meant by it.');
      default:
        break;
    }
  }
  if (key === 'type') {
    if (change.classification === 'breaking') {
      return add('breaking', 'input-type-narrowed', `Input${where(location)} accepts fewer types`,
        `${change.detail.replace(/\.$/, '')}, so values old callers send can be rejected.`);
    }
    if (change.classification === 'change') {
      return add('safe', 'input-type-loosened', `Input${where(location)} accepts more types`,
        'Every value old callers send is still accepted.');
    }
  }
  if (key === 'enum') {
    if (change.classification === 'breaking' && change.title.includes('no longer accepts')) {
      return add('breaking', 'enum-value-removed', `Input${where(location)} lost allowed values`,
        `${change.detail.replace(/\.$/, '')}; callers that cached the old list may still send them and fail.`);
    }
    if (change.classification === 'breaking') {
      return add('breaking', 'enum-restricted', `Input${where(location)} is now limited to a fixed list`,
        'Any value outside the new list, which old callers were free to send, now fails validation.');
    }
    if (change.classification === 'addition') {
      return add('safe', 'enum-value-added', `Input${where(location)} accepts new values`,
        `${change.detail.replace(/\.$/, '')}; every value old callers send is still allowed.`);
    }
    if (change.classification === 'change') {
      return add('safe', 'enum-relaxed', `Input${where(location)} no longer restricts values`,
        'Every value old callers send is still accepted.');
    }
  }
  if (key === 'additionalProperties') {
    if (change.classification === 'breaking') {
      return add('breaking', 'extra-inputs-rejected', `${location ? `Input ${quote(location)}` : 'The input object'} rejects undeclared properties`,
        'Callers that send any property the schema does not declare will now fail validation.');
    }
    if (change.classification === 'change') {
      return add('safe', 'extra-inputs-accepted', `${location ? `Input ${quote(location)}` : 'The input object'} accepts undeclared properties`,
        'Everything old callers send is still accepted.');
    }
  }
  if (change.classification === 'breaking') {
    return add('breaking', 'input-type-narrowed', change.title, `${change.detail.replace(/\.$/, '')}.`);
  }
  if (change.classification === 'change' && key === 'default') {
    return add('risky', 'input-default-changed', `Default of${where(location) || ' the input'} changed`,
      'Callers that omit this input now get different behavior without changing anything.');
  }
  if (change.classification === 'change' || change.classification === 'addition') {
    return add('safe', 'input-guidance-changed', `Input guidance${where(location)} changed`,
      `The ${key} keyword changed without making any previously valid call invalid.`);
  }
  return add('risky', 'schema-unclassified', `Input${where(location)} changed in a way mcptest cannot classify`,
    `The ${key} keyword changed in a way no rule covers, so check by hand whether old calls still validate.`);
};

const compareInputSchemas = (
  before: ToolDefinitionSnapshot,
  after: ToolDefinitionSnapshot
): BreakingChangeFinding[] => {
  const root = 'inputSchema';
  if (before.inputSchema === undefined || after.inputSchema === undefined) {
    if (before.inputSchemaFingerprint && after.inputSchemaFingerprint
        && before.inputSchemaFingerprint !== after.inputSchemaFingerprint) {
      return [finding('risky', 'schema-unclassified', 'tool', after.name, `tools.${after.name}.${root}`,
        'Input schema changed', 'Only schema fingerprints were stored, so the change could not be classified.')];
    }
    return [];
  }
  if (same(before.inputSchema, after.inputSchema)) return [];
  const redacted = redactedSchemaChanges(before.inputSchema, after.inputSchema, after.name, root);
  const redactedPaths = new Set(redacted.map((change) => change.path));
  const comparable = schemaChanges(before.inputSchema, after.inputSchema, after.name, root)
    .filter((change) => !redactedPaths.has(change.path));
  if (comparable.length > 0) return comparable.map((change) => inputFinding(after.name, change, root));
  if (redacted.length > 0) {
    return [finding('risky', 'schema-unclassified', 'tool', after.name, `tools.${after.name}.${root}`,
      'Input schema changed in a redacted part', 'The differing part was redacted from a stored snapshot, so it could not be compared.')];
  }
  return [];
};

// --- Output schemas (the client reads them, so compatibility runs the other way) ---

const JSON_TYPES = new Set(['array', 'boolean', 'integer', 'null', 'number', 'object', 'string']);

type TypeSet = { status: 'any' } | { status: 'valid'; values: Set<string> } | { status: 'malformed' };

const typeSet = (schema: JsonRecord): TypeSet => {
  if (!Object.prototype.hasOwnProperty.call(schema, 'type')) return { status: 'any' };
  const values = Array.isArray(schema.type) ? schema.type : [schema.type];
  if (values.length === 0 || !values.every((value) => typeof value === 'string' && JSON_TYPES.has(value))) {
    return { status: 'malformed' };
  }
  return { status: 'valid', values: new Set(values as string[]) };
};

/** Whether every value an `after` type produces is a value of a `before` type. */
const typesWithin = (after: Set<string>, before: Set<string>): boolean => [...after].every((type) => (
  before.has(type) || (type === 'integer' && before.has('number'))
));

const displayTypes = (types: TypeSet): string => (
  types.status === 'valid' ? [...types.values].sort().join(' | ') : types.status === 'any' ? 'any type' : 'malformed'
);

const recordOf = (value: unknown): JsonRecord => (isRecord(value) ? value : {});
const stringSet = (value: unknown): Set<string> => new Set(
  Array.isArray(value) ? value.filter((item): item is string => typeof item === 'string') : []
);

const compareOutputSchemaNode = (
  tool: string,
  before: unknown,
  after: unknown,
  path: string,
  root: string,
  findings: BreakingChangeFinding[]
): void => {
  if (same(before, after) || before === REDACTED_VALUE || after === REDACTED_VALUE) return;
  const location = describeLocation(path, root);
  const label = location ? `Output field ${quote(location)}` : 'The structured result';
  const add = (severity: BreakingChangeSeverity, rule: BreakingChangeRule, title: string, reason: string, at = path) => {
    findings.push(finding(severity, rule, 'tool', tool, `tools.${tool}.${at}`, title, reason));
  };
  if (!isRecord(before) || !isRecord(after)) {
    add('risky', 'schema-unclassified', `${label} changed in a way mcptest cannot classify`,
      'At least one side is not a JSON Schema object, so check by hand whether clients still parse results.');
    return;
  }
  const beforeType = typeSet(before);
  const afterType = typeSet(after);
  const typesEqual = beforeType.status === afterType.status && (
    beforeType.status !== 'valid' || (afterType.status === 'valid'
      && typesWithin(beforeType.values, afterType.values) && typesWithin(afterType.values, beforeType.values))
  );
  if (!typesEqual) {
    if (beforeType.status === 'malformed' || afterType.status === 'malformed') {
      add('risky', 'schema-unclassified', `${label} type changed in a way mcptest cannot classify`,
        'At least one type declaration is malformed.', `${path}.type`);
    } else if (afterType.status === 'valid'
        && (beforeType.status === 'any' || typesWithin(afterType.values, (beforeType as { values: Set<string> }).values))) {
      add('safe', 'output-type-narrowed', `${label} returns fewer types`,
        `It now returns only ${displayTypes(afterType)}, which clients already handle.`, `${path}.type`);
    } else {
      add('breaking', 'output-property-retyped', `${label} changed type`,
        `It changed from ${displayTypes(beforeType)} to ${displayTypes(afterType)}, so clients that parse the old type can fail.`, `${path}.type`);
    }
  }
  const beforeProperties = recordOf(before.properties);
  const afterProperties = recordOf(after.properties);
  const beforeRequired = stringSet(before.required);
  const afterRequired = stringSet(after.required);
  for (const name of Object.keys(beforeProperties).sort()) {
    const childPath = `${path}.properties.${name}`;
    const childLocation = describeLocation(childPath, root);
    if (!Object.prototype.hasOwnProperty.call(afterProperties, name)) {
      add('breaking', 'output-property-removed', `Output field ${quote(childLocation)} removed`,
        'Clients that read this field from structuredContent will find it missing.', childPath);
      continue;
    }
    if (beforeRequired.has(name) && !afterRequired.has(name)) {
      add('breaking', 'output-property-optional', `Output field ${quote(childLocation)} is no longer guaranteed`,
        'It was required in every result, so clients may read it without checking; it can now be absent.', childPath);
    }
    compareOutputSchemaNode(tool, beforeProperties[name], afterProperties[name], childPath, root, findings);
  }
  for (const name of Object.keys(afterProperties).filter((key) => !Object.prototype.hasOwnProperty.call(beforeProperties, key)).sort()) {
    const childPath = `${path}.properties.${name}`;
    add('safe', 'output-property-added', `Output field ${quote(describeLocation(childPath, root))} added`,
      'Clients that do not know the field ignore it.', childPath);
  }
  if (Array.isArray(before.enum) && Array.isArray(after.enum)) {
    const beforeEnum = before.enum;
    const afterEnum = after.enum;
    const added = afterEnum.filter((value) => !beforeEnum.some((candidate) => same(candidate, value)));
    const removed = beforeEnum.filter((value) => !afterEnum.some((candidate) => same(candidate, value)));
    if (added.length) {
      add('risky', 'output-enum-value-added', `${label} can return new values`,
        `New values ${added.map(display).join(', ')} can reach clients that only handle the old list.`, `${path}.enum`);
    }
    if (removed.length) {
      add('safe', 'output-enum-value-removed', `${label} returns fewer values`,
        `Values ${removed.map(display).join(', ')} are no longer returned, and clients already handle the rest.`, `${path}.enum`);
    }
  } else if (Array.isArray(before.enum) && !Array.isArray(after.enum)) {
    add('risky', 'output-enum-value-added', `${label} is no longer limited to a fixed list`,
      'Clients that switch over the old list of values can receive values they do not handle.', `${path}.enum`);
  }
  if ('items' in before || 'items' in after) {
    compareOutputSchemaNode(tool, before.items, after.items, `${path}.items`, root, findings);
  }
};

const compareOutputSchemas = (before: ToolDefinitionSnapshot, after: ToolDefinitionSnapshot): BreakingChangeFinding[] => {
  const root = 'outputSchema';
  const path = `tools.${after.name}.${root}`;
  const hadOutput = before.outputSchema !== undefined || Boolean(before.outputSchemaFingerprint);
  const hasOutput = after.outputSchema !== undefined || Boolean(after.outputSchemaFingerprint);
  if (!hadOutput && hasOutput) {
    return [finding('breaking', 'output-schema-added', 'tool', after.name, path, 'Output schema added',
      'Clients that use structured output will now validate every result against this new contract and parse structuredContent instead of the text they relied on.')];
  }
  if (hadOutput && !hasOutput) {
    return [finding('breaking', 'output-schema-removed', 'tool', after.name, path, 'Output schema removed',
      'Clients that parse structuredContent against the declared contract lose it and can receive results in any shape.')];
  }
  if (!hadOutput) return [];
  if (before.outputSchema === undefined || after.outputSchema === undefined) {
    if (before.outputSchemaFingerprint && after.outputSchemaFingerprint
        && before.outputSchemaFingerprint !== after.outputSchemaFingerprint) {
      return [finding('risky', 'schema-unclassified', 'tool', after.name, path, 'Output schema changed',
        'Only schema fingerprints were stored, so the change could not be classified.')];
    }
    return [];
  }
  const findings: BreakingChangeFinding[] = [];
  compareOutputSchemaNode(after.name, before.outputSchema, after.outputSchema, root, root, findings);
  return findings;
};

// --- Descriptions, titles, annotations ---

const words = (value: string): Set<string> => new Set(value.toLowerCase().match(/[a-z0-9]+/g) ?? []);

/** Word-set overlap (Jaccard), 1 for identical wording and 0 for nothing in common. */
export const descriptionSimilarity = (left: string, right: string): number => {
  const a = words(left);
  const b = words(right);
  if (a.size === 0 && b.size === 0) return 1;
  const shared = [...a].filter((word) => b.has(word)).length;
  return shared / (a.size + b.size - shared);
};

/** Below this overlap a rewritten description counts as a significant change. */
export const SIGNIFICANT_DESCRIPTION_SIMILARITY = 0.6;

const compareDescriptions = (before: ToolDefinitionSnapshot, after: ToolDefinitionSnapshot): BreakingChangeFinding[] => {
  const left = before.description ?? '';
  const right = after.description ?? '';
  if (left === right || left === REDACTED_VALUE || right === REDACTED_VALUE) return [];
  const path = `tools.${after.name}.description`;
  if (descriptionSimilarity(left, right) < SIGNIFICANT_DESCRIPTION_SIMILARITY) {
    return [finding('risky', 'description-changed', 'tool', after.name, path, 'Description rewritten',
      !left
        ? 'Models now read a description where there was none, which changes when they pick this tool.'
        : !right
          ? 'Models lose the description they used to decide when to pick this tool.'
          : 'Models choose tools from their descriptions, so agents may now pick this tool in different situations or stop picking it.')];
  }
  return [finding('safe', 'description-reworded', 'tool', after.name, path, 'Description reworded',
    'The wording changed slightly; tool selection is unlikely to change.')];
};

type HintDirection = 'risk' | 'relief';

/**
 * How a hint change moves a client's trust. Absent hints take the spec
 * defaults (readOnlyHint false, idempotentHint false, openWorldHint true),
 * except destructiveHint: its default only applies to tools that are not
 * read-only and clients rarely act on it, so an absent hint counts as "not
 * declared" and adding destructiveHint: true is reported.
 */
const HINTS: Record<string, { fallback: boolean; riskyWhen: boolean; risk: string; relief: string }> = {
  readOnlyHint: {
    fallback: false, riskyWhen: false,
    risk: 'The tool no longer promises to be read-only, so clients that auto-approve read-only tools may now let it modify data.',
    relief: 'The tool now promises to be read-only.',
  },
  destructiveHint: {
    fallback: false, riskyWhen: true,
    risk: 'The tool now declares it may destroy data, so clients may start asking for confirmation and agents may avoid it.',
    relief: 'The tool no longer declares destructive updates.',
  },
  idempotentHint: {
    fallback: false, riskyWhen: false,
    risk: 'The tool no longer promises that repeated calls are harmless, so clients that retry it automatically may cause duplicate effects.',
    relief: 'The tool now promises repeated calls are harmless.',
  },
  openWorldHint: {
    fallback: true, riskyWhen: true,
    risk: 'The tool now declares it reaches external systems, which changes how clients that sandbox closed-world tools treat it.',
    relief: 'The tool now declares a closed world.',
  },
};

const compareAnnotations = (before: ToolDefinitionSnapshot, after: ToolDefinitionSnapshot): BreakingChangeFinding[] => {
  const left = before.annotations ?? {};
  const right = after.annotations ?? {};
  if (same(left, right)) return [];
  const findings: BreakingChangeFinding[] = [];
  const keys = [...new Set([...Object.keys(left), ...Object.keys(right)])].sort();
  for (const key of keys) {
    if (same(left[key], right[key])) continue;
    const path = `tools.${after.name}.annotations.${key}`;
    const hint = HINTS[key];
    if (hint) {
      const was = typeof left[key] === 'boolean' ? left[key] as boolean : hint.fallback;
      const now = typeof right[key] === 'boolean' ? right[key] as boolean : hint.fallback;
      if (was === now) {
        findings.push(finding('safe', 'annotation-changed', 'tool', after.name, path, `${key} made explicit`,
          'The effective value is unchanged because the spec default already applied.'));
        continue;
      }
      const direction: HintDirection = now === hint.riskyWhen ? 'risk' : 'relief';
      findings.push(finding(direction === 'risk' ? 'risky' : 'safe', direction === 'risk' ? 'annotation-risk' : 'annotation-changed',
        'tool', after.name, path, `${key} changed from ${was} to ${now}`, direction === 'risk' ? hint.risk : hint.relief));
      continue;
    }
    findings.push(finding('safe', 'annotation-changed', 'tool', after.name, path, `Annotation ${key} changed`,
      key === 'title' ? 'Only the display name changed.' : 'This annotation is informational and does not change how calls validate.'));
  }
  return findings;
};

// --- Tools ---

const inputIdentity = (tool: ToolDefinitionSnapshot): string => (
  tool.inputSchema !== undefined ? stableString(tool.inputSchema) : tool.inputSchemaFingerprint ?? ''
);

/** Pairs removed and added tools that keep the same input schema and description, one to one. */
const detectRenames = (
  removed: ToolDefinitionSnapshot[],
  added: ToolDefinitionSnapshot[]
): Array<[ToolDefinitionSnapshot, ToolDefinitionSnapshot]> => {
  const pairs: Array<[ToolDefinitionSnapshot, ToolDefinitionSnapshot]> = [];
  const taken = new Set<string>();
  for (const old of removed) {
    const identity = inputIdentity(old);
    if (!identity) continue;
    const match = added.find((candidate) => (
      !taken.has(candidate.name)
      && inputIdentity(candidate) === identity
      && descriptionSimilarity(old.description ?? '', candidate.description ?? '') >= SIGNIFICANT_DESCRIPTION_SIMILARITY
    ));
    if (match) {
      taken.add(match.name);
      pairs.push([old, match]);
    }
  }
  return pairs;
};

const compareTools = (
  before: ToolSurfaceSnapshot,
  after: ToolSurfaceSnapshot,
  options: { outputs: boolean; annotations: boolean; titles: boolean }
): BreakingChangeFinding[] => {
  const beforeTools = new Map(before.tools.map((tool) => [tool.name, tool]));
  const afterTools = new Map(after.tools.map((tool) => [tool.name, tool]));
  const removed = before.tools.filter((tool) => !afterTools.has(tool.name));
  const added = after.tools.filter((tool) => !beforeTools.has(tool.name));
  const renames = detectRenames(removed, added);
  const renamedFrom = new Set(renames.map(([old]) => old.name));
  const renamedTo = new Set(renames.map(([, next]) => next.name));
  const findings: BreakingChangeFinding[] = [];
  for (const [old, next] of renames) {
    findings.push(finding('breaking', 'tool-renamed', 'tool', old.name, `tools.${old.name}`, `Renamed to ${quote(next.name)}`,
      `Clients that cached the old list still call ${quote(old.name)}, which no longer exists.`));
  }
  for (const tool of removed.filter((candidate) => !renamedFrom.has(candidate.name))) {
    findings.push(finding('breaking', 'tool-removed', 'tool', tool.name, `tools.${tool.name}`, 'Tool removed',
      'Clients that cached the old list will still call it and get an unknown-tool error.'));
  }
  for (const tool of added.filter((candidate) => !renamedTo.has(candidate.name))) {
    findings.push(finding('safe', 'tool-added', 'tool', tool.name, `tools.${tool.name}`, 'Tool added',
      'Old clients do not know about it and keep working; they see it after they refresh the list.'));
  }
  for (const old of before.tools) {
    const next = afterTools.get(old.name);
    if (!next) continue;
    findings.push(...compareInputSchemas(old, next));
    if (options.outputs) findings.push(...compareOutputSchemas(old, next));
    findings.push(...compareDescriptions(old, next));
    if (options.titles && (old.title ?? '') !== (next.title ?? '')) {
      findings.push(finding('safe', 'title-changed', 'tool', next.name, `tools.${next.name}.title`, 'Display title changed',
        'Titles are shown to people, not used to call the tool.'));
    }
    if (options.annotations) findings.push(...compareAnnotations(old, next));
  }
  return findings;
};

// --- Prompts and resources ---

const comparePrompts = (before: PromptSnapshot[], after: PromptSnapshot[], argumentsObserved: boolean): BreakingChangeFinding[] => {
  const afterPrompts = new Map(after.map((prompt) => [prompt.name, prompt]));
  const beforeNames = new Set(before.map((prompt) => prompt.name));
  const findings: BreakingChangeFinding[] = [];
  for (const prompt of before) {
    const next = afterPrompts.get(prompt.name);
    const path = `prompts.${prompt.name}`;
    if (!next) {
      findings.push(finding('breaking', 'prompt-removed', 'prompt', prompt.name, path, 'Prompt removed',
        'Clients that offer this prompt to users will get an error when they request it.'));
      continue;
    }
    if (!argumentsObserved) continue;
    const oldArgs = new Map((prompt.arguments ?? []).map((argument) => [argument.name, argument]));
    const newArgs = new Map((next.arguments ?? []).map((argument) => [argument.name, argument]));
    for (const [name, argument] of newArgs) {
      const old = oldArgs.get(name);
      if (argument.required && !old?.required) {
        findings.push(finding('breaking', 'prompt-argument-required', 'prompt', prompt.name, `${path}.arguments.${name}`,
          `Argument ${quote(name)} is now required`, 'Clients that request the prompt without it will get an error.'));
      } else if (!old) {
        findings.push(finding('safe', 'prompt-argument-added', 'prompt', prompt.name, `${path}.arguments.${name}`,
          `Optional argument ${quote(name)} added`, 'Old clients do not send it, and the prompt still works without it.'));
      }
    }
    for (const name of oldArgs.keys()) {
      if (newArgs.has(name)) continue;
      findings.push(finding('risky', 'prompt-argument-removed', 'prompt', prompt.name, `${path}.arguments.${name}`,
        `Argument ${quote(name)} removed`, 'Clients that still send it may be rejected or see it silently ignored.'));
    }
  }
  for (const prompt of after.filter((candidate) => !beforeNames.has(candidate.name))) {
    findings.push(finding('safe', 'prompt-added', 'prompt', prompt.name, `prompts.${prompt.name}`, 'Prompt added',
      'Old clients do not know about it and keep working.'));
  }
  return findings;
};

const compareResources = (
  before: string[],
  after: string[],
  kind: 'resource' | 'resourceTemplate'
): BreakingChangeFinding[] => {
  const left = new Set(before);
  const right = new Set(after);
  const label = kind === 'resource' ? 'Resource' : 'Resource template';
  const section = kind === 'resource' ? 'resources' : 'resourceTemplates';
  return [
    ...[...left].filter((name) => !right.has(name)).sort().map((name) => finding('breaking', 'resource-removed', kind, name,
      `${section}.${name}`, `${label} removed`, 'Clients that read it by its cached URI will get a not-found error.')),
    ...[...right].filter((name) => !left.has(name)).sort().map((name) => finding('safe', 'resource-added', kind, name,
      `${section}.${name}`, `${label} added`, 'Old clients do not know about it and keep working.')),
  ];
};

// --- Report ---

export const summarizeCounts = (counts: Record<BreakingChangeSeverity, number>): string => {
  const parts = BREAKING_CHANGE_SEVERITIES.filter((severity) => counts[severity] > 0)
    .map((severity) => `${counts[severity]} ${severity}`);
  return parts.length > 0 ? parts.join(', ') : 'No changes';
};

/** Classifies every difference between two listings of the same server. */
export const classifyBreakingChanges = (
  before: ToolSurfaceSnapshot,
  after: ToolSurfaceSnapshot
): BreakingChangeReport => {
  const outputs = before.outputSchemasObserved && after.outputSchemasObserved;
  const annotations = before.annotationsObserved && after.annotationsObserved;
  const titles = before.titlesObserved && after.titlesObserved;
  const limitations: string[] = [];
  if (!outputs) limitations.push('Output schemas were not recorded in both snapshots, so output contracts were not compared.');
  if (!annotations) limitations.push('Tool annotations were not recorded in both snapshots, so behavior hints were not compared.');
  const findings = compareTools(before, after, { outputs, annotations, titles });
  if (before.prompts && after.prompts) {
    findings.push(...comparePrompts(before.prompts, after.prompts, before.promptArgumentsObserved && after.promptArgumentsObserved));
  }
  if (before.resources && after.resources) findings.push(...compareResources(before.resources, after.resources, 'resource'));
  if (before.resourceTemplates && after.resourceTemplates) {
    findings.push(...compareResources(before.resourceTemplates, after.resourceTemplates, 'resourceTemplate'));
  }

  const groupsByKey = new Map<string, BreakingChangeGroup>();
  for (const item of findings) {
    const key = `${item.subjectKind}:${item.subject}`;
    const group = groupsByKey.get(key) ?? { subjectKind: item.subjectKind, subject: item.subject, severity: 'safe' as BreakingChangeSeverity, findings: [] };
    group.findings.push(item);
    if (SEVERITY_RANK[item.severity] < SEVERITY_RANK[group.severity]) group.severity = item.severity;
    groupsByKey.set(key, group);
  }
  const groups = [...groupsByKey.values()].sort((left, right) => (
    SEVERITY_RANK[left.severity] - SEVERITY_RANK[right.severity]
    || SUBJECT_KIND_RANK[left.subjectKind] - SUBJECT_KIND_RANK[right.subjectKind]
    || left.subject.localeCompare(right.subject)
  ));
  for (const group of groups) {
    group.findings.sort((left, right) => SEVERITY_RANK[left.severity] - SEVERITY_RANK[right.severity] || left.path.localeCompare(right.path));
  }
  const ordered = groups.flatMap((group) => group.findings);
  const counts: Record<BreakingChangeSeverity, number> = { breaking: 0, risky: 0, safe: 0 };
  ordered.forEach((item) => { counts[item.severity] += 1; });
  return {
    findings: ordered,
    groups,
    counts,
    summary: summarizeCounts(counts),
    hasBreakingChanges: counts.breaking > 0,
    limitations,
  };
};
