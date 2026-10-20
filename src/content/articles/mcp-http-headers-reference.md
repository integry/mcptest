---
title: MCP HTTP headers reference
navTitle: HTTP headers
summary: Every HTTP header a remote MCP server and client exchange over Streamable HTTP, with direction, versions, example values, failure symptoms and the mcptest diagnostic that fires.
track: reference
level: practitioner
order: 21
category: Protocol reference
readingTimeMinutes: 8
lastReviewed: "2026-10-20"
metaTitle: MCP HTTP headers reference (Mcp-Session-Id, MCP-Protocol-Version, Mcp-Method) | mcptest.io
metaDescription: Reference for MCP Streamable HTTP headers including MCP-Protocol-Version, Mcp-Session-Id, Mcp-Method, Mcp-Name, Accept, Last-Event-ID, WWW-Authenticate and CORS.
relatedSlugs:
  - mcp-protocol-versions-explained
  - mcp-transport-diagnostics-reference
  - mcp-json-rpc-error-codes
  - troubleshooting
sourceLinks:
  - title: "MCP 2026-07-28: Streamable HTTP"
    url: "https://modelcontextprotocol.io/specification/2026-07-28/basic/transports/streamable-http"
  - title: "MCP 2025-11-25: Transports"
    url: "https://modelcontextprotocol.io/specification/2025-11-25/basic/transports"
  - title: "MCP 2025-06-18: Transports"
    url: "https://modelcontextprotocol.io/specification/2025-06-18/basic/transports"
  - title: "MCP 2025-03-26: Transports"
    url: "https://modelcontextprotocol.io/specification/2025-03-26/basic/transports"
  - title: "MCP 2025-11-25: Authorization"
    url: "https://modelcontextprotocol.io/specification/2025-11-25/basic/authorization"
  - title: "RFC 9728: OAuth 2.0 Protected Resource Metadata"
    url: "https://www.rfc-editor.org/rfc/rfc9728"
  - title: "RFC 6750: Bearer Token Usage"
    url: "https://www.rfc-editor.org/rfc/rfc6750"
  - title: "RFC 9110: HTTP Semantics (Retry-After, 406, 415)"
    url: "https://www.rfc-editor.org/rfc/rfc9110"
  - title: "RFC 6585: Additional HTTP Status Codes (429)"
    url: "https://www.rfc-editor.org/rfc/rfc6585"
  - title: "Fetch Standard: CORS protocol"
    url: "https://fetch.spec.whatwg.org/"
  - title: "MDN: Access-Control-Expose-Headers"
    url: "https://developer.mozilla.org/en-US/docs/Web/HTTP/Reference/Headers/Access-Control-Expose-Headers"
---

Streamable HTTP is the remote transport in every revision since 2025-03-26. Header names are case-insensitive. The examples below use the spelling in the current specification. For how versions differ overall, see [MCP protocol versions explained](/learn/mcp-protocol-versions-explained).

## Summary table

| Header | Direction | Versions | Required |
| --- | --- | --- | --- |
| `MCP-Protocol-Version` | Client to server | 2025-06-18 and later | After `initialize` (2025); every POST (2026) |
| `Mcp-Session-Id` | Both | 2025-03-26 to 2025-11-25 | When the server issued one |
| `Mcp-Method` | Client to server | 2026-07-28 | Every POST |
| `Mcp-Name` | Client to server | 2026-07-28 | `tools/call`, `resources/read`, `prompts/get` |
| `Accept` | Client to server | All Streamable HTTP | Every POST and GET |
| `Content-Type` | Both | All | Request bodies and responses with a body |
| `Last-Event-ID` | Client to server | 2025-03-26 to 2025-11-25 | Only when resuming |
| `Retry-After` | Server to client | Not MCP-specific | With `429` or `503` |
| `Authorization` | Client to server | Servers using OAuth or tokens | Every request once authorized |
| `WWW-Authenticate` | Server to client | Authorization spec | With `401`, and `403` for scope |
| `Origin` | Client to server (set by browsers) | All | Servers MUST validate it |
| `Access-Control-*` | Server to client | Browser clients only | For cross-origin browser access |

## MCP-Protocol-Version

- **Direction:** client to server.
- **Versions:** introduced in 2025-06-18. In 2025-06-18 and 2025-11-25 the client sends the negotiated version on every request after `initialize`. In 2026-07-28 every POST carries it, and it MUST equal `params._meta["io.modelcontextprotocol/protocolVersion"]`.
- **Example:** `MCP-Protocol-Version: 2026-07-28`
- **When missing:** a 2025 server with no other signal SHOULD assume `2025-03-26`. A 2026 server that supports clients older than 2025-06-18 MAY assume the same; otherwise it MUST reject the request.
- **When wrong:** an invalid or unsupported value gets `400 Bad Request`. In 2026, a value that differs from `_meta` gets `400` with `-32020` HeaderMismatch, and an unsupported version gets `400` with `-32022` and a `supported` list.
- **Browser note:** the server must allow this header in `Access-Control-Allow-Headers`, or the preflight fails before the request is sent.
- **mcptest:** the SDK sets it from the negotiated version, or from the request's `_meta` on 2026 requests. When an `initialize` response does not expose it to the browser, the `transport.cors-expose-headers-missing` evidence says so.

## Mcp-Session-Id

- **Direction:** server to client on the `initialize` response, then client to server on every later request, including GET and DELETE.
- **Versions:** 2025-03-26 to 2025-11-25 (written `MCP-Session-Id` in 2025-11-25). Removed in 2026-07-28; a 2026 server SHOULD ignore it.
- **Example:** `Mcp-Session-Id: 1868a90c-6b4e-4b0e-9b2f-3c1d0e4c7a51`
- **Rules:** visible ASCII only (0x21 to 0x7E), and SHOULD be globally unique and cryptographically secure. The client sends DELETE with the header to end the session; the server MAY answer `405`.
- **When missing:** a server that requires a session SHOULD answer `400`. An expired or unknown ID MUST get `404`, and the client MUST start again with `initialize` and no session ID.
- **mcptest:** the TypeScript SDK reads the header from a successful `initialize` response and attaches it afterwards. If a cross-origin browser cannot read it, the next request goes out without it. `transport.cors-expose-headers-missing` fires when that request is rejected with a session error.

```http
HTTP/1.1 200 OK
Content-Type: application/json
Mcp-Session-Id: 1868a90c-6b4e-4b0e-9b2f-3c1d0e4c7a51
Access-Control-Expose-Headers: Mcp-Session-Id, MCP-Protocol-Version
```

## Mcp-Method

- **Direction:** client to server.
- **Versions:** 2026-07-28.
- **Required:** on every request, with the value of the JSON-RPC `method`.
- **Example:** `Mcp-Method: tools/call`
- **Purpose:** lets gateways, load balancers and WAFs route without parsing the body.
- **When missing or different from the body:** `400` with `-32020` HeaderMismatch from a server that reads the body. An intermediary MUST return an HTTP error but need not send a JSON-RPC body.
- **mcptest:** the SDK sets it on every request that carries a 2026 `_meta` envelope (`_applyBodyDerivedHeaders` in `@modelcontextprotocol/client`). There is no dedicated diagnostic; the `400` body is shown in the log.

## Mcp-Name

- **Direction:** client to server.
- **Versions:** 2026-07-28.
- **Required:** on `tools/call` and `prompts/get` (value of `params.name`) and on `resources/read` (value of `params.uri`).
- **Example:** `Mcp-Name: get_weather`
- **Encoding:** a value with non-ASCII characters, control characters, or leading or trailing whitespace MUST be sent as `=?base64?<Base64 of UTF-8>?=`. Servers decode it before comparing it with the body.
- **When missing or different:** `400` with `-32020` HeaderMismatch.
- **Related:** `Mcp-Param-<name>` headers mirror tool arguments whose input schema declares `x-mcp-header`. A client MUST omit the header when the value is null or absent.

## Accept

- **Direction:** client to server.
- **Versions:** all Streamable HTTP revisions.
- **POST:** MUST list both `application/json` and `text/event-stream`, because the server may answer with either.
- **GET (2025 only):** MUST list `text/event-stream`.
- **Example:** `Accept: application/json, text/event-stream`
- **When missing or partial:** servers built on the TypeScript SDK answer `406` with "Not Acceptable: Client must accept both application/json and text/event-stream".
- **mcptest:** the SDK always sends both types on POST. A `406` from the target therefore points at an over-strict server check and fires [`transport.accept-header-406`](/learn/mcp-transport-diagnostics-reference#transportaccept-header-406).

## Content-Type

- **Request:** JSON-RPC bodies are sent as `Content-Type: application/json`. The specification shows this in examples rather than as a normative rule.
- **Response to a POST that carried a request:** `application/json` for a single JSON response, or `text/event-stream` for a stream. Clients MUST support both.
- **Response to GET (2025):** `text/event-stream`, or `405`.
- **Notifications and client responses:** `202 Accepted` with no body.
- **When wrong:** a server that rejects `application/json`, for example over a charset parameter or letter case, answers `415`. A successful response with another type is refused by the client ("Unexpected content type").
- **mcptest:** `transport.unsupported-media-type-415` for a `415`, and `transport.sse-content-type-mismatch` for a `2xx` with the wrong type.

## Last-Event-ID

- **Direction:** client to server, on GET.
- **Versions:** 2025-03-26 to 2025-11-25. Removed in 2026-07-28; servers ignore it.
- **Purpose:** resumes an SSE stream after a disconnect. The server MAY tag events with `id`. The client reconnects with the last ID it saw, and the server MUST NOT replay messages from a different stream. In 2025-11-25, resumption is always a GET.
- **Example:** `Last-Event-ID: stream-3:42`
- **Related:** in 2025-11-25 a server may close the stream after sending an SSE `retry` field, and the client MUST wait that many milliseconds before reconnecting.
- **Browser note:** list it in `Access-Control-Allow-Headers` if browsers resume streams.

## Retry-After

- **Direction:** server to client.
- **Versions:** not defined by MCP. It is an HTTP header (RFC 9110) that RFC 6585 allows on `429 Too Many Requests`.
- **Values:** delay in seconds (`Retry-After: 30`) or an HTTP date (`Retry-After: Wed, 21 Oct 2026 07:28:00 GMT`).
- **When missing:** clients guess. mcptest waits one second.
- **Browser note:** `Retry-After` is not a CORS-safelisted response header. A cross-origin browser can read it only when the server lists it in `Access-Control-Expose-Headers`.
- **mcptest:** a target `429` fires `transport.target-rate-limited-429`. mcptest retries at most once per candidate endpoint, and only when the wait is 2 seconds or less (`MAX_AUTOMATIC_RATE_LIMIT_WAIT_MS` in `src/utils/transportDetection.ts`). Longer waits are shown as a countdown.

## Authorization

- **Direction:** client to server.
- **Format:** `Authorization: Bearer <access token>` on every HTTP request. Tokens MUST NOT be sent in the query string.
- **When missing or invalid:** `401` with `WWW-Authenticate`.
- **Browser note:** `Authorization` is never CORS-safelisted, so it must appear in `Access-Control-Allow-Headers`.
- **mcptest:** when you connect through the optional CORS proxy, the target's `Authorization` value travels as `X-MCP-Authorization`. The proxy's own sign-in uses `Authorization` (`getRequestHeadersForCandidate` in `src/utils/transportDetection.ts`). The proxy marks whether it or the target produced a response with `X-MCP-Proxy-Response-Source`.

## WWW-Authenticate

- **Direction:** server to client.
- **On `401`:** carries `resource_metadata`, the URL of the RFC 9728 protected resource metadata, and SHOULD carry `scope`. If it is absent, clients fall back to `/.well-known/oauth-protected-resource`.
- **On `403`:** `error="insufficient_scope"` with the needed `scope` asks the client to step up (RFC 6750 section 3.1).
- **Example:**

```http
HTTP/1.1 401 Unauthorized
WWW-Authenticate: Bearer resource_metadata="https://mcp.example.com/.well-known/oauth-protected-resource/mcp", scope="files:read"
```

- **Browser note:** browsers hide this header from cross-origin scripts unless it appears in `Access-Control-Expose-Headers`. A browser client then falls back to well-known discovery.
- **mcptest:** challenges are recorded with credential-like values redacted and start the OAuth flow. See the [OAuth 2.1 reference](/learn/mcp-oauth-2-1-reference).

## Origin

- **Direction:** client to server. Browsers set it and scripts cannot change it.
- **Rule:** servers MUST validate `Origin` on all incoming connections to prevent DNS rebinding. From 2025-11-25, a present but invalid `Origin` MUST get `403 Forbidden`.
- **Example:** `Origin: https://mcptest.io`
- **mcptest:** there is no dedicated transport diagnostic. The connection error card classifies `401` and `403` as authentication failures (`src/utils/connectionDiagnostics.ts`).

## Access-Control-Allow-Origin

Sent on the preflight and the actual response. It must be the requesting origin (or `*` when no credentials are involved). Keep the list narrow; CORS is not a replacement for `Origin` validation or authorization.

## Access-Control-Allow-Methods

`POST` for 2026-only servers. For 2025 servers, `POST, GET, DELETE`, covering the optional GET stream and session termination.

## Access-Control-Allow-Headers

List every non-safelisted request header the client sends:

```http
Access-Control-Allow-Headers: Content-Type, Accept, Authorization, MCP-Protocol-Version, Mcp-Session-Id, Mcp-Method, Mcp-Name, Last-Event-ID
```

`Content-Type: application/json` is not a safelisted value, so every MCP POST triggers a preflight. Add any `Mcp-Param-*` names your tools declare.

## Access-Control-Expose-Headers

Response headers a cross-origin script may read, beyond the safelisted ones:

```http
Access-Control-Expose-Headers: Mcp-Session-Id, MCP-Protocol-Version, WWW-Authenticate, Retry-After
```

Without `Mcp-Session-Id` here, a 2025 stateful server appears to initialize and then rejects every request.

## Access-Control-Max-Age

Optional. Caches the preflight result so that every MCP POST does not pay for an extra `OPTIONS` round trip.

## Try it

Open [Context7 in the playground](/server/https://mcp.context7.com/mcp/mcp), a public catalog server that negotiated 2026-07-28 at its last validation. Each request it sends carries `MCP-Protocol-Version` and `Mcp-Method`, and tool calls add `Mcp-Name`. If a header problem stops a connection, the diagnostic and the headers sent and seen appear on the connection error card.
