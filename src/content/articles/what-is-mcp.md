---
title: What is the Model Context Protocol?
navTitle: What is MCP?
summary: A developer introduction to MCP roles, tools, resources, prompts, transports, and the two protocol lifecycle eras.
track: understand
level: newcomer
order: 1
category: Protocol fundamentals
readingTimeMinutes: 6
lastReviewed: "2026-08-09"
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

The Model Context Protocol (MCP) is an open protocol for connecting AI applications to tools and context. A service describes its capabilities once through a standard JSON-RPC interface; MCP clients can then discover and use them without a bespoke integration for every client-server pair.

MCP was introduced by Anthropic in November 2024 and is now an openly governed Linux Foundation project. It defines three roles: the **host** is the AI application a person uses, a **client** speaks MCP on the host's behalf, and a **server** provides capabilities backed by a database, SaaS API, local system, or business process. Clients and servers exchange [JSON-RPC 2.0](https://www.jsonrpc.org/specification) messages over a transport such as local stdio or remote Streamable HTTP.

## What a server exposes

**Tools** are functions an AI model can invoke: search a database, create a ticket, or send a message. Each tool has a name, description, JSON Schema input, and optional structured output schema. Clients use `tools/list` and `tools/call` to discover and invoke them.

**Resources** are data addressed by URIs. They may be listed with `resources/list`, parameterized through URI templates, and read with `resources/read`. **Prompts** are reusable message templates, discovered with `prompts/list` and rendered with `prompts/get`.

The 2026 protocol also supports in-band multi-round-trip requests. A tool, resource, or prompt operation can return `resultType: "input_required"`; the client obtains the requested user or model input and retries the original call with `inputResponses`. This replaces the held-open server-to-client requests used by older sampling, elicitation, and roots flows. Roots, sampling, and logging are deprecated in the 2026 core, although compatibility implementations may continue to serve them.

## Two protocol eras

MCP now has two lifecycle families. A production client should understand both because many deployed servers still implement a 2025 revision.

| Behavior | 2026-07-28 stateless | 2025 and earlier stateful |
| --- | --- | --- |
| Start | Optional client probe to required server method `server/discover` | `initialize`, then `notifications/initialized` |
| Request context | Protocol version and client capabilities in every request's `_meta` | Negotiated once during initialization |
| Transport session | None; `Mcp-Session-Id` was removed | Optional server-issued `Mcp-Session-Id` |
| Server changes | `subscriptions/listen` | Standalone GET SSE stream and notifications |

### Stateless requests in 2026

There is no `initialize` handshake in `2026-07-28`. Every request is self-describing. The protocol version and client capabilities are required in `params._meta`, while client identity is recommended. On Streamable HTTP, the body metadata is mirrored by routing headers so a gateway can classify a request without parsing JSON:

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

`Mcp-Method` is required on every HTTP request. `Mcp-Name` is also required for `tools/call`, `resources/read`, and `prompts/get`. The `MCP-Protocol-Version` header must match the version in `_meta`. With no hidden transport session, requests can reach any healthy instance behind a normal load balancer. Applications can still keep business state by returning an explicit handle and accepting it as a later tool argument.

### Stateful compatibility through 2025

Revisions through `2025-11-25` begin with `initialize`. The client and server negotiate one version and capability set, the client sends `notifications/initialized`, and a stateful server may issue an opaque `Mcp-Session-Id` that the client must return on later requests. This remains a valid and important compatibility path; it is not how a 2026-only request should be served.

mcptest.io uses automatic SDK negotiation. It probes with `server/discover` and adopts stateless behavior when the server offers `2026-07-28`. A 2025-only response falls back to the byte-compatible initialization flow. Authentication failures remain authentication failures rather than being mistaken for lifecycle evidence.

## Protocol versions

| Version | Important changes |
| --- | --- |
| `2024-11-05` | First stable release; stdio and the original two-endpoint HTTP+SSE transport. |
| `2025-03-26` | Introduced Streamable HTTP and the OAuth-based authorization framework. |
| `2025-06-18` | OAuth 2.1 resource-server model, structured tool output, elicitation, protocol-version header, and no JSON-RPC batching. |
| `2025-11-25` | OIDC discovery, Client ID Metadata Documents, URL elicitation, icons, experimental tasks, and SSE polling refinements. |
| `2026-07-28` | Current version: stateless core, discovery, header routing, cacheable lists, multi-round-trip input, subscriptions, extensions, and authorization hardening. |

## Where to go next

Read [Remote vs. Local MCP Servers](/docs/remote-vs-local) for the transport mechanics, then use the [testing guide](/docs/testing-guide) to verify both lifecycle eras. The [troubleshooting guide](/docs/troubleshooting) maps common CORS, session, routing-header, streaming, and authorization failures to fixes.

The authoritative references are the [2026-07-28 specification](https://modelcontextprotocol.io/specification/2026-07-28), the official [release overview](https://blog.modelcontextprotocol.io/posts/2026-07-28/), and the TypeScript SDK's [dual-era negotiation guide](https://github.com/modelcontextprotocol/typescript-sdk/blob/main/docs/protocol-versions.md).
