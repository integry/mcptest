/**
 * Schema scans for tools that select between several operations through one
 * argument. Two signals with different standing:
 *
 * - `assessHttpMethodSelectors`: a `method`-style argument whose allowed values
 *   include both safe (GET, HEAD, OPTIONS) and unsafe (POST, PUT, PATCH,
 *   DELETE) HTTP methods. Anthropic's review criteria reject this shape
 *   outright, so the preflight treats it as a checked requirement.
 * - `findMultiplexedOperationSelectors`: an `action`/`operation`-style argument
 *   (or a list of operation objects) whose values read as both read and write
 *   verbs. This is a heuristic and only ever produces an advisory.
 *
 * Neither scan models JSON Schema. A value set is only read from a *plain*
 * schema: a property whose schema uses nothing but `enum`/`const` and
 * annotation keywords, declared directly in an object schema that uses
 * nothing but the keywords in `PLAIN_OBJECT_KEYWORDS`. Any other keyword
 * (composition, `$ref`, `not`, conditionals, cardinality bounds,
 * `patternProperties`, `propertyNames`, `pattern`, ...) means the value set is
 * not established, and the method check reports the tool for manual review.
 * So does a schema that could declare arguments the scan cannot see:
 * `patternProperties` anywhere in it, or a `$ref` that points outside it.
 * Server-supplied regular expressions are never compiled or executed.
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

/** A tool whose method arguments could not be decided from a plain schema. */
export interface MethodSelectorReview {
  tool: string;
  /** JSON Pointer into the input schema (`/properties/method`), or `` for the whole schema. */
  location: string;
  reason: 'not-plain' | 'nested' | 'method-values' | 'unsupported-keyword' | 'too-large';
}

export interface MethodSelectorAssessment {
  /** Plain method arguments that list both safe and unsafe methods. */
  failures: OperationSelectorMatch[];
  /** Tools the check cannot decide; neither passed nor failed. */
  reviews: MethodSelectorReview[];
}

interface ToolLike {
  name: string;
  inputSchema: unknown;
}

const VALUE_DISPLAY_LIMIT = 8;
/** JSON values visited per input schema; a larger schema is left for manual review. */
const WALK_NODE_LIMIT = 10_000;
const WALK_DEPTH_LIMIT = 64;

/** Keywords an enclosing object schema may use for its properties' value sets to count. */
export const PLAIN_OBJECT_KEYWORDS: ReadonlySet<string> = new Set([
  'type', 'properties', 'required', 'description', 'title', 'additionalProperties', 'default', 'examples',
  '$schema',
]);
/** Keywords a selector property may use: one `enum` or `const`, and annotations. */
const PLAIN_PROPERTY_KEYWORDS: ReadonlySet<string> = new Set([
  'type', 'enum', 'const', 'description', 'title', 'default', 'examples',
]);
/** Keywords a list of selectors or of operation objects may use around its `items`. */
const PLAIN_ARRAY_KEYWORDS: ReadonlySet<string> = new Set([
  'type', 'items', 'description', 'title', 'default', 'examples',
]);

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

const usesOnly = (schema: Record<string, unknown>, allowed: ReadonlySet<string>): boolean => (
  Object.keys(schema).every((keyword) => allowed.has(keyword))
);

/** An object schema whose declared properties nothing else can constrain. */
const isPlainObject = (schema: unknown): schema is Record<string, unknown> & { properties: Record<string, unknown> } => (
  isRecord(schema)
  && usesOnly(schema, PLAIN_OBJECT_KEYWORDS)
  && (schema.type === undefined || schema.type === 'object')
  && isRecord(schema.properties)
);

/**
 * The values a plain selector schema allows: exactly one of `enum` (all
 * strings) or `const` (a string), with only annotation keywords besides.
 */
const plainValues = (schema: unknown): string[] | undefined => {
  if (!isRecord(schema) || !usesOnly(schema, PLAIN_PROPERTY_KEYWORDS)) return undefined;
  if (schema.type !== undefined && schema.type !== 'string') return undefined;
  if (('enum' in schema) === ('const' in schema)) return undefined;
  if ('const' in schema) return typeof schema.const === 'string' ? [schema.const] : undefined;
  const values = schema.enum;
  return Array.isArray(values) && values.length > 0 && values.every((value) => typeof value === 'string')
    ? values as string[]
    : undefined;
};

const mixesSafeAndUnsafe = (values: readonly unknown[]): boolean => {
  const methods = values.filter((value): value is string => typeof value === 'string').map((value) => value.toUpperCase());
  return methods.some((method) => SAFE_HTTP_METHODS.has(method)) && methods.some((method) => UNSAFE_HTTP_METHODS.has(method));
};

const limitedValues = (values: readonly string[]): string[] => values.slice(0, VALUE_DISPLAY_LIMIT);

/** Keywords whose object value maps names (not keywords) to schemas. */
const NAME_MAP_KEYWORDS = new Set(['properties', 'patternProperties', '$defs', 'definitions', 'dependentSchemas']);
/** Keywords whose value is instance data, never a schema. */
const DATA_KEYWORDS = new Set(['enum', 'const', 'default', 'examples']);
const REFERENCE_KEYWORDS = ['$ref', '$dynamicRef', '$recursiveRef'] as const;

/**
 * Keywords in one schema object that could declare arguments the walk cannot
 * see without interpreting them: pattern-keyed properties (a pattern may match
 * `method`) and references to documents outside the input schema. Neither is
 * resolved or compiled; their presence is enough.
 */
const unsupportedKeywords = (node: Record<string, unknown>): string[] => [
  ...(isRecord(node.patternProperties) && Object.keys(node.patternProperties).length > 0 ? ['patternProperties'] : []),
  ...REFERENCE_KEYWORDS.filter((keyword) => typeof node[keyword] === 'string' && !(node[keyword] as string).startsWith('#')),
];

const pointerSegment = (key: string): string => key.replace(/~/g, '~0').replace(/\//g, '~1');

interface SchemaWalk {
  /** Every `properties` entry with a method-style name, wherever it is declared. */
  methodProperties: { owner: Record<string, unknown>; name: string; location: string }[];
  /** Every `enum`/`const` holding both safe and unsafe method names, wherever it appears. */
  methodValueSets: { node: Record<string, unknown>; location: string }[];
  /** Schema keywords that could declare method arguments out of the walk's sight (see `unsupportedKeywords`). */
  unsupported: { location: string }[];
  complete: boolean;
}

/**
 * One bounded pass over the raw schema JSON. Keys are compared as strings
 * only; nothing is interpreted as a schema construct beyond `properties`,
 * `enum` and `const`, so any keyword the walk does not know about is simply
 * more JSON to look through.
 */
const walkSchema = (schema: unknown): SchemaWalk => {
  const walk: SchemaWalk = { methodProperties: [], methodValueSets: [], unsupported: [], complete: true };
  const seen = new Set<unknown>();
  // `kind` tells schema objects apart from name maps and instance data, so that an argument
  // named `patternProperties` or a default value holding `$ref` is not read as a keyword.
  type Kind = 'schema' | 'map' | 'data';
  const stack: { value: unknown; location: string; depth: number; kind: Kind }[] = [
    { value: schema, location: '', depth: 0, kind: 'schema' },
  ];
  // Counts every JSON value queued, primitives included, so wide objects and long enums are bounded too.
  let queued = 1;
  const exceeds = (children: number) => {
    queued += children;
    return queued > WALK_NODE_LIMIT;
  };
  while (stack.length > 0) {
    const { value, location, depth, kind } = stack.pop()!;
    if (!value || typeof value !== 'object' || seen.has(value)) continue;
    seen.add(value);
    if (depth > WALK_DEPTH_LIMIT || exceeds(Array.isArray(value) ? value.length : Object.keys(value).length)) {
      walk.complete = false;
      return walk;
    }
    if (Array.isArray(value)) {
      value.forEach((element, index) => stack.push({ value: element, location: `${location}/${index}`, depth: depth + 1, kind }));
      continue;
    }
    const node = value as Record<string, unknown>;
    if (kind === 'schema') {
      for (const keyword of unsupportedKeywords(node)) walk.unsupported.push({ location: `${location}/${pointerSegment(keyword)}` });
    }
    if (isRecord(node.properties)) {
      for (const name of Object.keys(node.properties)) {
        if (HTTP_METHOD_NAMES.has(canonicalName(name))) {
          walk.methodProperties.push({ owner: node, name, location: `${location}/properties/${pointerSegment(name)}` });
        }
      }
    }
    const literals = [...(Array.isArray(node.enum) ? node.enum : []), ...('const' in node ? [node.const] : [])];
    if (mixesSafeAndUnsafe(literals)) walk.methodValueSets.push({ node, location });
    for (const [key, child] of Object.entries(node)) {
      const childKind: Kind = kind !== 'schema' ? (kind === 'map' ? 'schema' : 'data')
        : NAME_MAP_KEYWORDS.has(key) ? 'map'
          : DATA_KEYWORDS.has(key) ? 'data' : 'schema';
      stack.push({ value: child, location: `${location}/${pointerSegment(key)}`, depth: depth + 1, kind: childKind });
    }
  }
  return walk;
};

/**
 * Decides the HTTP method check for each tool. A tool fails only when a
 * property with a method-style name (`method`, `http_method`, `verb`, ...) is
 * declared directly in a plain input schema (see `PLAIN_OBJECT_KEYWORDS`) and
 * its own plain `enum` or `const` lists both safe and unsafe methods. Every
 * other method-style property, and every `enum`/`const` elsewhere that lists
 * both, puts the tool up for manual review: the check does not work out
 * whether other keywords narrow or widen the accepted methods. A schema with
 * `patternProperties` or an external `$ref` is reviewed too, even when no
 * method argument is visible, because either could declare one.
 */
export const assessHttpMethodSelectors = (tools: readonly ToolLike[]): MethodSelectorAssessment => {
  const failures: OperationSelectorMatch[] = [];
  const reviews: MethodSelectorReview[] = [];
  for (const tool of tools) {
    const walk = walkSchema(tool.inputSchema);
    if (!walk.complete) {
      reviews.push({ tool: tool.name, location: '', reason: 'too-large' });
      continue;
    }
    const root = tool.inputSchema;
    const decided = new Set<unknown>();
    const toolFailures: OperationSelectorMatch[] = [];
    const toolReviews: MethodSelectorReview[] = [];
    for (const { owner, name, location } of walk.methodProperties) {
      const schema = (owner.properties as Record<string, unknown>)[name];
      const values = owner === root && isPlainObject(root) ? plainValues(schema) : undefined;
      if (!values) {
        toolReviews.push({ tool: tool.name, location, reason: owner === root ? 'not-plain' : 'nested' });
        continue;
      }
      decided.add(schema);
      if (mixesSafeAndUnsafe(values)) {
        const methods = [...new Set(values.map((value) => value.toUpperCase()))];
        const categories: OperationCategory[] = methods.includes('DELETE') ? ['read', 'write', 'destructive'] : ['read', 'write'];
        toolFailures.push({ tool: tool.name, argument: name, values: limitedValues(methods), categories });
      }
    }
    for (const { node, location } of walk.methodValueSets) {
      if (!decided.has(node)) toolReviews.push({ tool: tool.name, location, reason: 'method-values' });
    }
    for (const { location } of walk.unsupported) {
      toolReviews.push({ tool: tool.name, location, reason: 'unsupported-keyword' });
    }
    failures.push(...toolFailures);
    // A confirmed failure stands on its own; the rest of that tool needs no separate review.
    if (toolFailures.length === 0 && toolReviews.length > 0) reviews.push(toolReviews[0]);
  }
  return { failures, reviews };
};

/** The plain selector arguments the multiplexing advisory reads: top-level ones and operation list fields. */
const advisoryCandidates = (inputSchema: unknown): { path: string; name: string; values: string[] }[] => {
  if (!isPlainObject(inputSchema)) return [];
  const candidates: { path: string; name: string; values: string[] }[] = [];
  for (const [name, schema] of Object.entries(inputSchema.properties)) {
    const values = plainValues(schema);
    if (values) {
      candidates.push({ path: name, name: canonicalName(name), values });
      continue;
    }
    if (!isRecord(schema) || schema.type !== 'array' || !usesOnly(schema, PLAIN_ARRAY_KEYWORDS)) continue;
    // A list of operation names (`actions: { items: { enum } }`).
    const itemValues = plainValues(schema.items);
    if (itemValues) {
      candidates.push({ path: name, name: canonicalName(name), values: itemValues });
      continue;
    }
    // A list of operation objects (`operations: { items: { properties: { op: { enum } } } }`).
    if (!OPERATION_LIST_NAMES.has(canonicalName(name)) || !isPlainObject(schema.items)) continue;
    for (const [field, fieldSchema] of Object.entries(schema.items.properties)) {
      const fieldValues = plainValues(fieldSchema);
      if (fieldValues) candidates.push({ path: `${name}[].${field}`, name: canonicalName(field), values: fieldValues });
    }
  }
  return candidates;
};

/**
 * Heuristic: an operation-selector argument whose enumerated values read as
 * both read and write (or destructive) verbs. Guards against false positives:
 * the argument must have a selector name (`action`, `operation`, ...), a plain
 * value set (see the module comment), at least two values that classify as
 * verbs, and reads mixed with writes. HTTP method selectors are left to
 * `assessHttpMethodSelectors`.
 */
export const findMultiplexedOperationSelectors = (
  tools: readonly ToolLike[]
): OperationSelectorMatch[] => (
  tools.flatMap((tool) => advisoryCandidates(tool.inputSchema).flatMap((candidate) => {
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
