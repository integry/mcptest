---
title: Building a remote MCP server with Claude Code or Codex
navTitle: Build with a coding agent
summary: A practical loop for building a remote MCP server with a coding agent, with a starting prompt, an AGENTS.md or CLAUDE.md validation section, a way to feed mcptest findings back, and the mistakes agents make most.
track: build
level: practitioner
order: 23
category: Agent-assisted development
readingTimeMinutes: 7
lastReviewed: "2026-10-20"
metaTitle: Build an MCP Server with Claude Code or Codex | mcptest.io
metaDescription: Build a remote MCP server with Claude Code or Codex. A starting prompt, an AGENTS.md validation loop with the mcptest release gate and its exit codes, and what agents get wrong.
relatedSlugs:
  - test-mcp-server-before-deploying
  - convert-local-stdio-mcp-server-to-remote
  - mcp-tool-output-schemas-and-structured-content
  - mcp-cors-headers-for-browser-clients
sourceLinks:
  - title: "Codex: custom instructions with AGENTS.md"
    url: "https://developers.openai.com/codex/guides/agents-md"
  - title: "Claude Code: how Claude remembers your project (CLAUDE.md and AGENTS.md)"
    url: "https://code.claude.com/docs/en/memory"
  - title: "TypeScript SDK v2: serve over HTTP"
    url: "https://ts.sdk.modelcontextprotocol.io/v2/serving/http"
  - title: "Python SDK v2: structured output"
    url: "https://py.sdk.modelcontextprotocol.io/servers/structured-output/"
  - title: mcptest headless CLI and CI release gate
    url: "https://github.com/integry/mcptest/blob/master/docs/headless-release-gate.md"
---

A coding agent can write a working MCP server in minutes. What it cannot see is the wire: which headers a browser preflight sends, which `Accept` values a real client uses, whether a session id is readable cross-origin, whether a tool's result still matches the schema it advertises. Those are exactly the failures that pass the agent's own unit tests and fail in a real client. The fix is to give the agent an external check it can run, with exit codes it can act on.

## The loop

1. Write a starting prompt that fixes the SDK versions, transport, authorization, and output schemas before any code exists.
2. Put the validation procedure in `AGENTS.md` so every session, and every agent, runs the same check.
3. Let the agent build and run the server locally.
4. Run the mcptest release gate against the local endpoint.
5. Feed the report's priorities back to the agent, highest severity first.
6. Repeat until the gate passes, then add the same gate to CI.

## A starting prompt that pins transport, auth, and output schemas

Agents default to whatever was most common in their training data, which for MCP means v1 SDK imports, the deprecated HTTP+SSE transport, and session maps copied from 2025 tutorials. State the current choices explicitly:

```text
Build a remote MCP server for <domain> in TypeScript.

SDK and transport
- Use the v2 SDK packages: @modelcontextprotocol/server, @modelcontextprotocol/express,
  @modelcontextprotocol/node, with zod/v4 schemas. Do not use @modelcontextprotocol/sdk (v1),
  server.tool(), StreamableHTTPServerTransport, or SSEServerTransport.
- Serve Streamable HTTP at POST /mcp with createMcpHandler(factory). Build a new McpServer
  inside the factory for every request. Keep database pools at module scope.
- Serve 2026-07-28 clients statelessly and 2025 clients with the SDK default
  (legacy: 'stateless'). No in-memory session map and no module-level per-user state;
  pass server-minted ids as tool arguments instead.
- Do not add your own Accept or Content-Type checks. The SDK enforces them.
- Use createMcpExpressApp({ host: '0.0.0.0', allowedHosts: [...] }) with the public hostname.

Browser access
- Add CORS for the origins https://mcptest.io and <your app origin>. Allow the methods
  GET, POST, DELETE, OPTIONS. Allow the headers Content-Type, Accept, Authorization,
  MCP-Protocol-Version, Mcp-Method, Mcp-Name, Mcp-Session-Id, Last-Event-ID.
  Expose Mcp-Session-Id, MCP-Protocol-Version, WWW-Authenticate, Retry-After.
  Register CORS before authentication so preflights never need a token.

Authorization
- The server is an OAuth resource server. Verify bearer tokens with requireBearerAuth,
  set expectedResource to the public /mcp URL, and publish Protected Resource Metadata
  with mcpAuthMetadataRouter. Never put tokens in URLs or logs.

Tools
- Every tool declares inputSchema and outputSchema. Every successful result returns
  structuredContent that matches outputSchema, plus the same JSON as a text content block.
- Failures the model can correct return isError: true with a short explanation.
- Constrain inputs: lengths, enums, formats, and no unknown properties.

Validation
- Follow the "Validating the MCP endpoint" section of AGENTS.md before declaring any task done.
```

For Python, replace the SDK section with: use `mcp` 2.x and `from mcp.server import MCPServer` (not `FastMCP`), declare return types so the SDK derives `outputSchema`, serve `mcp.streamable_http_app(transport_security=...)` with the public hostname allowlisted, and add Starlette's `CORSMiddleware` with the same header lists.

## Tell the agent how to validate the endpoint

Codex reads `AGENTS.md` from the project root down to the working directory. Claude Code can read a repository's `AGENTS.md` in place of `CLAUDE.md`, and a `CLAUDE.md` can import it with `@AGENTS.md`, so one file serves both. Add a section like this:

````markdown
## Validating the MCP endpoint

The release gate is the mcptest headless CLI. It needs a checkout of
https://github.com/integry/mcptest with `npm ci` run once; this repo expects it at ../mcptest.

1. Start the server: `npm run dev` (listens on http://127.0.0.1:3000/mcp).
2. Run the gate from this repository:

   ```bash
   npm --prefix ../mcptest run mcptest -- \
     --output-dir "$PWD/mcptest-reports" \
     http://127.0.0.1:3000/mcp
   ```

3. Read the exit code:
   - 0: passed. The release decision is ready or review with no high or critical priority.
   - 1: failed a threshold. Read the priorities in mcptest-reports/*.json and fix them,
     highest severity first. Rerun until the exit code is 0.
   - 2: the endpoint requires authorization. Export a test token and rerun with
     `--bearer-token-env MCPTEST_BEARER_TOKEN`. Never put a token on the command line.
   - 3: the command or URL is wrong. Fix the invocation; do not change the server.
   - 4: the evaluator crashed or could not write reports. Stop and report the output.
4. Never lower thresholds, delete reports, or edit report files to make the gate pass.
5. Reference each priority id (for example transport.accept-header-406) in the commit
   message that fixes it.
````

With a single endpoint the reports are `mcptest-reports/mcptest-<host>-report.json` and `.md`. The gate cannot test browser CORS or run interactive OAuth from Node, so those two areas stay unknown in headless reports; a `review` result for them is expected, and exit code 0 is still a pass.

## Feed the report's findings back

The JSON report's `releaseDecision` holds the status and a sorted list of priorities, each with a stable `id`, `severity`, `detail`, and `remediation`. Give the agent only that part, not the whole report:

```bash
node -e '
const report = require(process.argv[1]);
const { status, priorities } = report.releaseDecision;
console.log(JSON.stringify({
  status,
  priorities: priorities
    .filter(p => p.severity !== "unknown")
    .map(({ severity, id, title, detail, remediation }) => ({ severity, id, title, detail, remediation })),
}, null, 2));
' "$PWD/mcptest-reports/mcptest-127.0.0.1-report.json"
```

Then ask for one change per priority:

```text
The mcptest release gate returned the priorities below. Fix them in order, starting with
critical and high. For each one, explain the cause in one sentence, make the smallest
change that removes it, and rerun the gate. Do not change thresholds or tests to hide a
finding. If a priority is about browser CORS or host behavior the gate cannot observe,
say so and leave it for manual review.

<paste the JSON>
```

Unknown-severity priorities are usually observations a single run cannot establish, such as whether a host-compatibility profile needs session behavior that was never exercised. Filter them out of the agent's queue and review them yourself.

For browser-only problems, run the endpoint once in the playground. When a connection fails there, the transport diagnostics panel lists each diagnostic with the requests that prove it, a "How to fix" summary, and code hints for the TypeScript SDK, the Python SDK, and Cloudflare Workers. Paste those three parts into the conversation verbatim.

## What agents get wrong most often

### Accept headers

Agents often add their own check, such as `req.headers.accept !== 'application/json, text/event-stream'`, or write a test client that sends `Accept: application/json` only. Exact string comparisons reject valid headers that list both types in another order or with parameters, and the SDKs already enforce the rule. The TypeScript SDK's 2025 path returns `406` unless both types appear, and the Python SDK returns `406` on either path when the header names only one of them. Delete hand-written checks and make every test request send `Accept: application/json, text/event-stream`. [The 406, 415, and 405 guide](/learn/mcp-406-not-acceptable-415-and-405) has the exact behavior per SDK.

### Session handling

Code generated from 2025 tutorials keeps a global map of transports keyed by `Mcp-Session-Id`, or creates one `McpServer` at module scope and connects it on every request. The v2 per-request factory rejects the second pattern with "The factory returned an instance that is still serving another request". Ask for a new instance per request, and move state that must survive between calls into storage or explicit handles. If a 2025 session is really required, have the agent follow the SDK's legacy-clients guide rather than improvise one.

### CORS

The usual misses are `Mcp-Method` and `Mcp-Name` absent from `Access-Control-Allow-Headers` (copied from 2025 examples), nothing in `Access-Control-Expose-Headers`, authentication middleware registered before CORS so the preflight gets `401`, and `Access-Control-Allow-Headers: *` in the belief that it covers `Authorization`. It does not; `Authorization` must be listed by name. The [CORS reference](/learn/mcp-cors-headers-for-browser-clients) has the complete set.

### Output schema drift

An agent changes what a handler returns and forgets the schema, or the reverse. Zod object schemas are emitted with `additionalProperties: false`, so one added field breaks the contract. Numbers serialized as strings, `null` for a non-nullable field, and a Python tool returning a bare scalar that the SDK wraps as `{"result": ...}` are the other frequent causes. Both SDKs turn the violation into an `isError: true` result on the server, so a test that only checks for a non-error result catches it, but only if every tool is called. Require a test that calls each tool through the SDK client. [Output schemas and structured content](/learn/mcp-tool-output-schemas-and-structured-content) covers the rules.

### Outdated SDK APIs

`@modelcontextprotocol/sdk/server/mcp.js`, `server.tool(...)`, `new StdioServerTransport()` with `server.connect()`, `SSEServerTransport`, and `from mcp.server.fastmcp import FastMCP` are v1 spellings. Pin the package versions in `package.json` or `pyproject.toml` before the first prompt, and keep the "do not use" list in the starting prompt.

## Add the release gate to CI

Once the local loop passes, run the same command in CI against the staging deployment, between "staging is up" and "promote to production". Keep the default thresholds, which fail on `blocked`, `unknown`, and any high or critical priority, and upload `mcptest-reports/` with `if: always()` so a failing gate can be handed straight back to the agent.
