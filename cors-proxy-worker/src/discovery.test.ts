import { describe, expect, it, vi } from 'vitest';
import proxyWorker, { discoveryRouteDependencies, type Env, type RateLimiter } from './index';
import {
  DISCOVERY_FINAL_URL_HEADER,
  DISCOVERY_MAX_RESPONSE_BYTES,
  handleDiscoveryRequest,
  isAllowedDiscoveryTarget,
  type DiscoveryRouteDependencies,
} from './discovery';

const WORKER = 'https://proxy.example.workers.dev';
const routeUrl = (target: string) => `${WORKER}/discovery?target=${encodeURIComponent(target)}`;
const isForbidden = (hostname: string) => hostname === 'localhost' || hostname.startsWith('10.') || hostname === '127.0.0.1';

const dependencies = (fetchImpl: typeof fetch, overrides: Partial<DiscoveryRouteDependencies> = {}): DiscoveryRouteDependencies => ({
  isForbiddenHostname: isForbidden,
  admitCaller: async () => ({ admitted: true }),
  fetchImpl,
  ...overrides,
});

const json = (body: unknown, init: ResponseInit = {}) => new Response(JSON.stringify(body), {
  ...init,
  headers: { 'Content-Type': 'application/json', ...(init.headers as Record<string, string> | undefined) },
});

describe('isAllowedDiscoveryTarget', () => {
  it.each([
    'https://example.com/.well-known/mcp/server-card.json',
    'https://example.com/.well-known/mcp/server-cards.json',
    'https://example.com/.well-known/mcp-server-card',
    'https://example.com/.well-known/mcp.json',
    'https://example.com/.well-known/ai-catalog.json',
    'https://example.com/.well-known/oauth-protected-resource',
    'https://example.com/.well-known/oauth-protected-resource/v1/mcp',
    'https://auth.example.com/.well-known/oauth-authorization-server/tenant',
    'https://auth.example.com/.well-known/openid-configuration',
    'https://auth.example.com/tenant/.well-known/openid-configuration',
    'https://example.com/mcp/server-card',
    'https://registry.modelcontextprotocol.io/v0.1/servers?search=com.example&version=latest&limit=100',
    'https://registry.modelcontextprotocol.io/v0/servers?cursor=abc',
  ])('allows %s', target => {
    expect(isAllowedDiscoveryTarget(new URL(target), isForbidden)).toBe(true);
  });

  it.each([
    'http://example.com/.well-known/mcp.json',
    'https://example.com:8443/.well-known/mcp.json',
    'https://user:pass@example.com/.well-known/mcp.json',
    'https://localhost/.well-known/mcp.json',
    'https://10.0.0.1/.well-known/oauth-protected-resource',
    'https://example.com/',
    'https://example.com/mcp',
    'https://example.com/api/users',
    'https://example.com/server-card',
    'https://example.com/.well-known/mcp.json?redirect=https://evil.test',
    'https://example.com/.well-known/oauth-protected-resource/../../admin',
    'https://example.com/.well-known/oauth-protected-resourcex',
    'https://example.com/a%2Fb/server-card',
    'https://example.com/.well-known/change-password',
    'https://registry.modelcontextprotocol.io/v0.1/publish',
    'https://registry.modelcontextprotocol.io/v0.1/servers?search=x&token=y',
  ])('refuses %s', target => {
    expect(isAllowedDiscoveryTarget(new URL(target), isForbidden)).toBe(false);
  });
});

describe('handleDiscoveryRequest', () => {
  it('GETs an allowed document with only Accept, MCP-Protocol-Version and a User-Agent', async () => {
    const fetchImpl = vi.fn(async (_input: RequestInfo | URL, _init?: RequestInit) => json({ name: 'com.example/x' }, {
      headers: { 'Content-Type': 'application/mcp-server-card+json', 'Set-Cookie': 'session=1', 'X-Internal': 'secret' },
    }));
    const target = 'https://example.com/mcp/server-card';
    const response = await handleDiscoveryRequest(new Request(routeUrl(target), {
      headers: {
        Accept: 'application/mcp-server-card+json',
        'MCP-Protocol-Version': '2026-07-28',
        Authorization: 'Bearer firebase-token',
        Cookie: 'a=b',
        'X-MCP-Authorization': 'Bearer target-token',
      },
    }), dependencies(fetchImpl as unknown as typeof fetch));

    expect(response.status).toBe(200);
    expect(await response.json()).toEqual({ name: 'com.example/x' });
    expect(response.headers.get('Content-Type')).toBe('application/mcp-server-card+json');
    expect(response.headers.get('Access-Control-Allow-Origin')).toBe('*');
    expect(response.headers.get('X-MCP-Proxy-Response-Source')).toBe('target');
    expect(response.headers.get(DISCOVERY_FINAL_URL_HEADER)).toBe(target);
    expect(response.headers.get('Set-Cookie')).toBeNull();
    expect(response.headers.get('X-Internal')).toBeNull();

    const [url, init] = fetchImpl.mock.calls[0];
    expect(url).toBe(target);
    expect(init?.method).toBe('GET');
    expect(init?.redirect).toBe('manual');
    expect([...new Headers(init?.headers).keys()].sort()).toEqual(['accept', 'mcp-protocol-version', 'user-agent']);
  });

  it('refuses other targets and methods before contacting anything', async () => {
    const fetchImpl = vi.fn();
    const admitCaller = vi.fn(async () => ({ admitted: true as const }));
    const deps = dependencies(fetchImpl as unknown as typeof fetch, { admitCaller });

    const refused = await handleDiscoveryRequest(new Request(routeUrl('https://example.com/admin')), deps);
    expect(refused.status).toBe(403);
    expect(await refused.json()).toMatchObject({ error: 'target_not_allowed' });
    expect(refused.headers.get('X-MCP-Proxy-Response-Source')).toBe('proxy');

    const post = await handleDiscoveryRequest(new Request(routeUrl('https://example.com/.well-known/mcp.json'), { method: 'POST', body: '{}' }), deps);
    expect(post.status).toBe(405);
    const missing = await handleDiscoveryRequest(new Request(`${WORKER}/discovery`), deps);
    expect(missing.status).toBe(400);

    expect(fetchImpl).not.toHaveBeenCalled();
    expect(admitCaller).not.toHaveBeenCalled();
  });

  it('answers the preflight for the headers the checker sends', async () => {
    const response = await handleDiscoveryRequest(new Request(routeUrl('https://example.com/.well-known/mcp.json'), { method: 'OPTIONS' }), dependencies(vi.fn() as unknown as typeof fetch));
    expect(response.status).toBe(204);
    expect(response.headers.get('Access-Control-Allow-Methods')).toBe('GET, OPTIONS');
    expect(response.headers.get('Access-Control-Allow-Headers')).toBe('Accept, Authorization, MCP-Protocol-Version');
  });

  it('follows redirects only to other discovery locations', async () => {
    const fetchImpl = vi.fn(async (input: RequestInfo | URL) => {
      const url = String(input);
      if (url === 'https://example.com/.well-known/mcp.json') return new Response(null, { status: 301, headers: { Location: 'https://www.example.com/.well-known/mcp.json' } });
      if (url === 'https://www.example.com/.well-known/mcp.json') return json({ ok: true });
      if (url === 'https://example.com/.well-known/ai-catalog.json') return new Response(null, { status: 302, headers: { Location: 'https://example.com/login' } });
      if (url === 'https://example.com/.well-known/oauth-protected-resource') return new Response(null, { status: 307, headers: { Location: 'https://localhost/.well-known/oauth-protected-resource' } });
      return new Response('nope', { status: 404 });
    });
    const deps = dependencies(fetchImpl as unknown as typeof fetch);

    const followed = await handleDiscoveryRequest(new Request(routeUrl('https://example.com/.well-known/mcp.json')), deps);
    expect(followed.status).toBe(200);
    expect(followed.headers.get(DISCOVERY_FINAL_URL_HEADER)).toBe('https://www.example.com/.well-known/mcp.json');

    const login = await handleDiscoveryRequest(new Request(routeUrl('https://example.com/.well-known/ai-catalog.json')), deps);
    expect(login.status).toBe(403);
    const privateHost = await handleDiscoveryRequest(new Request(routeUrl('https://example.com/.well-known/oauth-protected-resource')), deps);
    expect(privateHost.status).toBe(403);
    expect(fetchImpl.mock.calls.map(([url]) => String(url))).not.toContain('https://localhost/.well-known/oauth-protected-resource');
  });

  it('stops after three redirects', async () => {
    let hop = 0;
    const fetchImpl = vi.fn(async () => new Response(null, { status: 302, headers: { Location: `https://example.com/${hop++}/server-card` } }));
    const response = await handleDiscoveryRequest(new Request(routeUrl('https://example.com/mcp/server-card')), dependencies(fetchImpl as unknown as typeof fetch));
    expect(response.status).toBe(502);
    expect(await response.json()).toMatchObject({ error: 'too_many_redirects' });
    expect(fetchImpl).toHaveBeenCalledTimes(4);
  });

  it('caps the response size and the upstream time', async () => {
    const big = vi.fn(async () => new Response('x'.repeat(DISCOVERY_MAX_RESPONSE_BYTES + 1)));
    const tooLarge = await handleDiscoveryRequest(new Request(routeUrl('https://example.com/.well-known/mcp.json')), dependencies(big as unknown as typeof fetch));
    expect(tooLarge.status).toBe(502);
    expect(await tooLarge.json()).toMatchObject({ error: 'too_large' });

    const hanging = vi.fn((_input: RequestInfo | URL, init?: RequestInit) => new Promise<Response>((_resolve, reject) => {
      init?.signal?.addEventListener('abort', () => reject(new DOMException('Aborted', 'AbortError')));
    }));
    const timedOut = await handleDiscoveryRequest(
      new Request(routeUrl('https://example.com/.well-known/mcp.json')),
      dependencies(hanging as unknown as typeof fetch, { timeoutMs: 10 })
    );
    expect(timedOut.status).toBe(504);
    expect(await timedOut.json()).toMatchObject({ error: 'timeout' });
  });

  it('passes target statuses through, so a missing document reads as a 404', async () => {
    const fetchImpl = vi.fn(async () => new Response('Not found', { status: 404, headers: { 'Content-Type': 'text/plain' } }));
    const response = await handleDiscoveryRequest(new Request(routeUrl('https://example.com/.well-known/mcp.json')), dependencies(fetchImpl as unknown as typeof fetch));
    expect(response.status).toBe(404);
    expect(response.headers.get('X-MCP-Proxy-Response-Source')).toBe('target');
    expect(await response.text()).toBe('Not found');
  });
});

describe('the worker dispatch', () => {
  const rateLimiter = (success: boolean) => ({ limit: vi.fn(async () => ({ success })) }) satisfies RateLimiter;

  it('routes /discovery to the discovery handler with the anonymous caller limit', async () => {
    const env: Env = { FIREBASE_PROJECT_ID: 'test', ANON_RATE_LIMITER: rateLimiter(false) };
    const response = await proxyWorker.fetch(new Request(routeUrl('https://example.com/.well-known/mcp.json'), {
      headers: { 'CF-Connecting-IP': '203.0.113.9' },
    }), env);
    expect(response.status).toBe(429);
    expect(response.headers.get('X-MCP-Proxy-Limit')).toBe('anonymous');
    expect(env.ANON_RATE_LIMITER?.limit).toHaveBeenCalledWith({ key: 'ip:203.0.113.9' });

    const refused = await proxyWorker.fetch(new Request(routeUrl('https://example.com/anything')), env);
    expect(refused.status).toBe(403);
  });

  it('uses the proxy private-network check and rejects an invalid sign-in token', async () => {
    const deps = discoveryRouteDependencies({ FIREBASE_PROJECT_ID: 'test' }, async () => null);
    expect(deps.isForbiddenHostname('192.168.1.1')).toBe(true);
    expect(deps.isForbiddenHostname('example.com')).toBe(false);
    const admission = await deps.admitCaller(new Request(routeUrl('https://example.com/.well-known/mcp.json'), { headers: { Authorization: 'Bearer bad' } }));
    expect(admission.admitted).toBe(false);
    expect('response' in admission && admission.response.status).toBe(401);
  });
});
