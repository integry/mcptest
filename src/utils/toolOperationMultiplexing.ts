/**
 * Schema scans for tools that select between several operations through one
 * argument. Two signals with different standing:
 *
 * - `findMixedHttpMethodSelectors`: a `method`-style argument whose allowed
 *   values include both safe (GET, HEAD, OPTIONS) and unsafe (POST, PUT, PATCH,
 *   DELETE) HTTP methods. Anthropic's review criteria reject this shape
 *   outright, so the preflight treats it as a checked requirement. Only an
 *   established schema value set can fail it; method names mentioned in a
 *   description (`findAmbiguousHttpMethodSelectors`) and unconstrained or
 *   uninterpreted schemas (`findUnresolvedHttpMethodSelectors`) leave it
 *   unknown.
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
  /** The accepted values, when the schema establishes them; otherwise empty. */
  values: string[];
  /** Whether `values` is the established set of accepted values. */
  constraint: 'values' | 'any' | 'inconclusive';
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

/**
 * What a schema node establishes about the string values it accepts:
 * - a `Set`: exactly these strings (every applicable constraint intersected),
 * - `'any'`: no constraint on the value at all,
 * - `'inconclusive'`: constraints this scanner does not interpret (pattern,
 *   length, not, $ref, conditionals, non-string types, ...), so nothing is
 *   claimed either way.
 */
type ValueConstraint = Set<string> | 'any' | 'inconclusive';

/** Keywords that narrow string values in ways the scanner does not model. */
const UNINTERPRETED_VALUE_KEYWORDS = [
  'pattern', 'minLength', 'maxLength', 'not', '$ref', '$dynamicRef', 'if', 'then', 'else',
] as const;
const BRANCH_LIMIT = 50;

const intersect = (left: ValueConstraint, right: ValueConstraint): ValueConstraint => {
  if (left === 'inconclusive' || right === 'inconclusive') {
    // An empty set stays empty whatever the other constraint says.
    if (left instanceof Set && left.size === 0) return left;
    if (right instanceof Set && right.size === 0) return right;
    return 'inconclusive';
  }
  if (left === 'any') return right;
  if (right === 'any') return left;
  return new Set([...left].filter((value) => right.has(value)));
};

const permitsStrings = (type: unknown): boolean => (
  type === 'string' || (Array.isArray(type) && type.includes('string'))
);

/**
 * `anyOf` accepts a value matched by any branch; `oneOf` one matched by
 * exactly one branch. Only finite branch sets give a conclusive answer.
 */
const combineBranches = (branches: unknown[], exclusive: boolean, depth: number): ValueConstraint => {
  if (branches.length === 0 || branches.length > BRANCH_LIMIT) return 'inconclusive';
  const results = branches.map((branch) => valueConstraint(branch, depth + 1));
  if (results.includes('inconclusive')) return 'inconclusive';
  if (results.includes('any')) return exclusive ? 'inconclusive' : 'any';
  const counts = new Map<string, number>();
  for (const result of results as Set<string>[]) {
    for (const value of result) counts.set(value, (counts.get(value) || 0) + 1);
  }
  return new Set([...counts].filter(([, count]) => !exclusive || count === 1).map(([value]) => value));
};

const valueConstraint = (schema: unknown, depth = 0): ValueConstraint => {
  if (schema === undefined || schema === true) return 'any';
  if (schema === false) return new Set();
  if (!isRecord(schema) || depth > 8) return 'inconclusive';
  // Arrays of selectors (`methods: { items: { enum } }`): the element constraint is what matters.
  if (schema.type === 'array' || (schema.type === undefined && isRecord(schema.items)
    && !('enum' in schema) && !('const' in schema))) {
    return isRecord(schema.items) ? valueConstraint(schema.items, depth + 1) : 'inconclusive';
  }
  let result: ValueConstraint = 'any';
  if ('type' in schema && !permitsStrings(schema.type)) result = 'inconclusive';
  if (UNINTERPRETED_VALUE_KEYWORDS.some((keyword) => keyword in schema)) result = 'inconclusive';
  if ('enum' in schema) {
    result = intersect(result, Array.isArray(schema.enum)
      ? new Set(schema.enum.filter((value): value is string => typeof value === 'string'))
      : 'inconclusive');
  }
  if ('const' in schema) {
    result = intersect(result, new Set(typeof schema.const === 'string' ? [schema.const] : []));
  }
  for (const [key, exclusive] of [['anyOf', false], ['oneOf', true]] as const) {
    if (!(key in schema)) continue;
    const branches = schema[key];
    result = intersect(result, Array.isArray(branches) ? combineBranches(branches, exclusive, depth) : 'inconclusive');
  }
  if ('allOf' in schema) {
    const branches = schema.allOf;
    result = Array.isArray(branches) && branches.length <= BRANCH_LIMIT
      ? branches.reduce<ValueConstraint>((acc, branch) => intersect(acc, valueConstraint(branch, depth + 1)), result)
      : intersect(result, 'inconclusive');
  }
  return result;
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
    const constraint = valueConstraint(schema);
    candidates.push({
      path,
      name: canonicalName(name),
      values: constraint instanceof Set ? [...constraint] : [],
      constraint: constraint instanceof Set ? 'values' : constraint,
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

/** Methods named in free text. Mentions are not proof of support ("POST is rejected"). */
const methodsInText = (text: string): string[] => (
  text.match(/\b(GET|HEAD|OPTIONS|POST|PUT|PATCH|DELETE)\b/g) || []
);

const mixedMethodMatch = (
  tool: string,
  argument: string,
  rawMethods: readonly string[]
): OperationSelectorMatch | undefined => {
  const methods = rawMethods.map((value) => value.toUpperCase());
  const safe = methods.some((method) => SAFE_HTTP_METHODS.has(method));
  const unsafe = methods.some((method) => UNSAFE_HTTP_METHODS.has(method));
  if (!safe || !unsafe) return undefined;
  const categories: OperationCategory[] = ['read', 'write'];
  if (methods.includes('DELETE')) categories.push('destructive');
  return { tool, argument, values: limitedValues([...new Set(methods)]), categories };
};

/**
 * Tools with a method argument whose schema constraints (enum, const,
 * oneOf/anyOf/allOf, intersected) establish that it admits both safe and
 * unsafe HTTP methods, the catch-all `api_request` shape Anthropic's review
 * criteria reject. Only an established value set counts: descriptions are left
 * to `findAmbiguousHttpMethodSelectors`, and unconstrained or uninterpreted
 * schemas to `findUnresolvedHttpMethodSelectors`.
 */
export const findMixedHttpMethodSelectors = (tools: readonly ToolLike[]): OperationSelectorMatch[] => (
  tools.flatMap((tool) => selectorCandidates(tool.inputSchema).flatMap((candidate) => {
    if (!HTTP_METHOD_NAMES.has(candidate.name) || candidate.constraint !== 'values') return [];
    const match = mixedMethodMatch(tool.name, candidate.path, candidate.values);
    return match ? [match] : [];
  }))
);

/**
 * Method arguments without a value set whose description mentions both safe
 * and unsafe HTTP methods. A mention does not establish that a method is
 * accepted (the text may say it is rejected), so these never fail a check;
 * the preflight reports them as unknown.
 */
export const findAmbiguousHttpMethodSelectors = (tools: readonly ToolLike[]): OperationSelectorMatch[] => (
  tools.flatMap((tool) => selectorCandidates(tool.inputSchema).flatMap((candidate) => {
    if (!HTTP_METHOD_NAMES.has(candidate.name) || candidate.constraint === 'values') return [];
    const match = mixedMethodMatch(tool.name, candidate.path, methodsInText(candidate.description));
    return match ? [match] : [];
  }))
);

/**
 * Method arguments whose schema does not establish the accepted methods:
 * unconstrained (`{ type: 'string' }`) or constrained in a way the scanner
 * does not interpret. Such an argument may accept both safe and unsafe
 * methods, so the preflight cannot pass the check while one exists.
 * Arguments already reported by `findAmbiguousHttpMethodSelectors` are
 * included; callers report those first.
 */
export const findUnresolvedHttpMethodSelectors = (tools: readonly ToolLike[]): OperationSelectorMatch[] => (
  tools.flatMap((tool) => selectorCandidates(tool.inputSchema).flatMap((candidate) => (
    HTTP_METHOD_NAMES.has(candidate.name) && candidate.constraint !== 'values'
      ? [{ tool: tool.name, argument: candidate.path, values: [], categories: [] }]
      : []
  )))
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
    if (!SELECTOR_NAMES.has(candidate.name) || candidate.constraint !== 'values' || candidate.values.length < 2) return [];
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
