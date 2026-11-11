---
title: "How to Test MCP Servers: A Complete Guide"
navTitle: Testing Guide
summary: "Test an MCP server at every level: unit tests with in-memory transports, protocol checks with curl, the browser playground and MCP Inspector, OAuth, CORS, schemas, security and CI, with a pre-release checklist."
track: build
level: practitioner
order: 1
category: Testing
readingTimeMinutes: 14
lastReviewed: "2026-11-11"
path: /docs/testing-guide
metaTitle: "How to Test MCP Servers: Complete Guide with curl, Inspector and CI | mcptest.io"
metaDescription: "How to test MCP servers: unit tests, protocol checks with curl, the browser playground and MCP Inspector, OAuth, CORS, tool schemas, security and CI, plus a checklist."
relatedSlugs:
  - test-mcp-server-before-deploying
  - test-remote-mcp-server-in-ci
  - troubleshooting
  - mcp-http-headers-reference
  - best-remote-mcp-testing-tools
  - remote-vs-local
sourceLinks:
  - title: MCP 2026-07-28 specification
    url: "https://modelcontextprotocol.io/specification/2026-07-28"
  - title: "TypeScript SDK: protocol version guide"
    url: "https://github.com/modelcontextprotocol/typescript-sdk/blob/main/docs/protocol-versions.md"
  - title: "TypeScript SDK: Test a server"
    url: "https://github.com/modelcontextprotocol/typescript-sdk/blob/main/docs/testing.md"
  - title: "Python SDK: Testing"
    url: "https://py.sdk.modelcontextprotocol.io/get-started/testing/"
  - title: MCP Inspector
    url: "https://github.com/modelcontextprotocol/inspector"
  - title: "MCP Inspector: CLI"
    url: "https://github.com/modelcontextprotocol/inspector/blob/main/clients/cli/README.md"
  - title: MCP conformance suite
    url: "https://github.com/modelcontextprotocol/conformance"
  - title: "MCPJam: CI / CD"
    url: "https://docs.mcpjam.com/cli/ci"
  - title: "Postman: MCP requests overview"
    url: "https://learning.postman.com/docs/use/send-requests/protocols/mcp-requests/overview/"
---

A useful MCP test proves more than reachability. It identifies the protocol era, validates HTTP and JSON-RPC behavior, exercises every advertised capability, checks authentication, and confirms failures are safe and actionable. This guide covers the whole job: what to test at each level, how to do it in the browser, in the MCP Inspector, with `curl` and in CI, and a checklist to run before every release. It covers stateless 2026 servers and the stateful 2025 servers still widely deployed.

## Why testing an MCP server is not like testing a REST API

A REST API is called by code written against its documentation. An MCP server is called by a model that reads the tool list at run time and decides what to send. That changes the contract:

- **Descriptions are interface.** The tool name, `title`, `description` and parameter descriptions are what the model uses to pick a tool and fill its arguments. A vague or misleading description is a functional bug, not a documentation issue.
- **Schemas are enforced by both sides.** The `inputSchema` decides which arguments are valid. When a tool declares an `outputSchema`, clients validate `structuredContent` against it and can reject a result that drifts.
- **Clients cache what they listed.** A client may keep yesterday's `tools/list` result. Removing a tool or adding a required input can break agents that never reconnected; see [which MCP tool changes break clients](/learn/which-mcp-tool-changes-break-clients).
- **Errors are read by the model.** Since 2025-11-25, input validation failures are tool execution errors (`isError: true`) the model can read and correct, not protocol errors that end the call.
- **The handshake is part of the surface.** Version negotiation, required headers, sessions in 2025 and per-request `_meta` in 2026 all have to work before a single tool is called. The [protocol versions guide](/learn/mcp-protocol-versions-explained) lists what changed in each revision.

## The levels of MCP testing

No single tool covers every level. Work from the inside out, and keep each level in your pipeline once it passes.

### Unit tests of tool handlers

Test your handlers through a real client, in-process, with no port or network. Both official SDKs support this:

- **TypeScript (SDK v2):** the [testing guide](https://github.com/modelcontextprotocol/typescript-sdk/blob/main/docs/testing.md) passes the deployed `createMcpHandler(createServer)` handler's `fetch` to a `StreamableHTTPClientTransport`, so a `Client` exercises the same handler you ship. `InMemoryTransport.createLinkedPair()` from `@modelcontextprotocol/client` pairs a client and a server directly, but connects 2025-era instances only; use the handler route for 2026-07-28 coverage.
- **Python (`mcp` 2.x):** `Client(mcp)` connects in memory when you pass it the server object instead of a URL. `Client(mcp, raise_exceptions=True)` surfaces the real message of a failure outside a tool body, which a remote caller would see sanitised ([Python SDK testing](https://py.sdk.modelcontextprotocol.io/get-started/testing/)).

```ts
import { Client, StreamableHTTPClientTransport } from '@modelcontextprotocol/client';
import { createMcpHandler } from '@modelcontextprotocol/server';
import { createServer } from './server'; // your McpServer factory; here it registers apply-discount

const handler = createMcpHandler(createServer);
const transport = new StreamableHTTPClientTransport(new URL('http://test.local/mcp'), {
  fetch: (url, init) => handler.fetch(new Request(url, init)),
});
const client = new Client({ name: 'test-harness', version: '1.0.0' }, { versionNegotiation: { mode: 'auto' } });
await client.connect(transport);

const result = await client.callTool({ name: 'apply-discount', arguments: { price: 80, percent: 25 } });
// Assert on result.structuredContent; a failing handler returns isError: true instead of throwing.
```

Cover the happy path, every documented error, and arguments the input schema should reject; each failure should be a result with `isError: true`.

### Protocol-surface checks

Next, test what a client sees on the wire: version negotiation, required headers, JSON-RPC error codes, the transport and 2025 session behavior. `curl` is enough; see the [commands below](#command-line-check-stateless-2026). The official [conformance suite](https://github.com/modelcontextprotocol/conformance) checks implementations against the specification and runs as a GitHub Action.

### Integration against real dependencies

Unit tests stub the database and upstream APIs. Also run the deployed server against real staging dependencies: the real authorization server, upstream tokens, timeouts and rate limits. Failures such as a missing CORS header or a session lost after a deploy only appear here.

### Tool-selection and agent evals

A server can pass every protocol check and still be hard for a model to use. Evals give a model a task and check which tool it picks and with which arguments. mcptest.io does not run a language model; [MCPJam](https://docs.mcpjam.com/cli/ci) chats with models against your tools and runs evals from its CLI, and the [testing tools comparison](/learn/best-remote-mcp-testing-tools) lists other options. Rerun evals whenever you rename tools or edit descriptions.

### Continuous checks in CI and after deploy

Rerun the remote checks on every pull request against a preview deployment and after each production deploy; see [CI](#test-from-a-script-or-ci).

## Start with the exact endpoint

Use the complete published MCP URL, including its path, for example `https://your-server.example.com/custom/mcp`. mcptest.io tries that exact URL first, then conventional path fallbacks only when needed. A valid auth challenge means the service is reachable but does not, by itself, prove that anonymous MCP negotiation passed.

## Interactive testing in the playground

To test a remote MCP server online, open [mcptest.io](/), enter the endpoint and connect. No install or account is needed. The playground first probes with `server/discover`. If the server offers `2026-07-28`, the client uses stateless, self-describing requests. If the endpoint is 2025-only, it falls back to `initialize`, sends `notifications/initialized`, and preserves a server-issued `Mcp-Session-Id`. The deprecated HTTP+SSE transport is the last fallback. Authentication responses are surfaced instead of being misclassified as an old protocol.

Check the connection log before testing features. For a stateless server, confirm the negotiated version and that discovery capabilities match reality. For a stateful server, confirm the initialization result, selected version, capabilities, and any session header. The same client API then lists and invokes capabilities in either era. Generate the report for a release decision with prioritized findings; [testing before you deploy](/learn/test-mcp-server-before-deploying) explains it.

### Capabilities

- **Tools:** inspect every input schema, call each tool with representative valid input, and compare structured output with its declared schema.
- **Negative tool calls:** try missing required fields, wrong types, bounds, unexpected properties, unusual Unicode, and large inputs. Recoverable tool failures should normally return a tool result with `isError: true`, not crash the transport.
- **Resources:** list and read several URIs; verify MIME types, text versus base64 content, templates, pagination, and authorization boundaries.
- **Prompts:** list templates, exercise required and optional arguments, and verify the returned messages and roles.
- **2026 caches:** where list results provide `ttlMs` and `cacheScope`, verify they reflect the data's real freshness and privacy boundary.
- **2026 multi-round trips:** exercise calls that return `input_required`, then verify the retried request carries the expected `inputResponses` and request state.

### Authentication

For OAuth servers, connect without credentials first and let the playground follow the challenge; for bearer-token or API-key servers, select that mode and enter the credential. The [authentication section](#testing-authentication) below lists what to verify. The [OAuth checker](/tools/oauth-check) runs the discovery steps on their own, before any login.

> **Browser clients need CORS.** Allow `Content-Type`, `Accept`, `Authorization`, `x-api-key`, `MCP-Protocol-Version`, `Mcp-Method`, and `Mcp-Name`. For stateful 2025 support, also allow `Mcp-Session-Id` and `Last-Event-ID`, and expose `Mcp-Session-Id` in responses.

## Test with the MCP Inspector

The official [MCP Inspector](https://github.com/modelcontextprotocol/inspector) is the reference client maintained by the MCP project. One package provides a web UI, a CLI and a terminal UI:

```bash
npx @modelcontextprotocol/inspector                   # web UI
npx @modelcontextprotocol/inspector --cli node build/index.js --method tools/list
npx @modelcontextprotocol/inspector --cli https://your-server.example.com/mcp --method tools/list
npx @modelcontextprotocol/inspector --cli https://your-server.example.com/mcp \
  --method tools/call --tool-name mytool --tool-arg key=value
```

It is the best way to test a local stdio server, which a browser cannot launch, and it covers almost every protocol feature. Add `--header "X-API-Key: ..."` for key-based servers; a URL whose path ends in neither `/mcp` nor `/sse` needs `--transport http` or `--transport sse`. The CLI prints JSON with a distinct exit code per failure class. Its local Node backend makes the connections, so it does not show whether a browser could reach the server. With the Python SDK's `cli` extra, `uv run mcp dev server.py` opens a server in the Inspector, and [Postman](https://learning.postman.com/docs/use/send-requests/protocols/mcp-requests/overview/) can send MCP requests over stdio or Streamable HTTP from a workspace. See [mcptest vs MCP Inspector](/learn/mcptest-vs-mcp-inspector) for a side-by-side comparison.

## Command-line check: stateless 2026

`curl` shows exactly what goes over the wire. The examples use [Context7](/server/mcp.context7.com/mcp/mcp), a public catalog server that needs no sign-in and negotiated 2026-07-28 when this guide was reviewed; substitute your own endpoint.

A 2026 server must implement `server/discover`. The client call is optional, but it is the clearest compatibility probe. Include the version and method headers plus the required per-request metadata:

```bash
curl -i https://mcp.context7.com/mcp \
  -H "Content-Type: application/json" \
  -H "Accept: application/json, text/event-stream" \
  -H "MCP-Protocol-Version: 2026-07-28" \
  -H "Mcp-Method: server/discover" \
  -d '{
    "jsonrpc": "2.0",
    "id": "discover-1",
    "method": "server/discover",
    "params": {
      "_meta": {
        "io.modelcontextprotocol/protocolVersion": "2026-07-28",
        "io.modelcontextprotocol/clientInfo": {
          "name": "curl-check",
          "version": "1.0.0"
        },
        "io.modelcontextprotocol/clientCapabilities": {}
      }
    }
  }'
```

A successful result advertises `supportedVersions` and `capabilities`. There is no initialized notification and no session header to retain. Test an ordinary request independently:

```bash
curl -i https://mcp.context7.com/mcp \
  -H "Content-Type: application/json" \
  -H "Accept: application/json, text/event-stream" \
  -H "MCP-Protocol-Version: 2026-07-28" \
  -H "Mcp-Method: tools/list" \
  -d '{
    "jsonrpc": "2.0",
    "id": 2,
    "method": "tools/list",
    "params": {
      "_meta": {
        "io.modelcontextprotocol/protocolVersion": "2026-07-28",
        "io.modelcontextprotocol/clientCapabilities": {}
      }
    }
  }'
```

For `tools/call`, add `Mcp-Name: <tool-name>` with the same value as `params.name`:

```bash
curl -i https://mcp.context7.com/mcp \
  -H "Content-Type: application/json" \
  -H "Accept: application/json, text/event-stream" \
  -H "MCP-Protocol-Version: 2026-07-28" \
  -H "Mcp-Method: tools/call" \
  -H "Mcp-Name: resolve-library-id" \
  -d '{
    "jsonrpc": "2.0",
    "id": 3,
    "method": "tools/call",
    "params": {
      "name": "resolve-library-id",
      "arguments": { "libraryName": "Express", "query": "routing" },
      "_meta": {
        "io.modelcontextprotocol/protocolVersion": "2026-07-28",
        "io.modelcontextprotocol/clientCapabilities": {}
      }
    }
  }'
```

Do the same with the resource URI for `resources/read` and the prompt name for `prompts/get`. Confirm a missing method header, a missing required name header, or a mismatch between the header and body metadata is rejected rather than silently routed: the 2026 answer is `400` with JSON-RPC error `-32020` (HeaderMismatch). Every header is described in the [HTTP headers reference](/learn/mcp-http-headers-reference).

## Command-line check: stateful 2025

A 2025-only server begins with initialization. The examples use [DeepWiki](/server/https://mcp.deepwiki.com/mcp/mcp), a public 2025-11-25 catalog server. Keep `-i` so the response headers reveal whether it issued a session ID:

```bash
curl -i https://mcp.deepwiki.com/mcp \
  -H "Content-Type: application/json" \
  -H "Accept: application/json, text/event-stream" \
  -d '{
    "jsonrpc": "2.0",
    "id": 1,
    "method": "initialize",
    "params": {
      "protocolVersion": "2025-11-25",
      "capabilities": {},
      "clientInfo": { "name": "curl-check", "version": "1.0.0" }
    }
  }'
```

The result may arrive as JSON or, as here, as `text/event-stream` with `event: message` lines. Complete the handshake and carry the negotiated version, and the session ID when one was issued, on later requests:

```bash
# Add -H "Mcp-Session-Id: $SESSION_ID" to each request when the server issued one.
curl -i https://mcp.deepwiki.com/mcp \
  -H "Content-Type: application/json" \
  -H "Accept: application/json, text/event-stream" \
  -H "MCP-Protocol-Version: 2025-11-25" \
  -d '{"jsonrpc":"2.0","method":"notifications/initialized"}'

curl -i https://mcp.deepwiki.com/mcp \
  -H "Content-Type: application/json" \
  -H "Accept: application/json, text/event-stream" \
  -H "MCP-Protocol-Version: 2025-11-25" \
  -d '{"jsonrpc":"2.0","id":2,"method":"tools/list"}'

curl -i https://mcp.deepwiki.com/mcp \
  -H "Content-Type: application/json" \
  -H "Accept: application/json, text/event-stream" \
  -H "MCP-Protocol-Version: 2025-11-25" \
  -d '{"jsonrpc":"2.0","id":3,"method":"tools/call","params":{"name":"read_wiki_structure","arguments":{"repoName":"modelcontextprotocol/inspector"}}}'
```

The notification gets `202 Accepted` with no body. Calling the same tool with `"arguments": {}` is a quick negative test: a well-behaved server answers with a result carrying `isError: true` and a readable validation message.

DeepWiki issues no session ID, so these requests carry none. Omit the session header entirely when the server did not issue one; do not send a literal empty value. On a stateful implementation, verify missing IDs return 400, unknown or expired IDs return 404, optional GET and DELETE return either their documented behavior or 405, and concurrent sessions never leak data into one another. [Session not found after deploy](/learn/mcp-session-not-found-after-deploy) covers the most common production failure.

## Test from a script or CI

The headless mcptest CLI runs the same evaluator, client profiles and release decision as the browser report. It needs Node.js 22 and a checkout of the [mcptest repository](https://github.com/integry/mcptest):

```bash
npm ci
npm run mcptest -- https://staging.example.com/mcp
npm run mcptest -- --bearer-token-env MCPTEST_BEARER_TOKEN https://staging.example.com/mcp
```

Credentials are passed by environment variable name, never as literal values. Reports go to `mcptest-reports/` as JSON and Markdown. Exit codes are 0 for pass, 1 for a threshold failure, 2 when browser or interactive authorization is required, 3 for invalid configuration and 4 for an infrastructure or artifact failure.

In GitHub Actions, the `integry/mcptest` action wraps the CLI without a checkout:

```yaml
- uses: integry/mcptest@v1
  with:
    endpoints: https://mcp.example.com/mcp
    baseline: none
    fail-on: blocked
```

It can require specific clients (`clients: claude-ai,chatgpt,cursor`), compare against the last release with `baseline`, and post a PR comment. [Test a remote MCP server in CI](/learn/test-remote-mcp-server-in-ci) walks through the setup and the [CI page](/ci) has a complete workflow. Two limits apply to any headless run: Node cannot establish browser CORS, and it cannot complete an interactive OAuth login. Run the browser report once per release candidate for those. The Inspector CLI, MCPJam CLI and conformance suite also run in CI, for raw protocol checks, evals and spec conformance.

## Testing authentication

Authorization is optional in MCP, but HTTP servers that use it should conform to the [OAuth 2.1 profile](/learn/mcp-oauth-2-1-reference). Stdio servers should take credentials from the environment instead.

**OAuth 2.1 with PKCE.** Start without credentials. A correct `401` should carry `WWW-Authenticate` with `resource_metadata`, leading to protected-resource metadata, authorization-server metadata, client identification, and an authorization-code flow with PKCE `S256`. Verify the client selection order: a pre-registered client first, a Client ID Metadata Document when the server advertises support, and Dynamic Client Registration only as a legacy fallback. After sign-in, verify that the token is accepted only by its intended MCP resource (its audience), that expired tokens get `401`, and that insufficient scopes produce a `403` with `error="insufficient_scope"`. Tokens must travel in the `Authorization` header, never the query string.

**Bearer tokens and API keys.** Test a valid credential, an invalid one, a revoked or expired one and none at all. Each failure should be a clear `401` or `403`, never a `200` with an empty tool list.

Common failures each have a dedicated fix guide:

- [401 Unauthorized](/learn/remote-mcp-server-401-unauthorized) across clients.
- [Failed to discover OAuth metadata](/learn/mcp-error-failed-to-discover-oauth-metadata) when the well-known documents are missing or unreadable.
- [Protected resource does not match](/learn/mcp-oauth-protected-resource-mismatch) when `resource` differs from the URL the client used.
- [Dynamic client registration not supported](/learn/mcp-error-dynamic-client-registration) and [invalid_redirect_uri](/learn/mcp-error-invalid-redirect-uri) during client registration.

## Testing CORS for browser clients

Web-based clients call your server from a browser page, so the browser enforces CORS first. `Content-Type: application/json` is not a safelisted value, so every MCP `POST` triggers a preflight. Check the grant without a browser:

```bash
curl -i -X OPTIONS https://your-server.example.com/mcp \
  -H "Origin: https://mcptest.io" \
  -H "Access-Control-Request-Method: POST" \
  -H "Access-Control-Request-Headers: authorization,content-type,mcp-method,mcp-name,mcp-protocol-version"
```

A `curl` check proves the headers are present; only a browser proves they are sufficient. The playground connects directly from your browser first and only falls back to its proxy when the browser blocks the request, and the report's Web Client Accessibility section records which happened. A 2025 server that issues `Mcp-Session-Id` without listing it in `Access-Control-Expose-Headers` appears to initialize and then rejects every request. [CORS headers for browser clients](/learn/mcp-cors-headers-for-browser-clients) has the full header lists and framework fixes.

## Transports: what you can test where

| Transport | Status | Where you can test it |
| --- | --- | --- |
| Streamable HTTP | Current remote transport since 2025-03-26; POST only in 2026-07-28 | Browser playground, Inspector, Postman, `curl`, headless CLI |
| HTTP+SSE | 2024-11-05 transport, formally deprecated in 2026-07-28 | Browser playground (as a fallback), Inspector with `--transport sse` |
| stdio | Local process over stdin and stdout | Locally only: Inspector, Postman, SDK tests that spawn the process |

Stdio can only be tested on the machine that runs it: launch it with the Inspector or spawn it from an SDK test. A hosted backend, such as a web tool's proxy or a cloud CI runner, cannot reach your localhost. A browser tool that connects directly from your browser, as the playground does first, can reach a local HTTP server if the server allows the page's origin in CORS and the browser permits the local-network request, which Chromium may ask you to approve. If that is blocked, deploy a preview or use a tunnel. [Remote vs local MCP servers](/docs/remote-vs-local) explains the trade-offs, and [converting a stdio server to remote](/learn/convert-local-stdio-mcp-server-to-remote) covers the move. For `406`, `415` and `405` responses, see [the status-code guide](/learn/mcp-406-not-acceptable-415-and-405).

## Validating tool schemas, output schemas and descriptions

- **Input schemas:** every property has a type and a description, required fields are listed, and bounds and enums constrain what the model can send. Unconstrained inputs are flagged in the mcptest report.
- **Output schemas:** call each tool that declares an `outputSchema` and check `structuredContent` against it. The playground reports a violation as `tool.output-contract-violation` with the path and message; see [output schemas and structured content](/learn/mcp-tool-output-schemas-and-structured-content).
- **Descriptions:** read them as a model would. Each should say when to use the tool and what it returns, without oversized text.
- **Breaking changes:** compare the `tools/list` result of a release candidate with the last release. Removed tools, new required inputs and narrowed input schemas break clients that cached the old list. Paste both listings into the [breaking-change check](/tools/breaking-changes), or set a `baseline` in the CI action.

## Security checks

Test what an administrator vetting the server would check:

- Validate `Origin` on every request; from 2025-11-25 a present but invalid `Origin` must get `403`.
- Reject tokens issued for another resource, and never pass the client's token through to upstream APIs.
- Confirm destructive tools are marked as such and that write actions need the scopes they claim.
- Check that tool results containing user or third-party content cannot rewrite instructions for the model.
- Keep credentials out of logs, URLs, error messages and published reports.

[Is MCP safe?](/learn/is-mcp-safe) explains prompt injection and tool poisoning, and [how to vet an MCP server](/learn/how-to-vet-an-mcp-server) turns the evidence into an approval decision.

## Failure and production checks

- Malformed JSON returns JSON-RPC `-32700`; an unknown method returns `-32601` instead of an empty body or generic 500.
- An unsupported version produces a protocol-specific error; 2026 header/body mismatches produce `400`.
- An invalid `Origin` is rejected, while approved browser origins pass preflight with the exact headers they need.
- Tokens are audience- and scope-checked, secrets are absent from logs and URLs, and rate limits apply at both endpoint and tool level.
- Concurrent calls, cancellation, proxy timeouts, SSE buffering, deploys, and instance scaling do not corrupt state or duplicate side effects.
- List ordering and cache hints remain deterministic; schema changes trigger the appropriate refresh behavior.

For wire-level expectations use the [current specification](https://modelcontextprotocol.io/specification/2026-07-28) and the TypeScript SDK's [protocol-version guide](https://github.com/modelcontextprotocol/typescript-sdk/blob/main/docs/protocol-versions.md). The [JSON-RPC error codes reference](/learn/mcp-json-rpc-error-codes) lists every code. When a check fails, continue to [troubleshooting](/docs/troubleshooting).

## Pre-release checklist

1. Unit tests call every tool in-process, including documented errors and schema-rejected arguments.
2. `server/discover` (2026) or `initialize` (2025) succeeds against the deployed URL, with the expected version and capabilities.
3. For each capability the server advertises, `tools/list`, `resources/list` or `prompts/list` returns complete results, following `nextCursor` to the last page.
4. Every tool that declares an `outputSchema` returns `structuredContent` that matches it.
5. On 2026, a missing or mismatched `Mcp-Method` is rejected with `400`, and so is `Mcp-Name` on `tools/call`, `resources/read` and `prompts/get`; on every version, malformed JSON gets `-32700`.
6. If the server requires credentials, requests without them, or with invalid, expired or revoked ones, get `401` or `403`, never a `200`. If it uses OAuth, the `401` carries `WWW-Authenticate` with `resource_metadata`, sign-in completes with PKCE `S256` and the token is audience-checked. If it allows anonymous access, it works without credentials.
7. The browser preflight passes from an allowed origin, and a 2025 server that issues `Mcp-Session-Id` exposes it.
8. Sessions, if any, survive the deploy process you actually use, or fail with `404` and recover through a new `initialize`.
9. The tool list has no unreviewed breaking changes against the last release.
10. The CI gate passes against the preview deployment, and the browser report has no blocking findings.
11. The server works in the clients your users run; check the [client support matrix](/learn/mcp-client-support-matrix).

## FAQ

### How do I test an MCP server locally?

For a stdio server, run it under the MCP Inspector (`npx @modelcontextprotocol/inspector`, or `uv run mcp dev server.py` with the Python SDK) and write SDK tests that call your tools in-process. For a local HTTP server, point the Inspector or `curl` at `http://localhost:<port>/mcp`. Browser-based tools can reach it only through a direct request from your browser, subject to CORS and the browser's local-network permissions; their hosted proxies cannot reach your machine. If the direct connection is blocked, deploy a preview or use a tunnel.

### Can I test an MCP server without Claude Desktop?

Yes. You do not need any AI client to test the protocol. The Inspector, Postman, `curl`, the SDK clients and mcptest.io all speak MCP directly. Use a real client such as Claude or ChatGPT only for the final check of how a model uses your tools.

### How do I test an MCP server online?

Open [mcptest.io](/), paste the server's full URL and connect. It runs in the browser with no install or account, handles OAuth, bearer tokens and API keys, calls tools and produces a shareable report. It tests HTTP servers, not stdio; a server on localhost works only over the [direct browser connection](#transports-what-you-can-test-where).

### How do I test an MCP server with curl?

Send JSON-RPC `POST` requests with `Content-Type: application/json` and `Accept: application/json, text/event-stream`. For a 2026 server, add `MCP-Protocol-Version`, `Mcp-Method` and, for calls, `Mcp-Name`, and put the version and capabilities in `params._meta`. For a 2025 server, send `initialize`, then `notifications/initialized`, then carry `MCP-Protocol-Version` and any `Mcp-Session-Id`. The full commands are [above](#command-line-check-stateless-2026).

### How do I test an MCP server in CI?

Deploy a preview, then run the `integry/mcptest` GitHub Action or `npm run mcptest` against it, failing the job on a `blocked` decision. Add a baseline to catch breaking tool changes. [Test a remote MCP server in CI](/learn/test-remote-mcp-server-in-ci) has the workflow.

### Why does my MCP server work with curl but not in a browser client?

Usually CORS: the preflight lacks a header the client sends, or `Mcp-Session-Id` is not exposed. `curl` does not enforce CORS, so it never sees the problem; the playground shows the browser's view.

### How do I know whether a model will use my tools correctly?

Protocol tests cannot tell you. Run evals that give a model real tasks and check which tool it chooses and with which arguments, for example with MCPJam, and repeat them after every description or schema change. Then try the server in the clients your users run.
