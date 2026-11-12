---
title: MCP tool output schemas and structured content
navTitle: Output schemas
summary: Declare an outputSchema, return structuredContent alongside content, understand what clients validate and which JSON Schema dialect applies, avoid the common violations, and read how mcptest reports a contract break.
track: build
level: practitioner
order: 26
category: Tool contracts
readingTimeMinutes: 8
lastReviewed: "2026-11-11"
metaTitle: MCP outputSchema and structuredContent Guide | mcptest.io
metaDescription: How MCP tool output schemas work. Declare outputSchema, return structuredContent with content, JSON Schema 2020-12 defaults, 2025 versus 2026 differences, common violations, and contract checks.
relatedSlugs:
  - designing-production-mcp-server
  - build-mcp-server-with-claude-code-or-codex
  - test-mcp-server-before-deploying
  - testing-guide
sourceLinks:
  - title: "MCP 2026-07-28 specification: tools (structured content and output schema)"
    url: "https://modelcontextprotocol.io/specification/2026-07-28/server/tools"
  - title: "MCP 2025-11-25 specification: tools"
    url: "https://modelcontextprotocol.io/specification/2025-11-25/server/tools"
  - title: MCP 2026-07-28 changelog (SEP-2106 schema loosening)
    url: "https://modelcontextprotocol.io/specification/2026-07-28/changelog"
  - title: "TypeScript SDK v2: tools"
    url: "https://ts.sdk.modelcontextprotocol.io/v2/servers/tools"
  - title: "TypeScript SDK v2: calling tools and reading structured output"
    url: "https://ts.sdk.modelcontextprotocol.io/v2/clients/calling"
  - title: "Python SDK v2: structured output"
    url: "https://py.sdk.modelcontextprotocol.io/servers/structured-output/"
  - title: JSON Schema 2020-12
    url: "https://json-schema.org/draft/2020-12"
---

A tool result has two channels:

- `content` is a list of blocks, usually text, that the model reads.
- `structuredContent` is a JSON value that application code reads.

A tool's `outputSchema` is the contract for the second channel. The server publishes it in `tools/list`, before the tool is ever called. When results match it, a client can parse them without guessing. When they drift, clients that validate reject the result, often in a way that looks like the tool itself failed. For how output contracts fit into tool design generally, see [designing a production MCP server](/learn/designing-production-mcp-server).

## What the specification requires

If a tool declares an `outputSchema`, two rules apply:

- The server **must** return `structuredContent` that conforms to the schema.
- Clients **should** validate `structuredContent` against it.

For backwards compatibility, a tool that returns structured content **should** also return the same JSON serialized in a text block. Clients and models that ignore `structuredContent` still need the data.

```json
{
  "name": "get_order",
  "description": "Look up one order by id",
  "inputSchema": {
    "type": "object",
    "properties": { "id": { "type": "string" } },
    "required": ["id"],
    "additionalProperties": false
  },
  "outputSchema": {
    "type": "object",
    "properties": {
      "id": { "type": "string" },
      "total": { "type": "number" },
      "currency": { "type": "string", "enum": ["EUR", "USD"] }
    },
    "required": ["id", "total", "currency"]
  }
}
```

A matching result:

```json
{
  "content": [{ "type": "text", "text": "{\"id\":\"A-1041\",\"total\":61.5,\"currency\":\"EUR\"}" }],
  "structuredContent": { "id": "A-1041", "total": 61.5, "currency": "EUR" }
}
```

A result with `isError: true` reports a tool failure. The TypeScript SDK server, the TypeScript and Python SDK clients, and mcptest all skip output validation for error results. Report failures that way, not as data.

### What changed between 2025-11-25 and 2026-07-28

| | 2025-11-25 | 2026-07-28 |
| --- | --- | --- |
| `outputSchema` | A JSON Schema object whose root is `"type": "object"` | Any JSON Schema 2020-12 schema, including arrays and scalars at the root |
| `structuredContent` | A JSON object | Any JSON value |
| Validation guidance | Clients should validate | Clients should validate, and follow the specification's `$ref` resolution rules and bounds on composition keywords |

A server that serves both eras has to produce the object shape for 2025 clients:

- **TypeScript SDK:** handles it for you. A tool with an array output schema is advertised as-is to a 2026 client. To a 2025 client it is advertised as an object with a required `result` property, and `structuredContent` is wrapped as `{"result": [...]}`. When `structuredContent` is not an object and the handler returned no text block, the SDK also adds one with the serialized JSON, in both eras.
- **Python SDK:** always wraps scalars, lists, tuples and unions in `{"result": ...}`, for both eras.

## The JSON Schema dialect

Both `inputSchema` and `outputSchema` default to JSON Schema 2020-12 when no `$schema` is present. A schema can declare another dialect with `$schema`, for example `http://json-schema.org/draft-07/schema#`. Clients and servers must then validate it by that dialect's rules, or return an error saying the dialect is not supported.

The differences that matter in practice:

| 2020-12 | Older drafts |
| --- | --- |
| `$defs` | `definitions` |
| `prefixItems` for tuples | array-valued `items` |
| `dependentRequired`, `dependentSchemas` | `dependencies` |

A schema written for draft-07 but sent without `$schema` is read as 2020-12. That can silently change what tuple and dependency keywords mean.

Generated schemas avoid this problem. The TypeScript SDK emits `"$schema": "https://json-schema.org/draft/2020-12/schema"` from Zod. Pydantic, which the Python SDK uses, emits 2020-12 compatible schemas without a `$schema` field.

The 2026-07-28 specification adds two validator rules. Implementations must not fetch a `$ref` that points to a network URI unless the user opts in, and they should bound the cost of composition keywords such as `anyOf` and `oneOf`.

## Declaring an output schema in TypeScript

`registerTool` accepts a Zod schema for `outputSchema`. The SDK converts it to JSON Schema for `tools/list`, and validates `structuredContent` against it before the result leaves the server.

```typescript
import { McpServer } from '@modelcontextprotocol/server';
import * as z from 'zod/v4';

const Order = z.object({
  id: z.string(),
  total: z.number(),
  currency: z.enum(['EUR', 'USD']),
});

export function buildServer(): McpServer {
  const server = new McpServer({ name: 'orders', version: '1.0.0' });
  server.registerTool(
    'get-order',
    {
      description: 'Look up one order by id',
      inputSchema: z.object({ id: z.string() }),
      outputSchema: Order,
    },
    async ({ id }) => {
      const order: z.infer<typeof Order> = { id, total: 61.5, currency: 'EUR' };
      return {
        content: [{ type: 'text', text: JSON.stringify(order) }],
        structuredContent: order,
      };
    }
  );
  return server;
}
```

Typing the value with `z.infer<typeof Order>` lets the compiler catch most drift before it reaches the wire.

## Declaring an output schema in Python

In the Python SDK, the tool's return annotation is the output schema:

- A Pydantic model, `TypedDict`, dataclass or `dict[str, ...]` becomes the schema directly.
- Scalars and lists are wrapped in `{"result": ...}`.

The SDK also serializes the returned value into `content` for the model.

```python
from typing import Literal

from pydantic import BaseModel

from mcp.server import MCPServer

mcp = MCPServer("orders")


class Order(BaseModel):
    id: str
    total: float
    currency: Literal["EUR", "USD"]


@mcp.tool()
def get_order(id: str) -> Order:
    """Look up one order by id."""
    return Order(id=id, total=61.5, currency="EUR")
```

Two settings change the default:

- `@mcp.tool(structured_output=False)` makes a tool text-only.
- `@mcp.tool(structured_output=True)` turns automatic detection into a requirement. It catches the one silent failure: a return class with no annotations on its body produces no schema, and the tool returns its `repr` as text. With `structured_output=True`, that fails when the tool is registered instead.

## What clients validate

| Side | What happens on a violation |
| --- | --- |
| TypeScript SDK server | Validates against the Zod schema before sending. A mismatch, or missing `structuredContent`, becomes an `isError: true` result whose text starts with `Output validation error:` |
| Python SDK server | Validates against the return type. A mismatch becomes `isError: true` with `Error executing tool <name>`; the field-level error is in the server log |
| TypeScript SDK client | `callTool` validates `structuredContent` against the schema from the cached `tools/list` result. It throws a `ProtocolError` on a mismatch, and also when `structuredContent` is missing |
| Python SDK client | `call_tool` raises a `RuntimeError` starting with `Invalid structured content returned by tool`, or saying the tool did not return structured content |

The server-side and client-side checks do not always agree. Here is a common case in TypeScript:

1. A Zod object schema ignores unknown keys when it validates, and the SDK sends the object you returned unchanged.
2. The JSON Schema the SDK advertises for the same Zod object includes `"additionalProperties": false`.
3. So a handler that returns `{ id, total, currency, note }` passes the server's check.
4. The TypeScript client then rejects it with `Structured content does not match the tool's output schema: data must NOT have additional properties`.

Build `structuredContent` from the declared type. Do not spread an upstream response into it.

## Common violations

- **Missing `structuredContent`.** The tool declares a schema, but one code path returns only text. This is often an early return for an empty result.
- **Types that change in transit.** Decimal amounts serialized as strings, integer IDs larger than 2^53, or dates sent as numbers in one path and ISO strings in another.
- **Extra properties.** Upstream fields are spread into the result while the advertised schema forbids additional properties.
- **`null` where the schema does not allow it.** Make the field optional or nullable explicitly.
- **A non-object sent to a 2025 client.** A hand-built server that returns an array as `structuredContent` to a 2025 client breaks that revision's object requirement.
- **Errors returned as data.** A failure that returns `structuredContent: { error: "..." }` without `isError: true` breaks the schema. Return `isError: true` with a text explanation instead.
- **Schema drift between deploys.** The schema changes between deploys, and a client that cached the old `tools/list` validates against the wrong contract. See [which tool changes break clients](/learn/which-mcp-tool-changes-break-clients#changing-the-output-contract).

## How mcptest reports a contract break

The playground checks every tool you call against its declared `outputSchema`. The check runs separately from the SDK: the playground stops the SDK client from throwing on a mismatch, so it can show the result together with every violation, not just the first error.

Each violation names the location in the result and the problem in plain language:

| Path | Message |
| --- | --- |
| `structuredContent.total` | Expected number but got string. |
| `structuredContent.currency` | Required property "currency" is missing. |
| `structuredContent.note` | Property "note" is not allowed by the schema. |
| `structuredContent` | The tool declares an outputSchema but returned no structuredContent. |

The result view shows one of these verdicts:

- "Output contract broken", with the number of problems;
- "Structured output matches the declared output schema" when the result validates;
- "Not validated" for error results.

A tool without a schema shows its structured output with no verdict.

The validator honors the declared dialect. No `$schema` means 2020-12. Schemas that declare draft-04, draft-06, draft-07 or 2019-09 are evaluated with that draft's keywords only. The validator interprets schemas directly instead of generating code, so it runs under a strict content security policy.

### In reports

When you generate a report after calling tools, the MCP Capabilities section records how many checked tools honored their contract. Any violation adds the release priority `tool.output-contract-violation` at high severity, which makes the release decision `blocked`.

- The headless CLI does not call tools, so output contracts appear only in reports generated after playground calls.
- Deterministic test runs in the playground record the same verdict, so a saved test suite that calls every tool covers every contract.

## Check your output schemas in the playground

1. Open your endpoint in the playground: `https://mcptest.io/server/` followed by the endpoint URL without `https://`. For `https://mcp.example.com/mcp`, that is [mcptest.io/server/mcp.example.com/mcp](/server/mcp.example.com/mcp).
2. Call each tool with representative input, including the empty and error paths.
3. Generate the report. Any tool with a contract violation is listed with the exact path and message to fix.
