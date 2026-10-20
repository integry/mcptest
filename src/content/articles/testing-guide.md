---
title: Testing Remote MCP Servers
navTitle: Testing Guide
summary: A step-by-step guide to validating stateless 2026 and stateful 2025 remote MCP servers, in the playground and from the command line.
track: build
level: practitioner
order: 1
category: Testing
readingTimeMinutes: 7
lastReviewed: "2026-08-09"
path: /docs/testing-guide
metaTitle: Testing Guide for Remote MCP Servers | mcptest.io
metaDescription: Learn how to test, inspect, and debug remote Model Context Protocol (MCP) servers. A step-by-step developer guide for validating stateless and stateful flows.
relatedSlugs:
  - troubleshooting
  - remote-vs-local
sourceLinks:
  - title: MCP 2026-07-28 specification
    url: "https://modelcontextprotocol.io/specification/2026-07-28"
  - title: "TypeScript SDK: protocol version guide"
    url: "https://github.com/modelcontextprotocol/typescript-sdk/blob/main/docs/protocol-versions.md"
  - title: MCP Inspector
    url: "https://github.com/modelcontextprotocol/inspector"
---

A useful MCP test proves more than reachability. It identifies the protocol era, validates HTTP and JSON-RPC behavior, exercises every advertised capability, checks authentication, and confirms failures are safe and actionable. This guide covers stateless 2026 servers and the stateful 2025 servers still widely deployed.

## Start with the exact endpoint

Use the complete published MCP URL, including its path, for example `https://your-server.example.com/custom/mcp`. mcptest.io tries that exact URL first, then conventional path fallbacks only when needed. A valid auth challenge means the service is reachable but does not, by itself, prove that anonymous MCP negotiation passed.

## Interactive testing in the playground

Enter the endpoint and connect. The playground first probes with `server/discover`. If the server offers `2026-07-28`, the client uses stateless, self-describing requests. If the endpoint is 2025-only, it falls back to `initialize`, sends `notifications/initialized`, and preserves a server-issued `Mcp-Session-Id`. The deprecated HTTP+SSE transport is the last fallback. Authentication responses are surfaced instead of being misclassified as an old protocol.

Check the connection log before testing features. For a stateless server, confirm the negotiated version and that discovery capabilities match reality. For a stateful server, confirm the initialization result, selected version, capabilities, and any session header. The same client API then lists and invokes capabilities in either era.

### Capabilities

- **Tools:** inspect every input schema, call each tool with representative valid input, and compare structured output with its declared schema.
- **Negative tool calls:** try missing required fields, wrong types, bounds, unexpected properties, unusual Unicode, and large inputs. Recoverable tool failures should normally return a tool result with `isError: true`, not crash the transport.
- **Resources:** list and read several URIs; verify MIME types, text versus base64 content, templates, pagination, and authorization boundaries.
- **Prompts:** list templates, exercise required and optional arguments, and verify the returned messages and roles.
- **2026 caches:** where list results provide `ttlMs` and `cacheScope`, verify they reflect the data's real freshness and privacy boundary.
- **2026 multi-round trips:** exercise calls that return `input_required`, then verify the retried request carries the expected `inputResponses` and request state.

### Authentication

For OAuth servers, start without credentials. A correct `401` should lead to protected-resource metadata, authorization-server metadata, client identification, and an authorization-code flow with PKCE. Verify the client selection order: a pre-registered client first, a Client ID Metadata Document when the server advertises support, and Dynamic Client Registration only as a legacy fallback. After sign-in, verify that the token is accepted only by its intended MCP resource and that insufficient scopes produce a useful `403` challenge. For provider-specific servers, select bearer token or API key and verify both valid and invalid credentials.

> **Browser clients need CORS.** Allow `Content-Type`, `Accept`, `Authorization`, `x-api-key`, `MCP-Protocol-Version`, `Mcp-Method`, and `Mcp-Name`. For stateful 2025 support, also allow `Mcp-Session-Id` and `Last-Event-ID`, and expose `Mcp-Session-Id` in responses.

## Command-line check: stateless 2026

A 2026 server must implement `server/discover`. The client call is optional, but it is the clearest compatibility probe. Include the version and method headers plus the required per-request metadata:

```bash
curl -i https://your-server.example.com/mcp \
  -H "Content-Type: application/json" \
  -H "Accept: application/json, text/event-stream" \
  -H "MCP-Protocol-Version: 2026-07-28" \
  -H "Mcp-Method: server/discover" \
  -d '{
    "jsonrpc": "2.0",
    "id": "discover-1",
    "method": "server/discover",
    "params": {
      "_meta": {
        "io.modelcontextprotocol/protocolVersion": "2026-07-28",
        "io.modelcontextprotocol/clientInfo": {
          "name": "curl-check",
          "version": "1.0.0"
        },
        "io.modelcontextprotocol/clientCapabilities": {}
      }
    }
  }'
```

A successful result advertises supported versions and capabilities. There is no initialized notification and no session header to retain. Test an ordinary request independently:

```bash
curl -i https://your-server.example.com/mcp \
  -H "Content-Type: application/json" \
  -H "Accept: application/json, text/event-stream" \
  -H "MCP-Protocol-Version: 2026-07-28" \
  -H "Mcp-Method: tools/list" \
  -d '{
    "jsonrpc": "2.0",
    "id": 2,
    "method": "tools/list",
    "params": {
      "_meta": {
        "io.modelcontextprotocol/protocolVersion": "2026-07-28",
        "io.modelcontextprotocol/clientCapabilities": {}
      }
    }
  }'
```

For `tools/call`, add `Mcp-Name: <tool-name>`. Do the same with the resource URI for `resources/read` and prompt name for `prompts/get`. Confirm a missing method header, a missing required name header, or a mismatch between the header and body metadata is rejected rather than silently routed.

## Command-line check: stateful 2025

A 2025-only server begins with initialization. Keep `-i` so the response headers reveal whether it issued a session ID:

```bash
curl -i https://your-server.example.com/mcp \
  -H "Content-Type: application/json" \
  -H "Accept: application/json, text/event-stream" \
  -d '{
    "jsonrpc": "2.0",
    "id": 1,
    "method": "initialize",
    "params": {
      "protocolVersion": "2025-11-25",
      "capabilities": {},
      "clientInfo": { "name": "curl-check", "version": "1.0.0" }
    }
  }'
```

Complete the handshake and carry the negotiated version and session ID on later requests:

```bash
# Use the Mcp-Session-Id returned above when the server issued one.
curl -i https://your-server.example.com/mcp \
  -H "Content-Type: application/json" \
  -H "Accept: application/json, text/event-stream" \
  -H "MCP-Protocol-Version: 2025-11-25" \
  -H "Mcp-Session-Id: $SESSION_ID" \
  -d '{"jsonrpc":"2.0","method":"notifications/initialized"}'

curl -i https://your-server.example.com/mcp \
  -H "Content-Type: application/json" \
  -H "Accept: application/json, text/event-stream" \
  -H "MCP-Protocol-Version: 2025-11-25" \
  -H "Mcp-Session-Id: $SESSION_ID" \
  -d '{"jsonrpc":"2.0","id":2,"method":"tools/list"}'
```

Omit the session header entirely when the server did not issue one; do not send a literal empty value. On a stateful implementation, verify missing IDs return 400, unknown or expired IDs return 404, optional GET and DELETE return either their documented behavior or 405, and concurrent sessions never leak data into one another.

## Failure and production checks

- Malformed JSON returns JSON-RPC `-32700`; an unknown method returns `-32601` instead of an empty body or generic 500.
- An unsupported version produces a protocol-specific error; 2026 header/body mismatches produce `400`.
- An invalid `Origin` is rejected, while approved browser origins pass preflight with the exact headers they need.
- Tokens are audience- and scope-checked, secrets are absent from logs and URLs, and rate limits apply at both endpoint and tool level.
- Concurrent calls, cancellation, proxy timeouts, SSE buffering, deploys, and instance scaling do not corrupt state or duplicate side effects.
- List ordering and cache hints remain deterministic; schema changes trigger the appropriate refresh behavior.

The official [MCP Inspector](https://github.com/modelcontextprotocol/inspector) is a useful second client, especially for stdio. For wire-level expectations use the [current specification](https://modelcontextprotocol.io/specification/2026-07-28) and the TypeScript SDK's [protocol-version guide](https://github.com/modelcontextprotocol/typescript-sdk/blob/main/docs/protocol-versions.md). When a check fails, continue to [troubleshooting](/docs/troubleshooting).
