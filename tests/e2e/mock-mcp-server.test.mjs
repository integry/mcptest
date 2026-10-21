// @vitest-environment node
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { Client, StreamableHTTPClientTransport } from '@modelcontextprotocol/client';
import {
  RATE_LIMIT_RETRY_AFTER_SECONDS,
  STATEFUL_VERSION,
  STATELESS_VERSION,
  createMockMcpServer,
} from './mock-mcp-server.mjs';

/**
 * The e2e mock must speak both protocol eras the way the official client SDK
 * expects, so the Playwright suite tests the app rather than the mock.
 */
let mock;
let base;

beforeAll(async () => {
  mock = createMockMcpServer();
  await new Promise(resolve => mock.server.listen(0, '127.0.0.1', resolve));
  base = `http://127.0.0.1:${mock.server.address().port}`;
});

afterAll(async () => {
  await new Promise(resolve => mock.server.close(resolve));
});

const connectWithSdk = async (path) => {
  const client = new Client({ name: 'mock-test', version: '1.0.0' }, { versionNegotiation: { mode: 'auto' } });
  await client.connect(new StreamableHTTPClientTransport(new URL(`${base}/${path}/mcp`)));
  return client;
};

const post = (path, body, headers = {}) => fetch(`${base}/${path}/mcp`, {
  method: 'POST',
  headers: {
    'Content-Type': 'application/json',
    Accept: 'application/json, text/event-stream',
    Origin: 'http://127.0.0.1:4173',
    ...headers,
  },
  body: JSON.stringify(body),
});

const initialize = { jsonrpc: '2.0', id: 1, method: 'initialize', params: { protocolVersion: STATEFUL_VERSION, capabilities: {}, clientInfo: { name: 'raw', version: '1' } } };

describe.each([
  ['2026', 'modern', STATELESS_VERSION],
  ['2025', 'legacy', STATEFUL_VERSION],
])('the /%s flow with the official client SDK', (path, era, version) => {
  it('negotiates, lists, calls, reads and gets', async () => {
    const client = await connectWithSdk(path);
    try {
      expect(client.getProtocolEra()).toBe(era);
      expect(client.getNegotiatedProtocolVersion()).toBe(version);

      const { tools } = await client.listTools();
      expect(tools.map(tool => tool.name)).toEqual(['get_forecast', 'always_fails']);
      expect(tools[0].outputSchema).toMatchObject({ required: ['city', 'temperatureC', 'conditions'] });
      expect((await client.listResources()).resources).toHaveLength(1);
      expect((await client.listPrompts()).prompts).toHaveLength(1);

      const structured = await client.callTool({ name: 'get_forecast', arguments: { city: 'Oslo' } });
      expect(structured.isError).toBeFalsy();
      expect(structured.structuredContent).toEqual({ city: 'Oslo', temperatureC: 12.5, conditions: 'Light rain' });
      const failed = await client.callTool({ name: 'always_fails', arguments: {} });
      expect(failed.isError).toBe(true);

      expect((await client.readResource({ uri: 'mock://docs/readme' })).contents[0].text).toContain('Mock readme');
      expect((await client.getPrompt({ name: 'greeting', arguments: { name: 'Ada' } })).messages[0].content.text).toBe('Say hello to Ada.');
    } finally {
      await client.close();
    }
  });
});

describe('protocol details', () => {
  it('keeps no session on the stateless flow and rejects the 2025 handshake there', async () => {
    const discover = await post('2026', { jsonrpc: '2.0', id: 1, method: 'server/discover', params: {} });
    expect(discover.headers.get('mcp-session-id')).toBeNull();
    expect(discover.headers.get('mcp-protocol-version')).toBe(STATELESS_VERSION);
    expect((await discover.json()).result).toMatchObject({ resultType: 'complete', supportedVersions: [STATELESS_VERSION] });

    const legacy = await post('2026', initialize);
    expect(legacy.status).toBe(400);
    expect((await legacy.json()).error).toMatchObject({ code: -32022, data: { supported: [STATELESS_VERSION] } });
  });

  it('issues and exposes a session on the stateful flow and requires it afterwards', async () => {
    const response = await post('2025', initialize);
    const sessionId = response.headers.get('mcp-session-id');
    expect(sessionId).toMatch(/^[0-9a-f-]{36}$/);
    expect(response.headers.get('access-control-expose-headers')).toContain('Mcp-Session-Id');

    const withoutSession = await post('2025', { jsonrpc: '2.0', id: 2, method: 'tools/list' });
    expect(withoutSession.status).toBe(400);
    expect((await withoutSession.json()).error.message).toBe('Bad Request: No valid session ID provided');

    const withSession = await post('2025', { jsonrpc: '2.0', id: 3, method: 'tools/list' }, { 'Mcp-Session-Id': sessionId });
    expect(withSession.status).toBe(200);
  });

  it('answers CORS preflight with the MCP headers allowed', async () => {
    const response = await fetch(`${base}/2025/mcp`, {
      method: 'OPTIONS',
      headers: { Origin: 'http://127.0.0.1:4173', 'Access-Control-Request-Method': 'POST', 'Access-Control-Request-Headers': 'content-type,mcp-session-id,mcp-protocol-version' },
    });
    expect(response.status).toBe(204);
    expect(response.headers.get('access-control-allow-origin')).toBe('http://127.0.0.1:4173');
    expect(response.headers.get('access-control-allow-headers')).toContain('mcp-session-id');
  });
});

describe('misbehavior modes', () => {
  it('accept-406 refuses the spec Accept header', async () => {
    expect((await post('accept-406', initialize)).status).toBe(406);
  });

  it('no-expose issues a session id without exposing it', async () => {
    const response = await post('no-expose', initialize);
    expect(response.status).toBe(200);
    expect(response.headers.get('mcp-session-id')).toBeTruthy();
    expect(response.headers.get('access-control-expose-headers')).toBeNull();
  });

  it('rate-limited answers 429 with an exposed Retry-After', async () => {
    const response = await post('rate-limited', initialize);
    expect(response.status).toBe(429);
    expect(response.headers.get('retry-after')).toBe(String(RATE_LIMIT_RETRY_AFTER_SECONDS));
    expect(response.headers.get('access-control-expose-headers')).toContain('Retry-After');
  });
});
