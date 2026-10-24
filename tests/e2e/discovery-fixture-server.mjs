#!/usr/bin/env node

/**
 * A local "domain" for the discovery checker e2e test (tests/e2e/discovery.e2e.ts).
 * Entered as 127.0.0.1:<port>, it advertises the mock MCP server's stateless
 * endpoint the ways the checker looks for:
 *
 *   /.well-known/mcp/server-card.json   a valid SEP-2127 Server Card
 *   /.well-known/mcp.json               legacy JSON naming the endpoint, not a valid card
 *   /.well-known/ai-catalog.json        an HTML catch-all page (reported as not found)
 *   anything else                       404
 *
 * Every response carries CORS headers, as the SEP requires of hosted cards.
 *
 *   node tests/e2e/discovery-fixture-server.mjs [--port 4181] [--mock-port 4180] [--host 127.0.0.1]
 */

import http from 'node:http';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

export const SERVER_CARD_SCHEMA_URL = 'https://static.modelcontextprotocol.io/schemas/v1/server-card.schema.json';

export const fixtureDocuments = (mockOrigin) => ({
  '/.well-known/mcp/server-card.json': {
    contentType: 'application/mcp-server-card+json',
    body: JSON.stringify({
      $schema: SERVER_CARD_SCHEMA_URL,
      name: 'io.mcptest.e2e/forecast',
      version: '1.0.0',
      description: 'Mock forecast server for the mcptest discovery e2e test.',
      title: 'E2E Forecast',
      remotes: [{ type: 'streamable-http', url: `${mockOrigin}/2026/mcp`, supportedProtocolVersions: ['2026-07-28'] }],
    }),
  },
  '/.well-known/mcp.json': {
    contentType: 'application/json',
    body: JSON.stringify({ endpoint: `${mockOrigin}/2026/mcp`, transport: 'streamable-http' }),
  },
  '/.well-known/ai-catalog.json': {
    contentType: 'text/html; charset=utf-8',
    body: '<!doctype html><title>Home</title><p>Welcome</p>',
  },
});

export function createDiscoveryFixtureServer({ mockOrigin }) {
  const documents = fixtureDocuments(mockOrigin);
  return http.createServer((request, response) => {
    const url = new URL(request.url, 'http://localhost');
    const cors = {
      'Access-Control-Allow-Origin': '*',
      'Access-Control-Allow-Methods': 'GET',
      'Access-Control-Allow-Headers': 'Content-Type, If-None-Match',
      'Access-Control-Expose-Headers': 'ETag',
    };
    if (request.method === 'OPTIONS') {
      response.writeHead(204, cors).end();
      return;
    }
    if (url.pathname === '/health') {
      response.writeHead(200, { ...cors, 'Content-Type': 'application/json' }).end('{"ok":true}');
      return;
    }
    const document = request.method === 'GET' ? documents[url.pathname] : undefined;
    if (!document) {
      response.writeHead(404, { ...cors, 'Content-Type': 'text/plain' }).end('Not found');
      return;
    }
    response.writeHead(200, { ...cors, 'Content-Type': document.contentType, 'Cache-Control': 'no-store' }).end(document.body);
  });
}

function parseArgs(argv) {
  const options = { port: 4181, mockPort: 4180, host: '127.0.0.1' };
  for (let index = 0; index < argv.length; index += 1) {
    if (argv[index] === '--port') options.port = Number(argv[++index]);
    else if (argv[index] === '--mock-port') options.mockPort = Number(argv[++index]);
    else if (argv[index] === '--host') options.host = argv[++index];
  }
  return options;
}

if (process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  const options = parseArgs(process.argv.slice(2));
  createDiscoveryFixtureServer({ mockOrigin: `http://${options.host}:${options.mockPort}` })
    .listen(options.port, options.host, () => {
      console.log(`Discovery fixture domain at http://${options.host}:${options.port}`);
    });
}
