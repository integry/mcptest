import {
  createMcpHandler, McpServer,
  hostHeaderValidationResponse, originValidationResponse,
} from '@modelcontextprotocol/server';
import { z } from 'zod';
import { setTimeout as delay } from 'node:timers/promises';

const publicUrl = new URL(process.env.PUBLIC_URL ?? 'http://localhost:3000/mcp');
const origins = ['https://mcptest.io'];
const mcp = createMcpHandler(() => {
  const server = new McpServer({ name: 'deploy-echo', version: '1.0.0' });
  server.registerTool('echo', {
    description: 'Echo text after an optional short delay',
    inputSchema: z.object({ text: z.string().max(200), waitMs: z.number().int().min(0).max(1000).default(0) }),
    annotations: { readOnlyHint: true },
  }, async ({ text, waitMs }, ctx) => {
    const progressToken = ctx.mcpReq._meta?.progressToken;
    if (progressToken !== undefined) {
      await ctx.mcpReq.notify({ method: 'notifications/progress', params: { progressToken, progress: 0, total: 1 } });
    }
    await delay(waitMs, undefined, { signal: ctx.mcpReq.signal });
    return { content: [{ type: 'text', text }] };
  });
  return server;
}, { legacy: 'stateless' });

function cors(request, response) {
  const headers = new Headers(response.headers);
  headers.set('Cache-Control', 'no-store');
  headers.append('Vary', 'Origin');
  if (origins.includes(request.headers.get('Origin'))) {
    headers.set('Access-Control-Allow-Origin', request.headers.get('Origin'));
    headers.set('Access-Control-Allow-Methods', 'POST, GET, DELETE, OPTIONS');
    headers.set('Access-Control-Allow-Headers', 'Content-Type, Accept, Authorization, MCP-Protocol-Version, Mcp-Method, Mcp-Name, Mcp-Session-Id, Last-Event-ID');
    headers.set('Access-Control-Expose-Headers', 'WWW-Authenticate, MCP-Protocol-Version, Mcp-Session-Id, Retry-After');
  }
  return new Response(response.body, { status: response.status, headers });
}

export default {
  async fetch(request) {
    const rejected = hostHeaderValidationResponse(request, [publicUrl.hostname])
      ?? originValidationResponse(request, origins.map(origin => new URL(origin).hostname));
    if (rejected) return cors(request, rejected);
    const path = new URL(request.url).pathname;
    if (path === '/healthz') return cors(request, new Response('ok'));
    if (path !== '/mcp') return cors(request, new Response('Not found', { status: 404 }));
    if (request.method === 'OPTIONS') return cors(request, new Response(null, { status: 204 }));
    return cors(request, await mcp.fetch(request));
  },
};
