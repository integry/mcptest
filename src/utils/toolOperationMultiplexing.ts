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
 * schema too (root `allOf`/`anyOf`/`oneOf`, `const`/`enum`,
 * `patternProperties`, `additionalProperties`), and arguments declared only in
 * a composed branch are scanned like direct properties. The method check
 * covers nested objects and array items within explicit bounds; scopes past
 * those bounds are reported as not fully scanned rather than passed.
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
  /**
   * Whether the argument is in the scope the multiplexing advisory has always
   * covered: a top-level argument, or a field of a list-of-operations item.
   * The HTTP method check covers every nested argument.
   */
  advisory: boolean;
}

const VALUE_DISPLAY_LIMIT = 8;
/** Property names scanned per object scope; a scope declaring more is reported as not fully scanned. */
const SCAN_PROPERTY_LIMIT = 200;
/** Arguments scanned per tool across all nested scopes; beyond this the rest is reported as not scanned. */
const SCAN_ARGUMENT_LIMIT = 1000;
/** Path steps (properties and array items) the scan descends below the input schema. */
const SCAN_NESTING_LIMIT = 6;

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
  // Arrays of selectors (`methods: { items: { enum } }`): the element constraint is what matters,
  // with the array's own enum, const and composition applied to its elements.
  if (schema.type === 'array' || (schema.type === undefined && isRecord(schema.items))) {
    // Without a type, an enum or const may list strings as well as arrays: neither reading is established.
    if (schema.type === undefined && ('enum' in schema || 'const' in schema)) return 'inconclusive';
    return isRecord(schema.items) ? constraintAt(schema, ['items'], depth + 1) : 'inconclusive';
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
  '$ref', '$dynamicRef', 'if', 'then', 'else', 'dependentSchemas', 'dependencies', 'prefixItems',
] as const;
/** Keywords on an enclosing schema that can narrow a nested value in ways the walk does not model. */
const UNINTERPRETED_ENCLOSING_KEYWORDS = [
  ...OPAQUE_SCHEMA_KEYWORDS, 'not', 'propertyNames', 'unevaluatedProperties', 'unevaluatedItems',
  'additionalItems',
] as const;
const PATH_DEPTH_LIMIT = 8;
const LITERAL_LIMIT = 200;

/**
 * The strings an enclosing `const`/`enum` literal can place at `path`: the
 * string there, or the strings inside an array there (mirroring how
 * `valueConstraint` reads arrays of selectors). A literal without a value at
 * the path contributes nothing, since such an object has no argument there.
 */
const literalStringsAt = (literal: unknown, path: readonly PathStep[], depth = 0): string[] => {
  if (depth > PATH_DEPTH_LIMIT * 2) return [];
  if (path.length === 0) {
    if (typeof literal === 'string') return [literal];
    return Array.isArray(literal) ? literal.flatMap((element) => literalStringsAt(element, path, depth + 1)) : [];
  }
  const [step, ...rest] = path;
  if (step === 'items') {
    return Array.isArray(literal) ? literal.flatMap((element) => literalStringsAt(element, rest, depth + 1)) : [];
  }
  return isRecord(literal) && Object.prototype.hasOwnProperty.call(literal, step.property)
    ? literalStringsAt(literal[step.property], rest, depth + 1)
    : [];
};

/** What an enclosing schema's own `const` and `enum` allow at `path` below it. */
const enclosingLiteralConstraint = (schema: Record<string, unknown>, path: readonly PathStep[]): ValueConstraint => {
  let result: ValueConstraint = 'any';
  if ('const' in schema) result = intersect(result, new Set(literalStringsAt(schema.const, path)));
  if ('enum' in schema) {
    result = intersect(result, Array.isArray(schema.enum) && schema.enum.length <= LITERAL_LIMIT
      ? new Set(schema.enum.flatMap((literal) => literalStringsAt(literal, path)))
      : 'inconclusive');
  }
  return result;
};

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
 * and `oneOf` on the enclosing objects, their own `const` and `enum`,
 * `patternProperties`, and `additionalProperties` for names declared only in
 * a composed branch.
 * Enclosing constraints the walk does not interpret make it inconclusive.
 */
const constraintAt = (schema: unknown, path: readonly PathStep[], depth = 0): ValueConstraint => {
  if (path.length === 0) return valueConstraint(schema);
  if (schema === undefined || schema === true) return 'any';
  if (schema === false) return new Set();
  if (!isRecord(schema) || depth > PATH_DEPTH_LIMIT) return 'inconclusive';
  const [step, ...rest] = path;
  const initial: ValueConstraint = intersect(
    UNINTERPRETED_ENCLOSING_KEYWORDS.some((keyword) => keyword in schema) ? 'inconclusive' : 'any',
    enclosingLiteralConstraint(schema, path)
  );
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
  return [...names];
};

/** Whether some schema in the scope can hold nested arguments: an object or an array. */
const mayNest = (scope: SchemaScope): boolean => scope.nodes.some((node) => (
  !('type' in node) || ['object', 'array'].some((type) => node.type === type
    || (Array.isArray(node.type) && node.type.includes(type)))
));

interface SchemaScan {
  candidates: SelectorCandidate[];
  /**
   * Scopes (`input schema`, `request`, `requests[]`) the scan could not
   * examine completely: declarations it does not follow, or more properties,
   * arguments or nesting than it scans.
   */
  opaqueScopes: string[];
}

/**
 * Every argument the schema declares, at any depth up to the nesting limit:
 * top-level arguments, properties of nested objects, and fields of array
 * items, wherever each scope declares them (in `properties` or in a composed
 * branch). Each candidate's values honour every enclosing constraint. Scopes
 * the scan cannot examine completely are reported, never silently skipped.
 */
const scanSchema = (inputSchema: unknown): SchemaScan => {
  const candidates: SelectorCandidate[] = [];
  const opaqueScopes: string[] = [];
  let remaining = SCAN_ARGUMENT_LIMIT;
  const add = (label: string, name: string, path: readonly PathStep[], scope: SchemaScope, advisory: boolean) => {
    const constraint = constraintAt(inputSchema, path);
    const description = scope.nodes
      .map((node) => node.description)
      .find((text): text is string => typeof text === 'string') || '';
    candidates.push({
      path: label,
      name: canonicalName(name),
      values: constraint instanceof Set ? [...constraint] : [],
      constraint: constraint instanceof Set ? 'values' : constraint,
      description,
      advisory,
    });
  };
  /**
   * Scans the object or array scope at `path`. `prefix` is the label of the
   * scope's arguments (`''`, `request.`, `requests[].`); `parentOpaque`
   * suppresses reports already made for an enclosing scope, whose keywords
   * every nested scope inherits. `inOperationList` marks the items of a
   * top-level operation list.
   */
  const visit = (label: string, prefix: string, path: PathStep[], scope: SchemaScope, parentOpaque: boolean,
    inOperationList: boolean) => {
    const report = () => {
      if (!opaqueScopes.includes(label)) opaqueScopes.push(label);
    };
    if (scope.opaque && !parentOpaque && mayNest(scope)) report();
    const names = declaredNames(scope);
    const hasItems = scope.nodes.some((node) => 'items' in node);
    if (names.length === 0 && !hasItems) return;
    if (path.length >= SCAN_NESTING_LIMIT) {
      report();
      return;
    }
    if (names.length > SCAN_PROPERTY_LIMIT) report();
    for (const name of names.slice(0, SCAN_PROPERTY_LIMIT)) {
      if (remaining <= 0) {
        report();
        return;
      }
      remaining -= 1;
      const argumentPath: PathStep[] = [...path, { property: name }];
      const argumentScope = scopeAt(inputSchema, argumentPath);
      const argumentLabel = `${prefix}${name}`;
      add(argumentLabel, name, argumentPath, argumentScope, path.length === 0 || inOperationList);
      visit(argumentLabel, `${argumentLabel}.`, argumentPath, argumentScope, scope.opaque, false);
    }
    if (hasItems) {
      const itemsPath: PathStep[] = [...path, 'items'];
      const itemsLabel = `${label}[]`;
      // Only the item fields of a top-level operation list belong to the advisory's scope.
      const [first] = path;
      const operationList = path.length === 1 && first !== 'items' && OPERATION_LIST_NAMES.has(canonicalName(first.property));
      visit(itemsLabel, `${itemsLabel}.`, itemsPath, scopeAt(inputSchema, itemsPath), scope.opaque, operationList);
    }
  };
  visit('input schema', '', [], scopeAt(inputSchema, []), false, false);
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
 * Schema scopes (the input schema, a nested object, or array items) the scan
 * could not examine completely: they use keywords it does not follow, such as
 * `$ref`, `if`/`then`/`else`, `dependentSchemas` or `prefixItems`, or they
 * exceed its property, argument or nesting limits. A method argument there is
 * invisible to the other scans, so the preflight cannot pass the check while
 * one exists. `argument` names the scope: `input schema`, `request` or
 * `requests[]`.
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
    if (!candidate.advisory || !SELECTOR_NAMES.has(candidate.name) || candidate.constraint !== 'values' || candidate.values.length < 2) return [];
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
