---
title: "Long-running MCP tools: timeouts, progress, cancellation and tasks"
navTitle: Long-running tools
summary: Where MCP tool calls time out in SDKs and clients, how progress notifications can reset a timeout, how cancellation works over HTTP and stdio, what the Tasks extension changes and who supports it, and the job-ID plus status-tool pattern that works everywhere.
track: build
level: practitioner
order: 36
category: Production engineering
readingTimeMinutes: 7
lastReviewed: "2026-11-11"
metaTitle: "Long-Running MCP Tools: Timeouts, Progress, Tasks | mcptest.io"
metaDescription: "Build MCP tools that take minutes: SDK and client timeouts, progress notifications and timeout reset, cancellation, the Tasks extension and its client support, and the portable job-ID and status-tool pattern."
relatedSlugs:
  - mcp-error-request-timed-out
  - designing-production-mcp-server
  - mcp-tool-annotations-and-client-retries
  - mcp-tool-errors-agents-can-act-on
sourceLinks:
  - title: "MCP 2026-07-28 specification: progress"
    url: "https://modelcontextprotocol.io/specification/2026-07-28/basic/patterns/progress"
  - title: "MCP 2026-07-28 specification: cancellation and timeouts"
    url: "https://modelcontextprotocol.io/specification/2026-07-28/basic/patterns/cancellation"
  - title: "MCP 2026-07-28 changelog (tasks moved to an extension)"
    url: "https://modelcontextprotocol.io/specification/2026-07-28/changelog"
  - title: "MCP Tasks extension overview"
    url: "https://modelcontextprotocol.io/extensions/tasks/overview"
  - title: "MCP extension support matrix"
    url: "https://modelcontextprotocol.io/extensions/client-matrix"
  - title: "TypeScript SDK v2: logging, progress, and cancellation"
    url: "https://ts.sdk.modelcontextprotocol.io/v2/servers/logging-progress-cancellation"
  - title: "Claude Code: MCP time limits and MCP tasks"
    url: "https://code.claude.com/docs/en/mcp#time-limits-on-mcp-tool-calls"
  - title: "Claude: build an MCP server (size and timeout limits)"
    url: "https://claude.com/docs/connectors/building"
  - title: "Codex: Model Context Protocol"
    url: "https://learn.chatgpt.com/docs/extend/mcp"
  - title: "Gemini CLI: MCP servers"
    url: "https://geminicli.com/docs/tools/mcp-server/"
---

A tool call is one request with one response, and every layer between the model and your handler waits for it with a timer: the client's SDK, the client application and any proxy. A 30-second tool works almost everywhere. A five-minute tool works in some clients, fails in others, and leaves the agent unsure whether the work happened. This guide covers what the protocol offers to stretch a call, and the pattern to use when a call should not stay open at all.

## Where the time limits are

The specification says senders **should** set timeouts on every request and SDKs **should** let callers configure them per request. It does not set a number. The documented values in common SDKs and clients:

| Layer | Documented limit |
| --- | --- |
| TypeScript SDK v2 client | `DEFAULT_REQUEST_TIMEOUT_MSEC` is 60,000 ms per request, overridable per call with `timeout` ([`protocol.ts`](https://github.com/modelcontextprotocol/typescript-sdk/blob/main/packages/core-internal/src/shared/protocol.ts)) |
| Python SDK client | `ClientSession` sets no deadline unless you pass `read_timeout_seconds`; the default HTTP client waits up to 300 seconds for data on a stream ([`_httpx_utils.py`](https://github.com/modelcontextprotocol/python-sdk/blob/main/src/mcp/shared/_httpx_utils.py)) |
| claude.ai and Claude Desktop | 240 seconds per tool call ([Claude connector limits](https://claude.com/docs/connectors/building)) |
| Claude Code | `MCP_TOOL_TIMEOUT` or a per-server `timeout` sets a wall-clock limit. HTTP servers also have a per-request timer of at least 60 seconds to the first response byte, and an idle timeout, five minutes by default for HTTP, that ends a call with no response and no progress ([Claude Code docs](https://code.claude.com/docs/en/mcp#time-limits-on-mcp-tool-calls)) |
| Codex | `tool_timeout_sec`, default 60 ([Codex MCP docs](https://learn.chatgpt.com/docs/extend/mcp)) |
| Gemini CLI | `timeout` in the server config, default 600,000 ms ([Gemini CLI docs](https://geminicli.com/docs/tools/mcp-server/)) |

Many clients document no limit, which does not mean there is none, and your hosting platform and load balancer add their own. The shortest timer wins. Design for about a minute unless you control the client.

## Progress notifications

A client that wants progress puts a `progressToken` in the request's `_meta`. The server **may** then send `notifications/progress` with that token, a `progress` value that **must** increase with each notification, an optional `total` and an optional `message`. Over Streamable HTTP these notifications travel on the response stream of the request they belong to.

Progress keeps a call alive only where the client allows it: the [cancellation page](https://modelcontextprotocol.io/specification/2026-07-28/basic/patterns/cancellation) says implementations **may** reset the timeout clock on a progress notification, and **should** still enforce a maximum timeout regardless. Clients differ:

- The TypeScript SDK resets the timer only when the caller sets `resetTimeoutOnProgress: true`, which defaults to `false`, and stops at `maxTotalTimeout` if set.
- Claude Code says its per-server `timeout` "is a hard wall-clock limit per tool call, and progress notifications from the server don't extend it", while progress does count as activity for its idle timeout.

The TypeScript SDK sends a `progressToken` only when the caller passes `onprogress`, so a server must check for the token before sending anything:

```typescript
import { McpServer } from '@modelcontextprotocol/server';
import * as z from 'zod/v4';

declare function buildSection(month: string, index: number, signal: AbortSignal): Promise<void>;

export function buildReportServer(): McpServer {
  const server = new McpServer({ name: 'reports', version: '1.0.0' });
  server.registerTool(
    'build-report',
    {
      description: 'Build the monthly report. Takes up to two minutes.',
      inputSchema: z.object({ month: z.string().regex(/^\d{4}-\d{2}$/) }),
    },
    async ({ month }, ctx) => {
      const progressToken = ctx.mcpReq._meta?.progressToken;
      const sections = 12;
      for (let i = 0; i < sections; i++) {
        if (ctx.mcpReq.signal.aborted) {
          return { content: [{ type: 'text', text: `Cancelled after ${i} of ${sections} sections` }], isError: true };
        }
        await buildSection(month, i, ctx.mcpReq.signal);
        if (progressToken !== undefined) {
          await ctx.mcpReq.notify({
            method: 'notifications/progress',
            params: { progressToken, progress: i + 1, total: sections, message: `Built section ${i + 1} of ${sections}` },
          });
        }
      }
      return { content: [{ type: 'text', text: `Report for ${month} is ready` }] };
    }
  );
  return server;
}
```

A TypeScript client opts in to progress and to the timeout reset per call:

```typescript
const result = await client.callTool(
  { name: 'build-report', arguments: { month: '2026-10' } },
  {
    onprogress: ({ progress, total, message }) => console.log(`${progress}/${total ?? '?'} ${message ?? ''}`),
    timeout: 60_000,
    resetTimeoutOnProgress: true,
    maxTotalTimeout: 300_000,
  }
);
```

In the Python SDK, a tool that takes a `ctx: Context` parameter calls `await ctx.report_progress(progress, total, message)`.

Send progress when real work completes; notifications on a timer keep a stuck call open.

## Cancellation

Under 2026-07-28, how a client cancels depends on the transport. Over Streamable HTTP, closing the request's response stream is the cancellation, and the server **must** treat the disconnect that way. Over stdio, the client sends `notifications/cancelled` with the request ID. A server **should** stop work and free resources, and the client **should** ignore any response that still arrives.

In the TypeScript SDK, `ctx.mcpReq.signal` aborts on cancellation and disconnect. Check it between units of work, as above, and pass it to `fetch`. A client cancels by aborting the `signal` it passed in the call options.

Cancellation races completion, so after cancelling a write the caller cannot tell whether it happened. That is the case for an idempotency key or the job pattern below.

## The Tasks extension

The 2025-11-25 revision added experimental tasks to the core protocol. The [2026-07-28 changelog](https://modelcontextprotocol.io/specification/2026-07-28/changelog) moved them into an official extension, `io.modelcontextprotocol/tasks`, which replaces the blocking `tasks/result` with polling through `tasks/get`, adds `tasks/update` for client input and removes `tasks/list`.

A client declares the extension in the capabilities it sends in each request's `_meta`. The server may then answer `tools/call` with `resultType: "task"`, a `taskId`, a status, `ttlMs` and `pollIntervalMs`. The client polls `tasks/get` until the task is `completed`, `failed` or `cancelled`, and may send a cooperative `tasks/cancel`. Never return a task to a client that did not declare the extension.

Client support is still narrow. On November 11, 2026, the community-maintained [extension support matrix](https://modelcontextprotocol.io/extensions/client-matrix) listed Tasks for Claude on the web, Claude Code, MCPJam and Glean. Claude Code documents MCP tasks as a public beta that requires v2.1.304 or later. On the server side, the official TypeScript SDK v2 packages have no Tasks API; the extension's own [`@modelcontextprotocol/ext-tasks`](https://github.com/modelcontextprotocol/ext-tasks) package provides one. Offer tasks to clients that declare the extension, and keep a fallback for the rest.

## The portable fallback: a job ID and a status tool

Every client can call two ordinary tools. Split the work into a tool that starts a job and returns at once, and a tool that reports on it:

```typescript
import { randomUUID } from 'node:crypto';
import { McpServer } from '@modelcontextprotocol/server';
import * as z from 'zod/v4';

type Job = { status: 'running' | 'done' | 'failed'; month: string; url?: string };
const jobs = new Map<string, Job>(); // use a database or queue in production
declare function runExport(jobId: string): Promise<void>;

export function buildExportServer(): McpServer {
  const server = new McpServer({ name: 'exports', version: '1.0.0' });

  server.registerTool(
    'start-export',
    {
      description:
        'Start exporting a month of orders. Returns a job id at once. Call get-export-status with it; exports usually take 2 to 10 minutes.',
      inputSchema: z.object({ month: z.string().regex(/^\d{4}-\d{2}$/) }),
      outputSchema: z.object({ jobId: z.string(), status: z.literal('running'), pollAfterSeconds: z.number() }),
    },
    async ({ month }) => {
      const jobId = `exp_${randomUUID()}`;
      jobs.set(jobId, { status: 'running', month });
      void runExport(jobId); // hand off to a worker; do not await
      const output = { jobId, status: 'running' as const, pollAfterSeconds: 30 };
      return { content: [{ type: 'text', text: JSON.stringify(output) }], structuredContent: output };
    }
  );

  server.registerTool(
    'get-export-status',
    {
      description: 'Check an export started with start-export. Safe to call repeatedly.',
      inputSchema: z.object({ jobId: z.string() }),
      annotations: { readOnlyHint: true, openWorldHint: false },
    },
    async ({ jobId }) => {
      const job = jobs.get(jobId);
      if (!job) {
        return {
          content: [{ type: 'text', text: `Unknown job ${jobId}. Jobs expire 24 hours after they finish; start a new export.` }],
          isError: true,
        };
      }
      return { content: [{ type: 'text', text: JSON.stringify(job) }] };
    }
  );

  return server;
}
```

What makes it work:

- **Durable state.** Any instance may serve the status call. Keep jobs in a database or queue under an unguessable ID, and authorize the caller on every status call.
- **Say how long and when to poll** in the description and result, so the model neither spins nor gives up.
- **Mark the status tool read-only**, so clients can call it without confirmation and retry it freely; see [tool annotations](/learn/mcp-tool-annotations-and-client-retries).
- **Make the start call safe to repeat** with an idempotency key, or by returning the existing job for identical arguments, because a dropped start response is the one ambiguous moment left.
- **State the expiry**, and make an expired or unknown ID an `isError` result that tells the model to start again.

It costs the model a few turns, but no call stays open, and a client that reconnects resumes with the job ID.

## FAQ

### Should I send progress notifications to stop a client timing out?

Send them to inform the user, not as a keep-alive. The TypeScript SDK resets its timer only with `resetTimeoutOnProgress`, and Claude Code's wall-clock limit ignores them.

### Does cancelling a call undo the work?

No. Cancellation asks the server to stop. Work that already committed stays committed, which is why long writes need an operation ID the caller can check.

### Should I use the Tasks extension or the job pattern?

Both, if you can. Return a task to clients that declare `io.modelcontextprotocol/tasks`, and expose the start and status tools for everyone else. If you only build one, the job pattern works in every client today.

### How do I test a long-running tool?

Call it with your target clients' shortest timeout, cut the connection mid-call and repeat the start call; then check in the [playground](/) that the status tool reports one job. For the timeout error itself, see [request timed out](/learn/mcp-error-request-timed-out).
