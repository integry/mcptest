---
title: "MCP error -32001: Request timed out"
navTitle: "Request timed out (-32001)"
summary: "What the client-side Request timed out error means, the SDK defaults behind it, how to find the stalled request, and bounded timeout and progress fixes."
track: "build"
level: "practitioner"
order: 455
category: "Transports"
readingTimeMinutes: 6
lastReviewed: "2026-11-11"
metaTitle: "MCP error -32001: Request timed out | mcptest.io"
metaDescription: "Fix MCP error -32001 Request timed out: the 60-second SDK default, finding the stalled request, raising deadlines safely and reporting progress."
relatedSlugs:
  - troubleshooting
  - mcp-error-connection-closed
  - mcp-error-sse-stream-disconnected
  - mcp-error-posting-to-endpoint
sourceLinks:
  - title: "TypeScript SDK 1.x error codes (RequestTimeout = -32001)"
    url: "https://github.com/modelcontextprotocol/typescript-sdk/blob/v1.x/src/types.ts"
  - title: "TypeScript SDK 1.x request timeout default"
    url: "https://github.com/modelcontextprotocol/typescript-sdk/blob/v1.x/src/shared/protocol.ts"
  - title: "Python SDK migration: client request timeouts"
    url: "https://github.com/modelcontextprotocol/python-sdk/blob/main/docs/migration.md"
  - title: "Remote initialization timeout #300"
    url: "https://github.com/istefox/obsidian-mcp-connector/issues/300"
  - title: "Qwen remote discovery timeout #7147"
    url: "https://github.com/QwenLM/qwen-code/issues/7147"
  - title: "SDK deadline diagnosis and bounded progress #1720"
    url: "https://github.com/morluto/rea/issues/1720"
---

## MCP error -32001: Request timed out

```text
MCP error -32001: Request timed out
```

The client sent a request and gave up waiting for its reply. The deadline belongs to the client, not the server. The SDK raises the error locally, and the connection itself may still be fine.

**Who prints it:**

- TypeScript SDK 1.x prints exactly this string. `-32001` is its `ErrorCode.RequestTimeout`.
- TypeScript SDK 2.x prints `Request timed out`, as an `SdkError` with the string code `REQUEST_TIMEOUT`. If `maxTotalTimeout` runs out, the message is `Maximum total timeout exceeded`.
- Python SDK 2.x raises `MCPError` with code `-32001` and a message such as `Request 'tools/call' timed out`. Python 1.x used code `408` and `Timed out while waiting for response to ClientRequest. Waited 5.0 seconds.`

**Default deadline:** both TypeScript SDK lines wait 60 seconds per request (`DEFAULT_REQUEST_TIMEOUT_MSEC = 60000`). The Python client has no default: it times out only when `read_timeout_seconds` is set. Hosts can set their own value. An error at almost exactly 60 seconds therefore usually means the TypeScript default, as in [Obsidian connector #300](https://github.com/istefox/obsidian-mcp-connector/issues/300) and [REA #1720](https://github.com/morluto/rea/issues/1720).

Do not confuse this with a `-32001` in an HTTP 404 body. TypeScript SDK servers use that code for `Session not found`; see the [session guide](/learn/mcp-session-not-found-after-deploy).

## Likely causes {#likely-causes-ranked-by-recurrence-in-the-reports}

1. **The work takes longer than the client deadline.** A slow tool, a cold start or a slow backend runs past 60 seconds. In REA #1720 a tool needed minutes to start its backend, and every call failed at 60 seconds. Raising the server's own startup timeout cannot change the client's deadline.
2. **The reply never reaches the client.** The handler finished, but the response was lost: buffered by a proxy, sent on a stream that closed, or sent with the wrong request id. Obsidian #300 shows `initialize` hanging behind `mcp-remote` while the same server worked over direct HTTP. [Qwen #7147](https://github.com/QwenLM/qwen-code/issues/7147) shows tool, prompt and resource listing timing out after authentication.
3. **The handler is stuck.** A deadlock, a blocked event loop or a call to an unresponsive dependency means no reply is ever produced.

## How to confirm the cause

- **Measure the deadline.** Note the time between sending the request and the error. A fixed value (60.0 seconds, for example) is a client deadline. A varying value suggests a proxy or network limit.
- **Check whether the handler finished.** Log the request id and method when the handler starts and ends. If the server logged a finished response before the client gave up, the reply was lost (cause 2). If it finished later, the work is too slow (cause 1). If it never finished, the handler is stuck (cause 3).
- **Time the same request directly, without the host or proxy.** For a 2025 server, initialize first and send the returned `Mcp-Session-Id` (if any) with the call:

```bash
curl -s -o /dev/null -w 'status %{http_code}, first byte %{time_starttransfer}s, total %{time_total}s\n' \
  https://mcp.example.com/mcp \
  -H 'Content-Type: application/json' \
  -H 'Accept: application/json, text/event-stream' \
  -H 'MCP-Protocol-Version: 2025-11-25' \
  -H 'Mcp-Session-Id: <id from initialize>' \
  -d '{"jsonrpc":"2.0","id":2,"method":"tools/call","params":{"name":"slow_tool","arguments":{}}}'
```

A fast direct reply with a slow or missing reply through the host points to an intermediary (cause 2).

## Fix for client users

- Find out which method timed out, and how long it ran. `initialize` timing out is a different problem from one slow tool call.
- Raise the host's request timeout only when the work is known to be slow but bounded. A connection or startup timeout setting does not change the per-request deadline.
- Do not retry a write automatically. On timeout the client cancels the request, but the server may already have done the work.
- If the response says `Gateway Timeout`, a proxy gave up, not the MCP client. Follow [HTTP POST failures](/learn/mcp-error-posting-to-endpoint).

## Fix for SDK client and server authors

In TypeScript SDK 2.x, request options are the second argument of `callTool`. This bounded policy follows the [REA deadline investigation](https://github.com/morluto/rea/issues/1720):

```ts
const result = await client.callTool(
  { name: 'long_operation', arguments: {} },
  {
    timeout: 120_000,
    resetTimeoutOnProgress: true,
    maxTotalTimeout: 300_000,
    onprogress: ({ progress, total }) => console.log(progress, total),
  },
);
```

`resetTimeoutOnProgress` restarts the deadline each time a progress notification arrives. `maxTotalTimeout` still caps the whole call. In TypeScript SDK 1.x, these options come after the optional result schema argument. Check your installed version before copying.

Server authors should return a reply for every request, stop work when the request is cancelled, and report progress for long work. In Python SDK 2.x, progress uses the injected `Context`:

```python
import asyncio
from mcp.server.mcpserver import MCPServer, Context

mcp = MCPServer("example")

@mcp.tool()
async def bounded_work(ctx: Context) -> str:
    for step in range(3):
        await asyncio.sleep(1)  # Replace with cancellable asynchronous work.
        await ctx.report_progress(step + 1, 3)
    return "done"
```

Progress extends a deadline only when the client asked for it, as in the TypeScript example above. Many hosts do not. Do not send fake progress to hide a stuck backend. For work that takes minutes, consider returning quickly and letting the client check for the result later.

## Check with mcptest

**Test your server** shows which step completes and which request stalls, with timings in the message log. There is no mcptest finding for request deadlines. A quick passing ping does not show that a slow tool fits the host's deadline, so run the slow operation itself with the host's real timeout. [session.stickiness](/learn/mcp-transport-diagnostics-reference#session-stickiness) can show stateful requests failing under a five-second deadline.

## Related errors

- [MCP error -32000: Connection closed](/learn/mcp-error-connection-closed): the connection closed before the reply arrived.
- [SSE stream disconnected: TypeError: terminated](/learn/mcp-error-sse-stream-disconnected): the stream carrying the reply was cut.
- [Error POSTing to endpoint](/learn/mcp-error-posting-to-endpoint): an HTTP error, including `Gateway Timeout` from a proxy.
