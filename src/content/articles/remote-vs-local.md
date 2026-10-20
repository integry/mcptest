---
title: Remote vs. Local MCP Servers
navTitle: Remote vs Local
summary: How stdio and Streamable HTTP servers differ in sessions, authentication, deployment, CORS, and compatibility.
track: understand
level: practitioner
order: 2
category: Transports
readingTimeMinutes: 7
lastReviewed: "2026-08-10"
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

MCP's standard transports are stdio for a server launched on the user's machine and Streamable HTTP for an independently deployed service. Remote MCP now spans two lifecycle eras: sessionless requests in `2026-07-28` and the stateful handshake used by every earlier stable revision. A compatible client and a production server need to be explicit about which behavior they are using.

## Local servers: stdio {#local-servers}

With stdio, the client launches the server as a subprocess and exchanges newline-delimited JSON-RPC through standard input and output. Nothing except valid MCP messages may be written to stdout; diagnostic logging belongs on stderr. This transport is a strong fit for local files, developer tools, or anything that should have no network-facing endpoint.

Process lifetime supplies a natural isolation boundary. Credentials usually arrive through the environment, and each client gets its own process. The trade-offs are installation and runtime requirements on the user's machine, one process per client, and no shared hosted endpoint. Stdio can carry either protocol era when the SDK supports it; "local" does not by itself mean "legacy."

## Remote servers: Streamable HTTP {#remote-servers}

A remote server exposes one exact MCP endpoint, such as `https://example.com/mcp`. The endpoint accepts JSON-RPC requests over HTTP POST and can answer with `application/json` or a per-request `text/event-stream` response. One deployment can serve many clients and can sit behind standard gateways, authentication services, and load balancers.

### 2026 stateless flow {#stateless-flow}

In `2026-07-28`, every request stands alone. There is no `initialize` / `notifications/initialized` handshake and no `Mcp-Session-Id`. A server must implement `server/discover`, while a client may call it to learn the supported versions and capabilities before normal work. The official SDK's automatic mode uses that call as an era probe.

Every request includes its protocol version and client capabilities in `params._meta`. Streamable HTTP also requires `MCP-Protocol-Version` and `Mcp-Method` headers; named operations such as `tools/call`, `resources/read`, and `prompts/get` also require `Mcp-Name`. The header version must match the body metadata. This design lets a gateway route, authorize, and meter a call before parsing the JSON body, and lets any healthy server instance handle any request.

A POST request may still receive an SSE response while work runs. For continuing change notifications, 2026 uses the `subscriptions/listen` request instead of the old standalone GET stream. Closing a per-request SSE response cancels that request. Interactive tool flows use multi-round-trip `input_required` results and retries instead of server-initiated requests on a permanently open connection.

### 2025 stateful flow {#stateful-flow}

Revisions through `2025-11-25` start with an `initialize` POST. The server returns the selected protocol version, capabilities, and server identity; the client acknowledges with `notifications/initialized`. A server that wants transport state also returns `Mcp-Session-Id`. The client must then include that opaque ID and the negotiated `MCP-Protocol-Version` on later requests.

- A missing required session ID normally produces `400 Bad Request`.
- An expired or unknown session ID produces `404 Not Found`; the client creates a fresh connection rather than retrying the stale session.
- A client may send DELETE with the session header to terminate it; a server that does not support explicit termination may answer `405 Method Not Allowed`.
- A separate GET may open a server-to-client SSE stream. Returning `405` is valid when that optional stream is unsupported.

Session IDs must be secure, unpredictable, and kept out of URLs and logs. Stateful servers deployed across instances need shared session storage or correct affinity; otherwise users see intermittent `404` responses as calls land on different instances.

### Streaming and compatibility {#streaming}

For 2025 Streamable HTTP, clients send an `Accept` header offering both `application/json` and `text/event-stream`. A JSON-RPC request can receive one JSON response or an SSE stream that eventually contains it. Notifications and client responses normally receive `202 Accepted` with no body. SSE event IDs and `Last-Event-ID` support resumption where the server offers it.

The original `2024-11-05` HTTP+SSE transport uses two endpoints: a client opens a GET stream, receives an `endpoint` event, and sends messages to the advertised POST URL. It is deprecated, but mcptest.io keeps it as a final fallback for deployed servers. An explicit URL is always tested before conventional path guesses such as `/mcp` or `/sse`.

## Authorization

Remote MCP authorization uses the OAuth 2.1 resource-server model. A protected MCP endpoint returns `401 Unauthorized` and points the client to protected-resource metadata. That metadata names the authorization server; the client discovers its metadata, identifies itself, and runs authorization code with PKCE and an RFC 8707 `resource` value bound to the MCP server.

Servers must validate issuer, audience, expiry, and scopes rather than accepting any token that happens to be structurally valid. The 2026 revision requires authorization-response issuer validation when an `iss` value is returned, binds client credentials to their issuer, and deprecates Dynamic Client Registration in favor of Client ID Metadata Documents. Bearer tokens belong in the `Authorization` header, never a query string, and an MCP server must not pass a client token through to an unrelated upstream API.

mcptest.io supports discovered OAuth with PKCE as well as explicit bearer tokens and API keys for servers that use provider-specific authentication. When its optional CORS proxy is enabled, Firebase authenticates the proxy hop and the target credential is carried through a separate internal header; the two trust boundaries are not conflated.

## CORS and origin security {#cors-security}

A browser client needs the server to allow `Content-Type`, `Accept`, `Authorization`, `x-api-key`, `MCP-Protocol-Version`, `Mcp-Method`, and `Mcp-Name`. A 2025 stateful endpoint must additionally allow `Mcp-Session-Id` and `Last-Event-ID`, and expose `Mcp-Session-Id` so browser code can read it. Only allow the headers and origins your deployment actually uses.

CORS is a browser control, not MCP authorization. Remote servers must still validate the incoming `Origin` and reject disallowed origins. Local HTTP servers should bind to loopback rather than all interfaces. Production endpoints need HTTPS, rate limits, careful credential redaction, request-size limits, and tool-level authorization.

## Choosing and testing a deployment {#choosing-deployment}

| Aspect | stdio | HTTP 2026 | HTTP 2025 |
| --- | --- | --- | --- |
| Process model | Usually one subprocess per client | Shared service; any request can reach any instance | Shared service; sessions may require storage or affinity |
| Lifecycle | Depends on negotiated era | Self-describing requests; optional discovery | Initialize once; retain negotiated state |
| Credentials | Usually environment or host-managed | OAuth bearer token, API key, or public endpoint | OAuth bearer token, API key, or public endpoint |
| Best fit | Local files and developer tooling | New scalable hosted services | Compatibility with deployed clients and servers |

New hosted servers should implement the stateless 2026 lifecycle. Supporting the stateful era as well broadens compatibility, but its session contract must remain isolated from the 2026 path. Continue with the [testing guide](/docs/testing-guide) to test both, or use [troubleshooting](/docs/troubleshooting) when negotiation fails.

Normative references: the [2026 Streamable HTTP transport](https://modelcontextprotocol.io/specification/2026-07-28/basic/transports/streamable-http), [2025 transport](https://modelcontextprotocol.io/specification/2025-11-25/basic/transports), and [current authorization specification](https://modelcontextprotocol.io/specification/2026-07-28/basic/authorization).
