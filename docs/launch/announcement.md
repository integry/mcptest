# Announcement draft

Draft for a blog post or a Hacker News "Show HN" post, about 600 words. Numbers are from [press-facts.md](press-facts.md), which shows how each one was derived. Check them again on the day you post.

Suggested title: **Show HN: mcptest.io – test remote MCP servers from your browser, no install**

---

mcptest.io is a free, MIT-licensed tool for testing remote Model Context Protocol (MCP) servers in a browser. You paste an endpoint URL. It negotiates the protocol, handles authorization, and lists the server's tools, resources and prompts next to the raw JSON-RPC traffic. You can call tools from forms generated from their schemas, then produce a report with a release decision.

A large release shipped on 2026-10-20. This post covers what the tool does, what is new, and where other tools fit better.

## What it does

- **Protocol negotiation.** It tries MCP 2026-07-28 stateless first (`server/discover`), falls back to the 2025 `initialize` handshake, and finally tries legacy HTTP+SSE. It uses the official TypeScript SDK.
- **Authorization.** OAuth 2.1 with PKCE runs in your browser, with a pre-registered client, a Client ID Metadata Document or dynamic client registration. Bearer tokens and API keys are also supported.
- **Browser CORS evidence.** It connects directly from the page first and records whether the cross-origin request succeeded and which response headers were readable. A proxy is used only as a fallback. This tells you whether your server will work in web-based clients.
- **Reports.** Each report covers protocol adherence, capabilities, transport, OAuth metadata, browser access and connection time, and ends in `ready`, `review`, `blocked` or `unknown` with prioritized findings. Reports export as JSON (with a published schema) and Markdown.

## What is new

- **Catalog:** 218 public remote servers (up from 111), revalidated every Monday by a GitHub Actions workflow. Each server has a page with its latest validation result.
- **Report permalinks:** publish a redacted report to a public URL. Each endpoint keeps a history of the last 20 published snapshots, with a badge that follows the latest one.
- **README badges:** static result badges, and live badges for catalog servers.
- **Transport diagnostics:** six diagnostics, for 406, 405, 415 and 429 responses, missing `Access-Control-Expose-Headers` and SSE content-type mismatches. Each one links to a reference section with the fix.
- **Structured output validation:** tool results are checked against the tool's `outputSchema`.
- **Server submission:** submit a server at `/submit`; it becomes a reviewed pull request.
- **Guides:** 38 guides in four tracks (Understand, Use, Build, Reference), plus `llms.txt`, an RSS feed, raw Markdown for every page and a monthly digest of MCP changes.
- **Headless CLI:** the same evaluator runs in CI with JSON and Markdown output and stable exit codes. For now it runs from a checkout of the repository.

## Who it is for

- Developers of remote MCP servers who want to see what a client will see before release.
- People adding a server to Claude, ChatGPT or Cursor who want to check that it responds and authorizes first.
- Server publishers who want a shareable report link or a README badge.

## How it compares

We wrote a comparison with the official MCP Inspector, MCPJam, the Glama inspector and Postman, checked against each product's documentation: <https://mcptest.io/learn/mcptest-vs-mcp-inspector>. In short:

- **MCP Inspector** is the better choice for local stdio servers, which mcptest.io cannot test. It also exposes more of the protocol, and its CLI is well suited to CI.
- **MCPJam** runs language models against your tools and compares models side by side. mcptest.io does not run a model. MCPJam's OAuth debugger checks flows across three protocol revisions.
- **Glama's inspector** is a quick in-browser check, with a large server directory alongside it.
- **Postman** suits teams that already keep their API work in Postman collections and workspaces.

mcptest.io is the option for checking how a remote server behaves in a real browser and for sharing the result as a link.

Limitations: no local stdio servers and no LLM runs. Headless runs cannot do interactive OAuth (use a bearer token or API key). Anonymous use of the CORS proxy is rate-limited.

## Try it in 30 seconds

1. Open <https://mcptest.io>.
2. Paste `https://mcp.context7.com/mcp` (Context7, a public catalog server that needs no credentials) and connect. Or open it straight in the playground: <https://mcptest.io/server/mcp.context7.com/mcp/mcp>.
3. Pick a tool, such as `resolve-library-id`, fill in the form and run it. The JSON-RPC log shows the exchange.
4. Open <https://mcptest.io/report/https%3A%2F%2Fmcp.context7.com%2Fmcp> and choose **Run Report** to see the release decision and the browser CORS result.

The code is at <https://github.com/integry/mcptest>. Feedback and catalog submissions are welcome.
