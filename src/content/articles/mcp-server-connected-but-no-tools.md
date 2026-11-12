---
title: "MCP server connected but no tools: how to find the cause"
navTitle: Connected but no tools
summary: When a client shows the server as connected but lists no tools, read the raw JSON-RPC exchange to tell a missing capability, a failed tools/list, a lost session, a version mismatch, caching and auth-gated listing apart.
track: use
level: practitioner
order: 26
category: Troubleshooting
readingTimeMinutes: 6
lastReviewed: "2026-10-20"
relatedSlugs:
  - remote-mcp-server-401-unauthorized
  - connect-mcp-server-to-cursor
  - connect-mcp-server-to-vs-code
  - connect-remote-mcp-server
sourceLinks:
  - title: "MCP specification 2025-11-25: Lifecycle"
    url: "https://modelcontextprotocol.io/specification/2025-11-25/basic/lifecycle"
  - title: "MCP specification 2025-11-25: Tools"
    url: "https://modelcontextprotocol.io/specification/2025-11-25/server/tools"
  - title: "MCP specification 2025-11-25: Transports"
    url: "https://modelcontextprotocol.io/specification/2025-11-25/basic/transports"
  - title: "MCP specification 2026-07-28: Tools"
    url: "https://modelcontextprotocol.io/specification/2026-07-28/server/tools"
  - title: "MCP specification 2026-07-28: Streamable HTTP"
    url: "https://modelcontextprotocol.io/specification/2026-07-28/basic/transports/streamable-http"
  - title: "MCP specification 2026-07-28: Versioning"
    url: "https://modelcontextprotocol.io/specification/2026-07-28/basic/versioning"
---
## Get the raw exchange first

"Connected" in a client's UI usually means only that the first request succeeded. To list tools, several more steps have to succeed, and the client's indicator rarely says which one failed. Before changing anything, capture the JSON-RPC messages:

- **Claude Code:** `claude mcp list`, then `/mcp` in a session for the server's status.
- **Cursor:** the Output panel, **MCP Logs** channel.
- **VS Code:** **MCP: List Servers**, select the server, **Show Output**.
- **Gemini CLI:** `/mcp list`.
- **Any server:** connect in the playground and open **Logs & Events**.

Then find which era the server speaks. Servers on revisions up to 2025-11-25 start with an `initialize` handshake and may use a session. Servers on 2026-07-28 have no handshake and no sessions; each request carries its own version. The causes below are marked with the era they apply to.

## The expected exchange

For a 2025-era server, a working exchange has four messages:

```json
{"jsonrpc":"2.0","id":1,"method":"initialize","params":{"protocolVersion":"2025-11-25","capabilities":{},"clientInfo":{"name":"client","version":"1.0"}}}
{"jsonrpc":"2.0","id":1,"result":{"protocolVersion":"2025-11-25","capabilities":{"tools":{"listChanged":true}},"serverInfo":{"name":"example","version":"1.0"}}}
{"jsonrpc":"2.0","method":"notifications/initialized"}
{"jsonrpc":"2.0","id":2,"method":"tools/list","params":{}}
```

The answer to `tools/list` is a `result` with a `tools` array, plus `nextCursor` if there are more pages. For a 2026-era server, the client may call `server/discover` and then calls `tools/list` directly. The result also carries `ttlMs` and `cacheScope`.

Compare the log with this sequence. The first message that differs identifies the cause.

## Cause 1: the tools capability is not declared

**In the log:** `initialize` succeeds, but `capabilities` in the result has no `tools` key, or the `server/discover` result lists none. Many clients then never send `tools/list` at all.

Servers that offer tools must declare the `tools` capability. With the official SDKs this usually happens when a tool is registered before the server connects to the transport. A server that registers tools lazily, after the handshake, can send an empty capability set.

**Fix:** declare `tools` in the server's capabilities, and register tools before the server starts accepting connections. If tools really are added later, declare `listChanged: true` and send `notifications/tools/list_changed`.

## Cause 2: tools/list fails after initialize

**In the log:** `tools/list` is sent and returns a JSON-RPC `error`, an HTTP error, or never returns.

- `-32601` (method not found): the server advertises `tools` but has no handler. Either add the handler or stop advertising the capability.
- `-32602` (invalid params): a 2026-era server is missing the `_meta` protocol version or client capabilities, or a 2025-era client sent malformed params.
- `-32603` or HTTP `500`: the handler throws, often while building a schema or calling a backend.
- No response: the handler is waiting on a backend, or a proxy is buffering the SSE response. Cursor shows this as stuck on "Loading tools".

A client may also drop individual tools. Under 2026-07-28, clients must drop tools whose `x-mcp-header` annotations are invalid, so a list of ten can show eight.

**Fix:** read the server log for the request id of the failing `tools/list`. Validate every tool's `inputSchema` as JSON Schema. Serve list responses as plain JSON where possible, or make sure proxies do not buffer SSE.

## Cause 3: the session id is not kept (2025 era)

**In the log:** the `initialize` response carries an `Mcp-Session-Id` header, and the next request either lacks it or gets `400 Bad Request` or `404 Not Found`.

On Streamable HTTP, a 2025-era server may assign a session in the `initialize` response. The client must send the same `Mcp-Session-Id` on every later request. A server should answer `400` when the header is missing and `404` when the session has expired; on a 404 the client must start a new session with a new `initialize`.

Common reasons the id is lost:

- A browser client cannot read the header because the server does not list `Mcp-Session-Id` in `Access-Control-Expose-Headers`.
- A load balancer sends requests to different instances, and the session lives in one instance's memory.
- The server expired the session quickly and the client did not re-initialize.

**Fix:** expose the header through CORS, use shared session storage or sticky routing, and make sure the client handles `404` by re-initializing. A 2026-era server must not issue session ids and ignores them if they are sent.

## Cause 4: protocol version mismatch

**In the log:** the client and server disagree on the version.

- **2025 era:** the client sends `protocolVersion` in `initialize`. The server must answer with the same version if it supports it, or with another version it supports. If the client does not support the answer, it should disconnect, sometimes right after showing "connected". Every later HTTP request must also carry `MCP-Protocol-Version`; an invalid or unsupported value gets `400 Bad Request`. A missing header is treated as `2025-03-26`.
- **2026 era:** an unsupported version gets an `UnsupportedProtocolVersionError` (code `-32022`) with the supported versions in `data.supported`, over HTTP status 400. The `MCP-Protocol-Version` header must match the version in `_meta`, or the server returns `400` with `-32020`.
- **Mixed:** a 2026-only client talking to a 2025-only server, or the reverse, can fail on the first list call. Clients detect older servers by sending a modern request and falling back to `initialize` when the 400 body is not a recognized modern error.

**Fix:** compare the version in the `initialize` request, the response and the HTTP header character by character. Make sure gateways forward `MCP-Protocol-Version`, `Mcp-Method` and `Mcp-Name` unchanged.

## Cause 5: the client is showing a cached list

**In the log:** no `tools/list` request appears at all, or the tools shown are older than the server's.

- ChatGPT stores a snapshot of tools when a plugin is published. New tools stay disabled until an admin refreshes them.
- A 2026-era result carries `ttlMs` and `cacheScope`, and a client may reuse the list until it expires. `list_changed` notifications only arrive on a `subscriptions/listen` stream opened with `toolsListChanged: true`.
- Desktop clients keep a server's list until it restarts. In Cursor, toggle the server off and on; in VS Code, use **Restart Server**.
- A tool allowlist or picker in the client can hide tools the server returned: Cursor's tool allowlist, VS Code's tools picker, Codex's `enabled_tools`, Gemini CLI's `includeTools`.

**Fix:** restart the server from the client, refresh the published snapshot, and check every allowlist before you look at the server.

## Cause 6: the server needs auth to list tools

**In the log:** `tools/list` returns an empty array, or a `401` that the client does not treat as a sign-in challenge.

Some servers return an empty list to anonymous callers and the full list after sign-in. Under 2026-07-28 the list must not vary per connection but may vary with the authorization on the request. Other servers allow `initialize` without a token and return `401` only for `tools/list`, which some clients show as connected with no tools.

**Fix:** if the server requires sign-in, return the `401` challenge on the first request, so clients start OAuth before they report the server as connected. If the empty list comes from a token with too few scopes, follow the [401 checklist](/learn/remote-mcp-server-401-unauthorized).

## Reading the log quickly

| What the log shows | Cause |
| --- | --- |
| No `tools` in capabilities | 1 |
| `tools/list` returns an error or hangs | 2 |
| `400` or `404` on the request after `initialize` | 3 |
| Different `protocolVersion` values, or `-32022` / `-32020` | 4 |
| No `tools/list` sent, or old tools shown | 5 |
| Empty array or `401` only on `tools/list` | 6 |

## Verify the endpoint before you add it

If you cannot see the raw messages in your client, check the server on its own. Open the [MCP Playground](/), paste the endpoint and connect. The connection badges show the negotiated transport and whether the server is stateless or stateful, **Logs & Events** shows every message above, and the capabilities pane lists exactly what `tools/list` returned. A link of the form `https://mcptest.io/server/<your endpoint URL>` opens the playground with the server already filled in.
