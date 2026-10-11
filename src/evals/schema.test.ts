import { describe, expect, it } from 'vitest';
import { validateJsonSchema } from './schema';

describe('tool argument JSON Schema validation', () => {
  it('resolves local references and compares object enums by JSON value', () => {
    const schema = {
      $defs: {
        request: {
          type: 'object',
          properties: { city: { enum: [{ name: 'Lisbon' }] } },
          required: ['city'],
          additionalProperties: false,
        },
      },
      $ref: '#/$defs/request',
    };

    expect(validateJsonSchema({ city: { name: 'Lisbon' } }, schema)).toEqual([]);
    expect(validateJsonSchema({ city: { name: 'Oslo' } }, schema)).not.toEqual([]);
  });

  it('enforces array size and uniqueness constraints', () => {
    const schema = {
      type: 'array',
      minItems: 2,
      maxItems: 3,
      uniqueItems: true,
      items: { type: 'string' },
    };

    expect(validateJsonSchema(['a', 'b'], schema)).toEqual([]);
    expect(validateJsonSchema(['a'], schema)).not.toEqual([]);
    expect(validateJsonSchema(['a', 'a'], schema)).not.toEqual([]);
    expect(validateJsonSchema(['a', 'b', 'c', 'd'], schema)).not.toEqual([]);
  });

  it('enforces negated schemas', () => {
    const schema = { not: { type: 'object', required: ['credential'] } };
    expect(validateJsonSchema({ city: 'Lisbon' }, schema)).toEqual([]);
    expect(validateJsonSchema({ credential: 'must-not-be-present' }, schema)).not.toEqual([]);
  });

  it('rejects constructs that are not valid in the accepted 2020-12 draft', () => {
    expect(validateJsonSchema(['a'], {
      type: 'array',
      items: { type: 'string' },
      additionalItems: false,
    }).join(' ')).toContain('Schema is invalid');
  });
});
