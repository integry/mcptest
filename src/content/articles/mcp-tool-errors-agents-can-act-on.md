---
title: "MCP tool errors agents can act on: isError, retries, empty results and revoked access"
navTitle: Actionable tool errors
summary: When an MCP tool failure should be a JSON-RPC protocol error and when an isError result, how to write error text that tells the agent how to fix the call and whether to retry, why empty results must say so, how to handle revoked credentials, and why hiding a tool from tools/list is not authorization.
track: build
level: practitioner
order: 38
category: Tool contracts
readingTimeMinutes: 7
lastReviewed: "2026-11-11"
metaTitle: "MCP Tool Errors Agents Can Act On: isError and Retries | mcptest.io"
metaDescription: "Design MCP tool errors agents can recover from: protocol errors versus isError results, retry guidance, explicit empty results, revoked credentials and list_changed, and why hiding tools is not authorization."
relatedSlugs:
  - mcp-json-rpc-error-codes
  - mcp-tool-annotations-and-client-retries
  - designing-production-mcp-server
  - remote-mcp-server-401-unauthorized
sourceLinks:
  - title: "MCP 2026-07-28 specification: tools (error handling, list changed, security)"
    url: "https://modelcontextprotocol.io/specification/2026-07-28/server/tools"
  - title: "MCP 2025-11-25 specification: tools"
    url: "https://modelcontextprotocol.io/specification/2025-11-25/server/tools"
  - title: "MCP 2026-07-28 specification: authorization"
    url: "https://modelcontextprotocol.io/specification/2026-07-28/basic/authorization"
  - title: "TypeScript SDK v2: errors"
    url: "https://ts.sdk.modelcontextprotocol.io/v2/servers/errors"
  - title: "TypeScript SDK v2: notifications"
    url: "https://ts.sdk.modelcontextprotocol.io/v2/servers/notifications"
  - title: "Python SDK: MCPServer exceptions"
    url: "https://github.com/modelcontextprotocol/python-sdk/blob/main/src/mcp/server/mcpserver/exceptions.py"
---

An agent can only recover from a failure it can read. Given a stack trace, a bare "Internal error" or a protocol error the client never shows the model, it guesses: it retries what will never work, gives up on what would work a minute later, or tells the user the data does not exist. A good tool error says what happened, whether trying again can help, and what to change.

## Two channels for failure

The [tools specification](https://modelcontextprotocol.io/specification/2026-07-28/server/tools) defines two mechanisms:

| | Protocol error | Tool execution error |
| --- | --- | --- |
| Wire shape | JSON-RPC `error` with `code` and `message` | A normal result with `isError: true` and `content` |
| Meant for | Unknown tool, a request that fails the `CallToolRequest` schema, server errors | API failures, input validation errors, business logic errors |
| Reaches the model | Clients **may** pass it on | Clients **should** pass it on "to enable self-correction" |

Both 2025-11-25 and 2026-07-28 list input validation errors, "date in wrong format, value out of range", as tool execution errors, so the model sees what to fix.

The SDKs mostly make that choice for you. Measured with TypeScript SDK 2.4.0 and Python SDK 2.3.0:

| Situation | TypeScript SDK | Python SDK |
| --- | --- | --- |
| Arguments fail the input schema | `isError` result starting `Input validation error:` | `isError` result |
| Handler throws | `isError` result with the exception's message | `ToolError`: `isError` with `Error executing tool <name>: <message>`. Any other exception: only `Error executing tool <name>` |
| Unknown tool name | Protocol error `-32602`, `Tool <name> not found` | `isError` result, `Unknown tool: <name>` |
| Tool disabled through its registration handle | Protocol error `-32602`, `Tool <name> disabled` | n/a |

The Python row matters most: an unexpected exception reaches the model with no detail, by design, so nothing internal leaks. Raise `ToolError` with a message written for the model, or return an `isError` result yourself. In TypeScript, every thrown message reaches the model, including whatever an upstream library put in it, so catch unexpected exceptions, log them, and return a generic `isError` result, as the samples below do.

## Say how to fix it and whether to retry

An agent decides its next step from the text alone. Every error message should answer three questions:

1. **What failed**, in the caller's terms: "No open issues match", not "query returned 0 rows" or `ECONNRESET`.
2. **Whether retrying can help**: never with the same arguments, after a delay, or only after the user does something.
3. **What changed**: for a write, whether anything was committed. "Nothing was changed" lets the agent retry safely; "the outcome is unknown" tells it to check before repeating.

| Cause | Weak | Actionable |
| --- | --- | --- |
| Bad argument | `Invalid input` | `start_date must be in the future; today is 2026-11-11. Use YYYY-MM-DD.` |
| Upstream rate limit | `Error 429` | `The tracker is rate limiting this account. Retry the same call after 30 seconds; nothing was changed.` |
| Timeout during a write | `Request failed` | `The payment provider did not answer in 20 s; the charge may have gone through. Call get_payment with idempotency key K-81 before retrying.` |
| Missing permission | `Forbidden` | `You cannot close ISS-12: it belongs to another team. Do not retry; ask the user to request access.` |

Put the text in `content`, which the model reads. Log stack traces and internal detail on the server under a correlation ID, and put only the ID in the message.

## Empty results are not errors, and must say so

A search that finds nothing is a successful call: return it without `isError`, and say so. A bare `[]` does not tell the model "nothing matched" from "the tool did not run", and agents fill that gap by retrying or inventing data. Say what was searched, that the result is complete, and how to widen it.

The reverse matters as much: when the search could not run, because the upstream service failed or the query was rejected, return `isError`. An empty list in that case is a false answer.

```typescript
import { randomUUID } from 'node:crypto';
import { McpServer } from '@modelcontextprotocol/server';
import * as z from 'zod/v4';

declare class UpstreamError extends Error { status: number; retryAfterSeconds?: number }
declare function trackerSearch(query: string, status: string): Promise<{ id: string; title: string }[]>;
declare function logError(ref: string, error: unknown): void; // strips credentials, writes the server log

const toolError = (text: string) => ({ content: [{ type: 'text' as const, text }], isError: true });

export function buildServer(): McpServer {
  const server = new McpServer({ name: 'tracker', version: '1.0.0' });
  server.registerTool(
    'search-issues',
    {
      description: 'Search issues by text. Returns at most 20 issues.',
      inputSchema: z.object({ query: z.string().min(2), status: z.enum(['open', 'closed']).default('open') }),
      annotations: { readOnlyHint: true },
    },
    async ({ query, status }) => {
      try {
        const issues = await trackerSearch(query, status);
        if (issues.length === 0) {
          return {
            content: [{ type: 'text', text: `No ${status} issues match "${query}". This is a complete result, not an error. To widen the search, try status "closed" or a shorter query.` }],
          };
        }
        return { content: [{ type: 'text', text: JSON.stringify(issues) }] };
      } catch (error) {
        if (error instanceof UpstreamError && error.status === 429) {
          return toolError(`The tracker is rate limiting this account. Retry the same call after ${error.retryAfterSeconds ?? 60} seconds; nothing was changed.`);
        }
        if (error instanceof UpstreamError && error.status === 401) {
          return toolError('The tracker rejected the stored credentials; they were revoked or expired. Retrying will not help. Ask the user to reconnect the tracker, then call this tool again.');
        }
        // Never rethrow: the SDK would show the exception's message, URLs and all, to the model.
        const ref = randomUUID();
        logError(ref, error);
        return toolError(`The issue search failed on the server. Retry once; if it fails again, tell the user and quote reference ${ref}. Nothing was changed.`);
      }
    }
  );
  return server;
}
```

## Revoked and expired credentials

There are two credentials to tell apart.

**The MCP access token.** The [authorization specification](https://modelcontextprotocol.io/specification/2026-07-28/basic/authorization) says invalid or expired tokens **must** get HTTP `401`, with a `WWW-Authenticate` header. The client handles it by refreshing or signing in again; see [401 Unauthorized](/learn/remote-mcp-server-401-unauthorized). An `isError` result would ask the model to fix what only the client can.

**An upstream credential your server holds**, such as a stored API token for the user's tracker account. The MCP request is valid, so return `isError` with text that says the connection must be renewed and that retrying will not help, as the 401 branch above does. If the tools cannot work at all until the user reconnects, you can also stop offering them:

- In the TypeScript SDK, calling `disable()` or `remove()` on the handle `registerTool` returned sends `notifications/tools/list_changed`.
- Under 2026-07-28, that notification only reaches clients that opened a `subscriptions/listen` stream with `toolsListChanged: true`; behind `createMcpHandler`, publish it with `handler.notify.toolsChanged()`.
- Clients that never subscribe keep calling the tool from their cached list, and a call to a disabled TypeScript tool is a `-32602` protocol error the model may never see. Returning the `isError` text serves them better; see [which tool changes break clients](/learn/which-mcp-tool-changes-break-clients).

## Hiding a tool is not authorization

The specification lets `tools/list` vary "by the authorization presented on the request — for example, returning only the tools the caller's granted scopes permit". That is good practice: the model sees only tools it can use. It is not access control.

- **A tool name is not a secret.** `tools/call` takes any name, including one seen in documentation, another account or an old cached list.
- **Lists are cached.** A client may keep a list for its `ttlMs`, or for the whole session, after the caller's permissions changed.
- **The specification requires the check anyway.** Servers **must** "implement proper access controls" and "validate all tool inputs".

Authorize inside every handler, against the caller and the specific object, on every call. With `createMcpHandler`, the factory receives the request's `authInfo`, so filtering the list and checking in the handler fit in one place:

```typescript
import { randomUUID } from 'node:crypto';
import { McpServer, type AuthInfo, type McpRequestContext } from '@modelcontextprotocol/server';
import * as z from 'zod/v4';

declare function mayCloseIssue(caller: AuthInfo, id: string): Promise<boolean>;
declare function closeIssue(id: string): Promise<void>;
declare function logError(ref: string, error: unknown): void; // strips credentials, writes the server log

export function buildServer({ authInfo }: McpRequestContext): McpServer {
  const server = new McpServer({ name: 'tracker', version: '1.0.0' });

  // Listing only what the caller may use keeps the model's choices relevant. It is not the access check.
  if (authInfo?.scopes.includes('issues:write')) {
    server.registerTool(
      'close-issue',
      {
        description: 'Close an issue you own.',
        inputSchema: z.object({ id: z.string() }),
        annotations: { readOnlyHint: false, destructiveHint: true, idempotentHint: true },
      },
      async ({ id }, ctx) => {
        const caller = ctx.http?.authInfo;
        try {
          if (!caller?.scopes.includes('issues:write') || !(await mayCloseIssue(caller, id))) {
            return {
              content: [{ type: 'text', text: `You cannot close ${id}: it does not exist or belongs to someone else. Do not retry; ask the owner.` }],
              isError: true,
            };
          }
          await closeIssue(id);
        } catch (error) {
          const ref = randomUUID();
          logError(ref, error); // details stay in the server log
          return {
            content: [{ type: 'text', text: `Closing ${id} failed on the server; it may have closed anyway. Check the issue before retrying, and quote reference ${ref} if it fails again.` }],
            isError: true,
          };
        }
        return { content: [{ type: 'text', text: `Closed ${id}` }] };
      }
    );
  }
  return server;
}
```

One message covers "does not exist" and "not yours", so errors do not reveal other accounts' IDs.

## FAQ

### Should I ever return a protocol error from a tool?

Rarely. The TypeScript SDK reports unknown and disabled tools that way, and `UrlElicitationRequiredError` (`-32042`) exists for the client to act on. For anything the model could fix or work around, use `isError`. See the [JSON-RPC error codes](/learn/mcp-json-rpc-error-codes) reference for the codes themselves.

### Do error results need to match the output schema?

No. Both SDKs skip `outputSchema` validation for `isError` results, so return a text explanation rather than a structured "error" object; see [output schemas](/learn/mcp-tool-output-schemas-and-structured-content).

### How do I check my errors?

Call each tool in the [playground](/) with a bad argument, a missing ID, an empty search and a revoked upstream credential, and read each response as the model would.
