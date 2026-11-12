---
title: "MCP server CORS headers: the reference for browser clients"
navTitle: CORS headers reference
summary: The exact Allow-Origin, Allow-Methods, Allow-Headers, Expose-Headers, and Max-Age values a remote MCP server needs for browser clients, how the preflight works, and tested examples for Express, Hono, Cloudflare Workers, and FastAPI.
track: build
level: practitioner
order: 24
category: Browser clients
readingTimeMinutes: 9
lastReviewed: "2026-11-11"
metaTitle: MCP Server CORS Headers Reference | mcptest.io
metaDescription: MCP server CORS headers for browser clients. Allow and expose Mcp-Session-Id, MCP-Protocol-Version, Mcp-Method, Mcp-Name, preflight rules, and Express, Hono, Workers, and FastAPI examples.
relatedSlugs:
  - deploy-remote-mcp-server
  - mcp-406-not-acceptable-415-and-405
  - troubleshooting
  - remote-vs-local
sourceLinks:
  - title: MCP 2026-07-28 Streamable HTTP transport
    url: "https://modelcontextprotocol.io/specification/2026-07-28/basic/transports/streamable-http"
  - title: MCP 2025-11-25 transports
    url: "https://modelcontextprotocol.io/specification/2025-11-25/basic/transports"
  - title: "MDN: Access-Control-Allow-Headers"
    url: "https://developer.mozilla.org/en-US/docs/Web/HTTP/Reference/Headers/Access-Control-Allow-Headers"
  - title: "MDN: Access-Control-Expose-Headers"
    url: "https://developer.mozilla.org/en-US/docs/Web/HTTP/Reference/Headers/Access-Control-Expose-Headers"
  - title: "MDN: Access-Control-Max-Age"
    url: "https://developer.mozilla.org/en-US/docs/Web/HTTP/Reference/Headers/Access-Control-Max-Age"
  - title: "Python SDK v2: add to an existing app (CORS for browser clients)"
    url: "https://py.sdk.modelcontextprotocol.io/run/asgi/"
  - title: "TypeScript SDK v2: serve with Hono"
    url: "https://ts.sdk.modelcontextprotocol.io/v2/serving/hono"
  - title: "Cloudflare Agents: creating MCP servers"
    url: "https://developers.cloudflare.com/agents/model-context-protocol/"
---

A browser-based MCP client can only use a server on another origin if the server's responses carry the right CORS (Cross-Origin Resource Sharing) headers. Examples of such clients are a web chat app, an in-page agent, and mcptest itself. Desktop and command-line clients ignore CORS entirely, which is why a server can work everywhere except in the browser.

Getting it right takes three lists:

- the request headers the browser may send,
- the response headers browser code may read,
- the origins allowed to do either.

This page gives all three for both protocol eras: 2026 (the stateless `2026-07-28` revision) and 2025 (the `initialize`-based revisions up to `2025-11-25`). The Express, Hono, and Workers examples were run against version 2.4.0 of the TypeScript SDK.

## The response headers a remote MCP server needs

| Response header | Recommended value | Why |
| --- | --- | --- |
| `Access-Control-Allow-Origin` | The request's `Origin`, if it is on your allowlist | Lets that page read the response. Send `Vary: Origin` whenever the value depends on the request. |
| `Access-Control-Allow-Methods` | `GET, POST, DELETE, OPTIONS` | `POST` carries every message. Only 2025 clients use `GET`, to open the optional server stream, and `DELETE`, to end a session. A 2026-only server should answer both with `405` and can leave them out. |
| `Access-Control-Allow-Headers` | `Content-Type, Accept, Authorization, MCP-Protocol-Version, Mcp-Method, Mcp-Name, Mcp-Session-Id, Last-Event-ID` | Every request header in the table below. A header the preflight does not grant is a request the browser never sends. |
| `Access-Control-Expose-Headers` | `Mcp-Session-Id, MCP-Protocol-Version, WWW-Authenticate, Retry-After` | Response headers client code must read. Browsers hide everything else except a few safelisted headers. |
| `Access-Control-Max-Age` | `7200` | How long the preflight result is cached. The default is 5 seconds; Chromium caps the value at 7200 and Firefox at 86400. |

Do not send `Access-Control-Allow-Credentials` unless the server authenticates with cookies. MCP clients send bearer tokens in an `Authorization` header they set themselves, which does not need credentialed CORS.

### Request headers to allow

| Request header | Sent by | When |
| --- | --- | --- |
| `Content-Type` | Both eras | Every `POST`; `application/json` is not a CORS-safelisted content type, so every MCP request is preflighted |
| `Accept` | Both eras | Every `POST`, as `application/json, text/event-stream` |
| `MCP-Protocol-Version` | Both eras | Every 2026 request, and every request after `initialize` from 2025-06-18 and later clients |
| `Mcp-Method` | 2026 | Every request, mirroring the JSON-RPC `method` |
| `Mcp-Name` | 2026 | `tools/call`, `resources/read`, and `prompts/get`, mirroring the name or URI |
| `Mcp-Param-<Name>` | 2026 | Tool calls whose `inputSchema` marks a parameter with `x-mcp-header`; list each name your tools declare |
| `Mcp-Session-Id` | 2025 | Every request after `initialize` when the server issued a session |
| `Last-Event-ID` | 2025 | Reconnecting a resumable stream |
| `Authorization` | Both eras | Bearer tokens; must be listed by name |
| `X-API-Key` or similar | Both eras | Only if your server uses a custom credential header |

Do not send a literal `Access-Control-Allow-Headers: *`. The wildcard never covers `Authorization`, which must always be listed by name, and it has no special meaning on credentialed requests. Listing the names is clearer and survives a later switch to cookies. Some middleware treats a configured `*` differently: Starlette's `CORSMiddleware` with `allow_headers=["*"]` copies the requested headers into the response instead, which does cover `Authorization` but has the preflight-cache cost described below.

### Response headers to expose

| Exposed header | Who reads it | What breaks without it |
| --- | --- | --- |
| `Mcp-Session-Id` | 2025 clients with sessions | `initialize` succeeds, then every request goes out without a session and is rejected with `400` or `404` |
| `MCP-Protocol-Version` | Clients and tools that read it on a response, such as mcptest's diagnostics | The browser reads it as absent. The specification does not require servers to send it, so this only matters if yours does. |
| `WWW-Authenticate` | Browser OAuth clients | The client cannot read `resource_metadata` or `scope` from a `401` or `403`. It must fall back to probing the well-known metadata URLs, and it cannot see which scope a step-up challenge asks for. |
| `Retry-After` | Clients that back off on `429` | The client cannot tell how long to wait |

`Mcp-Method` and `Mcp-Name` are request headers. They must be in `Access-Control-Allow-Headers` for 2026 clients. Listing them in `Access-Control-Expose-Headers` as well is harmless and only matters if your server or a gateway echoes them on responses.

## How the preflight works for an MCP request

Before the first `POST`, the browser sends an `OPTIONS` request naming the method and the non-safelisted headers it wants to use. A 2026 tool call looks like this:

```http
OPTIONS /mcp HTTP/1.1
Host: mcp.example.com
Origin: https://mcptest.io
Access-Control-Request-Method: POST
Access-Control-Request-Headers: authorization,content-type,mcp-method,mcp-name,mcp-protocol-version
```

The server must answer with a `2xx` status and grant everything that was asked:

```http
HTTP/1.1 204 No Content
Access-Control-Allow-Origin: https://mcptest.io
Access-Control-Allow-Methods: GET, POST, DELETE, OPTIONS
Access-Control-Allow-Headers: Content-Type, Accept, Authorization, MCP-Protocol-Version, Mcp-Method, Mcp-Name, Mcp-Session-Id, Last-Event-ID
Access-Control-Max-Age: 7200
Vary: Origin
```

Three rules cover almost every failure:

1. **The preflight never carries credentials.** If authentication middleware runs before CORS, the preflight gets `401` and the real request is never sent. Register CORS first.
2. **Every actual response needs the CORS headers too,** including `401`, `403`, `429`, and `5xx` responses. Without `Access-Control-Allow-Origin` the browser hides the whole response, so the client reports a network error instead of an authorization challenge or rate limit. Without `Access-Control-Expose-Headers` it sees the status but not `WWW-Authenticate` or `Retry-After`.
3. **The preflight cache holds one entry per origin, URL, and granted method or header name.** A request that uses a header not yet granted triggers a new preflight. If the first response grants the full list, a 2025 client can add `Mcp-Session-Id` after `initialize` without another round trip. A server that only reflects `Access-Control-Request-Headers` forces a new preflight each time the header set grows, for example when a 2026 tool call adds an `Mcp-Param-*` header.

## Origin validation is separate from CORS

CORS headers tell a browser what a page may read. They do not stop a request from reaching the server. That is the job of `Origin` validation: the transport specification requires servers to validate `Origin` on every request and to answer `403` when it is present and not allowed.

Both SDKs ship that check. Its allowlist must agree with your CORS allowlist. An origin allowed by CORS but not by the transport passes the preflight and then gets `403`.

| Stack | Transport origin check |
| --- | --- |
| TypeScript, Express or Hono | `createMcpExpressApp` or `createMcpHonoApp` with `allowedHosts` and `allowedOrigins` (hostnames) |
| TypeScript, fetch runtimes | `hostHeaderValidationResponse` and `originValidationResponse` from `@modelcontextprotocol/server` |
| Cloudflare Agents SDK | `allowedHostnames` and `allowedOriginHostnames` on `createMcpHandler` |
| Python | `TransportSecuritySettings(allowed_hosts=[...], allowed_origins=[...])` (full origins, such as `https://app.example.com`) |

Requests without an `Origin` header pass these checks. Non-browser clients normally send none.

## Express

```typescript
import cors from 'cors';
import { createMcpExpressApp } from '@modelcontextprotocol/express';
import { toNodeHandler } from '@modelcontextprotocol/node';
import { createMcpHandler } from '@modelcontextprotocol/server';
import { buildServer } from './tools.js';

const app = createMcpExpressApp({
  host: '0.0.0.0',
  allowedHosts: ['mcp.example.com'],
  allowedOrigins: ['mcptest.io', 'app.example.com'],
});

app.use(
  '/mcp',
  cors({
    origin: ['https://mcptest.io', 'https://app.example.com'],
    methods: ['GET', 'POST', 'DELETE', 'OPTIONS'],
    allowedHeaders: [
      'Content-Type', 'Accept', 'Authorization',
      'MCP-Protocol-Version', 'Mcp-Method', 'Mcp-Name',
      'Mcp-Session-Id', 'Last-Event-ID',
    ],
    exposedHeaders: ['Mcp-Session-Id', 'MCP-Protocol-Version', 'WWW-Authenticate', 'Retry-After'],
    maxAge: 7200,
  })
);

const node = toNodeHandler(createMcpHandler(buildServer));
app.all('/mcp', (req, res) => void node(req, res, req.body));
app.listen(3000);
```

The `cors` package answers the preflight with `204` and sets `Vary: Origin`. If the route needs a token, add `requireBearerAuth` as `app.all('/mcp', auth, ...)`. Because CORS is registered first, preflights and `401` challenges both carry the CORS headers.

## Hono

`hono/cors` works the same way. Register it on the route before the MCP handler:

```typescript
import { createMcpHonoApp } from '@modelcontextprotocol/hono';
import { createMcpHandler } from '@modelcontextprotocol/server';
import type { Context } from 'hono';
import { cors } from 'hono/cors';
import { buildServer } from './tools.js';

const handler = createMcpHandler(buildServer);
const app = createMcpHonoApp({
  host: '0.0.0.0',
  allowedHosts: ['mcp.example.com'],
  allowedOrigins: ['mcptest.io', 'app.example.com'],
});

app.use(
  '/mcp',
  cors({
    origin: ['https://mcptest.io', 'https://app.example.com'],
    allowMethods: ['GET', 'POST', 'DELETE', 'OPTIONS'],
    allowHeaders: [
      'Content-Type', 'Accept', 'Authorization',
      'MCP-Protocol-Version', 'Mcp-Method', 'Mcp-Name',
      'Mcp-Session-Id', 'Last-Event-ID',
    ],
    exposeHeaders: ['Mcp-Session-Id', 'MCP-Protocol-Version', 'WWW-Authenticate', 'Retry-After'],
    maxAge: 7200,
  })
);

app.all('/mcp', (c: Context) => handler.fetch(c.req.raw, { parsedBody: c.get('parsedBody') }));

export default app;
```

## Cloudflare Workers

The SDK's handler adds no CORS headers on a fetch runtime, so answer the preflight and decorate every response yourself:

```typescript
import { createMcpHandler, hostHeaderValidationResponse, originValidationResponse } from '@modelcontextprotocol/server';
import { buildServer } from './tools.js';

const handler = createMcpHandler(buildServer);
const ALLOWED_ORIGINS = new Set(['https://mcptest.io', 'https://app.example.com']);

const corsHeaders = (origin: string | null): Headers => {
  const headers = new Headers({ Vary: 'Origin' });
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
  return headers;
};

export default {
  async fetch(request: Request): Promise<Response> {
    const cors = corsHeaders(request.headers.get('Origin'));
    if (request.method === 'OPTIONS') return new Response(null, { status: 204, headers: cors });

    const rejected =
      hostHeaderValidationResponse(request, ['mcp.example.com']) ??
      originValidationResponse(request, ['mcptest.io', 'app.example.com']);
    const response = rejected ?? (await handler.fetch(request));

    const headers = new Headers(response.headers);
    cors.forEach((value, name) => headers.set(name, value));
    return new Response(response.body, { status: response.status, statusText: response.statusText, headers });
  },
};
```

Rebuilding the `Response` keeps the body as a stream, so SSE responses are not buffered.

With the Cloudflare Agents SDK's `createMcpHandler`, pass the same values through `corsOptions` instead. Its default `exposeHeaders` is `mcp-session-id` alone, and each option replaces its default as a whole. [Deploying a remote MCP server](/learn/deploy-remote-mcp-server) shows that configuration.

## FastAPI

Mount the MCP app inside FastAPI, run its session manager from FastAPI's lifespan, and add Starlette's `CORSMiddleware`:

```python
from collections.abc import AsyncIterator
from contextlib import asynccontextmanager

from fastapi import FastAPI
from fastapi.middleware.cors import CORSMiddleware

from mcp.server import MCPServer
from mcp.server.transport_security import TransportSecuritySettings

mcp = MCPServer("orders")


@mcp.tool()
def ping_order(id: str) -> str:
    """Echo an order id."""
    return id


security = TransportSecuritySettings(
    allowed_hosts=["mcp.example.com", "mcp.example.com:*"],
    allowed_origins=["https://mcptest.io", "https://app.example.com"],
)
mcp_app = mcp.streamable_http_app(transport_security=security)


@asynccontextmanager
async def lifespan(app: FastAPI) -> AsyncIterator[None]:
    async with mcp.session_manager.run():
        yield


app = FastAPI(lifespan=lifespan)
app.add_middleware(
    CORSMiddleware,
    allow_origins=["https://mcptest.io", "https://app.example.com"],
    allow_methods=["GET", "POST", "DELETE"],
    allow_headers=[
        "Accept", "Authorization", "Content-Type",
        "MCP-Protocol-Version", "Mcp-Method", "Mcp-Name",
        "Mcp-Session-Id", "Last-Event-ID",
    ],
    expose_headers=["Mcp-Session-Id", "MCP-Protocol-Version", "WWW-Authenticate", "Retry-After"],
    max_age=7200,
)
app.mount("/", mcp_app)
```

Three details matter here:

- The mounted app's own lifespan never runs. Without the `lifespan` function, the first request fails with "Task group is not initialized".
- Starlette answers preflights itself and adds `Access-Control-Expose-Headers` only to actual responses, which is where browsers read it.
- The Python SDK serves 2025 clients with sessions by default, so `Mcp-Session-Id` in `expose_headers` is required here, not optional.

## Check the headers without a browser

Send the preflight a 2026 client would send and read the grant:

```bash
curl -i -X OPTIONS https://mcp.example.com/mcp \
  -H "Origin: https://mcptest.io" \
  -H "Access-Control-Request-Method: POST" \
  -H "Access-Control-Request-Headers: authorization,content-type,mcp-method,mcp-name,mcp-protocol-version"
```

Then repeat a real `POST` with the same `Origin` and confirm the response carries `Access-Control-Allow-Origin` and `Access-Control-Expose-Headers`. A `curl` check proves the headers are present; only a browser proves they are sufficient.

## How the playground reports CORS evidence

mcptest connects directly from your browser first and uses its proxy only if the browser blocks the direct route. The report's Web Client Accessibility section records which happened:

- **Direct browser MCP negotiation succeeded** earns 15 points. The next line, "Stateless (or Stateful) MCP request headers passed browser enforcement", lists the headers for the negotiated era: `content-type`, `accept` and `mcp-protocol-version`, then `mcp-method` and `mcp-name` for 2026 or `mcp-session-id` and `last-event-id` for 2025. It adds `authorization` when a credential was used, and any custom headers you configured.
- **The browser could read Mcp-Session-Id on the initialize response** appears for a 2025 server that exposes the session header correctly.
- **Direct browser negotiation failed; the mcptest proxy was required** scores 0 and includes the direct-route error. The server works for non-browser clients but not for web apps.

When a 2025 server issues a session id without exposing it, the transport diagnostic `transport.cors-expose-headers-missing` shows three requests as evidence:

1. the `initialize` response, with the headers the browser could read,
2. the next request, which went out without a session,
3. the server's rejection of it with `400` or `404`.

If the rejection does not say a session was missing, the diagnostic is marked suspected. A suspected diagnostic never blocks a release.

## Confirm the headers in the playground

Open your endpoint at `https://mcptest.io/server/` followed by the URL without `https://`, for example [mcptest.io/server/mcp.example.com/mcp](/server/mcp.example.com/mcp) for `https://mcp.example.com/mcp`, then generate the report. A Web Client Accessibility score of 15 out of 15 with no CORS diagnostic means browser clients on an allowed origin can use the server.
