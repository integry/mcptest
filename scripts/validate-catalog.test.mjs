import { describe, expect, it } from 'vitest';
import validator from './validate-catalog.js';

const {
  detectedAuthType,
  endpointVariants,
  probeStreamableEndpoint,
} = validator;

function jsonRpcResponse(body, result, options = {}) {
  return new Response(JSON.stringify({ jsonrpc: '2.0', id: body.id, result }), {
    status: options.status || 200,
    headers: {
      'Content-Type': 'application/json',
      ...(options.headers || {}),
    },
  });
}

describe('catalog endpoint variants', () => {
  it('preserves an exact custom MCP endpoint without inventing child paths', () => {
    const variants = endpointVariants({
      url: 'https://example.com/v1/mcp/authv2',
      transport: 'streamable-http',
    });

    expect(variants.slice(0, 2)).toEqual([
      { url: 'https://example.com/v1/mcp/authv2', transport: 'streamable-http' },
      { url: 'https://example.com/v1/mcp/authv2/', transport: 'streamable-http' },
    ]);
    expect(variants.some(({ url }) => url.includes('authv2/mcp'))).toBe(false);
    expect(variants.some(({ url }) => url.includes('authv2/sse'))).toBe(false);
  });

  it('adds conventional transport paths for an origin root', () => {
    const variants = endpointVariants({
      url: 'https://example.com',
      transport: 'streamable-http',
    });

    expect(variants).toContainEqual({
      url: 'https://example.com/mcp',
      transport: 'streamable-http',
    });
    expect(variants).toContainEqual({
      url: 'https://example.com/sse',
      transport: 'legacy-sse',
    });
  });

  it('tests the exact URL with both transports when the declared transport and path differ', () => {
    const variants = endpointVariants({
      url: 'https://example.com/mcp',
      transport: 'legacy-sse',
    });

    expect(variants).toContainEqual({
      url: 'https://example.com/mcp',
      transport: 'legacy-sse',
    });
    expect(variants).toContainEqual({
      url: 'https://example.com/mcp',
      transport: 'streamable-http',
    });
  });
});

describe('catalog protocol validation', () => {
  it('negotiates a stateless 2026 Streamable HTTP server', async () => {
    const requests = [];
    const fetch = async (_input, init = {}) => {
      const body = JSON.parse(String(init.body));
      requests.push({ body, headers: new Headers(init.headers) });
      return jsonRpcResponse(body, {
        supportedVersions: ['2026-07-28'],
        capabilities: { tools: {} },
      });
    };

    const result = await probeStreamableEndpoint(
      { url: 'https://example.com/mcp', transport: 'streamable-http' },
      { fetchImpl: fetch, timeoutMs: 1_000 }
    );

    expect(result).toMatchObject({
      alive: true,
      protocolEra: 'stateless',
      protocolVersion: '2026-07-28',
    });
    expect(requests.map(({ body }) => body.method)).toEqual(['server/discover']);
    expect(requests[0].headers.get('mcp-method')).toBe('server/discover');
    expect(requests[0].headers.get('mcp-protocol-version')).toBe('2026-07-28');
  });

  it('falls back to stateful initialization for a 2025 server', async () => {
    const requests = [];
    const fetch = async (_input, init = {}) => {
      if (init.method === 'DELETE') return new Response(null, { status: 200 });

      const body = JSON.parse(String(init.body));
      requests.push({ body, headers: new Headers(init.headers) });
      if (body.method === 'server/discover') {
        return new Response('Not found', { status: 404 });
      }
      if (!('id' in body)) return new Response(null, { status: 202 });

      return jsonRpcResponse(body, {
        protocolVersion: '2025-06-18',
        capabilities: { tools: {} },
        serverInfo: { name: 'stateful-test-server', version: '1.0.0' },
      }, {
        headers: body.method === 'initialize'
          ? { 'Mcp-Session-Id': 'catalog-session' }
          : {},
      });
    };

    const result = await probeStreamableEndpoint(
      { url: 'https://example.com/mcp', transport: 'streamable-http' },
      { fetchImpl: fetch, timeoutMs: 1_000 }
    );

    expect(result).toMatchObject({
      alive: true,
      protocolEra: 'stateful',
      protocolVersion: '2025-06-18',
    });
    expect(requests.map(({ body }) => body.method)).toEqual([
      'server/discover',
      'initialize',
      'notifications/initialized',
    ]);
  });

  it('treats an authentication challenge as a live protected endpoint', async () => {
    const fetch = async () => new Response(null, {
      status: 401,
      headers: {
        'WWW-Authenticate': 'Bearer resource_metadata="https://example.com/.well-known/oauth-protected-resource"',
      },
    });

    const result = await probeStreamableEndpoint(
      { url: 'https://example.com/mcp', transport: 'streamable-http' },
      { fetchImpl: fetch, timeoutMs: 1_000 }
    );

    expect(result).toMatchObject({
      alive: true,
      reachable: true,
      authChallenge: true,
      statusCode: 401,
      resourceMetadataUrl: 'https://example.com/.well-known/oauth-protected-resource',
    });
  });

  it('uses an auth challenge as bearer evidence without mislabeling it OAuth', () => {
    expect(detectedAuthType(
      { requiresOAuth: false },
      [{ authChallenge: true }],
      { oauthMetadata: false }
    )).toBe('bearer-token');
    expect(detectedAuthType(
      { authType: 'api-key' },
      [{ authChallenge: true }],
      { oauthMetadata: false }
    )).toBe('api-key');
    expect(detectedAuthType(
      { authType: 'bearer-token' },
      [{ authChallenge: true }],
      { oauthMetadata: true }
    )).toBe('bearer-token');
    expect(detectedAuthType(
      { authType: 'none' },
      [{ alive: true, authChallenge: false }],
      { oauthMetadata: true }
    )).toBe('none');
  });
});
