import { describe, expect, it } from 'vitest';
import {
  classifyOperation,
  findAmbiguousHttpMethodSelectors,
  findMixedHttpMethodSelectors,
  findMultiplexedOperationSelectors,
  findUninterpretedSelectorScopes,
  findUnresolvedHttpMethodSelectors,
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

  it('flags oneOf const selectors and a list of operation objects', () => {
    const matches = findMultiplexedOperationSelectors([
      tool('records', { operation: { oneOf: [{ const: 'read_record' }, { const: 'update_record' }] } }),
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

    it('leaves HTTP method selectors to the method check', () => {
      expect(findMultiplexedOperationSelectors([
        tool('api_request', { method: { enum: ['GET', 'POST'] } }),
      ])).toEqual([]);
    });
  });
});

describe('findAmbiguousHttpMethodSelectors', () => {
  it('reports free-text method arguments whose description mentions safe and unsafe methods', () => {
    expect(findAmbiguousHttpMethodSelectors([
      tool('fetch', { method: { type: 'string', description: 'Only GET is supported; POST and DELETE are rejected.' } }),
      tool('reads', { method: { type: 'string', description: 'GET or HEAD.' } }),
      tool('enum', { method: { enum: ['GET', 'POST'] } }),
    ])).toEqual([{
      tool: 'fetch',
      argument: 'method',
      values: ['GET', 'POST', 'DELETE'],
      categories: ['read', 'write', 'destructive'],
    }]);
  });
});

describe('findMixedHttpMethodSelectors', () => {
  it('flags a method enum with safe and unsafe methods', () => {
    expect(findMixedHttpMethodSelectors([
      tool('api_request', { method: { type: 'string', enum: ['GET', 'POST', 'DELETE'] }, path: { type: 'string' } }),
    ])).toEqual([{
      tool: 'api_request',
      argument: 'method',
      values: ['GET', 'POST', 'DELETE'],
      categories: ['read', 'write', 'destructive'],
    }]);
  });

  it('does not treat methods named in a description as accepted methods', () => {
    expect(findMixedHttpMethodSelectors([
      tool('http', { http_method: { type: 'string', description: 'One of GET, PUT or PATCH.' } }),
      tool('fetch', { method: { type: 'string', description: 'Only GET is supported; POST and DELETE are rejected.' } }),
    ])).toEqual([]);
  });

  it('flags a oneOf of method consts as an explicit value set', () => {
    expect(findMixedHttpMethodSelectors([
      tool('http', { method: { oneOf: [{ const: 'GET' }, { const: 'PUT' }] } }),
    ])).toHaveLength(1);
  });

  it('accepts lowercase enum values', () => {
    expect(findMixedHttpMethodSelectors([
      tool('http', { method: { enum: ['get', 'patch'] } }),
    ])).toHaveLength(1);
  });

  it('passes method arguments limited to safe or to unsafe methods', () => {
    expect(findMixedHttpMethodSelectors([
      tool('fetch', { method: { enum: ['GET', 'HEAD'] } }),
      tool('write', { method: { enum: ['POST', 'PUT'] } }),
      tool('notes', { method: { type: 'string', description: 'Lookup method, for example by name.' } }),
    ])).toEqual([]);
  });

  it('intersects enum with const before failing', () => {
    expect(findMixedHttpMethodSelectors([
      tool('fetch', { method: { enum: ['GET', 'POST'], const: 'GET' } }),
    ])).toEqual([]);
  });

  it('intersects allOf branches and honours oneOf exclusivity', () => {
    expect(findMixedHttpMethodSelectors([
      tool('all', { method: { allOf: [{ enum: ['GET', 'POST'] }, { enum: ['GET', 'HEAD'] }] } }),
      tool('one', { method: { oneOf: [{ enum: ['GET', 'POST'] }, { const: 'POST' }] } }),
    ])).toEqual([]);
    expect(findMixedHttpMethodSelectors([
      tool('all', { method: { allOf: [{ enum: ['GET', 'POST'] }, { type: 'string' }] } }),
    ])).toHaveLength(1);
  });

  it('does not fail constraints it cannot interpret', () => {
    expect(findMixedHttpMethodSelectors([
      tool('pattern', { method: { enum: ['GET', 'POST'], pattern: '^G' } }),
      tool('any_branch', { method: { anyOf: [{ const: 'GET' }, { type: 'string' }, { const: 'POST' }] } }),
      tool('ref', { method: { $ref: '#/$defs/method' } }),
    ])).toEqual([]);
  });

  it('ignores HTTP-looking enums on arguments not named as a method', () => {
    expect(findMixedHttpMethodSelectors([
      tool('docs', { section: { enum: ['GET', 'POST'] } }),
    ])).toEqual([]);
  });
});

describe('findUnresolvedHttpMethodSelectors', () => {
  it('reports unconstrained and uninterpreted method arguments, not established value sets', () => {
    const matches = findUnresolvedHttpMethodSelectors([
      tool('bare', { method: { type: 'string' } }),
      tool('described', { method: { type: 'string', description: 'GET or POST.' } }),
      tool('pattern', { method: { enum: ['GET', 'POST'], pattern: '^G' } }),
      tool('any_branch', { method: { anyOf: [{ const: 'GET' }, { type: 'string' }] } }),
      tool('enum', { method: { enum: ['GET', 'POST'] } }),
      tool('narrowed', { method: { enum: ['GET', 'POST'], const: 'GET' } }),
      tool('other', { query: { type: 'string' } }),
    ]);
    expect(matches.map((match) => match.tool)).toEqual(['bare', 'described', 'pattern', 'any_branch']);
  });
});

describe('findMultiplexedOperationSelectors with intersecting constraints', () => {
  it('uses the intersection of enum and const', () => {
    expect(findMultiplexedOperationSelectors([
      tool('records', { action: { enum: ['list_records', 'delete_record'], const: 'list_records' } }),
    ])).toEqual([]);
  });
});

describe('enclosing schema constraints', () => {
  const schemaTool = (name: string, inputSchema: Record<string, unknown>) => ({
    name,
    inputSchema: { type: 'object', ...inputSchema },
  });

  it('narrows a direct method property by a root allOf before failing it', () => {
    const tools = [schemaTool('fetch', {
      properties: { method: { enum: ['GET', 'POST'] } },
      allOf: [{ properties: { method: { const: 'GET' } } }],
    })];
    expect(findMixedHttpMethodSelectors(tools)).toEqual([]);
    expect(findUnresolvedHttpMethodSelectors(tools)).toEqual([]);
    expect(findUninterpretedSelectorScopes(tools)).toEqual([]);
  });

  it('scans method properties declared only inside root composition', () => {
    expect(findMixedHttpMethodSelectors([
      schemaTool('all', { allOf: [{ properties: { method: { enum: ['GET', 'POST'] } } }] }),
      schemaTool('any', { anyOf: [{ properties: { method: { const: 'GET' } } }, { properties: { method: { const: 'POST' } } }] }),
      schemaTool('one', {
        oneOf: [
          { properties: { kind: { const: 'read' }, method: { const: 'GET' } } },
          { properties: { kind: { const: 'write' }, method: { enum: ['POST', 'DELETE'] } } },
        ],
      }),
    ]).map((match) => [match.tool, match.argument])).toEqual([['all', 'method'], ['any', 'method'], ['one', 'method']]);
  });

  it('reports a composed-only method without constraints as unresolved', () => {
    expect(findUnresolvedHttpMethodSelectors([
      schemaTool('composed', { allOf: [{ properties: { method: { type: 'string' } } }] }),
    ]).map((match) => match.argument)).toEqual(['method']);
  });

  it('does not decide object-level oneOf branches whose method sets overlap', () => {
    const tools = [schemaTool('overlap', {
      oneOf: [
        { properties: { method: { const: 'GET' } } },
        { properties: { method: { enum: ['GET', 'POST'] } } },
      ],
    })];
    expect(findMixedHttpMethodSelectors(tools)).toEqual([]);
    expect(findUnresolvedHttpMethodSelectors(tools)).toHaveLength(1);
  });

  it('keeps an established method set when root oneOf does not constrain it', () => {
    expect(findMixedHttpMethodSelectors([
      schemaTool('discriminated', {
        properties: { method: { enum: ['GET', 'POST'] } },
        oneOf: [{ required: ['path'] }, { required: ['url'] }],
      }),
    ])).toHaveLength(1);
  });

  it('applies matching patternProperties and root additionalProperties', () => {
    const tools = [
      schemaTool('pattern', {
        properties: { method: { enum: ['GET', 'POST'] } },
        patternProperties: { '^meth': { const: 'GET' } },
      }),
      schemaTool('closed', {
        additionalProperties: false,
        allOf: [{ properties: { method: { enum: ['GET', 'POST'] } } }],
      }),
    ];
    expect(findMixedHttpMethodSelectors(tools)).toEqual([]);
    expect(findUnresolvedHttpMethodSelectors(tools)).toEqual([]);
  });

  it('leaves enclosing constraints it cannot interpret unresolved instead of failing', () => {
    const tools = [schemaTool('negated', {
      properties: { method: { enum: ['GET', 'POST'] } },
      not: { properties: { method: { const: 'POST' } } },
    })];
    expect(findMixedHttpMethodSelectors(tools)).toEqual([]);
    expect(findUnresolvedHttpMethodSelectors(tools).map((match) => match.tool)).toEqual(['negated']);
  });

  it('reports schemas whose declarations the scan cannot follow', () => {
    expect(findUninterpretedSelectorScopes([
      schemaTool('ref', { $ref: '#/$defs/args', $defs: { args: { properties: { method: { enum: ['GET', 'POST'] } } } } }),
      schemaTool('conditional', { if: { required: ['body'] }, then: { properties: { method: { const: 'POST' } } } }),
      schemaTool('nested', { allOf: [{ $ref: '#/$defs/args' }] }),
      schemaTool('batch', { properties: { requests: { type: 'array', items: { $ref: '#/$defs/request' } } } }),
      schemaTool('plain', { properties: { method: { enum: ['GET'] } }, allOf: [{ required: ['method'] }] }),
    ]).map((match) => [match.tool, match.argument])).toEqual([
      ['ref', 'input schema'],
      ['conditional', 'input schema'],
      ['nested', 'input schema'],
      ['batch', 'requests[]'],
    ]);
  });

  it('applies enclosing constraints on operation list items', () => {
    expect(findMixedHttpMethodSelectors([
      schemaTool('narrowed', {
        properties: {
          requests: {
            type: 'array',
            items: { properties: { method: { enum: ['GET', 'POST'] } }, allOf: [{ properties: { method: { const: 'GET' } } }] },
          },
        },
      }),
      schemaTool('composed', {
        properties: { requests: { type: 'array', items: { allOf: [{ properties: { method: { enum: ['GET', 'PUT'] } } }] } } },
      }),
    ]).map((match) => [match.tool, match.argument])).toEqual([['composed', 'requests[].method']]);
  });

  it('applies the same constraints to the multiplexing advisory', () => {
    expect(findMultiplexedOperationSelectors([
      schemaTool('narrowed', {
        properties: { action: { enum: ['list_records', 'delete_record'] } },
        allOf: [{ properties: { action: { const: 'list_records' } } }],
      }),
      schemaTool('composed', { allOf: [{ properties: { action: { enum: ['list_records', 'delete_record'] } } }] }),
    ]).map((match) => match.tool)).toEqual(['composed']);
  });
});
