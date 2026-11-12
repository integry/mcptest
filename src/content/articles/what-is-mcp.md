---
title: What is the Model Context Protocol?
navTitle: What is MCP?
summary: A developer introduction to MCP roles, tools, resources, prompts, transports, and the two protocol lifecycle eras.
track: understand
level: newcomer
order: 1
category: Protocol fundamentals
readingTimeMinutes: 6
lastReviewed: "2026-11-11"
path: /docs/what-is-mcp
metaTitle: What Is the Model Context Protocol? | mcptest.io
metaDescription: Understand MCP tools, resources, prompts, transports, and protocol lifecycles. A developer introduction to local and remote Model Context Protocol servers.
relatedSlugs:
  - remote-vs-local
  - testing-guide
sourceLinks:
  - title: MCP 2026-07-28 specification
    url: "https://modelcontextprotocol.io/specification/2026-07-28"
  - title: MCP 2026-07-28 release overview
    url: "https://blog.modelcontextprotocol.io/posts/2026-07-28/"
  - title: "TypeScript SDK: protocol versions and dual-era negotiation"
    url: "https://github.com/modelcontextprotocol/typescript-sdk/blob/main/docs/protocol-versions.md"
  - title: JSON-RPC 2.0 specification
    url: "https://www.jsonrpc.org/specification"
---

The Model Context Protocol (MCP) is an open protocol for connecting AI applications to tools and data. A service describes its capabilities once, through a standard JSON-RPC interface. Any MCP client can then discover and use them, with no custom integration for each client-server pair.

Anthropic introduced MCP in November 2024. Since December 2025 it has been part of the Agentic AI Foundation, a directed fund under the Linux Foundation; see the [MCP timeline](/learn/mcp-protocol-timeline).

MCP defines three roles:

- The **host** is the AI application a person uses, such as Claude, ChatGPT or an IDE.
- A **client** runs inside the host and speaks MCP to one server on the host's behalf.
- A **server** exposes capabilities backed by a database, SaaS API, local system or business process.

Clients and servers exchange [JSON-RPC 2.0](https://www.jsonrpc.org/specification) messages over a transport: stdio for a local process, or Streamable HTTP for a remote server. The [glossary](/learn/mcp-glossary) defines these and other terms.

## What a server exposes

A server can expose three kinds of capability.

- **Tools** are functions the AI model can call: search a database, create a ticket, send a message. Each tool has a name, a description, a JSON Schema for its input and, optionally, a schema for structured output. Clients list them with `tools/list` and call them with `tools/call`.
- **Resources** are data addressed by URIs. Clients list them with `resources/list`, list URI templates with `resources/templates/list`, and read them with `resources/read`.
- **Prompts** are reusable message templates. Clients list them with `prompts/list` and fill one in with `prompts/get`.

In `2026-07-28`, a server that needs more input mid-request uses a multi round-trip request. A `tools/call`, `resources/read` or `prompts/get` returns `resultType: "input_required"` with the questions it needs answered. The client collects the answers from the user or model and retries the original request with `inputResponses`. This replaces the server-to-client requests that 2025 revisions used for sampling, elicitation and roots. Roots, Sampling and Logging are deprecated in `2026-07-28`; they still work during the deprecation window, but new implementations should not add them.

## Two protocol eras

MCP now has two lifecycle families. A production client needs both, because many deployed servers still implement a 2025 revision.

| Behavior | 2026-07-28 stateless | 2025 and earlier stateful |
| --- | --- | --- |
| Start | Optional client probe to required server method `server/discover` | `initialize`, then `notifications/initialized` |
| Request context | Protocol version and client capabilities in every request's `_meta` | Negotiated once during initialization |
| Transport session | None; `Mcp-Session-Id` was removed | Optional server-issued `Mcp-Session-Id` |
| Server changes | `subscriptions/listen` | Standalone GET SSE stream and notifications |

### Stateless requests in 2026

There is no `initialize` handshake in `2026-07-28`. Every request describes itself: the protocol version and client capabilities are required in `params._meta`, and clients SHOULD also send their name and version (`clientInfo`). On Streamable HTTP, headers repeat the method and name from the body, so a gateway can route a request without parsing JSON:

```http
POST /mcp
MCP-Protocol-Version: 2026-07-28
Mcp-Method: tools/call
Mcp-Name: search

{
  "jsonrpc": "2.0",
  "id": 1,
  "method": "tools/call",
  "params": {
    "name": "search",
    "arguments": { "query": "stateless MCP" },
    "_meta": {
      "io.modelcontextprotocol/protocolVersion": "2026-07-28",
      "io.modelcontextprotocol/clientInfo": {
        "name": "mcptest.io",
        "version": "2.0.0"
      },
      "io.modelcontextprotocol/clientCapabilities": {}
    }
  }
}
```

- `Mcp-Method` is required on every POST. In `2026-07-28` every request is a POST.
- `Mcp-Name` is also required on `tools/call`, `resources/read` and `prompts/get`. It carries the tool or prompt name, or the resource URI.
- `MCP-Protocol-Version` must match the version in `_meta`.

With no transport session, any healthy instance behind an ordinary load balancer can serve any request. A server that needs state across calls, such as a cart, returns an explicit handle from one tool and accepts it as an argument to the next. The [HTTP headers reference](/learn/mcp-http-headers-reference) covers each header.

### Stateful compatibility through 2025

Revisions through `2025-11-25` begin with `initialize`. The client and server agree on one version and capability set, then the client sends `notifications/initialized`. Over HTTP, the server may issue an opaque `Mcp-Session-Id` that the client returns on every later request. Many servers still work this way, so clients keep supporting it.

mcptest.io uses the TypeScript SDK's automatic negotiation. It first sends `server/discover`. If the server offers `2026-07-28`, mcptest uses stateless requests; if the server only speaks a 2025 revision, it falls back to `initialize`. A `401` or `403` is reported as an authorization problem, not taken as a sign of the server's protocol era. [MCP protocol versions explained](/learn/mcp-protocol-versions-explained) has the full rules.

## Protocol versions

| Version | Important changes |
| --- | --- |
| `2024-11-05` | First published revision: stdio and the original two-endpoint HTTP+SSE transport. |
| `2025-03-26` | Streamable HTTP and an authorization framework based on OAuth 2.1. |
| `2025-06-18` | Servers become OAuth resource servers; structured tool output, elicitation, the `MCP-Protocol-Version` header; JSON-RPC batching removed. |
| `2025-11-25` | OIDC discovery, Client ID Metadata Documents, URL-mode elicitation, icons, experimental tasks, server-closed SSE streams with polling. |
| `2026-07-28` | Current: no handshake or sessions, `server/discover`, `Mcp-Method`/`Mcp-Name` headers, cache hints on list and read results, multi round-trip requests, `subscriptions/listen`, extensions, tighter authorization. |

## Where to go next

- [Remote vs. local MCP servers](/docs/remote-vs-local) explains the transports.
- The [testing guide](/docs/testing-guide) shows how to test both lifecycle eras.
- The [troubleshooting guide](/docs/troubleshooting) maps CORS, session, header, streaming and authorization failures to fixes.

The authoritative references are the [2026-07-28 specification](https://modelcontextprotocol.io/specification/2026-07-28), the official [release overview](https://blog.modelcontextprotocol.io/posts/2026-07-28/), and the TypeScript SDK's [dual-era negotiation guide](https://github.com/modelcontextprotocol/typescript-sdk/blob/main/docs/protocol-versions.md).
