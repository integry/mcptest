---
title: "MCP tool annotations: readOnlyHint, idempotentHint, and how clients use them"
navTitle: Tool annotations
summary: What readOnlyHint, destructiveHint, idempotentHint, openWorldHint and title mean in the MCP specification, their defaults, how Claude, Claude Code, ChatGPT, Codex and VS Code use them for confirmation, parallel calls and retries, and how to test that a tool's hints are true.
track: build
level: practitioner
order: 29
category: Tool contracts
readingTimeMinutes: 7
lastReviewed: "2026-11-11"
metaTitle: "MCP Tool Annotations: readOnlyHint, idempotentHint, Retries | mcptest.io"
metaDescription: "MCP tool annotations explained: readOnlyHint, destructiveHint, idempotentHint, openWorldHint and title, their spec defaults, how clients use them for approval, parallel calls and retries, and how to test them."
relatedSlugs:
  - which-mcp-tool-changes-break-clients
  - designing-production-mcp-server
  - mcp-tool-errors-agents-can-act-on
  - mcp-long-running-tools
sourceLinks:
  - title: "MCP 2026-07-28 specification: tools"
    url: "https://modelcontextprotocol.io/specification/2026-07-28/server/tools"
  - title: "MCP 2026-07-28 schema reference: ToolAnnotations"
    url: "https://modelcontextprotocol.io/specification/2026-07-28/schema#toolannotations"
  - title: "Claude Code: Mark tools that are safe to call twice"
    url: "https://code.claude.com/docs/en/mcp#mark-tools-that-are-safe-to-call-twice"
  - title: "Claude connectors: review criteria"
    url: "https://claude.com/docs/connectors/building/review-criteria"
  - title: "OpenAI plugins reference: tool annotations"
    url: "https://developers.openai.com/plugins/reference"
  - title: "OpenAI plugin guidelines"
    url: "https://developers.openai.com/plugins/plugin-guidelines"
  - title: "Codex: Model Context Protocol"
    url: "https://learn.chatgpt.com/docs/extend/mcp"
  - title: "VS Code: MCP developer guide"
    url: "https://code.visualstudio.com/api/extension-guides/ai/mcp"
  - title: "TypeScript SDK v2: tools"
    url: "https://ts.sdk.modelcontextprotocol.io/v2/servers/tools"
---

Every tool in a `tools/list` result can carry an `annotations` object: four booleans and a title that describe what the tool does to the world. Clients use them to decide whether to ask the user first, whether to run calls side by side, and whether a call that was cut off may be sent again. Wrong hints never fail validation. They make a client skip a confirmation it should have shown, or refuse to retry a call that was safe to repeat.

## What the specification defines

The [2026-07-28 schema](https://modelcontextprotocol.io/specification/2026-07-28/schema#toolannotations) defines `ToolAnnotations` with five optional properties. The 2025-11-25 revision defines the same five.

| Property | Meaning when `true` | Default when omitted |
| --- | --- | --- |
| `readOnlyHint` | The tool does not modify its environment | `false` |
| `destructiveHint` | The tool may perform destructive updates; `false` means it only adds | `true` |
| `idempotentHint` | Repeating the call with the same arguments has no additional effect | `false` |
| `openWorldHint` | The tool may interact with an open world of external entities, such as a web search; `false` means a closed domain, such as a memory store | `true` |
| `title` | A human-readable name for the tool | none |

`destructiveHint` and `idempotentHint` are only meaningful when `readOnlyHint` is `false`. The defaults are the cautious reading: a tool with no annotations is treated as one that writes, may destroy data, is not safe to repeat and reaches outside systems.

The `Tool` object also has a top-level `title`; the schema's display-name order is `title`, then `annotations.title`, then `name`.

Annotations are "not guaranteed to provide a faithful description of tool behavior", and the [tools page](https://modelcontextprotocol.io/specification/2026-07-28/server/tools) says clients **must** consider them untrusted unless they come from trusted servers. They shape how a client presents a call. They never replace authorization on the server.

## How clients use them

What each client does with the hints is up to that client. These are the behaviors their vendors document:

| Client | Documented use |
| --- | --- |
| Claude Code | When `idempotentHint` or `readOnlyHint` is `true`, repeats a call to an HTTP server or claude.ai connector that was pending when the connection closed, once, on a new connection. Runs read-only calls in parallel with each other ([Claude Code docs](https://code.claude.com/docs/en/mcp#mark-tools-that-are-safe-to-call-twice)) |
| Claude connectors directory | "Every tool must include a `title` and the applicable hint". The hints "determine auto-permissions in Claude. Read-only tools can run without per-call confirmation, and destructive tools always prompt" ([review criteria](https://claude.com/docs/connectors/building/review-criteria)) |
| ChatGPT and Codex plugins | `readOnlyHint`, `destructiveHint` and `openWorldHint` are required, and `idempotentHint` is optional. The hints "only influence how ChatGPT or Codex frames the tool call to the user" ([plugins reference](https://developers.openai.com/plugins/reference)). Submissions must set the three required hints to explicit booleans ([plugin guidelines](https://developers.openai.com/plugins/plugin-guidelines)) |
| Codex | The `writes` approval mode "prompts for tools that aren't marked read-only" ([Codex MCP docs](https://learn.chatgpt.com/docs/extend/mcp)) |
| VS Code | In Local harness sessions, `readOnlyHint` affects the default confirmation before a call and `openWorldHint` affects confirmation of results. The guide also says not to assume "that readOnlyHint bypasses approval" ([VS Code MCP guide](https://code.visualstudio.com/api/extension-guides/ai/mcp)) |

So a read-only tool that omits `readOnlyHint` can cost you in the clients that read it. In Claude, and in Codex's `writes` mode, it is prompted for like a write tool; in VS Code it may get the default confirmation, subject to the user's approval settings. Claude Code does not run it in parallel with read-only calls, and retries it after a dropped connection only if it sets `idempotentHint: true`; with neither hint true, there is no retry. A tool that claims `readOnlyHint: true` but writes can skip, in those same clients, the confirmation a write should have had, and Claude Code may run it twice.

## Choosing the hints for a tool

Answer these in order and set every hint explicitly, even when the answer matches the default; OpenAI's review requires explicit values.

1. **Does any call change state that someone else can observe?** Rows written, messages sent, jobs started and quota counters all count; an internal cache or audit log does not. If no input changes anything, set `readOnlyHint: true`.
2. **Can a call remove or overwrite something that existed before?** Delete, replace, overwrite, revoke, cancel and close are destructive. Create and append are not. Set `destructiveHint` accordingly.
3. **If the same call arrives twice, is the result the same as if it arrived once?** "Set status to closed" is idempotent. "Add a comment" and "charge the card" are not, unless the tool takes an idempotency key and returns the stored result for a repeat. Set `idempotentHint: true` only when the second call is truly a no-op.
4. **Does the tool reach an open set of external entities?** A web search is open-world. A lookup in the user's own CRM account is not; OpenAI notes a bounded private account "isn't open-world solely because it is externally hosted."

Some combinations to check against:

| Tool | `readOnlyHint` | `destructiveHint` | `idempotentHint` | `openWorldHint` |
| --- | --- | --- | --- | --- |
| `get_invoice` | `true` | — | — | `false` |
| `search_web` | `true` | — | — | `true` |
| `create_comment` | `false` | `false` | `false` | `false` |
| `set_issue_status` | `false` | `true` | `true` | `false` |
| `delete_file` | `false` | `true` | `true` | `false` |
| `send_email` | `false` | `false` | `false` | `true` |

`set_issue_status` and `delete_file` are destructive and idempotent at once: a retry is safe, but a confirmation is still appropriate.

If behavior depends on arguments, such as `update_record` with an optional `delete: true`, the hints must describe the worst case. Splitting the tool lets the safe half carry honest hints.

## Declaring them in the SDKs

In the TypeScript SDK v2, `registerTool` takes `title` and `annotations` in the tool config:

```typescript
import { McpServer } from '@modelcontextprotocol/server';
import * as z from 'zod/v4';

type Invoice = { id: string; status: 'draft' | 'sent' | 'void' };
const invoices = new Map<string, Invoice>([['inv_1', { id: 'inv_1', status: 'draft' }]]);

export function buildServer(): McpServer {
  const server = new McpServer({ name: 'billing', version: '1.0.0' });

  server.registerTool(
    'get-invoice',
    {
      title: 'Get invoice',
      description: 'Read one invoice by id. Changes nothing.',
      inputSchema: z.object({ id: z.string() }),
      annotations: { readOnlyHint: true, openWorldHint: false },
    },
    async ({ id }) => {
      const invoice = invoices.get(id);
      if (!invoice) return { content: [{ type: 'text', text: `No invoice ${id}` }], isError: true };
      return { content: [{ type: 'text', text: JSON.stringify(invoice) }] };
    }
  );

  server.registerTool(
    'void-invoice',
    {
      title: 'Void invoice',
      description: 'Mark an invoice as void. Voiding an already void invoice changes nothing.',
      inputSchema: z.object({ id: z.string() }),
      annotations: { readOnlyHint: false, destructiveHint: true, idempotentHint: true, openWorldHint: false },
    },
    async ({ id }) => {
      const invoice = invoices.get(id);
      if (!invoice) return { content: [{ type: 'text', text: `No invoice ${id}` }], isError: true };
      invoice.status = 'void';
      return { content: [{ type: 'text', text: `Invoice ${id} is void` }] };
    }
  );

  return server;
}
```

In the Python SDK, pass the same values to the decorator: `@mcp.tool(title="Void invoice", annotations=ToolAnnotations(readOnlyHint=False, destructiveHint=True, idempotentHint=True, openWorldHint=False))`, with `ToolAnnotations` imported from `mcp.types`.

## Testing that the hints are true

Annotations are a claim about behavior, so test the behavior:

- **Read-only:** snapshot every store the tool could touch, call it with representative arguments, including error paths, and compare.
- **Idempotent:** call once and snapshot, call again with identical arguments and snapshot again. The snapshots must match, and the second call must not fail: a retry that returns `isError` with "already void" makes the agent treat a success as a failure.

This test drives the server above through a real client in-process, as the [TypeScript SDK testing guide](https://ts.sdk.modelcontextprotocol.io/v2/testing) shows:

```typescript
import assert from 'node:assert/strict';
import { Client, StreamableHTTPClientTransport } from '@modelcontextprotocol/client';
import { createMcpHandler } from '@modelcontextprotocol/server';

const snapshot = () => JSON.stringify([...invoices.entries()]);
const handler = createMcpHandler(buildServer);
const client = new Client({ name: 'annotation-check', version: '1.0.0' }, { versionNegotiation: { mode: 'auto' } });
await client.connect(
  new StreamableHTTPClientTransport(new URL('http://test.local/mcp'), {
    fetch: (url, init) => handler.fetch(new Request(url, init)),
  })
);

// Read-only: state is exactly as it was.
const before = snapshot();
await client.callTool({ name: 'get-invoice', arguments: { id: 'inv_1' } });
assert.equal(snapshot(), before, 'get-invoice changed state');

// Idempotent: the second identical call has no additional effect and does not fail.
await client.callTool({ name: 'void-invoice', arguments: { id: 'inv_1' } });
const afterFirst = snapshot();
const second = await client.callTool({ name: 'void-invoice', arguments: { id: 'inv_1' } });
assert.equal(snapshot(), afterFirst, 'second call changed state again');
assert.notEqual(second.isError, true, 'the retry reported a failure');
```

Against a real backend, replace `snapshot` with queries of the records the tool can touch in a staging account. Also test the case the hint exists for: drop the connection after the server commits but before the response arrives, then repeat the call.

Treat a later change to the hints as a contract change. Dropping `readOnlyHint` or adding `destructiveHint: true` can move a tool from auto-approved to prompted, which the [breaking-change guide](/learn/which-mcp-tool-changes-break-clients#changing-annotations) classifies as risky. The [breaking-change check](/tools/breaking-changes) flags annotation changes between two `tools/list` results, so run it before each deploy.

## FAQ

### Do annotations change what the server is allowed to do?

No. They are hints for the client, and the server must still authorize every call. See [errors agents can act on](/learn/mcp-tool-errors-agents-can-act-on) for why hiding a tool is not authorization either.

### Should a read-only tool also set idempotentHint?

There is no need. The schema says `idempotentHint` is only meaningful when `readOnlyHint` is `false`, and Claude Code already treats either hint as safe to repeat.

### What happens if I omit annotations entirely?

Clients apply the defaults: not read-only, destructive, not idempotent, open world. The Claude connectors directory requires a title and the applicable hint on every tool, and OpenAI's plugin review requires explicit values for `readOnlyHint`, `destructiveHint` and `openWorldHint`.
