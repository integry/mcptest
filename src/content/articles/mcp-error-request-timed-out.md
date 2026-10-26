---
title: "MCP error -32001: Request timed out"
navTitle: "Request timed out (-32001)"
summary: "Distinguish MCP request deadlines from connection setup, lost initialization replies and gateway timeouts, with bounded SDK timeout and progress examples."
track: "build"
level: "practitioner"
order: 455
category: "Transports"
readingTimeMinutes: 5
lastReviewed: "2026-10-26"
metaTitle: "MCP error -32001: Request timed out | mcptest.io"
metaDescription: "Distinguish MCP request deadlines from connection setup, lost initialization replies and gateway timeouts, with bounded SDK timeout and progress examples."
relatedSlugs:
  - troubleshooting
  - mcp-error-connection-closed
  - mcp-error-sse-stream-disconnected
  - mcp-error-posting-to-endpoint
sourceLinks:
  - title: "Remote initialization timeout #300"
    url: "https://github.com/istefox/obsidian-mcp-connector/issues/300"
  - title: "Qwen remote discovery timeout #7147"
    url: "https://github.com/QwenLM/qwen-code/issues/7147"
  - title: "SDK deadline diagnosis and bounded progress #1720"
    url: "https://github.com/morluto/rea/issues/1720"
  - title: "Python progress migration"
    url: "https://github.com/modelcontextprotocol/python-sdk/blob/main/docs/migration.md"
---

## MCP error -32001: Request timed out

```text
MCP error -32001: Request timed out
```

**Which clients print it:** [Obsidian connector #300](https://github.com/istefox/obsidian-mcp-connector/issues/300) reports Claude Desktop through `mcp-remote` timing out on remote HTTP initialization in June 2026. [Qwen #7147](https://github.com/QwenLM/qwen-code/issues/7147) records it while listing tools, prompts and resources after authentication. These are examples of the older SDK wording; do not assume every current SDK uses this numeric code.

## Likely causes, ranked by recurrence in the reports

1. **A request never receives its matching reply.** Both remote reports describe successful setup stages before a stalled operation. Identify the last completed method, request id and whether a response reached the client before the deadline.
2. **The client deadline is shorter than real work.** [REA #1720](https://github.com/morluto/rea/issues/1720) diagnoses a client-owned deadline independent of a configured backend startup limit. Compare handler completion time with cancellation time.
3. **Streaming or gateway delivery stalls.** If the handler completed promptly but the reply did not arrive, inspect buffering, response ids and stream closure. This is a diagnostic hypothesis; the error alone cannot prove a slow handler.

The ranking is a qualitative reading of the linked cases, not measured incident frequency.

## Fix for client users

Distinguish connection setup from a per-request deadline. Record the failing method and elapsed time; a fixed cutoff suggests a configured deadline. A connected socket does not prove initialization or tool listing completed. Ask the publisher whether the request reached the handler and produced a matching response.

Raise a configurable request limit only when there is evidence of legitimate bounded work. Increasing a connection timeout cannot change a different request timeout. Avoid replaying writes when the execution outcome is unknown. If the response explicitly says `Gateway Timeout`, follow [HTTP POST failures](/learn/mcp-error-posting-to-endpoint).

## Fix for SDK client and server authors

For TypeScript SDK 2.x, request options are the second argument. This bounded policy follows the [REA deadline investigation](https://github.com/morluto/rea/issues/1720):

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

The 1.x SDK placed these options after the optional result schema argument. Check your installed API before copying. REA's follow-up notes the newer SDK labels the failure `REQUEST_TIMEOUT`.

Server authors should return matching replies, observe cancellation and keep work responsive. In Python SDK 2.x, [progress reporting](https://github.com/modelcontextprotocol/python-sdk/blob/main/docs/migration.md) uses injected `Context`:

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

Progress does not automatically extend every host's deadline. The caller must request and handle it, and a maximum total deadline should still bound the operation. Do not emit fake progress to conceal a stuck backend.

## Check with mcptest

**Test your server** shows which stage completes and which request stalls. There is no transport diagnostic id specifically for a request deadline. [session.stickiness](/learn/mcp-transport-diagnostics-reference#session-stickiness) can reveal failures during bounded session probes; [transport.sse-content-type-mismatch](/learn/mcp-transport-diagnostics-reference#transport-sse-content-type-mismatch) catches a related parser failure, not slow execution. Re-run the actual slow operation with the intended host deadline; a successful short ping does not validate it. See [stream termination](/learn/mcp-error-sse-stream-disconnected) when the connection drops first.
