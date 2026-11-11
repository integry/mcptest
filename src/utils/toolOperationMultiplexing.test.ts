import { describe, expect, it } from 'vitest';
import {
  classifyOperation,
  findMixedHttpMethodSelectors,
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

  it('reads methods from the description when the argument has no enum', () => {
    expect(findMixedHttpMethodSelectors([
      tool('http', { http_method: { type: 'string', description: 'One of GET, PUT or PATCH.' } }),
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

  it('ignores HTTP-looking enums on arguments not named as a method', () => {
    expect(findMixedHttpMethodSelectors([
      tool('docs', { section: { enum: ['GET', 'POST'] } }),
    ])).toEqual([]);
  });
});
