#!/usr/bin/env node

/**
 * A dependency-free Streamable HTTP MCP server for the end-to-end smoke suite.
 * The path selects the protocol flow and, optionally, a deliberate misbehavior:
 *
 *   /2026/mcp            2026-07-28 stateless: answers server/discover, keeps no session
 *   /2025/mcp            2025-11-25 stateful: initialize issues an Mcp-Session-Id
 *   /session-replicas/mcp stateful; alternating ping requests lose the session
 *   /accept-406/mcp      rejects the spec Accept header with HTTP 406
 *   /no-expose/mcp       stateful, but the session id is not listed in Access-Control-Expose-Headers
 *   /rate-limited/mcp    HTTP 429 with a readable Retry-After
 *
 * Every flow serves the same two tools (one with outputSchema returning
 * structuredContent, one that returns isError), one resource and one prompt.
 *
 *   node tests/e2e/mock-mcp-server.mjs [--port 4180] [--host 127.0.0.1]
 */

import http from 'node:http';
import path from 'node:path';
import { randomUUID } from 'node:crypto';
import { fileURLToPath } from 'node:url';

export const STATELESS_VERSION = '2026-07-28';
export const STATEFUL_VERSION = '2025-11-25';
const LEGACY_VERSIONS = [STATEFUL_VERSION, '2025-06-18', '2025-03-26', '2024-11-05'];
export const RATE_LIMIT_RETRY_AFTER_SECONDS = 120;
const UNSUPPORTED_PROTOCOL_VERSION = -32022;

const SERVER_INFO = { name: 'mcptest-e2e-mock', version: '1.0.0' };
const CAPABILITIES = { tools: {}, resources: {}, prompts: {} };

export const TOOLS = [
  {
    name: 'get_forecast',
    title: 'Get forecast',
    description: 'Returns a structured weather forecast for a city.',
    inputSchema: {
      type: 'object',
      properties: { city: { type: 'string', description: 'City name' } },
      required: ['city'],
      additionalProperties: false,
    },
    outputSchema: {
      type: 'object',
      properties: {
        city: { type: 'string' },
        temperatureC: { type: 'number' },
        conditions: { type: 'string' },
      },
      required: ['city', 'temperatureC', 'conditions'],
      additionalProperties: false,
    },
    annotations: { readOnlyHint: true, openWorldHint: false },
  },
  {
    name: 'always_fails',
    title: 'Always fails',
    description: 'Returns a tool execution error result (isError: true).',
    inputSchema: { type: 'object', properties: {}, additionalProperties: false },
    annotations: { readOnlyHint: true, openWorldHint: false },
  },
];

export const RESOURCES = [
  { uri: 'mock://docs/readme', name: 'readme', title: 'Mock readme', mimeType: 'text/markdown' },
];

export const PROMPTS = [
  {
    name: 'greeting',
    title: 'Greeting',
    description: 'Greets someone by name.',
    arguments: [{ name: 'name', description: 'Who to greet', required: true }],
  },
];

const MODES = new Set(['2026', '2025', 'accept-406', 'no-expose', 'rate-limited', 'session-replicas']);
const STATEFUL_MODES = new Set(['2025', 'no-expose', 'session-replicas']);
const EXPOSED_HEADERS = 'Mcp-Session-Id, MCP-Protocol-Version, Retry-After, WWW-Authenticate';

class RpcError extends Error {
  constructor(code, message, data) {
    super(message);
    this.code = code;
    this.data = data;
  }
}

// 2026-07-28 results carry a resultType, cache fields on cacheable methods,
// and the server identity in _meta, since there is no initialize to carry it.
const CACHEABLE_METHODS = new Set(['server/discover', 'tools/list', 'prompts/list', 'resources/list', 'resources/templates/list', 'resources/read']);
const encodeStateless = (method, result) => ({
  ...result,
  resultType: 'complete',
  ...(CACHEABLE_METHODS.has(method) ? { ttlMs: 0, cacheScope: 'private' } : {}),
  _meta: { 'io.modelcontextprotocol/serverInfo': SERVER_INFO },
});

const textResult = (text, extra = {}) => ({ content: [{ type: 'text', text }], ...extra });

function callTool(params) {
  const name = params?.name;
  const args = params?.arguments ?? {};
  if (name === 'get_forecast') {
    const forecast = { city: String(args.city ?? 'Tallinn'), temperatureC: 12.5, conditions: 'Light rain' };
    return textResult(JSON.stringify(forecast), { structuredContent: forecast });
  }
  if (name === 'always_fails') {
    return textResult('The forecast service is unavailable (mock failure).', { isError: true });
  }
  throw new RpcError(-32602, `Unknown tool: ${name}`);
}

/** Results for the methods both flows share. */
function handleMethod(method, params) {
  switch (method) {
    case 'ping': return {};
    case 'tools/list': return { tools: TOOLS };
    case 'tools/call': return callTool(params);
    case 'resources/list': return { resources: RESOURCES };
    case 'resources/templates/list': return { resourceTemplates: [] };
    case 'resources/read': {
      if (params?.uri !== RESOURCES[0].uri) throw new RpcError(-32002, `Resource not found: ${params?.uri}`);
      return { contents: [{ uri: RESOURCES[0].uri, mimeType: 'text/markdown', text: '# Mock readme\n\nServed by the e2e mock.' }] };
    }
    case 'prompts/list': return { prompts: PROMPTS };
    case 'prompts/get': {
      if (params?.name !== 'greeting') throw new RpcError(-32602, `Unknown prompt: ${params?.name}`);
      const who = params?.arguments?.name ?? 'there';
      return { description: 'A greeting', messages: [{ role: 'user', content: { type: 'text', text: `Say hello to ${who}.` } }] };
    }
    case 'logging/setLevel': return {};
    default: throw new RpcError(-32601, `Method not found: ${method}`);
  }
}

const corsHeaders = (request, mode) => ({
  'Access-Control-Allow-Origin': request.headers.origin || '*',
  'Access-Control-Allow-Methods': 'GET, POST, DELETE, OPTIONS',
  'Access-Control-Allow-Headers': request.headers['access-control-request-headers'] || 'Content-Type, Authorization, Mcp-Session-Id, MCP-Protocol-Version, Last-Event-ID',
  'Access-Control-Max-Age': '600',
  ...(mode === 'no-expose' ? {} : { 'Access-Control-Expose-Headers': EXPOSED_HEADERS }),
  Vary: 'Origin',
});

const readBody = request => new Promise((resolve, reject) => {
  const chunks = [];
  request.on('data', chunk => chunks.push(chunk));
  request.on('end', () => resolve(Buffer.concat(chunks).toString('utf8')));
  request.on('error', reject);
});

const acceptsBoth = (accept = '') => accept.includes('application/json') && accept.includes('text/event-stream');

export function createMockMcpServer({ log = () => {} } = {}) {
  /** session id → negotiated protocol version, per stateful mode. */
  const sessions = new Map();
  const requests = [];
  const replicaPings = new Map();

  const server = http.createServer(async (request, response) => {
    const url = new URL(request.url, 'http://localhost');
    const match = url.pathname.match(/^\/([^/]+)\/mcp\/?$/);
    const mode = match && MODES.has(match[1]) ? match[1] : undefined;
    const cors = corsHeaders(request, mode);
    const send = (status, body, headers = {}) => {
      const payload = body === undefined ? undefined : JSON.stringify(body);
      response.writeHead(status, {
        ...cors,
        ...(payload === undefined ? {} : { 'Content-Type': 'application/json' }),
        ...headers,
      });
      response.end(payload);
    };
    const rpcError = (status, id, code, message, headers, data) => send(
      status,
      { jsonrpc: '2.0', id: id ?? null, error: { code, message, ...(data ? { data } : {}) } },
      headers
    );

    if (url.pathname === '/health') {
      send(200, { ok: true });
      return;
    }
    if (!mode) {
      response.writeHead(404, { ...cors, 'Content-Type': 'text/plain' }).end('Not found');
      return;
    }
    if (request.method === 'OPTIONS') {
      response.writeHead(204, cors).end();
      return;
    }

    const body = request.method === 'POST' ? await readBody(request) : '';
    let message;
    try {
      message = body ? JSON.parse(body) : undefined;
    } catch {
      rpcError(400, null, -32700, 'Parse error');
      return;
    }
    const rpcMethod = Array.isArray(message) ? 'batch' : message?.method;
    requests.push({ mode, method: request.method, rpcMethod, sessionId: request.headers['mcp-session-id'] });
    log(`${mode} ${request.method} ${rpcMethod ?? ''}`);

    if (mode === 'rate-limited') {
      rpcError(429, message?.id, -32000, 'Rate limited', { 'Retry-After': String(RATE_LIMIT_RETRY_AFTER_SECONDS) });
      return;
    }
    if (mode === 'accept-406') {
      // A deliberately strict check: only a bare application/json is accepted,
      // so every spec-compliant client is refused.
      if ((request.headers.accept || '').trim() !== 'application/json') {
        rpcError(406, message?.id, -32000, 'Not Acceptable: Client must accept application/json');
        return;
      }
    }

    const stateful = STATEFUL_MODES.has(mode);
    if (request.method === 'GET') {
      // No server-initiated stream; the spec allows 405 here.
      response.writeHead(405, { ...cors, Allow: stateful ? 'POST, DELETE' : 'POST' }).end();
      return;
    }
    if (request.method === 'DELETE') {
      const sessionId = request.headers['mcp-session-id'];
      if (stateful && sessionId && sessions.delete(`${mode}:${sessionId}`)) {
        replicaPings.delete(sessionId);
        response.writeHead(204, cors).end();
      } else {
        response.writeHead(stateful ? 404 : 405, cors).end();
      }
      return;
    }
    if (request.method !== 'POST') {
      response.writeHead(405, { ...cors, Allow: 'POST' }).end();
      return;
    }
    if (!acceptsBoth(request.headers.accept)) {
      rpcError(406, message?.id, -32000, 'Not Acceptable: Client must accept both application/json and text/event-stream');
      return;
    }
    if (!message || Array.isArray(message) || message.jsonrpc !== '2.0' || typeof message.method !== 'string') {
      rpcError(400, message?.id, -32600, 'Invalid Request');
      return;
    }

    const isNotification = message.id === undefined;
    const params = message.params;

    if (stateful) {
      if (message.method === 'initialize') {
        const requested = params?.protocolVersion;
        const protocolVersion = LEGACY_VERSIONS.includes(requested) ? requested : STATEFUL_VERSION;
        const sessionId = randomUUID();
        sessions.set(`${mode}:${sessionId}`, protocolVersion);
        send(200, {
          jsonrpc: '2.0',
          id: message.id,
          result: { protocolVersion, capabilities: CAPABILITIES, serverInfo: SERVER_INFO, instructions: 'Mock server for mcptest end-to-end tests.' },
        }, { 'Mcp-Session-Id': sessionId, 'MCP-Protocol-Version': protocolVersion });
        return;
      }
      // Like the official SDK: anything before initialize, or without a known
      // session, is a 400 that names the missing session id.
      const sessionId = request.headers['mcp-session-id'];
      if (!sessionId) {
        rpcError(400, message.id, -32000, 'Bad Request: No valid session ID provided');
        return;
      }
      if (!sessions.has(`${mode}:${sessionId}`)) {
        rpcError(404, message.id, -32001, 'Session not found');
        return;
      }
      if (mode === 'session-replicas' && message.method === 'ping') {
        const count = (replicaPings.get(sessionId) ?? 0) + 1;
        replicaPings.set(sessionId, count);
        if (count % 2 === 0) {
          rpcError(404, message.id, -32001, 'Session not found on this replica');
          return;
        }
      }
      if (isNotification) {
        response.writeHead(202, cors).end();
        return;
      }
    } else {
      if (isNotification) {
        response.writeHead(202, cors).end();
        return;
      }
      if (message.method === 'initialize') {
        // A stateless-only server: the 2025 handshake is not offered.
        rpcError(400, message.id, UNSUPPORTED_PROTOCOL_VERSION, `Unsupported protocol version; this server speaks ${STATELESS_VERSION}`, {}, {
          supported: [STATELESS_VERSION],
          requested: params?.protocolVersion,
        });
        return;
      }
      if (message.method === 'server/discover') {
        send(200, {
          jsonrpc: '2.0',
          id: message.id,
          result: encodeStateless('server/discover', {
            supportedVersions: [STATELESS_VERSION],
            capabilities: CAPABILITIES,
            instructions: 'Mock server for mcptest end-to-end tests.',
          }),
        }, { 'MCP-Protocol-Version': STATELESS_VERSION });
        return;
      }
    }

    try {
      const result = handleMethod(message.method, params);
      send(
        200,
        { jsonrpc: '2.0', id: message.id, result: stateful ? result : encodeStateless(message.method, result) },
        stateful ? {} : { 'MCP-Protocol-Version': STATELESS_VERSION }
      );
    } catch (error) {
      if (!(error instanceof RpcError)) throw error;
      send(200, { jsonrpc: '2.0', id: message.id, error: { code: error.code, message: error.message, ...(error.data ? { data: error.data } : {}) } });
    }
  });

  return { server, requests, sessions };
}

function parseArgs(argv) {
  const options = { port: 4180, host: '127.0.0.1' };
  for (let index = 0; index < argv.length; index += 1) {
    if (argv[index] === '--port') options.port = Number(argv[++index]);
    else if (argv[index] === '--host') options.host = argv[++index];
  }
  return options;
}

if (process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  const options = parseArgs(process.argv.slice(2));
  const verbose = Boolean(process.env.MOCK_MCP_VERBOSE);
  createMockMcpServer({ log: verbose ? line => console.log(line) : undefined }).server.listen(options.port, options.host, () => {
    console.log(`Mock MCP server at http://${options.host}:${options.port}`);
  });
}
