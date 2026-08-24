import { createServer } from 'node:http';
import { readFileSync } from 'node:fs';
import { URL as NodeURL } from 'node:url';
import { describe, expect, it, vi } from 'vitest';
import proxyWorker, {
  HostedOAuthBroker,
  PROXY_RESPONSE_SOURCE_HEADER,
  fetchTargetRequest,
  getOperatorOAuthClient,
  getTargetRequestHeaders,
  handleOAuthRegistrationRequest,
  handleOAuthTokenRequest,
  withCorsResponseHeaders,
} from './index';

interface CorsRequest {
  getResponseHeader(name: string): string | null;
  onerror: (() => void) | null;
  onload: (() => void) | null;
  open(method: string, url: string): void;
  send(): void;
}

const CorsXmlHttpRequest = (globalThis as unknown as {
  XMLHttpRequest: new () => CorsRequest;
}).XMLHttpRequest;

const readProvenanceThroughCors = (url: string): Promise<string | null> => (
  new Promise((resolve, reject) => {
    const request = new CorsXmlHttpRequest();
    request.open('GET', url);
    request.onload = () => resolve(request.getResponseHeader(PROXY_RESPONSE_SOURCE_HEADER));
    request.onerror = () => reject(new Error(`Cross-origin request failed for ${url}`));
    request.send();
  })
);

describe('proxy target credential forwarding', () => {
  it('retains the registered hosted OAuth Durable Object export', async () => {
    const response = await new HostedOAuthBroker().fetch();

    expect(response.status).toBe(503);
    expect(response.headers.get('cache-control')).toBe('no-store');
  });

  it('resolves confidential provider clients only from server bindings', () => {
    const env = {
      FIREBASE_PROJECT_ID: 'test-project',
      SLACK_OAUTH_CLIENT_ID: 'slack-client',
      SLACK_OAUTH_CLIENT_SECRET: 'slack-secret',
    };

    expect(getOperatorOAuthClient(env, 'slack')).toEqual({
      clientId: 'slack-client',
      clientSecret: 'slack-secret',
    });
    expect(getOperatorOAuthClient(env, 'github')).toBeUndefined();
  });
  it('replaces proxy authorization with the isolated target credential', () => {
    const headers = getTargetRequestHeaders({
      Authorization: 'Bearer firebase-jwt',
      'X-MCP-Authorization': 'Bearer target-token',
      'X-MCP-OAuth-Client-Authorization': 'Basic dynamic-secret',
      'X-MCP-OAuth-Issuer': 'https://issuer.example',
      'X-MCP-OAuth-Registration-Endpoint': 'https://issuer.example/register',
      'X-MCP-OAuth-Token-Endpoint': 'https://issuer.example/token',
      'x-api-key': 'target-api-key',
      'CF-Connecting-IP': '192.0.2.1',
    });

    expect(headers.get('authorization')).toBe('Bearer target-token');
    expect(headers.get('x-mcp-authorization')).toBeNull();
    expect(headers.get('x-mcp-oauth-client-authorization')).toBeNull();
    expect(headers.get('x-mcp-oauth-issuer')).toBeNull();
    expect(headers.get('x-mcp-oauth-registration-endpoint')).toBeNull();
    expect(headers.get('x-mcp-oauth-token-endpoint')).toBeNull();
    expect(headers.get('x-api-key')).toBe('target-api-key');
    expect(headers.get('cf-connecting-ip')).toBeNull();
  });

  it('strips browser context while preserving MCP and user target headers', () => {
    const headers = getTargetRequestHeaders({
      Origin: 'https://mcptest.io',
      Referer: 'https://mcptest.io/',
      'Sec-Fetch-Site': 'cross-site',
      'SEC-FETCH-MODE': 'cors',
      'Sec-Fetch-Dest': 'empty',
      'Sec-Fetch-User': '?1',
      'Sec-CH-UA': '"Chromium";v="140"',
      'sec-ch-ua-platform': '"Linux"',
      Priority: 'u=1, i',
      Authorization: 'Bearer firebase-jwt',
      'X-MCP-Authorization': 'Bearer target-token',
      Accept: 'application/json, text/event-stream',
      'Content-Type': 'application/json',
      'MCP-Protocol-Version': '2025-11-25',
      'MCP-Session-Id': 'session-1',
      'Last-Event-ID': 'event-9',
      'X-Tenant-API-Key': 'target-api-key',
    });

    for (const name of [
      'origin',
      'referer',
      'sec-fetch-site',
      'sec-fetch-mode',
      'sec-fetch-dest',
      'sec-fetch-user',
      'sec-ch-ua',
      'sec-ch-ua-platform',
      'priority',
      'x-mcp-authorization',
    ]) {
      expect(headers.get(name), name).toBeNull();
    }
    expect(headers.get('authorization')).toBe('Bearer target-token');
    expect(headers.get('accept')).toBe('application/json, text/event-stream');
    expect(headers.get('content-type')).toBe('application/json');
    expect(headers.get('mcp-protocol-version')).toBe('2025-11-25');
    expect(headers.get('mcp-session-id')).toBe('session-1');
    expect(headers.get('last-event-id')).toBe('event-9');
    expect(headers.get('x-tenant-api-key')).toBe('target-api-key');
  });

  it('never forwards Firebase authorization when no target credential exists', () => {
    const headers = getTargetRequestHeaders({ Authorization: 'Bearer firebase-jwt' });

    expect(headers.get('authorization')).toBeNull();
  });

  it('preserves target credentials across same-origin redirects', async () => {
    const requests: Request[] = [];
    const fetch = async (request: Request) => {
      requests.push(request);
      if (requests.length === 1) {
        return new Response(null, {
          status: 307,
          headers: { Location: '/mcp/' },
        });
      }
      return new Response('connected');
    };

    const response = await fetchTargetRequest(new Request('https://example.com/mcp', {
      headers: {
        Authorization: 'Bearer target-token',
        'x-api-key': 'target-api-key',
      },
      redirect: 'manual',
    }), fetch);

    expect(await response.text()).toBe('connected');
    expect(requests.map(({ url }) => url)).toEqual([
      'https://example.com/mcp',
      'https://example.com/mcp/',
    ]);
    expect(requests[1].headers.get('authorization')).toBe('Bearer target-token');
    expect(requests[1].headers.get('x-api-key')).toBe('target-api-key');
  });

  it.each([
    ['POST', 'application/json, text/event-stream'],
    ['GET', 'text/event-stream'],
  ])('sanitizes the final %s target hop without dropping MCP state', async (method, accept) => {
    const requests: Request[] = [];
    const response = await fetchTargetRequest(new Request('https://example.com/mcp', {
      method,
      headers: {
        Origin: 'https://mcptest.io',
        Referer: 'https://mcptest.io/',
        'Sec-Fetch-Site': 'cross-site',
        'Sec-Fetch-Mode': 'cors',
        'Sec-Fetch-Dest': 'empty',
        'Sec-Fetch-User': '?1',
        'Sec-CH-UA-Mobile': '?0',
        Priority: 'u=1',
        Accept: accept,
        'MCP-Protocol-Version': '2025-11-25',
        'MCP-Session-Id': 'session-1',
        'Last-Event-ID': 'event-9',
        'X-Tenant-API-Key': 'target-api-key',
      },
      ...(method === 'POST' ? { body: '{}' } : {}),
      redirect: 'manual',
    }), async request => {
      requests.push(request);
      return new Response('connected');
    });

    expect(await response.text()).toBe('connected');
    expect(requests).toHaveLength(1);
    expect([...requests[0].headers.keys()]).not.toEqual(expect.arrayContaining([
      'origin',
      'referer',
      'sec-fetch-site',
      'sec-fetch-mode',
      'sec-fetch-dest',
      'sec-fetch-user',
      'sec-ch-ua-mobile',
      'priority',
    ]));
    expect(requests[0].headers.get('accept')).toBe(accept);
    expect(requests[0].headers.get('mcp-protocol-version')).toBe('2025-11-25');
    expect(requests[0].headers.get('mcp-session-id')).toBe('session-1');
    expect(requests[0].headers.get('last-event-id')).toBe('event-9');
    expect(requests[0].headers.get('x-tenant-api-key')).toBe('target-api-key');
  });

  it('keeps the sanitized header set across same-origin redirects', async () => {
    const requests: Request[] = [];
    await fetchTargetRequest(new Request('https://example.com/mcp', {
      method: 'POST',
      headers: {
        Origin: 'https://mcptest.io',
        Referer: 'https://mcptest.io/',
        'Sec-Fetch-Mode': 'cors',
        'Sec-CH-UA-Platform': '"Linux"',
        Priority: 'u=1',
        Authorization: 'Bearer target-token',
        'MCP-Session-Id': 'session-1',
        'X-Tenant-API-Key': 'target-api-key',
      },
      body: '{}',
      redirect: 'manual',
    }), async request => {
      requests.push(request);
      return requests.length === 1
        ? new Response(null, { status: 307, headers: { Location: '/mcp/' } })
        : new Response('connected');
    });

    expect(requests).toHaveLength(2);
    for (const request of requests) {
      expect(request.headers.get('origin')).toBeNull();
      expect(request.headers.get('referer')).toBeNull();
      expect(request.headers.get('sec-fetch-mode')).toBeNull();
      expect(request.headers.get('sec-ch-ua-platform')).toBeNull();
      expect(request.headers.get('priority')).toBeNull();
      expect(request.headers.get('authorization')).toBe('Bearer target-token');
      expect(request.headers.get('mcp-session-id')).toBe('session-1');
      expect(request.headers.get('x-tenant-api-key')).toBe('target-api-key');
    }
  });

  it('passes through a Cloudflare-like OAuth challenge once Origin is absent', async () => {
    const response = await fetchTargetRequest(new Request('https://mcp.cloudflare.com/mcp', {
      method: 'POST',
      headers: {
        Origin: 'https://mcptest.io',
        Accept: 'application/json, text/event-stream',
        'Content-Type': 'application/json',
      },
      body: '{}',
      redirect: 'manual',
    }), async request => request.headers.has('origin')
      ? new Response(JSON.stringify({
          jsonrpc: '2.0',
          error: { code: -32000, message: 'Invalid Origin: mcptest.io' },
          id: null,
        }), { status: 403, headers: { 'Content-Type': 'application/json' } })
      : new Response(null, {
          status: 401,
          headers: {
            'WWW-Authenticate': 'Bearer resource_metadata="https://mcp.cloudflare.com/.well-known/oauth-protected-resource/mcp"',
          },
        }));
    const proxiedResponse = withCorsResponseHeaders(response, 'target');

    expect(proxiedResponse.status).toBe(401);
    expect(proxiedResponse.headers.get('www-authenticate')).toContain(
      'https://mcp.cloudflare.com/.well-known/oauth-protected-resource/mcp'
    );
    expect(proxiedResponse.headers.get('access-control-expose-headers')?.toLowerCase())
      .toContain('www-authenticate');
    expect(proxiedResponse.headers.get(PROXY_RESPONSE_SOURCE_HEADER)).toBe('target');
  });

  it('rejects cross-origin redirects before forwarding target credentials', async () => {
    const requests: Request[] = [];
    const fetch = async (request: Request) => {
      requests.push(request);
      return new Response(null, {
        status: 307,
        headers: { Location: 'https://attacker.example/mcp' },
      });
    };

    await expect(fetchTargetRequest(new Request('https://example.com/mcp', {
      headers: {
        Authorization: 'Bearer target-token',
        'x-api-key': 'target-api-key',
      },
      redirect: 'manual',
    }), fetch)).rejects.toThrow('Cross-origin target redirects are not allowed');

    expect(requests).toHaveLength(1);
    expect(requests[0].url).toBe('https://example.com/mcp');
  });

  it('exposes upstream and proxy-error provenance to cross-origin browser code', async () => {
    const targetResponse = withCorsResponseHeaders(
      new Response('Target authentication required', { status: 401 }),
      'target'
    );
    const proxyResponse = await proxyWorker.fetch(
      new Request('https://proxy.mcptest.test/'),
      { FIREBASE_PROJECT_ID: 'test-project' }
    );

    const server = createServer(async (request, response) => {
      const workerResponse = request.url === '/target' ? targetResponse : proxyResponse;
      response.writeHead(workerResponse.status, Object.fromEntries(workerResponse.headers.entries()));
      response.end(await workerResponse.text());
    });
    await new Promise<void>(resolve => server.listen(0, '127.0.0.1', resolve));

    try {
      const address = server.address();
      if (!address || typeof address === 'string') throw new Error('Test server did not bind to TCP');
      const origin = `http://127.0.0.1:${address.port}`;

      expect(proxyResponse.status).toBe(400);
      await expect(readProvenanceThroughCors(`${origin}/target`)).resolves.toBe('target');
      await expect(readProvenanceThroughCors(`${origin}/proxy-error`)).resolves.toBe('proxy');
    } finally {
      await new Promise<void>((resolve, reject) => server.close(error => (
        error ? reject(error) : resolve()
      )));
    }
  });

  it('allows caller-provided custom target headers during preflight', async () => {
    const response = await proxyWorker.fetch(
      new Request('https://proxy.mcptest.test/', {
        method: 'OPTIONS',
        headers: {
          'Access-Control-Request-Headers': 'content-type, x-tenant-id, x-vendor-auth',
        },
      }),
      { FIREBASE_PROJECT_ID: 'test-project' }
    );
    const allowedHeaders = response.headers
      .get('access-control-allow-headers')
      ?.toLowerCase()
      .split(', ');

    expect(response.status).toBe(200);
    expect(allowedHeaders).toEqual(expect.arrayContaining([
      'authorization',
      'mcp-protocol-version',
      'x-mcp-authorization',
      'x-tenant-id',
      'x-vendor-auth',
    ]));
  });

  it.each([
    ['too many names', Array.from({ length: 65 }, (_, index) => `x-header-${index}`).join(',')],
    ['an oversized name', `x-${'a'.repeat(127)}`],
    ['an oversized value', `x-${'a'.repeat(2048)}`],
  ])('rejects %s in reflected preflight headers', async (_, requestedHeaders) => {
    const response = await proxyWorker.fetch(
      new Request('https://proxy.mcptest.test/', {
        method: 'OPTIONS',
        headers: { 'Access-Control-Request-Headers': requestedHeaders },
      }),
      { FIREBASE_PROJECT_ID: 'test-project' }
    );

    expect(response.status).toBe(400);
    expect(response.headers.get('vary')).toBe('Access-Control-Request-Headers');
  });
});

describe('hosted OAuth token route', () => {
  const issuer = 'https://auth.example.com/';
  const discoveryUrl = 'https://auth.example.com/.well-known/oauth-authorization-server';
  const tokenEndpoint = 'https://tokens.example.net/token';
  const formBody = [
    'grant_type=authorization_code',
    'code=single-use-code',
    'code_verifier=pkce-verifier',
    'redirect_uri=https%3A%2F%2Fmcptest.io%2Foauth%2Fcallback',
    'client_id=https%3A%2F%2Fmcptest.io%2Foauth%2Fclient-metadata.json',
    'resource=https%3A%2F%2Fmcp.example.com%2Fmcp',
  ].join('&');

  const tokenRequest = (
    body = formBody,
    tokenEndpointHeader = tokenEndpoint,
    issuerHeader = issuer
  ) => new Request(
    'https://proxy.mcptest.test/oauth/token',
    {
      method: 'POST',
      headers: {
        Origin: 'https://mcptest.io',
        Authorization: 'Bearer firebase-credential',
        'Content-Type': 'application/x-www-form-urlencoded',
        'X-MCP-OAuth-Issuer': issuerHeader,
        'X-MCP-OAuth-Token-Endpoint': tokenEndpointHeader,
      },
      body,
    }
  );

  it('uses the exact cross-domain token endpoint advertised by issuer metadata', async () => {
    const requests: Request[] = [];
    const fetchImpl = async (request: Request) => {
      requests.push(request);
      if (request.url === discoveryUrl) {
        return new Response(JSON.stringify({
          issuer,
          token_endpoint: tokenEndpoint,
          token_endpoint_auth_methods_supported: ['none'],
        }), { headers: { 'Content-Type': 'application/json' } });
      }
      if (request.url === tokenEndpoint) {
        expect(request.method).toBe('POST');
        expect(request.headers.get('authorization')).toBeNull();
        expect(await request.text()).toBe(formBody);
        return new Response(JSON.stringify({
          access_token: 'target-access-token',
          refresh_token: 'target-refresh-token',
          token_type: 'Bearer',
        }), { headers: { 'Content-Type': 'application/json' } });
      }
      return new Response('Not found', { status: 404 });
    };

    const response = await handleOAuthTokenRequest(
      tokenRequest(),
      { FIREBASE_PROJECT_ID: 'test-project' },
      {
        fetchImpl,
        verifyToken: async token => token === 'firebase-credential' ? 'user-1' : null,
      }
    );

    expect(response.status).toBe(200);
    expect(response.headers.get('cache-control')).toBe('no-store');
    expect(response.headers.get('access-control-allow-origin')).toBe('https://mcptest.io');
    expect(response.headers.get(PROXY_RESPONSE_SOURCE_HEADER)).toBe('target');
    expect(requests.filter(request => request.url === tokenEndpoint)).toHaveLength(1);
    expect(requests.map(request => request.url).join('\n')).not.toContain('single-use-code');
    await expect(response.json()).resolves.toMatchObject({ access_token: 'target-access-token' });
  });

  it.each([
    ['advertises client_secret_basic', ['client_secret_basic']],
    ['omits token endpoint authentication methods', undefined],
  ])('relays form-encoded opaque client IDs with dynamic Basic authentication when metadata %s', async (
    _,
    tokenEndpointAuthMethods
  ) => {
    const clientId = 'client id:percent%+&café';
    const clientSecret = 'dynamic secret';
    const encode = (value: string): string => (
      new URLSearchParams({ value }).toString().slice('value='.length)
    );
    const authorization = `Basic ${btoa(`${encode(clientId)}:${encode(clientSecret)}`)}`;
    const body = new URLSearchParams({
      grant_type: 'authorization_code',
      code: 'single-use-code',
      code_verifier: 'pkce-verifier',
      redirect_uri: 'https://mcptest.io/oauth/callback',
      client_id: clientId,
      resource: 'https://mcp.example.com/mcp',
    }).toString();
    const request = tokenRequest(body);
    request.headers.set('X-MCP-OAuth-Client-Authorization', authorization);
    const requests: Request[] = [];
    const fetchImpl = async (targetRequest: Request) => {
      requests.push(targetRequest);
      if (targetRequest.url === discoveryUrl) {
        return new Response(JSON.stringify({
          issuer,
          token_endpoint: tokenEndpoint,
          ...(tokenEndpointAuthMethods
            ? { token_endpoint_auth_methods_supported: tokenEndpointAuthMethods }
            : {}),
        }), { headers: { 'Content-Type': 'application/json' } });
      }
      expect(targetRequest.headers.get('authorization')).toBe(authorization);
      expect(new URLSearchParams(await targetRequest.text()).has('client_id')).toBe(false);
      return new Response(JSON.stringify({ access_token: 'dynamic-access-token' }), {
        headers: { 'Content-Type': 'application/json' },
      });
    };

    const response = await handleOAuthTokenRequest(
      request,
      { FIREBASE_PROJECT_ID: 'test-project' },
      { fetchImpl, verifyToken: async () => 'user-1' }
    );

    expect(response.status).toBe(200);
    expect(requests.map(targetRequest => targetRequest.url)).toEqual([
      discoveryUrl,
      tokenEndpoint,
    ]);
  });

  it('rejects mixed dynamic Basic and form client authentication before discovery', async () => {
    const body = new URLSearchParams({
      grant_type: 'authorization_code',
      code: 'single-use-code',
      code_verifier: 'pkce-verifier',
      redirect_uri: 'https://mcptest.io/oauth/callback',
      client_id: 'dynamic-client',
      client_secret: 'form-secret',
      resource: 'https://mcp.example.com/mcp',
    }).toString();
    const request = tokenRequest(body);
    request.headers.set(
      'X-MCP-OAuth-Client-Authorization',
      `Basic ${btoa('dynamic-client:basic-secret')}`
    );
    const fetchImpl = vi.fn();

    const response = await handleOAuthTokenRequest(
      request,
      { FIREBASE_PROJECT_ID: 'test-project' },
      { fetchImpl, verifyToken: async () => 'user-1' }
    );

    expect(response.status).toBe(502);
    expect(response.headers.get(PROXY_RESPONSE_SOURCE_HEADER)).toBe('proxy');
    expect(fetchImpl).not.toHaveBeenCalled();
  });

  it.each([
    ['client_secret_post', true],
    ['none', false],
  ])('rejects dynamic %s authentication when metadata omits the Basic-only default', async (
    _,
    includeSecret
  ) => {
    const params = new URLSearchParams(formBody);
    if (includeSecret) params.set('client_secret', 'dynamic-secret');
    const requests: Request[] = [];
    const fetchImpl = async (targetRequest: Request) => {
      requests.push(targetRequest);
      return new Response(JSON.stringify({
        issuer,
        token_endpoint: tokenEndpoint,
      }), { headers: { 'Content-Type': 'application/json' } });
    };

    const response = await handleOAuthTokenRequest(
      tokenRequest(params.toString()),
      { FIREBASE_PROJECT_ID: 'test-project' },
      { fetchImpl, verifyToken: async () => 'user-1' }
    );

    expect(response.status).toBe(502);
    expect(response.headers.get(PROXY_RESPONSE_SOURCE_HEADER)).toBe('proxy');
    expect(requests.map(targetRequest => targetRequest.url)).toEqual([discoveryUrl]);
  });

  it('relays Basic credentials at the registration length boundaries', async () => {
    const clientId = '\u0800'.repeat(2048);
    const clientSecret = '\u0800'.repeat(4096);
    const encode = (value: string): string => (
      new URLSearchParams({ value }).toString().slice('value='.length)
    );
    const authorization = `Basic ${btoa(`${encode(clientId)}:${encode(clientSecret)}`)}`;
    const body = new URLSearchParams({
      grant_type: 'authorization_code',
      code: 'single-use-code',
      code_verifier: 'pkce-verifier',
      redirect_uri: 'https://mcptest.io/oauth/callback',
      client_id: clientId,
      resource: 'https://mcp.example.com/mcp',
    }).toString();
    const request = tokenRequest(body);
    request.headers.set('X-MCP-OAuth-Client-Authorization', authorization);
    const requests: Request[] = [];
    const fetchImpl = async (targetRequest: Request) => {
      requests.push(targetRequest);
      if (targetRequest.url === discoveryUrl) {
        return new Response(JSON.stringify({
          issuer,
          token_endpoint: tokenEndpoint,
          token_endpoint_auth_methods_supported: ['client_secret_basic'],
        }), { headers: { 'Content-Type': 'application/json' } });
      }
      expect(targetRequest.headers.get('authorization')).toBe(authorization);
      expect(new URLSearchParams(await targetRequest.text()).has('client_secret')).toBe(false);
      return new Response(JSON.stringify({ access_token: 'boundary-access-token' }), {
        headers: { 'Content-Type': 'application/json' },
      });
    };

    const response = await handleOAuthTokenRequest(
      request,
      { FIREBASE_PROJECT_ID: 'test-project' },
      { fetchImpl, verifyToken: async () => 'user-1' }
    );

    expect(authorization).toHaveLength(73738);
    expect(response.status).toBe(200);
    expect(requests.map(targetRequest => targetRequest.url)).toEqual([
      discoveryUrl,
      tokenEndpoint,
    ]);
  });

  it('relays post credentials at the registration length boundaries', async () => {
    const clientId = '\u0800'.repeat(2048);
    const clientSecret = '\u0800'.repeat(4096);
    const body = new URLSearchParams({
      grant_type: 'authorization_code',
      code: 'single-use-code',
      code_verifier: 'pkce-verifier',
      redirect_uri: 'https://mcptest.io/oauth/callback',
      client_id: clientId,
      client_secret: clientSecret,
      resource: 'https://mcp.example.com/mcp',
    }).toString();
    const requests: Request[] = [];
    const fetchImpl = async (targetRequest: Request) => {
      requests.push(targetRequest);
      if (targetRequest.url === discoveryUrl) {
        return new Response(JSON.stringify({
          issuer,
          token_endpoint: tokenEndpoint,
          token_endpoint_auth_methods_supported: ['client_secret_post'],
        }), { headers: { 'Content-Type': 'application/json' } });
      }
      expect(targetRequest.headers.get('authorization')).toBeNull();
      expect(await targetRequest.text()).toBe(body);
      return new Response(JSON.stringify({ access_token: 'boundary-access-token' }), {
        headers: { 'Content-Type': 'application/json' },
      });
    };

    const response = await handleOAuthTokenRequest(
      tokenRequest(body),
      { FIREBASE_PROJECT_ID: 'test-project' },
      { fetchImpl, verifyToken: async () => 'user-1' }
    );

    expect(body.length).toBeGreaterThan(32 * 1024);
    expect(response.status).toBe(200);
    expect(requests.map(targetRequest => targetRequest.url)).toEqual([
      discoveryUrl,
      tokenEndpoint,
    ]);
  });

  it('rejects an oversized Basic secret even when the client ID is short', async () => {
    const clientId = 'short-client';
    const encode = (value: string): string => (
      new URLSearchParams({ value }).toString().slice('value='.length)
    );
    const authorization = `Basic ${btoa(`${encode(clientId)}:${encode('s'.repeat(4097))}`)}`;
    const body = new URLSearchParams({
      grant_type: 'authorization_code',
      code: 'single-use-code',
      code_verifier: 'pkce-verifier',
      redirect_uri: 'https://mcptest.io/oauth/callback',
      client_id: clientId,
      resource: 'https://mcp.example.com/mcp',
    }).toString();
    const request = tokenRequest(body);
    request.headers.set('X-MCP-OAuth-Client-Authorization', authorization);
    const requests: Request[] = [];
    const fetchImpl = async (targetRequest: Request) => {
      requests.push(targetRequest);
      return new Response(JSON.stringify({
        issuer,
        token_endpoint: tokenEndpoint,
        token_endpoint_auth_methods_supported: ['client_secret_basic'],
      }), { headers: { 'Content-Type': 'application/json' } });
    };

    const response = await handleOAuthTokenRequest(
      request,
      { FIREBASE_PROJECT_ID: 'test-project' },
      { fetchImpl, verifyToken: async () => 'user-1' }
    );

    expect(response.status).toBe(502);
    expect(response.headers.get(PROXY_RESPONSE_SOURCE_HEADER)).toBe('proxy');
    expect(requests.map(targetRequest => targetRequest.url)).toEqual([discoveryUrl]);
  });

  it('rejects an issuer/token-endpoint mismatch before a target token request', async () => {
    const requests: Request[] = [];
    const fetchImpl = async (request: Request) => {
      requests.push(request);
      return new Response(JSON.stringify({
        issuer,
        token_endpoint: tokenEndpoint,
        token_endpoint_auth_methods_supported: ['none'],
      }), { headers: { 'Content-Type': 'application/json' } });
    };

    const response = await handleOAuthTokenRequest(
      tokenRequest(formBody, 'https://attacker.example/token'),
      { FIREBASE_PROJECT_ID: 'test-project' },
      { fetchImpl, verifyToken: async () => 'user-1' }
    );

    expect(response.status).toBe(400);
    expect(response.headers.get(PROXY_RESPONSE_SOURCE_HEADER)).toBe('proxy');
    expect(requests).toHaveLength(1);
    expect(requests[0].url).toBe(discoveryUrl);
  });

  it.each([
    ['IPv4-mapped loopback IPv6', 'https://[::ffff:127.0.0.1]/'],
    ['IPv4-mapped link-local IPv6', 'https://[::ffff:169.254.169.254]/'],
    ['NAT64-mapped loopback IPv6', 'https://[64:ff9b::127.0.0.1]/'],
    ['unspecified IPv6', 'https://[::]/'],
    ['reserved IETF protocol assignment IPv6', 'https://[2001:100::1]/'],
    ['ORCHIDv2 IPv6', 'https://[2001:20::1]/'],
    ['reserved documentation IPv6', 'https://[2001:db8::1]/'],
    ['unallocated IPv6', 'https://[4000::1]/'],
    ['short IPv4 loopback', 'https://127.1/'],
    ['octal IPv4 loopback', 'https://0177.0.0.1/'],
    ['hexadecimal IPv4 loopback', 'https://0x7f000001/'],
    ['integer IPv4 loopback', 'https://2130706433/'],
    ['hexadecimal IPv4 link-local', 'https://0xa9fea9fe/'],
  ])('rejects a forbidden issuer before discovery: %s', async (_, forbiddenIssuer) => {
    const fetchImpl = vi.fn();

    const response = await handleOAuthTokenRequest(
      tokenRequest(formBody, tokenEndpoint, forbiddenIssuer),
      { FIREBASE_PROJECT_ID: 'test-project' },
      { fetchImpl, verifyToken: async () => 'user-1' }
    );

    expect(response.status).toBe(502);
    expect(response.headers.get(PROXY_RESPONSE_SOURCE_HEADER)).toBe('proxy');
    expect(fetchImpl).not.toHaveBeenCalled();
  });

  it.each([
    ['IPv4-mapped loopback IPv6', 'https://[::ffff:127.0.0.1]/token'],
    ['IPv4-mapped link-local IPv6', 'https://[::ffff:169.254.169.254]/token'],
    ['unspecified IPv6', 'https://[::]/token'],
    ['reserved IETF protocol assignment IPv6', 'https://[2001:100::1]/token'],
    ['reserved documentation IPv6', 'https://[2001:db8::1]/token'],
    ['unallocated IPv6', 'https://[4000::1]/token'],
    ['short IPv4 loopback', 'https://127.1/token'],
    ['octal IPv4 loopback', 'https://0177.0.0.1/token'],
    ['hexadecimal IPv4 link-local', 'https://0xa9fea9fe/token'],
  ])('rejects a forbidden advertised token endpoint before token fetch: %s', async (_, forbiddenEndpoint) => {
    const requests: Request[] = [];
    const fetchImpl = async (request: Request) => {
      requests.push(request);
      return new Response(JSON.stringify({
        issuer,
        token_endpoint: forbiddenEndpoint,
        token_endpoint_auth_methods_supported: ['none'],
      }), { headers: { 'Content-Type': 'application/json' } });
    };

    const response = await handleOAuthTokenRequest(
      tokenRequest(formBody, forbiddenEndpoint),
      { FIREBASE_PROJECT_ID: 'test-project' },
      { fetchImpl, verifyToken: async () => 'user-1' }
    );

    expect(response.status).toBe(502);
    expect(response.headers.get(PROXY_RESPONSE_SOURCE_HEADER)).toBe('proxy');
    expect(requests.map(request => request.url)).toEqual([discoveryUrl]);
  });

  it.each([
    ['public IPv4 issuer', 'https://8.8.8.8/', tokenEndpoint],
    ['public IPv6 issuer', 'https://[2606:4700:4700::1111]/', tokenEndpoint],
    ['global AMT protocol assignment', 'https://[2001:3::1]/', tokenEndpoint],
    ['global Drone Remote ID protocol assignment', 'https://[2001:30::1]/', tokenEndpoint],
    ['public IPv4 token endpoint', issuer, 'https://1.1.1.1/token'],
    ['public IPv6 token endpoint', issuer, 'https://[2606:4700:4700::1001]/token'],
    ['public IPv4-mapped endpoint', issuer, 'https://[::ffff:8.8.8.8]/token'],
  ])('allows a public OAuth host: %s', async (_, publicIssuer, publicTokenEndpoint) => {
    const expectedDiscoveryUrl = new URL('/.well-known/oauth-authorization-server', publicIssuer).toString();
    const requests: Request[] = [];
    const fetchImpl = async (request: Request) => {
      requests.push(request);
      if (request.url === expectedDiscoveryUrl) {
        return new Response(JSON.stringify({
          issuer: publicIssuer,
          token_endpoint: publicTokenEndpoint,
          token_endpoint_auth_methods_supported: ['none'],
        }), { headers: { 'Content-Type': 'application/json' } });
      }
      return new Response(JSON.stringify({ access_token: 'public-host-token' }), {
        headers: { 'Content-Type': 'application/json' },
      });
    };

    const response = await handleOAuthTokenRequest(
      tokenRequest(formBody, publicTokenEndpoint, publicIssuer),
      { FIREBASE_PROJECT_ID: 'test-project' },
      { fetchImpl, verifyToken: async () => 'user-1' }
    );

    expect(response.status).toBe(200);
    expect(requests.map(request => request.url)).toEqual([
      expectedDiscoveryUrl,
      new URL(publicTokenEndpoint).toString(),
    ]);
  });

  it.each([307, 308])(
    'rejects an HTTP %s token redirect without forwarding the form to its destination',
    async status => {
      const redirectedEndpoint = 'https://tokens.example.net/redirected-token';
      const requests: Request[] = [];
      const fetchImpl = async (request: Request) => {
        requests.push(request);
        if (request.url === discoveryUrl) {
          return new Response(JSON.stringify({
            issuer,
            token_endpoint: tokenEndpoint,
            token_endpoint_auth_methods_supported: ['none'],
          }), { headers: { 'Content-Type': 'application/json' } });
        }
        if (request.url === tokenEndpoint) {
          expect(request.redirect).toBe('manual');
          expect(await request.text()).toBe(formBody);
          return new Response(null, {
            status,
            headers: { Location: redirectedEndpoint },
          });
        }
        throw new Error(`Unexpected fetch to ${request.url}`);
      };

      const response = await handleOAuthTokenRequest(
        tokenRequest(),
        { FIREBASE_PROJECT_ID: 'test-project' },
        { fetchImpl, verifyToken: async () => 'user-1' }
      );

      expect(response.status).toBe(502);
      expect(response.headers.get(PROXY_RESPONSE_SOURCE_HEADER)).toBe('proxy');
      expect(requests.map(request => request.url)).toEqual([discoveryUrl, tokenEndpoint]);
      expect(requests.some(request => request.url === redirectedEndpoint)).toBe(false);
    }
  );

  it('keeps confidential operator secrets server-side', async () => {
    const slackIssuer = 'https://mcp.slack.com/';
    const slackTokenEndpoint = 'https://slack.com/api/oauth.v2.user.access';
    const operatorClientId = 'operator client:plus+percent%&';
    const operatorClientSecret = 'operator secret:/+?%&=';
    const requests: Request[] = [];
    const body = new URLSearchParams({
      grant_type: 'authorization_code',
      code: 'slack-code',
      code_verifier: 'slack-verifier',
      redirect_uri: 'https://mcptest.io/oauth/callback',
      client_id: operatorClientId,
      resource: 'https://mcp.slack.com/mcp',
    }).toString();
    const request = new Request('https://proxy.mcptest.test/oauth/token', {
      method: 'POST',
      headers: {
        Origin: 'https://mcptest.io',
        Authorization: 'Bearer firebase-credential',
        'Content-Type': 'application/x-www-form-urlencoded',
        'X-MCP-OAuth-Issuer': slackIssuer,
        'X-MCP-OAuth-Token-Endpoint': slackTokenEndpoint,
      },
      body,
    });
    const fetchImpl = async (targetRequest: Request) => {
      requests.push(targetRequest);
      if (targetRequest.url.includes('/.well-known/')) {
        return new Response(JSON.stringify({
          issuer: slackIssuer,
          token_endpoint: slackTokenEndpoint,
          token_endpoint_auth_methods_supported: ['client_secret_basic'],
        }), { headers: { 'Content-Type': 'application/json' } });
      }
      expect(targetRequest.headers.get('authorization')).toBe(
        `Basic ${btoa('operator+client%3Aplus%2Bpercent%25%26:operator+secret%3A%2F%2B%3F%25%26%3D')}`
      );
      expect(await targetRequest.text()).toBe(body);
      return new Response(JSON.stringify({ access_token: 'slack-access', token_type: 'Bearer' }), {
        headers: { 'Content-Type': 'application/json' },
      });
    };

    const response = await handleOAuthTokenRequest(request, {
      FIREBASE_PROJECT_ID: 'test-project',
      SLACK_OAUTH_CLIENT_ID: operatorClientId,
      SLACK_OAUTH_CLIENT_SECRET: operatorClientSecret,
    }, { fetchImpl, verifyToken: async () => 'user-1' });

    expect(response.status).toBe(200);
    expect(requests.filter(targetRequest => targetRequest.url === slackTokenEndpoint)).toHaveLength(1);
    expect(await response.text()).not.toContain(operatorClientSecret);
  });

  it('does not authenticate an endpoint advertised by a provider subdomain issuer', async () => {
    const unapprovedIssuer = 'https://attacker.slack.com/';
    const advertisedEndpoint = 'https://tokens.example.net/collect';
    const operatorClientId = 'operator-client';
    const operatorClientSecret = 'operator-secret';
    const requests: Request[] = [];
    const body = new URLSearchParams({
      grant_type: 'authorization_code',
      code: 'attacker-code',
      code_verifier: 'attacker-verifier',
      redirect_uri: 'https://mcptest.io/oauth/callback',
      client_id: operatorClientId,
      resource: 'https://mcp.example.com/mcp',
    }).toString();
    const fetchImpl = async (targetRequest: Request) => {
      requests.push(targetRequest);
      if (targetRequest.url.includes('/.well-known/')) {
        return new Response(JSON.stringify({
          issuer: unapprovedIssuer,
          token_endpoint: advertisedEndpoint,
          token_endpoint_auth_methods_supported: ['client_secret_basic'],
        }), { headers: { 'Content-Type': 'application/json' } });
      }
      throw new Error('Unapproved token endpoint must not be fetched');
    };

    const response = await handleOAuthTokenRequest(
      tokenRequest(body, advertisedEndpoint, unapprovedIssuer),
      {
        FIREBASE_PROJECT_ID: 'test-project',
        SLACK_OAUTH_CLIENT_ID: operatorClientId,
        SLACK_OAUTH_CLIENT_SECRET: operatorClientSecret,
      },
      { fetchImpl, verifyToken: async () => 'user-1' }
    );

    expect(response.status).toBe(502);
    expect(requests.map(targetRequest => targetRequest.url)).toEqual([
      'https://attacker.slack.com/.well-known/oauth-authorization-server',
    ]);
    expect(requests[0].headers.get('authorization')).toBeNull();
  });

  it.each([
    'javascript://localhost/callback',
    'ftp://127.0.0.1/callback',
    'https://user@client.example/callback',
    'https://user:password@client.example/callback',
    'https://@client.example/callback',
    'https:user@client.example/callback',
    'https:/user@client.example/callback',
    'https:\\user@client.example\\callback',
    'https:////user@client.example/callback',
    'https:@client.example/callback',
    'https:/@client.example/callback',
    'https:\\@client.example\\callback',
    'https://client.example/callback#fragment',
    'https://client.example/callback#',
    'http://user@localhost/callback',
    'http://127.0.0.1/callback#fragment',
  ])('rejects an unsafe redirect URI: %s', async redirectUri => {
    const requests: Request[] = [];
    const body = new URLSearchParams({
      grant_type: 'authorization_code',
      code: 'single-use-code',
      code_verifier: 'pkce-verifier',
      redirect_uri: redirectUri,
      client_id: 'loopback-client',
      resource: 'https://mcp.example.com/mcp',
    }).toString();
    const fetchImpl = async (request: Request) => {
      requests.push(request);
      return new Response(JSON.stringify({
        issuer,
        token_endpoint: tokenEndpoint,
        token_endpoint_auth_methods_supported: ['none'],
      }), { headers: { 'Content-Type': 'application/json' } });
    };

    const response = await handleOAuthTokenRequest(
      tokenRequest(body),
      { FIREBASE_PROJECT_ID: 'test-project' },
      { fetchImpl, verifyToken: async () => 'user-1' }
    );

    expect(response.status).toBe(502);
    expect(response.headers.get(PROXY_RESPONSE_SOURCE_HEADER)).toBe('proxy');
    expect(requests).toHaveLength(0);
  });

  it.each([
    'https://client.example/callback',
    'http://localhost:5173/callback',
    'http://127.0.0.1:5173/callback',
  ])('preserves a valid redirect URI: %s', async redirectUri => {
    const requests: Request[] = [];
    const body = new URLSearchParams({
      grant_type: 'authorization_code',
      code: 'single-use-code',
      code_verifier: 'pkce-verifier',
      redirect_uri: redirectUri,
      client_id: 'loopback-client',
      resource: 'https://mcp.example.com/mcp',
    }).toString();
    const fetchImpl = async (request: Request) => {
      requests.push(request);
      if (request.url === discoveryUrl) {
        return new Response(JSON.stringify({
          issuer,
          token_endpoint: tokenEndpoint,
          token_endpoint_auth_methods_supported: ['none'],
        }), { headers: { 'Content-Type': 'application/json' } });
      }
      return new Response(JSON.stringify({ access_token: 'redirect-token' }), {
        headers: { 'Content-Type': 'application/json' },
      });
    };

    const response = await handleOAuthTokenRequest(
      tokenRequest(body),
      { FIREBASE_PROJECT_ID: 'test-project' },
      { fetchImpl, verifyToken: async () => 'user-1' }
    );

    expect(response.status).toBe(200);
    expect(requests.map(request => request.url)).toEqual([discoveryUrl, tokenEndpoint]);
  });

  it.each([
    'http://[::1]:5173/callback',
    'http://127.42.3.4:5173/callback',
    'http://127.1:5173/callback',
  ])('preserves an explicit HTTP IP loopback redirect URI: %s', async redirectUri => {
    const requests: Request[] = [];
    const body = new URLSearchParams({
      grant_type: 'authorization_code',
      code: 'single-use-code',
      code_verifier: 'pkce-verifier',
      redirect_uri: redirectUri,
      client_id: 'loopback-client',
      resource: 'https://mcp.example.com/mcp',
    }).toString();
    const fetchImpl = async (request: Request) => {
      requests.push(request);
      if (request.url === discoveryUrl) {
        return new Response(JSON.stringify({
          issuer,
          token_endpoint: tokenEndpoint,
          token_endpoint_auth_methods_supported: ['none'],
        }), { headers: { 'Content-Type': 'application/json' } });
      }
      return new Response(JSON.stringify({ access_token: 'loopback-token' }), {
        headers: { 'Content-Type': 'application/json' },
      });
    };

    const response = await handleOAuthTokenRequest(
      tokenRequest(body),
      { FIREBASE_PROJECT_ID: 'test-project' },
      { fetchImpl, verifyToken: async () => 'user-1' }
    );

    expect(response.status).toBe(200);
    expect(requests.map(request => request.url)).toEqual([discoveryUrl, tokenEndpoint]);
  });

  it.each((() => {
    const duplicateAuthorizationCodeForm = (name: string, value: string): string => {
      const params = new URLSearchParams(formBody);
      params.append(name, value);
      return params.toString();
    };
    const refreshParams = new URLSearchParams({
      grant_type: 'refresh_token',
      refresh_token: 'first-refresh-token',
      client_id: 'public-client',
      resource: 'https://mcp.example.com/mcp',
    });
    refreshParams.append('refresh_token', 'second-refresh-token');
    return [
      ['grant_type', duplicateAuthorizationCodeForm('grant_type', 'refresh_token')],
      ['client_id', duplicateAuthorizationCodeForm('client_id', 'attacker-client')],
      ['resource', duplicateAuthorizationCodeForm('resource', 'https://attacker.example/mcp')],
      ['code', duplicateAuthorizationCodeForm('code', 'second-code')],
      ['code_verifier', duplicateAuthorizationCodeForm('code_verifier', 'second-verifier')],
      ['redirect_uri', duplicateAuthorizationCodeForm('redirect_uri', 'https://attacker.example/callback')],
      ['refresh_token', refreshParams.toString()],
    ];
  })())('rejects duplicate %s before authorization-server discovery', async (_, body) => {
    const fetchImpl = vi.fn();

    const response = await handleOAuthTokenRequest(
      tokenRequest(body),
      { FIREBASE_PROJECT_ID: 'test-project' },
      { fetchImpl, verifyToken: async () => 'user-1' }
    );

    expect(response.status).toBe(502);
    expect(response.headers.get(PROXY_RESPONSE_SOURCE_HEADER)).toBe('proxy');
    expect(fetchImpl).not.toHaveBeenCalled();
  });

  it('rejects signed-out and cross-origin callers without discovery', async () => {
    const fetchImpl = vi.fn();
    const signedOut = tokenRequest();
    signedOut.headers.delete('Authorization');
    const signedOutResponse = await handleOAuthTokenRequest(
      signedOut,
      { FIREBASE_PROJECT_ID: 'test-project' },
      { fetchImpl, verifyToken: async () => null }
    );
    const crossOrigin = tokenRequest();
    crossOrigin.headers.set('Origin', 'https://preview.mcptest.io');
    const crossOriginResponse = await handleOAuthTokenRequest(
      crossOrigin,
      { FIREBASE_PROJECT_ID: 'test-project' },
      { fetchImpl, verifyToken: async () => 'user-1' }
    );

    expect(signedOutResponse.status).toBe(401);
    expect(crossOriginResponse.status).toBe(403);
    expect(crossOriginResponse.headers.get('access-control-allow-origin')).toBeNull();
    expect(fetchImpl).not.toHaveBeenCalled();
  });
});

describe('hosted issuer-bound OAuth registration route', () => {
  const issuer = 'https://api.supabase.com';
  const discoveryUrl = 'https://api.supabase.com/.well-known/oauth-authorization-server';
  const registrationEndpoint = 'https://api.supabase.com/platform/oauth/apps/register';
  const registrationBody = {
    redirect_uris: ['https://mcptest.io/oauth/callback'],
    token_endpoint_auth_method: 'client_secret_post',
    grant_types: ['authorization_code', 'refresh_token'],
    response_types: ['code'],
    application_type: 'web',
    client_name: 'mcptest.io MCP Inspector',
    client_uri: 'https://mcptest.io/',
    logo_uri: 'https://mcptest.io/logo.png',
    scope: 'openid offline_access',
  };

  const registrationRequest = (
    body: string = JSON.stringify(registrationBody),
    endpointHeader = registrationEndpoint
  ): Request => new Request('https://proxy.mcptest.test/oauth/register', {
    method: 'POST',
    headers: {
      Origin: 'https://mcptest.io',
      Authorization: 'Bearer firebase-credential',
      'Content-Type': 'application/json',
      'X-MCP-OAuth-Issuer': issuer,
      'X-MCP-OAuth-Registration-Endpoint': endpointHeader,
    },
    body,
  });

  const metadataResponse = (endpoint = registrationEndpoint): Response => new Response(JSON.stringify({
    issuer,
    token_endpoint: 'https://api.supabase.com/v1/oauth/token',
    registration_endpoint: endpoint,
    token_endpoint_auth_methods_supported: ['client_secret_post'],
  }), { headers: { 'Content-Type': 'application/json' } });

  it('enforces public-Internet routing for production outbound fetches', () => {
    const workerConfiguration = readFileSync(new NodeURL('../wrangler.toml', import.meta.url), 'utf8');

    expect(workerConfiguration).toMatch(
      /^compatibility_flags\s*=\s*\[[^\]]*"global_fetch_strictly_public"[^\]]*\]/m
    );
  });

  it('allows the exact hosted registration relay browser preflight', async () => {
    const response = await proxyWorker.fetch(
      new Request('https://proxy.mcptest.test/oauth/register', {
        method: 'OPTIONS',
        headers: {
          Origin: 'https://mcptest.io',
          'Access-Control-Request-Method': 'POST',
          'Access-Control-Request-Headers': [
            'authorization',
            'content-type',
            'x-mcp-oauth-issuer',
            'x-mcp-oauth-registration-endpoint',
          ].join(', '),
        },
      }),
      { FIREBASE_PROJECT_ID: 'test-project' }
    );
    const allowedHeaders = response.headers.get('Access-Control-Allow-Headers')?.toLowerCase();

    expect(response.status).toBe(204);
    expect(response.headers.get('Access-Control-Allow-Origin')).toBe('https://mcptest.io');
    expect(response.headers.get('Access-Control-Allow-Methods')).toContain('POST');
    expect(allowedHeaders).toContain('x-mcp-oauth-registration-endpoint');
  });

  it('uses only strict-public global fetches for the production-style Supabase relay', async () => {
    const requests: Request[] = [];
    const fetchSpy = vi.spyOn(globalThis, 'fetch').mockImplementation(async input => {
      const request = input instanceof Request ? input : new Request(input);
      requests.push(request);
      if (request.url === discoveryUrl) return metadataResponse();
      if (request.url === registrationEndpoint) {
        return new Response(JSON.stringify({
          ...registrationBody,
          id: 'provider-only-row-id',
          client_id: 'supabase-production-client',
          client_secret: 'supabase-production-secret',
          client_secret_expires_at: 0,
          token_endpoint_auth_method: 'client_secret_post',
        }), { status: 201, headers: { 'Content-Type': 'application/json' } });
      }
      throw new Error(`Unexpected outbound request to ${request.url}`);
    });

    try {
      const response = await handleOAuthRegistrationRequest(
        registrationRequest(),
        { FIREBASE_PROJECT_ID: 'test-project' },
        { verifyToken: async () => 'user-1' }
      );

      expect(response.status).toBe(201);
      expect(response.headers.get(PROXY_RESPONSE_SOURCE_HEADER)).toBe('target');
      await expect(response.json()).resolves.toEqual({
        ...registrationBody,
        client_id: 'supabase-production-client',
        client_secret: 'supabase-production-secret',
        client_secret_expires_at: 0,
        token_endpoint_auth_method: 'client_secret_post',
      });
      expect(requests.map(request => request.url)).toEqual([
        discoveryUrl,
        registrationEndpoint,
      ]);
      expect(requests.some(request => request.url.includes('cloudflare-dns.com'))).toBe(false);
    } finally {
      fetchSpy.mockRestore();
    }
  });

  it('rediscovers and posts once to an exact cross-domain advertised endpoint', async () => {
    const requests: Request[] = [];
    const resolveHostname = vi.fn(async () => ['203.0.114.10']);
    const fetchImpl = async (request: Request): Promise<Response> => {
      requests.push(request);
      if (request.url === discoveryUrl) return metadataResponse();
      expect(request.url).toBe(registrationEndpoint);
      expect(request.redirect).toBe('manual');
      expect(request.headers.get('authorization')).toBeNull();
      expect(await request.json()).toEqual(registrationBody);
      return new Response(JSON.stringify({
        ...registrationBody,
        id: 'provider-only-row-id',
        client_id: 'supabase-dynamic-client',
        client_secret: 'session-only-secret',
        client_secret_expires_at: 0,
        token_endpoint_auth_method: 'client_secret_post',
        ignored_provider_field: 'not exposed',
      }), {
        status: 201,
        headers: {
          'Content-Type': 'application/json',
          'Set-Cookie': 'provider_session=secret',
          'X-Provider-Internal': 'hidden',
        },
      });
    };

    const response = await handleOAuthRegistrationRequest(
      registrationRequest(),
      { FIREBASE_PROJECT_ID: 'test-project' },
      {
        fetchImpl,
        resolveHostname,
        verifyToken: async token => token === 'firebase-credential' ? 'user-1' : null,
      }
    );

    expect(response.status).toBe(201);
    expect(response.headers.get(PROXY_RESPONSE_SOURCE_HEADER)).toBe('target');
    expect(response.headers.get('set-cookie')).toBeNull();
    expect(response.headers.get('x-provider-internal')).toBeNull();
    await expect(response.json()).resolves.toEqual({
      ...registrationBody,
      client_id: 'supabase-dynamic-client',
      client_secret: 'session-only-secret',
      client_secret_expires_at: 0,
      token_endpoint_auth_method: 'client_secret_post',
    });
    expect(requests.map(request => request.url)).toEqual([discoveryUrl, registrationEndpoint]);
    expect(resolveHostname).toHaveBeenCalledWith('api.supabase.com');
    expect(resolveHostname).toHaveBeenCalledTimes(2);
  });

  it.each([
    'authorization_metadata_discovery',
    'destination_validation',
    'dns_safety_validation',
    'outbound_fetch',
    'response_validation',
  ] as const)('returns and logs a secret-safe %s failure', async stage => {
    const secret = 'must-not-appear-in-registration-diagnostics';
    const errorLog = vi.spyOn(console, 'error').mockImplementation(() => {});
    const privateRegistrationEndpoint = 'https://127.0.0.1/platform/oauth/apps/register';
    const dependencies: Parameters<typeof handleOAuthRegistrationRequest>[2] = {
      verifyToken: async () => 'user-1',
      fetchImpl: async request => {
        if (stage === 'authorization_metadata_discovery') {
          throw new TypeError(`metadata transport contained ${secret}`);
        }
        if (request.url === discoveryUrl) {
          return stage === 'destination_validation'
            ? metadataResponse(privateRegistrationEndpoint)
            : metadataResponse();
        }
        if (stage === 'outbound_fetch') {
          throw new TypeError(`provider transport contained ${secret}`);
        }
        if (stage === 'response_validation') {
          return new Response(`invalid provider payload ${secret}`, {
            status: 201,
            headers: { 'Content-Type': 'text/plain' },
          });
        }
        return new Response('unreachable');
      },
      ...(stage === 'dns_safety_validation'
        ? { resolveHostname: async () => ['127.0.0.1'] }
        : {}),
    };

    try {
      const response = await handleOAuthRegistrationRequest(
        registrationRequest(),
        { FIREBASE_PROJECT_ID: 'test-project' },
        dependencies
      );
      const responseText = await response.text();
      const serializedLog = JSON.stringify(errorLog.mock.calls);

      expect(response.status).toBe(502);
      expect(response.headers.get(PROXY_RESPONSE_SOURCE_HEADER)).toBe('proxy');
      expect(responseText.toLowerCase()).toContain(
        stage === 'authorization_metadata_discovery'
          ? 'issuer discovery'
          : stage === 'destination_validation'
            ? 'destination validation'
            : stage === 'dns_safety_validation'
              ? 'dns safety validation'
              : stage === 'outbound_fetch'
                ? 'could not reach'
                : 'response validation'
      );
      expect(errorLog).toHaveBeenCalledWith(
        '[OAuth registration relay failure]',
        expect.objectContaining({ stage })
      );
      expect(responseText).not.toContain(secret);
      expect(serializedLog).not.toContain(secret);
      expect(serializedLog).not.toContain('firebase-credential');
      expect(serializedLog).not.toContain('user-1');
    } finally {
      errorLog.mockRestore();
    }
  });

  it.each([
    ['redirect_uris', ['https://attacker.example/callback']],
    ['grant_types', ['client_credentials']],
    ['response_types', ['token']],
    ['application_type', 'native'],
  ])('rejects provider-returned %s that conflicts with the safe request', async (
    field,
    conflictingValue
  ) => {
    const response = await handleOAuthRegistrationRequest(
      registrationRequest(),
      { FIREBASE_PROJECT_ID: 'test-project' },
      {
        fetchImpl: async request => request.url === discoveryUrl
          ? metadataResponse()
          : new Response(JSON.stringify({
              ...registrationBody,
              [field]: conflictingValue,
              client_id: 'conflicting-client',
              client_secret: 'session-only-secret',
              token_endpoint_auth_method: 'client_secret_post',
            }), { status: 201, headers: { 'Content-Type': 'application/json' } }),
        verifyToken: async () => 'user-1',
      }
    );

    expect(response.status).toBe(502);
    expect(response.headers.get(PROXY_RESPONSE_SOURCE_HEADER)).toBe('proxy');
  });

  it('rejects the provider-selected token authentication method unless it is advertised', async () => {
    const response = await handleOAuthRegistrationRequest(
      registrationRequest(),
      { FIREBASE_PROJECT_ID: 'test-project' },
      {
        fetchImpl: async request => request.url === discoveryUrl
          ? metadataResponse()
          : new Response(JSON.stringify({
              ...registrationBody,
              client_id: 'wrong-method-client',
              client_secret: 'session-only-secret',
              token_endpoint_auth_method: 'client_secret_basic',
            }), { status: 201, headers: { 'Content-Type': 'application/json' } }),
        verifyToken: async () => 'user-1',
      }
    );

    expect(response.status).toBe(502);
    expect(response.headers.get(PROXY_RESPONSE_SOURCE_HEADER)).toBe('proxy');
  });

  it.each(['client_secret_post', 'none'])(
    'rejects registration requesting %s when metadata omits the Basic-only default',
    async tokenEndpointAuthMethod => {
      const requests: Request[] = [];
      const response = await handleOAuthRegistrationRequest(
        registrationRequest(JSON.stringify({
          ...registrationBody,
          token_endpoint_auth_method: tokenEndpointAuthMethod,
        })),
        { FIREBASE_PROJECT_ID: 'test-project' },
        {
          fetchImpl: async request => {
            requests.push(request);
            return new Response(JSON.stringify({
              issuer,
              token_endpoint: 'https://api.supabase.com/v1/oauth/token',
              registration_endpoint: registrationEndpoint,
            }), { headers: { 'Content-Type': 'application/json' } });
          },
          verifyToken: async () => 'user-1',
        }
      );

      expect(response.status).toBe(400);
      expect(response.headers.get(PROXY_RESPONSE_SOURCE_HEADER)).toBe('proxy');
      expect(requests.map(request => request.url)).toEqual([discoveryUrl]);
    }
  );

  it('rejects an asserted endpoint mismatch before credential-bearing registration', async () => {
    const requests: Request[] = [];
    const response = await handleOAuthRegistrationRequest(
      registrationRequest(undefined, 'https://attacker.example/register'),
      { FIREBASE_PROJECT_ID: 'test-project' },
      {
        fetchImpl: async request => {
          requests.push(request);
          return metadataResponse();
        },
        verifyToken: async () => 'user-1',
      }
    );

    expect(response.status).toBe(400);
    expect(response.headers.get(PROXY_RESPONSE_SOURCE_HEADER)).toBe('proxy');
    expect(requests.map(request => request.url)).toEqual([discoveryUrl]);
  });

  it('rejects private or mixed DNS answers before sending registration metadata', async () => {
    const requests: Request[] = [];
    let resolutionCount = 0;
    const response = await handleOAuthRegistrationRequest(
      registrationRequest(),
      { FIREBASE_PROJECT_ID: 'test-project' },
      {
        fetchImpl: async request => {
          requests.push(request);
          return metadataResponse();
        },
        resolveHostname: async () => {
          resolutionCount += 1;
          return resolutionCount === 1
            ? ['203.0.114.10']
            : ['203.0.114.11', '127.0.0.1'];
        },
        verifyToken: async () => 'user-1',
      }
    );

    expect(response.status).toBe(502);
    expect(requests.map(request => request.url)).toEqual([discoveryUrl]);
  });

  it('fails closed when outbound DNS rebinds privately after public validation', async () => {
    const deliveredRequests: Request[] = [];
    let outboundConnectionCount = 0;
    const fetchImpl = async (request: Request): Promise<Response> => {
      outboundConnectionCount += 1;
      // Models global_fetch_strictly_public rejecting the connection chosen by
      // the runtime resolver before any HTTP request reaches a private target.
      if (outboundConnectionCount === 2) {
        throw new TypeError('Network destination is not publicly routable');
      }
      deliveredRequests.push(request);
      if (request.url === discoveryUrl) return metadataResponse();
      throw new Error(`Unexpected public request to ${request.url}`);
    };

    const response = await handleOAuthRegistrationRequest(
      registrationRequest(),
      { FIREBASE_PROJECT_ID: 'test-project' },
      {
        fetchImpl,
        // The preflight sees a public address; the independent outbound
        // resolver above changes only the registration hop to loopback.
        resolveHostname: async () => ['203.0.114.10'],
        verifyToken: async () => 'user-1',
      }
    );

    expect(response.status).toBe(502);
    expect(deliveredRequests.map(request => request.url)).toEqual([discoveryUrl]);
    expect(outboundConnectionCount).toBe(2);
  });

  it.each([
    ['unknown metadata', { ...registrationBody, software_statement: 'dangerous' }],
    ['arbitrary callback', { ...registrationBody, redirect_uris: ['https://attacker.example/callback'] }],
    ['unsupported auth method', { ...registrationBody, token_endpoint_auth_method: 'private_key_jwt' }],
    ['unsupported grant', { ...registrationBody, grant_types: ['client_credentials'] }],
  ])('rejects invalid JSON registration schema: %s', async (_, body) => {
    const fetchImpl = vi.fn();
    const response = await handleOAuthRegistrationRequest(
      registrationRequest(JSON.stringify(body)),
      { FIREBASE_PROJECT_ID: 'test-project' },
      { fetchImpl, verifyToken: async () => 'user-1' }
    );

    expect(response.status).toBe(400);
    expect(fetchImpl).not.toHaveBeenCalled();
  });

  it('rejects oversized request and response bodies without exposing them', async () => {
    const oversizedRequest = registrationRequest();
    oversizedRequest.headers.set('Content-Length', String(20 * 1024));
    const requestResponse = await handleOAuthRegistrationRequest(
      oversizedRequest,
      { FIREBASE_PROJECT_ID: 'test-project' },
      { fetchImpl: vi.fn(), verifyToken: async () => 'user-1' }
    );
    const responseResponse = await handleOAuthRegistrationRequest(
      registrationRequest(),
      { FIREBASE_PROJECT_ID: 'test-project' },
      {
        fetchImpl: async request => request.url === discoveryUrl
          ? metadataResponse()
          : new Response(JSON.stringify({
              client_id: 'client',
              error_description: 'x'.repeat(70 * 1024),
            }), { headers: { 'Content-Type': 'application/json' } }),
        verifyToken: async () => 'user-1',
      }
    );

    expect(requestResponse.status).toBe(413);
    expect(responseResponse.status).toBe(502);
    expect(await responseResponse.text()).not.toContain('xxxxx');
  });

  it('rejects redirects and sanitizes readable provider errors', async () => {
    const redirectResponse = await handleOAuthRegistrationRequest(
      registrationRequest(),
      { FIREBASE_PROJECT_ID: 'test-project' },
      {
        fetchImpl: async request => request.url === discoveryUrl
          ? metadataResponse()
          : new Response(null, {
              status: 307,
              headers: { Location: 'https://attacker.example/collect' },
            }),
        verifyToken: async () => 'user-1',
      }
    );
    const errorResponse = await handleOAuthRegistrationRequest(
      registrationRequest(),
      { FIREBASE_PROJECT_ID: 'test-project' },
      {
        fetchImpl: async request => request.url === discoveryUrl
          ? metadataResponse()
          : new Response(JSON.stringify({
              error: 'invalid_client_metadata',
              error_description: 'redirect URI is not accepted',
              client_secret: 'must-not-leak',
            }), {
              status: 400,
              headers: { 'Content-Type': 'application/json', 'Set-Cookie': 'hidden=1' },
            }),
        verifyToken: async () => 'user-1',
      }
    );

    expect(redirectResponse.status).toBe(502);
    expect(errorResponse.status).toBe(400);
    expect(errorResponse.headers.get(PROXY_RESPONSE_SOURCE_HEADER)).toBe('target');
    expect(errorResponse.headers.get('set-cookie')).toBeNull();
    await expect(errorResponse.json()).resolves.toEqual({
      error: 'invalid_client_metadata',
      error_description: 'redirect URI is not accepted',
    });
  });

  it('rejects missing and invalid Firebase authentication before discovery', async () => {
    const fetchImpl = vi.fn();
    const missing = registrationRequest();
    missing.headers.delete('Authorization');
    const missingResponse = await handleOAuthRegistrationRequest(
      missing,
      { FIREBASE_PROJECT_ID: 'test-project' },
      { fetchImpl, verifyToken: async () => null }
    );
    const invalidResponse = await handleOAuthRegistrationRequest(
      registrationRequest(),
      { FIREBASE_PROJECT_ID: 'test-project' },
      { fetchImpl, verifyToken: async () => null }
    );

    expect(missingResponse.status).toBe(401);
    expect(invalidResponse.status).toBe(401);
    expect(fetchImpl).not.toHaveBeenCalled();
  });
});
