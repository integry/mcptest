---
title: Deploying a remote MCP server on Cloudflare Workers, Vercel, or your own host
navTitle: Deploy a remote server
summary: Deploy a Streamable HTTP MCP server to Cloudflare Workers, Vercel, or a Node or Python host behind a reverse proxy, and avoid the platform defaults that show up as transport diagnostics.
track: build
level: practitioner
order: 22
category: Deployment
readingTimeMinutes: 8
lastReviewed: "2026-11-11"
metaTitle: Deploy a Remote MCP Server (Cloudflare, Vercel, nginx) | mcptest.io
metaDescription: Deploy a remote MCP server on Cloudflare Workers, Vercel, or Node and Python behind nginx. Fix 405 on GET, 406 Accept, 415, SSE content type, CORS expose headers, and 429 Retry-After.
relatedSlugs:
  - convert-local-stdio-mcp-server-to-remote
  - mcp-cors-headers-for-browser-clients
  - mcp-406-not-acceptable-415-and-405
  - test-mcp-server-before-deploying
sourceLinks:
  - title: "Cloudflare Agents: creating MCP servers"
    url: "https://developers.cloudflare.com/agents/model-context-protocol/"
  - title: "cloudflare/agents#403: MCP should handle GET requests?"
    url: "https://github.com/cloudflare/agents/issues/403"
  - title: "TypeScript SDK v2: serve on web-standard runtimes"
    url: "https://ts.sdk.modelcontextprotocol.io/v2/serving/web-standard"
  - title: "vercel-labs/mcp-handler"
    url: "https://github.com/vercel-labs/mcp-handler"
  - title: "Next.js: route handlers"
    url: "https://nextjs.org/docs/app/api-reference/file-conventions/route"
  - title: "Vercel: configuring function duration"
    url: "https://vercel.com/docs/functions/configuring-functions/duration"
  - title: "Vercel: deployment protection"
    url: "https://vercel.com/docs/deployment-protection"
  - title: "Python SDK v2: deploy and scale"
    url: "https://py.sdk.modelcontextprotocol.io/run/deploy/"
  - title: "nginx: ngx_http_proxy_module"
    url: "https://nginx.org/en/docs/http/ngx_http_proxy_module.html"
---

The MCP part of a deployment is small: one endpoint that accepts `POST`, answers with JSON or a per-request event stream, and validates `Host` and `Origin`. Most failures after a successful local test come from the platform in front of that endpoint, not from the server code. This guide covers three common homes for a Streamable HTTP server. For each one, it lists the platform defaults that later appear in an mcptest report as transport diagnostics.

## What you will build

- A stateless Streamable HTTP endpoint at `https://mcp.example.com/mcp` on Cloudflare Workers, on Vercel, or on a Node.js or Python host behind nginx.
- `Host` and `Origin` validation, and CORS headers that let browser clients such as mcptest.io read every MCP response header.
- Proxy and platform settings that keep SSE streaming and return readable `413`, `429` and timeout responses.

## Prerequisites

- An MCP server that already runs over Streamable HTTP. If it still uses stdio, start with [converting a stdio server to remote](/learn/convert-local-stdio-mcp-server-to-remote).
- The TypeScript SDK v2 (`@modelcontextprotocol/server`) or the Python SDK v2 (`mcp`).
- An account on the platform you deploy to. For a complete, tested sample per platform, see the guides for [Vercel](/learn/deploy-remote-mcp-server-on-vercel), [AWS Lambda](/learn/deploy-remote-mcp-server-on-aws-lambda), [Google Cloud Run](/learn/deploy-remote-mcp-server-on-google-cloud-run) and [Fly.io](/learn/deploy-remote-mcp-server-on-fly-io).

## The diagnostics to design against

These are the stable diagnostic ids mcptest reports, with the platform cause behind each one in practice.

| Diagnostic | What the client saw | Usual deployment cause |
| --- | --- | --- |
| `transport.get-stream-405` | `GET` on the endpoint answered `405` | Normal for 2026 and for stateless 2025 serving; only a problem if a 2025 client needs server push |
| `transport.accept-header-406` | `POST` answered `406 Not Acceptable` | A hand-written or gateway `Accept` check stricter than "lists both `application/json` and `text/event-stream`" |
| `transport.unsupported-media-type-415` | `POST` answered `415` | A body parser or WAF rule that rejects `application/json; charset=utf-8` or only allows another type |
| `transport.sse-content-type-mismatch` | A success response with the wrong `Content-Type` | A CDN, proxy, or catch-all route answering with `text/html` or `text/plain` |
| `transport.cors-expose-headers-missing` | `initialize` worked in a browser, the next request was rejected | `Mcp-Session-Id` issued but not listed in `Access-Control-Expose-Headers` |
| `transport.target-rate-limited-429` | The server answered `429` | An edge or proxy rate limit, often without `Retry-After` or without CORS headers |

Errors block a release in the mcptest release decision; the `GET` stream `405` is a warning that only asks for review. The [status-code guide](/learn/mcp-406-not-acceptable-415-and-405) explains the protocol rule behind each code, and the [CORS reference](/learn/mcp-cors-headers-for-browser-clients) lists the full header set.

## Cloudflare Workers

Workers serve a `{ fetch }` object, which is exactly what the SDK's handler is. There are two good starting points.

### With the Agents SDK

`createMcpHandler` from `agents/mcp/server` wraps the SDK v2 handler with routing, CORS, and `Host` and `Origin` checks. Create it once at module scope:

```typescript
import { McpServer } from '@modelcontextprotocol/server';
import { createMcpHandler } from 'agents/mcp/server';
import { z } from 'zod';

function createServer() {
  const server = new McpServer({ name: 'orders', version: '1.0.0' });
  server.registerTool('ping-order', { description: 'Echo an order id', inputSchema: z.object({ id: z.string() }) }, async ({ id }) => ({
    content: [{ type: 'text', text: id }],
  }));
  return server;
}

const ALLOWED_ORIGINS = new Set(['https://mcptest.io', 'https://app.example.com']);

const mcp = createMcpHandler(createServer, {
  route: '/mcp',
  allowedHostnames: ['mcp.example.com'],
  allowedOriginHostnames: ['mcptest.io', 'app.example.com'],
  corsOptions: {
    origin: 'https://mcptest.io',
    headers: 'Content-Type, Accept, Authorization, MCP-Protocol-Version, Mcp-Method, Mcp-Name, Mcp-Session-Id, Last-Event-ID',
    exposeHeaders: 'Mcp-Session-Id, MCP-Protocol-Version, WWW-Authenticate, Retry-After',
    maxAge: 7200,
  },
});

// corsOptions.origin is a single string, so echo any other allowed origin.
function withRequestOrigin(request: Request, response: Response): Response {
  const origin = request.headers.get('Origin');
  const headers = new Headers(response.headers);
  headers.append('Vary', 'Origin');
  if (origin && ALLOWED_ORIGINS.has(origin)) {
    headers.set('Access-Control-Allow-Origin', origin);
  }
  return new Response(response.body, { status: response.status, statusText: response.statusText, headers });
}

export default {
  async fetch(request, env, ctx) {
    return withRequestOrigin(request, await mcp(request, env, ctx));
  },
} satisfies ExportedHandler;
```

Four defaults matter here:

- **The allowlists.** The default `Origin` allowlist covers localhost, the Worker's `workers.dev` hostname, and the host in `corsOptions.origin`. Browsers at any other origin get `403` until you list them in `allowedOriginHostnames`. `Host` is checked only on localhost and `workers.dev`; on a custom domain it is not checked at all unless you set `allowedHostnames`, so set it too.
- **One fixed CORS origin.** `allowedOriginHostnames` only decides which origins pass validation. `corsOptions.origin` takes one fixed string, which every response, preflights included, sends as `Access-Control-Allow-Origin`. A browser at any other allowed origin rejects that response. The wrapper therefore replaces the value with the request's `Origin` when it is on the same allowlist, and adds `Vary: Origin`.
- **Exposed headers.** The default CORS options expose only `mcp-session-id`, so a browser cannot read `MCP-Protocol-Version`, `WWW-Authenticate`, or `Retry-After` until you set `exposeHeaders`.
- **Whole-string replacement.** Each `corsOptions` field replaces its default as a whole string, so restate every header when you change one.

`McpAgent`, backed by a Durable Object per session, is deprecated and feature-frozen. Use it only to keep an existing stateful deployment running.

### With the SDK alone

Without the Agents SDK, `export default handler` from `createMcpHandler` in `@modelcontextprotocol/server` is the whole Worker. It performs no `Host` or `Origin` validation and adds no CORS headers, so put `hostHeaderValidationResponse` and `originValidationResponse` in front of `handler.fetch` and answer preflights yourself. The [CORS reference](/learn/mcp-cors-headers-for-browser-clients) has a complete Worker with both. Deploy with `npx wrangler deploy`.

### Workers pitfalls

- **`405` on `GET`.** In [cloudflare/agents#403](https://github.com/cloudflare/agents/issues/403), the reference remote server answered `GET /mcp` with `405`, which a developer expected to be a stream for notifications and elicitation. The spec permits `405` for 2025 clients, and the 2026 revision removed the `GET` stream entirely. Today's stateless handler answers `GET` and `DELETE` with `405` by design, and change notifications for 2026 clients travel on `subscriptions/listen`. mcptest shows this as a warning, not a blocker.
- **Edge-generated responses skip your code.** A WAF or rate-limiting rule that answers `429` in front of the Worker returns no CORS headers and often no `Retry-After`. A browser client sees a CORS failure instead of a rate limit. Size limits so one connection, which is a discovery request plus up to four list calls with pagination, does not trip them.
- **Notifications are isolate-local.** With the default event bus, `handler.notify` reaches subscription streams in the same isolate only. The SDK's own `createMcpHandler` accepts a custom `bus`; the Agents wrapper does not.

## Vercel

On Vercel, a Next.js route handler receives a web-standard `Request`, so the SDK's handler mounts without adapters. Vercel's `mcp-handler` package wraps it for you; version 2 is built on SDK v2. It serves 2026 clients natively and 2025 clients statelessly, so `GET` and `DELETE` answer `405`. It adds no CORS headers and performs no `Host` or `Origin` check. Add the `Origin` check and CORS yourself, and export an `OPTIONS` handler for preflights:

```typescript
// app/mcp/route.ts
import { originValidationResponse } from '@modelcontextprotocol/server';
import { createMcpHandler } from 'mcp-handler';
import { z } from 'zod';

const mcp = createMcpHandler(
  (server) => {
    server.registerTool(
      'ping-order',
      { description: 'Echo an order id', inputSchema: z.object({ id: z.string() }) },
      async ({ id }) => ({ content: [{ type: 'text', text: id }] })
    );
  },
  { serverInfo: { name: 'orders', version: '1.0.0' } }
);

const ALLOWED_ORIGINS = new Set(['https://mcptest.io', 'https://app.example.com']);

function withCors(request: Request, response: Response): Response {
  const origin = request.headers.get('Origin');
  const headers = new Headers(response.headers);
  headers.append('Vary', 'Origin');
  if (origin && ALLOWED_ORIGINS.has(origin)) {
    headers.set('Access-Control-Allow-Origin', origin);
    headers.set('Access-Control-Allow-Methods', 'GET, POST, DELETE, OPTIONS');
    headers.set(
      'Access-Control-Allow-Headers',
      'Content-Type, Accept, Authorization, MCP-Protocol-Version, Mcp-Method, Mcp-Name, Mcp-Session-Id, Last-Event-ID'
    );
    headers.set('Access-Control-Expose-Headers', 'Mcp-Session-Id, MCP-Protocol-Version, WWW-Authenticate, Retry-After');
    headers.set('Access-Control-Max-Age', '7200');
  }
  return new Response(response.body, { status: response.status, statusText: response.statusText, headers });
}

async function handle(request: Request): Promise<Response> {
  const rejected = originValidationResponse(request, [...ALLOWED_ORIGINS].map((o) => new URL(o).hostname));
  return withCors(request, rejected ?? (await mcp(request)));
}

export const maxDuration = 60;
export { handle as GET, handle as POST, handle as DELETE };
export async function OPTIONS(request: Request) {
  return withCors(request, new Response(null, { status: 204 }));
}
```

Without an `OPTIONS` export, Next.js answers preflights itself with an `Allow` header and no CORS headers, and the browser blocks the request. The [Next.js guide](/learn/remote-mcp-server-with-nextjs) adds OAuth to the same route.

### Vercel pitfalls

- **Function duration.** A long tool call that streams progress runs until the function's maximum duration. Set `maxDuration` for the route to the longest call you support, within your plan's limit.
- **Deployment protection.** Standard Protection, the recommended setting, protects every domain except production domains. An unauthenticated client calling a protected preview URL gets Vercel's authentication response instead of MCP, which mcptest reports as a failed negotiation or an authorization challenge from the platform. Test the production domain, or configure a bypass for automation.
- **Catch-all routes.** A rewrite that sends unknown paths to a page answers `GET /mcp` with `200 text/html`. Mount the MCP route explicitly and publish its full URL.

## A Node or Python host behind a reverse proxy

On a VM, container platform, or Kubernetes, the server listens on a private port and a reverse proxy terminates TLS. The application is unchanged; the proxy configuration is where streaming breaks.

```nginx
location /mcp {
    proxy_pass http://127.0.0.1:3000;
    proxy_http_version 1.1;
    proxy_set_header Host $host;
    proxy_set_header X-Forwarded-Proto $scheme;
    proxy_set_header X-Forwarded-For $proxy_add_x_forwarded_for;
    proxy_set_header Connection "";
    proxy_buffering off;
    proxy_cache off;
    proxy_read_timeout 300s;
    client_max_body_size 4m;
    gzip off;
}
```

| Directive | nginx default | Why change it |
| --- | --- | --- |
| `proxy_buffering` | `on` | Buffered SSE arrives all at once or after the call finishes. Both SDKs also send `X-Accel-Buffering: no` on event streams, which nginx honors unless `proxy_ignore_headers` drops it. |
| `proxy_read_timeout` | `60s` | The time allowed between two reads from the app. Both SDKs send an SSE keepalive every 15 seconds by default. If those keepalives are turned off or stripped, a stream that stays quiet longer than this is cut, which a 2026 server treats as cancellation of the request. |
| `client_max_body_size` | `1m` | The Python SDK and the TypeScript transports accept 4 MiB request bodies by default. The Express adapter's JSON parser stops at 100 kB unless you set `jsonLimit`. A tool call larger than 1 MB gets nginx's own `413` HTML page. |
| `limit_req_status` | `503` | If you rate-limit in nginx, return `429` and add `Retry-After` so clients can back off. |

Keep `Host` intact. Both SDKs validate it: the TypeScript Express and Hono apps through `allowedHosts`, the Python app through `TransportSecuritySettings(allowed_hosts=[...])`. Without that allowlist, a Python app accepts only localhost `Host` values, so every proxied request gets `421 Misdirected Request` with the plain-text body `Invalid Host header`. If the proxy already controls `Host`, `TransportSecuritySettings(enable_dns_rebinding_protection=False)` is the honest setting.

For Python behind a TLS-terminating proxy on another address, run uvicorn with `--forwarded-allow-ips='<proxy address>'`. Uvicorn already reads `X-Forwarded-Proto`, but by default it trusts only `127.0.0.1` and `::1`. If it does not trust the proxy, the app believes it is served over `http://`. A trailing-slash redirect, such as `/mcp/` to `/mcp`, then points at plain HTTP, and the Python client refuses to follow a redirect that downgrades HTTPS.

Every response the proxy generates itself, such as `413`, `502`, `504`, or a `limit_req` rejection, bypasses the application's CORS headers. Add CORS headers for those error pages at the proxy with `add_header ... always`, or a browser reports them as CORS failures.

### Scaling past one instance

A 2026 request is self-contained, so any instance can answer it. A 2025 client served statefully, which is the Python SDK's default leg, holds an `Mcp-Session-Id` in one process's memory and needs sticky routing; a request that reaches another worker gets `404 Session not found`. Either enable session affinity or set `stateless_http=True` for the 2025 leg. Python multi-round-trip tools also need the same `RequestStateSecurity` keys and the same server name on every instance.

## Common failures

| Symptom | Likely cause | Read next |
| --- | --- | --- |
| `403 Invalid Host` or `421 Invalid Host header` | The public hostname is missing from the `Host` allowlist | [Invalid Host header](/learn/mcp-error-invalid-host-header) |
| `406`, `415` or `405` on the first requests | A strict `Accept` check, a body parser or WAF rule, or an expected `GET` `405` | [406, 415 and 405](/learn/mcp-406-not-acceptable-415-and-405) |
| Works with `curl`, fails in the browser | Missing preflight answer, allowed header, or exposed header | [CORS reference](/learn/mcp-cors-headers-for-browser-clients) |
| `404 Session not found` after a deploy or scale-out | A stateful 2025 session landed on another instance | [Session not found after deploy](/learn/mcp-session-not-found-after-deploy) |
| A streaming call is cut off or stalls | Proxy buffering, a read timeout, or a platform duration limit | [SSE stream disconnected](/learn/mcp-error-sse-stream-disconnected) |
| Any transport diagnostic id from the table above | See its entry for the exact request and fix | [Transport diagnostics reference](/learn/mcp-transport-diagnostics-reference) |

## Test the deployed endpoint in the playground

Open the production URL in the playground: `https://mcptest.io/server/` followed by the endpoint without the scheme and a final `/mcp` for Streamable HTTP, for example [mcptest.io/server/mcp.example.com/mcp/mcp](/server/mcp.example.com/mcp/mcp). The connection runs from your browser, so the report shows the preflight, the readable response headers, and every transport diagnostic above with the exact request and response that triggered it.
