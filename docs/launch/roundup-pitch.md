# Roundup pitches

Short pitches to authors of "best MCP testing tools" roundups. **Nothing has been sent.** The roundups and contact routes below were found and checked on 2026-10-21. None of them mentions mcptest.io yet. Numbers are from [press-facts.md](press-facts.md); recheck them before sending.

## What makes mcptest.io distinct (each point can be checked)

1. **Browser CORS evidence.** It connects from the page first and records whether the cross-origin request succeeded and which response headers were readable, then falls back to a proxy. A server that works from Node but not from a web client is flagged, for example `transport.cors-expose-headers-missing` when `Mcp-Session-Id` is not exposed. Check: <https://mcptest.io/learn/mcp-transport-diagnostics-reference#transport-cors-expose-headers-missing>.
2. **OAuth in a real browser.** OAuth 2.1 with PKCE runs in the user's own browser, with a pre-registered client, a Client ID Metadata Document or dynamic client registration. Bearer tokens and API keys are also supported. Check: connect to any OAuth server in the catalog, such as one marked OAuth at <https://mcptest.io/catalog>.
3. **Shareable report permalinks with badges.** A report can be published, redacted, to a public permalink. Each endpoint keeps a history of the last 20 published snapshots, and a badge follows the latest one. Static result badges (`ready`, `review`, `blocked`, `unknown`, `authorization-required`) and live catalog badges are also available. Reports export as JSON against a published schema (<https://mcptest.io/schemas/report/v2.schema.json>) and as Markdown. Check: <https://mcptest.io/badge/server/context7.svg>.
4. **Catalog evidence.** It covers 218 public remote servers. A GitHub Actions workflow revalidates them every Monday and opens a pull request with the new evidence, so every result has a public history in the repository. Each server has a page with its latest validation result. Check: <https://mcptest.io/servers/context7/> and `src/data/catalogValidation.json` in <https://github.com/integry/mcptest>.
5. **Free, no install, MIT.** It runs in the browser without an account. A headless CLI applies the same release decision in CI.

**What it cannot do:** test local stdio servers. It works with remote servers over HTTP only, and it does not run a language model against your tools.

## Pitch 1: MCPJam blog, "5 Best MCP Testing Tools for Server Reliability (2026)"

- **Post:** <https://www.mcpjam.com/blog/best-mcp-testing-tools>, by Aditya Somani, 2026-10-15. It covers MCPJam, MCP Inspector, Postman, FastMCP with pytest, and Promptfoo.
- **Contact:** the post does not invite suggestions. The public routes are <https://www.mcpjam.com/contact>, founders@mcpjam.com (from the page metadata) and their Discord (<https://discord.gg/Gpv7AmrRc4>).
- **Note:** MCPJam is a competitor, so keep the pitch to facts they can check and acknowledge where MCPJam is stronger.

```text
Subject: A browser-only option for your MCP testing tools roundup

Hi Aditya,

I read "5 Best MCP Testing Tools for Server Reliability (2026)". If you update it, mcptest.io may be worth a look as the option for remote servers tested from a browser. It's free and MIT-licensed, with no install or account.

What it does that the listed tools don't, each checkable:
- Browser CORS evidence: it connects from the page first and records whether the cross-origin request succeeded and which headers were readable (for example, a missing Access-Control-Expose-Headers for Mcp-Session-Id), then falls back to a proxy.
- OAuth 2.1 with PKCE in the user's own browser (pre-registered client, CIMD or DCR).
- Public report permalinks with per-endpoint history and README badges; JSON reports against a published schema.
- A catalog of 218 public remote servers, revalidated every Monday by a workflow whose evidence is committed to the repo.

What it can't do: local stdio servers, and it doesn't run an LLM against your tools. MCPJam's playground and evals are the better fit there, as our own comparison says: https://mcptest.io/learn/mcptest-vs-mcp-inspector

Try it with Context7 (no credentials): https://mcptest.io/server/mcp.context7.com/mcp/mcp
Source: https://github.com/integry/mcptest

Thanks,
<name>
```

## Pitch 2: Testomat.io, "Best Tools to Test MCP Server: A Complete Automation Guide"

- **Post:** <https://testomat.io/blog/mcp-server-testing-tools/>, by Michael Bodnarchuk, updated 2026-07-21. It covers Postman, SoapUI, JMeter, MCP Inspector, the Apify Tester MCP Client, the FastMCP Client and Testomat.io.
- **Contact:** contact@testomat.io; the author is @davert on X and DavertMik on GitHub. Testomat.io also has a "Write for us" page at <https://testomat.io/authors/>. This is the most open route found.

```text
Subject: mcptest.io for your MCP server testing tools guide

Hi Michael,

Your guide to MCP server testing tools covers the automation side well. One gap it could fill: a free, browser-only tool for remote servers. mcptest.io (MIT, no install) negotiates MCP 2026 stateless, 2025 stateful and legacy SSE, runs OAuth 2.1 with PKCE in the browser, and records whether a server actually works from a browser page (CORS and readable headers), with a fix linked for each transport diagnostic.

For automation: the same evaluator runs headless in CI (from the repository) and writes JSON and Markdown reports with stable exit codes (0 pass, 1 threshold failure, 2 authorization required, 3 invalid input, 4 evaluator error): https://github.com/integry/mcptest/blob/master/docs/headless-release-gate.md

It can't test local stdio servers.

Try it with Context7 (no credentials): https://mcptest.io/server/mcp.context7.com/mcp/mcp

Thanks,
<name>
```

## Other roundups found (no public contact route for suggestions)

Pitch these only if a route appears, for example through the author's social profile. Use the "distinct points" above and keep to three or four sentences.

| Roundup | URL | Author, date | Tools covered | Route |
| --- | --- | --- | --- | --- |
| 5 best MCP testing tools for agent evals in 2026 | <https://www.braintrust.dev/articles/best-mcp-testing-tools-agent-evals-2026> | Braintrust Team, 2026-08-30 | Braintrust, MCPJam, mcp-eval, DeepEval, MCP Inspector | General contact page only; the post is about evals, which mcptest.io does not do |
| Top 12 API/MCP Testing Tools in 2026 | <https://mojoauth.com/blog/top-12-api-mcp-testing-tools> | Raj Singh, 2026-06-14 | Postman, Bruno, Hoppscotch, Insomnia, MCP Inspector, MCPJam and others | None found |
| Best MCP Server Testing Tools 2026: Ultimate Comparison | <https://apidog.com/blog/best-mcp-server-testing-tools/> | Oliver Kingsley, 2026-04-16 | Apidog, Postman, Bruno, Insomnia, AccelQ, ReadyAPI, SOAtest | support@apidog.com (vendor support, not editorial) |
| The 12 Best MCP Server Generators and Observability Tools in 2026 | <https://www.theneo.io/blog/the-12-best-mcp-server-generators-and-observability-tools-in-2026> | Mariam Narimanidze, 2026-09-01 | Includes MCP Inspector and Postman | None found |
| Ultimate MCP Testing Resources for Developers in 2026 | <https://mcpplaygroundonline.com/blog/mcp-testing-resources-developers-2026> | Nikhil Tiwari, 2026-06-06 | 22 resources | None; run by a competing tool |

Short version for these:

```text
mcptest.io is a free, MIT-licensed browser tool for remote MCP servers. Of the tools in our comparison (MCP Inspector, MCPJam, Glama, Postman), it is the only one that records what a real browser sees (CORS success and readable headers), runs OAuth 2.1 with PKCE in the browser, publishes report permalinks with README badges, and keeps a weekly revalidated catalog of 218 public servers. It cannot test local stdio servers. https://mcptest.io
```
