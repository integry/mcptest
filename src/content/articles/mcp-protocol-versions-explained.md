---
title: MCP protocol versions explained
navTitle: Protocol versions
summary: What changed in each MCP revision from 2024-11-05 to 2026-07-28, how clients negotiate and fall back between them, and what stateless means in 2026.
track: reference
level: practitioner
order: 20
category: Protocol reference
readingTimeMinutes: 7
lastReviewed: "2026-10-20"
metaTitle: MCP protocol version differences, 2024-11-05 to 2026-07-28 | mcptest.io
metaDescription: MCP protocol version differences in one table. Transport, authorization, headers, lifecycle and capability changes per revision, plus negotiation and fallback rules.
relatedSlugs:
  - mcp-http-headers-reference
  - mcp-json-rpc-error-codes
  - mcp-oauth-2-1-reference
  - troubleshooting
sourceLinks:
  - title: MCP 2026-07-28 changelog
    url: "https://modelcontextprotocol.io/specification/2026-07-28/changelog"
  - title: MCP 2025-11-25 changelog
    url: "https://modelcontextprotocol.io/specification/2025-11-25/changelog"
  - title: MCP 2025-06-18 changelog
    url: "https://modelcontextprotocol.io/specification/2025-06-18/changelog"
  - title: MCP 2025-03-26 changelog
    url: "https://modelcontextprotocol.io/specification/2025-03-26/changelog"
  - title: "MCP 2024-11-05: Transports"
    url: "https://modelcontextprotocol.io/specification/2024-11-05/basic/transports"
  - title: "MCP 2025-11-25: Lifecycle"
    url: "https://modelcontextprotocol.io/specification/2025-11-25/basic/lifecycle"
  - title: "MCP 2025-11-25: Transports"
    url: "https://modelcontextprotocol.io/specification/2025-11-25/basic/transports"
  - title: "MCP 2026-07-28: Versioning and compatibility"
    url: "https://modelcontextprotocol.io/specification/2026-07-28/basic/versioning"
  - title: "MCP 2026-07-28: Streamable HTTP"
    url: "https://modelcontextprotocol.io/specification/2026-07-28/basic/transports/streamable-http"
  - title: "MCP 2026-07-28: server/discover"
    url: "https://modelcontextprotocol.io/specification/2026-07-28/server/discover"
  - title: "MCP 2026-07-28: Overview (stateless protocol, _meta)"
    url: "https://modelcontextprotocol.io/specification/2026-07-28/basic/index"
  - title: MCP specification versioning
    url: "https://modelcontextprotocol.io/specification/versioning"
---

An MCP version is a date string, `YYYY-MM-DD`, naming the last day backwards-incompatible changes were made. The [versioning page](https://modelcontextprotocol.io/specification/versioning) lists `2026-07-28` as current. This page covers the five revisions a remote server can meet today.

## Comparison table

| | 2024-11-05 | 2025-03-26 | 2025-06-18 | 2025-11-25 | 2026-07-28 |
| --- | --- | --- | --- | --- | --- |
| Remote transport | HTTP+SSE (two endpoints) | Streamable HTTP | Streamable HTTP | Streamable HTTP | Streamable HTTP, POST only |
| Handshake | `initialize` | `initialize` | `initialize` | `initialize` | None; per-request `_meta` |
| Version negotiation | In `initialize` | In `initialize` | In `initialize` | In `initialize` | Per request; `server/discover` advertises versions |
| Session header | None | `Mcp-Session-Id` | `Mcp-Session-Id` | `MCP-Session-Id` | Removed |
| `MCP-Protocol-Version` header | No | No | Required after init | Required after init | Required on every POST |
| `Mcp-Method` / `Mcp-Name` | No | No | No | No | Required |
| JSON-RPC batching | No | Yes | Removed | No | No |
| GET stream | SSE endpoint | Optional | Optional | Optional | Removed |
| `Last-Event-ID` resumption | No | Yes | Yes | Yes (always via GET) | Removed |
| Authorization spec | None | OAuth 2.1 | Server is an OAuth resource server; RFC 9728, RFC 8707 | Adds OIDC discovery, CIMD, scope step-up | DCR deprecated; RFC 9207 `iss`; issuer-bound credentials |
| Invalid `Origin` | Validate | Validate | Validate | Validate; `403` | Validate; `403` |

Header names are case-insensitive, so the `Mcp-Session-Id`/`MCP-Session-Id` spelling change is cosmetic. See the [HTTP headers reference](/learn/mcp-http-headers-reference) for each header.

## 2024-11-05

- **Transport:** stdio and HTTP with Server-Sent Events. The server exposes an SSE endpoint and a separate POST endpoint; on connect it "MUST send an `endpoint` event" naming the POST URI ([transports](https://modelcontextprotocol.io/specification/2024-11-05/basic/transports)).
- **Auth:** no authorization specification. Servers MUST validate `Origin` and SHOULD authenticate connections.
- **Lifecycle:** `initialize` request, result, then `notifications/initialized`.
- **Unsupported version error:** the lifecycle example uses `-32602` with `data.supported` and `data.requested`.

## 2025-03-26

From the [changelog](https://modelcontextprotocol.io/specification/2025-03-26/changelog):

- **Transport:** Streamable HTTP replaces HTTP+SSE. One endpoint takes POST (and optionally GET). The server may assign `Mcp-Session-Id` on the `initialize` response; the client returns it on every later request.
- **Auth:** an authorization framework based on OAuth 2.1.
- **Messages:** JSON-RPC batching added.
- **Capabilities:** tool annotations (for example read-only or destructive), audio content, a `completions` capability, and `message` on progress notifications.

## 2025-06-18

From the [changelog](https://modelcontextprotocol.io/specification/2025-06-18/changelog):

- **Headers:** after initialization the client MUST send the negotiated version in `MCP-Protocol-Version` on every HTTP request. A server that receives no header and has no other signal SHOULD assume `2025-03-26`; an invalid or unsupported value MUST get `400 Bad Request`.
- **Messages:** JSON-RPC batching removed.
- **Auth:** MCP servers are OAuth resource servers that publish protected resource metadata; clients MUST send RFC 8707 resource indicators.
- **Capabilities:** structured tool output (`outputSchema`, `structuredContent`), elicitation, resource links in tool results, `title` fields, and `_meta` on more types.
- **Lifecycle:** lifecycle operation wording tightened from SHOULD to MUST; a security best practices page added.

## 2025-11-25

From the [changelog](https://modelcontextprotocol.io/specification/2025-11-25/changelog):

- **Transport:** an invalid `Origin` MUST get `403 Forbidden`. Servers may close an SSE stream at will after sending an SSE `retry` field, and clients reconnect; resumption is always a GET with `Last-Event-ID`.
- **Auth:** OpenID Connect Discovery for authorization servers, Client ID Metadata Documents as the recommended registration mechanism, incremental scope consent through `WWW-Authenticate`, and protected resource metadata discovery aligned with RFC 9728 (the header is optional; clients fall back to `.well-known`).
- **Errors:** input validation errors are tool execution errors (`isError: true`), not protocol errors.
- **Capabilities:** icons, URL-mode elicitation, tools in sampling, experimental tasks, and JSON Schema 2020-12 as the default dialect.

## 2026-07-28

From the [changelog](https://modelcontextprotocol.io/specification/2026-07-28/changelog):

- **Lifecycle:** the `initialize`/`notifications/initialized` handshake is removed. Every request carries `io.modelcontextprotocol/protocolVersion` and `io.modelcontextprotocol/clientCapabilities` in `params._meta`. Servers MUST implement `server/discover`.
- **Transport:** protocol-level sessions and `Mcp-Session-Id` are removed. The GET stream and `resources/subscribe` are replaced by `subscriptions/listen`, a long-lived POST response stream. `Last-Event-ID` resumption is removed; a broken stream loses the in-flight request and the client re-issues it with a new ID.
- **Headers:** `Mcp-Method` on every POST, `Mcp-Name` on `tools/call`, `resources/read` and `prompts/get`, and optional `Mcp-Param-*` headers declared with `x-mcp-header`.
- **Server-to-client requests:** sampling, elicitation and roots requests are replaced by multi round-trip requests: the server returns `resultType: "input_required"` and the client retries with `inputResponses`. All results carry `resultType`.
- **Removed methods:** `ping`, `logging/setLevel`, `notifications/roots/list_changed`.
- **Errors:** resource not found moves from `-32002` to `-32602`; new codes `-32020` HeaderMismatch, `-32021` MissingRequiredClientCapability, `-32022` UnsupportedProtocolVersion. See [MCP error codes](/learn/mcp-json-rpc-error-codes).
- **Auth:** Dynamic Client Registration deprecated in favour of Client ID Metadata Documents; clients MUST validate a present RFC 9207 `iss`; credentials are bound to the issuer. See the [OAuth 2.1 reference](/learn/mcp-oauth-2-1-reference).
- **Deprecated:** Roots, Sampling and Logging; the HTTP+SSE transport is formally Deprecated.
- **Caching:** list and read results carry `ttlMs` and `cacheScope`.

## Stateless in 2026

The [overview](https://modelcontextprotocol.io/specification/2026-07-28/basic/index) calls MCP "a stateless protocol". In practice:

- A server MUST NOT rely on earlier requests for the client's version, capabilities or identity; each request states them in `_meta`.
- There is no session ID to store, share between replicas, or expire. Any instance can serve any request.
- State that spans calls, such as a cart or an open browser, MUST be referenced by an explicit identifier, typically a handle returned by one tool and passed as an argument to the next.
- A missing required `_meta` field gets `-32602` with HTTP `400`.

Stateless does not mean unauthenticated: the `Authorization` header still travels on every request.

```http
POST /mcp HTTP/1.1
Content-Type: application/json
Accept: application/json, text/event-stream
MCP-Protocol-Version: 2026-07-28
Mcp-Method: tools/call
Mcp-Name: get_weather

{"jsonrpc":"2.0","id":7,"method":"tools/call","params":{"name":"get_weather","arguments":{"location":"Paris"},"_meta":{"io.modelcontextprotocol/protocolVersion":"2026-07-28","io.modelcontextprotocol/clientCapabilities":{}}}}
```

## Negotiation through 2025-11-25

Defined in the [lifecycle](https://modelcontextprotocol.io/specification/2025-11-25/basic/lifecycle):

1. The client sends `initialize` with a `protocolVersion` it supports, which SHOULD be its latest.
2. If the server supports it, it MUST answer with the same version; otherwise with another version it supports, which SHOULD be its latest.
3. If the client does not support the server's answer, it SHOULD disconnect.
4. Over HTTP, the client then sends `MCP-Protocol-Version` on every request (2025-06-18 and later).

To reach a 2024-11-05 server, a Streamable HTTP client POSTs `initialize`; if that fails with `400`, `404` or `405`, it sends GET and expects an SSE stream whose first event is `endpoint` ([2025-11-25 transports](https://modelcontextprotocol.io/specification/2025-11-25/basic/transports)).

## Negotiation in 2026-07-28

Defined in [versioning and compatibility](https://modelcontextprotocol.io/specification/2026-07-28/basic/versioning):

- There is no handshake. Each request names its version; a server that does not implement it MUST return `-32022` with `data.supported` and `data.requested`, over HTTP with status `400`.
- The client SHOULD pick a mutually supported version from `supported` and retry.
- Clients MAY call `server/discover` first. Its result carries `supportedVersions`, `capabilities` and server identity.
- Era detection over HTTP: on a `400`, inspect the body. A recognized 2026 error means correct and retry; an empty or unrecognized body means fall back to `initialize`, and then to HTTP+SSE if needed.
- A dual-era server serves requests with 2026 `_meta` statelessly and an `initialize` with 2025 session semantics.

| Client | Server | Result |
| --- | --- | --- |
| 2026 only | 2025 only | Fails |
| Dual-era | 2025 only | Works through `initialize` fallback |
| 2025 only | 2026 only | Fails; over HTTP with `400` for missing headers |
| 2025 only | Dual-era | Works |

## How mcptest negotiates

mcptest is a dual-era client built on the official TypeScript SDK (`@modelcontextprotocol/client` 2.0).

- `createNegotiatingMcpClient` in `src/utils/mcpClient.ts` sets `versionNegotiation: { mode: 'auto' }`. The SDK first sends `server/discover` with a 2026-07-28 `_meta` envelope.
- A valid discover result that lists a version mcptest supports selects the stateless era. A `-32022` naming a mutual 2026 version triggers one corrective retry.
- Anything else that is not proof of 2026 support, including an unrecognized `400`, falls back to `initialize`. The SDK offers `2025-11-25` and accepts `2025-11-25`, `2025-06-18`, `2025-03-26`, `2024-11-05` or `2024-10-07` in reply.
- A `401` or `403` stops negotiation as an authorization outcome rather than a fallback, and a `5xx` is a failure.
- Legacy SSE candidates use `createLegacyMcpClient` (`mode: 'legacy'`), which skips the probe.
- `src/utils/transportDetection.ts` keeps the exact URL you entered and also tries conventional `/mcp` and `/sse` siblings. Candidates are tried in priority groups, with a 5-second deadline per group, first directly and then through the optional CORS proxy.
- The result shows the negotiated era (`stateless`, `stateful` or `legacy`) and version. In reports, `src/compatibility/profiles.ts` checks the protocol era (2024, 2025 or 2026) and session behavior against host profiles for ChatGPT, Claude, Cursor, VS Code/Copilot and a generic SDK. For ChatGPT it adds `protocol.stateful-scaling-caveat` when the server holds session state.

## Try it

To see a 2026-07-28 stateless negotiation, open [Context7 in the playground](/server/https://mcp.context7.com/mcp/mcp). It is a public catalog server that negotiated 2026-07-28 at its last validation. Then compare its request headers with those of a 2025-era server.
