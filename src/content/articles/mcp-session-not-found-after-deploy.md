---
title: "MCP 'Session not found' (404): why it happens after deploys and how to fix it"
navTitle: "Session not found after deploys"
summary: "Why stateful MCP servers answer Session not found after restarts, replica changes and idle expiry, how to confirm it with curl, and how to fix the server and the client."
track: "build"
level: "practitioner"
order: 445
category: "Transports"
readingTimeMinutes: 7
lastReviewed: "2026-11-11"
metaTitle: "MCP Session not found (404) after deploys: fixes | mcptest.io"
metaDescription: "Fix MCP Session not found (404) after deploys, idle expiry and scale-out: confirm with curl, choose sticky routing, durable state or stateless serving, and test recovery."
relatedSlugs:
  - mcp-transport-diagnostics-reference
  - deploy-remote-mcp-server
  - mcp-cors-headers-for-browser-clients
  - test-mcp-server-before-deploying
sourceLinks:
  - title: "MCP 2025-11-25 session management"
    url: "https://modelcontextprotocol.io/specification/2025-11-25/basic/transports#session-management"
  - title: "MCP 2026-07-28 Streamable HTTP (no sessions)"
    url: "https://modelcontextprotocol.io/specification/2026-07-28/basic/transports/streamable-http"
  - title: "TypeScript SDK sessionful legacy routing example"
    url: "https://github.com/modelcontextprotocol/typescript-sdk/blob/main/examples/legacy-routing/server.ts"
  - title: "Python SDK session manager (idle timeout)"
    url: "https://github.com/modelcontextprotocol/python-sdk/blob/main/src/mcp/server/streamable_http_manager.py"
  - title: "Python SDK session troubleshooting"
    url: "https://github.com/modelcontextprotocol/python-sdk/blob/main/docs/troubleshooting.md"
  - title: "Go SDK: tolerate 404 on subscriptions/listen #1193"
    url: "https://github.com/modelcontextprotocol/go-sdk/pull/1193"
  - title: "GitHub MCP server subscriptions/listen report #3129"
    url: "https://github.com/github/github-mcp-server/issues/3129"
  - title: "Claude Code stale-session recovery report #50450"
    url: "https://github.com/anthropics/claude-code/issues/50450"
  - title: "Cline restart recovery report #15147"
    url: "https://github.com/cline/cline/issues/15147"
  - title: "Appsmith replica session report #42238"
    url: "https://github.com/appsmithorg/appsmith/issues/42238"
  - title: "Epydemix session issue #24"
    url: "https://github.com/epistorm/epydemix/issues/24"
  - title: "Cursor CLI session recovery discussion"
    url: "https://forum.cursor.com/t/cursor-mcp-client-does-not-restart-session-on-404-session-not-found/161132"
---

A stateful MCP server answers `Session not found` with HTTP 404 when a request carries an `Mcp-Session-Id` it does not know. This is a normal signal, not a crash: the [2025 session rules](https://modelcontextprotocol.io/specification/2025-11-25/basic/transports#session-management) require the 404, and require the client to send a new `initialize` without the old id. It becomes an outage when the server loses sessions too often, or when the client does not start a new one.

Sessions exist only in protocol revisions 2025-03-26 to 2025-11-25. The 2026-07-28 revision has no sessions, and its servers should ignore `Mcp-Session-Id`. A `session not found` on a 2026 connection has another cause; see [the Go client error](#error-failed-to-get-tools-connection-closed-calling-toolslist-client-is-closing-sending-subscriptionslisten-failed-to-connect-session-id-session-not-found) below.

**What each server returns for an unknown id:**

| Server | Response |
| --- | --- |
| TypeScript SDK 1.x, or a sessionful 2.x transport | 404, `{"jsonrpc":"2.0","error":{"code":-32001,"message":"Session not found"},"id":null}` |
| TypeScript SDK 2.x `createMcpHandler` (default) | No sessions: the id is ignored and the request is served |
| Python SDK | 404, JSON-RPC `-32600`, `Session not found` |
| Go SDK | 404, plain text `session not found` |

## Likely causes {#why-a-deploy-loses-the-session}

1. **A restart or deploy lost the sessions.** Most servers keep sessions in process memory. A rolling deploy, crash, cold start or scale-down removes them, while clients still hold the old ids.
2. **Requests reach different replicas.** Initialization reached replica A, and the next request goes to replica B, which never saw the id. Results alternate between success and 404. [Appsmith #42238](https://github.com/appsmithorg/appsmith/issues/42238) and [Epydemix #24](https://github.com/epistorm/epydemix/issues/24) describe this.
3. **The session expired while idle.** The Python SDK closes a stateful session after 30 minutes without HTTP activity by default (`session_idle_timeout`). Custom servers often have their own expiry.
4. **The client does not start a new session.** The 404 is correct, but the client keeps sending the old id, so every request fails until it is restarted. [Claude Code #50450](https://github.com/anthropics/claude-code/issues/50450) and [Cline #15147](https://github.com/cline/cline/issues/15147) report this.
5. **The URL is wrong.** A 404 from a route that does not exist. The body is then not `Session not found`.

## How to confirm the cause

Start a session and keep its id:

```bash
curl -si https://mcp.example.com/mcp \
  -H 'Content-Type: application/json' \
  -H 'Accept: application/json, text/event-stream' \
  -d '{"jsonrpc":"2.0","id":1,"method":"initialize","params":{"protocolVersion":"2025-11-25","capabilities":{},"clientInfo":{"name":"probe","version":"1"}}}' \
  | grep -i '^mcp-session-id'
```

No `Mcp-Session-Id` header means the server is stateless, and this page does not apply. Otherwise, send `ping` with the id ten times:

```bash
for i in $(seq 10); do
  curl -s -o /dev/null -w '%{http_code}\n' https://mcp.example.com/mcp \
    -H 'Content-Type: application/json' \
    -H 'Accept: application/json, text/event-stream' \
    -H 'MCP-Protocol-Version: 2025-11-25' \
    -H 'Mcp-Session-Id: <id>' \
    -d '{"jsonrpc":"2.0","id":2,"method":"ping"}'
done
```

- All 200: the session works now. Repeat after a deploy. A 404 then is cause 1.
- A mix of 200 and 404: cause 2. Check how the load balancer routes requests.
- 200 now, 404 after a quiet period: cause 3. Compare the gap with the server's idle timeout.
- Repeat with a made-up id such as `00000000-0000-0000-0000-000000000000`. A correct server answers 404. Then a new `initialize` must succeed and return a new id. If both work but the client stays broken, it is cause 4.

Do not log raw session ids or tokens while you debug. Correlate with a separate, safe request id.

## Fix for client users

Reconnect or restart the server entry in the host to get a new session, then retry. If it keeps happening, send the publisher the time, the HTTP status and body, whether it started after a deploy, and the host version. Never share a bearer token or session id.

### What clients do today

Hosts differ, and versions change. [Claude Code #50450](https://github.com/anthropics/claude-code/issues/50450) reported no recovery at all. Later Claude Code versions recover on tool calls, but [#95018](https://github.com/anthropics/claude-code/issues/95018) shows a resource read still failing once with `Connection closed`. [Cline #15147](https://github.com/cline/cline/issues/15147) is still open. The [Cursor discussion](https://forum.cursor.com/t/cursor-mcp-client-does-not-restart-session-on-404-session-not-found/161132) separates the IDE from the CLI. Check your host version.

If you write a client: on a 404 to a request that carried a session id, discard the id, send `initialize` without it, send `notifications/initialized`, then retry only safe requests. Do not replay tool calls with side effects automatically.

## Fix for server authors

Keep returning 404 for an unknown id. A 400, 401 or 500 hides the signal that tells clients to start over. Use 401 only for real authentication failures: a session id is not a credential. Then reduce how often sessions are lost.

### Choose where the state lives

| Approach | Helps with | Limitation |
| --- | --- | --- |
| Stateless serving | No session lookup at all, on any replica | Server-initiated requests (sampling, elicitation) and standalone streams need sessions in 2025 |
| Sticky routing | Requests keep reaching the replica that owns the session | A restart still loses memory; cookie affinity does not work for every client |
| Shared state in Redis | Application data survives across replicas | Storing the id is not enough: the SDK transport and its streams live in one process |
| Durable Objects | One durable owner per session on Workers | You decide how transport state is recreated after the object wakes |

Stateless serving is the simplest fix when you do not need server-to-client requests. In TypeScript SDK 2.x it is the default:

```ts
import { createMcpHandler } from '@modelcontextprotocol/server';

// Serves 2026 requests, and 2025 requests without sessions.
const handler = createMcpHandler(buildServer);
```

In TypeScript SDK 1.x, create the transport without a session id generator:

```ts
const transport = new StreamableHTTPServerTransport({
  sessionIdGenerator: undefined,
});
```

In Python SDK 2.x, pass the options to the app. Python 1.x took them on the `FastMCP` constructor.

```python
app = mcp.streamable_http_app(stateless_http=True, json_response=True)
```

If you keep sessions, check the lookup explicitly, as the SDK's [sessionful routing example](https://github.com/modelcontextprotocol/typescript-sdk/blob/main/examples/legacy-routing/server.ts) does:

```ts
const id = req.headers['mcp-session-id'];
if (id && !sessions.has(id)) {
  return res.status(404).json({ jsonrpc: '2.0', error: { code: -32001, message: 'Session not found' }, id: null });
}
// An initialize without an id creates a new transport and session.
```

On Workers, route each session to its Durable Object, for example with `McpAgent.serve('/mcp')`, and delete the owner's state when you accept `DELETE`. Never route an unknown id to a new process and report it as an authentication error.

## error: failed to get tools: connection closed: calling "tools/list": client is closing: sending "subscriptions/listen": failed to connect (session ID: ): session not found

```text
connection closed: calling "tools/list": client is closing: sending "subscriptions/listen": failed to connect (session ID: ): session not found
```

The host adds its own prefix, such as `failed to get tools:`; the rest comes from the Go SDK client. The empty `session ID` is the clue: this is a 2026-07-28 connection, which has no session. Go SDK clients before v1.8.0 labelled any 404 as `session not found`. Here the server answered the optional `subscriptions/listen` request with 404 because it does not support it, and the client closed the whole connection.

[GitHub MCP server #3129](https://github.com/github/github-mcp-server/issues/3129) shows it in Crush. Go SDK [#1193](https://github.com/modelcontextprotocol/go-sdk/pull/1193) fixed it, and shipped in v1.8.0 (September 2026).

- **Client users:** update the host to a build using Go SDK v1.8.0 or later.
- **Server authors:** answer an unsupported 2026 method with 404 and a JSON-RPC `-32601` body, as the specification requires. Do not add a session header to a 2026 response.

## Check with mcptest {#test-the-wire-behavior-before-release}

In the mcptest inspector, connect and click **Check session resilience**. It creates temporary sessions and checks four things:

- a made-up UUID gets 404 ([session.unknown-id](/learn/mcp-transport-diagnostics-reference#session-unknown-id));
- a new `initialize` works after that 404 (session.reinitialize);
- 8 sequential and 4 parallel pings keep the session (session.stickiness);
- `DELETE` ends the session (session.delete).

It never calls tools or deletes the inspector's own connection. Each request has a five-second deadline, and a run sends at most 22 HTTP requests including cleanup. A 2026 connection passes as **not applicable: stateless**. A browser must be able to read `Mcp-Session-Id`, so expose it in CORS; otherwise a sessionful server can look stateless.

Run the same check from the report page or in CI:

```bash
npm run mcptest -- --session-resilience https://mcp.example/mcp
```

The [session findings](/learn/mcp-transport-diagnostics-reference#session-unknown-id) keep redacted evidence in the report, the exported artifact and the permalink. A clean run shows the sessions work now. It cannot prove the next deploy keeps them, so also restart a staging server with the real client connected.

## Related errors

- [MCP error -32000: Connection closed](/learn/mcp-error-connection-closed): what a client shows when it closes the transport to recover a session.
- [SSE stream disconnected: TypeError: terminated](/learn/mcp-error-sse-stream-disconnected): streams cut during a deploy.
- [SSE error: Non-200 status code (404)](/learn/mcp-error-sse-non-200-404): a 404 on an SSE `GET`.
