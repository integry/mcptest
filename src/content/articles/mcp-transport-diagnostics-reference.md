---
title: MCP transport diagnostics reference
navTitle: Transport diagnostics
summary: Each mcptest diagnostic id, from transport.accept-header-406 to tool.output-contract-violation, with what was observed, severity, release impact, cause, fixes for three stacks, and the reports behind it.
track: reference
level: practitioner
order: 24
category: Troubleshooting
readingTimeMinutes: 10
lastReviewed: "2026-10-20"
metaTitle: MCP transport diagnostics reference (406, 405, 415, 429, CORS, Content-Type) | mcptest.io
metaDescription: What each mcptest transport diagnostic means and how to fix it in the TypeScript SDK, Python SDK and Cloudflare Workers, including output-contract violations.
relatedSlugs:
  - troubleshooting
  - mcp-http-headers-reference
  - mcp-json-rpc-error-codes
  - testing-guide
sourceLinks:
  - title: "MCP 2025-11-25: Transports"
    url: "https://modelcontextprotocol.io/specification/2025-11-25/basic/transports"
  - title: "MCP 2026-07-28: Tools (output schema)"
    url: "https://modelcontextprotocol.io/specification/2026-07-28/server/tools"
  - title: "TypeScript SDK: Streamable HTTP server transport"
    url: "https://github.com/modelcontextprotocol/typescript-sdk/blob/main/packages/server/src/server/streamableHttp.ts"
  - title: "ComposioHQ/composio#2152: 406 when Accept only contains text/event-stream"
    url: "https://github.com/ComposioHQ/composio/issues/2152"
  - title: "cloudflare/agents#403: MCP should handle GET requests?"
    url: "https://github.com/cloudflare/agents/issues/403"
  - title: "modelcontextprotocol/typescript-sdk#581: Enforcing Content-Type header on client requests"
    url: "https://github.com/modelcontextprotocol/typescript-sdk/issues/581"
  - title: "modelcontextprotocol/python-sdk#3670: Mixed-case Content-Type rejected with 415"
    url: "https://github.com/modelcontextprotocol/python-sdk/issues/3670"
  - title: "modelcontextprotocol/python-sdk#3691: Content-Type handling is order dependent"
    url: "https://github.com/modelcontextprotocol/python-sdk/issues/3691"
  - title: "modelcontextprotocol/inspector#2442: Detect and surface server-side rate limiting"
    url: "https://github.com/modelcontextprotocol/inspector/issues/2442"
  - title: "Apollo MCP Server: Configuring CORS"
    url: "https://www.apollographql.com/docs/apollo-mcp-server/cors"
  - title: "postmanlabs/postman-app-support#13885: Invalid content type, expected text/event-stream"
    url: "https://github.com/postmanlabs/postman-app-support/issues/13885"
  - title: "Postman community: Does MCP client support output schema?"
    url: "https://community.postman.com/t/does-mcp-client-support-output-schema/88808"
  - title: "MDN: Access-Control-Expose-Headers"
    url: "https://developer.mozilla.org/en-US/docs/Web/HTTP/Reference/Headers/Access-Control-Expose-Headers"
  - title: "TypeScript SDK: Tools guide (structured output)"
    url: "https://github.com/modelcontextprotocol/typescript-sdk/blob/main/docs/servers/tools.md"
  - title: "Python SDK: Migration guide (FastMCP renamed to MCPServer)"
    url: "https://github.com/modelcontextprotocol/python-sdk/blob/main/docs/migration.md"
  - title: "RFC 6585: 429 Too Many Requests"
    url: "https://www.rfc-editor.org/rfc/rfc6585"
---

mcptest records the HTTP exchange of each connection attempt, both direct and through its optional CORS proxy. Six transport diagnostics are defined in `src/types/transportDiagnostics.ts`, plus one tool-level finding in `src/utils/outputContract.ts`. The ids are a stable contract: connection error cards, report JSON and Markdown, and this page all use them. For general triage, start with [troubleshooting](/docs/troubleshooting).

The fixes below repeat the code hints shown in the app (`src/utils/transportDiagnostics.ts`). The Python hints use the 1.x `FastMCP` names. In Python SDK 2.x the class is `MCPServer` from `mcp.server.mcpserver`, and `json_response` moves from the constructor to `run()` and `streamable_http_app()` ([migration guide](https://github.com/modelcontextprotocol/python-sdk/blob/main/docs/migration.md)).

## How diagnostics are graded

- **Status:** `detected` means the responses prove the problem. `suspected` means they are consistent with it but do not prove it. `not-checked` means mcptest could not run the check and says why.
- **Severity:** `error` blocks the connection, `warning` degrades it, and `info` is context only.
- **Release impact:** in the release-readiness report (`transportDiagnosticPriority` in `src/utils/releaseReadiness.ts`), a detected `error` becomes a high-priority item and the answer is "No — fix blockers first". A detected `warning` is medium priority and asks for review. `suspected` and `not-checked` never block.
- **Attribution:** only responses from the target count. A `406`, `415` or caller-limit `429` produced by the mcptest proxy itself is never reported against your server.

| Id | Usual severity | Blocks release |
| --- | --- | --- |
| `transport.accept-header-406` | error (warning on GET) | Yes when error |
| `transport.get-stream-405` | warning | No |
| `transport.unsupported-media-type-415` | error (warning on GET) | Yes when error |
| `transport.target-rate-limited-429` | error (warning if a retry recovered, or on GET) | Yes when error |
| `transport.cors-expose-headers-missing` | error when confirmed, warning when suspected | Only when confirmed |
| `transport.sse-content-type-mismatch` | error (warning on the optional GET stream) | Yes when error |
| `tool.output-contract-violation` | high-priority finding | Yes |

## transport.accept-header-406 {#transport-accept-header-406}

**Observed:** the MCP server answered HTTP `406 Not Acceptable`. The evidence records the `Accept` value mcptest sent.

**Severity:** error on POST; warning when it answers the optional Streamable HTTP GET.

**Why:** Streamable HTTP clients MUST send an `Accept` header listing both `application/json` and `text/event-stream` on POST. mcptest's SDK always sends `Accept: application/json, text/event-stream`. A `406` therefore usually means the server's check is stricter than the specification: it compares the whole header to one exact string, requires a single media type, or rejects the order or parameters of the list.

**Fix:** accept any `Accept` header that includes both types, in any order and with any parameters.

```typescript
// StreamableHTTPServerTransport already negotiates correctly. If you add your own check:
const accept = req.headers.accept ?? '';
if (!accept.includes('application/json') || !accept.includes('text/event-stream')) {
  return res.status(406).end();
}
```

```python
accept = request.headers.get("accept", "")
if "application/json" not in accept or "text/event-stream" not in accept:
    return Response(status_code=406)
# FastMCP.streamable_http_app() performs this check for you.
```

```typescript
// Cloudflare Workers: McpAgent.serve('/mcp') from 'agents/mcp' negotiates Accept for you.
const accept = request.headers.get('Accept') ?? '';
const ok = accept.includes('application/json') && accept.includes('text/event-stream');
```

**Reports:** [ComposioHQ/composio#2152](https://github.com/ComposioHQ/composio/issues/2152). The client sent only `text/event-stream` and the server answered `406` with "Client must accept both application/json and text/event-stream". That is the TypeScript SDK server's wording, so clients that build requests by hand must send both types.

## transport.get-stream-405 {#transport-get-stream-405}

**Observed:** after a 2025-era `initialize`, the optional GET that opens a stream for server-initiated messages was refused with `405 Method Not Allowed`. POST requests are unaffected.

**Severity:** warning. Does not block release; the report asks for review.

**Why:** the 2025 specifications allow a server to answer this GET with either an SSE stream or `405`. Without the stream, the server cannot push list-changed notifications, progress, sampling or elicitation requests outside a POST response. The 2026-07-28 revision removes the GET endpoint, and a 2026-only server SHOULD answer `405`. mcptest only opens this stream on a 2025 session, after `notifications/initialized`.

**Fix:** if the server sends messages on its own, handle GET and return `text/event-stream`. If it never does, keep the `405` and send `Allow`.

```typescript
app.get('/mcp', (req, res) => transport.handleRequest(req, res));
// or, when no server-initiated messages are needed:
app.get('/mcp', (_req, res) => res.set('Allow', 'POST, DELETE').status(405).end());
```

```python
app = mcp.streamable_http_app()  # FastMCP routes GET to the standalone SSE stream
```

```typescript
// Cloudflare Workers: McpAgent.serve('/mcp') handles GET streams. In a custom fetch handler:
if (request.method === 'GET') {
  return new Response(null, { status: 405, headers: { Allow: 'POST, DELETE' } });
}
```

**Reports:** [cloudflare/agents#403](https://github.com/cloudflare/agents/issues/403). A server built from Cloudflare's remote MCP guide logged `GET /mcp 405`; the reporter asked for the stream because notifications, elicitation and sampling need it.

## transport.unsupported-media-type-415 {#transport-unsupported-media-type-415}

**Observed:** the MCP server answered `415 Unsupported Media Type`. The evidence records the request `Content-Type`.

**Severity:** error on POST; warning on the optional GET.

**Why:** MCP clients POST JSON-RPC as `Content-Type: application/json`, which is what mcptest sends. A `415` usually means the server compares the header to an exact string, treats letter case or a `charset` parameter as significant, or sits behind a body parser that accepts another media type.

**Fix:** compare only the media type before the first semicolon, case-insensitively, and make sure body-parsing middleware accepts it.

```typescript
app.use(express.json()); // matches application/json with any charset
const type = (req.headers['content-type'] ?? '').split(';')[0].trim().toLowerCase();
if (type !== 'application/json') return res.status(415).end();
```

```python
media_type = request.headers.get("content-type", "").split(";")[0].strip().lower()
if media_type != "application/json":
    return Response(status_code=415)
```

```typescript
// Cloudflare Workers
const type = (request.headers.get('Content-Type') ?? '').split(';')[0].trim().toLowerCase();
if (type !== 'application/json') return new Response(null, { status: 415 });
```

**Reports:** [typescript-sdk#581](https://github.com/modelcontextprotocol/typescript-sdk/issues/581) (a Java client hit the TypeScript server's "Content-Type must be application/json" `415`). [python-sdk#3670](https://github.com/modelcontextprotocol/python-sdk/issues/3670) (`Application/JSON` rejected although media types are case-insensitive). [python-sdk#3691](https://github.com/modelcontextprotocol/python-sdk/issues/3691) (order-dependent prefix matching).

## transport.target-rate-limited-429 {#transport-target-rate-limited-429}

**Observed:** the MCP server itself answered `429 Too Many Requests`. This is the target's limit, not the mcptest proxy's caller limit, which has its own message. The evidence shows the `Retry-After` value, or says it was absent or unreadable.

**Severity:** error. Warning when an automatic retry succeeded or when only the optional GET stream was limited.

**Why:** the server's limit was reached, often because one connection sends several requests in a burst (`server/discover` or `initialize`, then tool, resource and prompt listing).

**What mcptest does:** it honors `Retry-After` in seconds or as an HTTP date (RFC 6585 allows the header on `429`). It retries at most once per candidate endpoint and only when the wait is 2 seconds or less; with no readable header it waits 1 second. Longer waits are shown as a countdown, and Retry stays disabled until the deadline. A cross-origin browser can read `Retry-After` only when the server lists it in `Access-Control-Expose-Headers`.

**Fix:** send `Retry-After` with every `429`, expose it to browsers, and size limits so one connection does not trip them.

```typescript
res.set('Retry-After', '30');
res.set('Access-Control-Expose-Headers', 'Retry-After, Mcp-Session-Id, MCP-Protocol-Version');
res.status(429).json({ jsonrpc: '2.0', error: { code: -32000, message: 'Rate limited' }, id: null });
```

```python
return JSONResponse({"error": "rate limited"}, status_code=429, headers={"Retry-After": "30"})
# and CORSMiddleware(..., expose_headers=["Retry-After", "Mcp-Session-Id", "MCP-Protocol-Version"])
```

```typescript
// Cloudflare Workers
return new Response('Too Many Requests', {
  status: 429,
  headers: { 'Retry-After': '30', 'Access-Control-Expose-Headers': 'Retry-After' },
});
```

**Reports:** [modelcontextprotocol/inspector#2442](https://github.com/modelcontextprotocol/inspector/issues/2442) asks the official Inspector to recognize `429` and `Retry-After` instead of showing raw errors or timeouts.

## transport.cors-expose-headers-missing {#transport-cors-expose-headers-missing}

**Observed:** a direct, cross-origin `initialize` succeeded, but the browser could not read `Mcp-Session-Id` on the response. The next request went out without a session and was rejected with `400` or `404`.

**Severity and status:**

- `detected`, error: the rejection says a session was missing, for example "Mcp-Session-Id header is required" or "Session not found".
- `suspected`, warning: the rejection does not mention a session. A server without sessions never sends the header, so the `400` may be unrelated.
- `not-checked`, info: the check needs a browser reading a direct response. Through the proxy, the browser sees the proxy's headers, and headless runs see no CORS at all.

**Why:** a cross-origin script can read only safelisted response headers plus those named in `Access-Control-Expose-Headers`. `curl`, desktop clients and server-side clients are unaffected, so this shows up only in web clients and looks like a broken stateful fallback.

**Fix:** add `Access-Control-Expose-Headers: Mcp-Session-Id, MCP-Protocol-Version` to every MCP response, including the `initialize` response. Allow both in `Access-Control-Allow-Headers` for preflights.

```typescript
app.use(cors({
  origin: allowedOrigins,
  exposedHeaders: ['Mcp-Session-Id', 'MCP-Protocol-Version'],
  allowedHeaders: ['Content-Type', 'Authorization', 'Mcp-Session-Id', 'MCP-Protocol-Version', 'Last-Event-ID'],
}));
```

```python
app = CORSMiddleware(
    mcp.streamable_http_app(),
    allow_origins=allowed_origins,
    allow_methods=["GET", "POST", "DELETE"],
    allow_headers=["Content-Type", "Authorization", "Mcp-Session-Id", "MCP-Protocol-Version"],
    expose_headers=["Mcp-Session-Id", "MCP-Protocol-Version"],
)
```

```typescript
// Cloudflare Workers
const headers = new Headers(response.headers);
headers.set('Access-Control-Expose-Headers', 'Mcp-Session-Id, MCP-Protocol-Version');
return new Response(response.body, { status: response.status, headers });
```

**Reports:** [Apollo's MCP server CORS guide](https://www.apollographql.com/docs/apollo-mcp-server/cors) exposes `mcp-session-id` by default "for MCP session management". It warns that custom `expose_headers` replace the defaults rather than adding to them. See also the [HTTP headers reference](/learn/mcp-http-headers-reference).

## transport.sse-content-type-mismatch {#transport-sse-content-type-mismatch}

**Observed:** a successful response declared the wrong `Content-Type`:

- On a legacy SSE endpoint or the Streamable HTTP GET stream: anything other than `text/event-stream`. An HTML page is ignored, because it is a website at a guessed path rather than a mislabelled stream.
- On a POST that carried a request: neither `application/json` nor `text/event-stream`, including a missing header. `202` and `204` responses are not checked.

**Severity:** error; warning on the optional Streamable HTTP GET stream.

**Why:** clients choose a parser from `Content-Type` and refuse anything else, with errors such as "Invalid content type, expected text/event-stream" or "Unexpected content type". A CDN, reverse proxy or framework default (`text/plain`, `text/html`) is a frequent cause.

**Fix:** set `text/event-stream` on SSE responses and `application/json` on JSON responses. Make sure proxies and CDNs neither rewrite the header nor buffer the stream.

```typescript
res.writeHead(200, {
  'Content-Type': 'text/event-stream',
  'Cache-Control': 'no-cache',
  Connection: 'keep-alive',
});
// or new StreamableHTTPServerTransport({ enableJsonResponse: true }) for JSON replies
```

```python
return StreamingResponse(event_generator(), media_type="text/event-stream")
# or FastMCP(..., json_response=True) for application/json replies
```

```typescript
// Cloudflare Workers
return new Response(readable, {
  headers: { 'Content-Type': 'text/event-stream', 'Cache-Control': 'no-cache' },
});
```

**Reports:** [postman-app-support#13885](https://github.com/postmanlabs/postman-app-support/issues/13885). After a Postman update, connecting to an HTTP MCP server failed with `SSE error: Invalid content type, expected "text/event-stream"`.

## tool.output-contract-violation {#tool-output-contract-violation}

**Observed:** a tool that declares an `outputSchema` returned a `tools/call` result that broke it. Either `structuredContent` failed validation, or it was missing. The report lists the violating tools with up to five violations each, as a path and a plain-language message, such as `structuredContent.items[0].name: Expected string but got number.`

**Severity:** high-priority finding in the release-readiness report, so it blocks release. It comes from playground tool calls made against the same server URL in the session before the evaluation.

**Why:** the specification says that when an output schema is provided, servers MUST return structured results that conform to it, and clients SHOULD validate them. Clients that enforce output schemas reject non-conforming results. A result with `isError: true` is not checked. A tool without `outputSchema` gets no verdict. Validation uses `@cfworker/json-schema`, because the page's Content Security Policy forbids code-generating validators, and it honors the schema's declared draft (2020-12 by default).

**Fix:** make each tool return `structuredContent` that validates against its `outputSchema`, or correct the schema. Then rerun the tool in the playground and regenerate the report. The specification also says a tool returning structured content SHOULD include the serialized JSON in a text block.

```typescript
// TypeScript SDK 2.x: the SDK validates structuredContent before it leaves the server
server.registerTool('get_weather', {
  description: 'Current weather for a city',
  inputSchema: z.object({ city: z.string() }),
  outputSchema: z.object({ temperature: z.number(), conditions: z.string() }),
}, async ({ city }) => {
  const output = { temperature: 22.5, conditions: 'Partly cloudy' };
  return { content: [{ type: 'text', text: JSON.stringify(output) }], structuredContent: output };
});
```

```python
# Python SDK: the return type annotation is the output schema
from pydantic import BaseModel

class Weather(BaseModel):
    temperature: float
    conditions: str

@mcp.tool()
def get_weather(city: str) -> Weather:
    return Weather(temperature=22.5, conditions="Partly cloudy")
```

On Cloudflare Workers, `McpAgent` exposes the same SDK server as `this.server`. Register the tool in `init()` with the same `outputSchema` and `structuredContent`, using the schema form of the SDK version that your `agents` package depends on.

**Reports:** a [Postman community thread](https://community.postman.com/t/does-mcp-client-support-output-schema/88808) where a tool's output was reported invalid against a schema the client never displayed.

## Try it

Connect [Context7 in the playground](/server/https://mcp.context7.com/mcp/mcp), then connect your own server the same way. When a connection fails, the error card shows the diagnostic id, the evidence it rests on and the fix for your stack.

## session.unknown-id {#session-unknown-id}

**Active check; error on failure, high release priority.** An isolated probe initializes a temporary session, then sends `ping` with a fabricated UUID in `Mcp-Session-Id`. Only a target HTTP 404 passes. HTTP 400, 401, 500 or even 200 fails: clients rely on 404 to discard stale sessions and re-initialize. Network/CORS/proxy failures are explicitly not checked. Evidence records the request method, status and redacted relevant headers.

In a TypeScript SDK stateful router, guard unknown ids before routing:

```ts
const id = req.headers['mcp-session-id'];
if (id && !transports.has(id)) return res.status(404).end();
```

In Python/FastMCP, let `streamable_http_app()` handle session lookup; do not translate unknown-session 404 responses into authentication failures. On Workers, route to the session's owning Durable Object, and return `new Response(null, { status: 404 })` for an unknown id. Authenticate every request independently.

## session.reinitialize {#session-reinitialize}

**Active check; error on failure, high release priority.** After the fabricated id receives 404, a fresh `initialize` without a session header must return a successful JSON-RPC result and a new readable session id. If no target 404 was observed, this finding is not checked. The probe never deletes the inspector's session.

For the TypeScript SDK, create a new `StreamableHTTPServerTransport` for an id-free initialize rather than routing it to an old transport. For Python/FastMCP, keep initialization available after expired sessions. For Workers, allocate fresh durable session ownership when initialization has no id. Browser deployments must expose `Mcp-Session-Id` using `Access-Control-Expose-Headers`.

## session.stickiness {#session-stickiness}

**Active check; error on session rejection, high release priority.** After initializing its own session, mcptest sends **8 sequential then 4 parallel pings**, with no tool execution. The finding reports unsuccessful requests and session rejection counts out of 12, plus a failure percentage. A valid id receiving 404 or a 400 naming an invalid/missing session fails. Other unsuccessful responses make the result not checked rather than proving a session bug.

These observations are consistent with sessions lost during recycling or stored separately on replicas; they do not prove the infrastructure cause. The probe does not restart your server, and a clean sample cannot guarantee future restart survival. It runs only from **Check session resilience**, an opted-in report, or `--session-resilience` in the release gate. Requests have five-second deadlines; there are at most 22 HTTP requests including initialization, notifications and cleanup.

For TypeScript SDK deployments, a process-local `Map` needs consistent routing to a durable owner or a stateless transport (`sessionIdGenerator: undefined`). For Python/FastMCP, use `FastMCP("server", stateless_http=True, json_response=True)` when sessions are unnecessary. On Workers, route stateful sessions to Durable Objects, such as through `McpAgent.serve('/mcp')`. A shared Redis store can hold application session state, but storing an id alone does not serialize a live SDK transport.

## session.delete {#session-delete}

**Active check; error on accepted-but-not-invalidated sessions, warning for HTTP 405.** DELETE is sent only for a temporary probe session. If accepted with a 2xx response, a subsequent ping using that id must get 404. HTTP 405 is permitted by the specification and creates only a medium release priority. Other DELETE failures are reported as not checked.

Route DELETE to `transport.handleRequest(req, res)` in the TypeScript SDK and remove terminated session ownership. With Python/FastMCP use the HTTP application's lifecycle management. In a custom Workers handler, delete durable session state and ensure later lookup returns 404. If termination is intentionally unsupported, return `new Response(null, { status: 405 })`.

All four checks pass as **not applicable: stateless** when the negotiated 2026 protocol uses no sessions. For older sessionless HTTP, successful initialization without an id plus a successful sessionless ping establishes this outcome. An unreadable id followed by rejection is not called stateless. Credentials and actual session ids are never retained in findings. See [why session 404s happen after deploys](/learn/mcp-session-not-found-after-deploy).
