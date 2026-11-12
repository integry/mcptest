---
title: "Fixing MCP 406 Not Acceptable, 415 Unsupported Media Type, and 405 Method Not Allowed"
navTitle: 406, 415, and 405 errors
summary: The Accept rule, request and response content types, and GET stream optionality in Streamable HTTP, with measured TypeScript and Python SDK behavior and the fix for each status.
track: build
level: practitioner
order: 25
category: Transports
readingTimeMinutes: 7
lastReviewed: "2026-10-20"
metaTitle: MCP 406 Not Acceptable, 415, and 405 Fixes | mcptest.io
metaDescription: Fix MCP 406 Not Acceptable from the Accept header rule, 415 Unsupported Media Type, SSE content-type mismatches, and 405 on GET, with SDK-level fixes for TypeScript and Python.
relatedSlugs:
  - deploy-remote-mcp-server
  - mcp-cors-headers-for-browser-clients
  - troubleshooting
  - test-mcp-server-before-deploying
sourceLinks:
  - title: MCP 2026-07-28 Streamable HTTP transport
    url: "https://modelcontextprotocol.io/specification/2026-07-28/basic/transports/streamable-http"
  - title: MCP 2025-11-25 transports
    url: "https://modelcontextprotocol.io/specification/2025-11-25/basic/transports"
  - title: "ComposioHQ/composio#2152: 406 when Accept only contains text/event-stream"
    url: "https://github.com/ComposioHQ/composio/issues/2152"
  - title: "cloudflare/agents#403: MCP should handle GET requests?"
    url: "https://github.com/cloudflare/agents/issues/403"
  - title: "TypeScript SDK v2: support legacy clients"
    url: "https://ts.sdk.modelcontextprotocol.io/v2/serving/legacy-clients"
  - title: "Python SDK v2: running your server"
    url: "https://py.sdk.modelcontextprotocol.io/run/"
  - title: "RFC 9110: 405 Method Not Allowed"
    url: "https://www.rfc-editor.org/rfc/rfc9110.html#name-405-method-not-allowed"
---

These three statuses come from the HTTP layer, before any JSON-RPC is processed, which is why clients often report them as a generic connection failure. Each maps to one rule in the Streamable HTTP transport. The tables below record what the current SDKs actually return: TypeScript `@modelcontextprotocol/server` 2.3 through `createMcpHandler`, and Python `mcp` 2.3 through `MCPServer.streamable_http_app()`, both with default settings. mcptest reports each failure under a stable diagnostic id, shown in each section.

## 406 Not Acceptable: the Accept header rule

The rule is the same in the 2025 and 2026 revisions: every `POST` from the client **must** include an `Accept` header listing both `application/json` and `text/event-stream`. The server decides per request whether to answer with one JSON object or with an SSE stream that carries progress notifications before the result, so the client has to accept both.

| `Accept` sent on `POST` | TypeScript, 2026 request | TypeScript, 2025 request | Python, either era |
| --- | --- | --- | --- |
| `application/json, text/event-stream` | 200 | 200 | 200 |
| `text/event-stream;q=0.9, application/json` | 200 | 200 | 200 |
| `application/json` | 200 | 406 | 406 |
| `text/event-stream` | 200 | 406 | 406 |
| `*/*` | 200 | 406 | 200 |
| No `Accept` header | 200 | 406 | 200 |

Order and parameters do not matter to either SDK. What differs is how strictly a header that names only one type, or no concrete type, is treated. The 406 body from both SDKs explains itself: `Not Acceptable: Client must accept both application/json and text/event-stream`.

### Client-side fix

Send the full header. This is the case in [ComposioHQ/composio#2152](https://github.com/ComposioHQ/composio/issues/2152): a voice-agent client sent only `Accept: text/event-stream` on its `POST`, and a server built on the SDK answered `406`. The server was conforming; the client was not. A hand-built request needs:

```http
POST /mcp HTTP/1.1
Content-Type: application/json
Accept: application/json, text/event-stream
MCP-Protocol-Version: 2026-07-28
Mcp-Method: tools/list
```

### Server-side fixes

Remove any `Accept` check you wrote yourself. Exact string comparisons, such as `accept === 'application/json, text/event-stream'`, reject valid headers with a different order, spacing, or quality values. The SDK transports already enforce the rule.

Fix the client wherever you can. Rewriting the `Accept` header on its own is not a fix: the SDK then accepts the request but may still answer with a format the client never asked for. A client that sends only `Accept: application/json` gets an SSE body it cannot parse, and the failure just moves from the `406` to the response parser.

If you must serve a client you cannot change, change both sides together. Send each one-sided client to a handler pinned to the format it accepts, and widen the header only for that pinned handler, so it passes the SDK's 2025 `Accept` check. In TypeScript with Express:

```typescript
const handlers = {
  both: toNodeHandler(createMcpHandler(buildServer)),
  json: toNodeHandler(createMcpHandler(buildServer, { responseMode: 'json' })),
  sse: toNodeHandler(createMcpHandler(buildServer, { responseMode: 'sse' })),
};

function acceptedFormat(accept: string): 'both' | 'json' | 'sse' {
  const json = /application\/json/i.test(accept);
  const sse = /text\/event-stream/i.test(accept);
  if (json && sse) return 'both';
  return sse ? 'sse' : 'json';
}

app.all('/mcp', (req, res) => {
  const format = req.method === 'POST' ? acceptedFormat(req.headers.accept ?? '') : 'both';
  if (format !== 'both') req.headers.accept = 'application/json, text/event-stream';
  void handlers[format](req, res, req.body);
});
```

A header that names neither type, such as `*/*` or no header at all, gets the JSON handler, because every client can parse a single JSON object. Clients routed to the JSON handler do not receive progress notifications during a call. That is the cost of serving them.

The Python SDK has no per-request response mode, so the adapter has to pin JSON for the whole app. Widen only headers that lack `text/event-stream`, and leave SSE-only headers unchanged so the SDK still answers them with `406` instead of a JSON body they cannot read:

```python
from starlette.types import ASGIApp, Receive, Scope, Send

BOTH = b"application/json, text/event-stream"


class WidenJsonOnlyAccept:
    def __init__(self, app: ASGIApp) -> None:
        self.app = app

    async def __call__(self, scope: Scope, receive: Receive, send: Send) -> None:
        if scope["type"] == "http" and scope["method"] == "POST":
            accept = dict(scope["headers"]).get(b"accept", b"").lower()
            if b"text/event-stream" not in accept:
                headers = [(k, v) for k, v in scope["headers"] if k != b"accept"]
                scope = {**scope, "headers": [*headers, (b"accept", BOTH)]}
        await self.app(scope, receive, send)


# json_response=True is what makes the widening safe: every POST is answered with application/json.
app = WidenJsonOnlyAccept(mcp.streamable_http_app(json_response=True))
```

Never put either wrapper in front of a handler that can still choose SSE for a client that did not ask for it.

Also check what sits in front of the server. API gateways and WAF rules that do their own content negotiation can answer `406` before the request reaches your code. mcptest only raises `transport.accept-header-406` for responses attributable to the target, and its evidence records the exact `Accept` value that was sent.

## 415 Unsupported Media Type: the request body type

Every `POST` body is a single JSON-RPC message sent with `Content-Type: application/json`.

| `Content-Type` sent | TypeScript | Python |
| --- | --- | --- |
| `application/json` | 200 | 200 |
| `application/json; charset=utf-8` | 200 | 200 |
| `Application/JSON` | 200 | 200 |
| `text/plain;charset=UTF-8` | 415 | 400 |
| `application/x-www-form-urlencoded` | 415 | 400 |

Both SDKs compare the media type case-insensitively and ignore parameters. TypeScript answers `415` with `Unsupported Media Type: Content-Type must be application/json`; Python answers `400` with the plain-text body `Invalid Content-Type header`, so look for both when debugging.

The two most common client causes are easy to miss. `fetch(url, { method: 'POST', body: JSON.stringify(message) })` without a `headers` option sends `text/plain;charset=UTF-8`, and `curl -d` without `-H 'Content-Type: application/json'` sends `application/x-www-form-urlencoded`. On the server side, the causes are an exact-string comparison that rejects a `charset` parameter, or a body parser, gateway, or WAF rule that accepts only another type. Compare the essence of the media type instead:

```typescript
const type = (req.headers['content-type'] ?? '').split(';')[0].trim().toLowerCase();
if (type !== 'application/json') return res.status(415).end();
```

mcptest reports this as `transport.unsupported-media-type-415`, with the `Content-Type` that was sent.

## The response Content-Type must match the body

The server's side of the same contract: a `POST` carrying a request is answered with `Content-Type: application/json` for one JSON object or `text/event-stream` for a stream; a notification is answered with `202 Accepted` and no body; a 2025 `GET` stream is `text/event-stream`. Clients refuse anything else with errors like "Unexpected content type".

The SDKs set these correctly, so a mismatch almost always comes from something in front of them: a CDN or proxy rewriting the header, a framework error page with `text/html`, compression middleware that changes the response, or a catch-all route answering the MCP path with a website. In the TypeScript SDK, `createMcpHandler(factory, { responseMode: 'json' })` pins JSON replies and `'sse'` pins streams; in Python, `streamable_http_app(json_response=True)` answers each `POST` with a single JSON body. mcptest reports a success response with the wrong type as `transport.sse-content-type-mismatch`. An HTML page returned for `GET` is treated as a website at a guessed path, not as a broken stream.

## 405 Method Not Allowed: GET stream optionality

What `GET` means depends on the era.

- **2026-07-28** removed the standalone `GET` stream and protocol sessions. A server that receives `GET` or `DELETE` on the MCP endpoint should answer `405`. Change notifications travel on the response stream of a `subscriptions/listen` `POST`.
- **2025-03-26 through 2025-11-25** let a client `GET` the endpoint to open a server-to-client event stream. The server either returns `text/event-stream` or `405`, which means it offers no stream. `DELETE` ends a session, and `405` there means the server does not allow clients to end sessions.

| Request | TypeScript `createMcpHandler` | Python `streamable_http_app()` |
| --- | --- | --- |
| `GET` or `DELETE` with a 2026 protocol version | 405, no `Allow` header | 405 with `Allow: POST` |
| 2025 `GET` with a valid session | 405 (2025 serving is stateless by default) | 200 `text/event-stream` |
| 2025 `GET` without a session | 405 | 400 `Missing session ID` |

The history behind most "405 on GET" reports is [cloudflare/agents#403](https://github.com/cloudflare/agents/issues/403), where the reference Workers server answered `GET /mcp` with `405` and a developer expected a stream for notifications, sampling, and elicitation. That answer was permitted by the spec then and is required for 2026 now.

mcptest raises `transport.get-stream-405` as a warning, which asks for review but never blocks a release. Act on it only if a 2025 client needs messages the server sends on its own, outside a `POST` response:

- For 2026 clients, implement `subscriptions/listen`; both SDKs serve it.
- For 2025 clients that need push, run a sessionful transport: the Python SDK's default 2025 leg, or in TypeScript a `NodeStreamableHTTPServerTransport` with `sessionIdGenerator`, routed with `isLegacyRequest` as the SDK's legacy-clients guide shows.

If you keep the `405`, add an `Allow` header. RFC 9110 requires one on every `405`, and it tells clients the stream is intentionally absent:

```typescript
app.get('/mcp', (_req, res) => {
  res.set('Allow', 'POST').status(405).json({
    jsonrpc: '2.0',
    error: { code: -32000, message: 'Method not allowed.' },
    id: null,
  });
});
```

A `405` on `POST` is a different problem: the URL is not an MCP endpoint. The usual causes are an HTTP+SSE stream URL used as a Streamable HTTP endpoint, a static site route, or a missing path such as `/mcp`.

## Status decoder

| Status | Diagnostic | First thing to check |
| --- | --- | --- |
| 406 on `POST` | `transport.accept-header-406` | The client's `Accept` header, then any custom check or gateway |
| 406 on a 2025 `GET` | `transport.accept-header-406` (warning) | `Accept: text/event-stream` on the `GET` |
| 415 or 400 `Invalid Content-Type header` | `transport.unsupported-media-type-415` | The client's `Content-Type`, then body parsers and WAF rules |
| 200 with the wrong type | `transport.sse-content-type-mismatch` | CDN, proxy, compression, or catch-all routes |
| 405 on `GET` or `DELETE` | `transport.get-stream-405` (warning) | Nothing, unless a 2025 client needs server push |
| 405 on `POST` | None; negotiation fails | The endpoint URL |

For CORS failures that look like these statuses in a browser, see [the CORS reference](/learn/mcp-cors-headers-for-browser-clients); the broader status table is in [troubleshooting](/docs/troubleshooting).

## Reproduce the failure in the playground

Open the endpoint at `https://mcptest.io/server/` followed by the URL without the scheme and a final `/mcp`, for example [mcptest.io/server/mcp.example.com/mcp/mcp](/server/mcp.example.com/mcp/mcp). When negotiation fails, the transport diagnostics panel names the diagnostic, shows the request headers that were sent and the response headers the browser could read, and gives the fix for the TypeScript SDK, the Python SDK, and Cloudflare Workers.
