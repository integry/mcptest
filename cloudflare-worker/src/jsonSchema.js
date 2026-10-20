// Minimal JSON Schema (draft 2020-12 subset) validator for the published report schema.
//
// The Worker may not depend on anything beyond the Workers runtime, so this covers
// exactly the keyword vocabulary used by public/schemas/report/v2.schema.json:
// type, const, enum, required, properties, additionalProperties, unevaluatedProperties,
// items, minItems, maxItems, minLength, maxLength, pattern, format, minimum, maximum,
// exclusiveMinimum, exclusiveMaximum, $ref (local "#/..." pointers), allOf, anyOf,
// oneOf, not and if/then/else. Any keyword outside this list is rejected at compile
// time so a schema change cannot silently weaken validation.

const SUPPORTED_KEYWORDS = new Set([
  '$schema', '$id', 'title', 'description', '$defs', 'definitions', '$comment',
  'type', 'const', 'enum', 'required', 'properties', 'additionalProperties',
  'unevaluatedProperties', 'items', 'minItems', 'maxItems', 'minLength', 'maxLength',
  'pattern', 'format', 'minimum', 'maximum', 'exclusiveMinimum', 'exclusiveMaximum',
  '$ref', 'allOf', 'anyOf', 'oneOf', 'not', 'if', 'then', 'else',
]);

const isObject = (value) => value !== null && typeof value === 'object' && !Array.isArray(value);

const FORMATS = {
  'date-time': (value) => (
    /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}(?:\.\d+)?(?:Z|[+-]\d{2}:\d{2})$/.test(value)
    && !Number.isNaN(Date.parse(value))
  ),
  date: (value) => /^\d{4}-\d{2}-\d{2}$/.test(value) && !Number.isNaN(Date.parse(`${value}T00:00:00Z`)),
  uri: (value) => {
    try {
      return /^[A-Za-z][A-Za-z0-9+.-]*:/.test(value) && Boolean(new URL(value));
    } catch {
      return false;
    }
  },
};

const deepEqual = (left, right) => {
  if (left === right) return true;
  if (typeof left !== typeof right || left === null || right === null) return false;
  if (Array.isArray(left)) {
    return Array.isArray(right)
      && left.length === right.length
      && left.every((item, index) => deepEqual(item, right[index]));
  }
  if (typeof left === 'object') {
    if (Array.isArray(right)) return false;
    const leftKeys = Object.keys(left);
    const rightKeys = Object.keys(right);
    return leftKeys.length === rightKeys.length
      && leftKeys.every((key) => Object.prototype.hasOwnProperty.call(right, key) && deepEqual(left[key], right[key]));
  }
  return false;
};

const typeMatches = (type, value) => {
  switch (type) {
    case 'object': return isObject(value);
    case 'array': return Array.isArray(value);
    case 'string': return typeof value === 'string';
    case 'number': return typeof value === 'number' && Number.isFinite(value);
    case 'integer': return Number.isInteger(value);
    case 'boolean': return typeof value === 'boolean';
    case 'null': return value === null;
    default: return false;
  }
};

const resolvePointer = (root, ref) => {
  if (!ref.startsWith('#')) throw new Error(`Unsupported $ref: ${ref}`);
  const segments = ref.slice(1).split('/').filter(Boolean)
    .map((segment) => decodeURIComponent(segment).replace(/~1/g, '/').replace(/~0/g, '~'));
  let node = root;
  for (const segment of segments) {
    if (!isObject(node) || !(segment in node)) throw new Error(`Unresolvable $ref: ${ref}`);
    node = node[segment];
  }
  return node;
};

const assertSupported = (schema, path, seen) => {
  if (typeof schema === 'boolean') return;
  if (!isObject(schema)) throw new Error(`Invalid schema at ${path}`);
  if (seen.has(schema)) return;
  seen.add(schema);
  for (const [keyword, value] of Object.entries(schema)) {
    if (!SUPPORTED_KEYWORDS.has(keyword)) {
      throw new Error(`Unsupported JSON Schema keyword "${keyword}" at ${path}`);
    }
    const child = `${path}/${keyword}`;
    if (keyword === 'properties' || keyword === '$defs' || keyword === 'definitions') {
      for (const [name, subschema] of Object.entries(value)) assertSupported(subschema, `${child}/${name}`, seen);
    } else if (['allOf', 'anyOf', 'oneOf'].includes(keyword)) {
      value.forEach((subschema, index) => assertSupported(subschema, `${child}/${index}`, seen));
    } else if (['additionalProperties', 'unevaluatedProperties', 'items', 'not', 'if', 'then', 'else'].includes(keyword)) {
      assertSupported(value, child, seen);
    } else if (keyword === 'items' && Array.isArray(value)) {
      throw new Error(`Tuple items are unsupported at ${path}`);
    }
  }
};

/**
 * Compiles a schema into a validate(value) function returning
 * { valid: boolean, errors: Array<{ path: string, message: string }> }.
 */
export function compileSchema(rootSchema) {
  assertSupported(rootSchema, '#', new Set());
  const patternCache = new Map();
  const regex = (source) => {
    if (!patternCache.has(source)) patternCache.set(source, new RegExp(source, 'u'));
    return patternCache.get(source);
  };

  // Returns the set of evaluated property names (for unevaluatedProperties) or
  // undefined when the instance is invalid against this schema.
  const evaluate = (schema, value, path, errors) => {
    if (schema === true) return new Set();
    if (schema === false) {
      errors.push({ path, message: 'schema is false' });
      return undefined;
    }
    const evaluated = new Set();
    let valid = true;
    const fail = (message) => {
      errors.push({ path, message });
      valid = false;
    };

    if ('$ref' in schema) {
      const target = resolvePointer(rootSchema, schema.$ref);
      const result = evaluate(target, value, path, errors);
      if (!result) valid = false;
      else result.forEach((name) => evaluated.add(name));
    }
    if ('type' in schema) {
      const types = Array.isArray(schema.type) ? schema.type : [schema.type];
      if (!types.some((type) => typeMatches(type, value))) fail(`expected ${types.join(' or ')}`);
    }
    if ('const' in schema && !deepEqual(schema.const, value)) fail(`expected const ${JSON.stringify(schema.const)}`);
    if ('enum' in schema && !schema.enum.some((option) => deepEqual(option, value))) {
      fail(`expected one of ${JSON.stringify(schema.enum)}`);
    }
    if (typeof value === 'string') {
      const length = [...value].length;
      if ('minLength' in schema && length < schema.minLength) fail(`shorter than ${schema.minLength}`);
      if ('maxLength' in schema && length > schema.maxLength) fail(`longer than ${schema.maxLength}`);
      if ('pattern' in schema && !regex(schema.pattern).test(value)) fail(`does not match ${schema.pattern}`);
      if ('format' in schema && FORMATS[schema.format] && !FORMATS[schema.format](value)) {
        fail(`invalid ${schema.format}`);
      }
    }
    if (typeof value === 'number') {
      if ('minimum' in schema && value < schema.minimum) fail(`below minimum ${schema.minimum}`);
      if ('maximum' in schema && value > schema.maximum) fail(`above maximum ${schema.maximum}`);
      if ('exclusiveMinimum' in schema && value <= schema.exclusiveMinimum) fail(`not above ${schema.exclusiveMinimum}`);
      if ('exclusiveMaximum' in schema && value >= schema.exclusiveMaximum) fail(`not below ${schema.exclusiveMaximum}`);
    }
    if (Array.isArray(value)) {
      if ('minItems' in schema && value.length < schema.minItems) fail(`fewer than ${schema.minItems} items`);
      if ('maxItems' in schema && value.length > schema.maxItems) fail(`more than ${schema.maxItems} items`);
      if ('items' in schema) {
        value.forEach((item, index) => {
          if (!evaluate(schema.items, item, `${path}/${index}`, errors)) valid = false;
        });
      }
    }
    if (isObject(value)) {
      if ('required' in schema) {
        for (const name of schema.required) {
          if (!Object.prototype.hasOwnProperty.call(value, name)) fail(`missing required property "${name}"`);
        }
      }
      if ('properties' in schema) {
        for (const [name, subschema] of Object.entries(schema.properties)) {
          if (!Object.prototype.hasOwnProperty.call(value, name)) continue;
          evaluated.add(name);
          if (!evaluate(subschema, value[name], `${path}/${name}`, errors)) valid = false;
        }
      }
      if ('additionalProperties' in schema) {
        for (const name of Object.keys(value)) {
          if (schema.properties && Object.prototype.hasOwnProperty.call(schema.properties, name)) continue;
          evaluated.add(name);
          if (!evaluate(schema.additionalProperties, value[name], `${path}/${name}`, errors)) valid = false;
        }
      }
    }
    for (const keyword of ['allOf', 'anyOf', 'oneOf']) {
      if (!(keyword in schema)) continue;
      const results = schema[keyword].map((subschema) => {
        const branchErrors = [];
        const result = evaluate(subschema, value, path, branchErrors);
        return { result, branchErrors };
      });
      const passing = results.filter(({ result }) => result);
      if (keyword === 'allOf' && passing.length !== results.length) {
        results.forEach(({ branchErrors }) => errors.push(...branchErrors));
        valid = false;
      } else if (keyword === 'anyOf' && passing.length === 0) {
        results.forEach(({ branchErrors }) => errors.push(...branchErrors));
        fail('no anyOf branch matched');
      } else if (keyword === 'oneOf' && passing.length !== 1) {
        fail(`${passing.length} oneOf branches matched`);
      }
      passing.forEach(({ result }) => result.forEach((name) => evaluated.add(name)));
    }
    if ('not' in schema && evaluate(schema.not, value, path, [])) fail('matched a "not" schema');
    if ('if' in schema) {
      const conditionResult = evaluate(schema.if, value, path, []);
      if (conditionResult) conditionResult.forEach((name) => evaluated.add(name));
      const branch = conditionResult ? schema.then : schema.else;
      if (branch !== undefined) {
        const result = evaluate(branch, value, path, errors);
        if (!result) valid = false;
        else result.forEach((name) => evaluated.add(name));
      }
    }
    if ('unevaluatedProperties' in schema && isObject(value)) {
      for (const name of Object.keys(value)) {
        if (evaluated.has(name)) continue;
        evaluated.add(name);
        if (!evaluate(schema.unevaluatedProperties, value[name], `${path}/${name}`, errors)) valid = false;
      }
    }
    return valid ? evaluated : undefined;
  };

  return (value) => {
    const errors = [];
    const valid = Boolean(evaluate(rootSchema, value, '', errors));
    return { valid, errors: valid ? [] : errors.slice(0, 20) };
  };
}
