import { describe, expect, it } from 'vitest';
import {
  CAPABILITY_INVENTORY_ITEM_LIMIT,
  createCapabilityInventory,
  validateCapabilityInventory,
} from './capabilityInventory';

const statuses = {
  tools: 'complete',
  resources: 'complete',
  resourceTemplates: 'complete',
  prompts: 'complete',
} as const;

describe('public-safe capability inventory', () => {
  it('retains only the closed safe projection in deterministic order', () => {
    const inventory = createCapabilityInventory({
      observedAt: '2026-08-17T22:00:00.000Z',
      testedEndpoint: 'https://example.com/mcp?access_token=do-not-store#secret',
      route: 'direct',
      authentication: 'authenticated',
      statuses,
      discovered: {
        tools: [{
          name: 'z_tool',
          description: '  Read\u0000 records  ',
          inputSchema: {
            type: 'object',
            properties: {
              query: { type: 'string', description: 'Search term', default: 'private' },
              mode: { type: 'string', enum: ['secret-mode'] },
            },
            required: ['query'],
            examples: [{ access_token: 'secret' }],
          },
          annotations: { token: 'secret' },
        }, { name: 'a_tool', inputSchema: { type: 'object' } }],
        resources: [{
          name: 'Public records',
          title: 'Records',
          description: 'Open account://tenant/private for token=secret-value',
          mimeType: 'application/json',
          uri: 'account://tenant/private',
          contents: [{ text: 'secret' }],
        }],
        resourceTemplates: [{
          name: 'Record template',
          description: 'A record template',
          mimeType: 'application/json',
          uriTemplate: 'account://tenant/{id}',
        }],
        prompts: [{
          name: 'summarize',
          description: 'Summarize records',
          arguments: [{ name: 'text', description: 'Bearer abc.def.ghi', required: true }],
          messages: [{ role: 'user', content: { text: 'secret' } }],
        }],
      },
    });

    expect(inventory.provenance.testedEndpoint).toBe('https://example.com/mcp');
    expect(inventory.tools.items.map(({ name }) => name)).toEqual(['a_tool', 'z_tool']);
    expect(inventory.tools.items[1].input).toEqual([
      { name: 'mode', type: 'string', required: false },
      { name: 'query', type: 'string', description: 'Search term', required: true },
    ]);
    expect(inventory.resources.items[0]).toEqual({
      name: 'Public records',
      title: 'Records',
      description: 'Open [REDACTED URI] for token=[REDACTED]',
      mimeType: 'application/json',
    });
    expect(JSON.stringify(inventory)).not.toMatch(/tenant\/private|uriTemplate|contents|messages|secret-mode|default|examples/);
    expect(JSON.stringify(inventory)).not.toContain('abc.def.ghi');
    expect(validateCapabilityInventory(inventory)).toEqual(inventory);
  });

  it('redacts standalone credentials, quoted assignments, and signed endpoint values at every boundary', () => {
    const githubToken = `ghp_${'a'.repeat(36)}`;
    const stripeKey = `sk_live_${'b'.repeat(24)}`;
    const quotedSecret = 'quoted value with spaces';
    const inventory = createCapabilityInventory({
      observedAt: '2026-08-17T22:00:00.000Z',
      testedEndpoint: `https://example.com/mcp?tenant=public&label=ghp%5F${'a'.repeat(36)}&sig=${stripeKey}`,
      route: 'direct',
      authentication: 'unauthenticated',
      statuses,
      discovered: {
        tools: [
          { name: githubToken },
          {
            name: 'safe_tool',
            description: `Never publish ${githubToken} or client_secret="${quotedSecret}".`,
            inputSchema: {
              properties: {
                [stripeKey]: { type: 'string' },
                safe_argument: { description: `Credential: ${stripeKey}` },
              },
            },
          },
        ],
        resources: [
          { name: stripeKey },
          {
            name: 'Safe resource',
            title: githubToken,
            description: `password='${quotedSecret}'`,
            mimeType: stripeKey,
          },
        ],
        resourceTemplates: [],
        prompts: [
          { name: stripeKey },
          { name: 'safe_prompt', arguments: [{ name: githubToken }] },
        ],
      },
    });

    const serialized = JSON.stringify(inventory);
    const endpoint = new URL(inventory.provenance.testedEndpoint);
    expect(endpoint.searchParams.get('tenant')).toBe('public');
    expect(endpoint.searchParams.get('label')).toBe('[REDACTED]');
    expect(endpoint.searchParams.has('sig')).toBe(false);
    expect(inventory.tools.items.map(({ name }) => name)).toEqual(['safe_tool']);
    expect(inventory.tools.items[0].input?.map(({ name }) => name)).toEqual(['safe_argument']);
    expect(inventory.resources.items).toEqual([
      { name: '[REDACTED]' },
      {
        name: 'Safe resource',
        title: '[REDACTED]',
        description: 'password=[REDACTED]',
      },
    ]);
    expect(inventory.prompts.items).toEqual([{ name: 'safe_prompt' }]);
    for (const secret of [githubToken, stripeKey, quotedSecret]) {
      expect(serialized).not.toContain(secret);
    }
    expect(validateCapabilityInventory(inventory)).toEqual(inventory);
  });

  it('deduplicates argument names case-insensitively for canonical consumers', () => {
    const inventory = createCapabilityInventory({
      observedAt: '2026-08-17T22:00:00.000Z',
      testedEndpoint: 'https://example.com/mcp',
      route: 'direct',
      authentication: 'unauthenticated',
      statuses,
      discovered: {
        tools: [{
          name: 'case_distinct_arguments',
          inputSchema: {
            properties: {
              Foo: { type: 'string' },
              foo: { type: 'number' },
            },
          },
        }],
        resources: [],
        resourceTemplates: [],
        prompts: [],
      },
    });

    expect(inventory.tools.items[0].input).toEqual([
      { name: 'Foo', type: 'string', required: false },
    ]);
    expect(inventory.tools.status).toBe('partial');
    expect(validateCapabilityInventory(inventory)).toEqual(inventory);
  });

  it('marks malformed, duplicate, truncated, and oversized sections partial', () => {
    const tools = Array.from({ length: CAPABILITY_INVENTORY_ITEM_LIMIT + 3 }, (_, index) => ({
      name: `tool_${String(index).padStart(3, '0')}`,
      description: 'x'.repeat(900),
    }));
    tools.push(
      { name: 'tool_000', description: 'duplicate' },
      { name: '<script>alert(1)</script>', description: 'malformed' }
    );
    const inventory = createCapabilityInventory({
      testedEndpoint: 'https://example.com/mcp',
      route: 'direct',
      authentication: 'unauthenticated',
      statuses,
      discovered: { tools, resources: [], resourceTemplates: [], prompts: [] },
    });

    expect(inventory.tools.status).toBe('partial');
    expect(inventory.tools.observedCount).toBe(CAPABILITY_INVENTORY_ITEM_LIMIT + 5);
    expect(inventory.tools.retainedCount).toBeLessThanOrEqual(CAPABILITY_INVENTORY_ITEM_LIMIT);
    expect(inventory.tools.omittedCount).toBe(inventory.tools.observedCount - inventory.tools.retainedCount);
    expect(inventory.tools.items.every(({ description }) => !description || description.length <= 600)).toBe(true);
    expect(JSON.stringify(inventory)).not.toContain('<script>');
  });

  it('keeps unsupported, unavailable, empty, and partial states distinct', () => {
    const inventory = createCapabilityInventory({
      testedEndpoint: 'https://example.com/mcp',
      route: 'authenticated-proxy',
      authentication: 'unauthenticated',
      statuses: {
        tools: 'complete',
        resources: 'unsupported',
        resourceTemplates: 'unavailable',
        prompts: 'partial',
      },
      paginationComplete: { prompts: false },
      discovered: { tools: [], prompts: [{ name: 'retained' }] },
    });

    expect(inventory.tools).toMatchObject({ status: 'complete', observedCount: 0 });
    expect(inventory.resources.status).toBe('unsupported');
    expect(inventory.resourceTemplates).toMatchObject({
      status: 'unavailable', paginationComplete: false, observedCount: 0,
    });
    expect(inventory.prompts).toMatchObject({ status: 'partial', paginationComplete: false });
  });

  it('rejects contradictory status and truncation metadata', () => {
    const inventory = createCapabilityInventory({
      observedAt: '2026-08-17T22:00:00.000Z',
      testedEndpoint: 'https://example.com/mcp',
      route: 'direct',
      authentication: 'unauthenticated',
      statuses,
      discovered: {
        tools: [{ name: 'retained_tool' }],
        resources: [],
        resourceTemplates: [],
        prompts: [],
      },
    });

    const completeWithOmission = structuredClone(inventory);
    completeWithOmission.tools.observedCount += 1;
    completeWithOmission.tools.omittedCount = 1;
    expect(() => validateCapabilityInventory(completeWithOmission)).toThrow(
      'status metadata is contradictory'
    );

    for (const status of ['unsupported', 'unavailable'] as const) {
      const terminalWithObservation = structuredClone(inventory);
      terminalWithObservation.tools.status = status;
      terminalWithObservation.tools.paginationComplete = status === 'unsupported';
      expect(() => validateCapabilityInventory(terminalWithObservation)).toThrow(
        'status metadata is contradictory'
      );
    }
  });
});
