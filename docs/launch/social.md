# Social drafts

Five variants with the same facts as [announcement.md](announcement.md). The numbers come from [press-facts.md](press-facts.md); check them again on the day you post. Character counts include spaces and count each URL at full length. X shortens links to 23 characters, so the X post has more room than the count suggests.

## 1. X / Bluesky (under 300 characters)

```text
mcptest.io tests remote MCP servers in your browser: protocol negotiation, OAuth 2.1 with PKCE, CORS evidence from a real browser, and a shareable report with a README badge. Catalog of 218 public servers, revalidated weekly. Free, MIT. Remote only, no stdio.

https://mcptest.io
```

(279 characters)

## 2. LinkedIn

```text
mcptest.io is a free, MIT-licensed tool for testing remote Model Context Protocol (MCP) servers from a browser, with no install and no account.

Paste an endpoint URL and it negotiates the protocol (MCP 2026 stateless, 2025 stateful, or legacy HTTP+SSE), runs OAuth 2.1 with PKCE in your browser, and lists tools, resources and prompts next to the raw JSON-RPC log.

New in the 2026-10-20 release:
- A catalog of 218 public remote servers, revalidated every Monday
- Public report permalinks with history, and README badges that follow the latest result
- Transport diagnostics (406, 405, 415, 429, CORS expose headers, SSE content type), each linked to a fix
- Validation of structured tool output against outputSchema
- Server submission from the app, reviewed as a pull request
- 38 guides on MCP, plus llms.txt, RSS and a monthly digest of MCP changes

It records what a browser actually sees, including whether cross-origin requests succeed, which matters if your server should work in web-based clients.

It does not test local stdio servers or run language models against your tools. For those, the official MCP Inspector and MCPJam are better choices. We compared all of them here: https://mcptest.io/learn/mcptest-vs-mcp-inspector

Try it: https://mcptest.io
```

## 3. Reddit r/mcp

Title:

```text
mcptest.io: browser-based tester for remote MCP servers, now with a 218-server catalog, report permalinks and transport diagnostics
```

Body:

```text
I maintain mcptest.io, a free, MIT-licensed tool for testing remote MCP servers in the browser. We shipped a large update this week and I'd like feedback from people who run servers.

What it does:
- Negotiates MCP 2026-07-28 stateless first, falls back to 2025 initialize, then legacy HTTP+SSE (official TypeScript SDK)
- OAuth 2.1 with PKCE in the browser: pre-registered client, CIMD or DCR; also bearer tokens and API keys
- Connects directly from the page first and records whether CORS allowed it and which headers were readable; proxy only as a fallback
- Report with a release decision (ready / review / blocked / unknown), JSON + Markdown export

New:
- Catalog of 218 public remote servers, revalidated weekly; anyone can submit at mcptest.io/submit (becomes a reviewed PR)
- Public report permalinks with per-endpoint history and badges
- Transport diagnostics for 406 / 405 / 415 / 429, missing Access-Control-Expose-Headers, SSE content-type mismatch, each linking to a fix
- Structured output checked against outputSchema
- Headless CLI for CI (runs from the repo for now)

What it cannot do: local stdio servers, and it doesn't run an LLM against your tools. MCP Inspector and MCPJam cover those. Comparison: https://mcptest.io/learn/mcptest-vs-mcp-inspector

Quick try: paste https://mcp.context7.com/mcp at https://mcptest.io (no credentials needed).

Source: https://github.com/integry/mcptest
```

## 4. Reddit r/LocalLLaMA

Check the subreddit's self-promotion rules on the day. This version leads with the local-model angle and is upfront about the remote-only limit.

Title:

```text
Free browser tool to check a remote MCP server before you wire it into your local model setup
```

Body:

```text
If you use remote MCP servers with a local model (through a client that speaks MCP), mcptest.io lets you check a server before you connect it: does it respond, which protocol version does it speak, what auth does it need, and what do its tools, resources and prompts actually return. It shows the raw JSON-RPC log.

It's free, MIT-licensed and runs in the browser: https://mcptest.io

There's also a catalog of 218 public remote servers with their latest validation result (auth type, protocol version), revalidated weekly: https://mcptest.io/catalog

Limits, to save you a click: it only tests remote servers (HTTP), not local stdio ones, and it does not run any model itself. For stdio, the official MCP Inspector (npx) is the tool to use.

Source: https://github.com/integry/mcptest
```

## 5. Hacker News

Title (80 characters max):

```text
Show HN: mcptest.io – test remote MCP servers in the browser, no install
```

First comment:

```text
Hi HN. mcptest.io is a browser-based tester for remote Model Context Protocol servers. You paste an endpoint URL; it negotiates the protocol with the official TypeScript SDK (2026 stateless, then 2025 stateful, then legacy HTTP+SSE), runs OAuth 2.1 with PKCE in your browser if the server asks for it, and shows tools, resources and prompts next to the JSON-RPC traffic.

Of the five tools in our comparison, it is the only one that records browser evidence. It connects from the page first and records whether CORS allowed the request and which response headers were readable, and only then falls back to a proxy. A stateful server can work from Node and still fail in a web client because Mcp-Session-Id is not listed in Access-Control-Expose-Headers; the report flags that case with a fix.

The release this week added a catalog of 218 public servers revalidated weekly, report permalinks with history and badges, six transport diagnostics (406/405/415/429, CORS expose headers, SSE content type) with linked fixes, outputSchema validation, and 38 guides.

What it cannot do: local stdio servers (use the official MCP Inspector), or run an LLM against your tools (MCPJam does that). I wrote a comparison that says where each tool is better: https://mcptest.io/learn/mcptest-vs-mcp-inspector

Try it with Context7, which needs no credentials: https://mcptest.io/server/mcp.context7.com/mcp/mcp

MIT licensed: https://github.com/integry/mcptest
```
