---
title: Remote vs. Local MCP Servers
navTitle: Remote vs Local
summary: How stdio and Streamable HTTP servers differ in sessions, authentication, deployment, CORS, and compatibility.
track: understand
level: practitioner
order: 2
category: Transports
readingTimeMinutes: 7
lastReviewed: "2026-11-11"
path: /docs/remote-vs-local
metaTitle: Remote vs. Local MCP Servers | mcptest.io
metaDescription: Compare stdio and Streamable HTTP MCP servers. Learn how local and remote transports handle sessions, authentication, deployment, and compatibility.
relatedSlugs:
  - what-is-mcp
  - testing-guide
sourceLinks:
  - title: MCP 2026-07-28 Streamable HTTP transport
    url: "https://modelcontextprotocol.io/specification/2026-07-28/basic/transports/streamable-http"
  - title: MCP 2025-11-25 transports
    url: "https://modelcontextprotocol.io/specification/2025-11-25/basic/transports"
  - title: MCP 2026-07-28 authorization
    url: "https://modelcontextprotocol.io/specification/2026-07-28/basic/authorization"
---

MCP defines two standard transports: stdio, for a server the client launches on the user's machine, and Streamable HTTP, for a server deployed as a web service. Remote MCP also spans two lifecycle eras: stateless requests in `2026-07-28`, and the stateful `initialize` handshake of every earlier revision. Clients and production servers need to know which era each connection uses.

## Local servers: stdio {#local-servers}

With stdio, the client launches the server as a subprocess and exchanges newline-delimited JSON-RPC messages over standard input and output. The server must write nothing to stdout except valid MCP messages; logs go to stderr. stdio suits local files, developer tools, and anything that should have no network-facing endpoint.

Each client gets its own server process, which isolates clients from each other. Credentials usually arrive through environment variables. The trade-offs: the server and its runtime must be installed on the user's machine, every client starts its own process, and there is no shared hosted endpoint. stdio can carry either protocol era if the SDK supports it, so "local" does not mean "legacy".

## Remote servers: Streamable HTTP {#remote-servers}

A remote server exposes one MCP endpoint URL, such as `https://example.com/mcp`. The endpoint accepts JSON-RPC requests as HTTP POSTs and answers each one with `application/json` or with a `text/event-stream` (SSE) response for that request. One deployment serves many clients and can sit behind ordinary gateways, authentication services and load balancers.

### 2026 stateless flow {#stateless-flow}

In `2026-07-28`, every request stands alone. There is no `initialize` / `notifications/initialized` handshake and no `Mcp-Session-Id`. A server must implement `server/discover`; a client may call it first to learn the supported versions and capabilities. The TypeScript SDK's automatic negotiation mode uses that call to probe which era a server speaks.

Every request carries its protocol version and client capabilities in `params._meta`. On Streamable HTTP, every POST also needs the `MCP-Protocol-Version` and `Mcp-Method` headers, and `tools/call`, `resources/read` and `prompts/get` also need `Mcp-Name`. Header values must match the body; a mismatch is rejected with `400` and error `-32020`. Because the headers repeat what the body says, a gateway can route, authorize and meter a call without parsing JSON, and any healthy instance can handle any request.

A POST can still receive an SSE response while work runs, for example to stream progress. For ongoing change notifications, a client sends `subscriptions/listen`, which replaces the old standalone GET stream. Closing a request's SSE response cancels that request. When a tool needs input from the user mid-call, the server returns an `input_required` result and the client retries with the answers; the server no longer sends requests of its own over a long-lived connection.

### 2025 stateful flow {#stateful-flow}

Revisions through `2025-11-25` start with an `initialize` POST. The server returns the selected protocol version, its capabilities and its identity; the client acknowledges with `notifications/initialized`. A server that keeps session state also returns `Mcp-Session-Id`. The client must then send that opaque ID, and (from `2025-06-18`) the negotiated `MCP-Protocol-Version`, on every later request.

- A request without a required session ID should get `400 Bad Request`.
- An expired or unknown session ID gets `404 Not Found`. The client must then start a new session with a fresh `initialize`, not retry the old ID.
- A client may send DELETE with the session header to end the session; a server that does not allow this answers `405 Method Not Allowed`.
- A client may send GET to open a server-to-client SSE stream. A server that does not offer that optional stream answers `405`.

Session IDs must be secure and unpredictable, and must stay out of URLs and logs. A stateful server running on several instances needs shared session storage or session affinity; otherwise users see intermittent `404` responses when calls land on an instance that does not know the session.

### Streaming and compatibility {#streaming}

In both eras, clients send an `Accept` header that offers both `application/json` and `text/event-stream`, and a request gets either one JSON response or an SSE stream that ends with the response. A POST that carries a notification or a response, not a request, gets `202 Accepted` with no body. In 2025 revisions, SSE event IDs and `Last-Event-ID` let a client resume a broken stream where the server supports it. `2026-07-28` removes resumption: when a stream breaks, the in-flight response is lost, and any new attempt is a new request with a new ID. The server may already have finished the work, so a tool that creates an invoice or sends a message may have done so even though no result arrived. Retry automatically only when repeating the call is safe, for example a read or a tool that takes an application-level idempotency key; otherwise check the outcome first, or ask the user, before sending a consequential call again.

The original `2024-11-05` HTTP+SSE transport uses two endpoints: the client opens a GET stream, receives an `endpoint` event, and sends its messages to the POST URL named in that event. The transport is deprecated, but mcptest.io still tries it last for servers that only speak it. mcptest.io always tests the exact URL you enter, and also tries the conventional `/mcp` and `/sse` sibling paths.

## Authorization

Authorization is optional in MCP. When a remote server uses it, the server is an OAuth 2.1 resource server:

1. A request without a valid token gets `401 Unauthorized`, pointing the client to the server's protected resource metadata (RFC 9728).
2. That metadata names the authorization server. The client fetches the authorization server's metadata and identifies itself: with a Client ID Metadata Document, a pre-registered client ID, or Dynamic Client Registration.
3. The client runs the authorization code flow with PKCE, and sends an RFC 8707 `resource` value naming the MCP server, so the token is bound to that server.

Servers must validate each token's issuer, audience, expiry and scopes, not just its structure. The 2026 revision adds three client rules: validate the `iss` value in an authorization response when one is present (RFC 9207), keep client credentials tied to the authorization server that issued them, and prefer Client ID Metadata Documents, because Dynamic Client Registration is deprecated. Bearer tokens belong in the `Authorization` header, never in a query string, and an MCP server must not pass a client's token through to an upstream API. The [OAuth 2.1 reference](/learn/mcp-oauth-2-1-reference) has the details.

mcptest.io supports this OAuth flow, and also accepts an explicit bearer token or an API key for servers with their own authentication. When a request goes through mcptest's CORS proxy, the proxy's own `Authorization` header carries only the optional mcptest.io sign-in, and the target server's credential travels in a separate header, so the two are never mixed.

## CORS and origin security {#cors-security}

For a browser client, the server's CORS preflight must allow the request headers `Content-Type`, `Accept`, `Authorization`, `MCP-Protocol-Version`, `Mcp-Method` and `Mcp-Name`, plus `x-api-key` if you use API keys and any `Mcp-Param-*` headers your tools declare. A 2025 stateful endpoint must also allow `Mcp-Session-Id` and `Last-Event-ID`. Expose `WWW-Authenticate` so browser code can start OAuth discovery, and on 2025 endpoints `Mcp-Session-Id` so it can read the session. Allow only the headers and origins your deployment uses; the [CORS guide](/learn/mcp-cors-headers-for-browser-clients) lists exact values.

CORS is a browser control, not MCP authorization. Servers must still validate the incoming `Origin` header and answer a disallowed origin with `403 Forbidden`. Local HTTP servers should listen on loopback (`127.0.0.1`), not on all interfaces. Production endpoints need HTTPS, rate limits, careful credential redaction, request-size limits, and tool-level authorization.

## Choosing and testing a deployment {#choosing-deployment}

| Aspect | stdio | HTTP 2026 | HTTP 2025 |
| --- | --- | --- | --- |
| Process model | Usually one subprocess per client | Shared service; any request can reach any instance | Shared service; sessions may require storage or affinity |
| Lifecycle | Depends on negotiated era | Self-describing requests; optional discovery | Initialize once; retain negotiated state |
| Credentials | Usually environment or host-managed | OAuth bearer token, API key, or public endpoint | OAuth bearer token, API key, or public endpoint |
| Best fit | Local files and developer tooling | New scalable hosted services | Compatibility with deployed clients and servers |

New hosted servers should implement the stateless 2026 lifecycle. Supporting the 2025 stateful era as well reaches more clients, but keep its session handling separate from the 2026 path, so a 2026 request never depends on a session. Continue with the [testing guide](/docs/testing-guide) to test both, or use [troubleshooting](/docs/troubleshooting) when negotiation fails.

Normative references: the [2026 Streamable HTTP transport](https://modelcontextprotocol.io/specification/2026-07-28/basic/transports/streamable-http), [2025 transport](https://modelcontextprotocol.io/specification/2025-11-25/basic/transports), and [current authorization specification](https://modelcontextprotocol.io/specification/2026-07-28/basic/authorization).
