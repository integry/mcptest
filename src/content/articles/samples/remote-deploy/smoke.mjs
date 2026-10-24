import assert from 'node:assert/strict';
import { Writable } from 'node:stream';
import { once } from 'node:events';
import { serve } from '@hono/node-server';
import { Client, StreamableHTTPClientTransport } from '@modelcontextprotocol/client';
import { request as httpRequest } from 'node:http';
const port = Number(process.env.PORT ?? 3000);
process.env.PUBLIC_URL ??= `http://localhost:${port}/mcp`;
const { default: app } = await import('./app.mjs');
const { default: vercel } = await import('./api/mcp.mjs');

// AWS provides this global in production. This shim checks event/response
// conversion and the streamed writes; it does not emulate the AWS front door.
globalThis.awslambda = {
  streamifyResponse: fn => fn,
  HttpResponseStream: { from(output, metadata) { output.metadata = metadata; return output; } },
};
const { handler } = await import('./lambda/index.mjs');
async function lambdaFetch(request) {
  const url = new URL(request.url);
  const event = {
    requestContext: { http: { method: request.method } },
    rawPath: url.pathname, rawQueryString: url.search.slice(1),
    headers: Object.fromEntries(request.headers),
    body: ['GET', 'HEAD'].includes(request.method) ? undefined : await request.text(),
    isBase64Encoded: false,
  };
  const chunks = [];
  const output = new Writable({ write(chunk, encoding, done) { chunks.push(Buffer.from(chunk)); done(); } });
  await handler(event, output);
  if (!output.writableFinished) await once(output, 'finish');
  const { statusCode, headers } = output.metadata;
  return new Response(statusCode === 204 ? null : Buffer.concat(chunks), { status: statusCode, headers });
}

let offset = 0;
for (const [name, fetchHandler] of [
  ['Cloud Run container entry', app.fetch], ['Fly.io container entry', app.fetch],
  ['Vercel fetch export', vercel.fetch], ['Lambda event adapter', lambdaFetch],
]) {
  const currentPort = port + offset++;
  const http = serve({ fetch: fetchHandler, hostname: '0.0.0.0', port: currentPort });
  await once(http, 'listening');
  try {
    const endpoint = `http://localhost:${currentPort}/mcp`;
    for (const mode of [{ pin: '2026-07-28' }, 'legacy']) {
      const responses = [];
      const transport = new StreamableHTTPClientTransport(new URL(endpoint), {
        fetch: async (...args) => {
          const response = await fetch(...args);
          responses.push({ session: response.headers.get('Mcp-Session-Id'), type: response.headers.get('Content-Type') });
          return response;
        },
      });
      const client = new Client({ name: 'deploy-smoke', version: '1.0.0' }, { versionNegotiation: { mode } });
      try {
        await client.connect(transport);
        assert.equal((await client.listTools()).tools[0].name, 'echo');
        const progress = [];
        const result = await client.callTool({ name: 'echo', arguments: { text: 'hello', waitMs: 50 } }, {
          onprogress: value => progress.push(value),
        });
        assert.equal(result.content[0].text, 'hello');
        assert.equal(progress[0].progress, 0);
        assert.ok(responses.some(r => r.type?.includes('text/event-stream')));
        assert.ok(responses.every(r => !r.session));
        if (typeof mode === 'object') assert.equal(client.getNegotiatedProtocolVersion(), '2026-07-28');
      } finally { await client.close(); }
    }
    const preflight = await fetch(endpoint, { method: 'OPTIONS', headers: {
      Origin: 'https://mcptest.io', 'Access-Control-Request-Method': 'POST',
      'Access-Control-Request-Headers': 'Mcp-Method, Authorization',
    } });
    assert.equal(preflight.status, 204);
    assert.equal(preflight.headers.get('Access-Control-Allow-Origin'), 'https://mcptest.io');
    assert.match(preflight.headers.get('Access-Control-Allow-Headers'), /Mcp-Method/);
    assert.equal((await fetch(endpoint)).status, 405);
    assert.equal((await fetch(endpoint, { headers: { Origin: 'https://untrusted.example' } })).status, 403);
    const badHostStatus = await new Promise((resolve, reject) => {
      const request = httpRequest(endpoint, { headers: { Host: 'untrusted.example' } }, response => {
        response.resume(); resolve(response.statusCode);
      });
      request.on('error', reject); request.end();
    });
    assert.equal(badHostStatus, 403);
    console.log(`${name}: 2026/legacy discovery, tool list/call, SSE progress, no sessions, CORS and rejection checks passed`);
  } finally { await new Promise((resolve, reject) => http.close(error => error ? reject(error) : resolve())); }
}
