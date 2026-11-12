---
title: "MCP error -32000: Connection closed"
navTitle: "Connection closed (-32000)"
summary: "What the client-side Connection closed error means, how to tell a crashed server from a session reset or a cut stream, and how to fix each."
track: "build"
level: "practitioner"
order: 454
category: "Transports"
readingTimeMinutes: 5
lastReviewed: "2026-11-11"
metaTitle: "MCP error -32000: Connection closed | mcptest.io"
metaDescription: "Fix MCP error -32000 Connection closed: tell a crashed stdio server from a Streamable HTTP session reset or a cut stream, confirm the cause, and fix it."
relatedSlugs:
  - troubleshooting
  - mcp-session-not-found-after-deploy
  - mcp-error-sse-stream-disconnected
  - mcp-error-request-timed-out
sourceLinks:
  - title: "TypeScript SDK 1.x error codes (ConnectionClosed = -32000)"
    url: "https://github.com/modelcontextprotocol/typescript-sdk/blob/v1.x/src/types.ts"
  - title: "TypeScript SDK 2.x SdkErrorCode"
    url: "https://github.com/modelcontextprotocol/typescript-sdk/blob/main/packages/core-internal/src/errors/sdkErrors.ts"
  - title: "Python SDK CONNECTION_CLOSED"
    url: "https://github.com/modelcontextprotocol/python-sdk/blob/main/src/mcp/shared/jsonrpc_dispatcher.py"
  - title: "Claude Code resource recovery report #95018"
    url: "https://github.com/anthropics/claude-code/issues/95018"
  - title: "Playwright MCP process failure #1768"
    url: "https://github.com/microsoft/playwright-mcp/issues/1768"
  - title: "MCP 2025-11-25 session management"
    url: "https://modelcontextprotocol.io/specification/2025-11-25/basic/transports#session-management"
---

## MCP error -32000: Connection closed

```text
MCP error -32000: Connection closed
```

The client's transport closed while a request was still waiting for its reply, so the SDK failed that request. The error is created inside the client. The server never sends it, and it does not say why the connection closed.

**Who prints it:**

- TypeScript SDK 1.x prints exactly this string. `-32000` is its `ErrorCode.ConnectionClosed`.
- TypeScript SDK 2.x prints only `Connection closed`. It raises an `SdkError` with the string code `CONNECTION_CLOSED` and no number.
- The Python SDK raises `MCPError` with `CONNECTION_CLOSED` (`-32000`) and the message `Connection closed`.

`-32000` is also the generic code that SDK servers put in HTTP error bodies, such as 406 or 405. A `-32000` inside an HTTP response body is a different problem: see the [406, 415 and 405 guide](/learn/mcp-406-not-acceptable-415-and-405).

## Likely causes {#likely-causes-ranked-for-remote-server-investigation}

1. **The server process exited (stdio).** A local server crashed at startup or during a call. [Playwright MCP #1768](https://github.com/microsoft/playwright-mcp/issues/1768) shows a tool call that triggers a file download and kills the server. Every pending request fails at once.
2. **The client closed the transport to recover a session (Streamable HTTP, 2025 stateful).** After a server restart, the old `Mcp-Session-Id` gets a 404. The client closes the transport and initializes again, and requests still in flight fail. [Claude Code #95018](https://github.com/anthropics/claude-code/issues/95018) shows this: a resource read fails with `Connection closed`, and the next call works.
3. **A proxy, load balancer or network change cut the connection.** No process exited, but the stream carrying the reply was closed. It often appears next to `SSE stream disconnected` in the client log.

On a 2026-07-28 connection there is no session to recover, so cause 2 does not apply. Look for causes 1 and 3.

## How to confirm the cause

**Server exit (stdio).** Run the exact command from the client config in a terminal and send it an `initialize` line:

```bash
printf '%s\n' '{"jsonrpc":"2.0","id":1,"method":"initialize","params":{"protocolVersion":"2025-11-25","capabilities":{},"clientInfo":{"name":"probe","version":"1"}}}' \
  | npx -y your-mcp-server; echo "exit code: $?"
```

A healthy server prints one JSON-RPC reply and exits when its input ends. A stack trace, an error exit code or no JSON reply points to cause 1. Stdout must carry only JSON-RPC, so a stray log line printed there also breaks the connection. For a crash during a call, look at the server's stderr log, usually kept by the host, for the last request before the exit.

**Session recovery (HTTP).** In the client log, look for an HTTP 404 or `Session not found` just before `Connection closed`, followed by a new initialize. Check that a fresh session works:

```bash
curl -si https://mcp.example.com/mcp \
  -H 'Content-Type: application/json' \
  -H 'Accept: application/json, text/event-stream' \
  -d '{"jsonrpc":"2.0","id":1,"method":"initialize","params":{"protocolVersion":"2025-11-25","capabilities":{},"clientInfo":{"name":"probe","version":"1"}}}'
```

If the new initialize succeeds and returns a new `Mcp-Session-Id`, the endpoint is fine. Only the old session was lost.

**Cut stream.** Compare the time of the error with ingress or load-balancer logs and with deploys. A reset with no process exit and no 404 points to cause 3.

## Fix for client users

- Restart or reconnect the server from the host, then retry one read-only operation.
- If the next request works, report that pattern ("first call after a restart fails"), not "the server is down".
- Do not replay a write automatically. A closed connection does not tell you whether the server ran it.
- When you report the problem, include the method, host version, the log line just before `Connection closed`, and whether the server restarted. Remove tokens and session ids first.

## Fix for server authors

- **Stdio:** catch tool exceptions and return them as tool errors (`isError: true`), so the process does not exit. Write logs to stderr only.
- **Stateful 2025 HTTP:** return 404 for an unknown session id, as the [session specification](https://modelcontextprotocol.io/specification/2025-11-25/basic/transports#session-management) requires. Keep a fresh initialize working after a restart. Durable session routing is covered in the [session guide](/learn/mcp-session-not-found-after-deploy).
- **All HTTP:** drain in-flight requests before a process stops. Do not close a shared transport when one unrelated request finishes.
- **2026 HTTP:** there are no sessions. Look at per-request handling and long-lived `subscriptions/listen` streams instead of adding an initialize step.

## Check with mcptest

Run **Test your server**. For a stateful 2025 server, also run **Check session resilience**. [session.unknown-id](/learn/mcp-transport-diagnostics-reference#session-unknown-id) and [session.reinitialize](/learn/mcp-transport-diagnostics-reference#session-reinitialize) check that a lost session can be recovered. [session.stickiness](/learn/mcp-transport-diagnostics-reference#session-stickiness) checks that a session stays valid across 12 pings.

No mcptest finding detects `Connection closed` itself. A passing session check also cannot show that a particular tool will not crash the process. Run that tool in staging and watch the server logs.

## Related errors

- [MCP error -32001: Request timed out](/learn/mcp-error-request-timed-out): the connection stayed open but no reply arrived in time.
- [SSE stream disconnected: TypeError: terminated](/learn/mcp-error-sse-stream-disconnected): a stream was cut, often logged just before this error.
- [Session not found (404)](/learn/mcp-session-not-found-after-deploy): the usual trigger for cause 2.
