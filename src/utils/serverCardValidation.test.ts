import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { describe, expect, it } from 'vitest';
import {
  SERVER_CARD_SCHEMA_URL,
  buildMinimalServerCard,
  resolveRemoteUrl,
  serverCardSchema,
  validateServerCard,
} from './serverCardValidation';

const minimal = {
  $schema: SERVER_CARD_SCHEMA_URL,
  name: 'example-org/minimal',
  version: '1.0.0',
  description: 'Smallest valid Server Card.',
};

describe('vendored Server Card schema', () => {
  it('records where it came from and validates the ServerCard definition', () => {
    expect(serverCardSchema.$comment).toContain('https://github.com/modelcontextprotocol/ext-server-card/blob/526201bbc80231daa40ffcdecfc9da4e54e5dc93/schema.json');
    expect(serverCardSchema.$comment).toContain('2026-08-12');
    expect(serverCardSchema.$ref).toBe('#/$defs/ServerCard');
    expect(serverCardSchema.$defs.ServerCard.required).toEqual(['$schema', 'description', 'name', 'version']);
  });
});

describe('validateServerCard', () => {
  it('accepts the upstream minimal and templated examples', () => {
    expect(validateServerCard(minimal)).toMatchObject({ valid: true, errors: [] });
    const templated = validateServerCard({
      ...minimal,
      name: 'example-org/with-remote',
      remotes: [{
        type: 'streamable-http',
        url: 'https://{tenant}.example.com/mcp',
        headers: [{ name: 'Authorization', isRequired: true, isSecret: true, value: 'Bearer {token}', variables: { token: { isSecret: true } } }],
        variables: { tenant: { description: 'Tenant subdomain.', isRequired: true, default: 'default' } },
        supportedProtocolVersions: ['2025-06-18', '2025-11-25'],
      }],
    });
    expect(templated).toMatchObject({ valid: true, errors: [], warnings: [] });
  });

  it.each([
    ['a name without a slash', { name: 'no-slash-in-name' }, /^name: /],
    ['a date-versioned schema URL', { $schema: 'https://static.modelcontextprotocol.io/schemas/2025-11-25/server-card.schema.json' }, /^\$schema must be/],
    ['the registry server.json schema', { $schema: 'https://static.modelcontextprotocol.io/schemas/v1/server.schema.json' }, /^\$schema must be/],
    ['a description over 100 characters', { description: 'x'.repeat(101) }, /^description: /],
    ['an unknown transport', { remotes: [{ type: 'websocket', url: 'https://example.com/mcp' }] }, /^remotes\/0\/type: /],
  ])('rejects %s', (_label, overrides, error) => {
    const result = validateServerCard({ ...minimal, ...overrides });
    expect(result.valid).toBe(false);
    expect(result.errors.some(message => error.test(message)), result.errors.join('\n')).toBe(true);
  });

  it('rejects a card without its required fields and non-objects', () => {
    const { $schema: _schema, ...withoutSchema } = minimal;
    expect(validateServerCard(withoutSchema).valid).toBe(false);
    expect(validateServerCard([]).valid).toBe(false);
    expect(validateServerCard('card').valid).toBe(false);
  });

  it('warns about cards clients cannot connect to', () => {
    expect(validateServerCard(minimal).warnings).toEqual([
      'remotes is missing or empty: the card names a server but gives clients no endpoint to connect to.',
    ]);
    expect(validateServerCard({
      ...minimal,
      remotes: [
        { type: 'sse', url: 'https://example.com/sse' },
        { type: 'streamable-http', url: 'http://example.com/mcp' },
        { type: 'streamable-http', url: 'http://127.0.0.1:4180/mcp' },
      ],
    }).warnings).toEqual([
      'remotes/0: the legacy HTTP+SSE transport is deprecated; advertise a streamable-http endpoint.',
      'remotes/1: http://example.com/mcp uses plain http; remote MCP servers must be served over HTTPS.',
    ]);
  });

  it('validates the cards in the discoverability guide', () => {
    const guide = readFileSync(resolve('src/content/articles/make-mcp-server-discoverable.md'), 'utf8');
    const cards = [...guide.matchAll(/```json\n([\s\S]*?)```/g)]
      .map(match => JSON.parse(match[1]) as Record<string, unknown>)
      .filter(document => document.$schema === SERVER_CARD_SCHEMA_URL);
    expect(cards).toHaveLength(1);
    for (const card of cards) expect(validateServerCard(card)).toMatchObject({ valid: true, warnings: [] });
  });
});

describe('resolveRemoteUrl', () => {
  it('substitutes defaults and gives up on variables without one', () => {
    expect(resolveRemoteUrl({ type: 'streamable-http', url: 'https://{tenant}.example.com/mcp', variables: { tenant: { default: 'acme' } } }))
      .toBe('https://acme.example.com/mcp');
    expect(resolveRemoteUrl({ type: 'streamable-http', url: 'https://{tenant}.example.com/mcp' })).toBeUndefined();
    expect(resolveRemoteUrl({ type: 'streamable-http', url: 'ftp://example.com/mcp' })).toBeUndefined();
  });
});

describe('buildMinimalServerCard', () => {
  it('names the card after the domain and passes the schema', () => {
    const card = buildMinimalServerCard('mcp.example.com', 'https://mcp.example.com/mcp');
    expect(card).toEqual({
      $schema: SERVER_CARD_SCHEMA_URL,
      name: 'com.example.mcp/mcp',
      version: '1.0.0',
      description: 'Remote MCP server for mcp.example.com.',
      remotes: [{ type: 'streamable-http', url: 'https://mcp.example.com/mcp' }],
    });
    expect(validateServerCard(card)).toMatchObject({ valid: true, warnings: [] });
  });
});
