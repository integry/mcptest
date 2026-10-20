---
title: Troubleshooting Remote MCP Servers
navTitle: Troubleshooting
summary: Map CORS, session, routing-header, streaming, and authorization failures to concrete fixes, with an HTTP status decoder.
track: reference
level: practitioner
order: 1
category: Troubleshooting
readingTimeMinutes: 8
lastReviewed: "2026-08-10"
path: /docs/troubleshooting
metaTitle: Troubleshooting MCP Server Errors | mcptest.io
metaDescription: Fix common Model Context Protocol connection issues. A technical guide to resolving CORS, session state errors, 404s, and routing metadata failures.
relatedSlugs:
  - testing-guide
  - connect-remote-mcp-server
sourceLinks:
  - title: MCP 2026-07-28 specification
    url: "https://modelcontextprotocol.io/specification/2026-07-28"
  - title: MCP 2025-11-25 specification
    url: "https://modelcontextprotocol.io/specification/2025-11-25"
  - title: "TypeScript SDK: protocol version negotiation guide"
    url: "https://github.com/modelcontextprotocol/typescript-sdk/blob/main/docs/protocol-versions.md"
---

Start with the actual HTTP exchange: endpoint, status, response headers, protocol era, and JSON-RPC body. Most failures then collapse into one of six buckets—wrong URL, 2026 routing metadata, 2025 session state, CORS, streaming infrastructure, or authorization.

## The endpoint cannot be reached

Test the full published endpoint, not only the origin. A server may be mounted at `/mcp`, a tenant path, or a completely custom route. mcptest.io preserves an explicit path and tests it first; conventional `/mcp` and `/sse` paths are fallbacks. A bare origin returning `404` therefore says little about a custom endpoint.

Use `curl -i` with the stateless discovery or stateful initialization request from the [testing guide](/docs/testing-guide). If neither reaches the application, check DNS, TLS, ingress path rewrites, request-size limits, and whether the process is bound to the forwarded port. A `401` or `403` proves the endpoint is reachable; it is an authentication outcome, not evidence that the server is stateful or broken.

## 2026 discovery or requests fail

A `2026-07-28` server must implement `server/discover`, although clients do not have to call it before other operations. Each request must carry `io.modelcontextprotocol/protocolVersion` and `io.modelcontextprotocol/clientCapabilities` in `params._meta`. On HTTP, it also needs `MCP-Protocol-Version` and `Mcp-Method`; named calls need `Mcp-Name`. The header version and body version must match.

If discovery succeeds but the next request gets `400`, compare those fields character for character and inspect gateway logs. Proxies often drop unfamiliar headers unless they are explicitly allowed. If a gateway routes on `Mcp-Method` or `Mcp-Name`, verify it forwards the same request unchanged. Do not add `Mcp-Session-Id` or send an initialization notification on the 2026 path; both belong to the older lifecycle.

## 2025 initialization or sessions fail

Revisions through `2025-11-25` begin with `initialize`, followed by `notifications/initialized`. If the response includes `Mcp-Session-Id`, preserve it exactly and attach it to the notification and every later request. The common symptoms are:

- **`400` after initialization:** the client lost the session ID, CORS hid it, or the server issued it too late.
- **Intermittent `404`:** session state is in one instance's memory and requests are reaching another, or the server expired the session.
- **Tabs affect one another:** the server is keying state on IP or a global variable rather than the opaque session ID.
- **DELETE or GET returns `405`:** this can be valid because explicit termination and the standalone SSE stream are optional.

A client should establish a new session after an expired-ID `404`. A server should use secure, unpredictable IDs and either shared storage or deliberate affinity when it scales out.

## Works in curl, fails in a browser

That pattern is usually CORS. The browser's preflight must allow the app's origin and every non-simple header the chosen protocol and authentication mode use. For an Express server supporting both eras:

```javascript
import cors from 'cors';

app.use(cors({
  origin: ['https://mcptest.io', 'http://localhost:5173'],
  allowedHeaders: [
    'Content-Type',
    'Accept',
    'Authorization',
    'x-api-key',
    'MCP-Protocol-Version',
    'Mcp-Method',
    'Mcp-Name',
    'Mcp-Session-Id',
    'Last-Event-ID'
  ],
  exposedHeaders: ['Mcp-Session-Id']
}));
```

Exposing `Mcp-Session-Id` matters only to stateful 2025 responses, but omitting it makes initialization appear successful while every later call fails. CORS does not replace authorization or MCP's origin checks. Keep the production origin list narrow and reject untrusted `Origin` values.

If you use mcptest.io's optional proxy, sign-in authenticates the proxy itself. OAuth bearer tokens or API keys authenticate only the target MCP server. A `401` from the proxy and a `401` from the target have different remedies; inspect the response and message log before refreshing target credentials.

## HTTP status decoder

| Status | Likely meaning |
| --- | --- |
| `400` | Malformed transport request: 2026 metadata/header mismatch, missing routing header, invalid version header, or a missing required 2025 session ID. |
| `401` | Authentication is required or the token is invalid or expired. Inspect `WWW-Authenticate` and protected-resource metadata. |
| `403` | Origin rejected, token lacks scope, API key lacks permission, or a policy blocks this method or named capability. |
| `404` | Wrong route, or—when a 2025 session header is present—an expired or unknown session. |
| `405` | Wrong endpoint for POST. In the 2025 era it can be a valid answer to optional GET or DELETE. |
| `406` | The requested response media types are unsupported; 2025 Streamable HTTP clients offer JSON and SSE on POST. |
| `202` | Normal empty acceptance for a 2025 notification or client response, not a failure. |

## SSE responses hang or arrive all at once

Reverse proxies and compression middleware commonly buffer SSE. Disable buffering on the route, avoid compressing event streams, and review idle timeouts from the application through the public ingress. Send correctly framed events and flush them after each message.

Interpret disconnects by protocol era. In 2026, closing a per-request SSE response cancels that request, and continuing notifications use `subscriptions/listen`. In 2025, a dropped stream is not automatically cancellation; resumable servers may accept `Last-Event-ID`, and explicit `notifications/cancelled` carries client cancellation. Applying one era's rule to the other can create duplicate work or jobs that never stop.

## OAuth discovery or token exchange fails

After a `401`, verify that `WWW-Authenticate` or the well-known URI leads to protected-resource metadata and that its authorization-server URLs are correct. Browser clients must also be able to read these metadata documents through CORS. Confirm the authorization server advertises PKCE `S256`, the redirect URI matches exactly, and the client sends the RFC 8707 `resource` value for the canonical MCP URI.

If login succeeds but the MCP endpoint rejects the token, compare issuer, audience, resource URI, expiry, and scopes. The 2026 authorization flow also validates the returned authorization issuer and must not reuse client credentials across issuers. Prefer Client ID Metadata Documents for new clients; Dynamic Client Registration is deprecated in 2026 and should remain only as a compatibility fallback. mcptest.io asks for a manually pre-registered client only when neither standardized automatic option succeeds.

## JSON-RPC and capability errors

`-32700` means invalid JSON, `-32601` means the method is absent, and `-32602` means invalid parameters. If a server advertises tools, resources, or prompts but their list methods return method-not-found, fix the advertised capabilities. Tool input and execution failures that a model can correct should normally be returned as a tool result with `isError: true`; reserve protocol errors for protocol failures.

## Still stuck?

Capture the exact endpoint, negotiated era and version, JSON-RPC request and response, HTTP status, and headers—with secrets removed. Those five details are usually enough to isolate the failing layer. Compare the exchange with the [current specification](https://modelcontextprotocol.io/specification/2026-07-28), the [2025 compatibility specification](https://modelcontextprotocol.io/specification/2025-11-25), and the official SDK's [negotiation guide](https://github.com/modelcontextprotocol/typescript-sdk/blob/main/docs/protocol-versions.md).
