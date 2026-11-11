---
title: "MCP server connected but no tools: how to find the cause"
navTitle: Connected but no tools
summary: When a client shows the server as connected but lists no tools, read the raw JSON-RPC exchange to tell a missing capability, a failed tools/list, a lost session, a version mismatch, caching and auth-gated listing apart.
track: use
level: practitioner
order: 26
category: Troubleshooting
readingTimeMinutes: 7
lastReviewed: "2026-11-11"
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
  - title: "OpenAI Apps SDK: Connect from ChatGPT"
    url: "https://developers.openai.com/apps-sdk/deploy/connect-chatgpt"
  - title: "VS Code: Manage and troubleshoot MCP servers"
    url: "https://code.visualstudio.com/docs/agents/run/manage-mcp-servers"
---
## Get the raw exchange first

"Connected" in a client usually means only that the first request succeeded. Listing tools takes several more steps, and the client's status indicator rarely says which one failed. Before you change anything, capture the JSON-RPC messages:

- **Claude Code:** `claude mcp list` for each server's health, then `/mcp` in a session for its status.
- **Cursor:** the Output panel, **MCP Logs** channel.
- **VS Code:** run **MCP: List Servers**, select the server, then **Show Output**.
- **Gemini CLI:** `/mcp list`.
- **Any remote server:** connect in the playground and open **Logs & Events**.

Then find out which protocol era the server speaks:

- **2025 era** (revisions up to 2025-11-25): the client starts with an `initialize` handshake, and the server may create a session.
- **2026 era** (revision 2026-07-28): there is no handshake and no session. Each request carries its own protocol version and client capabilities in `_meta`.

Each cause below says which era it applies to.

## The expected exchange

For a 2025-era server, a working exchange has four messages:

```json
{"jsonrpc":"2.0","id":1,"method":"initialize","params":{"protocolVersion":"2025-11-25","capabilities":{},"clientInfo":{"name":"client","version":"1.0"}}}
{"jsonrpc":"2.0","id":1,"result":{"protocolVersion":"2025-11-25","capabilities":{"tools":{"listChanged":true}},"serverInfo":{"name":"example","version":"1.0"}}}
{"jsonrpc":"2.0","method":"notifications/initialized"}
{"jsonrpc":"2.0","id":2,"method":"tools/list","params":{}}
```

The answer to `tools/list` is a `result` with a `tools` array, plus `nextCursor` if there are more pages. For a 2026-era server, the client may call `server/discover` first, then calls `tools/list` directly. The result also carries `ttlMs` and `cacheScope`, which tell the client how long it may cache the list.

Compare your log with this sequence. The first message that differs points to the cause.

## Cause 1: the tools capability is not declared

**Symptom:** `initialize` succeeds, but `capabilities` in the result has no `tools` key, or the `server/discover` result lists none. Many clients then never send `tools/list`.

**Cause:** servers that offer tools must declare the `tools` capability. With the official SDKs this normally happens when you register a tool before the server connects to its transport. A server that registers tools later, after the handshake, can end up advertising no tools.

**Confirm:** read the `capabilities` object in the `initialize` or `server/discover` result.

**Fix:** declare `tools` in the server's capabilities, and register tools before the server accepts connections. If tools really are added later, declare `listChanged: true` and send `notifications/tools/list_changed` when they change.

## Cause 2: tools/list fails after initialize

**Symptom:** `tools/list` is sent and returns a JSON-RPC `error` or an HTTP error, or never returns.

**Cause and confirm:** read the error code.

- `-32601` (method not found): the server advertises `tools` but has no handler.
- `-32602` (invalid params): the request is malformed. On a 2026-era server, this includes a request whose `_meta` lacks the protocol version or client capabilities. A missing capability the request needs gets `-32021` instead.
- `-32603` or HTTP `500`: the handler throws, often while building a schema or calling a backend.
- No response: the handler is waiting on a backend, or a proxy is buffering the SSE response. In a client this can look like a server stuck loading its tools.

A client can also drop individual tools. Under 2026-07-28, clients on Streamable HTTP must drop a tool whose `x-mcp-header` annotations are invalid, so a list of ten tools can show eight.

**Fix:**

1. Find the failing request id in the server log and read the error there.
2. Add the missing handler, or stop advertising the capability.
3. Validate every tool's `inputSchema` as JSON Schema.
4. Serve list responses as plain JSON where possible, or make sure proxies do not buffer SSE.

## Cause 3: the session id is not kept (2025 era)

**Symptom:** the `initialize` response carries an `Mcp-Session-Id` header, and the next request either lacks it or gets `400 Bad Request` or `404 Not Found`.

**Cause:** on Streamable HTTP, a 2025-era server may create a session in the `initialize` response. The client must then send the same `Mcp-Session-Id` on every later request. A server that requires sessions should answer `400` when the header is missing, and must answer `404` when the session has expired. On a 404, the client must start a new session with a new `initialize`.

Common reasons the id is lost:

- A browser client cannot read the header, because the server does not list `Mcp-Session-Id` in `Access-Control-Expose-Headers`.
- A load balancer sends requests to different instances, and the session lives in one instance's memory.
- The server expired the session quickly, and the client did not re-initialize.

**Confirm:** compare the `Mcp-Session-Id` in the `initialize` response with the header on the next request.

**Fix:** expose the header through CORS, use shared session storage or sticky routing, and make sure the client handles `404` by re-initializing. This cause does not apply to 2026-era servers: they should not issue session ids and should ignore any that are sent.

## Cause 4: protocol version mismatch

**Symptom:** the server appears connected, then the client disconnects or the first list call fails with `400`.

**Cause:** the client and server disagree on the protocol version.

- **2025 era:** the client sends `protocolVersion` in `initialize`. The server must answer with the same version if it supports it, or with another version it supports. If the client does not support the answer, it should disconnect, sometimes right after showing "connected". Every later HTTP request must carry the `MCP-Protocol-Version` header. An invalid or unsupported value gets `400 Bad Request`; a missing header is treated as `2025-03-26`.
- **2026 era:** an unsupported version gets `UnsupportedProtocolVersionError` (code `-32022`) over HTTP `400`, with the supported versions in `data.supported`. The `MCP-Protocol-Version` header must match the version in `_meta`, or the server returns `400` with `-32020`.
- **Mixed:** a 2026-only client and a 2025-only server, or the reverse, can fail on the first request. A client that supports both may send a modern request first and fall back to `initialize` when the `400` body is not a recognized modern error. Not every client probes: the TypeScript SDK v2, for example, uses `initialize` by default.

**Confirm:** compare the version in the `initialize` request, its response and the HTTP header character by character, or read the `-32022` error's `data.supported` list.

**Fix:** support a version the client sends. Make sure gateways forward `MCP-Protocol-Version`, `Mcp-Method` and `Mcp-Name` unchanged.

## Cause 5: the client is showing a cached list

**Symptom:** no `tools/list` request appears at all, or the client shows older tools than the server returns.

**Cause:** the client is reusing a stored list, or filtering it.

- **ChatGPT** keeps the tool metadata it read when you connected the server. After you change tools, it does not see them until you refresh the connection.
- **2026-era caching:** a result carries `ttlMs` and `cacheScope`, and a client may reuse the list until it expires. Servers send `list_changed` notifications only to clients that opened a `subscriptions/listen` stream with `toolsListChanged: true`.
- **Desktop clients** keep a server's list until the server restarts.
- **Client-side filters** can hide tools the server returned: a `tools` list in VS Code's server configuration, Codex's `enabled_tools` and `disabled_tools`, Gemini CLI's `includeTools` and `excludeTools`, or an MCP allowlist set by a Cursor team admin.

**Confirm:** compare the raw `tools/list` result in the playground with what the client shows.

**Fix:**

1. **ChatGPT:** open the connection on the Plugins page and select **Refresh**, then test in a new conversation.
2. **Cursor:** toggle the server off and on.
3. **VS Code:** use **Restart Server** from **MCP: List Servers**, or **MCP: Reset Cached Tools** to clear the editor's cached lists.
4. Check every allowlist and filter before you change the server.

## Cause 6: the server needs auth to list tools

**Symptom:** `tools/list` returns an empty array, or a `401` that the client does not treat as a sign-in challenge.

**Cause:** some servers return an empty list to anonymous callers and the full list after sign-in. Under 2026-07-28 the list must not vary per connection, but it may vary with the authorization on the request. Other servers allow `initialize` without a token and return `401` only for `tools/list`. Some clients then show the server as connected with no tools.

**Confirm:** compare the `tools/list` result with and without a token, in the playground.

**Fix:** if the server requires sign-in, return the `401` challenge on the first request, so clients start OAuth before they report the server as connected. If the list is empty because the token has too few scopes, follow the [401 checklist](/learn/remote-mcp-server-401-unauthorized).

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

If you cannot see the raw messages in your client, check the server on its own. Open the [MCP Playground](/), paste the endpoint and connect.

- The connection badges show the negotiated transport and whether the server is stateless or stateful.
- **Logs & Events** shows every message above.
- The capabilities pane lists exactly what `tools/list` returned.

A link of the form `https://mcptest.io/server/<your endpoint URL>` opens the playground with the server already filled in.
