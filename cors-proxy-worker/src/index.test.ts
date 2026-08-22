import { createServer } from 'node:http';
import { describe, expect, it, vi } from 'vitest';
import proxyWorker, {
  HostedOAuthBroker,
  PROXY_RESPONSE_SOURCE_HEADER,
  fetchTargetRequest,
  getOperatorOAuthClient,
  getTargetRequestHeaders,
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
      'x-api-key': 'target-api-key',
      'CF-Connecting-IP': '192.0.2.1',
    });

    expect(headers.get('authorization')).toBe('Bearer target-token');
    expect(headers.get('x-mcp-authorization')).toBeNull();
    expect(headers.get('x-api-key')).toBe('target-api-key');
    expect(headers.get('cf-connecting-ip')).toBeNull();
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

  const tokenRequest = (body = formBody, tokenEndpointHeader = tokenEndpoint) => new Request(
    'https://proxy.mcptest.test/oauth/token',
    {
      method: 'POST',
      headers: {
        Origin: 'https://mcptest.io',
        Authorization: 'Bearer firebase-credential',
        'Content-Type': 'application/x-www-form-urlencoded',
        'X-MCP-OAuth-Issuer': issuer,
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

  it('keeps confidential operator secrets server-side', async () => {
    const slackIssuer = 'https://slack.com/';
    const slackTokenEndpoint = 'https://slack.com/api/oauth.v2.access';
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

  it.each([
    'javascript://localhost/callback',
    'ftp://127.0.0.1/callback',
  ])('rejects a non-HTTP loopback redirect URI: %s', async redirectUri => {
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
    expect(requests.map(request => request.url)).toEqual([discoveryUrl]);
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
