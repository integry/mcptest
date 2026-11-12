import { describe, expect, it } from 'vitest';
import {
  assessHttpMethodSelectors,
  classifyOperation,
  findMultiplexedOperationSelectors,
} from './toolOperationMultiplexing';

const tool = (name: string, properties: Record<string, unknown>) => ({
  name,
  inputSchema: { type: 'object', properties },
});

describe('classifyOperation', () => {
  it('reads the first verb token in snake, kebab, dotted, and camel case', () => {
    expect(classifyOperation('get_issue')).toBe('read');
    expect(classifyOperation('createIssue')).toBe('write');
    expect(classifyOperation('issues.delete')).toBe('destructive');
    expect(classifyOperation('list-repos')).toBe('read');
    expect(classifyOperation('email')).toBeUndefined();
  });
});

describe('findMultiplexedOperationSelectors', () => {
  it('flags an action enum that mixes reads and writes', () => {
    const matches = findMultiplexedOperationSelectors([
      tool('manage_issues', { action: { type: 'string', enum: ['list', 'get', 'create', 'delete'] } }),
    ]);
    expect(matches).toEqual([{
      tool: 'manage_issues',
      argument: 'action',
      values: ['list', 'get', 'create', 'delete'],
      categories: ['destructive', 'read', 'write'],
    }]);
  });

  it('flags a list of operation objects', () => {
    const matches = findMultiplexedOperationSelectors([
      tool('records', { operation: { type: 'string', enum: ['read_record', 'update_record'] } }),
      tool('batch', {
        operations: {
          type: 'array',
          items: { type: 'object', properties: { op: { enum: ['search', 'upsert'] } } },
        },
      }),
    ]);
    expect(matches.map((match) => `${match.tool}:${match.argument}`)).toEqual([
      'records:operation',
      'batch:operations[].op',
    ]);
  });

  it('flags an array of operation names', () => {
    const matches = findMultiplexedOperationSelectors([
      tool('run', { operations: { type: 'array', items: { enum: ['fetch_page', 'post_comment'] } } }),
    ]);
    expect(matches).toHaveLength(1);
  });

  describe('false-positive guards', () => {
    it('ignores selectors whose operations are all reads', () => {
      expect(findMultiplexedOperationSelectors([
        tool('search', { action: { enum: ['list', 'get', 'search'] } }),
      ])).toEqual([]);
    });

    it('ignores selectors whose operations are all writes', () => {
      expect(findMultiplexedOperationSelectors([
        tool('editor', { action: { enum: ['create', 'update', 'delete'] } }),
      ])).toEqual([]);
    });

    it('ignores enums on arguments that are not operation selectors', () => {
      expect(findMultiplexedOperationSelectors([
        tool('list_tickets', {
          status: { enum: ['open', 'closed'] },
          sort: { enum: ['get_date', 'update_date'] },
          view: { enum: ['list', 'create_form'] },
        }),
      ])).toEqual([]);
    });

    it('ignores values that are not verbs', () => {
      expect(findMultiplexedOperationSelectors([
        tool('notify', { action: { enum: ['email', 'sms', 'push'] } }),
      ])).toEqual([]);
    });

    it('needs at least two classified values', () => {
      expect(findMultiplexedOperationSelectors([
        tool('one', { action: { const: 'get' } }),
        tool('two', { action: { enum: ['get', 'frobnicate'] } }),
      ])).toEqual([]);
    });

    it('ignores free-text action arguments without an enumerated value set', () => {
      expect(findMultiplexedOperationSelectors([
        tool('agent', { action: { type: 'string', description: 'get or create or delete' } }),
      ])).toEqual([]);
    });

    it('tolerates malformed schemas', () => {
      expect(findMultiplexedOperationSelectors([
        { name: 'broken', inputSchema: null },
        { name: 'weird', inputSchema: { properties: [] } },
        tool('mixed', { action: { enum: [1, 2, null] } }),
      ])).toEqual([]);
    });

    it('ignores selectors that are not plain enums or consts', () => {
      expect(findMultiplexedOperationSelectors([
        tool('composed', { operation: { oneOf: [{ const: 'read_record' }, { const: 'update_record' }] } }),
        tool('patterned', { action: { enum: ['get_page', 'delete_page'], pattern: '^get' } }),
        { name: 'bounded', inputSchema: { type: 'object', maxProperties: 1, properties: { action: { enum: ['get_page', 'delete_page'] } } } },
      ])).toEqual([]);
    });

    it('leaves HTTP method selectors to the method check', () => {
      expect(findMultiplexedOperationSelectors([
        tool('api_request', { method: { enum: ['GET', 'POST'] } }),
      ])).toEqual([]);
    });
  });
});

const schemaTool = (name: string, inputSchema: Record<string, unknown>) => ({
  name,
  inputSchema: { type: 'object', ...inputSchema },
});

const assess = (...tools: { name: string; inputSchema: unknown }[]) => assessHttpMethodSelectors(tools);
const reviewed = (...tools: { name: string; inputSchema: unknown }[]) => {
  const result = assess(...tools);
  expect(result.failures).toEqual([]);
  return result.reviews;
};

describe('assessHttpMethodSelectors', () => {
  it('fails a plain method enum with safe and unsafe methods', () => {
    expect(assess(tool('api_request', {
      method: { type: 'string', enum: ['GET', 'POST', 'DELETE'], description: 'HTTP method' },
      path: { type: 'string' },
    }))).toEqual({
      failures: [{ tool: 'api_request', argument: 'method', values: ['GET', 'POST', 'DELETE'], categories: ['read', 'write', 'destructive'] }],
      reviews: [],
    });
  });

  it('fails plain method-style names, lowercase values and a plain const list', () => {
    const result = assess(
      tool('lower', { http_method: { enum: ['get', 'put'] } }),
      { name: 'annotated', inputSchema: {
        type: 'object', title: 'Args', description: 'Request', required: ['verb'], additionalProperties: false,
        default: {}, examples: [{ verb: 'GET' }], properties: { verb: { enum: ['HEAD', 'PATCH'], default: 'HEAD', examples: ['HEAD'] } },
      } },
    );
    expect(result.failures.map((match) => `${match.tool}:${match.argument}:${match.values.join(',')}`)).toEqual([
      'lower:http_method:GET,PUT',
      'annotated:verb:HEAD,PATCH',
    ]);
    expect(result.reviews).toEqual([]);
  });

  it('passes plain method arguments limited to safe or to unsafe methods, and tools without one', () => {
    expect(assess(
      tool('reader', { method: { enum: ['GET', 'HEAD'] } }),
      tool('writer', { method: { const: 'POST' } }),
      tool('search', { query: { type: 'string' }, sort: { enum: ['asc', 'desc'] } }),
      { name: 'empty', inputSchema: { type: 'object' } },
    )).toEqual({ failures: [], reviews: [] });
  });

  it('does not treat HTTP-looking enums on other plain arguments as method arguments', () => {
    expect(assess(tool('docs', { section: { enum: ['GET', 'POST'] } })).failures).toEqual([]);
  });

  it('leaves free-text and non-enum method arguments for manual review', () => {
    expect(reviewed(
      tool('free', { method: { type: 'string', description: 'GET or POST' } }),
      tool('typed', { method: { type: 'integer', enum: ['GET', 'POST'] } }),
      tool('both', { method: { enum: ['GET', 'POST'], const: 'GET' } }),
    )).toEqual([
      { tool: 'free', location: '/properties/method', reason: 'not-plain' },
      { tool: 'typed', location: '/properties/method', reason: 'not-plain' },
      { tool: 'both', location: '/properties/method', reason: 'not-plain' },
    ]);
  });

  it('leaves composition for manual review instead of passing or failing it', () => {
    expect(reviewed(
      schemaTool('narrowed', { properties: { method: { enum: ['GET', 'POST'] } }, allOf: [{ properties: { method: { const: 'GET' } } }] }),
      schemaTool('composed_only', { anyOf: [{ properties: { method: { enum: ['GET', 'POST'] } } }] }),
      schemaTool('branch_values', { properties: { method: { oneOf: [{ const: 'GET' }, { const: 'POST' }] } } }),
    ).map((review) => `${review.tool}:${review.reason}`)).toEqual([
      'narrowed:not-plain',
      'composed_only:nested',
      'branch_values:not-plain',
    ]);
  });

  it.each([
    ['$ref', { $ref: '#/$defs/args', $defs: { args: {} } }],
    ['not', { not: { required: ['method'] } }],
    ['if/then/else', { if: {}, then: {}, else: {} }],
    ['dependentSchemas', { dependentSchemas: { method: {} } }],
    ['patternProperties', { patternProperties: { '^x-': { type: 'string' } } }],
    ['propertyNames', { propertyNames: { maxLength: 10 } }],
    ['minProperties', { minProperties: 1 }],
    ['const', { const: { method: 'GET' } }],
  ])('leaves a method enum under an enclosing %s for manual review', (_keyword, extra) => {
    expect(reviewed(schemaTool('api_request', { properties: { method: { enum: ['GET', 'POST'] } }, ...extra })))
      .toEqual([{ tool: 'api_request', location: '/properties/method', reason: 'not-plain' }]);
  });

  it('leaves nested method arguments and method value sets outside a plain argument for manual review', () => {
    expect(reviewed(
      tool('nested', { request: { type: 'object', properties: { method: { enum: ['GET', 'POST'] } } } }),
      tool('listed', { methods: { type: 'array', items: { enum: ['GET', 'POST'] } } }),
      schemaTool('map', { additionalProperties: { enum: ['GET', 'POST'] } }),
    )).toEqual([
      { tool: 'nested', location: '/properties/request/properties/method', reason: 'nested' },
      { tool: 'listed', location: '/properties/methods/items', reason: 'method-values' },
      { tool: 'map', location: '/additionalProperties', reason: 'method-values' },
    ]);
  });

  it('reports a confirmed failure even when the tool also has an undecided method argument', () => {
    const result = assess(tool('api', {
      method: { enum: ['GET', 'POST'] },
      fallback: { type: 'object', properties: { method: { type: 'string' } } },
    }));
    expect(result.failures.map((match) => match.argument)).toEqual(['method']);
    expect(result.reviews).toEqual([]);
  });

  it('leaves schemas larger than the walk examines for manual review, quickly', () => {
    const wide = Object.fromEntries(Array.from({ length: 20_000 }, (_, index) => [`field_${index}`, { type: 'string' }]));
    let deep: Record<string, unknown> = { type: 'string' };
    for (let index = 0; index < 100; index += 1) deep = { type: 'object', properties: { inner: deep } };
    const started = Date.now();
    expect(reviewed(
      tool('wide', { ...wide, method: { enum: ['GET', 'POST'] } }),
      { name: 'deep', inputSchema: deep },
      tool('long_enum', { method: { enum: Array.from({ length: 50_000 }, (_, index) => `GET${index}`) } }),
    ).map((review) => `${review.tool}:${review.reason}`)).toEqual(['wide:too-large', 'deep:too-large', 'long_enum:too-large']);
    expect(Date.now() - started).toBeLessThan(2000);
  });

  it('tolerates malformed schemas', () => {
    expect(assess(
      { name: 'broken', inputSchema: null },
      { name: 'weird', inputSchema: { properties: [] } },
      { name: 'text', inputSchema: 'method' },
    )).toEqual({ failures: [], reviews: [] });
  });
});

describe('regressions from earlier review rounds', () => {
  it('F12: never compiles a server-supplied pattern and leaves the tool for manual review, quickly', () => {
    const tools = [schemaTool('empty_repeat', {
      properties: { method: { enum: ['GET', 'POST'] } },
      patternProperties: { '(?:){1000000000}': { const: 'GET' } },
    })];
    const RealRegExp = globalThis.RegExp;
    const compiled: string[] = [];
    globalThis.RegExp = new Proxy(RealRegExp, {
      construct(target, args) {
        compiled.push(String(args[0]));
        return Reflect.construct(target, args);
      },
      apply(target, thisArg, args) {
        compiled.push(String(args[0]));
        return Reflect.apply(target, thisArg, args);
      },
    });
    const started = Date.now();
    try {
      expect(reviewed(...tools)).toEqual([{ tool: 'empty_repeat', location: '/properties/method', reason: 'not-plain' }]);
      expect(findMultiplexedOperationSelectors(tools)).toEqual([]);
    } finally {
      globalThis.RegExp = RealRegExp;
    }
    expect(Date.now() - started).toBeLessThan(1000);
    expect(compiled.filter((source) => source.includes('1000000000'))).toEqual([]);
  });

  it('F12: a pattern on the method property itself is not interpreted', () => {
    expect(reviewed(tool('api', { method: { enum: ['GET', 'POST'], pattern: '(?:){1000000000}' } })))
      .toEqual([{ tool: 'api', location: '/properties/method', reason: 'not-plain' }]);
  });

  it('F13: maxProperties around a method enum is manual review, not a failure', () => {
    expect(reviewed(schemaTool('search', {
      required: ['query'],
      maxProperties: 1,
      properties: { query: { type: 'string' }, method: { enum: ['GET', 'POST'] } },
    }))).toEqual([{ tool: 'search', location: '/properties/method', reason: 'not-plain' }]);
  });

  it('F14: a pattern-keyed schema with no visible method argument is manual review, not a pass', () => {
    const tools = [{
      name: 'api_request',
      inputSchema: { type: 'object', patternProperties: { '^method$': { type: 'string' } }, additionalProperties: false },
    }];
    expect(assess(...tools)).toEqual({
      failures: [],
      reviews: [{ tool: 'api_request', location: '/patternProperties', reason: 'unsupported-keyword' }],
    });
  });

  it('F14: patternProperties nested anywhere in the schema is manual review', () => {
    expect(reviewed(tool('wrapper', { request: { type: 'object', patternProperties: { '^m': {} } } })))
      .toEqual([{ tool: 'wrapper', location: '/properties/request/patternProperties', reason: 'unsupported-keyword' }]);
  });

  it('F14: an external $ref is manual review, and is never fetched or resolved', () => {
    expect(reviewed(
      { name: 'root_ref', inputSchema: { $ref: 'https://example.com/schemas/request.json' } },
      tool('nested_ref', { request: { $ref: 'request.json#/definitions/args' } }),
      schemaTool('dynamic_ref', { $dynamicRef: 'https://example.com/meta#node' }),
    )).toEqual([
      { tool: 'root_ref', location: '/$ref', reason: 'unsupported-keyword' },
      { tool: 'nested_ref', location: '/properties/request/$ref', reason: 'unsupported-keyword' },
      { tool: 'dynamic_ref', location: '/$dynamicRef', reason: 'unsupported-keyword' },
    ]);
  });

  it('F14: local refs, keyword-named arguments, and keyword-shaped data still pass', () => {
    expect(assess(
      schemaTool('local_ref', { properties: { query: { $ref: '#/$defs/q' } }, $defs: { q: { type: 'string' } } }),
      tool('named', { patternProperties: { type: 'string' }, $ref: { type: 'string' } }),
      tool('data', { filter: { type: 'object', default: { $ref: 'other.json', patternProperties: { a: 1 } } } }),
      schemaTool('empty_patterns', { patternProperties: {} }),
    )).toEqual({ failures: [], reviews: [] });
  });
});
