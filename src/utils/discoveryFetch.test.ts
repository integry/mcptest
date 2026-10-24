import { describe, expect, it, vi } from 'vitest';
import { createDiscoveryFetch } from './discoveryFetch';
import { DiscoveryFetchError } from './mcpDiscovery';

const PROXY = 'https://proxy.example.workers.dev';
const TARGET = 'https://example.com/.well-known/mcp/server-card.json';

const corsBlocked = () => Promise.reject(new TypeError('Failed to fetch'));

describe('createDiscoveryFetch', () => {
  it('reads the document directly with only the Accept header', async () => {
    const fetchImpl = vi.fn(async (_input: RequestInfo | URL, _init?: RequestInit) => new Response('{"ok":true}', {
      status: 200,
      headers: { 'Content-Type': 'application/json' },
    }));
    const fetchDocument = createDiscoveryFetch({ proxyUrl: PROXY, fetchImpl });
    const response = await fetchDocument(TARGET, { accept: 'application/mcp-server-card+json', headers: { 'MCP-Protocol-Version': '2026-07-28' } });

    expect(response).toEqual({ url: TARGET, status: 200, contentType: 'application/json', body: '{"ok":true}', route: 'direct' });
    expect(fetchImpl).toHaveBeenCalledTimes(1);
    const [url, init] = fetchImpl.mock.calls[0];
    expect(url).toBe(TARGET);
    expect(init).toMatchObject({ method: 'GET', credentials: 'omit', headers: { Accept: 'application/mcp-server-card+json' } });
  });

  it('falls back to the discovery route when the browser cannot read the URL', async () => {
    const fetchImpl = vi.fn(async (input: RequestInfo | URL, _init?: RequestInit) => {
      if (String(input) === TARGET) return corsBlocked();
      return new Response('{"name":"x"}', {
        status: 200,
        headers: {
          'Content-Type': 'application/mcp-server-card+json',
          'X-MCP-Proxy-Response-Source': 'target',
          'X-MCP-Discovery-Final-Url': 'https://www.example.com/.well-known/mcp/server-card.json',
        },
      });
    });
    const response = await createDiscoveryFetch({ proxyUrl: `${PROXY}/`, fetchImpl })(TARGET, { headers: { 'MCP-Protocol-Version': '2026-07-28' } });

    expect(response).toMatchObject({ route: 'proxy', status: 200, url: 'https://www.example.com/.well-known/mcp/server-card.json' });
    const [url, init] = fetchImpl.mock.calls[1];
    expect(url).toBe(`${PROXY}/discovery?target=${encodeURIComponent(TARGET)}`);
    expect(init?.headers).toEqual({ Accept: 'application/json', 'MCP-Protocol-Version': '2026-07-28' });
  });

  it.each([
    [403, 'target_not_allowed', 'not-allowed'],
    [429, 'rate_limited', 'proxy-limit'],
    [504, 'timeout', 'timeout'],
    [502, 'too_large', 'too-large'],
    [502, 'upstream_unreachable', 'network'],
  ])('maps a proxy refusal (HTTP %i %s) to %s', async (status, error, kind) => {
    const fetchImpl = vi.fn(async (input: RequestInfo | URL) => (String(input) === TARGET
      ? corsBlocked()
      : new Response(JSON.stringify({ error, message: `proxy said ${error}` }), {
        status,
        headers: { 'Content-Type': 'application/json', 'X-MCP-Proxy-Response-Source': 'proxy' },
      })));
    const failure = await createDiscoveryFetch({ proxyUrl: PROXY, fetchImpl })(TARGET).catch(caught => caught);
    expect(failure).toBeInstanceOf(DiscoveryFetchError);
    expect(failure).toMatchObject({ kind, route: 'proxy', message: `proxy said ${error}` });
  });

  it('reports a CORS failure without a proxy, and never proxies loopback hosts', async () => {
    const fetchImpl = vi.fn(corsBlocked);
    await expect(createDiscoveryFetch({ fetchImpl })(TARGET)).rejects.toMatchObject({ kind: 'cors', route: 'direct' });
    await expect(createDiscoveryFetch({ proxyUrl: PROXY, fetchImpl })('http://127.0.0.1:4181/.well-known/mcp.json'))
      .rejects.toMatchObject({ kind: 'cors' });
    expect(fetchImpl).toHaveBeenCalledTimes(2);
  });

  it('caps the response size, declared or streamed', async () => {
    const declared = vi.fn(async () => new Response('x', { headers: { 'Content-Length': '2048' } }));
    await expect(createDiscoveryFetch({ fetchImpl: declared, maxBytes: 1024 })(TARGET)).rejects.toMatchObject({ kind: 'too-large' });
    const streamed = vi.fn(async () => new Response('y'.repeat(2048)));
    await expect(createDiscoveryFetch({ fetchImpl: streamed, maxBytes: 1024 })(TARGET)).rejects.toMatchObject({ kind: 'too-large' });
  });

  it('times out', async () => {
    const fetchImpl = vi.fn((_input: RequestInfo | URL, init?: RequestInit) => new Promise<Response>((_resolve, reject) => {
      init?.signal?.addEventListener('abort', () => reject(new DOMException('Aborted', 'AbortError')));
    }));
    await expect(createDiscoveryFetch({ fetchImpl, timeoutMs: 10 })(TARGET)).rejects.toMatchObject({ kind: 'timeout', route: 'direct' });
  });
});
