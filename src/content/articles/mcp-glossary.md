---
title: MCP glossary
summary: "Forty Model Context Protocol terms in alphabetical order, from API key to transport, each defined in one or two sentences and linked by anchor."
track: understand
level: newcomer
order: 24
category: Reference
readingTimeMinutes: 7
lastReviewed: "2026-10-20"
metaTitle: "MCP Glossary: 40 Model Context Protocol Terms | mcptest.io"
metaDescription: "Short definitions of 40 MCP terms: host, client, server, tools, transports, Streamable HTTP, sessions, OAuth 2.1, PKCE, CORS, elicitation, sampling and more."
relatedSlugs:
  - what-is-mcp
  - mcp-explained-for-everyone
  - oauth-for-mcp-explained
  - remote-vs-local
  - troubleshooting
sourceLinks:
  - title: "MCP specification 2026-07-28"
    url: "https://modelcontextprotocol.io/specification/2026-07-28"
  - title: "MCP specification 2026-07-28: Key changes"
    url: "https://modelcontextprotocol.io/specification/2026-07-28/changelog"
  - title: "MCP specification: Streamable HTTP transport"
    url: "https://modelcontextprotocol.io/specification/2026-07-28/basic/transports/streamable-http"
  - title: "MCP specification: Authorization"
    url: "https://modelcontextprotocol.io/specification/2026-07-28/basic/authorization"
  - title: "MCP specification: Tools"
    url: "https://modelcontextprotocol.io/specification/2026-07-28/server/tools"
  - title: "MCP specification: Deprecated features"
    url: "https://modelcontextprotocol.io/specification/2026-07-28/deprecated"
  - title: "MCP Registry preview announcement"
    url: "https://blog.modelcontextprotocol.io/posts/2025-09-08-mcp-registry-preview/"
  - title: "MCP conformance test framework"
    url: "https://github.com/modelcontextprotocol/conformance"
  - title: "MDN: Cross-Origin Resource Sharing (CORS)"
    url: "https://developer.mozilla.org/en-US/docs/Web/HTTP/Guides/CORS"
  - title: "RFC 9728: OAuth 2.0 Protected Resource Metadata"
    url: "https://datatracker.ietf.org/doc/html/rfc9728"
  - title: "RFC 8707: Resource Indicators for OAuth 2.0"
    url: "https://datatracker.ietf.org/doc/html/rfc8707"
  - title: "RFC 7636: Proof Key for Code Exchange (PKCE)"
    url: "https://datatracker.ietf.org/doc/html/rfc7636"
---

Definitions follow the current MCP specification, revision 2026-07-28. Where a term belongs only to older revisions, the entry says so, because many servers in production still use them. For a narrative introduction, start with [What is MCP?](/learn/mcp-explained-for-everyone).

## Terms A to F

### API key

A secret string that identifies the caller to a service, usually sent in a request header. Some MCP servers accept an API key instead of OAuth; it is simpler but is not tied to a particular user's consent or scopes.

### Bearer token

An access token sent in the `Authorization: Bearer <token>` header. Whoever holds it can use it, so it must be kept out of logs, URLs and shared links.

### Cancellation

Stopping a request that is still running. Over Streamable HTTP, closing the request's response stream is the cancellation signal; over stdio, the client sends a `notifications/cancelled` message with the request ID.

### Capabilities

The optional features each side declares it supports, such as `tools`, `resources` or `prompts` on a server. In the current revision a client sends its capabilities with every request, and a server advertises its own through `server/discover`.

### Catalog

A curated list of servers that people can browse and connect to. The [mcptest.io catalog](/catalog) lists public remote servers with their publisher, sign-in method and latest validation result.

### Client

The component inside a host application that holds one connection to one MCP server. A host connected to three servers runs three clients.

### Conformance

Whether an implementation behaves as the specification requires. The MCP project maintains a conformance test framework that checks clients and servers against the specification.

### CORS

Cross-Origin Resource Sharing, the browser rule that decides whether a web page may read a response from another domain. A remote MCP server must send the right CORS headers before a browser-based client can call it directly instead of through a proxy.

### Drift

A change in a server's behaviour or definitions between two points in time, such as a renamed tool, a new required argument or a different authentication requirement. Drift can break clients silently, which is why reports are worth comparing over time.

### Dynamic client registration

An OAuth mechanism (RFC 7591) that lets a client register itself with an authorization server automatically. The 2026-07-28 revision deprecates it in favour of Client ID Metadata Documents, but keeps it for compatibility.

### Elicitation

A way for a server to ask the user for information in the middle of an operation, through a form or by sending them to a URL. In the current revision it is carried inside an `input_required` result rather than as a separate server-to-client request.

## Terms H to O

### Host

The application a person uses, such as a chat app, a code editor or an agent framework. The host runs the clients, passes tool definitions to the model and decides what needs user approval.

### Initialize

The handshake that opened every connection in revisions up to 2025-11-25: the client sent `initialize`, the server replied with its capabilities, and the client confirmed with `notifications/initialized`. The 2026-07-28 revision removes it.

### JSON-RPC

The message format MCP uses: small JSON objects with a `method`, `params` and an `id`, answered by a `result` or an `error`. It is version 2.0 of a long-standing remote procedure call convention.

### Logging

Log messages a server sends to the client with `notifications/message`. The current revision deprecates protocol-level logging and recommends standard error output or OpenTelemetry instead.

### MCP-Protocol-Version

The HTTP header that states which protocol revision a request uses, for example `MCP-Protocol-Version: 2026-07-28`. It is required on every Streamable HTTP request since revision 2025-06-18.

### Mcp-Session-Id

The HTTP header a server used to assign a session in Streamable HTTP revisions 2025-03-26 to 2025-11-25. The 2026-07-28 revision removes protocol-level sessions, so current servers do not issue it.

### Notifications

One-way JSON-RPC messages that expect no reply, such as progress updates or a notice that the tool list changed. In the current revision, change notifications arrive on a stream the client opens with `subscriptions/listen`.

### OAuth 2.1

The authorization framework MCP uses for remote servers. The user signs in at an authorization server, approves the requested access, and the client receives a short-lived access token for one specific MCP server.

### Output schema

An optional JSON Schema on a tool that describes the shape of its structured result. If a tool declares one, the server must return structured content that matches it, and clients should validate it.

## Terms P to R

### PKCE

Proof Key for Code Exchange (RFC 7636), pronounced "pixie". The client creates a one-time secret before sign-in and proves it holds that secret when exchanging the authorization code, so an intercepted code is useless to anyone else.

### Preflight

The `OPTIONS` request a browser sends before a cross-origin request that uses custom headers or methods. If the server does not answer it with the right CORS headers, the browser blocks the real request.

### Progress

Notifications a server sends while a long request runs, carrying how much work is done and an optional message. Clients can use them to show a progress bar or to extend a timeout.

### Prompt

A reusable message template a server offers, often with arguments, that a user can pick in the host. Prompts are listed with `prompts/list` and filled in with `prompts/get`.

### Protected resource metadata

A JSON document (RFC 9728) that an MCP server publishes to say which authorization servers issue tokens for it and which scopes it supports. A client fetches it after a `401` response to start the sign-in flow.

### Registry

A public index of MCP servers with machine-readable metadata. The official MCP Registry, launched in preview in September 2025, holds publisher-maintained entries that other directories and clients can build on.

### Resource

Data a server makes readable by URI, such as a file, a database record or a document. Resources are listed with `resources/list` and fetched with `resources/read`; the host or user usually decides which to include.

### Resource indicator

The `resource` parameter (RFC 8707) a client includes when requesting a token, naming the exact MCP server the token is for. It stops a token issued for one server from being accepted by another.

### Roots

Directories or files a client tells a server it may work within, such as a project folder. The 2026-07-28 revision deprecates roots and suggests passing locations through tool arguments or configuration instead.

## Terms S to T

### Sampling

A feature that lets a server ask the client's model to generate text, so the server can use AI without its own model access. It is deprecated in the 2026-07-28 revision in favour of servers calling a model provider directly.

### Scope

A named permission in an OAuth token, such as `issues:read`. Servers should ask for the narrowest scopes they need and request more only when an action requires them.

### Server

A program that offers tools, resources or prompts to MCP clients. It can run locally on the user's machine or remotely at a web address.

### Session

A connection-scoped context that older revisions kept between requests, identified over HTTP by `Mcp-Session-Id`. Current MCP has no protocol-level sessions; servers that need state across calls return an explicit handle as a tool result.

### SSE

Server-Sent Events, a web standard for streaming messages from server to client over one HTTP response. Streamable HTTP can answer a request with an SSE stream; the older HTTP+SSE transport, now deprecated, used a separate long-lived SSE connection.

### Stateless

Describes a protocol in which each request carries everything needed to process it. Since revision 2026-07-28, MCP requests include their protocol version and client capabilities, so any server instance can answer any request.

### Stdio

The local transport: the host starts the server as a child process and exchanges messages over its standard input and output. It works only on the same machine.

### Streamable HTTP

The remote transport: the client sends each message as an HTTP POST to one endpoint, and the server replies with JSON or an SSE stream. It replaced the original HTTP+SSE transport in revision 2025-03-26.

### Structured content

A tool result's `structuredContent` field, which carries machine-readable JSON alongside the human-readable `content`. It lets clients and code use results without parsing text.

### Tool

A named action a server offers, with a description and a JSON Schema for its inputs. The model decides when to call a tool with `tools/call`, and the host can require user approval first.

### Transport

The channel that carries MCP messages between client and server. The current specification defines stdio for local servers and Streamable HTTP for remote ones; see [remote vs local MCP servers](/docs/remote-vs-local).

## Look up a term in a live server

Most of these terms show up in a real connection's raw log. [Open Context7 in the mcptest.io playground](/server/mcp.context7.com/mcp/mcp) to see capabilities, the protocol version header, tool schemas and structured results in the JSON-RPC exchange as they happen.
