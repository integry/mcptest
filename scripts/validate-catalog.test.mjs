import { describe, expect, it } from 'vitest';
import validator from './validate-catalog.js';

const {
  detectedAuthType,
  endpointVariants,
  probeSseEndpoint,
  probeStreamableEndpoint,
  validateSeed,
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

  it('treats an authentication challenge as reachability evidence only', async () => {
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
      alive: false,
      reachable: true,
      authChallenge: true,
      statusCode: 401,
      resourceMetadataUrl: 'https://example.com/.well-known/oauth-protected-resource',
    });
  });

  it('continues same-transport probing after a root authentication challenge', async () => {
    const requestedUrls = [];
    const fetch = async (input, init = {}) => {
      const url = new URL(input instanceof Request ? input.url : input);
      requestedUrls.push(url.toString());

      if (url.pathname === '/') {
        return new Response(null, {
          status: 401,
          headers: {
            'WWW-Authenticate': 'Bearer resource_metadata="https://example.com/.well-known/oauth-protected-resource"',
          },
        });
      }

      if (url.pathname === '/mcp' && init.method === 'POST') {
        const body = JSON.parse(String(init.body));
        return jsonRpcResponse(body, {
          supportedVersions: ['2026-07-28'],
          capabilities: { tools: {} },
        });
      }

      return new Response('Not found', { status: 404 });
    };

    const result = await validateSeed(
      {
        id: 'root-challenge',
        url: 'https://example.com',
        transport: 'streamable-http',
        authType: 'none',
      },
      { fetchImpl: fetch, timeoutMs: 1_000 }
    );

    expect(requestedUrls).toContain('https://example.com/');
    expect(requestedUrls).toContain('https://example.com/mcp');
    expect(result).toMatchObject({
      status: 'online',
      transport: 'streamable-http',
      protocolEra: 'stateless',
      protocolVersion: '2026-07-28',
      validatedUrl: 'https://example.com/mcp',
    });
    expect(result.message).toContain('Negotiated stateless MCP 2026-07-28 at https://example.com/mcp');
    expect(result.message).not.toContain('Authentication challenge at https://example.com/');
  });

  it('requires a legacy SSE endpoint event and initialization exchange', async () => {
    const encoder = new TextEncoder();
    let streamController;
    const methods = [];
    const fetch = async (input, init = {}) => {
      const url = new URL(input instanceof Request ? input.url : input);
      const method = init.method || 'GET';

      if (method === 'GET') {
        const body = new ReadableStream({
          start(controller) {
            streamController = controller;
            controller.enqueue(encoder.encode('event: endpoint\ndata: /messages\n\n'));
          },
        });
        return new Response(body, {
          headers: { 'Content-Type': 'text/event-stream' },
        });
      }

      expect(url.pathname).toBe('/messages');
      const body = JSON.parse(String(init.body));
      methods.push(body.method);
      if (body.method === 'initialize') {
        streamController.enqueue(encoder.encode(`event: message\ndata: ${JSON.stringify({
          jsonrpc: '2.0',
          id: body.id,
          result: {
            protocolVersion: '2025-06-18',
            capabilities: { tools: {} },
            serverInfo: { name: 'legacy-test-server', version: '1.0.0' },
          },
        })}\n\n`));
      }
      return new Response(null, { status: 202 });
    };

    const result = await probeSseEndpoint(
      { url: 'https://example.com/sse', transport: 'legacy-sse' },
      { fetchImpl: fetch, timeoutMs: 1_000 }
    );

    expect(result).toMatchObject({
      alive: true,
      authChallenge: false,
      protocolEra: 'legacy',
      protocolVersion: '2025-06-18',
    });
    expect(methods).toEqual(['initialize', 'notifications/initialized']);
  });

  it('does not record a MIME-only event stream as legacy MCP', async () => {
    const fetch = async () => new Response('event: ping\ndata: {}\n\n', {
      headers: { 'Content-Type': 'text/event-stream' },
    });

    const result = await probeSseEndpoint(
      { url: 'https://example.com/sse', transport: 'legacy-sse' },
      { fetchImpl: fetch, timeoutMs: 1_000 }
    );

    expect(result).toMatchObject({
      reachable: true,
      alive: false,
      authChallenge: false,
      protocolEra: 'unknown',
      errorCode: 'protocol_error',
    });
  });

  it('keeps legacy SSE authentication challenges as reachability evidence', async () => {
    const fetch = async () => new Response(null, { status: 403 });

    const result = await probeSseEndpoint(
      { url: 'https://example.com/sse', transport: 'legacy-sse' },
      { fetchImpl: fetch, timeoutMs: 1_000 }
    );

    expect(result).toMatchObject({
      reachable: true,
      alive: false,
      authChallenge: true,
      protocolEra: 'unknown',
      statusCode: 403,
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
