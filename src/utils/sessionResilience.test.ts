import { describe, expect, it, vi } from 'vitest';
import { checkSessionResilience } from './sessionResilience';
import { sessionResilienceConnection } from './sessionResilienceConnection';
import { detectedTransportDiagnostics } from './transportDiagnostics';
import { transportDiagnosticPriority } from './releaseReadiness';

function mockServer(mode = 'compliant') {
  const sessions = new Set<string>();
  let serial = 0;
  let pings = 0;
  const fetch = vi.fn<typeof globalThis.fetch>(async (_input, init) => {
    const headers = new Headers(init?.headers);
    const session = headers.get('Mcp-Session-Id');
    const body = init?.body ? JSON.parse(String(init.body)) : {};
    const reply = (status: number, result?: unknown, id?: string) => new Response(JSON.stringify({ jsonrpc: '2.0', id: body.id, ...(result ? { result } : { error: { code: -32000, message: 'Session not found' } }) }), { status, headers: { 'Content-Type': 'application/json', ...(id ? { 'Mcp-Session-Id': id } : {}) } });
    if (init?.method === 'DELETE') {
      if (mode === 'no-delete') return reply(405);
      if (mode !== 'broken-delete') sessions.delete(session!);
      return new Response(null, { status: 204 });
    }
    if (body.method === 'initialize') {
      const id = mode === 'stateless' ? undefined : mode === 'reused-id' ? 'session-reused' : `session-${++serial}`;
      if (id) sessions.add(id);
      return reply(200, { protocolVersion: '2025-11-25', capabilities: {}, serverInfo: { name: 'mock', version: '1' } }, id);
    }
    if (mode !== 'stateless' && !sessions.has(session!)) return reply(mode === 'bad-status' ? 400 : 404);
    if (body.method === 'notifications/initialized') return new Response(null, { status: 202 });
    if (['replicas', 'replicas-400', 'unrelated-400'].includes(mode) && ++pings % 2 === 0) {
      if (mode === 'unrelated-400') return new Response(JSON.stringify({ id: body.id, error: { message: 'Bad request payload' } }), { status: 400 });
      return reply(mode === 'replicas-400' ? 400 : 404);
    }
    return reply(200, {});
  });
  return { fetch, sessions };
}
describe('opt-in session resilience', () => {
  it('checks all four behaviors, bounds the burst and cleans up its sessions', async () => {
    const server = mockServer();
    const results = await checkSessionResilience({ endpoint: 'https://example.com/mcp?token=secret', fetch: server.fetch, headers: { Authorization: 'Bearer private' } });
    expect(results.map(result => result.outcome)).toEqual(['pass', 'pass', 'pass', 'pass']);
    expect(results[2].evidence).toHaveLength(12);
    expect(results[2].explanation).toContain('0/12');
    expect(server.sessions.size).toBe(0);
    expect(server.fetch.mock.calls.length).toBeLessThanOrEqual(22);
    expect(JSON.stringify(results)).not.toMatch(/secret|private|session-1|session-2/);
  });
  it('fails HTTP 400 instead of 404 and does not claim recovery after 404', async () => {
    const results = await checkSessionResilience({ endpoint: 'https://example.com/mcp', fetch: mockServer('bad-status').fetch });
    expect(results[0].outcome).toBe('fail');
    expect(results[1].status).toBe('not-checked');
  });
  it.each(
    ['unknown-id', 'reinitialize', 'stickiness', 'delete'].flatMap(phase =>
      [401, 403, 429].map(status => ({ phase, status }))),
  )('does not report HTTP $status during $phase as a session failure', async ({ phase, status }) => {
    const server = mockServer();
    let initializes = 0;
    let intercepted = false;
    let deletedSession: string | null = null;
    const deletions: string[] = [];
    const fetch = vi.fn<typeof globalThis.fetch>(async (input, init) => {
      const body = init?.body ? JSON.parse(String(init.body)) : {};
      const session = new Headers(init?.headers).get('Mcp-Session-Id');
      if (body.method === 'initialize') initializes++;
      if (init?.method === 'DELETE') {
        deletedSession = session;
        deletions.push(session!);
      }
      const intercept = phase === 'reinitialize'
        ? body.method === 'initialize' && initializes === 2
        : body.method === 'ping' && (phase === 'unknown-id'
          ? !server.sessions.has(session!)
          : phase === 'stickiness' ? initializes === 2 : session === deletedSession);
      if (!intercepted && intercept) {
        intercepted = true;
        return new Response(null, { status });
      }
      return server.fetch(input, init);
    });
    const results = await checkSessionResilience({ endpoint: 'https://example.com/mcp', fetch });
    const result = results.find(item => item.id === `session.${phase}`)!;
    expect(intercepted).toBe(true);
    expect(result).toMatchObject({ status: 'not-checked', severity: 'info' });
    expect(result.outcome).toBeUndefined();
    expect(result.notCheckedReason).toBeTruthy();
    expect(result.evidence.some(item => item.status === status)).toBe(true);
    expect(detectedTransportDiagnostics(results)).toEqual([]);
    expect(results.map(transportDiagnosticPriority)).toEqual([undefined, undefined, undefined, undefined]);
    expect(server.sessions.size).toBe(0);
    if (phase === 'unknown-id' || phase === 'reinitialize') {
      expect(results.slice(phase === 'unknown-id' ? 0 : 1).every(item => item.status === 'not-checked')).toBe(true);
      expect(initializes).toBe(phase === 'unknown-id' ? 1 : 2);
      expect(fetch.mock.calls.filter(([, init]) => init?.method !== 'DELETE')).toHaveLength(phase === 'unknown-id' ? 3 : 4);
    }
    if (phase === 'delete') {
      // A blocked verification cannot discharge cleanup ownership of the fresh id.
      expect(deletions.filter(session => session === 'session-2')).toHaveLength(2);
    }
  });
  it.each(['reinitialize', 'delete'])('does not report an unavailable %s response as a session failure', async phase => {
    const server = mockServer();
    let initializes = 0;
    let deleted = false;
    const fetch: typeof globalThis.fetch = async (input, init) => {
      const body = init?.body ? JSON.parse(String(init.body)) : {};
      if (body.method === 'initialize') initializes++;
      if (init?.method === 'DELETE') deleted = true;
      if (phase === 'reinitialize' ? body.method === 'initialize' && initializes === 2 : body.method === 'ping' && deleted) {
        throw new TypeError('Network unavailable');
      }
      return server.fetch(input, init);
    };
    const results = await checkSessionResilience({ endpoint: 'https://example.com/mcp', fetch });
    expect(results.find(item => item.id === `session.${phase}`)).toMatchObject({ status: 'not-checked', severity: 'info', outcome: undefined });
    expect(detectedTransportDiagnostics(results)).toEqual([]);
    expect(server.sessions.size).toBe(0);
  });
  it('checks cancellation after awaiting the unknown-id response', async () => {
    const server = mockServer('bad-status');
    const controller = new AbortController();
    const fetch: typeof globalThis.fetch = async (input, init) => {
      const response = await server.fetch(input, init);
      if (response.status === 400) controller.abort();
      return response;
    };
    const results = await checkSessionResilience({ endpoint: 'https://example.com/mcp', fetch, signal: controller.signal });
    expect(results.every(item => item.status === 'not-checked' && item.outcome === undefined)).toBe(true);
    expect(results[0].notCheckedReason).toContain('cancellation');
  });
  it.each(['replicas', 'replicas-400'])('reports replica loss ratio for %s', async (mode) => {
    const results = await checkSessionResilience({ endpoint: 'https://example.com/mcp', fetch: mockServer(mode).fetch });
    expect(results[2].outcome).toBe('fail');
    expect(results[2].explanation).toContain('6/12');
    expect(results[2].explanation).toContain('50%');
  });
  it('does not attribute an unrelated 400 to session loss', async () => {
    const results = await checkSessionResilience({ endpoint: 'https://example.com/mcp', fetch: mockServer('unrelated-400').fetch });
    expect(results[2].status).toBe('not-checked');
    expect(results[2].explanation).toContain('0/12 session rejections');
  });
  it('passes stateless servers without running session-id probes', async () => {
    const server = mockServer('stateless');
    const results = await checkSessionResilience({ endpoint: 'https://example.com/mcp', fetch: server.fetch });
    expect(results.every(result => result.outcome === 'pass' && result.explanation.includes('Not applicable: stateless'))).toBe(true);
    expect(server.fetch).toHaveBeenCalledTimes(3);
    server.fetch.mockClear();
    await checkSessionResilience({ endpoint: 'https://example.com/mcp', fetch: server.fetch, stateless: true });
    expect(server.fetch).not.toHaveBeenCalled();
  });
  it.each([['no-delete', 'warning'], ['broken-delete', 'fail']])('handles DELETE mode %s as %s', async (mode, outcome) => {
    const results = await checkSessionResilience({ endpoint: 'https://example.com/mcp', fetch: mockServer(mode).fetch });
    expect(results[3].outcome).toBe(outcome);
  });
  it('fails recovery when initialize reuses the original session id', async () => {
    const results = await checkSessionResilience({ endpoint: 'https://example.com/mcp', fetch: mockServer('reused-id').fetch });
    expect(results[1].outcome).toBe('fail');
    expect(results.slice(2).every(result => result.status === 'not-checked')).toBe(true);
  });
  it('bounds a hanging request and omits the fetch error and credentials', async () => {
    const fetch: typeof globalThis.fetch = async (_input, init) => new Promise<Response>((_resolve, reject) => {
      init?.signal?.addEventListener('abort', () => reject(new Error('Bearer private')), { once: true });
    });
    const results = await checkSessionResilience({ endpoint: 'https://example.com/mcp', fetch, timeoutMs: 10 });
    expect(results.every(result => result.status === 'not-checked')).toBe(true);
    expect(JSON.stringify(results)).not.toContain('private');
  });
  it('does not misattribute proxy responses to the target', async () => {
    const results = await checkSessionResilience({ endpoint: 'https://example.com/mcp', route: 'proxy', fetch: mockServer().fetch });
    expect(results.every(result => result.status === 'not-checked')).toBe(true);
  });
  it('does not classify unreadable session headers as stateless', async () => {
    const results = await checkSessionResilience({ endpoint: 'https://example.com/mcp', fetch: vi.fn(async (_input, init) => {
      const body = JSON.parse(String(init?.body));
      return new Response(JSON.stringify({ id: body.id, ...(body.method === 'initialize' ? { result: { protocolVersion: '2025-11-25' } } : { error: {} }) }), { status: body.method === 'initialize' ? 200 : 400 });
    }) });
    expect(results.every(result => result.status === 'not-checked')).toBe(true);
  });
  it('parses an SSE response without waiting for the stream to close', async () => {
    const server = mockServer();
    const fetch: typeof globalThis.fetch = async (input, init) => {
      const response = await server.fetch(input, init);
      if (response.status !== 200) return response;
      const json = await response.text();
      const headers = new Headers(response.headers);
      headers.set('Content-Type', 'text/event-stream');
      return new Response(new ReadableStream({ start(controller) { controller.enqueue(new TextEncoder().encode(`data: ${json}\n\n`)); } }), { status: 200, headers });
    };
    const results = await checkSessionResilience({ endpoint: 'https://example.com/mcp', fetch });
    expect(results.every(result => result.outcome === 'pass')).toBe(true);
  });
  it('keeps proxy login and target auth on separate channels', async () => {
    const fetch = vi.fn(async () => new Response(null, { status: 204 }));
    vi.stubGlobal('fetch', fetch);
    try {
      const adapter = sessionResilienceConnection({ endpoint: 'https://target.test/mcp', proxyUrl: 'https://proxy.test/', firebaseToken: 'login', headers: { Authorization: 'Bearer target', 'X-API-Key': 'key' } });
      await adapter.fetch(adapter.endpoint, { headers: { Accept: 'application/json' } });
      const [url, init] = fetch.mock.calls[0] as unknown as [string, RequestInit];
      expect(new URL(url).searchParams.get('target')).toBe('https://target.test/mcp');
      const headers = new Headers(init.headers);
      expect(headers.get('Authorization')).toBe('Bearer login');
      expect(headers.get('X-MCP-Authorization')).toBe('Bearer target');
      expect(headers.get('X-API-Key')).toBe('key');
      expect(init.redirect).toBe('error');
    } finally { vi.unstubAllGlobals(); }
  });
});
