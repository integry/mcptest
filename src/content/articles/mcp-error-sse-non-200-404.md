---
title: "SSE error: Non-200 status code (404)"
navTitle: "SSE non-200 404"
summary: "What the legacy SSE client's Non-200 status code (404) error means, why it often hides an earlier Streamable HTTP failure, and how to fix the route, transport or GET stream."
track: "build"
level: "practitioner"
order: 451
category: "Transports"
readingTimeMinutes: 5
lastReviewed: "2026-11-11"
metaTitle: "SSE error: Non-200 status code (404) | mcptest.io"
metaDescription: "Fix MCP SSE error: Non-200 status code (404): find the hidden Streamable HTTP failure, the wrong transport or route, or a GET stream that should return 405."
relatedSlugs:
  - troubleshooting
  - mcp-406-not-acceptable-415-and-405
  - mcp-error-posting-to-endpoint
  - mcp-session-not-found-after-deploy
sourceLinks:
  - title: "TypeScript SDK legacy SSE client transport"
    url: "https://github.com/modelcontextprotocol/typescript-sdk/blob/main/packages/client/src/client/sse.ts"
  - title: "eventsource package (Non-200 status code)"
    url: "https://github.com/EventSource/eventsource/blob/main/src/EventSource.ts"
  - title: "MCP 2025-11-25 transports (backward compatibility)"
    url: "https://modelcontextprotocol.io/specification/2025-11-25/basic/transports"
  - title: "MCP 2026-07-28 Streamable HTTP"
    url: "https://modelcontextprotocol.io/specification/2026-07-28/basic/transports/streamable-http"
  - title: "LM Studio Streamable HTTP report #1453"
    url: "https://github.com/lmstudio-ai/lmstudio-bug-tracker/issues/1453"
  - title: "Qwen optional GET failure #8784"
    url: "https://github.com/QwenLM/qwen-code/issues/8784"
  - title: "OpenCode remote SSE 404 #18724"
    url: "https://github.com/anomalyco/opencode/issues/18724"
  - title: "TypeScript SDK: serving legacy clients"
    url: "https://github.com/modelcontextprotocol/typescript-sdk/blob/main/docs/serving/legacy-clients.md"
---

## SSE error: Non-200 status code (404)

```text
SSE error: Non-200 status code (404)
```

A client opened an SSE stream with `GET` and the server answered 404. The wording comes from the legacy HTTP+SSE client: the TypeScript SDK's `SSEClientTransport` adds `SSE error:` to the `Non-200 status code (404)` message of the `eventsource` package. Seeing it usually means the client is using, or has fallen back to, the deprecated HTTP+SSE transport (protocol 2024-11-05).

The TypeScript SDK's Streamable HTTP client reports a failed `GET` differently, as `Failed to open SSE stream: Not Found`. Some clients still use their own SSE code for that `GET`, so the same text can appear in Streamable HTTP mode too.

## Likely causes {#likely-causes-ranked-by-recurrence-in-the-reports}

1. **The client uses legacy SSE against a Streamable HTTP-only server.** The server serves `POST /mcp` and has no legacy `GET /sse` stream. [LM Studio #1453](https://github.com/lmstudio-ai/lmstudio-bug-tracker/issues/1453) shows this for a local Streamable HTTP server at `/mcp`.
2. **A fallback hid the real error.** Clients that support both transports first `POST` to the URL. If that fails with 400, 404 or 405, they retry with a legacy SSE `GET`, which the specification allows. The 404 from that second attempt is what you see. The first failure (a wrong path, missing credentials, a rejected header) is the real problem. [OpenCode #18724](https://github.com/anomalyco/opencode/issues/18724) shows this message for a server that supports Streamable HTTP.
3. **An optional 2025 `GET` stream returns 404 and the client treats it as fatal.** `POST` works, but the server answers the optional `GET` with 404 instead of 405. [Qwen #8784](https://github.com/QwenLM/qwen-code/issues/8784) shows this against public servers. Qwen Code now tolerates the 404 ([PR #10091](https://github.com/QwenLM/qwen-code/pull/10091)).
4. **A stale session (2025 stateful).** A `GET` with an expired `Mcp-Session-Id` gets 404. The body then usually says `Session not found`.

## How to confirm the cause

Send the `POST` that a Streamable HTTP client sends first:

```bash
curl -si https://mcp.example.com/mcp \
  -H 'Content-Type: application/json' \
  -H 'Accept: application/json, text/event-stream' \
  -d '{"jsonrpc":"2.0","id":1,"method":"initialize","params":{"protocolVersion":"2025-11-25","capabilities":{},"clientInfo":{"name":"probe","version":"1"}}}'
```

Then send the `GET` that a legacy SSE client sends:

```bash
curl -siN --max-time 5 https://mcp.example.com/sse -H 'Accept: text/event-stream'
```

- `POST` returns 200 and the legacy `GET` returns 404: cause 1. The server speaks only Streamable HTTP; switch the client's transport.
- `POST` fails too: cause 2. Fix what the `POST` status says (401: credentials, 404: path, 406 or 415: headers). A 2026-only server answers a 2025 `initialize` with 400 and a `-32022` body, which is also not a route problem.
- `POST` works and the same URL's `GET` returns 404 (not 405): cause 3.
- The 404 body says `Session not found`: cause 4.

A legacy server answers the `GET` with 200 and an `event: endpoint` line that names its message URL.

## Fix for client users

- Configure the transport and URL the publisher documents. For a Streamable HTTP server, choose the HTTP transport (often `type: "http"`, not `"sse"`) and the full path, such as `/mcp`.
- Update the client if it lacks Streamable HTTP support or treats an optional `GET` 404 as fatal.
- If the client falls back automatically, find the first failed request in its debug log. That is the error to fix and report.
- For a stale session, reconnect and see [session recovery](/learn/mcp-session-not-found-after-deploy).

## Fix for server authors

- **Publish one exact URL and transport.** Route it to the SDK handler, including your ingress rewrites.
- **Answer an unsupported `GET` with 405, not 404.** Both 2025 and 2026 servers should do this. 405 tells clients there is simply no stream, and well-behaved clients continue with `POST`. The TypeScript SDK's `createMcpHandler` already answers `405` with `Allow: POST`.
- **Serve legacy SSE only if you must.** Supporting 2025 protocol messages does not create `GET /sse` and its separate message route. In TypeScript, the [legacy clients guide](https://github.com/modelcontextprotocol/typescript-sdk/blob/main/docs/serving/legacy-clients.md) points to the frozen `@modelcontextprotocol/server-legacy/sse` package for that case.
- **Python SDK 2.x** serves Streamable HTTP with:

```python
from mcp.server.mcpserver import MCPServer

mcp = MCPServer("example")
app = mcp.streamable_http_app()
# Serve app with an ASGI server and its lifespan enabled. The endpoint is /mcp.
```

`mcp.sse_app()` serves the legacy transport, if you need it. Python 1.x used `FastMCP` instead of `MCPServer`. Never answer a missing route with an empty 200 stream.

## Check with mcptest

Enter the endpoint in **Test your server** and compare the transport attempts in the message log. There is no dedicated 404 finding. [transport.get-stream-405](/learn/mcp-transport-diagnostics-reference#transport-get-stream-405) reports an optional `GET` answered with 405, which is allowed. [session.unknown-id](/learn/mcp-transport-diagnostics-reference#session-unknown-id) checks stateful unknown-session handling; it only applies when the server issues sessions.

## Related errors

- [Error POSTing to endpoint](/learn/mcp-error-posting-to-endpoint): the `POST` failed; often the real error behind this one.
- [406 Not Acceptable, 415 and 405](/learn/mcp-406-not-acceptable-415-and-405): header and method rejections.
- [Session not found (404)](/learn/mcp-session-not-found-after-deploy): 404 for an expired session.
