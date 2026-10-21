---
title: "Remote MCP testing tools compared (2026)"
navTitle: MCP testing tools roundup
summary: "Eight MCP testing tools, from the official Inspector and conformance suite to MCPJam, Glama, Postman, two compliance CLIs and mcptest.io, compared on OAuth, CORS evidence, output validation, reports, CI, price and license."
track: understand
level: practitioner
order: 41
category: Tools
readingTimeMinutes: 11
lastReviewed: "2026-10-21"
metaTitle: "Best MCP testing tools in 2026: Inspector, MCPJam, Glama, Postman, conformance | mcptest.io"
metaDescription: "Compare eight MCP testing tools and MCP Inspector alternatives on install, remote OAuth, browser CORS evidence, structured output validation, reports, CI usage, price and license."
relatedSlugs:
  - mcptest-vs-mcp-inspector
  - mcptest-vs-glama-inspector
  - testing-guide
  - test-mcp-server-before-deploying
  - mcp-tool-output-schemas-and-structured-content
sourceLinks:
  - title: "MCP Inspector overview"
    url: "https://modelcontextprotocol.io/docs/tools/inspector"
  - title: "MCP Inspector: Web client"
    url: "https://modelcontextprotocol.io/docs/2026-07-28/tools/inspector/web"
  - title: "MCP Inspector: Authorization"
    url: "https://modelcontextprotocol.io/docs/2026-07-28/tools/inspector/authorization"
  - title: "MCP Inspector: CLI client"
    url: "https://modelcontextprotocol.io/docs/2026-07-28/tools/inspector/cli"
  - title: "MCP Inspector repository"
    url: "https://github.com/modelcontextprotocol/inspector"
  - title: "MCP Inspector source: tool output validation"
    url: "https://github.com/modelcontextprotocol/inspector/blob/main/core/mcp/toolOutputValidation.ts"
  - title: "MCPJam: Installation"
    url: "https://docs.mcpjam.com/installation"
  - title: "MCPJam: Hosted app"
    url: "https://docs.mcpjam.com/hosted/overview"
  - title: "MCPJam: OAuth Debugger"
    url: "https://docs.mcpjam.com/inspector/guided-oauth"
  - title: "MCPJam: CI / CD"
    url: "https://docs.mcpjam.com/cli/ci"
  - title: "MCPJam Inspector repository"
    url: "https://github.com/MCPJam/inspector"
  - title: "MCPJam source: tool output validation"
    url: "https://github.com/MCPJam/inspector/blob/main/mcpjam-inspector/client/src/lib/schema-utils.ts"
  - title: "Glama: MCP Inspector"
    url: "https://glama.ai/mcp/inspector"
  - title: "Glama: MCP FAQ"
    url: "https://glama.ai/mcp/faq"
  - title: "Glama: MCP server directory"
    url: "https://glama.ai/mcp/servers"
  - title: "Postman: MCP requests overview"
    url: "https://learning.postman.com/docs/use/send-requests/protocols/mcp-requests/overview/"
  - title: "Postman: Create an MCP request"
    url: "https://learning.postman.com/docs/use/send-requests/protocols/mcp-requests/create/"
  - title: "Postman: Debug OAuth 2.1 authentication"
    url: "https://learning.postman.com/docs/use/send-requests/protocols/mcp-requests/oauth-debugger/"
  - title: "Postman CLI: Run a collection"
    url: "https://learning.postman.com/docs/postman-cli/postman-cli-run-collection/"
  - title: "Postman pricing"
    url: "https://www.postman.com/pricing/"
  - title: "MCP conformance suite repository"
    url: "https://github.com/modelcontextprotocol/conformance"
  - title: "MCP conformance: SDK integration guide"
    url: "https://github.com/modelcontextprotocol/conformance/blob/main/SDK_INTEGRATION.md"
  - title: "MCP conformance: GitHub Action definition"
    url: "https://github.com/modelcontextprotocol/conformance/blob/main/action.yml"
  - title: "MCP conformance: server tool scenarios"
    url: "https://github.com/modelcontextprotocol/conformance/blob/main/src/scenarios/server/tools.ts"
  - title: "YawLabs mcp-compliance repository"
    url: "https://github.com/YawLabs/mcp-compliance"
  - title: "YawLabs mcp-compliance: fix recipes"
    url: "https://github.com/YawLabs/mcp-compliance/blob/main/docs/FIXES.md"
  - title: "Yaw: mcp-compliance"
    url: "https://yaw.sh/mcp-servers/mcp-compliance/"
  - title: "steviec/mcp-server-tester repository"
    url: "https://github.com/steviec/mcp-server-tester"
  - title: "mcp-server-tester source: client transports"
    url: "https://github.com/steviec/mcp-server-tester/blob/main/src/shared/core/mcp-client.ts"
  - title: "mcp-server-tester source: CLI options"
    url: "https://github.com/steviec/mcp-server-tester/blob/main/src/cli.ts"
  - title: "mcptest.io repository"
    url: "https://github.com/integry/mcptest"
  - title: "mcptest.io headless CLI and CI release gate"
    url: "https://github.com/integry/mcptest/blob/master/docs/headless-release-gate.md"
  - title: "mcptest.io server catalog data"
    url: "https://github.com/integry/mcptest/blob/master/src/data/serverCatalog.json"
  - title: "mcptest.io transport diagnostics reference"
    url: "https://mcptest.io/learn/mcp-transport-diagnostics-reference"
---

People searching for "the best MCP testing tool" usually need one of five different things: a debugger for a local server, a check that a remote server works before launch, a gate in CI, something to teach a team with, or a quick look at a server someone else runs. No single tool does all five well. This page compares the eight tools that come up most often and says plainly where each one is the better choice.

The tools are the official **MCP Inspector**, **MCPJam**, the **Glama** inspector, **Postman**'s MCP requests, the official **conformance suite** (`@modelcontextprotocol/conformance`), YawLabs **mcp-compliance**, steviec's **mcp-server-tester**, and **mcptest.io**. mcptest.io is our product. Every row below was checked against each project's documentation, repository or source code on October 21, 2026, and the links are listed under sources. Where a feature exists in source code but not in the documentation, the text says so. "Not documented" means we could not find it, not that it is impossible.

## Comparison table

The table is split in two so it stays readable. The first four tools are interactive inspectors; the next four are three command-line test suites and mcptest.io.

| | MCP Inspector | MCPJam | Glama inspector | Postman |
| --- | --- | --- | --- | --- |
| **Install** | `npx`, Node 22.19 or newer; web UI, CLI and terminal UI | Hosted web app, `npx`, desktop app (macOS, Windows) or Docker | None, runs in the browser; no account | Postman app and a Postman account |
| **Remote OAuth** | Dynamic registration, pre-registered client, Client ID Metadata Document, enterprise IdP; step-up | Step-by-step debugger for the 2025-03-26, 2025-06-18, 2025-11-25 and 2026-07-28 flows; pre-registration, DCR, CIMD | OAuth 2.1 authorization code with PKCE, DCR and refresh tokens; bearer token, custom headers | Authorization tab; eight-step OAuth 2.1 debugger covering metadata, DCR and PKCE |
| **Browser CORS evidence** | No: a local Node server owns the connections | No: the hosted app connects from MCPJam's servers | Not reported: connects through its proxy or directly to servers that allow browser requests | Not documented |
| **Structured output validation** | Yes in source (`structuredContent` against `outputSchema`); not described in the docs | Yes in source (Ajv check); not described in the docs | Not documented | Not documented |
| **Diagnostics** | Logs, JSON-RPC protocol, network and console tabs; spec errors grouped by class | OAuth step-by-step trace with copyable logs; `server doctor` | Raw JSON-RPC requests and responses; extra detail in the browser console | Response and Notifications tabs; pass or fail per OAuth step |
| **Shareable reports** | Log entries can be exported; no report | Share a hosted server with other MCPJam users; HTML and JUnit from the CLI | Configuration saved in the page URL | Requests shared in collections and workspaces |
| **Catalog** | Local server list only | Not documented | Separate directory of more than 100,000 servers with letter grades | Not covered in the MCP request docs |
| **CI usage** | CLI with JSON output, exit codes per failure class, `--stored-auth-only` | CLI health checks, conformance suites and evals; JSON, JUnit, HTML; GitHub Action | Not documented | Postman CLI skips MCP requests |
| **Price** | Free | Free to start; hosted usage has a daily allowance and paid credits | Free | Free plan; Solo $9 per month, Team $19 per user per month, billed annually |
| **License** | MIT, moving to Apache-2.0 | Apache-2.0 | No source or license published | Commercial |

| | Conformance suite | mcp-compliance | mcp-server-tester | mcptest.io |
| --- | --- | --- | --- | --- |
| **Install** | `npx @modelcontextprotocol/conformance` | `npx @yawlabs/mcp-compliance`, Node 20 or newer; also Docker and an MCP server mode | `npx mcp-server-tester`, Node 18 or newer | None, runs in the browser; headless CLI from a repository checkout, Node 22 or newer |
| **Remote OAuth** | Scenarios that test a client's or authorization server's OAuth behaviour (DCR, CIMD, pre-registration and more); not a login tool for your server | Static token through `--auth` or headers; checks Protected Resource Metadata | No: servers are launched from a local command | OAuth 2.1 with PKCE: pre-registered client, CIMD, DCR; bearer token and API key |
| **Browser CORS evidence** | No | Checks CORS response headers over HTTP, not from a browser | No | Yes: connects from the browser first, records cross-origin failures and readable headers, then falls back to a proxy |
| **Structured output validation** | Every message checked against the spec's JSON schema; no tool output-contract check in the server tool scenarios | `tools-output-schema` test checks that declared output schemas are valid | Not documented | Each call's `structuredContent` checked against `outputSchema`, with the path and message of every violation |
| **Diagnostics** | `checks.json` per scenario with pass or fail | A to F grade, per-test pass, fail or skip, explanations and fix recipes | Per-test results; compliance mode (work in progress) shows expected and actual values | Stable diagnostic ids with severity, release impact and fixes for three server stacks |
| **Shareable reports** | JSON result files | JSON, SARIF, Markdown, HTML; local SVG badge | JSON and JUnit XML | Public report URL, JSON and Markdown export, README badges |
| **Catalog** | No | No | No | 218 public remote servers with periodic validation |
| **CI usage** | GitHub Action; expected-failures baseline, exit 1 on regression | `--strict` and `--min-grade` exit codes; GitHub Action; SARIF upload | Exit 1 on failure; JUnit XML | Headless gate with JSON and Markdown reports and stable exit codes |
| **Price** | Free | Free | Free; LLM evals need an Anthropic API key | Free |
| **License** | MIT, moving to Apache-2.0 | MIT | MIT | MIT |

## MCP Inspector

The official inspector, maintained by the MCP project, ships one package with three clients: a web UI, a scriptable CLI and a terminal UI. They share the same connection code and OAuth state.

**Where it is better.** It is the reference for local stdio servers and covers almost every protocol feature, including tasks, subscriptions, resource templates and MCP Apps. Its OAuth support is the broadest here, with enterprise-managed authorization and step-up scopes. The CLI is built for scripts: JSON on stdout and a distinct exit code for authentication failures, unreachable servers and tool errors.

**Trade-offs.** It runs on your machine and needs a recent Node.js. The web UI's Node backend makes the connections, so it cannot tell you whether a server would work from a browser. It produces logs rather than a report you can hand to someone else.

## MCPJam

MCPJam is an open-source inspector with a hosted web app, desktop apps, a terminal install and a Docker image. Its distinctive feature is an LLM playground that chats with frontier models against your tools and runs evaluations.

**Where it is better.** If your question is whether a model picks the right tool with the right arguments, MCPJam answers it directly. Its OAuth debugger walks through each step and covers four protocol revisions. Its CLI runs health checks, conformance suites and evals with JUnit or HTML output, and ships a GitHub Action.

**Trade-offs.** The hosted app reaches servers from MCPJam's servers, so it reports server-side reachability, not browser behaviour, and it accepts HTTPS URLs only. Model usage beyond the daily allowance consumes paid credits. The GitHub Action is limited to GitHub.com with Ubuntu runners.

## Glama inspector

Glama's inspector is a free page on glama.ai that connects to Streamable HTTP and SSE servers with no install and no account. Local stdio servers can be reached through an `mcp-proxy` tunnel.

**Where it is better.** It is fast to start: paste a URL and connect. It lists support for elicitation, sampling, roots, tasks and subscriptions, and its configuration-in-the-URL makes a setup easy to bookmark. Glama's large server directory sits alongside it.

**Trade-offs.** It does not report what the browser saw about CORS, and its documentation does not describe output validation, exports or CI use. Because the configuration lives in the URL, its own page warns you to remove secrets before sharing a link. The [mcptest.io vs Glama comparison](/learn/mcptest-vs-glama-inspector) goes into more detail.

## Postman

Postman added MCP requests to its API platform. You create an MCP request in a workspace, choose stdio or Streamable HTTP, load the server's capabilities and call tools, prompts and resources.

**Where it is better.** Teams that already keep their API work in Postman can store MCP requests in the same collections and workspaces. Its OAuth debugger shows each phase of the OAuth 2.1 flow and marks the step that fails. It can export a server configuration for hosts such as Claude Desktop, VS Code and Cursor.

**Trade-offs.** The Postman CLI runs HTTP, gRPC and GraphQL requests and skips MCP requests, so there is no CI path for them. It is a commercial product with paid plans above the free tier, and it is not open source.

## Official conformance suite

`@modelcontextprotocol/conformance` is the MCP project's own test framework. Each run tests one side: either it connects to a running server, or it starts a test server and runs your client against it.

**Where it is better.** It is the authoritative check of protocol behaviour, maintained next to the specification, and it is the only tool here that tests clients as well as servers. Its OAuth scenarios cover registration methods and token handling in depth. The expected-failures baseline makes it a precise CI gate: a new failure fails the build, and so does a listed failure that has started to pass.

**Trade-offs.** It is written for SDK and framework authors. Many server scenarios ask the server to implement specific test tools, such as `test_simple_text`, so running it against an ordinary production server reports failures that are not bugs. The latest npm release is still versioned 0.x.

## YawLabs mcp-compliance

mcp-compliance is a command-line grader with 88 tests for the 2025-11-25 revision and 103 for 2026-07-28. It detects which revision a server speaks and grades it from A to F.

**Where it is better.** It accepts any server, local stdio or remote HTTP, and gives one grade that is easy to track. Its output formats include SARIF for GitHub code scanning and a self-contained HTML report, and every test id has an explanation and a fix recipe. It also runs as an MCP server, so a coding agent can call it.

**Trade-offs.** It does not run an OAuth flow, so protected servers need a token you obtain elsewhere. Its CORS test reads headers from a Node process, which is not the same as what a browser enforces. Reports and badges are local files.

## steviec/mcp-server-tester

mcp-server-tester runs YAML-defined tool tests against a local server and can run LLM evals that check whether Claude uses the tools as intended.

**Where it is better.** Its `tools` tests are deterministic and need no API key, and its `evals` command is one of the few open-source ways to test model tool use from the command line. JUnit XML output fits most CI systems.

**Trade-offs.** It launches servers from a local command: the HTTP transport throws "not yet implemented", so it does not test remote servers or OAuth. Its compliance command is marked as work in progress. Evals require an Anthropic API key and incur API costs. The last release was in September 2025.

## mcptest.io

mcptest.io is a browser-based inspector, playground and evaluator for remote MCP servers, with a public catalog.

**Where it is better.** It needs no install and no account. It is the only tool here that records what a browser actually experiences: whether cross-origin requests succeed and which response headers are readable, which matters if your server should work in web-based clients. Every tool call is checked against the declared output schema, and each finding carries a stable diagnostic id with fixes for three server stacks. Each endpoint gets a public report URL, JSON and Markdown export and a README badge, and the [catalog](/catalog) lists public servers with their latest validation. The same release-gate rules run in CI through a headless CLI.

**Trade-offs.** It cannot test local stdio servers. It does not run a language model against your tools, so it has no LLM chat and no hosted evals. The headless CLI runs from a checkout of the repository rather than a published package, cannot run interactive OAuth, and does not call tools, so output contracts are only checked in the browser. Anonymous use of its CORS proxy is rate-limited, and signing in raises the limits.

## Which to pick

- **A local stdio server under development:** MCP Inspector. Postman works too if your team already uses it, and mcp-compliance gives a graded spec check. mcptest.io cannot reach stdio servers; see [converting a stdio server to remote](/learn/convert-local-stdio-mcp-server-to-remote) when you are ready to deploy.
- **A remote server before launch:** mcptest.io for browser CORS evidence, OAuth, output contracts and a report you can share; then MCPJam if you also want to see how models use the tools. The [pre-deployment checklist](/learn/test-mcp-server-before-deploying) lists the full pass.
- **A CI gate:** the conformance suite if you build an SDK or framework; mcp-compliance or the MCP Inspector CLI for spec checks on your own server; MCPJam for model evals; the mcptest.io headless gate for a ready, review or blocked release decision.
- **Teaching a team:** MCP Inspector to see the raw protocol locally, and mcptest.io or Glama when people cannot install anything. The [catalog](/catalog) gives everyone the same real servers to explore.
- **Evaluating a third-party server:** mcptest.io for a report on transport, authentication and capabilities you can link to, with the [server trust checklist](/learn/mcp-server-trust-checklist) for the questions a tool cannot answer. Glama's directory shows letter grades for license, quality and maintenance.

Most teams end up with two: one tool for local development and one for the deployed endpoint.

## Try it on a real server

[Open DeepWiki in the mcptest.io playground](/server/mcp.deepwiki.com/mcp/mcp), a public catalog server that needs no sign-in. Call one of its tools, generate the report, and then open the same URL in any of the other tools to compare what each one shows.
