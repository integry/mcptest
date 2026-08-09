import type { JSONRPCMessage, Transport } from '@modelcontextprotocol/client';
import { describe, expect, it } from 'vitest';
import {
  CorsAwareStreamableHTTPTransport,
  withRequestHeaders,
} from './corsAwareTransport';
import {
  createLegacyMcpClient,
  createNegotiatingMcpClient,
  getProtocolDetails,
} from './mcpClient';

class ScriptedTransport implements Transport {
  onclose?: () => void;
  onerror?: (error: Error) => void;
  onmessage?: (message: JSONRPCMessage) => void;
  readonly methods: string[] = [];

  constructor(private readonly modern: boolean) {}

  async start(): Promise<void> {}

  async send(message: JSONRPCMessage): Promise<void> {
    if (!('method' in message)) {
      return;
    }

    this.methods.push(message.method);
    if (!('id' in message)) {
      return;
    }

    const response: JSONRPCMessage = message.method === 'server/discover'
      ? this.modern
        ? {
            jsonrpc: '2.0',
            id: message.id,
            result: {
              supportedVersions: ['2026-07-28'],
              capabilities: { tools: {} },
            },
          }
        : {
            jsonrpc: '2.0',
            id: message.id,
            error: { code: -32601, message: 'Method not found' },
          }
      : {
          jsonrpc: '2.0',
          id: message.id,
          result: {
            protocolVersion: '2025-06-18',
            capabilities: { tools: {} },
            serverInfo: { name: 'legacy-test-server', version: '1.0.0' },
          },
        };

    queueMicrotask(() => this.onmessage?.(response));
  }

  async close(): Promise<void> {
    this.onclose?.();
  }
}

describe('MCP protocol compatibility', () => {
  it('negotiates a stateless 2026 server', async () => {
    const client = createNegotiatingMcpClient('modern-test');
    const transport = new ScriptedTransport(true);

    await client.connect(transport);

    expect(transport.methods).toEqual(['server/discover']);
    expect(getProtocolDetails(client)).toEqual({
      era: 'modern',
      version: '2026-07-28',
    });
    await client.close();
  });

  it('falls back to the stateful initialize flow for a 2025 server', async () => {
    const client = createNegotiatingMcpClient('legacy-fallback-test');
    const transport = new ScriptedTransport(false);

    await client.connect(transport);

    expect(transport.methods).toEqual([
      'server/discover',
      'initialize',
      'notifications/initialized',
    ]);
    expect(getProtocolDetails(client)).toEqual({
      era: 'legacy',
      version: '2025-06-18',
    });
    await client.close();
  });

  it('keeps deprecated SSE clients on the legacy flow', async () => {
    const client = createLegacyMcpClient('sse-test');
    const transport = new ScriptedTransport(false);

    await client.connect(transport);

    expect(transport.methods).toEqual(['initialize', 'notifications/initialized']);
    expect(client.getProtocolEra()).toBe('legacy');
    await client.close();
  });

  it('sends stateless MCP headers over Streamable HTTP', async () => {
    const requests: Array<{ body: any; headers: Headers }> = [];
    const fetch = async (_input: RequestInfo | URL, init?: RequestInit): Promise<Response> => {
      const body = JSON.parse(String(init?.body));
      const headers = new Headers(init?.headers);
      requests.push({ body, headers });

      const result = body.method === 'server/discover'
        ? { supportedVersions: ['2026-07-28'], capabilities: { tools: {} } }
        : {
            resultType: 'complete',
            ttlMs: 0,
            cacheScope: 'private',
            tools: [],
          };

      return new Response(JSON.stringify({ jsonrpc: '2.0', id: body.id, result }), {
        headers: { 'Content-Type': 'application/json' },
      });
    };
    const client = createNegotiatingMcpClient('modern-http-test');
    const transport = new CorsAwareStreamableHTTPTransport(
      new URL('https://example.com/mcp'),
      { fetch }
    );

    await client.connect(transport);
    await client.listTools();

    expect(requests.map(({ body }) => body.method)).toEqual([
      'server/discover',
      'tools/list',
    ]);
    expect(requests[0].headers.get('mcp-protocol-version')).toBe('2026-07-28');
    expect(requests[0].headers.get('mcp-method')).toBe('server/discover');
    expect(requests[1].headers.get('mcp-protocol-version')).toBe('2026-07-28');
    expect(requests[1].headers.get('mcp-method')).toBe('tools/list');
    expect(requests[1].headers.has('mcp-session-id')).toBe(false);
    await client.close();
  });

  it('preserves stateful session headers after HTTP fallback', async () => {
    const requests: Array<{ body: any; headers: Headers }> = [];
    const fetch = async (_input: RequestInfo | URL, init?: RequestInit): Promise<Response> => {
      if (init?.method === 'DELETE') {
        return new Response(null, { status: 200 });
      }

      const body = JSON.parse(String(init?.body));
      const headers = new Headers(init?.headers);
      requests.push({ body, headers });

      if (body.method === 'server/discover') {
        return new Response('Not found', { status: 404 });
      }
      if (!('id' in body)) {
        return new Response(null, { status: 202 });
      }

      const result = body.method === 'initialize'
        ? {
            protocolVersion: '2025-06-18',
            capabilities: { tools: {} },
            serverInfo: { name: 'stateful-http-server', version: '1.0.0' },
          }
        : { tools: [] };
      const responseHeaders: Record<string, string> = {
        'Content-Type': 'application/json',
      };
      if (body.method === 'initialize') {
        responseHeaders['Mcp-Session-Id'] = 'session-123';
      }

      return new Response(JSON.stringify({ jsonrpc: '2.0', id: body.id, result }), {
        headers: responseHeaders,
      });
    };
    const client = createNegotiatingMcpClient('stateful-http-test');
    const transport = new CorsAwareStreamableHTTPTransport(
      new URL('https://example.com/mcp'),
      { fetch }
    );

    await client.connect(transport);
    await client.listTools();

    expect(requests.map(({ body }) => body.method)).toEqual([
      'server/discover',
      'initialize',
      'notifications/initialized',
      'tools/list',
    ]);
    expect(requests[0].headers.get('mcp-method')).toBe('server/discover');
    expect(requests[1].headers.has('mcp-method')).toBe(false);
    expect(requests[1].headers.has('mcp-protocol-version')).toBe(false);
    expect(requests[3].headers.get('mcp-session-id')).toBe('session-123');
    expect(requests[3].headers.get('mcp-protocol-version')).toBe('2025-06-18');
    expect(client.getProtocolEra()).toBe('legacy');
    await client.close();
  });

  it('merges caller headers into SDK request options', () => {
    const requestInit = withRequestHeaders(
      { headers: { Accept: 'application/json' } },
      { Authorization: 'Bearer test-token' }
    );
    const headers = new Headers(requestInit?.headers);

    expect(headers.get('accept')).toBe('application/json');
    expect(headers.get('authorization')).toBe('Bearer test-token');
  });
});
