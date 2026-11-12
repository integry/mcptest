---
title: "MCP error -32000: Connection closed"
navTitle: "Connection closed (-32000)"
summary: "Trace closed MCP connections to session recovery, process failures or dropped streams without assuming that the generic code identifies a server bug."
track: "build"
level: "practitioner"
order: 454
category: "Transports"
readingTimeMinutes: 5
lastReviewed: "2026-10-26"
metaTitle: "MCP error -32000: Connection closed | mcptest.io"
metaDescription: "Trace closed MCP connections to session recovery, process failures or dropped streams without assuming that the generic code identifies a server bug."
relatedSlugs:
  - troubleshooting
  - mcp-session-not-found-after-deploy
  - mcp-error-sse-stream-disconnected
  - mcp-error-request-timed-out
sourceLinks:
  - title: "Claude Code resource recovery report #95018"
    url: "https://github.com/anthropics/claude-code/issues/95018"
  - title: "Playwright MCP process failure #1768"
    url: "https://github.com/microsoft/playwright-mcp/issues/1768"
  - title: "MCP session management"
    url: "https://modelcontextprotocol.io/specification/2025-11-25/basic/transports#session-management"
---

## MCP error -32000: Connection closed

```text
MCP error -32000: Connection closed
```

This means a pending operation lost its connection. **Claude Code** [#95018](https://github.com/anthropics/claude-code/issues/95018), filed September 17, 2026, describes a remote Streamable HTTP resource read failing while session recovery closes and reopens the transport. Its visible error is `Error: Connection closed`; the report traces it to the SDK's `-32000` rejection. [Playwright MCP #1768](https://github.com/microsoft/playwright-mcp/issues/1768) quotes the full string after a browser download kills the connection. That second report illustrates a process/tool failure, not evidence that every remote failure is a Playwright crash.

## Likely causes, ranked for remote-server investigation

1. **Session recovery closed a pending request.** The remote Claude Code report distinguishes a failed first resource read from a successful reconnect and next request. Look for an earlier session 404 followed by transport closure and initialization.
2. **The server or bridge exited during work.** The Playwright report describes a particular operation killing the connection. Check process exit status, crash logs and whether all outstanding requests fail together.
3. **A proxy or network cut the stream.** If there is no process exit, compare client and ingress logs. An accompanying `terminated` error points to [stream troubleshooting](/learn/mcp-error-sse-stream-disconnected), but does not locate the faulty hop by itself.

This ordering prioritizes the cited remote reproduction; it is not an ecosystem-wide frequency estimate.

## Fix for client users

Save the error immediately preceding `Connection closed`, plus the method, host version and whether the server restarted. Reconnect once and test a read-only operation. If the next request works, report that recovery pattern rather than describing the endpoint as permanently offline.

Do not replay a write automatically. Check whether its effect already occurred before retrying. If repeated restarts are needed, ask the publisher for server-side correlation evidence. A connected badge by itself cannot prove that a pending request or an older session survived.

## Fix for server authors

Keep a transport's lifetime aligned with its owning connection. Do not close a shared transport when an unrelated request completes. Drain requests during deployment where supported and return the correct invalid-session response rather than killing every connection.

For 2025 stateful sessions, the [session specification](https://modelcontextprotocol.io/specification/2025-11-25/basic/transports#session-management) requires 404 for an unknown id and fresh client initialization. Durable routing and recovery examples for both TypeScript and Python are in the [session guide](/learn/mcp-session-not-found-after-deploy). Removing state is appropriate only when the application can operate without it; it is not a universal fix for a process crash.

Handle tool exceptions as tool failures through the SDK rather than exiting the process. Correlate crashes with the last request without logging tokens or session secrets. For 2026 connections, inspect per-request handling and subscriptions instead of adding a 2025 initialization sequence.

## Check with mcptest

Run **Test your server**, then **Check session resilience** for a stateful server. [session.reinitialize](/learn/mcp-transport-diagnostics-reference#session-reinitialize) tests recovery and [session.stickiness](/learn/mcp-transport-diagnostics-reference#session-stickiness) tests continuity. Neither is a universal detector of `-32000`: there is no dedicated finding for the generic closure message. A passing session probe cannot establish that a particular tool will not crash the process. Reproduce that operation in staging with server logs, and distinguish a closure from [a deadline expiring](/learn/mcp-error-request-timed-out).
