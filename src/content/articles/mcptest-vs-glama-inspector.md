---
title: "mcptest.io vs the glama.ai inspector"
navTitle: mcptest.io vs Glama
summary: "Two zero-install browser inspectors for remote MCP servers compared on connection path, OAuth, CORS evidence, report sharing and badges, catalog, diagnostics, structured output, price and openness."
track: understand
level: practitioner
order: 42
category: Tools
readingTimeMinutes: 6
lastReviewed: "2026-10-21"
metaTitle: "mcptest.io vs Glama MCP Inspector: browser MCP testing compared | mcptest.io"
metaDescription: "Compare the glama.ai MCP inspector with mcptest.io: direct browser versus proxy connections, OAuth, CORS evidence, shareable reports and badges, directory, diagnostics and price."
relatedSlugs:
  - best-remote-mcp-testing-tools
  - mcptest-vs-mcp-inspector
  - mcp-cors-headers-for-browser-clients
  - mcp-tool-output-schemas-and-structured-content
  - mcp-server-trust-checklist
sourceLinks:
  - title: "Glama: MCP Inspector"
    url: "https://glama.ai/mcp/inspector"
  - title: "Glama: MCP FAQ"
    url: "https://glama.ai/mcp/faq"
  - title: "Glama: MCP server directory"
    url: "https://glama.ai/mcp/servers"
  - title: "Glama: Tool Definition Quality Score"
    url: "https://glama.ai/blog/2026-04-03-tool-definition-quality-score-tdqs"
  - title: "Glama: inspector OAuth client metadata document"
    url: "https://glama.ai/mcp/inspector/oauth/client-metadata.json"
  - title: "Glama: example directory score page"
    url: "https://glama.ai/mcp/servers/mnott/Hook/score"
  - title: "mcp-proxy repository (Glama's tunnel for local servers)"
    url: "https://github.com/punkpeye/mcp-proxy"
  - title: "mcptest.io repository and README"
    url: "https://github.com/integry/mcptest"
  - title: "mcptest.io headless CLI and CI release gate"
    url: "https://github.com/integry/mcptest/blob/master/docs/headless-release-gate.md"
  - title: "mcptest.io server catalog data"
    url: "https://github.com/integry/mcptest/blob/master/src/data/serverCatalog.json"
  - title: "mcptest.io CORS proxy worker"
    url: "https://github.com/integry/mcptest/blob/master/cors-proxy-worker/src/index.ts"
  - title: "mcptest.io transport diagnostics reference"
    url: "https://mcptest.io/learn/mcp-transport-diagnostics-reference"
  - title: "mcptest.io output schema guide"
    url: "https://mcptest.io/learn/mcp-tool-output-schemas-and-structured-content"
---

The glama.ai inspector and mcptest.io are both free web pages that connect to a remote MCP server with nothing to install. For a quick look at a server they are interchangeable: paste a URL, connect, list the tools and call one. The differences are in what happens around that call, so this comparison stays narrow and factual.

mcptest.io is our product. Glama's features below were checked against its inspector page, FAQ, directory and blog on October 21, 2026; where Glama's documentation is silent, the text says "not documented" rather than guessing. Links are listed under sources. For a wider view that includes the official MCP Inspector, MCPJam, Postman and three command-line suites, see [Remote MCP testing tools compared](/learn/best-remote-mcp-testing-tools).

## At a glance

| | Glama inspector | mcptest.io |
| --- | --- | --- |
| **Install and account** | None; "No installation or Glama account required" | None; signing in raises proxy limits |
| **Transports** | Streamable HTTP, SSE; local stdio through an `mcp-proxy` public tunnel | Streamable HTTP (stateless and stateful), legacy HTTP+SSE; no stdio |
| **Connection path** | Its built-in proxy, or directly to servers that allow browser requests | Direct from the browser first, CORS proxy as a fallback |
| **OAuth** | OAuth 2.1 authorization code with PKCE, DCR and refresh tokens | OAuth 2.1 with PKCE: pre-registered client, CIMD, DCR |
| **Other credentials** | Bearer token, custom headers, API key in query string | Bearer token, API key |
| **CORS evidence** | Not reported | Records cross-origin failures and which response headers the browser can read |
| **Sharing** | Configuration saved in the page URL | Public report URL per endpoint, JSON and Markdown export |
| **Badges** | Score badge images exist for directory listings; not documented | Documented README badges linking to the report |
| **Catalog or directory** | Directory of more than 100,000 servers with letter grades | 218 public remote servers with periodic validation |
| **Diagnostics** | Raw JSON-RPC requests and responses; extra detail in the browser console | Stable diagnostic ids with severity, release impact and fixes |
| **Structured output** | Not documented | Each call checked against `outputSchema` with path-level messages |
| **CI** | Not documented | Headless CLI with JSON and Markdown reports and exit codes |
| **Price and license** | Free; no source or license published | Free; MIT licensed, source on GitHub |

## Connection paths

Glama's page says it can "Connect through the built-in proxy, or directly to servers that allow browser requests." It does not say when each path is used or show which one a connection took. Its FAQ separately states that inspector requests go from your browser to the MCP server without Glama logging them. Glama can also reach a server on your own machine: `npx mcp-proxy --port 8080 --tunnel -- tsx server.ts` exposes it at a public tunnel URL. Replace `tsx server.ts` with the command that starts your own server.

mcptest.io always tries a direct connection from your browser first. If the browser blocks it, the failure is recorded and the connection is retried through mcptest.io's CORS proxy, and the report notes which path succeeded. Anonymous proxy use is rate-limited; signing in raises the limits. mcptest.io has no tunnel, so it cannot test a local stdio server.

## OAuth

Both run the OAuth 2.1 authorization code flow with PKCE in the browser and support dynamic client registration. Glama documents refresh tokens. It also publishes a client metadata document whose `client_id` is its own URL, the form the Client ID Metadata Document (CIMD) method uses, though its documentation does not describe when the inspector uses it. mcptest.io documents three registration paths: a pre-registered client, CIMD and DCR.

For servers that do not use OAuth, Glama accepts a bearer token, arbitrary custom headers or an API key in the query string. mcptest.io accepts a bearer token or an API key sent as `X-API-Key`.

## What each shows about CORS

This is the main difference. Glama's inspector is built to get you connected: when its proxy is used, a server with missing CORS headers still works, and its documentation does not describe any CORS findings.

mcptest.io treats the direct attempt as evidence. If a server works only through the proxy, the report says so, and a server that hides `Mcp-Session-Id` or `Retry-After` from the browser, by leaving it out of `Access-Control-Expose-Headers`, gets a named diagnostic. That tells you in advance whether browser-based clients will be able to use the server. The [CORS guide](/learn/mcp-cors-headers-for-browser-clients) explains the headers.

## Report sharing and badges

Glama saves the whole inspector configuration, including the active tool and its arguments, in the page URL, so a link reproduces a setup. Its page warns that configurations "can include credentials and tool arguments" and that you should remove secrets before sharing. Glama's directory serves score badge images for listed servers, but we found no Glama page that documents them.

mcptest.io generates a report per endpoint: transport behaviour, authentication, capabilities, findings and a release decision of ready, review or blocked. The report has a public URL, exports to JSON and Markdown, and comes with copy-ready badge snippets for a README. Reports are redacted before they are stored, so credentials are not part of what you share.

## Catalog and directory

Glama runs one of the largest MCP directories: the listing showed 108,094 servers on October 21, 2026. Cards show letter grades for license, quality and maintenance, its FAQ says indexing runs license detection, a security scan and a health test, and some listings add a Tool Definition Quality Score per tool.

The mcptest.io [catalog](/catalog) is much smaller and limited to remote servers: 218 public endpoints, each with its latest validation result, authentication type and a link that opens it in the playground. Glama is the better place to discover servers; mcptest.io is built to show how a specific remote endpoint behaves today.

## Diagnostics

Glama shows raw JSON-RPC requests and responses and prints more detail to the browser console. It supports a wide range of protocol features, including elicitation, sampling, roots, tasks, subscriptions and completion.

mcptest.io maps what it observes to stable diagnostic ids, such as a 406 caused by a wrong `Accept` header or a 415 from a wrong `Content-Type`. Each diagnostic has a severity, its effect on the release decision and fixes for the TypeScript SDK, Python SDK and Cloudflare Workers, listed in the [transport diagnostics reference](/learn/mcp-transport-diagnostics-reference).

## Structured output

Glama's documentation does not describe checking tool results against a declared `outputSchema`.

mcptest.io checks every tool call's `structuredContent` against the tool's `outputSchema`, using the JSON Schema draft the schema declares, and lists each violation with its path, for example "`structuredContent.total`: Expected number but got string". A violation makes the release decision `blocked`. The [output schema guide](/learn/mcp-tool-output-schemas-and-structured-content) shows the checks.

## Pricing and openness

Both inspectors are free to use. Glama does not publish the inspector's source code or a license for it, and its documentation describes no CLI or CI use. mcptest.io is MIT licensed with its source on GitHub, and the same evaluator runs in CI through a headless CLI. That CLI runs from a checkout of the repository and does not call tools.

## Which to use

- **Finding a server for a task:** Glama's directory.
- **Reaching a server on your own machine from a browser:** Glama with its tunnel; mcptest.io does not support stdio.
- **Checking that a remote server works from a browser, with a report or badge to share:** mcptest.io.
- **Checking tool output against declared schemas:** mcptest.io.

Neither runs a language model against your tools or hosted evals; for that, see MCPJam in the [wider comparison](/learn/best-remote-mcp-testing-tools).

## Try it on a real server

[Open Context7 in the mcptest.io playground](/server/mcp.context7.com/mcp/mcp), a public catalog server that needs no sign-in, call a tool and generate the report. Then paste `https://mcp.context7.com/mcp` into Glama's inspector to compare what each one shows.
