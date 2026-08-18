import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { execFileSync } from 'node:child_process';
import { Client, InMemoryTransport } from '@modelcontextprotocol/client';
import { describe, expect, it } from 'vitest';
import catalogSeeds from '../src/data/serverCatalog.json';
import { validateCapabilityInventory } from '../src/utils/capabilityInventory';
import validator from './validate-catalog.js';

const {
  detectedAuthType,
  discoverPublicInventory,
  endpointVariants,
  mergeCapabilitySnapshots,
  paginateDiscovery,
  probeSseEndpoint,
  probeStreamableEndpoint,
  validateCatalogSeed,
  validateSeed,
  writeResults,
} = validator;

async function connectedClient(listHandler) {
  const client = new Client(
    { name: 'catalog-pagination-test', version: '1.0.0' },
    { versionNegotiation: { mode: 'legacy' } }
  );
  const [clientTransport, serverTransport] = InMemoryTransport.createLinkedPair();
  serverTransport.onmessage = async (message) => {
    if (!('method' in message) || !('id' in message)) return;
    if (message.method === 'initialize') {
      await serverTransport.send({
        jsonrpc: '2.0',
        id: message.id,
        result: {
          protocolVersion: '2025-06-18',
          capabilities: { tools: {}, resources: {}, prompts: {} },
          serverInfo: { name: 'pagination-test-server', version: '1.0.0' },
        },
      });
      return;
    }
    try {
      await serverTransport.send({
        jsonrpc: '2.0', id: message.id, result: await listHandler(message.method, message.params),
      });
    } catch (error) {
      await serverTransport.send({
        jsonrpc: '2.0', id: message.id,
        error: { code: -32603, message: error instanceof Error ? error.message : String(error) },
      });
    }
  };
  await serverTransport.start();
  await client.connect(clientTransport);
  return client;
}

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

  it('does not invent child paths for an exact-only origin endpoint', () => {
    const variants = endpointVariants({
      url: 'https://mcp.example.com/',
      transport: 'streamable-http',
      exactEndpointOnly: true,
    });

    expect(variants).toEqual([
      { url: 'https://mcp.example.com/', transport: 'streamable-http' },
    ]);
    expect(variants.some(({ url }) => url.endsWith('/mcp'))).toBe(false);
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

describe('catalog seed provenance validation', () => {
  it('accepts HTTPS publisher evidence and exact MCP Registry records', () => {
    expect(validateCatalogSeed({
      id: 'publisher',
      listingSource: { kind: 'publisher', url: 'https://example.com/mcp' },
    })).toMatchObject({ id: 'publisher' });

    const registryUrl = 'https://registry.modelcontextprotocol.io/v0.1/servers/example';
    expect(validateCatalogSeed({
      id: 'registry',
      registryUrl,
      listingSource: { kind: 'mcp-registry', url: registryUrl },
    })).toMatchObject({ id: 'registry' });
  });

  it.each([
    [{ id: 'missing' }, 'listingSource is required'],
    [
      { id: 'kind', listingSource: { kind: 'verified' } },
      'listingSource.kind must be publisher, mcp-registry, or community',
    ],
    [
      { id: 'http', listingSource: { kind: 'community', url: 'http://example.com' } },
      'listingSource.url must be a valid HTTPS URL',
    ],
    [
      {
        id: 'mismatch',
        registryUrl: 'https://registry.modelcontextprotocol.io/v0.1/servers/a',
        listingSource: {
          kind: 'mcp-registry',
          url: 'https://registry.modelcontextprotocol.io/v0.1/servers/b',
        },
      },
      'MCP Registry provenance must reuse registryUrl',
    ],
  ])('rejects invalid provenance: %s', (seed, message) => {
    expect(() => validateCatalogSeed(seed)).toThrow(message);
  });

  it('validates typed OAuth registration evidence and its alternative auth link', () => {
    const registration = {
      mode: 'pre-registered-required',
      clientId: { required: true, environmentVariable: 'EXAMPLE_CLIENT_ID' },
      clientSecret: { required: true, environmentVariable: 'EXAMPLE_CLIENT_SECRET' },
      callback: {
        required: true,
        redirectUrls: { 'vs-code': ['http://127.0.0.1:33418/'] },
      },
      evidenceUrl: 'https://example.com/oauth-registration',
    };
    expect(validateCatalogSeed({
      id: 'oauth-server', requiresOAuth: true, authType: 'oauth',
      listingSource: { kind: 'publisher', url: registration.evidenceUrl },
      oauthRegistration: registration,
    }).oauthRegistration).toEqual(registration);

    expect(() => validateCatalogSeed({
      id: 'bad-callback', requiresOAuth: true, authType: 'oauth',
      listingSource: { kind: 'publisher', url: registration.evidenceUrl },
      oauthRegistration: {
        ...registration,
        callback: { required: true, redirectUrls: { cursor: ['not-a-url'] } },
      },
    })).toThrow('OAuth callback URLs must be absolute and credential-free');

    expect(() => validateCatalogSeed({
      id: 'missing-alternative', requiresOAuth: true, authType: 'oauth',
      listingSource: { kind: 'publisher', url: registration.evidenceUrl },
      alternativeAuthTypes: ['api-token'],
      oauthRegistration: {
        ...registration,
        mode: 'unavailable-or-use-alternative',
        alternativeAuthType: 'api-key',
      },
    })).toThrow('requires a cataloged alternativeAuthType');
  });

  it.each([
    ['wrong host', 'http://127.0.0.1:3334/oauth/callback'],
    ['wrong path', 'http://localhost:3334/wrong-path'],
  ])('rejects Codex bridge evidence with a same-port %s redirect', (_case, redirectUrl) => {
    const callbackUrl = 'http://localhost:3334/oauth/callback';
    expect(() => validateCatalogSeed({
      id: 'bad-codex-callback',
      requiresOAuth: true,
      authType: 'oauth',
      listingSource: { kind: 'publisher', url: 'https://example.com/oauth' },
      oauthRegistration: {
        mode: 'pre-registered-required',
        clientId: { required: true },
        clientSecret: { required: true },
        callback: {
          required: true,
          redirectUrls: { 'codex-cli': [redirectUrl] },
        },
        codexMcpRemote: {
          resourceUrl: 'https://example.com',
          callbackUrl,
          callbackPort: 3334,
        },
        evidenceUrl: 'https://example.com/oauth',
      },
    })).toThrow('callbackUrl must exactly match a Codex redirect URL');
  });

  it('keeps the Codex callback port consistent with the exact callback URL', () => {
    const callbackUrl = 'http://localhost:3334/oauth/callback';
    expect(() => validateCatalogSeed({
      id: 'bad-codex-port',
      requiresOAuth: true,
      authType: 'oauth',
      listingSource: { kind: 'publisher', url: 'https://example.com/oauth' },
      oauthRegistration: {
        mode: 'pre-registered-required',
        clientId: { required: true },
        clientSecret: { required: true },
        callback: { required: true, redirectUrls: { 'codex-cli': [callbackUrl] } },
        codexMcpRemote: {
          resourceUrl: 'https://example.com',
          callbackUrl,
          callbackPort: 4444,
        },
        evidenceUrl: 'https://example.com/oauth',
      },
    })).toThrow('callbackPort must match callbackUrl');
  });

  it('accepts the production Asana and PagerDuty OAuth registration evidence', () => {
    for (const serverId of ['asana', 'pagerduty']) {
      const seed = catalogSeeds.find(({ id }) => id === serverId);
      expect(seed).toBeDefined();
      expect(validateCatalogSeed(seed).oauthRegistration).toBeDefined();
    }
    const pagerduty = catalogSeeds.find(({ id }) => id === 'pagerduty');
    expect(pagerduty.oauthRegistration).toMatchObject({
      clientId: { required: false },
      clientSecret: { required: false },
      callback: { required: false, redirectUrls: {} },
      alternativeAuthType: 'api-token',
    });
  });
});

describe('catalog protocol validation', () => {
  it('retains a successful capability snapshot through later auth and network failures', () => {
    const snapshot = { version: 1, observedAt: '2026-08-17T22:00:00.000Z' };
    const previous = { secure: snapshot };
    const retained = mergeCapabilitySnapshots(previous, [
      { serverId: 'secure', status: 'online', errorCode: 'authentication_required' },
      { serverId: 'offline', status: 'offline', errorCode: 'network_error' },
    ]);

    expect(retained.secure).toBe(snapshot);
    expect(retained.secure.observedAt).toBe('2026-08-17T22:00:00.000Z');
  });

  it('negotiates a stateless 2026 Streamable HTTP server', async () => {
    const requests = [];
    const fetch = async (_input, init = {}) => {
      const body = JSON.parse(String(init.body));
      requests.push({ body, headers: new Headers(init.headers) });
      const result = body.method === 'server/discover'
        ? { supportedVersions: ['2026-07-28'], capabilities: { tools: {} } }
        : { [body.method === 'resources/templates/list' ? 'resourceTemplates' : body.method.split('/')[0]]: [] };
      return jsonRpcResponse(body, result);
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
    expect(requests.map(({ body }) => body.method)).toEqual([
      'server/discover', 'tools/list', 'resources/list', 'resources/templates/list', 'prompts/list',
    ]);
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

      const result = body.method === 'initialize' ? {
        protocolVersion: '2025-06-18',
        capabilities: { tools: {} },
        serverInfo: { name: 'stateful-test-server', version: '1.0.0' },
      } : {
        [body.method === 'resources/templates/list' ? 'resourceTemplates' : body.method.split('/')[0]]: [],
      };
      return jsonRpcResponse(body, result, {
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
      'tools/list',
      'resources/list',
      'resources/templates/list',
      'prompts/list',
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
        listingSource: { kind: 'community' },
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
      } else if ('id' in body) {
        const itemKey = body.method === 'resources/templates/list'
          ? 'resourceTemplates'
          : body.method.split('/')[0];
        streamController.enqueue(encoder.encode(`event: message\ndata: ${JSON.stringify({
          jsonrpc: '2.0', id: body.id, result: { [itemKey]: [] },
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
    expect(methods).toEqual([
      'initialize', 'notifications/initialized', 'tools/list', 'resources/list',
      'resources/templates/list', 'prompts/list',
    ]);
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

describe('catalog capability pagination and persistence', () => {
  it('runs the actual catalog package command through its TypeScript-aware entry point', () => {
    const npm = process.platform === 'win32' ? 'npm.cmd' : 'npm';
    const output = execFileSync(
      npm,
      ['run', 'validate-catalog', '--', '--check-runtime'],
      { cwd: path.join(import.meta.dirname, '..'), encoding: 'utf8' }
    );

    expect(output).toContain('Catalog validator runtime is ready.');
  });

  it('uses actual Client transport behavior for multi-page success', async () => {
    const requests = [];
    const client = await connectedClient((method, params) => {
      requests.push({ method, params });
      if (method !== 'tools/list') throw new Error(`Unexpected method ${method}`);
      return params?.cursor === 'tools-2'
        ? { tools: [{ name: 'second_tool', inputSchema: { type: 'object' } }] }
        : {
          tools: [{ name: 'first_tool', inputSchema: { type: 'object' } }],
          nextCursor: 'tools-2',
        };
    });
    try {
      const result = await paginateDiscovery(client, 'tools', 'tools/list', 1_000);
      expect(result).toMatchObject({ status: 'complete', paginationComplete: true });
      expect(result.values.map(({ name }) => name)).toEqual(['first_tool', 'second_tool']);
      expect(requests).toEqual([
        { method: 'tools/list', params: undefined },
        { method: 'tools/list', params: { cursor: 'tools-2' } },
      ]);
    } finally {
      await client.close();
    }
  });

  it('treats an absent cursor from the actual Client as complete', async () => {
    const client = await connectedClient(() => ({
      tools: [{ name: 'only_tool', inputSchema: { type: 'object' } }],
    }));
    try {
      const result = await paginateDiscovery(client, 'tools', 'tools/list', 1_000);
      expect(result).toMatchObject({ status: 'complete', paginationComplete: true });
      expect(result.values.map(({ name }) => name)).toEqual(['only_tool']);
    } finally {
      await client.close();
    }
  });

  it.each([
    ['null', null],
    ['empty string', ''],
    ['number', 42],
    ['array', ['tools-2']],
    ['object', { cursor: 'tools-2' }],
  ])('retains an actual Client first page with a malformed %s cursor', async (_label, nextCursor) => {
    const client = await connectedClient(() => ({
      tools: [{ name: 'retained_tool', inputSchema: { type: 'object' } }],
      nextCursor,
    }));
    try {
      const result = await paginateDiscovery(client, 'tools', 'tools/list', 1_000);
      expect(result).toMatchObject({ status: 'partial', paginationComplete: false });
      expect(result.values.map(({ name }) => name)).toEqual(['retained_tool']);
    } finally {
      await client.close();
    }
  });

  it.each([
    ['null', null],
    ['empty string', ''],
    ['number', 42],
    ['array', ['tools-3']],
    ['object', { cursor: 'tools-3' }],
  ])('retains actual Client pages through a later malformed %s cursor', async (_label, nextCursor) => {
    const client = await connectedClient((_method, params) => params?.cursor
      ? {
        tools: [{ name: 'second_tool', inputSchema: { type: 'object' } }],
        nextCursor,
      }
      : {
        tools: [{ name: 'first_tool', inputSchema: { type: 'object' } }],
        nextCursor: 'tools-2',
      });
    try {
      const result = await paginateDiscovery(client, 'tools', 'tools/list', 1_000);
      expect(result).toMatchObject({ status: 'partial', paginationComplete: false });
      expect(result.values.map(({ name }) => name)).toEqual(['first_tool', 'second_tool']);
    } finally {
      await client.close();
    }
  });

  it('retains actual Client pages and marks a repeated cursor partial', async () => {
    const client = await connectedClient((_method, params) => params?.cursor
      ? {
        tools: [{ name: 'second_tool', inputSchema: { type: 'object' } }],
        nextCursor: 'tools-2',
      }
      : {
        tools: [{ name: 'first_tool', inputSchema: { type: 'object' } }],
        nextCursor: 'tools-2',
      });
    try {
      const result = await paginateDiscovery(client, 'tools', 'tools/list', 1_000);
      expect(result).toMatchObject({ status: 'partial', paginationComplete: false });
      expect(result.values.map(({ name }) => name)).toEqual(['first_tool', 'second_tool']);
    } finally {
      await client.close();
    }
  });

  it('retains page one with partial status when actual Client page two fails', async () => {
    const client = await connectedClient((_method, params) => {
      if (params?.cursor) throw new Error('page two unavailable');
      return {
        tools: [{ name: 'retained_tool', inputSchema: { type: 'object' } }],
        nextCursor: 'tools-2',
      };
    });
    try {
      const result = await paginateDiscovery(client, 'tools', 'tools/list', 1_000);
      expect(result).toMatchObject({ status: 'partial', paginationComplete: false });
      expect(result.values.map(({ name }) => name)).toEqual(['retained_tool']);
    } finally {
      await client.close();
    }
  });

  it('marks a page-two method-not-found partial after an empty successful first page', async () => {
    const client = await connectedClient((_method, params) => {
      if (params?.cursor) throw new Error('Method not found');
      return { tools: [], nextCursor: 'tools-2' };
    });
    try {
      const result = await paginateDiscovery(client, 'tools', 'tools/list', 1_000);
      expect(result).toEqual({ status: 'partial', values: [], paginationComplete: false });
    } finally {
      await client.close();
    }
  });

  it('writes only canonical sanitized inventories and preserves the last snapshot on rejection', async () => {
    const githubToken = `ghp_${'a'.repeat(36)}`;
    const stripeKey = `sk_live_${'b'.repeat(24)}`;
    const quotedSecret = 'quoted catalog secret';
    const rawPages = {
      'tools/list': {
        tools: [{
          name: 'safe_tool',
          description: `client_secret="${quotedSecret}" id_token=beta private_key=gamma passwd=delta ${githubToken}`,
          inputSchema: { type: 'object' },
          unknownToolField: 'discard me',
        }, { name: githubToken }],
      },
      'resources/list': {
        resources: [
          { name: '<script>alert(1)</script>', mimeType: 'text/html' },
          { name: stripeKey },
          { name: 'Safe resource', mimeType: 'definitely not a MIME type', unknown: true },
        ],
      },
      'resources/templates/list': {
        resourceTemplates: [
          { name: '<img src=x onerror=alert(1)>', mimeType: 'text/plain' },
          { name: 'Safe template', mimeType: 'application/json', uriTemplate: 'secret://tenant/{id}' },
        ],
      },
      'prompts/list': { prompts: [{ name: 'safe_prompt', unknownPromptField: true }] },
    };
    const inventory = await discoverPublicInventory(
      { request: async ({ method }) => rawPages[method] },
      `https://example.com/mcp?access_token=secret&sig=${stripeKey}`,
      1_000
    );

    expect(inventory).toBeDefined();
    expect(inventory.provenance.testedEndpoint).toBe('https://example.com/mcp');
    expect(inventory.tools.items[0].description).toBe(
      'client_secret=[REDACTED] id_token=[REDACTED] private_key=[REDACTED] passwd=[REDACTED] [REDACTED]'
    );
    expect(inventory.resources.items).toEqual([
      { name: '[REDACTED]' },
      { name: 'Safe resource' },
    ]);
    expect(inventory.resourceTemplates.items).toEqual([
      { name: 'Safe template', mimeType: 'application/json' },
    ]);
    expect(JSON.stringify(inventory)).not.toMatch(/<script|onerror|unknownToolField|unknownPromptField|tenant/);
    expect(validateCapabilityInventory(inventory)).toEqual(inventory);

    const directory = fs.mkdtempSync(path.join(os.tmpdir(), 'mcptest-catalog-'));
    const capabilities = path.join(directory, 'catalogCapabilities.json');
    const validation = path.join(directory, 'catalogValidation.json');
    fs.writeFileSync(capabilities, '{}\n');
    try {
      await writeResults(
        [{ serverId: 'safe', status: 'online', capabilityInventory: inventory }],
        { capabilities, validation }
      );
      const written = JSON.parse(fs.readFileSync(capabilities, 'utf8'));
      expect(validateCapabilityInventory(written.safe)).toEqual(written.safe);
      const persisted = JSON.stringify(written);
      for (const secret of [githubToken, stripeKey, quotedSecret]) {
        expect(persisted).not.toContain(secret);
      }

      const lastSuccessfulSnapshot = fs.readFileSync(capabilities, 'utf8');
      await expect(writeResults(
        [{
          serverId: 'unsafe', status: 'online',
          capabilityInventory: { ...inventory, unknownInventoryField: true },
        }],
        { capabilities, validation }
      )).rejects.toThrow('unsafe or non-canonical');
      expect(fs.readFileSync(capabilities, 'utf8')).toBe(lastSuccessfulSnapshot);
    } finally {
      fs.rmSync(directory, { recursive: true, force: true });
    }
  });

  it('drops capability snapshots for servers absent from the current validation batch', async () => {
    const directory = fs.mkdtempSync(path.join(os.tmpdir(), 'mcptest-catalog-prune-'));
    const capabilities = path.join(directory, 'catalogCapabilities.json');
    const validation = path.join(directory, 'catalogValidation.json');
    const inventory = {
      version: 1,
      observedAt: '2026-08-17T22:00:00.000Z',
      provenance: { testedEndpoint: 'https://removed.example/mcp', route: 'direct' },
      authentication: 'unauthenticated',
      tools: { status: 'complete', observedCount: 0, retainedCount: 0, omittedCount: 0, paginationComplete: true, items: [] },
      resources: { status: 'complete', observedCount: 0, retainedCount: 0, omittedCount: 0, paginationComplete: true, items: [] },
      resourceTemplates: { status: 'complete', observedCount: 0, retainedCount: 0, omittedCount: 0, paginationComplete: true, items: [] },
      prompts: { status: 'complete', observedCount: 0, retainedCount: 0, omittedCount: 0, paginationComplete: true, items: [] },
    };
    fs.writeFileSync(capabilities, `${JSON.stringify({ removed: inventory }, null, 2)}\n`);
    try {
      await writeResults(
        [{ serverId: 'remaining', status: 'online' }],
        { capabilities, validation }
      );
      expect(JSON.parse(fs.readFileSync(capabilities, 'utf8'))).toEqual({});
    } finally {
      fs.rmSync(directory, { recursive: true, force: true });
    }
  });

  it('deterministically trims a successful aggregate inventory instead of dropping it', async () => {
    const description = 'x'.repeat(600);
    const items = (prefix) => Array.from({ length: 100 }, (_, index) => ({
      name: `${prefix}_${String(index).padStart(3, '0')}`,
      description,
    }));
    const pages = {
      'tools/list': { tools: items('tool') },
      'resources/list': { resources: items('resource') },
      'resources/templates/list': { resourceTemplates: items('template') },
      'prompts/list': { prompts: items('prompt') },
    };
    const client = { request: async ({ method }) => pages[method] };

    const first = await discoverPublicInventory(client, 'https://example.com/mcp', 1_000);
    const second = await discoverPublicInventory(client, 'https://example.com/mcp', 1_000);

    expect(first).toBeDefined();
    expect(new TextEncoder().encode(JSON.stringify(first)).length).toBeLessThanOrEqual(96_000);
    expect(first.tools.observedCount).toBe(100);
    expect(first.tools.retainedCount + first.tools.omittedCount).toBe(100);
    expect(Object.values(first).filter((value) => value?.status === 'partial').length).toBeGreaterThan(0);
    expect({ ...second, observedAt: first.observedAt }).toEqual(first);
  });
});
