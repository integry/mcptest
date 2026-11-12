---
title: "MCP testing tools compared (2026)"
navTitle: MCP testing tools roundup
summary: "MCP testing tools grouped by job: browser testers, local inspectors and API clients, CI and contract testing, evals, load testing, and test servers. Each entry says what it tests, where it runs, how to install it, its license and its stated price."
track: understand
level: practitioner
order: 41
category: Tools
readingTimeMinutes: 18
lastReviewed: "2026-11-11"
metaTitle: "Best MCP testing tools in 2026: inspectors, CI, evals, load and test servers | mcptest.io"
metaDescription: "Compare MCP testing tools by job: MCP Inspector, MCPJam, MCP Playground, Postman, Insomnia, conformance, mcp-compliance, PMCP mcp-tester, Specmatic, DeepEval, FastMCP, test servers and mcptest.io."
relatedSlugs:
  - mcp-inspector-alternatives
  - mcptest-vs-mcp-inspector
  - mcptest-vs-glama-inspector
  - test-mcp-server-with-curl-and-postman
  - mock-mcp-servers-for-testing-clients
  - test-remote-mcp-server-in-ci
  - testing-guide
  - test-mcp-server-before-deploying
sourceLinks:
  - title: "MCP Inspector overview"
    url: "https://modelcontextprotocol.io/docs/tools/inspector"
  - title: "MCP Inspector: CLI client"
    url: "https://modelcontextprotocol.io/docs/2026-07-28/tools/inspector/cli"
  - title: "MCP Inspector: Authorization"
    url: "https://modelcontextprotocol.io/docs/2026-07-28/tools/inspector/authorization"
  - title: "MCP Inspector license"
    url: "https://github.com/modelcontextprotocol/inspector/blob/main/LICENSE"
  - title: "MCP Inspector source: tool output validation"
    url: "https://github.com/modelcontextprotocol/inspector/blob/main/core/mcp/toolOutputValidation.ts"
  - title: "MCPJam: Installation"
    url: "https://docs.mcpjam.com/installation"
  - title: "MCPJam: Hosted app"
    url: "https://docs.mcpjam.com/hosted/overview"
  - title: "MCPJam: Clients"
    url: "https://docs.mcpjam.com/inspector/clients"
  - title: "MCPJam: Evaluate"
    url: "https://docs.mcpjam.com/inspector/evals"
  - title: "MCPJam: CI / CD"
    url: "https://docs.mcpjam.com/cli/ci"
  - title: "MCPJam Inspector repository"
    url: "https://github.com/MCPJam/inspector"
  - title: "MCP Playground Online"
    url: "https://mcpplaygroundonline.com/"
  - title: "MCP Playground: Mock MCP servers"
    url: "https://mcpplaygroundonline.com/mock-mcp-servers"
  - title: "Glama: MCP Inspector"
    url: "https://glama.ai/mcp/inspector"
  - title: "Cloudflare: Test a remote MCP server"
    url: "https://developers.cloudflare.com/agents/model-context-protocol/guides/test-remote-mcp-server/"
  - title: "Postman: MCP requests overview"
    url: "https://learning.postman.com/docs/use/send-requests/protocols/mcp-requests/overview/"
  - title: "Postman: Debug OAuth 2.1 authentication"
    url: "https://learning.postman.com/docs/use/send-requests/protocols/mcp-requests/oauth-debugger/"
  - title: "Postman CLI: Run a collection"
    url: "https://learning.postman.com/docs/postman-cli/postman-cli-run-collection/"
  - title: "Postman pricing"
    url: "https://www.postman.com/pricing/"
  - title: "Insomnia: MCP clients"
    url: "https://developer.konghq.com/insomnia/mcp-clients-in-insomnia/"
  - title: "Insomnia pricing"
    url: "https://insomnia.rest/pricing"
  - title: "MCP conformance suite repository"
    url: "https://github.com/modelcontextprotocol/conformance"
  - title: "YawLabs mcp-compliance repository"
    url: "https://github.com/YawLabs/mcp-compliance"
  - title: "PMCP mcp-tester README"
    url: "https://github.com/paiml/rust-mcp-sdk/blob/main/crates/mcp-tester/README.md"
  - title: "cargo pmcp loadtest"
    url: "https://github.com/paiml/rust-mcp-sdk/blob/main/cargo-pmcp/docs/commands/loadtest.md"
  - title: "Specmatic: MCP Auto Test"
    url: "https://docs.specmatic.io/getting_started/mcp_auto_test"
  - title: "Specmatic source: mcp test command"
    url: "https://github.com/specmatic/specmatic/blob/main/application/src/main/kotlin/application/mcp/McpTestCommand.kt"
  - title: "Specmatic: MCP Auto-Test walkthrough"
    url: "https://specmatic.io/demonstration/testing-mcp-servers-how-specmatic-mcp-auto-test-catches-schema-drift-and-automates-regression/"
  - title: "steviec/mcp-server-tester repository"
    url: "https://github.com/steviec/mcp-server-tester"
  - title: "r-huijts/mcp-server-tester repository"
    url: "https://github.com/r-huijts/mcp-server-tester"
  - title: "FastMCP: Testing your FastMCP server"
    url: "https://gofastmcp.com/docs/servers/testing"
  - title: "FastMCP: Client transports (in-memory)"
    url: "https://gofastmcp.com/docs/clients/transports"
  - title: "DeepEval: Model Context Protocol"
    url: "https://deepeval.com/docs/evaluation-mcp"
  - title: "DeepEval: MCP-Use metric"
    url: "https://deepeval.com/docs/metrics-mcp-use"
  - title: "MCP everything server"
    url: "https://github.com/modelcontextprotocol/servers/tree/main/src/everything"
  - title: "DLP Test: MCP server test"
    url: "https://dlptest.com/mcp/"
  - title: "plexara/mcp-test repository"
    url: "https://github.com/plexara/mcp-test"
  - title: "mcptest.io repository"
    url: "https://github.com/integry/mcptest"
  - title: "mcptest.io headless CLI and CI release gate"
    url: "https://github.com/integry/mcptest/blob/master/docs/headless-release-gate.md"
---

"MCP testing tool" covers several different jobs: poking at a server by hand, checking a deployed endpoint, gating a release in CI, measuring whether a model uses the tools well, load testing, and giving a client something to connect to. No tool does all of them. This page groups the tools that come up most often by job and says what each one tests, where it runs, how you install it, whether it is open source and what it costs where the vendor publishes a price.

mcptest.io is our product; it is listed with the others, limits included. Every entry was checked against the tool's own site, documentation, repository or source on November 11, 2026, and the links are under sources. Where we could not confirm something, the table says "not documented" rather than guessing. Tools change quickly, so check the date before you rely on a detail.

## Quick pick

| If you need to… | Use |
| --- | --- |
| Debug a local stdio server | [MCP Inspector](#mcp-inspector) (web UI, CLI or terminal UI) |
| Check a remote server with nothing to install | [mcptest.io](#mcptestio), [MCP Playground Online](#mcp-playground-online), [Glama](#glama-inspector) or [MCPJam's hosted app](#mcpjam) |
| Know whether browser-based clients can reach the server (CORS) | [mcptest.io](#mcptestio), which connects from the browser itself |
| Step through an OAuth flow | MCPJam's or Postman's OAuth debuggers, or the MCP Inspector |
| Keep MCP requests next to existing API collections | [Postman](#postman) or [Insomnia](#insomnia) |
| See a model call your remote tools within a minute | [Cloudflare Workers AI Playground](#cloudflare-workers-ai-playground) |
| Gate CI on protocol behaviour | [conformance suite](#official-conformance-suite) (SDK authors), [mcp-compliance](#yawlabs-mcp-compliance), [PMCP mcp-tester](#pmcp-mcp-tester) or the Inspector CLI |
| Catch tools whose behaviour no longer matches their schema | [Specmatic MCP Auto-Test](#specmatic-mcp-auto-test) |
| Unit-test a Python FastMCP server without a network | [FastMCP's in-memory client](#fastmcp-in-memory-client) |
| Measure whether models pick the right tool with the right arguments | [MCPJam evals](#mcpjam-evals) or [DeepEval](#deepeval) |
| Load-test a server | [cargo pmcp loadtest](#cargo-pmcp-loadtest) |
| Give an MCP client a server to test against | [everything server, hosted mocks or DLP Test](#test-and-mock-servers) |
| Hand someone a report or block a release | [mcptest.io](#mcptestio) public reports and GitHub Action |

## How to read the tables

"What it tests" uses six labels: **protocol** (handshake, listing and calling), **auth** (OAuth or tokens), **contract** (schemas and declared versus actual behaviour), **evals** (model behaviour with your tools), **load** and **client** (testing an MCP client rather than a server). "Remote vs local" says which servers a tool can reach: a stdio server is a local process the tool has to launch, which no web page can do. Prices are the vendor's published figures on the review date.

## Browser testers

These need no install. All of them reach remote servers only; none can start a stdio process.

| Tool | What it tests | Remote vs local | Install | Open source | Price |
| --- | --- | --- | --- | --- | --- |
| **mcptest.io** | Protocol, auth, contract (output schemas), browser CORS | Remote HTTP; localhost only over a direct browser connection | None | Yes, MIT | Free |
| **MCP Playground Online** | Protocol, evals, security scan | Remote in the browser; stdio and localhost in its desktop app | None; optional desktop app | No source published | Browser tools free; desktop app needs a paid plan after a 7-day trial |
| **Glama inspector** | Protocol, auth | Remote Streamable HTTP and SSE | None, no account | No source published | Free; chat needs sign-in and uses Glama tokens |
| **MCPJam hosted app** | Protocol, auth, evals | HTTPS servers only | None | Yes, Apache-2.0 | Free daily allowance; paid credits beyond it |
| **Cloudflare Workers AI Playground** | Model chat with your tools | Remote by URL | None | Not documented | Not documented |

### mcptest.io

A browser playground, inspector and report for remote MCP servers. It negotiates the 2026 stateless protocol and 2025 sessions, runs OAuth 2.1 with PKCE (pre-registered client, Client ID Metadata Document or dynamic registration), accepts a bearer token or API key, calls tools, and checks every result's `structuredContent` against the tool's `outputSchema`. It connects from your browser first and records whether cross-origin requests and response headers were readable, which tells you whether web-based clients will work, then falls back to a proxy. Each endpoint gets a public report URL, JSON and Markdown export and a README badge, and the [catalog](/catalog) tracks 306 public servers. The same evaluator runs in CI as the `integry/mcptest` GitHub Action or a headless CLI.

**Limits.** It cannot launch stdio servers, and it reaches a localhost HTTP server only if the browser connects directly (CORS plus the browser's local-network permission). It has no language model, so no chat or evals. There is no free-form custom header editor. The headless CLI cannot establish browser CORS evidence or complete interactive OAuth, and its project documentation says it is not a spec conformance certification or a load test. Anonymous use of the CORS proxy is rate-limited.

### MCP Playground Online

[MCP Playground Online](https://mcpplaygroundonline.com/) bundles an online inspector, a server tester, evals, a security scanner and an agent studio for trying many models, plus hosted mock servers for client testing (see [test servers](#test-and-mock-servers)). A desktop app for macOS and Windows adds stdio and localhost servers.

**Limits.** Its inspector documents a bearer token field but not OAuth, the desktop app is part of the paid plans after a trial, and no source code is published. The JSON-RPC log can be exported as JSON, but there is no documented CI path.

### Glama inspector

A free page on glama.ai that connects to Streamable HTTP and SSE servers with OAuth 2.1 (PKCE and dynamic registration), bearer tokens or custom headers, and shows raw JSON-RPC traffic. The configuration is stored in the page URL, so a setup is easy to bookmark.

**Limits.** It does not report what the browser saw about CORS, and its page does not describe output validation, exports or CI. The URL can carry credentials, so clean it before sharing. Its page documents an `mcp-proxy --tunnel` command for stdio servers that the current `mcp-proxy` release no longer has. [mcptest.io vs Glama](/learn/mcptest-vs-glama-inspector) compares the two in detail.

### Cloudflare Workers AI Playground

Cloudflare's guide to testing a remote MCP server uses the [Workers AI Playground](https://playground.ai.cloudflare.com/): enter the server URL, connect, sign in if the server asks, and a Workers AI model can call your tools in chat.

**Limits.** It is a chat client, not an inspector. It is not built to show raw protocol messages, run negative tests or produce a report.

MCPJam's hosted app is covered with its desktop and CLI versions [below](#mcpjam).

## Local inspectors and API clients

These run on your machine, so most can launch a stdio server as well as reach remote ones.

| Tool | What it tests | Remote vs local | Install | Open source | Price |
| --- | --- | --- | --- | --- | --- |
| **MCP Inspector** | Protocol, auth, contract (output schemas, in source) | stdio, Streamable HTTP and SSE | `npx`, Node 22.19 or newer | Yes, Apache-2.0 (older contributions MIT during relicensing) | Free |
| **MCPJam** | Protocol, auth, evals, client emulation | Desktop and terminal: stdio, HTTP and HTTPS | Desktop app (macOS, Windows), `npx`, Docker, or hosted | Yes, Apache-2.0 | Free to start; model usage has a daily allowance and paid credits |
| **Postman** | Protocol, auth | stdio and Streamable HTTP | Postman app and account | No | Free plan; Solo $9 per month, Team $19 per user per month, billed annually |
| **Insomnia** | Protocol, auth | Remote URLs documented; stdio not documented | Insomnia desktop app | Yes, Apache-2.0 | Free plan; paid plans per user |

### MCP Inspector

The official inspector ships one package, `@modelcontextprotocol/inspector`, with three clients that share connection code and OAuth state: a web UI (the default), a scriptable CLI (`--cli`) and a terminal UI (`--tui`). It launches stdio servers from a command and connects to remote ones by URL.

**Strengths.** It covers almost every protocol feature, including tasks, subscriptions and MCP Apps, and its OAuth support is the broadest here, including enterprise-managed authorization. The CLI runs one request per invocation, prints JSON with `--format json` and exits with distinct codes, which suits CI and coding agents. **Limits.** It needs a recent Node.js. The web UI's Node backend makes the connections, so it says nothing about browser CORS, and it produces logs rather than a shareable report. [mcptest.io vs MCP Inspector](/learn/mcptest-vs-mcp-inspector) goes further.

### MCPJam

An open-source inspector that runs as a hosted web app, a desktop app, a terminal command (`npx @mcpjam/inspector@latest`) or a Docker image. It has a step-by-step OAuth debugger, chat with frontier models against your tools, and **Clients**: saved configurations of protocol versions, `clientInfo`, capabilities and MCP App sandbox settings that imitate hosts such as Claude Desktop, ChatGPT or Cursor, so you can see how a server behaves for each.

**Limits.** The hosted app accepts HTTPS URLs only and cannot reach `localhost`; use the desktop or terminal version for local work. Model usage beyond the daily allowance costs credits. Its eval features are covered under [evals](#mcpjam-evals).

### Postman

Postman's MCP request type connects over stdio or Streamable HTTP, lists tools, prompts and resources and calls them from a form. Its OAuth debugger walks through each phase of the OAuth 2.1 flow and marks the step that fails.

**Limits.** The Postman CLI skips MCP requests when it runs a collection, so there is no CI path for them. It is a commercial product and not open source. [Testing with curl and Postman](/learn/test-mcp-server-with-curl-and-postman) has the steps.

### Insomnia

Kong's open-source API client has **MCP Clients**: enter a server URL, connect, and call the discovered tools, prompts and resources, with a console of raw requests and responses. It follows the MCP auth flow from a `401`, supports elicitation and sampling, and stores MCP clients in projects that can sync through Git.

**Limits.** Its documentation describes remote URLs, not stdio, and does not describe running MCP clients from its CLI.

## CI, conformance and contract testing

These are command-line tools and libraries you run in a pipeline. They check behaviour against the specification, against the server's own schemas, or against tests you write.

| Tool | What it tests | Remote vs local | Install | Open source | Price |
| --- | --- | --- | --- | --- | --- |
| **Conformance suite** | Protocol and auth scenarios; client mode tests clients | A running server by URL, or your client against its test server | `npx @modelcontextprotocol/conformance` | Yes, MIT | Free |
| **mcp-compliance** | Protocol: 88 tests for 2025-11-25, 103 for 2026-07-28, graded A to F | stdio and HTTP | `npx @yawlabs/mcp-compliance`, Node 20 or newer; Docker | Yes, MIT | Free |
| **PMCP mcp-tester** | Protocol, conformance, schema warnings, MCP Apps, scenarios | HTTP, HTTPS, WebSocket and stdio | `cargo install mcp-tester` or a prebuilt binary | Yes, MIT | Free |
| **Specmatic MCP Auto-Test** | Contract: generated calls from input schemas, output schema checks, negative tests | Streamable HTTP by URL | Docker image or Specmatic CLI | Yes, MIT | Free |
| **steviec/mcp-server-tester** | Protocol (YAML tool tests), evals | stdio only | `npx mcp-server-tester`, Node 18 or newer | Yes, MIT | Free; evals need an Anthropic API key |
| **r-huijts/mcp-server-tester** | Protocol: Claude-generated tool tests with response rules | stdio only | Clone and build, Node 18 or newer | Yes, MIT | Free; needs an Anthropic API key |
| **FastMCP in-memory client** | Unit tests of tools, resources and prompts | Same Python process, no transport | `pip install fastmcp` | Yes, Apache-2.0 | Free |

### Official conformance suite

`@modelcontextprotocol/conformance` is the MCP project's own test framework. Each run tests one side: it connects to a running server, or it starts a test server for each scenario and runs your client against it. It is the only tool here that tests clients as well as servers, and its expected-failures baseline makes a precise CI gate.

**Limits.** It is written for SDK and framework authors. Many server scenarios expect specific test tools such as `test_simple_text`, so running it against an ordinary production server reports failures that are not bugs. The latest npm release is still 0.x.

### YawLabs mcp-compliance

A command-line grader that detects which protocol revision a server speaks and grades it A to F. It accepts stdio commands and HTTP URLs, writes JSON, SARIF, Markdown and HTML, gives every test an explanation and a fix recipe, and has `--strict` and `--min-grade` exit codes plus a GitHub Action. A `benchmark` command measures latency (see [load testing](#load-testing)).

**Limits.** It does not run an OAuth flow, so a protected server needs a token you get elsewhere. Its CORS checks read headers from a Node process, which is not what a browser enforces.

### PMCP mcp-tester

A Rust CLI from Pragmatic AI Labs' `rust-mcp-sdk`. `quick` checks connectivity, `test` runs the full suite, `conformance` runs 19 scenarios across five domains, and `--dual-run` compares a server's 2025-11-25 and 2026-07-28 behaviour. Other commands validate tool schemas, inspect MCP App metadata (with a Claude Desktop mode), generate and run YAML scenarios, diagnose a connection layer by layer and compare two servers. It supports interactive OAuth with PKCE, a bearer credential, `--format json` and deterministic exit codes, and `--dump-wire` prints every HTTP exchange with credentials redacted.

**Limits.** It is a terminal tool with no shareable report. Install is through Cargo or the project's install script.

### Specmatic MCP Auto-Test

`specmatic mcp test`, part of the open-source Specmatic CLI and its `specmatic/specmatic` Docker image. It reads `tools/list`, generates calls for every tool from the input schema, fills values from a JSON "dictionary" you supply, and reports which calls failed. Its walkthrough describes validating responses against declared output schemas. `--enable-resiliency-tests` adds valid permutations (every enum value, optional fields) and deliberately invalid inputs that the server should reject. The point is schema drift: a tool that needs an argument its schema calls optional shows up as a failing test.

**Limits.** In source, the only transport is Streamable HTTP and the only auth option is `--bearer-token`. Generated calls really execute, so point it at a staging server if tools change data.

### steviec/mcp-server-tester

Runs YAML-defined tool tests against a server it launches, and an `evals` command that checks whether Claude uses the tools as intended. It writes JSON and JUnit XML and exits 1 on failure.

**Limits.** Its HTTP transport throws "not yet implemented", so it tests local stdio servers only. Its compliance command is marked as work in progress, evals need an Anthropic API key and cost API usage, and the last release (1.4.1) was in September 2025. The npm package `mcp-server-tester` is this project, not the next one.

### r-huijts/mcp-server-tester

A configuration-driven tester that lists a server's tools, asks Claude to write test cases with the natural-language query that would trigger each tool, runs them, checks responses against configurable rules and writes console, JSON, HTML or Markdown reports.

**Limits.** Its README labels it work in progress for non-production use, it is installed by cloning and building, the client code launches servers over stdio only, and test generation needs an Anthropic API key. The last commit was in May 2025.

### FastMCP in-memory client

If your server is built with FastMCP in Python, its documentation recommends wrapping the server object in `Client(mcp)` inside a pytest fixture. The in-memory transport talks to the server in the same process, with no subprocess or network, so tests of tools, resources and prompts are fast and need no running server.

**Limits.** It only applies to FastMCP servers, and because there is no transport it does not test HTTP behaviour, auth, sessions or CORS. Pair it with one of the tools above against the deployed endpoint.

The MCP Inspector CLI, MCPJam's CLI and the mcptest.io GitHub Action also run in CI; [testing a remote MCP server in CI](/learn/test-remote-mcp-server-in-ci) shows how to combine them.

## Evals

Evals ask a different question: given your tools, does a model choose the right one with sensible arguments and finish the task? They need a model, so they cost model usage.

| Tool | What it tests | Remote vs local | Install | Open source | Price |
| --- | --- | --- | --- | --- | --- |
| **MCPJam evals** | Tool choice across models; deterministic assertions plus optional LLM-as-judge | Any server MCPJam can reach | App, CLI (`mcpjam test`), SDK, GitHub Checks | Yes, Apache-2.0 | Free daily allowance; paid credits |
| **DeepEval** | MCP-Use, Multi-Turn MCP-Use and MCP Task Completion metrics | Any: you pass in the calls your app made | `pip install deepeval` | Yes, Apache-2.0 | Free library; the default LLM-as-a-judge mode calls a model |

### MCPJam evals

You write test cases for your server, run them across models and gate pass or fail on assertions about the tools called, optionally adding an LLM judge. The CLI runs suites locally or in CI with JUnit and HTML output, and GitHub Checks can run a suite against the server built from each pull request.

### DeepEval

DeepEval is a Python evaluation framework. For MCP you describe the server (its tools, resources and prompts, taken from the official Python SDK's `ClientSession`) and record which tools, resources and prompts your app called for a given input. Its MCP metrics then score whether the right primitives were used with good arguments and whether the task was completed, and it runs as unit tests in CI.

**Limits.** It does not connect to your server or check the protocol: it evaluates an MCP-powered application from data you collect. That makes it a fit for agent builders rather than server authors who want a quick check.

steviec's `evals` command and MCP Playground's evals also cover this job.

## Load testing

Most tools on this page send one request at a time. For concurrency and latency under load there is less choice.

| Tool | What it tests | Remote vs local | Install | Open source | Price |
| --- | --- | --- | --- | --- | --- |
| **cargo pmcp loadtest** | Load: virtual users, staged ramps, latency percentiles, throughput, error rates | Server URL | `cargo install cargo-pmcp` | Yes, MIT | Free |
| **mcp-compliance benchmark** | Latency over a set number of requests and concurrency | stdio command in the documented example | `npx @yawlabs/mcp-compliance` | Yes, MIT | Free |

### cargo pmcp loadtest

Part of the PMCP toolkit. `cargo pmcp loadtest init <url>` writes a TOML scenario with a weighted mix of MCP operations, such as 80% `tools/call` and 20% `resources/list`; `cargo pmcp loadtest run <url> --vus 20 --duration 60` runs it. It shapes load in ramp-up, hold and ramp-down stages, reports latency percentiles, throughput, error rate and a per-tool breakdown, can look for the point where the server breaks, and writes a versioned JSON report for CI. It accepts an API key or OAuth.

Run it against a staging deployment: a load test with `tools/call` executes your tools many times. Generic HTTP load tools can also drive an MCP endpoint, but you have to script the handshake and headers yourself.

## Test and mock servers

If you build an MCP client, a gateway or a security product, you need a server to point it at. [Mock MCP servers for testing clients](/learn/mock-mcp-servers-for-testing-clients) covers what to simulate and includes a minimal mock you own.

| Server | What it is for | Where it runs | Auth | Open source |
| --- | --- | --- | --- | --- |
| **Everything server** | Every protocol feature, for client builders | Local: stdio or Streamable HTTP (`npx @modelcontextprotocol/server-everything`) | None | Yes |
| **MCP Playground mock servers** | Six hosted mocks: echo, bearer auth, configurable errors, complex schemas, MCP Apps, 2026 stateless | Hosted | Bearer token on the auth mock | No source published |
| **DLP Test** | Fake PII, PCI and PHI generators for testing data-loss-prevention products | Hosted at `https://mcp.dlptest.com/api/mcp/` | None | Not documented |
| **plexara/mcp-test** | Twelve deterministic tools (echo, headers, sized responses, errors, slow and flaky calls, progress) for testing gateways | Self-hosted Go binary or container | API keys or OIDC, with protected resource metadata | Yes, Apache-2.0 |

DLP Test answered an `initialize` request on the review date with protocol version 2025-06-18 and `Access-Control-Allow-Origin: *`, and its page says nothing sent to it is stored or logged. All of its data is fake, but treat any hosted mock as someone else's service: for CI, run one you control. plexara/mcp-test records every call in a Postgres audit log with a web portal for inspecting and comparing calls; it speaks Streamable HTTP only.

## Which to pick

- **A local stdio server under development:** the MCP Inspector, with FastMCP's in-memory client for unit tests if you use FastMCP. mcp-compliance or PMCP mcp-tester add a spec check. When you deploy, see [converting a stdio server to remote](/learn/convert-local-stdio-mcp-server-to-remote).
- **A remote server before launch:** mcptest.io for browser CORS, OAuth, output contracts and a report; Specmatic for schema drift across every tool; MCPJam to watch models use the tools. The [pre-deployment checklist](/learn/test-mcp-server-before-deploying) lists the full pass.
- **A CI gate:** the conformance suite for SDKs and frameworks; mcp-compliance, PMCP mcp-tester or the Inspector CLI for spec checks on your own server; MCPJam or DeepEval for evals; the mcptest.io GitHub Action for a ready, review or blocked release decision.
- **Load:** cargo pmcp loadtest against staging.
- **An MCP client:** the conformance suite's client mode, the everything server and hosted mocks.
- **No install allowed:** mcptest.io, MCP Playground Online, Glama or MCPJam's hosted app; [MCP Inspector alternatives](/learn/mcp-inspector-alternatives) compares them on install, OAuth, CI and cost.

Most teams use two or three: one for local development, one for the deployed endpoint, and one in CI.

## FAQ

### What is the best tool to test an MCP server?

It depends on the job. For a local stdio server, the official MCP Inspector. For a deployed server you want to check from a browser, a browser tester such as mcptest.io. For CI, a command-line suite such as mcp-compliance, PMCP mcp-tester or the conformance suite. For model behaviour, MCPJam or DeepEval evals.

### Can I test an MCP server online without installing anything?

Yes, if the server is remote: mcptest.io, MCP Playground Online, the Glama inspector, MCPJam's hosted app and Cloudflare's Workers AI Playground all run in the browser. None can start a local stdio process; for that, use the Inspector or a desktop app.

### Which MCP testing tools work in CI?

The MCP Inspector CLI, the conformance suite, mcp-compliance, PMCP mcp-tester, Specmatic, steviec/mcp-server-tester, MCPJam's CLI, DeepEval and the mcptest.io GitHub Action. The Postman CLI skips MCP requests.

### How do I load-test an MCP server?

Use `cargo pmcp loadtest` for virtual users, ramps and latency percentiles, or mcp-compliance's `benchmark` for a simple latency run. Test a staging deployment, because tool calls really execute.

### Is there a public MCP server I can test my client against?

Yes. The MCP project's everything server runs locally and implements every feature. Hosted options include MCP Playground's mock servers and DLP Test's server at `https://mcp.dlptest.com/api/mcp/`. For a gateway, plexara/mcp-test is a self-hosted server with failure and latency tools.

### What can't mcptest.io do?

It cannot launch stdio servers, run a model, send arbitrary custom headers or load-test, and its headless CLI cannot do interactive OAuth or browser CORS checks. Use the tools above for those jobs.

## Try it on a real server

[Open DeepWiki in the mcptest.io playground](/server/mcp.deepwiki.com/mcp/mcp), a public catalog server that needs no sign-in. Call one of its tools, generate the report, and then open the same URL in another tool from this page to compare what each one shows.
