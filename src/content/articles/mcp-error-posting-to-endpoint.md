---
title: "Streamable HTTP error: Error POSTing to endpoint"
navTitle: "HTTP POST rejected"
summary: "What the Error POSTing to endpoint wrapper means, how to read the status and body behind it, and fixes for wrong routes, credentials, headers and gateways."
track: "build"
level: "practitioner"
order: 452
category: "Transports"
readingTimeMinutes: 5
lastReviewed: "2026-11-11"
metaTitle: "Streamable HTTP error: Error POSTing to endpoint | mcptest.io"
metaDescription: "Fix Streamable HTTP error: Error POSTing to endpoint: read the HTTP status and body behind it, then fix the route, credentials, headers or gateway."
relatedSlugs:
  - troubleshooting
  - remote-mcp-server-401-unauthorized
  - mcp-error-sse-non-200-404
  - mcp-406-not-acceptable-415-and-405
  - mcp-error-request-timed-out
sourceLinks:
  - title: "TypeScript SDK 1.x Streamable HTTP client"
    url: "https://github.com/modelcontextprotocol/typescript-sdk/blob/v1.x/src/client/streamableHttp.ts"
  - title: "TypeScript SDK 2.x Streamable HTTP client"
    url: "https://github.com/modelcontextprotocol/typescript-sdk/blob/main/packages/client/src/client/streamableHttp.ts"
  - title: "MCP 2025-11-25 transports"
    url: "https://modelcontextprotocol.io/specification/2025-11-25/basic/transports"
  - title: "MCP 2026-07-28 Streamable HTTP"
    url: "https://modelcontextprotocol.io/specification/2026-07-28/basic/transports/streamable-http"
  - title: "Claude Code wrong endpoint HTML #79951"
    url: "https://github.com/anthropics/claude-code/issues/79951"
  - title: "Claude Code HTTP preflight headers #82534"
    url: "https://github.com/anthropics/claude-code/issues/82534"
  - title: "Claude Code gateway timeout report #44415"
    url: "https://github.com/anthropics/claude-code/issues/44415"
---

## Streamable HTTP error: Error POSTing to endpoint

```text
Streamable HTTP error: Error POSTing to endpoint: <response body>
```

The client's `POST` to the MCP endpoint got an HTTP error status. The client appends the response body, or the status text, after the colon. The wrapper is not the diagnosis: the status and body after it are.

**Who prints it:**

- TypeScript SDK 1.x prints the full string, with the `Streamable HTTP error:` prefix.
- TypeScript SDK 2.x prints `Error POSTing to endpoint: <body>`, as an `SdkHttpError` that carries the `status`. On 2026-07-28 requests, a 400 with a JSON-RPC error body is returned to the caller as that JSON-RPC error instead.
- The legacy HTTP+SSE client prints `Error POSTing to endpoint (HTTP <status>): <body>`.

[Claude Code](https://github.com/anthropics/claude-code/issues/79951) shows it with an HTML page as the body, with a [401 JSON body](https://github.com/anthropics/claude-code/issues/82534), and with [`Gateway Timeout`](https://github.com/anthropics/claude-code/issues/44415).

## Likely causes {#likely-causes-ranked-for-investigation}

1. **The request never reached an MCP handler.** The body is an HTML page or a plain 404 from a website, gateway, login or policy page. A wrong URL is the usual reason. In #79951 the endpoint answered with GitHub's HTML error page; the report does not establish whether the URL or the organization's sign-in policy caused it.
2. **Missing or rejected credentials.** A 401 or 403. In #82534 a connectivity check sent no configured headers and got 401, even though the token was valid.
3. **A gateway or proxy failed.** 502, 503 or 504 (`Gateway Timeout`) produced by something in front of the server. In #44415 the calls themselves took under half a second. The reporter later traced it to the server being configured with the legacy `type: "sse"`; switching to `type: "http"` removed the timeouts.
4. **The request was rejected by the transport rules.** 400, 405, 406 or 415 with a JSON body from the SDK, for a wrong header, method, protocol version or body.

## How to confirm the cause

Repeat the `POST` and read the status, content type and body:

```bash
curl -si https://mcp.example.com/mcp \
  -H 'Content-Type: application/json' \
  -H 'Accept: application/json, text/event-stream' \
  -H 'Authorization: Bearer <token>' \
  -d '{"jsonrpc":"2.0","id":1,"method":"initialize","params":{"protocolVersion":"2025-11-25","capabilities":{},"clientInfo":{"name":"probe","version":"1"}}}'
```

| Result | Cause | Next step |
| --- | --- | --- |
| `text/html` body, or 404 without a JSON-RPC body | Not an MCP handler (1) | Use the documented endpoint path; check gateway and sign-in rules |
| 401 with `WWW-Authenticate` | Credentials (2) | [401 troubleshooting](/learn/remote-mcp-server-401-unauthorized) |
| 502, 503 or 504 | Gateway (3) | Compare with a request sent directly to the origin |
| 406, 415 or 405 with a JSON-RPC body | Transport rules (4) | [406, 415 and 405 guide](/learn/mcp-406-not-acceptable-415-and-405) |
| 400 with `-32022` | Server does not support 2025 | Retry as 2026 (below) or update the client |
| 404 with `Session not found` | Expired session | [Session recovery](/learn/mcp-session-not-found-after-deploy) |

To test a 2026-07-28 server, send `server/discover` instead:

```bash
curl -si https://mcp.example.com/mcp \
  -H 'Content-Type: application/json' \
  -H 'Accept: application/json, text/event-stream' \
  -H 'MCP-Protocol-Version: 2026-07-28' \
  -H 'Mcp-Method: server/discover' \
  -d '{"jsonrpc":"2.0","id":1,"method":"server/discover","params":{"_meta":{"io.modelcontextprotocol/protocolVersion":"2026-07-28","io.modelcontextprotocol/clientCapabilities":{}}}}'
```

If curl works and the host fails, the host is sending something different. Compare its URL and headers in its debug log.

## Fix for client users

- Copy the endpoint URL exactly as the publisher documents it. Do not guess an API path from a website URL.
- Choose the transport the server supports. For Streamable HTTP that is usually `type: "http"`, not `"sse"`.
- Check that the failing request actually carries the configured headers. Some host versions drop them on one request, as #82534 shows.
- Remove tokens and cookies before sharing the error.
- Do not keep retrying a tool with side effects until you know whether it ran.

## Fix for server authors

- Return the real status. Keep `WWW-Authenticate` on 401 and `Retry-After` on 429 or 503.
- Do not let a proxy turn errors into a 200 HTML page or a login redirect on the MCP path.
- Leave header checks to the SDK. Under both the 2025 and 2026 transport rules, a client `POST` carries:

```http
Content-Type: application/json
Accept: application/json, text/event-stream
```

- If only the public route fails, compare the gateway's body size limits, allowed methods and timeouts with a direct request to the origin.
- Log a request id at the gateway and in the MCP handler, without tokens, so one failure can be traced through both.

If the `POST` succeeds but the reply never arrives, continue with [request timeouts](/learn/mcp-error-request-timed-out).

## Check with mcptest

Use **Test your server** and inspect each failed `POST` in the message log. Depending on the status, mcptest reports [transport.accept-header-406](/learn/mcp-transport-diagnostics-reference#transport-accept-header-406), [transport.unsupported-media-type-415](/learn/mcp-transport-diagnostics-reference#transport-unsupported-media-type-415) or [transport.target-rate-limited-429](/learn/mcp-transport-diagnostics-reference#transport-target-rate-limited-429). A 2xx reply with the wrong media type is reported as [transport.sse-content-type-mismatch](/learn/mcp-transport-diagnostics-reference#transport-sse-content-type-mismatch). There is no finding for the wrapper string itself.

## Related errors

- [SSE error: Non-200 status code (404)](/learn/mcp-error-sse-non-200-404): a later SSE fallback can hide this error.
- [406 Not Acceptable, 415 and 405](/learn/mcp-406-not-acceptable-415-and-405): the transport-rule statuses.
- [Remote MCP server 401 Unauthorized](/learn/remote-mcp-server-401-unauthorized): credential failures.
- [MCP error -32001: Request timed out](/learn/mcp-error-request-timed-out): the `POST` worked, but no reply came in time.
