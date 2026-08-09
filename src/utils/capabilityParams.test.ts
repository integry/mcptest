import { describe, expect, it } from 'vitest';
import {
  getCapabilityInputSpec,
  getMissingRequiredParams,
  normalizeCapabilityParams,
} from './capabilityParams';

describe('capability parameters', () => {
  const tool = {
    inputSchema: {
      type: 'object',
      properties: {
        query: { type: 'string' },
        options: { type: 'object' },
        ids: { type: 'array' },
        enabled: { type: 'boolean' },
      },
      required: ['query', 'enabled'],
    },
  };

  it('reads JSON Schema and prompt argument formats', () => {
    expect(getCapabilityInputSpec(tool)).toMatchObject({
      required: ['query', 'enabled'],
      definitions: [{ name: 'query' }, { name: 'options' }, { name: 'ids' }, { name: 'enabled' }],
    });
    expect(getCapabilityInputSpec({ arguments: [{ name: 'topic', required: true }] })).toEqual({
      definitions: [{ name: 'topic', required: true }],
      required: ['topic'],
    });
  });

  it('treats false and zero as present while rejecting blank required strings', () => {
    expect(getMissingRequiredParams(tool, { query: '   ', enabled: false })).toEqual(['query']);
    expect(getMissingRequiredParams(tool, { query: 'prices', enabled: false })).toEqual([]);
  });

  it('parses object and array inputs before sending the MCP call', () => {
    expect(normalizeCapabilityParams(tool, {
      query: 'prices',
      options: '{"limit": 3}',
      ids: '["btc", "eth"]',
    })).toEqual({
      query: 'prices',
      options: { limit: 3 },
      ids: ['btc', 'eth'],
    });
  });

  it('returns an actionable error for malformed structured input', () => {
    expect(() => normalizeCapabilityParams(tool, { options: '{nope}' }))
      .toThrow('“options” must contain valid JSON.');
    expect(() => normalizeCapabilityParams(tool, { ids: '{"not":"an array"}' }))
      .toThrow('“ids” must be a JSON array.');
  });
});
