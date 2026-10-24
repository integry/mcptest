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

  it('serves an empty but valid feed for an endpoint that is not watched', async () => {
    const feed = await request(`/r/${encodeURIComponent('https://never.example/mcp')}/changes.xml`);
    expect(feed.status).toBe(200);
    const xml = await feed.text();
    expect(xml).toContain('<feed');
    expect(xml).not.toContain('<entry>');
    expect((await request(`/r/${encodeURIComponent('http://localhost/mcp')}/changes.xml`)).status).toBe(404);
  });
});
