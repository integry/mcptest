---
title: "SSE stream disconnected: TypeError: terminated"
navTitle: "SSE stream disconnected"
summary: "Diagnose truncated MCP streams, idle proxy deadlines and premature response cleanup, and distinguish normal stream completion from lost replies."
track: "build"
level: "practitioner"
order: 453
category: "Transports"
readingTimeMinutes: 5
lastReviewed: "2026-10-26"
metaTitle: "SSE stream disconnected: TypeError: terminated | mcptest.io"
metaDescription: "Diagnose truncated MCP streams, idle proxy deadlines and premature response cleanup, and distinguish normal stream completion from lost replies."
relatedSlugs:
  - troubleshooting
  - mcp-error-connection-closed
  - mcp-error-request-timed-out
  - mcp-session-not-found-after-deploy
sourceLinks:
  - title: "TREK remote stream disconnect report #1414"
    url: "https://github.com/liketrek/TREK/issues/1414"
  - title: "VS Code idle stream report #300277"
    url: "https://github.com/microsoft/vscode/issues/300277"
  - title: "TypeScript stream troubleshooting"
    url: "https://github.com/modelcontextprotocol/typescript-sdk/blob/main/docs/troubleshooting.md"
  - title: "TypeScript HTTP handler options"
    url: "https://github.com/modelcontextprotocol/typescript-sdk/blob/main/packages/server/src/server/createMcpHandler.ts"
---

## SSE stream disconnected: TypeError: terminated

```text
SSE stream disconnected: TypeError: terminated
```

**Where it appears:** [TREK #1414](https://github.com/liketrek/TREK/issues/1414) records this in July 2026 logs using `mcp-remote` against a Kubernetes deployment, including successful calls followed by disconnects. [VS Code #300277](https://github.com/microsoft/vscode/issues/300277) records `TypeError: terminated` with an async-stream prefix after roughly five idle minutes on an extension-hosted connection. That local extension report corroborates the stream symptom, not the cause of a remote ingress failure.

## Likely causes, ranked by the report evidence

1. **Stream lifetime and cleanup disagree.** TREK reports disconnection after operations. Compare the last JSON-RPC response with stream closure and transport cleanup. A completed per-request SSE response can end normally; the error matters when a body is truncated or required delivery is lost.
2. **Idle timeout at the client or an intermediary.** VS Code's report has a repeated idle interval. Measure time since the last byte, not only time since connection. Then inspect gateway idle limits and heartbeat delivery.
3. **Restart or network interruption.** Correlate server termination, load-balancer resets and client network changes with the cut. This is a hypothesis to test, not something `terminated` proves.

There is no measured cross-client frequency distribution; prioritize the branch matching the observed timing.

## Fix for client users

Record whether a response arrived before the disconnect and whether a new read-only request works. Reconnect through the host's supported controls. If the error returns at a fixed idle interval, give the publisher the interval and redacted timestamps. If it follows every request, include the method and whether that request completed.

Do not automatically repeat a write operation: a lost response does not show whether the server executed it. A subsequent `session not found` calls for [session recovery](/learn/mcp-session-not-found-after-deploy), while a still-open connection with a missing reply belongs in [request timeout troubleshooting](/learn/mcp-error-request-timed-out).

## Fix for server authors

Disable proxy buffering on streaming routes, flush headers promptly, and align infrastructure idle limits with the intended stream behavior. Keep the application event loop responsive so it can send data and notice cancellation. Check that request cleanup closes only the appropriate response, not another live stream or shared transport.

The [TypeScript SDK troubleshooting guide](https://github.com/modelcontextprotocol/typescript-sdk/blob/main/docs/troubleshooting.md) documents default 15-second SSE comments and `keepAliveMs`. In a current SDK 2.x handler, the relevant option is:

```ts
import { createMcpHandler } from '@modelcontextprotocol/server';

// buildServer is your existing per-request McpServer factory.
const handler = createMcpHandler(buildServer, { keepAliveMs: 15_000 });
```

Keep heartbeats below the shortest infrastructure idle limit and verify that bytes reach the client. For Python, use the SDK's supported SSE response machinery and inspect ASGI/proxy disconnect logs; do not invent JSON-RPC ping events inside the raw stream. A heartbeat does not repair a crashed process or extend an absolute request deadline.

## Check with mcptest

Use **Test your server** to inspect stream responses and follow-up requests. [transport.sse-content-type-mismatch](/learn/mcp-transport-diagnostics-reference#transport-sse-content-type-mismatch) detects incorrect media types, not truncated bodies or every idle timeout. For stateful continuity, [session.stickiness](/learn/mcp-transport-diagnostics-reference#session-stickiness) samples sequential and parallel requests. There is no dedicated `terminated` finding, and a short passing run cannot prove a stream survives five minutes idle. Repeat the original idle and restart scenario with the affected client. See also [Connection closed](/learn/mcp-error-connection-closed).
