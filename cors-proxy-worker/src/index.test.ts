import { describe, expect, it } from 'vitest';
import proxyWorker, {
  PROXY_RESPONSE_SOURCE_HEADER,
  fetchTargetRequest,
  getTargetRequestHeaders,
  withCorsResponseHeaders,
} from './index';

describe('proxy target credential forwarding', () => {
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

  it('marks upstream responses separately from proxy-owned responses', async () => {
    const targetResponse = withCorsResponseHeaders(
      new Response('Target authentication required', { status: 401 }),
      'target'
    );
    const proxyResponse = await proxyWorker.fetch(
      new Request('https://proxy.mcptest.test/'),
      { FIREBASE_PROJECT_ID: 'test-project' }
    );

    expect(targetResponse.headers.get(PROXY_RESPONSE_SOURCE_HEADER)).toBe('target');
    expect(targetResponse.headers.get('access-control-expose-headers')).toContain(
      PROXY_RESPONSE_SOURCE_HEADER.toLowerCase()
    );
    expect(proxyResponse.status).toBe(400);
    expect(proxyResponse.headers.get(PROXY_RESPONSE_SOURCE_HEADER)).toBe('proxy');
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
});
