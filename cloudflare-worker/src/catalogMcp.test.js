// @vitest-environment node
import { readFileSync } from 'node:fs';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import worker from './index.js';
import { compileSchema } from './jsonSchema.js';
import { SubmissionRateLimiter } from './submissions.js';
import { LEGACY_PROTOCOL_VERSION, MODERN_PROTOCOL_VERSION } from './fixtures.js';
import {
  CATALOG_MCP_RATE_LIMIT,
  CATALOG_MCP_SERVER,
  MAX_ID_LENGTH,
  MAX_QUERY_LENGTH,
  MAX_RESULT_BYTES,
  MAX_SEARCH_LIMIT,
} from './catalogMcp.js';
import { CATALOG_CATEGORIES, CATALOG_INDEX, CATALOG_STATUSES, MAX_SUMMARY_LENGTH, MAX_TOOL_NAMES } from './catalogIndex.js';
import serverCatalog from '../../src/data/serverCatalog.json';
import catalogCapabilities from '../../src/data/catalogCapabilities.json';

const URL_ = 'https://mcptest.io/mcp/catalog';
const envelope = {
  'io.modelcontextprotocol/protocolVersion': MODERN_PROTOCOL_VERSION,
  'io.modelcontextprotocol/clientInfo': { name: 'catalog-test', version: '1.0.0' },
  'io.modelcontextprotocol/clientCapabilities': {},
};

// In-memory stand-in for the Durable Object namespace that runs the real limiter class,
// including its alarm. `runDueAlarms()` fires every alarm whose time has come, as the runtime would.
const rateLimiterNamespace = () => {
  const instances = new Map();
  const namespace = {
    keys: [],
    writes: 0,
    idFromName: (name) => {
      namespace.keys.push(name);
      return name;
    },
    get: (id) => {
      if (!instances.has(id)) {
        const data = new Map();
        const instance = { data, alarmAt: null };
        instance.object = new SubmissionRateLimiter({
          storage: {
            get: async (key) => data.get(key),
            put: async (key, value) => { namespace.writes += 1; data.set(key, value); },
            getAlarm: async () => instance.alarmAt,
            setAlarm: async (time) => { instance.alarmAt = time; },
            deleteAll: async () => { data.clear(); instance.alarmAt = null; },
          },
        });
        instances.set(id, instance);
      }
      return { fetch: (url, init) => instances.get(id).object.fetch(new Request(url, init)) };
    },
    stored: (id) => instances.get(id),
    runDueAlarms: async () => {
      for (const instance of instances.values()) {
        if (instance.alarmAt !== null && instance.alarmAt <= Date.now()) {
          instance.alarmAt = null;
          await instance.object.alarm();
        }
      }
    },
  };
  return namespace;
};

let env;
let nextId = 1;
const send = (init = {}, { ip = '203.0.113.9', path = '/mcp/catalog' } = {}) => worker.fetch(new Request(`https://mcptest.io${path}`, {
  ...init,
  headers: { 'CF-Connecting-IP': ip, ...(init.headers ?? {}) },
}), env, {});

const rpc = (method, params = {}, options) => send({
  method: 'POST',
  headers: {
    'Content-Type': 'application/json',
    Accept: 'application/json, text/event-stream',
    'MCP-Protocol-Version': MODERN_PROTOCOL_VERSION,
    'Mcp-Method': method,
  },
  body: JSON.stringify({ jsonrpc: '2.0', id: nextId++, method, params: { ...params, _meta: envelope } }),
}, options);

const call = async (name, args = {}, options) => {
  const response = await rpc('tools/call', { name, arguments: args }, options);
  expect(response.status).toBe(200);
  return (await response.json());
};
const result = async (name, args) => {
  const body = await call(name, args);
  expect(body.error).toBeUndefined();
  return body.result;
};

const toolDefinition = (name) => CATALOG_MCP_SERVER.tools.find((tool) => tool.definition.name === name).definition;
const expectMatchesOutputSchema = (name, value) => {
  const { valid, errors } = compileSchema(toolDefinition(name).outputSchema)(value);
  expect(errors).toEqual([]);
  expect(valid).toBe(true);
};

let originalFetch;
beforeEach(() => {
  env = { FIREBASE_PROJECT_ID: 'test-project', SUBMISSION_RATE_LIMITER: rateLimiterNamespace() };
  originalFetch = globalThis.fetch;
  globalThis.fetch = () => { throw new Error('the catalog endpoint must not make outbound fetches'); };
});
afterEach(() => {
  globalThis.fetch = originalFetch;
  vi.restoreAllMocks();
});

describe('catalog MCP endpoint', () => {
  it('answers server/discover without authentication or cookies', async () => {
    const response = await rpc('server/discover');
    expect(response.status).toBe(200);
    expect(response.headers.get('Access-Control-Allow-Origin')).toBe('*');
    expect(response.headers.get('Access-Control-Allow-Credentials')).toBeNull();
    expect(response.headers.get('Set-Cookie')).toBeNull();
    const body = await response.json();
    expect(body.result.capabilities).toEqual({ tools: { listChanged: false } });
    expect(body.result._meta['io.modelcontextprotocol/serverInfo']).toMatchObject({ name: 'mcptest-catalog' });
  });

  it('accepts the stateful handshake and a trailing slash', async () => {
    const init = await send({
      method: 'POST',
      headers: { 'Content-Type': 'application/json', Accept: 'application/json, text/event-stream' },
      body: JSON.stringify({
        jsonrpc: '2.0', id: 1, method: 'initialize',
        params: { protocolVersion: LEGACY_PROTOCOL_VERSION, capabilities: {}, clientInfo: { name: 'catalog-test', version: '1.0.0' } },
      }),
    }, { path: '/mcp/catalog/' });
    expect(init.status).toBe(200);
    const session = init.headers.get('Mcp-Session-Id');
    expect(session).toBeTruthy();
    const list = await send({
      method: 'POST',
      headers: { 'Content-Type': 'application/json', 'Mcp-Session-Id': session, 'MCP-Protocol-Version': LEGACY_PROTOCOL_VERSION },
      body: JSON.stringify({ jsonrpc: '2.0', id: 2, method: 'tools/list' }),
    });
    expect((await list.json()).result.tools.map((tool) => tool.name)).toEqual(['search_catalog', 'get_catalog_server', 'list_catalog_categories']);
  });

  it('answers CORS preflights for browser clients without a credentials grant', async () => {
    const response = await send({
      method: 'OPTIONS',
      headers: { Origin: 'https://inspector.example', 'Access-Control-Request-Method': 'POST', 'Access-Control-Request-Headers': 'content-type,mcp-protocol-version,mcp-method' },
    });
    expect(response.status).toBe(204);
    expect(response.headers.get('Access-Control-Allow-Origin')).toBe('*');
    expect(response.headers.get('Access-Control-Allow-Credentials')).toBeNull();
    expect(response.headers.get('Access-Control-Expose-Headers')).toContain('Retry-After');
    expect(env.SUBMISSION_RATE_LIMITER.keys).toEqual([]);
  });

  it('marks every tool read-only and bounds its input', async () => {
    const body = await (await rpc('tools/list')).json();
    expect(body.result.tools).toHaveLength(3);
    for (const tool of body.result.tools) {
      expect(tool.annotations).toEqual({ readOnlyHint: true, destructiveHint: false, idempotentHint: true, openWorldHint: false });
      expect(tool.inputSchema.additionalProperties).toBe(false);
      expect(tool.outputSchema).toBeDefined();
    }
  });

  it('leaves neighbouring paths to the other routes', async () => {
    for (const path of ['/mcp', '/mcp/catalogx', '/mcp/catalog/extra']) {
      const response = await send({ method: 'POST', headers: { 'Content-Type': 'application/json' }, body: '{}' }, { path });
      expect(response.status).toBe(401);
    }
  });

  it('returns 405 for GET so clients fall back to POST', async () => {
    const response = await send({ method: 'GET', headers: { Accept: 'text/event-stream' } });
    expect(response.status).toBe(405);
  });
});

describe('search_catalog', () => {
  it('ranks a name match first', async () => {
    const { structuredContent } = await result('search_catalog', { query: 'github' });
    expect(structuredContent.results[0].id).toBe('github');
    expectMatchesOutputSchema('search_catalog', structuredContent);
    const [github] = structuredContent.results;
    expect(github).toEqual({
      id: 'github',
      name: 'GitHub',
      description: expect.any(String),
      category: 'Developer Tools',
      endpoint: 'https://api.githubcopilot.com/mcp/',
      validation: { status: 'authorization-required', checkedAt: expect.stringMatching(/^\d{4}-\d{2}-\d{2}T/) },
      pageUrl: 'https://mcptest.io/servers/github/',
    });
    expect(github.description.length).toBeLessThanOrEqual(MAX_SUMMARY_LENGTH);
  });

  it('matches observed tool names', async () => {
    const [serverId, inventory] = Object.entries(catalogCapabilities).find(([, value]) => value.tools?.items?.length);
    const toolName = inventory.tools.items[0].name;
    const { structuredContent } = await result('search_catalog', { query: toolName, limit: MAX_SEARCH_LIMIT });
    expect(structuredContent.results.map((entry) => entry.id)).toContain(serverId);
  });

  it('requires every query word to match', async () => {
    const { structuredContent } = await result('search_catalog', { query: 'github zzqqxxnotaword' });
    expect(structuredContent).toEqual({ total: 0, returned: 0, results: [] });
  });

  it('requires every word of a long query to match, not only the first few', async () => {
    const matching = 'g gi git gith githu github developer tools';
    const found = await result('search_catalog', { query: matching });
    expect(found.structuredContent.results.map((entry) => entry.id)).toContain('github');

    const { structuredContent } = await result('search_catalog', { query: `${matching} zzqqxxnotaword` });
    expect(structuredContent).toEqual({ total: 0, returned: 0, results: [] });
  });

  it('filters by category case-insensitively and by status', async () => {
    const { structuredContent } = await result('search_catalog', { category: 'developer tools', limit: MAX_SEARCH_LIMIT });
    expect(structuredContent.total).toBe(serverCatalog.filter((seed) => seed.category === 'Developer Tools').length);
    expect(structuredContent.results.every((entry) => entry.category === 'Developer Tools')).toBe(true);

    for (const status of CATALOG_STATUSES) {
      const filtered = (await result('search_catalog', { status, limit: MAX_SEARCH_LIMIT })).structuredContent;
      expect(filtered.total).toBe(CATALOG_INDEX.filter((entry) => entry.validation.status === status).length);
      expect(filtered.results.every((entry) => entry.validation.status === status)).toBe(true);
    }
  });

  it('lists in catalog order without a query and applies the default limit', async () => {
    const { structuredContent } = await result('search_catalog', {});
    expect(structuredContent.total).toBe(serverCatalog.length);
    expect(structuredContent.results.map((entry) => entry.id)).toEqual(serverCatalog.slice(0, 10).map((seed) => seed.id));
  });

  it('returns a structured isError for an unknown category', async () => {
    const value = await result('search_catalog', { category: 'Not a category' });
    expect(value.isError).toBe(true);
    expect(value.structuredContent).toBeUndefined();
    const error = JSON.parse(value.content[0].text).error;
    expect(error.code).toBe('unknown_category');
    expect(error.categories).toEqual(CATALOG_CATEGORIES.map((category) => category.name));
  });

  it.each([
    [{ limit: MAX_SEARCH_LIMIT + 1 }],
    [{ limit: 0 }],
    [{ limit: 2.5 }],
    [{ query: 'x'.repeat(MAX_QUERY_LENGTH + 1) }],
    [{ status: 'online' }],
    [{ category: '' }],
    [{ unexpected: true }],
  ])('rejects out-of-bounds arguments %j with invalid params', async (args) => {
    const body = await call('search_catalog', args);
    expect(body.error.code).toBe(-32602);
  });

  it('keeps the largest possible result within the output cap', async () => {
    const { structuredContent } = await result('search_catalog', { limit: MAX_SEARCH_LIMIT, query: 'a' });
    expect(structuredContent.returned).toBeLessThanOrEqual(MAX_SEARCH_LIMIT);
    expect(new TextEncoder().encode(JSON.stringify(structuredContent)).byteLength).toBeLessThanOrEqual(MAX_RESULT_BYTES);
  });
});

describe('get_catalog_server', () => {
  it('returns the full public entry with page and badge URLs', async () => {
    const { structuredContent } = await result('get_catalog_server', { id: 'github' });
    expectMatchesOutputSchema('get_catalog_server', structuredContent);
    expect(structuredContent).toMatchObject({
      id: 'github',
      endpoint: 'https://api.githubcopilot.com/mcp/',
      auth: { type: 'oauth', requiresOAuth: true, alternatives: ['bearer-token'], headers: [{ name: 'Authorization', required: false }] },
      validation: { status: 'authorization-required' },
      pageUrl: 'https://mcptest.io/servers/github/',
      badgeUrl: 'https://mcptest.io/badge/server/github.svg',
    });
    // Header templates and OAuth registration details are not part of the public entry.
    expect(JSON.stringify(structuredContent)).not.toContain('valueTemplate');
    expect(JSON.stringify(structuredContent)).not.toContain('oauthRegistration');
  });

  it('summarizes observed capabilities with a capped tool list', async () => {
    const [serverId, inventory] = Object.entries(catalogCapabilities)
      .sort(([, a], [, b]) => (b.tools?.items?.length ?? 0) - (a.tools?.items?.length ?? 0))[0];
    const { structuredContent } = await result('get_catalog_server', { id: serverId });
    expectMatchesOutputSchema('get_catalog_server', structuredContent);
    const { capabilities } = structuredContent;
    expect(capabilities.toolCount).toBe(inventory.tools.observedCount ?? inventory.tools.items.length);
    expect(capabilities.toolNames.length).toBe(Math.min(MAX_TOOL_NAMES, inventory.tools.items.length));
    expect(capabilities.toolNamesTruncated).toBe(inventory.tools.items.length > MAX_TOOL_NAMES);
  });

  it('reports null capabilities for a server without an inventory', async () => {
    const seed = serverCatalog.find((candidate) => !Object.hasOwn(catalogCapabilities, candidate.id));
    const { structuredContent } = await result('get_catalog_server', { id: seed.id });
    expect(structuredContent.capabilities).toBeNull();
    expectMatchesOutputSchema('get_catalog_server', structuredContent);
  });

  it.each(['not-a-catalog-server', '__proto__', 'constructor', 'GitHub'])('returns a structured isError for the unknown id %s', async (id) => {
    const value = await result('get_catalog_server', { id });
    expect(value.isError).toBe(true);
    expect(JSON.parse(value.content[0].text).error).toMatchObject({ code: 'unknown_server', id });
  });

  it.each([[{}], [{ id: '' }], [{ id: 'x'.repeat(MAX_ID_LENGTH + 1) }], [{ id: 7 }]])('rejects %j with invalid params', async (args) => {
    expect((await call('get_catalog_server', args)).error.code).toBe(-32602);
  });

  it('keeps every catalog entry within the output cap and schema', async () => {
    const tool = CATALOG_MCP_SERVER.tools.find((candidate) => candidate.definition.name === 'get_catalog_server');
    for (const entry of CATALOG_INDEX) {
      const { structuredContent } = tool.run({ id: entry.id });
      expect(new TextEncoder().encode(JSON.stringify(structuredContent)).byteLength).toBeLessThanOrEqual(MAX_RESULT_BYTES);
      expectMatchesOutputSchema('get_catalog_server', structuredContent);
    }
  });
});

describe('list_catalog_categories', () => {
  it('lists every category with its server count', async () => {
    const { structuredContent } = await result('list_catalog_categories');
    expectMatchesOutputSchema('list_catalog_categories', structuredContent);
    expect(structuredContent.totalServers).toBe(serverCatalog.length);
    const expected = {};
    for (const seed of serverCatalog) expected[seed.category] = (expected[seed.category] ?? 0) + 1;
    expect(Object.fromEntries(structuredContent.categories.map((category) => [category.name, category.count]))).toEqual(expected);
    expect(structuredContent.categories.find((category) => category.name === 'Developer Tools').url).toBe('https://mcptest.io/catalog/developer-tools');
  });
});

describe('catalog MCP rate limit', () => {
  it('limits each client address and answers 429 with Retry-After', async () => {
    const now = Date.now();
    vi.spyOn(Date, 'now').mockReturnValue(now);
    for (let index = 0; index < CATALOG_MCP_RATE_LIMIT.limit; index += 1) {
      expect((await rpc('ping', {}, { ip: '198.51.100.1' })).status).toBe(200);
    }
    const limited = await rpc('ping', {}, { ip: '198.51.100.1' });
    expect(limited.status).toBe(429);
    expect(Number(limited.headers.get('Retry-After'))).toBeGreaterThan(0);
    expect(limited.headers.get('Access-Control-Allow-Origin')).toBe('*');
    expect((await limited.json()).error.code).toBe(-32000);

    // Another address has its own window, and the window slides.
    expect((await rpc('ping', {}, { ip: '198.51.100.2' })).status).toBe(200);
    Date.now.mockReturnValue(now + CATALOG_MCP_RATE_LIMIT.windowMs + 1);
    expect((await rpc('ping', {}, { ip: '198.51.100.1' })).status).toBe(200);
  });

  it('writes nothing for a refused request and deletes its state once the window has passed', async () => {
    const now = Date.now();
    vi.spyOn(Date, 'now').mockReturnValue(now);
    const limiter = env.SUBMISSION_RATE_LIMITER;
    for (let index = 0; index < CATALOG_MCP_RATE_LIMIT.limit; index += 1) {
      expect((await rpc('ping', {}, { ip: '198.51.100.4' })).status).toBe(200);
    }
    const key = limiter.keys.at(-1);
    const writesBefore = limiter.writes;
    expect((await rpc('ping', {}, { ip: '198.51.100.4' })).status).toBe(429);
    expect((await rpc('ping', {}, { ip: '198.51.100.4' })).status).toBe(429);
    expect(limiter.writes).toBe(writesBefore);

    // A hit late in the window keeps the state alive past the first alarm.
    Date.now.mockReturnValue(now + 30_000);
    expect((await rpc('ping', {}, { ip: '198.51.100.5' })).status).toBe(200);
    Date.now.mockReturnValue(now + CATALOG_MCP_RATE_LIMIT.windowMs - 1);
    await limiter.runDueAlarms();
    expect(limiter.stored(key).data.size).toBe(1);
    expect(limiter.stored(key).alarmAt).toBe(now + CATALOG_MCP_RATE_LIMIT.windowMs);

    Date.now.mockReturnValue(now + CATALOG_MCP_RATE_LIMIT.windowMs);
    await limiter.runDueAlarms();
    expect(limiter.stored(key).data.size).toBe(0);
    expect(limiter.stored(key).alarmAt).toBeNull();
    const lateKey = limiter.keys.at(-1);
    expect(lateKey).not.toBe(key);
    expect(limiter.stored(lateKey).data.size).toBe(1);

    Date.now.mockReturnValue(now + 30_000 + CATALOG_MCP_RATE_LIMIT.windowMs);
    await limiter.runDueAlarms();
    expect(limiter.stored(lateKey).data.size).toBe(0);
    expect(limiter.stored(lateKey).alarmAt).toBeNull();

    // After cleanup the address starts a fresh window and the limit still triggers.
    for (let index = 0; index < CATALOG_MCP_RATE_LIMIT.limit; index += 1) {
      expect((await rpc('ping', {}, { ip: '198.51.100.4' })).status).toBe(200);
    }
    const limited = await rpc('ping', {}, { ip: '198.51.100.4' });
    expect(limited.status).toBe(429);
    expect(limited.headers.get('Retry-After')).toBe('60');
    expect(limited.headers.get('Access-Control-Allow-Origin')).toBe('*');
  });

  it('reschedules the alarm while an address keeps calling', async () => {
    const now = Date.now();
    vi.spyOn(Date, 'now').mockReturnValue(now);
    const limiter = env.SUBMISSION_RATE_LIMITER;
    await rpc('ping', {}, { ip: '198.51.100.6' });
    const key = limiter.keys.at(-1);
    Date.now.mockReturnValue(now + 45_000);
    await rpc('ping', {}, { ip: '198.51.100.6' });
    Date.now.mockReturnValue(now + CATALOG_MCP_RATE_LIMIT.windowMs);
    await limiter.runDueAlarms();
    expect(limiter.stored(key).alarmAt).toBe(now + 45_000 + CATALOG_MCP_RATE_LIMIT.windowMs);
    expect(limiter.stored(key).data.get('window').hits).toHaveLength(2);
    Date.now.mockReturnValue(now + 45_000 + CATALOG_MCP_RATE_LIMIT.windowMs);
    await limiter.runDueAlarms();
    expect(limiter.stored(key).data.size).toBe(0);
  });

  it('keys the limiter by a hash of the address under its own prefix', async () => {
    await rpc('ping', {}, { ip: '198.51.100.3' });
    const [key] = env.SUBMISSION_RATE_LIMITER.keys;
    expect(key).toMatch(/^catalog-mcp:ip:[0-9a-f]{64}$/);
    expect(key).not.toContain('198.51.100.3');
  });

  it('serves requests when the limiter is unavailable', async () => {
    vi.spyOn(console, 'error').mockImplementation(() => {});
    env.SUBMISSION_RATE_LIMITER = { idFromName: () => 'x', get: () => ({ fetch: () => Promise.reject(new Error('down')) }) };
    expect((await rpc('ping')).status).toBe(200);
    delete env.SUBMISSION_RATE_LIMITER;
    expect((await rpc('ping')).status).toBe(200);
  });
});

describe('catalog MCP route', () => {
  const routePatterns = (file) => {
    const toml = readFileSync(new URL(file, import.meta.url), 'utf8');
    const block = /^routes = \[([\s\S]*?)^\]/m.exec(toml)[1];
    return [...block.matchAll(/pattern = "([^"]+)"/g)].map((match) => match[1]);
  };

  it('is mounted on the site in both wrangler.toml files, which list the same routes', () => {
    const root = routePatterns('../../wrangler.toml');
    expect(root).toContain('mcptest.io/mcp/catalog');
    expect(routePatterns('../wrangler.toml')).toEqual(root);
  });
});
