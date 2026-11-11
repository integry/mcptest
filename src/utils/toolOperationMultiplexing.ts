/**
 * Schema scans for tools that select between several operations through one
 * argument. Two signals with different standing:
 *
 * - `findMixedHttpMethodSelectors`: a `method`-style argument whose allowed
 *   values include both safe (GET, HEAD, OPTIONS) and unsafe (POST, PUT, PATCH,
 *   DELETE) HTTP methods. Anthropic's review criteria reject this shape
 *   outright, so the preflight treats it as a checked requirement.
 * - `findMultiplexedOperationSelectors`: an `action`/`operation`-style argument
 *   (or a list of operation objects) whose values read as both read and write
 *   verbs. This is a heuristic and only ever produces an advisory.
 *
 * Both scans are deliberately conservative: only arguments with a selector
 * name and an enumerated value set are considered, and values that do not
 * read as verbs are ignored.
 */

export type OperationCategory = 'read' | 'write' | 'destructive';

export interface OperationSelectorMatch {
  tool: string;
  /** Argument path, such as `action` or `operations[].op`. */
  argument: string;
  /** Enumerated values, capped for display. */
  values: string[];
  categories: OperationCategory[];
}

interface ToolLike {
  name: string;
  inputSchema: unknown;
}

interface SelectorCandidate {
  path: string;
  name: string;
  values: string[];
  description: string;
}

const VALUE_DISPLAY_LIMIT = 8;
const SCAN_PROPERTY_LIMIT = 200;

const SELECTOR_NAMES = new Set([
  'action', 'actions', 'operation', 'operations', 'op', 'ops', 'command', 'commands', 'cmd',
]);
const HTTP_METHOD_NAMES = new Set(['method', 'httpmethod', 'http_method', 'requestmethod', 'verb']);
const OPERATION_LIST_NAMES = new Set([
  'operations', 'ops', 'actions', 'commands', 'requests', 'batch', 'steps',
]);

const SAFE_HTTP_METHODS = new Set(['GET', 'HEAD', 'OPTIONS']);
const UNSAFE_HTTP_METHODS = new Set(['POST', 'PUT', 'PATCH', 'DELETE']);

const VERBS: Record<OperationCategory, readonly string[]> = {
  read: [
    'get', 'list', 'read', 'search', 'find', 'fetch', 'query', 'view', 'show', 'describe',
    'lookup', 'count', 'retrieve', 'browse', 'inspect', 'download',
  ],
  write: [
    'create', 'add', 'insert', 'update', 'set', 'edit', 'modify', 'patch', 'rename', 'move',
    'upload', 'post', 'send', 'put', 'save', 'write', 'append', 'assign', 'publish', 'invite',
    'upsert', 'replace', 'submit', 'comment', 'reply', 'merge', 'approve', 'enable', 'disable',
  ],
  destructive: [
    'delete', 'remove', 'destroy', 'drop', 'purge', 'clear', 'archive', 'revoke', 'cancel',
    'reset', 'truncate', 'wipe', 'uninstall', 'erase', 'unpublish',
  ],
};

const VERB_CATEGORY = new Map<string, OperationCategory>(
  (Object.entries(VERBS) as [OperationCategory, readonly string[]][])
    .flatMap(([category, verbs]) => verbs.map((verb) => [verb, category] as const))
);

const isRecord = (value: unknown): value is Record<string, unknown> => (
  Boolean(value) && typeof value === 'object' && !Array.isArray(value)
);

const canonicalName = (value: string): string => value.replace(/[^a-z0-9_]/gi, '').toLowerCase();

const tokens = (value: string): string[] => value
  .replace(/([a-z0-9])([A-Z])/g, '$1 $2')
  .split(/[^A-Za-z0-9]+/)
  .map((token) => token.toLowerCase())
  .filter(Boolean);

/** The category of the first token that is a known verb, if any. */
export const classifyOperation = (value: string): OperationCategory | undefined => {
  for (const token of tokens(value)) {
    const category = VERB_CATEGORY.get(token);
    if (category) return category;
  }
  return undefined;
};

/** String values a schema node allows through enum, const, or oneOf/anyOf of consts. */
const enumeratedValues = (schema: unknown): string[] => {
  if (!isRecord(schema)) return [];
  if (Array.isArray(schema.enum)) {
    return schema.enum.filter((value): value is string => typeof value === 'string');
  }
  if (typeof schema.const === 'string') return [schema.const];
  for (const key of ['oneOf', 'anyOf'] as const) {
    const branches = schema[key];
    if (Array.isArray(branches)) {
      const values = branches.flatMap((branch) => (
        isRecord(branch) && typeof branch.const === 'string' ? [branch.const] : []
      ));
      if (values.length > 0) return values;
    }
  }
  if (isRecord(schema.items)) return enumeratedValues(schema.items);
  return [];
};

const properties = (schema: unknown): [string, unknown][] => (
  isRecord(schema) && isRecord(schema.properties)
    ? Object.entries(schema.properties).slice(0, SCAN_PROPERTY_LIMIT)
    : []
);

/** Top-level arguments plus the fields of objects inside list-of-operation arguments. */
const selectorCandidates = (inputSchema: unknown): SelectorCandidate[] => {
  const candidates: SelectorCandidate[] = [];
  const add = (path: string, name: string, schema: unknown) => {
    candidates.push({
      path,
      name: canonicalName(name),
      values: [...new Set(enumeratedValues(schema))],
      description: isRecord(schema) && typeof schema.description === 'string' ? schema.description : '',
    });
  };
  for (const [name, schema] of properties(inputSchema)) {
    add(name, name, schema);
    if (!OPERATION_LIST_NAMES.has(canonicalName(name)) || !isRecord(schema)) continue;
    for (const [field, fieldSchema] of properties(schema.items)) {
      add(`${name}[].${field}`, field, fieldSchema);
    }
  }
  return candidates;
};

const limitedValues = (values: readonly string[]): string[] => values.slice(0, VALUE_DISPLAY_LIMIT);

/** Methods named in free text, used only when a method argument has no enum. */
const methodsInText = (text: string): string[] => (
  text.match(/\b(GET|HEAD|OPTIONS|POST|PUT|PATCH|DELETE)\b/g) || []
);

/**
 * Tools with a method argument that admits both safe and unsafe HTTP methods,
 * the catch-all `api_request` shape Anthropic's review criteria reject.
 */
export const findMixedHttpMethodSelectors = (tools: readonly ToolLike[]): OperationSelectorMatch[] => (
  tools.flatMap((tool) => selectorCandidates(tool.inputSchema).flatMap((candidate) => {
    if (!HTTP_METHOD_NAMES.has(candidate.name)) return [];
    const methods = (candidate.values.length > 0 ? candidate.values : methodsInText(candidate.description))
      .map((value) => value.toUpperCase());
    const safe = methods.some((method) => SAFE_HTTP_METHODS.has(method));
    const unsafe = methods.some((method) => UNSAFE_HTTP_METHODS.has(method));
    if (!safe || !unsafe) return [];
    const categories: OperationCategory[] = ['read', 'write'];
    if (methods.includes('DELETE')) categories.push('destructive');
    return [{
      tool: tool.name,
      argument: candidate.path,
      values: limitedValues([...new Set(methods)]),
      categories,
    }];
  }))
);

/**
 * Heuristic: an operation-selector argument whose enumerated values read as
 * both read and write (or destructive) verbs. Guards against false positives:
 * the argument must have a selector name (`action`, `operation`, ...), at
 * least two values must classify as verbs, and reads must be mixed with
 * writes. HTTP method selectors are left to `findMixedHttpMethodSelectors`.
 */
export const findMultiplexedOperationSelectors = (
  tools: readonly ToolLike[]
): OperationSelectorMatch[] => (
  tools.flatMap((tool) => selectorCandidates(tool.inputSchema).flatMap((candidate) => {
    if (!SELECTOR_NAMES.has(candidate.name) || candidate.values.length < 2) return [];
    const classified = candidate.values
      .map(classifyOperation)
      .filter((category): category is OperationCategory => Boolean(category));
    if (classified.length < 2) return [];
    const categories = [...new Set(classified)].sort() as OperationCategory[];
    const mixesReadsAndWrites = categories.includes('read')
      && (categories.includes('write') || categories.includes('destructive'));
    if (!mixesReadsAndWrites) return [];
    return [{
      tool: tool.name,
      argument: candidate.path,
      values: limitedValues(candidate.values),
      categories,
    }];
  }))
);
