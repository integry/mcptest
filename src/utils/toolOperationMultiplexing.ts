/**
 * Schema scans for tools that select between several operations through one
 * argument. Two signals with different standing:
 *
 * - `findMixedHttpMethodSelectors`: a `method`-style argument whose allowed
 *   values include both safe (GET, HEAD, OPTIONS) and unsafe (POST, PUT, PATCH,
 *   DELETE) HTTP methods. Anthropic's review criteria reject this shape
 *   outright, so the preflight treats it as a checked requirement. Only an
 *   established schema value set can fail it; method names mentioned in a
 *   description (`findAmbiguousHttpMethodSelectors`), unconstrained or
 *   uninterpreted schemas (`findUnresolvedHttpMethodSelectors`), and input
 *   schemas whose declarations the scan cannot follow
 *   (`findUninterpretedSelectorScopes`) leave it unknown.
 * - `findMultiplexedOperationSelectors`: an `action`/`operation`-style argument
 *   (or a list of operation objects) whose values read as both read and write
 *   verbs. This is a heuristic and only ever produces an advisory.
 *
 * Both scans are deliberately conservative: only arguments with a selector
 * name and an enumerated value set are considered, and values that do not
 * read as verbs are ignored. An argument's value set honours the enclosing
 * schema too (root `allOf`/`anyOf`/`oneOf`, `patternProperties`,
 * `additionalProperties`), and arguments declared only in a composed branch
 * are scanned like direct properties.
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

/** `anyOf`: a value is accepted when any branch accepts it. */
const unionOf = (results: readonly ValueConstraint[]): ValueConstraint => {
  if (results.includes('inconclusive')) return 'inconclusive';
  if (results.includes('any')) return 'any';
  return new Set((results as Set<string>[]).flatMap((result) => [...result]));
};

/** Value-level `oneOf`: a value is accepted when exactly one branch accepts it. */
const exclusiveValues = (results: readonly ValueConstraint[]): ValueConstraint => {
  if (results.includes('inconclusive') || results.includes('any')) return 'inconclusive';
  const counts = new Map<string, number>();
  for (const result of results as Set<string>[]) {
    for (const value of result) counts.set(value, (counts.get(value) || 0) + 1);
  }
  return new Set([...counts].filter(([, count]) => count === 1).map(([value]) => value));
};

/**
 * Object-level `oneOf`: exclusivity is decided by the whole object, so other
 * properties can tell overlapping branches apart. The accepted values of one
 * property are only established when no branch constrains it, or when the
 * branches' value sets are disjoint.
 */
const exclusiveObjects = (results: readonly ValueConstraint[]): ValueConstraint => {
  if (results.every((result) => result === 'any')) return 'any';
  if (!results.every((result): result is Set<string> => result instanceof Set)) return 'inconclusive';
  const union = new Set<string>();
  for (const result of results) {
    for (const value of result) {
      if (union.has(value)) return 'inconclusive';
      union.add(value);
    }
  }
  return union;
};

/**
 * Applies `anyOf`, `oneOf` and `allOf` to `result`, evaluating each branch
 * with `evaluate`. Only finite branch sets give a conclusive answer.
 */
const applyComposition = (
  schema: Record<string, unknown>,
  initial: ValueConstraint,
  evaluate: (branch: unknown) => ValueConstraint,
  oneOf: (results: readonly ValueConstraint[]) => ValueConstraint
): ValueConstraint => {
  let result = initial;
  for (const [key, combine] of [['anyOf', unionOf], ['oneOf', oneOf]] as const) {
    if (!(key in schema)) continue;
    const branches = schema[key];
    result = intersect(result, Array.isArray(branches) && branches.length > 0 && branches.length <= BRANCH_LIMIT
      ? combine(branches.map(evaluate))
      : 'inconclusive');
  }
  if ('allOf' in schema) {
    const branches = schema.allOf;
    result = Array.isArray(branches) && branches.length <= BRANCH_LIMIT
      ? branches.reduce<ValueConstraint>((acc, branch) => intersect(acc, evaluate(branch)), result)
      : intersect(result, 'inconclusive');
  }
  return result;
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
  return applyComposition(schema, result, (branch) => valueConstraint(branch, depth + 1), exclusiveValues);
};

/**
 * A step from an object schema to a nested value: a named property, or the
 * elements of an array.
 */
type PathStep = { property: string } | 'items';

/**
 * Keywords that can declare properties or items the walk does not follow, so
 * a method argument may exist that the scan never sees.
 */
const OPAQUE_SCHEMA_KEYWORDS = [
  '$ref', '$dynamicRef', 'if', 'then', 'else', 'dependentSchemas', 'dependencies',
] as const;
/** Keywords on an enclosing schema that can narrow a nested value in ways the walk does not model. */
const UNINTERPRETED_ENCLOSING_KEYWORDS = [
  ...OPAQUE_SCHEMA_KEYWORDS, 'not', 'propertyNames', 'unevaluatedProperties', 'unevaluatedItems',
  'prefixItems', 'additionalItems',
] as const;
const PATH_DEPTH_LIMIT = 8;

/** The subschemas of `node` that apply to the value one `step` down. */
const stepSchemas = (node: Record<string, unknown>, step: PathStep): unknown[] | 'inconclusive' => {
  if (step === 'items') {
    if (Array.isArray(node.items)) return 'inconclusive';
    return 'items' in node ? [node.items] : [];
  }
  const schemas: unknown[] = [];
  const declared = isRecord(node.properties) && Object.prototype.hasOwnProperty.call(node.properties, step.property);
  if (declared) schemas.push((node.properties as Record<string, unknown>)[step.property]);
  let matchedPattern = false;
  if ('patternProperties' in node) {
    if (!isRecord(node.patternProperties)) return 'inconclusive';
    for (const [pattern, schema] of Object.entries(node.patternProperties)) {
      let matches: boolean;
      try {
        matches = new RegExp(pattern, 'u').test(step.property);
      } catch {
        return 'inconclusive';
      }
      if (matches) {
        matchedPattern = true;
        schemas.push(schema);
      }
    }
  }
  // `additionalProperties` covers only names this same schema neither declares nor matches.
  if (!declared && !matchedPattern && 'additionalProperties' in node) schemas.push(node.additionalProperties);
  return schemas;
};

/**
 * The string values accepted at `path` below `schema`, with every enclosing
 * constraint applied: the property's own schema, but also `allOf`, `anyOf`
 * and `oneOf` on the enclosing objects, `patternProperties`, and
 * `additionalProperties` for names declared only in a composed branch.
 * Enclosing constraints the walk does not interpret make it inconclusive.
 */
const constraintAt = (schema: unknown, path: readonly PathStep[], depth = 0): ValueConstraint => {
  if (path.length === 0) return valueConstraint(schema);
  if (schema === undefined || schema === true) return 'any';
  if (schema === false) return new Set();
  if (!isRecord(schema) || depth > PATH_DEPTH_LIMIT) return 'inconclusive';
  const [step, ...rest] = path;
  const initial: ValueConstraint = UNINTERPRETED_ENCLOSING_KEYWORDS.some((keyword) => keyword in schema)
    ? 'inconclusive'
    : 'any';
  const applicable = stepSchemas(schema, step);
  const result = applicable === 'inconclusive'
    ? intersect(initial, 'inconclusive')
    : applicable.reduce<ValueConstraint>((acc, sub) => intersect(acc, constraintAt(sub, rest, depth + 1)), initial);
  return applyComposition(schema, result, (branch) => constraintAt(branch, path, depth + 1), exclusiveObjects);
};

interface SchemaScope {
  /** Every schema that applies at the path, through properties and composition. */
  nodes: Record<string, unknown>[];
  /** Whether a schema on the way uses a keyword that can hide further declarations. */
  opaque: boolean;
}

const collectScope = (schema: unknown, path: readonly PathStep[], scope: SchemaScope, depth = 0): SchemaScope => {
  if (!isRecord(schema)) return scope;
  if (depth > PATH_DEPTH_LIMIT) {
    scope.opaque = true;
    return scope;
  }
  if (OPAQUE_SCHEMA_KEYWORDS.some((keyword) => keyword in schema)) scope.opaque = true;
  if (path.length === 0) {
    scope.nodes.push(schema);
  } else {
    const applicable = stepSchemas(schema, path[0]);
    if (applicable === 'inconclusive') scope.opaque = true;
    else for (const sub of applicable) collectScope(sub, path.slice(1), scope, depth + 1);
  }
  for (const key of ['allOf', 'anyOf', 'oneOf'] as const) {
    if (!(key in schema)) continue;
    const branches = schema[key];
    if (!Array.isArray(branches) || branches.length > BRANCH_LIMIT) {
      scope.opaque = true;
      continue;
    }
    for (const branch of branches) collectScope(branch, path, scope, depth + 1);
  }
  return scope;
};

const scopeAt = (schema: unknown, path: readonly PathStep[]): SchemaScope => (
  collectScope(schema, path, { nodes: [], opaque: false })
);

/** Property names declared anywhere in a scope, including composed branches. */
const declaredNames = (scope: SchemaScope): string[] => {
  const names = new Set<string>();
  for (const node of scope.nodes) {
    if (!isRecord(node.properties)) continue;
    for (const name of Object.keys(node.properties)) names.add(name);
  }
  return [...names].slice(0, SCAN_PROPERTY_LIMIT);
};

interface SchemaScan {
  candidates: SelectorCandidate[];
  /** Scopes (`input schema`, `requests[]`) whose declarations could not all be followed. */
  opaqueScopes: string[];
}

/**
 * Top-level arguments plus the fields of objects inside list-of-operation
 * arguments, wherever the schema declares them: in `properties` or in a
 * composed branch. Each candidate's values honour every enclosing constraint.
 */
const scanSchema = (inputSchema: unknown): SchemaScan => {
  const candidates: SelectorCandidate[] = [];
  const opaqueScopes: string[] = [];
  const add = (label: string, name: string, path: readonly PathStep[]) => {
    const constraint = constraintAt(inputSchema, path);
    const description = scopeAt(inputSchema, path).nodes
      .map((node) => node.description)
      .find((text): text is string => typeof text === 'string') || '';
    candidates.push({
      path: label,
      name: canonicalName(name),
      values: constraint instanceof Set ? [...constraint] : [],
      constraint: constraint instanceof Set ? 'values' : constraint,
      description,
    });
  };
  const root = scopeAt(inputSchema, []);
  if (root.opaque) opaqueScopes.push('input schema');
  for (const name of declaredNames(root)) {
    add(name, name, [{ property: name }]);
    if (!OPERATION_LIST_NAMES.has(canonicalName(name))) continue;
    const itemsPath: PathStep[] = [{ property: name }, 'items'];
    const items = scopeAt(inputSchema, itemsPath);
    if (items.opaque && !root.opaque) opaqueScopes.push(`${name}[]`);
    for (const field of declaredNames(items)) {
      add(`${name}[].${field}`, field, [...itemsPath, { property: field }]);
    }
  }
  return { candidates, opaqueScopes };
};

const selectorCandidates = (inputSchema: unknown): SelectorCandidate[] => scanSchema(inputSchema).candidates;

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
 * Input schemas (or list-of-operation item schemas) that use keywords the scan
 * does not follow, such as `$ref`, `if`/`then`/`else` or `dependentSchemas`.
 * A method argument declared there is invisible to the other scans, so the
 * preflight cannot pass the check while one exists. `argument` names the
 * scope: `input schema` or `requests[]`.
 */
export const findUninterpretedSelectorScopes = (tools: readonly ToolLike[]): OperationSelectorMatch[] => (
  tools.flatMap((tool) => scanSchema(tool.inputSchema).opaqueScopes.map((scope) => ({
    tool: tool.name, argument: scope, values: [], categories: [],
  })))
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
