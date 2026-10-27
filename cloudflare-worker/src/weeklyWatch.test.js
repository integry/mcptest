import { afterAll, beforeAll, beforeEach, describe, expect, it, vi } from 'vitest';
import { createPublicReport, serializePublicReportJson } from '../../src/utils/reportArtifact.ts';
import { analyzeToolSurface } from '../../src/utils/toolSurfaceAnalysis.ts';
import { createCompatibilityMatrix, createReleaseDecision } from '../../src/utils/releaseReadiness.ts';
import { PUBLISHED_REPORT_RETENTION, publishedEndpointKey } from '../../src/utils/publishedReportIdentity.ts';
import { createMockMcpServer } from '../../tests/e2e/mock-mcp-server.mjs';
import worker from './index.js';
import { PublishedReports } from './PublishedReports.js';
import {
  WATCH_BATCH_PER_RUN,
  WATCH_MAX_ENDPOINTS,
  WATCH_PLANS,
  isWatchableEndpoint,
  listToolsForWatch,
  runWeeklyWatch,
} from './weeklyWatch.js';

vi.setConfig({ testTimeout: 60_000 });

class MemoryStorage {
  constructor() { this.map = new Map(); }
  async get(key) {
    if (Array.isArray(key)) return new Map(key.filter((k) => this.map.has(k)).map((k) => [k, this.map.get(k)]));
    return this.map.get(key);
  }
  async put(key, value) {
    if (typeof key === 'object') Object.entries(key).forEach(([k, v]) => this.map.set(k, v));
    else this.map.set(key, value);
  }
  async delete(key) {
    (Array.isArray(key) ? key : [key]).forEach((k) => this.map.delete(k));
  }
  async list({ prefix = '' } = {}) {
    return new Map([...this.map].filter(([key]) => key.startsWith(prefix)).sort(([a], [b]) => (a < b ? -1 : 1)));
  }
}

const createNamespace = () => {
  const instances = new Map();
  return {
    instances,
    idFromName: (name) => ({ name }),
    get: (id) => {
      if (!instances.has(id.name)) instances.set(id.name, new PublishedReports({ storage: new MemoryStorage() }));
      return instances.get(id.name);
    },
  };
};

const ENDPOINT = 'https://watch.example/mcp';
const DAY = 24 * 60 * 60 * 1000;
const WEEK = WATCH_PLANS.free.intervalMs;

const evaluation = (overrides = {}) => ({
  serverUrl: ENDPOINT,
  outcome: 'scored',
  finalScore: 30,
  toolSurfaceAnalysis: analyzeToolSurface([{
    name: 'search',
    description: 'Search records.',
    inputSchema: { type: 'object', properties: { query: { type: 'string' } } },
  }]),
  sections: {
    protocol: {
      name: 'Protocol', description: 'Protocol', score: 15, maxScore: 15,
      details: [{ text: 'Negotiated', metadata: { protocolEra: 'modern', protocolVersion: '2026-07-28', endpoint: ENDPOINT, route: 'direct' } }],
    },
    transport: {
      name: 'Transport', description: 'Transport', score: 15, maxScore: 15,
      details: [{ text: 'Connected', metadata: { transportType: 'streamable-http' } }],
    },
  },
  ...overrides,
});

const artifactFor = (report, generatedAt = '2026-10-20T09:00:00.000Z') => {
  const compatibilityMatrix = createCompatibilityMatrix(report);
  const releaseDecision = createReleaseDecision(report, compatibilityMatrix, report.toolSurfaceAnalysis);
  return JSON.parse(serializePublicReportJson(createPublicReport(report, {
    generatedAt, releaseDecision, compatibilityMatrix, toolSurfaceAnalysis: report.toolSurfaceAnalysis,
  })));
};
const baseArtifact = artifactFor(evaluation());
const clone = (value) => JSON.parse(JSON.stringify(value));
const run = (label) => {
  const artifact = clone(baseArtifact);
  artifact.sections[0].evidence[0].message = `Negotiated (${label})`;
  return artifact;
};

let env;
let ipCounter = 0;
const request = (path, init = {}) => worker.fetch(
  new Request(`https://mcptest.io${path}`, {
    ...init,
    headers: { 'CF-Connecting-IP': `198.51.100.${(ipCounter += 1) % 250}`, Origin: 'https://mcptest.io', ...(init.headers || {}) },
  }),
  env,
  {}
);
const publish = (artifact, query = '?watch=weekly') => request(`/r${query}`, {
  method: 'POST',
  headers: { 'Content-Type': 'application/json' },
  body: JSON.stringify(artifact),
});

/** A stateless 2026-07-28 MCP server in memory whose tools a test can change. */
const fakeServer = (initialTools) => {
  const server = { tools: initialTools, calls: 0, status: 200 };
  server.fetch = async (url, init) => {
    server.calls += 1;
    if (server.status !== 200) return new Response('{"error":"unauthorized"}', { status: server.status, headers: { 'WWW-Authenticate': 'Bearer' } });
    expect(init.headers.Authorization).toBeUndefined();
    const message = JSON.parse(init.body);
    const result = message.method === 'server/discover'
      ? { supportedVersions: ['2026-07-28'], capabilities: { tools: {} } }
      : message.method === 'tools/list' ? { tools: server.tools } : undefined;
    const body = result
      ? { jsonrpc: '2.0', id: message.id, result }
      : { jsonrpc: '2.0', id: message.id, error: { code: -32601, message: 'Method not found' } };
    return new Response(JSON.stringify(body), { status: 200, headers: { 'Content-Type': 'application/json' } });
  };
  return server;
};

const TOOLS = () => [
  { name: 'search', description: 'Search records', inputSchema: { type: 'object', properties: { query: { type: 'string' } }, required: ['query'] } },
  { name: 'fetch_record', description: 'Fetch one record by id', inputSchema: { type: 'object', properties: { id: { type: 'string' } } } },
];

beforeEach(() => {
  env = {
    FIREBASE_PROJECT_ID: 'test-project',
    USER_STATE: { idFromName: () => { throw new Error('watch routes must not reach UserState'); } },
    PUBLISHED_REPORTS: createNamespace(),
  };
});

describe('listToolsForWatch against the e2e mock server', () => {
  let mock;
  let origin;
  beforeAll(async () => {
    mock = createMockMcpServer();
    await new Promise((resolve) => mock.server.listen(0, '127.0.0.1', resolve));
    origin = `http://127.0.0.1:${mock.server.address().port}`;
  });
  afterAll(() => new Promise((resolve) => mock.server.close(resolve)));

  it('lists tools from a 2026-07-28 stateless server', async () => {
    const listed = await listToolsForWatch(`${origin}/2026/mcp`);
    expect(listed.outcome).toBe('ok');
    expect(listed.tools.map((tool) => tool.name)).toEqual(['get_forecast', 'always_fails']);
    expect(listed.protocolVersion).toBe('2026-07-28');
  });

  it('falls back to the 2025 initialize handshake and closes the session', async () => {
    const listed = await listToolsForWatch(`${origin}/2025/mcp`);
    expect(listed.outcome).toBe('ok');
    expect(listed.tools).toHaveLength(2);
    const methods = mock.requests.filter((entry) => entry.mode === '2025').map((entry) => entry.rpcMethod || entry.method);
    expect(methods).toEqual(['server/discover', 'initialize', 'notifications/initialized', 'tools/list', 'DELETE']);
  });

  it('reports a rate-limited or broken server as an error, never throwing', async () => {
    expect((await listToolsForWatch(`${origin}/rate-limited/mcp`)).outcome).toBe('error');
    expect((await listToolsForWatch('http://127.0.0.1:1/mcp')).outcome).toBe('unreachable');
  });

  it('stops reading a body past the size cap even without a Content-Length', async () => {
    let pulled = 0;
    const endless = () => new Response(new ReadableStream({
      pull(controller) {
        pulled += 1;
        controller.enqueue(new Uint8Array(256 * 1024).fill(32));
      },
    }), { status: 200, headers: { 'Content-Type': 'application/json' } });
    const listed = await listToolsForWatch(ENDPOINT, { fetchImpl: async () => endless() });
    expect(listed.outcome).toBe('error');
    expect(listed.message).toMatch(/too large/);
    // About 1 MiB of 256 KiB chunks per request, not an unbounded read.
    expect(pulled).toBeLessThan(40);
  });

  it('skips servers that require authorization', async () => {
    const server = fakeServer(TOOLS());
    server.status = 401;
    expect(await listToolsForWatch(ENDPOINT, { fetchImpl: server.fetch })).toMatchObject({ outcome: 'auth-required' });
  });
});

describe('isWatchableEndpoint', () => {
  it('never contacts an endpoint whose stored URL carries a redacted credential', () => {
    expect(isWatchableEndpoint(ENDPOINT)).toBe(true);
    expect(isWatchableEndpoint('https://watch.example/mcp?api_key=%5BREDACTED%5D')).toBe(false);
  });
});

describe('weekly watch', () => {
  it('opts in when publishing, records a baseline, then classifies the next change', async () => {
    const published = await publish(run('a'));
    expect(published.status).toBe(201);
    const body = await published.json();
    expect(body.watch).toEqual({ enabled: true, plan: 'free', interval: 'weekly' });
    expect(body.changesFeedUrl).toBe(`https://mcptest.io/r/${encodeURIComponent(ENDPOINT)}/changes.xml`);

    const server = fakeServer(TOOLS());
    const start = Date.parse('2026-10-24T12:00:00.000Z');
    expect(await runWeeklyWatch(env, { now: start, fetchImpl: server.fetch })).toEqual([
      expect.objectContaining({ outcome: 'baseline' }),
    ]);
    // Not due again within the week.
    expect(await runWeeklyWatch(env, { now: start + DAY, fetchImpl: server.fetch })).toEqual([]);
    expect(await runWeeklyWatch(env, { now: start + WEEK, fetchImpl: server.fetch })).toEqual([
      expect.objectContaining({ outcome: 'unchanged' }),
    ]);

    server.tools = [server.tools[0], { name: 'list_records', description: 'List records', inputSchema: { type: 'object' } }];
    server.tools[0].inputSchema.properties.tenant = { type: 'string' };
    server.tools[0].inputSchema.required.push('tenant');
    expect(await runWeeklyWatch(env, { now: start + 2 * WEEK, fetchImpl: server.fetch })).toEqual([
      expect.objectContaining({ outcome: 'breaking' }),
    ]);

    const index = await (await request(`/r/endpoint/${encodeURIComponent(ENDPOINT)}`)).json();
    expect(index.watch).toMatchObject({
      enabled: true,
      plan: 'free',
      state: { state: 'breaking', summary: '2 breaking, 1 safe' },
      lastChange: { severity: 'breaking', counts: { breaking: 2, risky: 0, safe: 1 }, toolCount: 2 },
    });
    expect(index.watch.lastChange.findings.map((item) => item.rule).sort()).toEqual(['required-input-added', 'tool-added', 'tool-removed']);

    const feed = await request(`/r/${encodeURIComponent(ENDPOINT)}/changes.xml`);
    expect(feed.status).toBe(200);
    expect(feed.headers.get('Content-Type')).toBe('application/atom+xml; charset=utf-8');
    const xml = await feed.text();
    expect(xml).toContain('<feed xmlns="http://www.w3.org/2005/Atom">');
    expect(xml.match(/<entry>/g)).toHaveLength(2);
    expect(xml).toContain('<title>2 breaking, 1 safe (2 tools)</title>');
    expect(xml).toContain('Baseline recorded: 2 tools');
    expect(xml).toContain('fetch_record: Tool removed.');
    expect(xml.indexOf('2 breaking')).toBeLessThan(xml.indexOf('Baseline recorded'));
  });

  it('shows the breaking change on the live badge until the owner publishes again', async () => {
    await publish(run('a'));
    const server = fakeServer(TOOLS());
    const start = Date.now() + DAY;
    await runWeeklyWatch(env, { now: start, fetchImpl: server.fetch });
    const badge = () => request(`/badge/report/${encodeURIComponent(ENDPOINT)}.svg`);
    const before = (await badge()).headers.get('X-Badge-Result');
    expect(before).not.toBe('breaking-change');

    server.tools = server.tools.slice(0, 1);
    await runWeeklyWatch(env, { now: start + WEEK, fetchImpl: server.fetch });
    const drifted = await badge();
    expect(drifted.headers.get('X-Badge-Result')).toBe('breaking-change');
    expect(await drifted.text()).toContain('breaking change');

    // Publishing a newer run clears it.
    vi.useFakeTimers({ now: start + WEEK + DAY, toFake: ['Date'] });
    try {
      await publish(run('b'));
    } finally {
      vi.useRealTimers();
    }
    expect((await badge()).headers.get('X-Badge-Result')).toBe(before);
  });

  it('keeps no more watch snapshots than the report retention allows', async () => {
    await publish(run('a'));
    const server = fakeServer(TOOLS());
    const start = Date.parse('2026-10-24T12:00:00.000Z');
    for (let index = 0; index < PUBLISHED_REPORT_RETENTION + 3; index += 1) {
      server.tools = [...TOOLS(), { name: `tool_${index}`, inputSchema: { type: 'object' } }];
      await runWeeklyWatch(env, { now: start + index * WEEK, fetchImpl: server.fetch });
    }
    const key = await publishedEndpointKey(ENDPOINT);
    const watch = await (await env.PUBLISHED_REPORTS.get({ name: `endpoint:${key}` }).fetch(new Request('https://x/watch'))).json();
    expect(watch.entries).toHaveLength(PUBLISHED_REPORT_RETENTION);
    const storage = env.PUBLISHED_REPORTS.get({ name: `endpoint:${key}` }).storage;
    const snapshotIds = new Set([...storage.map.keys()].filter((k) => k.startsWith('watch:snapshot:')).map((k) => k.split(':')[2]));
    expect(snapshotIds.size).toBe(PUBLISHED_REPORT_RETENTION);
  });

  it('records auth-required without storing a snapshot', async () => {
    await publish(run('a'));
    const server = fakeServer(TOOLS());
    server.status = 401;
    expect(await runWeeklyWatch(env, { now: Date.now(), fetchImpl: server.fetch })).toEqual([
      expect.objectContaining({ outcome: 'auth-required' }),
    ]);
    const index = await (await request(`/r/endpoint/${encodeURIComponent(ENDPOINT)}`)).json();
    expect(index.watch.state.state).toBe('auth-required');
    expect(index.watch.lastChange).toBeNull();
  });

  it('checks at most one batch of due endpoints per run', async () => {
    for (let index = 0; index < WATCH_BATCH_PER_RUN + 4; index += 1) {
      const artifact = run(`host-${index}`);
      artifact.target.testedEndpoint = `https://host-${index}.example/mcp`;
      expect((await publish(artifact)).status).toBe(201);
    }
    const server = fakeServer(TOOLS());
    const now = Date.now();
    expect(await runWeeklyWatch(env, { now, fetchImpl: server.fetch })).toHaveLength(WATCH_BATCH_PER_RUN);
    expect(await runWeeklyWatch(env, { now, fetchImpl: server.fetch })).toHaveLength(4);
    expect(await runWeeklyWatch(env, { now, fetchImpl: server.fetch })).toHaveLength(0);
  });

  it('does not watch without the opt-in, or a server that required authorization', async () => {
    expect((await (await publish(run('a'), '')).json()).watch).toBeUndefined();
    const authRequired = artifactFor(evaluation({
      outcome: 'authorization-required',
      finalScore: 0,
      sections: { protocol: { name: 'Protocol', description: 'Protocol', score: 0, maxScore: 15, status: 'failed', details: [{ text: 'Authorization required' }] } },
    }));
    authRequired.target.testedEndpoint = 'https://auth.example/mcp';
    const body = await (await publish(authRequired)).json();
    expect(body.entry.summary.status).toBe('authorization-required');
    expect(body.watch).toEqual({ enabled: false, reason: expect.stringMatching(/without authorization/) });
    const server = fakeServer(TOOLS());
    expect(await runWeeklyWatch(env, { now: Date.now(), fetchImpl: server.fetch })).toEqual([]);
    expect(server.calls).toBe(0);
  });

  it('turns the watch off and on with the snapshot removal token', async () => {
    const body = await (await publish(run('a'))).json();
    const toggle = (watch, token = body.removalToken) => request(`/r/${body.id}/watch`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', ...(token ? { 'X-Removal-Token': token } : {}) },
      body: JSON.stringify({ watch }),
    });
    expect((await toggle(false, null)).status).toBe(401);
    expect((await toggle(false, 'wrong-token')).status).toBe(403);
    const off = await toggle(false);
    expect(off.status).toBe(200);
    expect((await off.json()).watch).toEqual({ enabled: false });
    const server = fakeServer(TOOLS());
    expect(await runWeeklyWatch(env, { now: Date.now(), fetchImpl: server.fetch })).toEqual([]);
    expect(server.calls).toBe(0);
    expect((await (await toggle(true)).json()).watch).toMatchObject({ enabled: true });
    expect(await runWeeklyWatch(env, { now: Date.now(), fetchImpl: server.fetch })).toHaveLength(1);
  });

  it('stops the watch when the last published snapshot is removed', async () => {
    const first = await (await publish(run('a'))).json();
    const second = await (await publish(run('b'), '')).json();
    const remove = (body) => request(`/r/${body.id}`, { method: 'DELETE', headers: { 'X-Removal-Token': body.removalToken } });
    const server = fakeServer(TOOLS());
    const start = Date.now();
    await runWeeklyWatch(env, { now: start, fetchImpl: server.fetch });
    server.tools = server.tools.slice(0, 1);
    await runWeeklyWatch(env, { now: start + WEEK, fetchImpl: server.fetch });
    const badge = async () => (await request(`/badge/report/${encodeURIComponent(ENDPOINT)}.svg`)).headers.get('X-Badge-Result');
    const feedEntries = async () => ((await (await request(`/r/${encodeURIComponent(ENDPOINT)}/changes.xml`)).text()).match(/<entry>/g) || []).length;
    expect(await badge()).toBe('breaking-change');
    expect(await feedEntries()).toBe(2);

    // Another snapshot still carries a token that controls the watch.
    expect((await remove(second)).status).toBe(204);
    expect((await (await request(`/r/endpoint/${encodeURIComponent(ENDPOINT)}`)).json()).watch.enabled).toBe(true);

    expect((await remove(first)).status).toBe(204);
    const index = await (await request(`/r/endpoint/${encodeURIComponent(ENDPOINT)}`)).json();
    expect(index.snapshots).toEqual([]);
    expect(index.watch.enabled).toBe(false);
    const registry = env.PUBLISHED_REPORTS.get({ name: 'watch:registry' });
    expect([...registry.storage.map.keys()].filter((k) => k.startsWith('registry:'))).toEqual([]);
    const calls = server.calls;
    expect(await runWeeklyWatch(env, { now: start + 3 * WEEK, fetchImpl: server.fetch })).toEqual([]);
    expect(server.calls).toBe(calls);
    expect(await feedEntries()).toBe(2);
    expect(await badge()).toBe('neutral');
  });

  it('stops the watch with the last snapshot even if the registry update fails', async () => {
    const body = await (await publish(run('a'))).json();
    const registry = env.PUBLISHED_REPORTS.get({ name: 'watch:registry' });
    const registryFetch = registry.fetch.bind(registry);
    registry.fetch = async (req) => (new URL(req.url).pathname === '/registry/remove' ? new Response('{}', { status: 500 }) : registryFetch(req));
    expect((await request(`/r/${body.id}`, { method: 'DELETE', headers: { 'X-Removal-Token': body.removalToken } })).status).toBe(204);
    registry.fetch = registryFetch;
    const server = fakeServer(TOOLS());
    expect(await runWeeklyWatch(env, { now: Date.now(), fetchImpl: server.fetch })).toEqual([
      expect.objectContaining({ outcome: 'not-watched' }),
    ]);
    expect(server.calls).toBe(0);
    expect([...registry.storage.map.keys()].filter((k) => k.startsWith('registry:'))).toEqual([]);
  });

  it('does not turn the watch on once the snapshot it was authorized by is removed', async () => {
    const body = await (await publish(run('a'), '')).json();
    const key = await publishedEndpointKey(ENDPOINT);
    const endpoint = env.PUBLISHED_REPORTS.get({ name: `endpoint:${key}` });
    const endpointFetch = endpoint.fetch.bind(endpoint);
    // The snapshot is removed after the token was verified and the snapshot read.
    let reads = 0;
    endpoint.fetch = async (req) => {
      const response = await endpointFetch(req);
      if (req.method === 'GET' && new URL(req.url).pathname === `/snapshot/${body.id}` && (reads += 1) === 1) {
        await request(`/r/${body.id}`, { method: 'DELETE', headers: { 'X-Removal-Token': body.removalToken } });
      }
      return response;
    };
    const toggled = await request(`/r/${body.id}/watch`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', 'X-Removal-Token': body.removalToken },
      body: JSON.stringify({ watch: true }),
    });
    expect((await toggled.json()).watch).toEqual({ enabled: false, reason: expect.stringMatching(/no published report/) });
    const registry = env.PUBLISHED_REPORTS.get({ name: 'watch:registry' });
    expect([...registry.storage.map.keys()].filter((k) => k.startsWith('registry:'))).toEqual([]);
    expect((await (await request(`/r/endpoint/${encodeURIComponent(ENDPOINT)}`)).json()).watch.enabled).toBe(false);
  });

  it('refuses opt-ins once the watch is full', async () => {
    const registry = env.PUBLISHED_REPORTS.get({ name: 'watch:registry' });
    const filler = {};
    for (let index = 0; index < WATCH_MAX_ENDPOINTS; index += 1) {
      filler[`registry:key${index}`] = { endpointKey: `key${index}`, endpoint: `https://h${index}.example/mcp`, plan: 'free', lastCheckedAt: new Date().toISOString() };
    }
    await registry.storage.put(filler);
    const body = await (await publish(run('a'))).json();
    expect(body.watch).toEqual({ enabled: false, reason: expect.stringMatching(/full/) });
  });

  it('limits watch opt-ins per client address but still publishes the report', async () => {
    const sameClient = { headers: { 'CF-Connecting-IP': '203.0.113.77' } };
    const optIn = (label) => request('/r?watch=weekly', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', ...sameClient.headers },
      body: JSON.stringify(run(label)),
    });
    for (let index = 0; index < 5; index += 1) {
      const body = await (await optIn(`limit-${index}`)).json();
      expect(body.watch?.enabled).toBe(true);
    }
    const refused = await optIn('limit-5');
    expect(refused.status).toBeLessThan(300);
    const body = await refused.json();
    expect(body.id).toBeTruthy();
    expect(body.watch).toEqual({ enabled: false, reason: expect.stringMatching(/per day per address/) });
  });

  it('serves an empty but valid feed for an endpoint that is not watched', async () => {
    const feed = await request(`/r/${encodeURIComponent('https://never.example/mcp')}/changes.xml`);
    expect(feed.status).toBe(200);
    const xml = await feed.text();
    expect(xml).toContain('<feed');
    expect(xml).not.toContain('<entry>');
    expect((await request(`/r/${encodeURIComponent('http://localhost/mcp')}/changes.xml`)).status).toBe(404);
  });
});

describe('weekly alert owner routes', () => {
  it('requires a retained snapshot removal token for setup, status, test and removal', async () => {
    const published = await (await publish(run('alerts'))).json();
    for (const [method, suffix] of [['GET', ''], ['POST', ''], ['POST', '/test'], ['DELETE', '']]) {
      const path = `/r/${published.id}/alerts${suffix}`;
      const init = { method, ...(method === 'POST' && !suffix ? { body: JSON.stringify({ url: 'https://receiver.acme.com/hook' }) } : {}) };
      expect((await request(path, init)).status).toBe(401);
      expect((await request(path, { ...init, headers: { 'X-Removal-Token': 'wrong' } })).status).toBe(403);
    }
    const path = `/r/${published.id}/alerts`;
    const headers = { 'X-Removal-Token': published.removalToken, 'Content-Type': 'application/json' };
    const url = 'https://receiver.acme.com/hook?secret=destination-secret';
    const created = await request(path, { method: 'POST', headers, body: JSON.stringify({ url }) });
    expect(created.status).toBe(200);
    const body = await created.json();
    expect(body.signingSecret).toMatch(/^[a-f0-9]{64}$/);
    expect(JSON.stringify(body)).not.toContain(url);
    const read = await request(path, { headers });
    expect(read.headers.get('Cache-Control')).toBe('no-store');
    expect(await read.json()).toEqual({ alert: body.alert });
    for (const publicPath of [`/r/endpoint/${encodeURIComponent(ENDPOINT)}`, `/r/${published.id}`, `/r/${encodeURIComponent(ENDPOINT)}/changes.xml`, `/badge/report/${encodeURIComponent(ENDPOINT)}.svg`]) {
      const text = await (await request(publicPath)).text();
      expect(text).not.toContain(url);
      expect(text).not.toContain(body.signingSecret);
    }
    const fetchImpl = vi.fn(async () => new Response(null, { status: 204 }));
    vi.stubGlobal('fetch', fetchImpl);
    try {
      const tested = await request(`${path}/test`, { method: 'POST', headers });
      expect((await tested.json()).alert.lastDelivery).toMatchObject({ status: 'ok', httpStatus: 204 });
      expect(fetchImpl).toHaveBeenCalledTimes(1);
      expect((await request(`${path}/test`, { method: 'POST', headers })).status).toBe(429);
    } finally { vi.unstubAllGlobals(); }
    expect((await request(path, { method: 'DELETE', headers })).status).toBe(200);
    expect(await (await request(path, { headers })).json()).toEqual({ alert: null });
    await request(path, { method: 'POST', headers, body: JSON.stringify({ url }) });
    await request(`/r/${published.id}`, { method: 'DELETE', headers });
    expect((await request(path, { headers })).status).toBe(403);
    const stub = env.PUBLISHED_REPORTS.get({ name: `endpoint:${await publishedEndpointKey(ENDPOINT)}` });
    expect(await stub.storage.get('watch:alert-destination')).toBeUndefined();
  });

  it('queues only breaking and risky weekly changes and leaves successful checks intact on delivery failure', async () => {
    const published = await (await publish(run('cron-alerts'))).json();
    await request(`/r/${published.id}/alerts`, {
      method: 'POST', headers: { 'X-Removal-Token': published.removalToken },
      body: JSON.stringify({ url: 'https://receiver.acme.com/hook' }),
    });
    const server = fakeServer(TOOLS());
    const start = Date.now();
    const fetchImpl = vi.fn(async () => { throw new Error('secret URL must never escape'); });
    vi.stubGlobal('fetch', fetchImpl);
    try {
      await runWeeklyWatch(env, { now: start, fetchImpl: server.fetch });
      expect(fetchImpl).not.toHaveBeenCalled();
      server.tools = [server.tools[0]];
      expect(await runWeeklyWatch(env, { now: start + WEEK, fetchImpl: server.fetch })).toEqual([expect.objectContaining({ outcome: 'breaking' })]);
      expect(fetchImpl).toHaveBeenCalledTimes(2);
      await runWeeklyWatch(env, { now: start + 2 * WEEK, fetchImpl: server.fetch });
      expect(fetchImpl).toHaveBeenCalledTimes(2);
    } finally { vi.unstubAllGlobals(); }
  });
});
