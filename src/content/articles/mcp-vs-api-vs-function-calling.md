---
title: MCP vs API vs function calling
summary: "How MCP relates to ordinary APIs and to model function calling, with a comparison table and guidance on when each one is the right layer."
track: understand
level: practitioner
order: 23
category: Strategy
readingTimeMinutes: 5
lastReviewed: "2026-10-20"
metaTitle: "MCP vs API vs Function Calling: When to Use Each | mcptest.io"
metaDescription: "MCP does not replace APIs. Compare REST APIs, model function calling and the Model Context Protocol, and see where each fits in an AI integration."
relatedSlugs:
  - should-you-build-mcp-server
  - what-is-mcp
  - designing-production-mcp-server
  - mcp-clients-compared
  - mcp-glossary
sourceLinks:
  - title: "MCP specification 2026-07-28"
    url: "https://modelcontextprotocol.io/specification/2026-07-28"
  - title: "MCP specification: Tools"
    url: "https://modelcontextprotocol.io/specification/2026-07-28/server/tools"
  - title: "MCP architecture overview"
    url: "https://modelcontextprotocol.io/docs/2026-07-28/learn/architecture"
  - title: "OpenAI API: Function calling"
    url: "https://developers.openai.com/api/docs/guides/function-calling"
  - title: "Claude API: Tool use overview"
    url: "https://platform.claude.com/docs/en/agents-and-tools/tool-use/overview"
  - title: "Claude API: MCP connector"
    url: "https://platform.claude.com/docs/en/agents-and-tools/mcp-connector"
---

The three terms describe different layers, and most real integrations use all of them. An **API** is how software exposes a service. **Function calling** is how a language model asks your code to run something. **MCP** is a protocol that standardizes how AI applications discover and call capabilities that live outside the application. MCP does not replace APIs; an MCP server is usually a thin layer in front of one.

## The three layers in one request

Take a request to an assistant: "Which of my open invoices are overdue?"

1. The **model** sees a list of tool definitions and returns a structured request to call `list_invoices` with `{"status": "open"}`. That is function calling.
2. The **host application** receives that request. If the tool came from an MCP server, the host's MCP client sends a `tools/call` request to that server.
3. The **MCP server** translates the call into a request to the billing system's **API**, for example `GET /v1/invoices?status=open`, and returns the result in MCP's format.

Without MCP, step 2 is your own code calling the API directly. With MCP, step 2 is a standard protocol that any MCP host can perform against any MCP server.

## Comparison table

| | Web API (REST, GraphQL, gRPC) | Function calling | MCP |
| --- | --- | --- | --- |
| **What it is** | An interface a service exposes to other software | A model feature: the model emits a structured call for your code to run | An open protocol between AI hosts and servers that offer tools, resources and prompts |
| **Who decides to call** | The developer's code | The model proposes, the application executes | The model proposes, the host executes through an MCP client |
| **Where definitions live** | API docs or an OpenAPI file, read by developers | In your application, sent with each model request | On the server, discovered at runtime with `tools/list` |
| **Portability** | Any HTTP client | Tied to one model provider's request format | Any MCP host can use any MCP server |
| **Transport** | HTTP and others | Inside the model provider's API | JSON-RPC over stdio (local) or Streamable HTTP (remote) |
| **Authentication** | Whatever the API defines | Your application's own credentials | Defined for remote servers: OAuth 2.1 with protected resource metadata |
| **Output shape** | Designed for programs | Whatever your function returns | Content for the model, plus optional `structuredContent` that matches an `outputSchema` |
| **Typical owner** | The service provider | The application developer | The service provider or a third party |

## What function calling does

Function calling, also called tool use, is a capability of the model API. You send the model a list of tools, each with a name, a description and a JSON Schema for its arguments. When the model decides a tool would help, it returns a structured call instead of plain text. OpenAI's guide puts the division plainly: when the model calls a function, you must execute it and return the result. Anthropic's documentation describes the same round trip with `tool_use` and `tool_result` blocks.

Function calling says nothing about where the function's code lives, how it is discovered, or how it authenticates to anything. Those are your application's problems.

## What MCP adds

MCP takes the tool definition out of your application and puts it on a server that announces its own tools. A host connects, asks the server what it offers, passes those definitions to the model, and forwards the model's calls back to the server. The model still uses function calling; MCP standardizes the part between the host and the outside capability.

That standardization gives you:

- **Discovery.** Tools, resources and prompts are listed by the server at runtime, with pagination and change notifications.
- **One integration for many hosts.** A server written once works in desktop chat apps, code editors and agent frameworks that speak MCP.
- **A defined auth model for remote servers.** Clients discover the authorization server from the MCP server's protected resource metadata and request tokens bound to that one server.
- **Result conventions.** Tool errors the model can learn from (`isError: true`) are separated from protocol errors, and structured output can be validated against a schema.

Model providers have also built MCP into their APIs. The Claude API's MCP connector and OpenAI's MCP tool both let a single API request attach a remote MCP server, so you get function calling against server-defined tools without writing an MCP client yourself.

## What MCP does not replace

- **The underlying API.** The server still needs a way to reach the system of record. Most MCP servers wrap an existing API.
- **Product design.** A tool per REST endpoint usually gives models too many similar choices. Good servers expose a small set of task-shaped tools; see [designing a production MCP server](/learn/designing-production-mcp-server).
- **Authorization inside the product.** MCP defines how a client gets a token for the server. The server must still check what that user may do.
- **Deterministic code.** If the same steps run every time, plain code calling the API is cheaper and more predictable than asking a model to choose.

## When each applies

**Use the API directly** when your own code knows exactly what to call, such as a nightly sync, a webhook handler or a backend workflow. There is no model in the loop, so there is nothing for MCP to standardize.

**Use function calling with in-app tools** when the tools are specific to one application, you control the only host, and you want the shortest path. Many chatbots with three or four private tools do not need a separate server.

**Build or use an MCP server** when the same capability should be available in several AI hosts, when people outside your team will connect to it, or when you want the publisher, not each app, to maintain the tool definitions. This is why product companies ship MCP servers: one server reaches every compatible client.

**Combine them** in most production systems: an API underneath, an MCP server that exposes task-level tools, and hosts that pass those tools to a model through function calling.

[Should you build an MCP server?](/learn/should-you-build-mcp-server) walks through the decision in more depth, including alternatives such as client-specific apps and integration gateways.

## Compare an MCP tool list with an API

The quickest way to see the difference is to look at a live server's tool definitions next to the API behind them. [Open Context7 in the mcptest.io playground](/server/mcp.context7.com/mcp/mcp) to see the `tools/list` response, each input schema, and the raw JSON-RPC exchange for every call you make.
