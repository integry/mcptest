import { describe, expect, it } from 'vitest';
import {
  findMixedHttpMethodSelectors,
  findMultiplexedOperationSelectors,
  findUninterpretedSelectorScopes,
  findUnresolvedHttpMethodSelectors,
} from './toolOperationMultiplexing';

const schemaTool = (name: string, inputSchema: Record<string, unknown>) => ({
  name,
  inputSchema: { type: 'object', ...inputSchema },
});

describe('server-controlled patternProperties', () => {
  const evil = `${'a'.repeat(40)}!`;

  it('scans a nested-quantifier pattern without backtracking on unrelated properties', () => {
    const tools = [schemaTool('evil', {
      properties: { [evil]: { type: 'string' }, method: { enum: ['GET', 'POST'] } },
      patternProperties: { '^(a+)+$': { type: 'string' } },
    })];
    const started = Date.now();
    expect(findMixedHttpMethodSelectors(tools)).toHaveLength(1);
    expect(findUninterpretedSelectorScopes(tools)).toEqual([]);
    findMultiplexedOperationSelectors(tools);
    findUnresolvedHttpMethodSelectors(tools);
    expect(Date.now() - started).toBeLessThan(2000);
  });

  it('still applies a matching bounded pattern', () => {
    expect(findMixedHttpMethodSelectors([schemaTool('narrowed', {
      properties: { method: { enum: ['GET', 'POST'] } },
      patternProperties: { '^(m|x)+ethod$': { const: 'GET' } },
    })])).toEqual([]);
  });

  it('leaves patterns outside the bounded subset unresolved instead of running them', () => {
    const tools = [schemaTool('lookahead', {
      properties: { method: { enum: ['GET', 'POST'] } },
      patternProperties: { '^(?=m)': { const: 'GET' } },
    })];
    expect(findMixedHttpMethodSelectors(tools)).toEqual([]);
    expect(findUnresolvedHttpMethodSelectors(tools)).toEqual([{ tool: 'lookahead', argument: 'method', values: [], categories: [] }]);
  });
});

describe('array-wide constraints on selector arrays', () => {
  const methodArray = (extra: Record<string, unknown>) => schemaTool('api_request', {
    properties: { method: { type: 'array', items: { enum: ['GET', 'POST'] }, ...extra } },
  });

  it('does not fail a singleton array whose contains admits only GET', () => {
    const tools = [methodArray({ contains: { const: 'GET' }, minItems: 1, maxItems: 1 })];
    expect(findMixedHttpMethodSelectors(tools)).toEqual([]);
    expect(findUnresolvedHttpMethodSelectors(tools)).toEqual([{ tool: 'api_request', argument: 'method', values: [], categories: [] }]);
  });

  it.each([
    ['contains alone', { contains: { const: 'GET' } }],
    ['minContains', { contains: { const: 'GET' }, minContains: 1 }],
    ['maxContains', { maxContains: 1 }],
    ['maxItems 0', { maxItems: 0 }],
    ['minItems above maxItems', { minItems: 3, maxItems: 2 }],
    ['non-integer bound', { maxItems: 'one' }],
    ['uniqueItems with minItems 2', { uniqueItems: true, minItems: 2 }],
  ])('leaves %s unresolved instead of failing', (_label, extra) => {
    const tools = [methodArray(extra)];
    expect(findMixedHttpMethodSelectors(tools)).toEqual([]);
    expect(findUnresolvedHttpMethodSelectors(tools)).toHaveLength(1);
  });

  it.each([
    ['minItems 1', { minItems: 1 }],
    ['maxItems 1', { maxItems: 1 }],
    ['uniqueItems', { uniqueItems: true }],
  ])('keeps the element set under %s, which leaves every element usable', (_label, extra) => {
    expect(findMixedHttpMethodSelectors([methodArray(extra)])).toHaveLength(1);
  });

  it('applies the same rule to arrays declared through composition and to lists of request objects', () => {
    const request = { properties: { method: { enum: ['GET', 'POST'] } } };
    const tools = [
      schemaTool('composed', { properties: { method: { type: 'array', allOf: [{ items: { enum: ['GET', 'POST'] }, contains: { const: 'GET' }, maxItems: 1 }] } } }),
      schemaTool('requests', { properties: { requests: { type: 'array', items: request, contains: request, maxItems: 1 } } }),
    ];
    expect(findMixedHttpMethodSelectors(tools)).toEqual([]);
    expect(findMixedHttpMethodSelectors([
      schemaTool('requests', { properties: { requests: { type: 'array', items: request, minItems: 1 } } }),
    ])).toHaveLength(1);
  });

  it('applies it to the multiplexing advisory', () => {
    expect(findMultiplexedOperationSelectors([schemaTool('run', {
      properties: { operations: { type: 'array', items: { enum: ['get_page', 'delete_page'] }, contains: { const: 'get_page' }, maxItems: 1 } },
    })])).toEqual([]);
  });
});
