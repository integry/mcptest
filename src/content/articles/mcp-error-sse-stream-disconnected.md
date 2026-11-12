---
title: "SSE stream disconnected: TypeError: terminated"
navTitle: "SSE stream disconnected"
summary: "What the Streamable HTTP client's SSE stream disconnected error means, when it is harmless, and how to fix idle timeouts, buffering and premature stream cleanup."
track: "build"
level: "practitioner"
order: 453
category: "Transports"
readingTimeMinutes: 5
lastReviewed: "2026-11-11"
metaTitle: "SSE stream disconnected: TypeError: terminated | mcptest.io"
metaDescription: "Fix SSE stream disconnected: TypeError: terminated in MCP: tell a harmless stream end from a lost reply, then fix idle timeouts, buffering and cleanup."
relatedSlugs:
  - troubleshooting
  - mcp-error-connection-closed
  - mcp-error-request-timed-out
  - mcp-session-not-found-after-deploy
sourceLinks:
  - title: "TypeScript SDK Streamable HTTP client"
    url: "https://github.com/modelcontextprotocol/typescript-sdk/blob/main/packages/client/src/client/streamableHttp.ts"
  - title: "TypeScript SDK troubleshooting: SSE stream disconnected"
    url: "https://github.com/modelcontextprotocol/typescript-sdk/blob/main/docs/troubleshooting.md"
  - title: "TypeScript HTTP handler options"
    url: "https://github.com/modelcontextprotocol/typescript-sdk/blob/main/packages/server/src/server/createMcpHandler.ts"
  - title: "MCP 2026-07-28 Streamable HTTP (keep-alive comments)"
    url: "https://modelcontextprotocol.io/specification/2026-07-28/basic/transports/streamable-http"
  - title: "TREK remote stream disconnect report #1414"
    url: "https://github.com/liketrek/TREK/issues/1414"
  - title: "VS Code idle stream report #300277"
    url: "https://github.com/microsoft/vscode/issues/300277"
---

## SSE stream disconnected: TypeError: terminated

```text
SSE stream disconnected: TypeError: terminated
```

An SSE response stream that the client was reading ended with a network error. The TypeScript SDK's Streamable HTTP client (1.x and 2.x) reports it as `SSE stream disconnected: <error>`. `TypeError: terminated` is what Node's `fetch` throws when the response body is cut off. Under Bun or in a browser the suffix differs, for example `The socket connection was closed unexpectedly`.

The SDK reports this through the transport's `onerror` and then tries to recover. On 2025 connections it reconnects a `GET` stream, or a `POST` stream that sent a resumable event id. 2026-07-28 streams cannot be resumed. The SDK never reconnects once the request's reply has already arrived. So the message is sometimes harmless noise and sometimes a lost reply.

**Which era:** 2025 servers may keep a standalone `GET` stream open for server messages. 2026-07-28 servers have no `GET` stream; long-lived streams there are `subscriptions/listen` responses. Legacy HTTP+SSE clients report a different error: see [SSE error: Non-200 status code](/learn/mcp-error-sse-non-200-404).

## Likely causes {#likely-causes-ranked-by-the-report-evidence}

1. **An idle timeout closed a quiet stream.** A proxy, load balancer or the client closes a stream that has sent no bytes for a while. [VS Code #300277](https://github.com/microsoft/vscode/issues/300277) shows `TypeError: terminated` after about five idle minutes.
2. **The server or proxy closes the stream at the wrong time.** The stream ends early, or ends without the usual clean finish. [TREK #1414](https://github.com/liketrek/TREK/issues/1414) logs the error after every tool call on a Kubernetes deployment behind `mcp-remote`, together with `Session not found` 404s.
3. **The server restarted or the network changed.** A deploy, crash or client network switch cut every open stream at once.

## How to confirm the cause

First check whether the reply arrived. If the client got the reply and the next request works, the error was a stream ending after its work was done. You can stop there, or fix the cleanup (cause 2) to remove the noise.

If a reply was lost, time a stream. For a 2025 server with a `GET` stream, initialize first, then hold the stream open and print a timestamp for each line:

```bash
curl -sN https://mcp.example.com/mcp \
  -H 'Accept: text/event-stream' \
  -H 'MCP-Protocol-Version: 2025-11-25' \
  -H 'Mcp-Session-Id: <id from initialize>' \
  | while IFS= read -r line; do printf '%s %s\n' "$(date +%T)" "$line"; done; echo "closed at $(date +%T)"
```

- The stream closes at the same interval every time, with no lines before it: an idle timeout (cause 1). Compare the interval with your proxy and load-balancer idle settings.
- Comment lines such as `: keepalive` arrive, but the stream still closes: a hard maximum stream duration, not idle.
- The stream closes when a request ends or a deploy runs: cause 2 or 3. Correlate with server and ingress logs.

Run the same command against the origin, bypassing the proxy. If the origin stream stays open, the proxy is closing it.

## Fix for client users

- Check whether a new read-only request works after the error. If it does, the reconnect worked.
- If the error repeats at a fixed idle interval, give the publisher the interval and timestamps.
- If it follows every request, include the method and whether the request completed.
- Do not repeat a write automatically. A lost reply does not tell you whether the server ran it.

## Fix for server authors

- **Send heartbeats.** TypeScript SDK 2.x sends a `: keepalive` SSE comment every 15 seconds by default. Change it with `keepAliveMs` on the transport or `createMcpHandler`; `0` turns it off. The 2026-07-28 specification encourages these comments on long-lived streams. Keep the interval below the shortest idle limit between client and server:

```ts
import { createMcpHandler } from '@modelcontextprotocol/server';

// buildServer is your existing per-request McpServer factory.
const handler = createMcpHandler(buildServer, { keepAliveMs: 15_000 });
```

- **Turn off buffering** on streaming routes in the proxy (for example `proxy_buffering off` in nginx). A buffered stream delivers bytes late, so heartbeats do not reset the idle timer.
- **Raise idle limits** on load balancers and gateways for the MCP path, if heartbeats are not enough.
- **Close only the right stream.** Request cleanup must end only that request's response, not another live stream or a shared transport. In TREK's case, sessions also expired early, so fix [session lifetime](/learn/mcp-session-not-found-after-deploy) too.
- **Python:** use the SDK's own SSE responses and check ASGI-server and proxy disconnect logs. Do not write your own events into the stream.

A heartbeat does not help when the process crashed, and it does not extend a client's request deadline.

## Check with mcptest

Use **Test your server** to see stream responses and whether follow-up requests work. There is no mcptest finding for a cut stream, and a short run cannot show that a stream survives five idle minutes. Repeat the idle or restart scenario with the affected client. [transport.sse-content-type-mismatch](/learn/mcp-transport-diagnostics-reference#transport-sse-content-type-mismatch) catches a stream sent with the wrong media type, a different problem. For stateful servers, [session.stickiness](/learn/mcp-transport-diagnostics-reference#session-stickiness) checks that requests keep reaching the same session.

## Related errors

- [MCP error -32000: Connection closed](/learn/mcp-error-connection-closed): a pending request failed because the transport closed.
- [MCP error -32001: Request timed out](/learn/mcp-error-request-timed-out): the stream stayed open, but no reply came in time.
- [Session not found (404)](/learn/mcp-session-not-found-after-deploy): reconnects fail because the session is gone.
