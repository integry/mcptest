// @vitest-environment node
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import worker from './index.js';
import { compileSchema } from './jsonSchema.js';
import {
  FIXTURE_CORS_HEADERS,
  LEGACY_PROTOCOL_VERSION,
  MAX_FIXTURE_BODY_BYTES,
  MODERN_PROTOCOL_VERSION,
  createFixtureSessionId,
  handleFixtureRequest,
} from './fixtures.js';
import { FIXTURE_NAMES, FIXTURE_SERVERS, MAX_DELAY_MS, PUBLIC_BEARER_TOKEN } from './fixtureServers.js';

const ORIGIN = 'https://mcptest.io';
const BEARER = { Authorization: `Bearer ${PUBLIC_BEARER_TOKEN}` };
const envelope = {
  'io.modelcontextprotocol/protocolVersion': MODERN_PROTOCOL_VERSION,
  'io.modelcontextprotocol/clientInfo': { name: 'fixture-test', version: '1.0.0' },
  'io.modelcontextprotocol/clientCapabilities': {},
};

// Requests reach the fixtures through the worker entry point unless a test needs
// to inject the delay function.
const env = new Proxy({}, { get: (_target, key) => { throw new Error(`fixtures must not read env.${String(key)}`); } });
const send = (path, init = {}, options) => {
  const request = new Request(`${ORIGIN}${path}`, init);
  return options ? handleFixtureRequest(request, options) : worker.fetch(request, env, {});
};

let nextId = 1;
const post = (name, message, headers = {}, options) => send(`/fixtures/${name}/mcp`, {
  method: 'POST',
  headers: { 'Content-Type': 'application/json', Accept: 'application/json, text/event-stream', ...headers },
  body: typeof message === 'string' ? message : JSON.stringify(message),
}, options);

const modern = (name, method, params = {}, headers = {}, options) => post(name, {
  jsonrpc: '2.0', id: nextId++, method, params: { ...params, _meta: { ...envelope, ...(params._meta ?? {}) } },
}, {
  'MCP-Protocol-Version': MODERN_PROTOCOL_VERSION,
  'Mcp-Method': method,
  ...(name === 'auth-bearer' ? BEARER : {}),
  ...headers,
}, options);

const initialize = async (name, protocolVersion = LEGACY_PROTOCOL_VERSION) => {
  const response = await post(name, {
    jsonrpc: '2.0', id: nextId++, method: 'initialize',
    params: { protocolVersion, capabilities: {}, clientInfo: { name: 'fixture-test', version: '1.0.0' } },
  }, name === 'auth-bearer' ? BEARER : {});
  return { response, body: await response.json(), session: response.headers.get('Mcp-Session-Id') };
};

const legacySession = async (name) => (await initialize(name)).session;
const legacy = async (name, method, params, { session, headers = {}, options } = {}) => post(name, {
  jsonrpc: '2.0', id: nextId++, method, ...(params ? { params } : {}),
}, {
  'MCP-Protocol-Version': LEGACY_PROTOCOL_VERSION,
  'Mcp-Session-Id': session ?? await legacySession(name),
  ...(name === 'auth-bearer' ? BEARER : {}),
  ...headers,
}, options);

/** Calls a method in both eras and returns both JSON-RPC bodies. */
const bothEras = async (name, method, params) => {
  const responses = await Promise.all([modern(name, method, params), legacy(name, method, params)]);
  for (const response of responses) expect(response.status).toBe(200);
  return Promise.all(responses.map((response) => response.json()));
};

const instantWait = () => Promise.resolve();

let originalFetch;
beforeEach(() => {
  originalFetch = globalThis.fetch;
  globalThis.fetch = () => { throw new Error('fixtures must not make outbound fetches'); };
});
afterEach(() => { globalThis.fetch = originalFetch; });

describe('fixture routing', () => {
  it.each([
    '/fixtures/unknown/mcp',
    '/fixtures/echo',
    '/fixtures/echo/sse',
    '/fixtures/__proto__/mcp',
    '/fixtures/constructor/mcp',
    '/fixtures',
  ])('answers %s with a 404 listing the fixtures', async (path) => {
    const response = await send(path, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: '{}' });
    expect(response.status).toBe(404);
    expect(response.headers.get('Access-Control-Allow-Origin')).toBe('*');
    const body = await response.json();
    expect(body.error).toBe('Unknown fixture');
    expect(body.fixtures).toEqual(FIXTURE_NAMES.map((name) => `/fixtures/${name}/mcp`));
  });

  it('leaves the other worker routes alone', async () => {
    for (const path of ['/badge/server/context7.svg', '/r/abc', '/api/catalog/submissions', '/api/state', '/fixturesx/echo/mcp']) {
      expect(await handleFixtureRequest(new Request(`${ORIGIN}${path}`))).toBeUndefined();
    }
    const badge = await worker.fetch(new Request(`${ORIGIN}/badge/server/context7.svg`), env, {});
    expect(badge.headers.get('Content-Type')).toBe('image/svg+xml; charset=utf-8');
    const state = await worker.fetch(new Request(`${ORIGIN}/api/state`), { FIREBASE_PROJECT_ID: 'test' }, {});
    expect(state.status).toBe(401);
    expect(state.headers.get('Access-Control-Allow-Origin')).toBe('https://mcptest.io');
  });

  it('accepts a trailing slash on the endpoint', async () => {
    const response = await send('/fixtures/echo/mcp/', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', 'MCP-Protocol-Version': MODERN_PROTOCOL_VERSION },
      body: JSON.stringify({ jsonrpc: '2.0', id: 1, method: 'ping', params: { _meta: envelope } }),
    });
    expect(response.status).toBe(200);
  });
});

describe('fixture CORS', () => {
  it.each(FIXTURE_NAMES)('answers the %s preflight without authentication', async (name) => {
    const response = await send(`/fixtures/${name}/mcp`, {
      method: 'OPTIONS',
      headers: {
        Origin: 'https://other-tester.example',
        'Access-Control-Request-Method': 'POST',
        'Access-Control-Request-Headers': 'authorization,content-type,mcp-method,mcp-name,mcp-protocol-version,mcp-session-id',
      },
    });
    expect(response.status).toBe(204);
    expect(response.headers.get('Access-Control-Allow-Origin')).toBe('*');
    expect(response.headers.get('Access-Control-Allow-Methods')).toBe('GET, POST, DELETE, OPTIONS');
    const allowed = response.headers.get('Access-Control-Allow-Headers').toLowerCase().split(/,\s*/);
    for (const header of ['content-type', 'accept', 'authorization', 'mcp-protocol-version', 'mcp-method', 'mcp-name', 'mcp-session-id', 'last-event-id']) {
      expect(allowed).toContain(header);
    }
    expect(response.headers.get('Access-Control-Max-Age')).toBe('7200');
    expect(response.headers.get('Access-Control-Allow-Credentials')).toBeNull();
  });

  it('exposes the session, protocol and challenge headers on every response, including errors', async () => {
    const responses = [
      (await initialize('echo')).response,
      await modern('echo', 'tools/list'),
      await post('auth-bearer', { jsonrpc: '2.0', id: 1, method: 'initialize', params: {} }),
      await modern('errors', 'tools/call', { name: 'http_500', arguments: {} }),
      await send('/fixtures/nope/mcp'),
    ];
    for (const response of responses) {
      expect(response.headers.get('Access-Control-Allow-Origin')).toBe('*');
      expect(response.headers.get('Access-Control-Expose-Headers')).toBe(FIXTURE_CORS_HEADERS['Access-Control-Expose-Headers']);
    }
    expect(FIXTURE_CORS_HEADERS['Access-Control-Expose-Headers']).toBe('Mcp-Session-Id, MCP-Protocol-Version, WWW-Authenticate, Retry-After');
  });
});

describe('fixture lifecycle', () => {
  it.each(FIXTURE_NAMES)('%s: initialize negotiates the stateful 2025-11-25 revision and issues a session', async (name) => {
    const { response, body, session } = await initialize(name);
    expect(response.status).toBe(200);
    expect(response.headers.get('Content-Type')).toBe('application/json');
    expect(session).toMatch(/^mcptest-fx-[0-9a-f]{32}\.[0-9a-f]{16}$/);
    expect(body.result).toMatchObject({
      protocolVersion: LEGACY_PROTOCOL_VERSION,
      serverInfo: { name: `mcptest-fixture-${name}`, version: '1.0.0' },
      capabilities: { tools: { listChanged: false } },
    });
    expect(body.result.instructions).toEqual(expect.any(String));
    const initialized = await post(name, { jsonrpc: '2.0', method: 'notifications/initialized' }, {
      'Mcp-Session-Id': session, ...(name === 'auth-bearer' ? BEARER : {}),
    });
    expect(initialized.status).toBe(202);
    expect(await initialized.text()).toBe('');
  });

  it.each(FIXTURE_NAMES)('%s: server/discover negotiates the stateless 2026-07-28 revision', async (name) => {
    const response = await modern(name, 'server/discover');
    expect(response.status).toBe(200);
    expect(response.headers.get('Mcp-Session-Id')).toBeNull();
    const { result } = await response.json();
    expect(result).toMatchObject({
      resultType: 'complete',
      supportedVersions: expect.arrayContaining([MODERN_PROTOCOL_VERSION, LEGACY_PROTOCOL_VERSION]),
      capabilities: { tools: { listChanged: false } },
      ttlMs: 0,
      cacheScope: 'public',
      _meta: { 'io.modelcontextprotocol/serverInfo': { name: `mcptest-fixture-${name}` } },
    });
  });

  it('echoes an older supported 2025 revision and falls back to 2025-11-25 otherwise', async () => {
    expect((await initialize('echo', '2025-06-18')).body.result.protocolVersion).toBe('2025-06-18');
    expect((await initialize('echo', '1999-01-01')).body.result.protocolVersion).toBe(LEGACY_PROTOCOL_VERSION);
  });

  const VALID_INIT_PARAMS = {
    protocolVersion: LEGACY_PROTOCOL_VERSION, capabilities: {}, clientInfo: { name: 'fixture-test', version: '1.0.0' },
  };
  it.each([
    ['omitted params', undefined],
    ['array params', []],
    ['empty params', {}],
    ['a missing protocolVersion', { ...VALID_INIT_PARAMS, protocolVersion: undefined }],
    ['a numeric protocolVersion', { ...VALID_INIT_PARAMS, protocolVersion: 20251125 }],
    ['missing capabilities', { ...VALID_INIT_PARAMS, capabilities: undefined }],
    ['array capabilities', { ...VALID_INIT_PARAMS, capabilities: [] }],
    ['missing clientInfo', { ...VALID_INIT_PARAMS, clientInfo: undefined }],
    ['string clientInfo', { ...VALID_INIT_PARAMS, clientInfo: 'fixture-test' }],
    ['a clientInfo without a name', { ...VALID_INIT_PARAMS, clientInfo: { version: '1.0.0' } }],
    ['a numeric clientInfo.version', { ...VALID_INIT_PARAMS, clientInfo: { name: 'fixture-test', version: 1 } }],
  ])('rejects initialize with %s as invalid params and issues no session', async (_label, params) => {
    const response = await post('echo', { jsonrpc: '2.0', id: 7, method: 'initialize', ...(params === undefined ? {} : { params }) });
    expect(response.status).toBe(400);
    expect(response.headers.get('Mcp-Session-Id')).toBeNull();
    const body = await response.json();
    expect(body).toMatchObject({ jsonrpc: '2.0', id: 7, error: { code: -32602 } });
    expect(body.error.message).toMatch(/^Invalid params for initialize: params/);
    expect(body.result).toBeUndefined();
  });

  it('still negotiates an unsupported but well-typed protocolVersion on initialize', async () => {
    const response = await post('echo', { jsonrpc: '2.0', id: 8, method: 'initialize', params: { ...VALID_INIT_PARAMS, protocolVersion: 'not-a-date' } });
    expect(response.status).toBe(200);
    expect((await response.json()).result.protocolVersion).toBe(LEGACY_PROTOCOL_VERSION);
    expect(response.headers.get('Mcp-Session-Id')).toMatch(/^mcptest-fx-/);
  });

  it('answers ping in both eras', async () => {
    const [stateless, stateful] = await bothEras('echo', 'ping');
    expect(stateless.result).toMatchObject({ resultType: 'complete' });
    expect(stateful.result).toEqual({});
  });

  it.each([
    ['echo', ['echo', 'add', 'whoami', 'headers']],
    ['auth-bearer', ['echo', 'add', 'whoami', 'headers']],
    ['errors', ['protocol_error', 'tool_error', 'invalid_params', 'http_500']],
    ['slow', ['sleep', 'progress']],
    ['schemas', ['create_order', 'classify']],
  ])('%s: tools/list returns the fixed tool set in both eras', async (name, tools) => {
    const [stateless, stateful] = await bothEras(name, 'tools/list');
    expect(stateless.result.tools.map((tool) => tool.name)).toEqual(tools);
    expect(stateful.result.tools).toEqual(stateless.result.tools);
    expect(stateless.result).toMatchObject({ resultType: 'complete', ttlMs: 0, cacheScope: 'public' });
    expect(stateful.result).not.toHaveProperty('resultType');
    for (const tool of stateless.result.tools) {
      expect(tool.inputSchema.type).toBe('object');
      expect(tool.description).toEqual(expect.any(String));
    }
  });

  it('serves one static resource and one prompt on echo, in both eras', async () => {
    const [resources] = await bothEras('echo', 'resources/list');
    expect(resources.result.resources).toEqual([expect.objectContaining({ uri: 'mcptest://fixtures/readme', mimeType: 'text/plain' })]);
    const [templates] = await bothEras('echo', 'resources/templates/list');
    expect(templates.result.resourceTemplates).toEqual([]);
    const [read, readLegacy] = await bothEras('echo', 'resources/read', { uri: 'mcptest://fixtures/readme' });
    expect(read.result.contents[0].text).toContain('https://mcptest.io/fixtures/echo/mcp');
    expect(readLegacy.result.contents).toEqual(read.result.contents);
    const missing = await (await modern('echo', 'resources/read', { uri: 'mcptest://fixtures/nope' })).json();
    expect(missing.error.code).toBe(-32002);

    const [prompts] = await bothEras('echo', 'prompts/list');
    expect(prompts.result.prompts.map((prompt) => prompt.name)).toEqual(['greeting']);
    const [prompt] = await bothEras('echo', 'prompts/get', { name: 'greeting', arguments: { name: 'Ada' } });
    expect(prompt.result.messages[0].content.text).toBe('Say hello to Ada from the mcptest.io echo fixture.');
  });

  it('reports method not found for capabilities a fixture does not declare', async () => {
    for (const method of ['resources/list', 'prompts/list', 'completion/complete']) {
      const body = await (await modern('errors', method)).json();
      expect(body.error.code).toBe(-32601);
    }
  });
});

describe('stateful session handling without storage', () => {
  it('requires the issued session id on later requests', async () => {
    const missing = await post('echo', { jsonrpc: '2.0', id: 1, method: 'tools/list' }, { 'MCP-Protocol-Version': LEGACY_PROTOCOL_VERSION });
    expect(missing.status).toBe(400);
    expect((await missing.json()).error.message).toContain('Mcp-Session-Id');
  });

  it('answers 404 for session ids this worker did not issue or issued for another fixture', async () => {
    const otherFixture = await createFixtureSessionId('slow');
    for (const session of [crypto.randomUUID(), 'mcptest-fx-00000000000000000000000000000000.0000000000000000', otherFixture]) {
      const response = await legacy('echo', 'ping', undefined, { session });
      expect(response.status).toBe(404);
      expect((await response.json()).error.code).toBe(-32001);
    }
  });

  it('issues a fresh id on every initialize and keeps each one valid', async () => {
    const first = await legacySession('echo');
    const second = await legacySession('echo');
    expect(first).not.toBe(second);
    for (const session of [first, second, first]) {
      expect((await legacy('echo', 'ping', undefined, { session })).status).toBe(200);
    }
  });

  it('declines GET streams and DELETE with 405', async () => {
    const session = await legacySession('echo');
    for (const method of ['GET', 'DELETE']) {
      const response = await send('/fixtures/echo/mcp', { method, headers: { 'Mcp-Session-Id': session } });
      expect(response.status).toBe(405);
      expect(response.headers.get('Allow')).toBe('POST, OPTIONS');
    }
    expect((await send('/fixtures/echo/mcp', { method: 'PUT', body: '{}' })).status).toBe(405);
  });

  it('rejects an unsupported legacy MCP-Protocol-Version header', async () => {
    const response = await legacy('echo', 'ping', undefined, { headers: { 'MCP-Protocol-Version': '2020-01-01' } });
    expect(response.status).toBe(400);
  });
});

describe('stateless 2026 request validation', () => {
  it('rejects a modern request without the _meta envelope', async () => {
    const response = await post('echo', { jsonrpc: '2.0', id: 1, method: 'tools/list' }, { 'MCP-Protocol-Version': MODERN_PROTOCOL_VERSION });
    expect(response.status).toBe(400);
    expect((await response.json()).error.message).toContain('_meta envelope');
  });

  it.each([
    ['MCP-Protocol-Version', { 'MCP-Protocol-Version': '2025-11-25' }],
    ['Mcp-Method', { 'Mcp-Method': 'tools/list' }],
    ['Mcp-Name', { 'Mcp-Name': 'add' }],
  ])('rejects a mismatched %s header with -32020', async (_header, headers) => {
    const response = await modern('echo', 'tools/call', { name: 'echo', arguments: { message: 'x' } }, headers);
    expect(response.status).toBe(400);
    expect((await response.json()).error.code).toBe(-32020);
  });

  it('answers an unsupported modern revision with -32022 and the supported list', async () => {
    const response = await modern('echo', 'server/discover', { _meta: { 'io.modelcontextprotocol/protocolVersion': '2099-01-01' } }, { 'MCP-Protocol-Version': '2099-01-01' });
    expect(response.status).toBe(400);
    const { error } = await response.json();
    expect(error.code).toBe(-32022);
    expect(error.data).toEqual({ supported: expect.arrayContaining([MODERN_PROTOCOL_VERSION]), requested: '2099-01-01' });
  });
});

describe('JSON-RPC and HTTP input bounds', () => {
  it.each([
    ['invalid JSON', '{', 400, -32700],
    ['a batch', JSON.stringify([{ jsonrpc: '2.0', id: 1, method: 'ping' }]), 400, -32600],
    ['a non JSON-RPC body', JSON.stringify({ id: 1, method: 'ping' }), 400, -32600],
  ])('rejects %s', async (_label, body, status, code) => {
    const response = await post('echo', body);
    expect(response.status).toBe(status);
    expect((await response.json()).error.code).toBe(code);
  });

  it('rejects a non-JSON content type with 415', async () => {
    const response = await post('echo', 'ping', { 'Content-Type': 'text/plain' });
    expect(response.status).toBe(415);
  });

  it('rejects bodies over the size limit, declared or streamed', async () => {
    const big = JSON.stringify({ jsonrpc: '2.0', id: 1, method: 'ping', params: { pad: 'x'.repeat(MAX_FIXTURE_BODY_BYTES) } });
    expect((await post('echo', big)).status).toBe(413);
    const encoder = new TextEncoder();
    const stream = new ReadableStream({
      pull(controller) { controller.enqueue(encoder.encode('x'.repeat(4096))); },
    });
    const streamed = await handleFixtureRequest(new Request(`${ORIGIN}/fixtures/echo/mcp`, {
      method: 'POST', headers: { 'Content-Type': 'application/json' }, body: stream, duplex: 'half',
    }));
    expect(streamed.status).toBe(413);
  });

  const nonRequests = [
    ['notifications/initialized', { jsonrpc: '2.0', method: 'notifications/initialized' }],
    ['notifications/cancelled', { jsonrpc: '2.0', method: 'notifications/cancelled', params: { requestId: 1 } }],
    ['a result response', { jsonrpc: '2.0', id: 9, result: {} }],
    ['an error response', { jsonrpc: '2.0', id: 'r-1', error: { code: -32601, message: 'nope' } }],
    ['an error response with id null', { jsonrpc: '2.0', id: null, error: { code: -32700, message: 'parse' } }],
  ];
  const stateful = (headers = {}) => ({ 'MCP-Protocol-Version': LEGACY_PROTOCOL_VERSION, ...headers });

  it.each(nonRequests)('accepts %s on an issued session with 202', async (_label, message) => {
    const session = await legacySession('echo');
    const response = await post('echo', message, stateful({ 'Mcp-Session-Id': session }));
    expect(response.status).toBe(202);
    expect(await response.text()).toBe('');
  });

  it.each(nonRequests)('rejects %s without a session id with 400', async (_label, message) => {
    for (const headers of [stateful(), {}]) {
      const response = await post('echo', message, headers);
      expect(response.status).toBe(400);
      expect(await response.json()).toMatchObject({ jsonrpc: '2.0', id: null, error: { code: -32600 } });
    }
  });

  it.each(nonRequests)('rejects %s on an unknown session with 404', async (_label, message) => {
    const forged = createFixtureSessionId('errors');
    for (const session of ['mcptest-fx-unknown', await forged]) {
      const response = await post('echo', message, stateful({ 'Mcp-Session-Id': session }));
      expect(response.status).toBe(404);
      expect(await response.json()).toMatchObject({ jsonrpc: '2.0', id: null, error: { code: -32001 } });
    }
  });

  it.each(nonRequests)('rejects %s on a session with an unsupported legacy header', async (_label, message) => {
    const session = await legacySession('echo');
    const response = await post('echo', message, { 'MCP-Protocol-Version': '2020-01-01', 'Mcp-Session-Id': session });
    expect(response.status).toBe(400);
  });

  it.each(nonRequests)('accepts stateless 2026 %s without a session', async (_label, message) => {
    const response = await post('echo', message, { 'MCP-Protocol-Version': MODERN_PROTOCOL_VERSION });
    expect(response.status).toBe(202);
  });

  it('validates the stateless revision of notifications', async () => {
    const withMeta = (version) => ({
      jsonrpc: '2.0', method: 'notifications/cancelled', params: { requestId: 1, _meta: { ...envelope, 'io.modelcontextprotocol/protocolVersion': version } },
    });
    expect((await post('echo', withMeta(MODERN_PROTOCOL_VERSION), { 'MCP-Protocol-Version': MODERN_PROTOCOL_VERSION })).status).toBe(202);
    expect((await post('echo', withMeta(MODERN_PROTOCOL_VERSION))).status).toBe(202);
    const unsupported = await post('echo', { jsonrpc: '2.0', id: 9, result: {} }, { 'MCP-Protocol-Version': '2099-01-01' });
    expect(unsupported.status).toBe(400);
    expect((await unsupported.json()).error).toMatchObject({ code: -32022, data: { requested: '2099-01-01' } });
    const mismatched = await post('echo', withMeta(MODERN_PROTOCOL_VERSION), { 'MCP-Protocol-Version': '2099-01-01' });
    expect(mismatched.status).toBe(400);
    expect((await mismatched.json()).error.code).toBe(-32020);
  });

  it('checks auth before the session on notifications', async () => {
    const response = await post('auth-bearer', { jsonrpc: '2.0', method: 'notifications/initialized' }, stateful());
    expect(response.status).toBe(401);
  });

  it.each([
    ['a non-string method', { jsonrpc: '2.0', id: 1, method: 42 }, 1],
    ['a bare jsonrpc marker', { jsonrpc: '2.0' }, null],
    ['a request with id null', { jsonrpc: '2.0', id: null, method: 'ping' }, null],
    ['a request with an object id', { jsonrpc: '2.0', id: { x: 1 }, method: 'ping' }, null],
    ['a request with a boolean id', { jsonrpc: '2.0', id: true, method: 'ping' }, null],
    ['a request with an overflowing numeric id', '{"jsonrpc":"2.0","id":1e400,"method":"ping"}', null],
    ['a request with scalar params', { jsonrpc: '2.0', id: 2, method: 'ping', params: 'x' }, 2],
    ['a notification with a non-string method', { jsonrpc: '2.0', method: null }, null],
    ['a message with both method and result', { jsonrpc: '2.0', id: 3, method: 'ping', result: {} }, 3],
    ['a response with both result and error', { jsonrpc: '2.0', id: 4, result: {}, error: { code: 1, message: 'x' } }, 4],
    ['a response without an id', { jsonrpc: '2.0', result: {} }, null],
    ['a result response with id null', { jsonrpc: '2.0', id: null, result: {} }, null],
    ['a response with an array id', { jsonrpc: '2.0', id: [1], result: {} }, null],
    ['an error response with a malformed error', { jsonrpc: '2.0', id: 5, error: { code: '1', message: 'x' } }, 5],
    ['an error response with a non-object error', { jsonrpc: '2.0', id: 6, error: 'boom' }, 6],
    ['a non-2.0 marker with an object id', { jsonrpc: '1.0', id: { x: 1 }, method: 'ping' }, null],
  ])('rejects %s with -32600 instead of 202', async (_label, message, echoedId) => {
    const response = await post('echo', message);
    expect(response.status).toBe(400);
    const body = await response.json();
    expect(body).toMatchObject({ jsonrpc: '2.0', id: echoedId, error: { code: -32600 } });
  });

  it('answers unknown methods and tools with JSON-RPC errors', async () => {
    expect((await (await modern('echo', 'tools/nope')).json()).error.code).toBe(-32601);
    expect((await (await modern('echo', 'tools/call', { name: 'nope', arguments: {} })).json()).error.code).toBe(-32602);
  });
});

describe('echo and auth-bearer tools', () => {
  it.each(['echo', 'auth-bearer'])('%s: echo and add return fixed results in both eras', async (name) => {
    const [echo, echoLegacy] = await bothEras(name, 'tools/call', { name: 'echo', arguments: { message: 'hello fixtures' } });
    expect(echo.result.content).toEqual([{ type: 'text', text: 'hello fixtures' }]);
    expect(echo.result.resultType).toBe('complete');
    expect(echoLegacy.result).toEqual({ content: [{ type: 'text', text: 'hello fixtures' }] });

    const [add] = await bothEras(name, 'tools/call', { name: 'add', arguments: { a: 2, b: 40.5 } });
    expect(add.result.structuredContent).toEqual({ sum: 42.5 });
    expect(add.result.content).toEqual([{ type: 'text', text: '42.5' }]);
  });

  it.each(['echo', 'auth-bearer'])('%s: add answers an overflowing sum with -32602 in both eras', async (name) => {
    const overflowing = [{ a: 1e308, b: 1e308 }, { a: -1e308, b: -1e308 }, { a: Number.MAX_VALUE, b: Number.MAX_VALUE }];
    for (const args of overflowing) {
      const responses = await Promise.all([
        modern(name, 'tools/call', { name: 'add', arguments: args }),
        legacy(name, 'tools/call', { name: 'add', arguments: args }),
      ]);
      for (const response of responses) {
        expect(response.status).toBe(200);
        const body = await response.json();
        expect(body.result).toBeUndefined();
        expect(body.error).toMatchObject({ code: -32602, message: expect.stringContaining('not a finite number') });
      }
    }
    // Large but finite sums still succeed and match the outputSchema.
    const [large] = await bothEras(name, 'tools/call', { name: 'add', arguments: { a: 1e308, b: -1e308 } });
    expect(large.result.structuredContent).toEqual({ sum: 0 });
  });

  it('validates tool arguments with invalid params errors', async () => {
    for (const args of [{}, { message: 1 }, { message: 'x'.repeat(1001) }, { message: 'x', extra: true }]) {
      const body = await (await modern('echo', 'tools/call', { name: 'echo', arguments: args })).json();
      expect(body.error.code).toBe(-32602);
    }
    const body = await (await modern('echo', 'tools/call', { name: 'add', arguments: { a: '1', b: 2 } })).json();
    expect(body.error).toMatchObject({ code: -32602, data: { errors: [expect.objectContaining({ path: '/a' })] } });
  });

  it('whoami reports the negotiated revision in each era', async () => {
    const [stateless, stateful] = await bothEras('echo', 'tools/call', { name: 'whoami', arguments: {} });
    expect(stateless.result.structuredContent).toMatchObject({
      fixture: 'echo',
      protocolEra: 'stateless',
      protocolVersion: MODERN_PROTOCOL_VERSION,
      clientInfo: { name: 'fixture-test', version: '1.0.0' },
      session: 'none',
      headers: { 'mcp-method': 'tools/call', 'mcp-protocol-version': MODERN_PROTOCOL_VERSION },
    });
    expect(stateful.result.structuredContent).toMatchObject({
      protocolEra: 'stateful', protocolVersion: LEGACY_PROTOCOL_VERSION, session: 'present',
    });
  });

  it.each(['whoami', 'headers'])('%s never reflects Authorization, Cookie or other credential values', async (tool) => {
    const secrets = { Cookie: 'sid=cookie-secret-value', 'X-Api-Key': 'api-key-secret-value', 'X-Custom': 'custom-value' };
    const responses = [
      await modern('auth-bearer', 'tools/call', { name: tool, arguments: {} }, secrets),
      await modern('echo', 'tools/call', { name: tool, arguments: {} }, { ...secrets, Authorization: 'Bearer echo-secret-token' }),
      await legacy('auth-bearer', 'tools/call', { name: tool, arguments: {} }, { headers: secrets }),
    ];
    for (const response of responses) {
      const text = await response.text();
      expect(response.status).toBe(200);
      for (const secret of [PUBLIC_BEARER_TOKEN, 'echo-secret-token', 'cookie-secret-value', 'api-key-secret-value']) {
        expect(text).not.toContain(secret);
      }
      expect(text).not.toMatch(/mcptest-fx-[0-9a-f]{32}/);
    }
    if (tool === 'headers') {
      const { result } = await (await modern('echo', 'tools/call', { name: 'headers', arguments: {} }, {
        ...secrets, Authorization: 'Bearer x', 'CF-Connecting-IP': '203.0.113.9',
      })).json();
      expect(result.structuredContent.headers).toMatchObject({
        authorization: '[redacted]', cookie: '[redacted]', 'x-api-key': '[redacted]', 'x-custom': '[present]',
        'mcp-method': 'tools/call',
      });
      expect(result.structuredContent.headers).not.toHaveProperty('cf-connecting-ip');
    } else {
      const { result } = await (await modern('auth-bearer', 'tools/call', { name: 'whoami', arguments: {} })).json();
      expect(result.structuredContent.authorization).toEqual({ present: true, scheme: 'Bearer' });
    }
  });
});

describe('auth-bearer fixture', () => {
  it.each([
    ['no Authorization header', {}, 'Bearer realm="mcptest.io fixtures"'],
    ['a wrong token', { Authorization: 'Bearer wrong-token' }, expect.stringContaining('error="invalid_token"')],
    ['a non-bearer scheme', { Authorization: `Basic ${PUBLIC_BEARER_TOKEN}` }, expect.stringContaining('error="invalid_token"')],
  ])('answers %s with 401 and a Bearer challenge', async (_label, headers, challenge) => {
    for (const message of [
      { jsonrpc: '2.0', id: 1, method: 'initialize', params: { protocolVersion: LEGACY_PROTOCOL_VERSION, capabilities: {}, clientInfo: { name: 't', version: '1' } } },
      { jsonrpc: '2.0', id: 2, method: 'server/discover', params: { _meta: envelope } },
    ]) {
      const response = await post('auth-bearer', message, headers);
      expect(response.status).toBe(401);
      expect(response.headers.get('WWW-Authenticate')).toEqual(challenge);
      expect(response.headers.get('WWW-Authenticate')).toMatch(/^Bearer /);
      expect(response.headers.get('Access-Control-Allow-Origin')).toBe('*');
      const text = await response.text();
      expect(text).not.toContain('wrong-token');
    }
  });

  it('serves the echo tools with the public token in both eras', async () => {
    const { response } = await initialize('auth-bearer');
    expect(response.status).toBe(200);
    const [stateless] = await bothEras('auth-bearer', 'tools/call', { name: 'echo', arguments: { message: 'ok' } });
    expect(stateless.result.content[0].text).toBe('ok');
  });

  it('checks the token on GET and DELETE as well', async () => {
    expect((await send('/fixtures/auth-bearer/mcp', { method: 'GET' })).status).toBe(401);
    expect((await send('/fixtures/auth-bearer/mcp', { method: 'GET', headers: BEARER })).status).toBe(405);
  });
});

describe('errors fixture', () => {
  it('protocol_error answers with a JSON-RPC error in both eras', async () => {
    for (const response of [
      await modern('errors', 'tools/call', { name: 'protocol_error', arguments: {} }),
      await legacy('errors', 'tools/call', { name: 'protocol_error', arguments: {} }),
    ]) {
      expect(response.status).toBe(200);
      const body = await response.json();
      expect(body).not.toHaveProperty('result');
      expect(body.error).toEqual({ code: -32603, message: 'Deterministic protocol error from the errors fixture', data: { fixture: 'errors' } });
    }
  });

  it('tool_error returns a result with isError: true', async () => {
    const [stateless, stateful] = await bothEras('errors', 'tools/call', { name: 'tool_error', arguments: {} });
    expect(stateless.result).toMatchObject({ isError: true, resultType: 'complete', content: [{ type: 'text' }] });
    expect(stateful.result.isError).toBe(true);
  });

  it('invalid_params answers with -32602', async () => {
    const body = await (await modern('errors', 'tools/call', { name: 'invalid_params', arguments: {} })).json();
    expect(body.error.code).toBe(-32602);
  });

  it('http_500 answers with HTTP 500 and a JSON-RPC body in both eras', async () => {
    for (const response of [
      await modern('errors', 'tools/call', { name: 'http_500', arguments: {} }),
      await legacy('errors', 'tools/call', { name: 'http_500', arguments: {} }),
    ]) {
      expect(response.status).toBe(500);
      expect(response.headers.get('Content-Type')).toBe('application/json');
      const body = await response.json();
      expect(body.error.code).toBe(-32603);
      expect(body.id).toEqual(expect.any(Number));
    }
  });
});

describe('slow fixture', () => {
  it('sleeps for the requested delay', async () => {
    const wait = vi.fn(instantWait);
    const response = await modern('slow', 'tools/call', { name: 'sleep', arguments: { ms: 250 } }, {}, { wait });
    expect(wait).toHaveBeenCalledWith(250);
    expect((await response.json()).result.structuredContent).toEqual({ requestedMs: 250, sleptMs: 250, capped: false });
  });

  it(`caps the delay at ${MAX_DELAY_MS} ms`, async () => {
    const wait = vi.fn(instantWait);
    const response = await modern('slow', 'tools/call', { name: 'sleep', arguments: { ms: 600_000 } }, {}, { wait });
    expect(wait).toHaveBeenCalledTimes(1);
    expect(wait).toHaveBeenCalledWith(MAX_DELAY_MS);
    expect((await response.json()).result.structuredContent).toEqual({ requestedMs: 600_000, sleptMs: MAX_DELAY_MS, capped: true });
  });

  it('uses real timers by default and bounds them', async () => {
    vi.useFakeTimers();
    try {
      let settled = false;
      const pending = modern('slow', 'tools/call', { name: 'sleep', arguments: { ms: 60_000 } }).then((response) => { settled = true; return response; });
      await vi.advanceTimersByTimeAsync(MAX_DELAY_MS - 1);
      expect(settled).toBe(false);
      await vi.advanceTimersByTimeAsync(1);
      const response = await pending;
      expect((await response.json()).result.structuredContent.sleptMs).toBe(MAX_DELAY_MS);
    } finally {
      vi.useRealTimers();
    }
  });

  it('rejects negative or non-integer delays', async () => {
    for (const ms of [-1, 1.5, '10']) {
      const body = await (await modern('slow', 'tools/call', { name: 'sleep', arguments: { ms } }, {}, { wait: instantWait })).json();
      expect(body.error.code).toBe(-32602);
    }
  });

  const readSse = async (response) => (await response.text())
    .split('\n\n')
    .filter(Boolean)
    .map((frame) => JSON.parse(frame.split('\n').find((line) => line.startsWith('data: ')).slice(6)));

  it.each(['modern', 'legacy'])('streams progress notifications over SSE (%s era)', async (era) => {
    const params = { name: 'progress', arguments: { steps: 3, intervalMs: 5 }, _meta: { progressToken: 'tok-1' } };
    const wait = vi.fn(instantWait);
    const response = era === 'modern'
      ? await modern('slow', 'tools/call', params, {}, { wait })
      : await legacy('slow', 'tools/call', params, { options: { wait } });
    expect(response.status).toBe(200);
    expect(response.headers.get('Content-Type')).toBe('text/event-stream');
    expect(response.headers.get('Access-Control-Allow-Origin')).toBe('*');
    const messages = await readSse(response);
    expect(messages.slice(0, 3)).toEqual([1, 2, 3].map((progress) => ({
      jsonrpc: '2.0',
      method: 'notifications/progress',
      params: { progressToken: 'tok-1', progress, total: 3, message: `Step ${progress} of 3` },
    })));
    expect(messages[3].result.content).toEqual([{ type: 'text', text: 'Completed 3 steps.' }]);
    expect(messages).toHaveLength(4);
    expect(wait).toHaveBeenCalledTimes(3);
  });

  it('streams only the result without a progress token, and answers JSON without SSE in Accept', async () => {
    const sse = await modern('slow', 'tools/call', { name: 'progress', arguments: { steps: 2, intervalMs: 0 } }, {}, { wait: instantWait });
    const messages = await readSse(sse);
    expect(messages).toHaveLength(1);
    expect(messages[0].result.resultType).toBe('complete');

    const json = await modern('slow', 'tools/call', { name: 'progress', arguments: { steps: 2 } }, { Accept: 'application/json' }, { wait: instantWait });
    expect(json.headers.get('Content-Type')).toBe('application/json');
    expect((await json.json()).result.content[0].text).toBe('Completed 2 steps.');
  });

  it('bounds the progress step count and interval', async () => {
    for (const args of [{ steps: 11 }, { steps: 0 }, { intervalMs: 1001 }]) {
      const body = await (await modern('slow', 'tools/call', { name: 'progress', arguments: args }, { Accept: 'application/json' }, { wait: instantWait })).json();
      expect(body.error.code).toBe(-32602);
    }
  });
});

describe('schemas fixture', () => {
  const tools = Object.fromEntries(FIXTURE_SERVERS.schemas.tools.map((tool) => [tool.definition.name, tool.definition]));
  const order = {
    customer: { name: 'Ada', tier: 'pro' },
    items: [
      { sku: 'ABC-123', quantity: 2, unitPrice: 10, options: ['gift-wrap'] },
      { sku: 'XYZ-789', quantity: 1, unitPrice: 5.5 },
    ],
    shipping: { street: '1 Main St', city: 'Turin', country: 'IT' },
  };

  it('advertises nested, enum, array and optional input fields with an output schema', () => {
    const input = tools.create_order.inputSchema;
    expect(input.properties.customer.properties.tier.enum).toEqual(['free', 'pro', 'enterprise']);
    expect(input.properties.items.type).toBe('array');
    expect(input.properties.items.items.properties.options.items.enum).toContain('express');
    expect(input.required).toEqual(['customer', 'items']);
    expect(input.properties.shipping.required).toEqual(['street', 'city', 'country']);
    for (const tool of Object.values(tools)) expect(tool.outputSchema.type).toBe('object');
  });

  it('create_order returns structuredContent that matches its outputSchema in both eras', async () => {
    const [stateless, stateful] = await bothEras('schemas', 'tools/call', { name: 'create_order', arguments: order });
    expect(stateless.result.structuredContent).toEqual({
      orderId: 'ORD-003-123789',
      itemCount: 3,
      subtotal: 25.5,
      discount: 2.55,
      total: 22.95,
      currency: 'USD',
      shipsTo: 'Turin, IT',
    });
    expect(JSON.parse(stateless.result.content[0].text)).toEqual(stateless.result.structuredContent);
    expect(stateful.result.structuredContent).toEqual(stateless.result.structuredContent);
    expect(compileSchema(tools.create_order.outputSchema)(stateless.result.structuredContent).valid).toBe(true);

    const minimal = await (await modern('schemas', 'tools/call', { name: 'create_order', arguments: { customer: { name: 'B' }, items: [{ sku: 'AAA-001', quantity: 1, unitPrice: 1 }] } })).json();
    expect(minimal.result.structuredContent).toMatchObject({ discount: 0, total: 1, shipsTo: null });
  });

  it('classify returns structuredContent that matches its outputSchema', async () => {
    const values = ['a', 1, true, null, { x: 1 }, [1], 'b'];
    const body = await (await modern('schemas', 'tools/call', { name: 'classify', arguments: { values, mode: 'list' } })).json();
    expect(body.result.structuredContent).toEqual({
      total: 7,
      counts: { string: 2, number: 1, boolean: 1, null: 1, object: 1, array: 1 },
      types: ['string', 'number', 'boolean', 'null', 'object', 'array', 'string'],
    });
    expect(compileSchema(tools.classify.outputSchema)(body.result.structuredContent).valid).toBe(true);
  });

  it.each([
    ['a bad enum', { ...order, customer: { name: 'Ada', tier: 'gold' } }],
    ['a bad nested pattern', { ...order, items: [{ sku: 'abc', quantity: 1, unitPrice: 1 }] }],
    ['an empty array', { ...order, items: [] }],
    ['a missing nested required field', { ...order, shipping: { street: 'x', city: 'y' } }],
    ['an unknown field', { ...order, coupon: 'FREE' }],
  ])('rejects %s with invalid params', async (_label, args) => {
    const body = await (await modern('schemas', 'tools/call', { name: 'create_order', arguments: args })).json();
    expect(body.error.code).toBe(-32602);
    expect(body.error.data.errors.length).toBeGreaterThan(0);
  });
});
