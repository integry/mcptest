---
title: "SSE error: Non-200 status code (404)"
navTitle: "SSE non-200 404"
summary: "Separate legacy SSE routing failures from optional Streamable HTTP GET failures and stale sessions using the request method and response body."
track: "build"
level: "practitioner"
order: 451
category: "Transports"
readingTimeMinutes: 5
lastReviewed: "2026-10-26"
metaTitle: "SSE error: Non-200 status code (404) | mcptest.io"
metaDescription: "Separate legacy SSE routing failures from optional Streamable HTTP GET failures and stale sessions using the request method and response body."
relatedSlugs:
  - troubleshooting
  - mcp-406-not-acceptable-415-and-405
  - mcp-error-posting-to-endpoint
  - mcp-session-not-found-after-deploy
sourceLinks:
  - title: "LM Studio Streamable HTTP report #1453"
    url: "https://github.com/lmstudio-ai/lmstudio-bug-tracker/issues/1453"
  - title: "Qwen optional GET failure #8784"
    url: "https://github.com/QwenLM/qwen-code/issues/8784"
  - title: "OpenCode remote SSE 404 #18724"
    url: "https://github.com/anomalyco/opencode/issues/18724"
  - title: "MCP HTTP transport rules"
    url: "https://modelcontextprotocol.io/specification/2025-11-25/basic/transports"
  - title: "TypeScript legacy client serving"
    url: "https://github.com/modelcontextprotocol/typescript-sdk/blob/main/docs/serving/legacy-clients.md"
  - title: "Python SDK migration"
    url: "https://github.com/modelcontextprotocol/python-sdk/blob/main/docs/migration.md"
---

## SSE error: Non-200 status code (404)

```text
SSE error: Non-200 status code (404)
```

**Which clients print it:** January 2026's [LM Studio #1453](https://github.com/lmstudio-ai/lmstudio-bug-tracker/issues/1453) records this when using a Streamable HTTP server. [OpenCode #18724](https://github.com/anomalyco/opencode/issues/18724) supplies another remote-server reproduction. [Qwen #8784](https://github.com/QwenLM/qwen-code/issues/8784) reports the same string for an optional GET after a successful POST. The identical wording therefore does not identify one transport or root cause.

## Likely causes, ranked by recurrence in the reports

1. **SSE fallback or a legacy SSE client against an HTTP endpoint.** LM Studio and OpenCode reports both involve Streamable HTTP servers. Check the first request method and the selected client transport; a GET to `/mcp` is not evidence that a legacy `/sse` endpoint exists.
2. **The optional GET fails while POST works.** Qwen's reproduction contrasts a successful initialize POST with a failing GET. Inspect both requests before declaring the entire server unreachable.
3. **A wrong route or expired stateful session.** Check the response body and whether `Mcp-Session-Id` was sent. A route 404 and `session not found` require different fixes. This branch follows the [transport specification](https://modelcontextprotocol.io/specification/2025-11-25/basic/transports), rather than a diagnosis established for all three reports.

The reports support this triage order, not a numerical frequency ranking.

## Fix for client users

Use the exact endpoint and transport published by the server. Prefer a client release supporting that server's Streamable HTTP mode. Save the original HTTP error before any fallback: a later SSE 404 can obscure an earlier POST authentication failure.

If POST succeeds and only GET fails, report that distinction with the negotiated protocol revision. The 2025 transport permits 405 on an unsupported optional GET; it does not require a legacy SSE endpoint. For a stateful unknown-session 404, reconnect and follow [session recovery](/learn/mcp-session-not-found-after-deploy). For 405 instead of 404, see the [HTTP status guide](/learn/mcp-406-not-acceptable-415-and-405).

## Fix for server authors

Route the published path to the correct SDK handler, retaining authentication and lifecycle setup. In TypeScript, the [legacy clients guide](https://github.com/modelcontextprotocol/typescript-sdk/blob/main/docs/serving/legacy-clients.md) distinguishes Streamable HTTP compatibility from the older HTTP+SSE transport. Supporting 2025 protocol messages does not by itself provide `GET /sse` and its separate message route.

For Python SDK 2.x, a minimal Streamable HTTP application is:

```python
from mcp.server.mcpserver import MCPServer

mcp = MCPServer("example")
app = mcp.streamable_http_app()
# Serve app with an ASGI server and its lifespan enabled.
```

See the [Python migration guide](https://github.com/modelcontextprotocol/python-sdk/blob/main/docs/migration.md) for the 1.x `FastMCP` name. Verify the mounted path rather than blindly appending `/sse`. Correct ingress rewrites and method routing; never turn every 404 into a successful empty stream.

## Check with mcptest

Enter the endpoint in **Test your server** and compare transport attempts in the message log. [transport.get-stream-405](/learn/mcp-transport-diagnostics-reference#transport-get-stream-405) specifically identifies optional GET **405**, not arbitrary 404s. There is no dedicated 404 diagnostic. [session.unknown-id](/learn/mcp-transport-diagnostics-reference#session-unknown-id) actively checks stateful invalid-id handling; use it only when sessions apply. A failing POST belongs in the [POST error guide](/learn/mcp-error-posting-to-endpoint).
