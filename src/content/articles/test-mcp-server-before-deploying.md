---
title: How to test an MCP server before you deploy it
navTitle: Test before deploying
summary: What a client does on connect, the order mcptest checks it in, how to read the release decision, and how to run the same gate in CI.
track: build
level: practitioner
order: 20
category: Testing
readingTimeMinutes: 8
lastReviewed: "2026-10-20"
metaTitle: Test MCP Server Before Deploy | mcptest.io
metaDescription: How to test an MCP server before deploy. The connect sequence a client runs, what mcptest checks in which order, how to read the report, and how to gate releases in CI.
relatedSlugs:
  - testing-guide
  - deploy-remote-mcp-server
  - build-mcp-server-with-claude-code-or-codex
  - troubleshooting
sourceLinks:
  - title: MCP 2026-07-28 Streamable HTTP transport
    url: "https://modelcontextprotocol.io/specification/2026-07-28/basic/transports/streamable-http"
  - title: MCP 2026-07-28 changelog
    url: "https://modelcontextprotocol.io/specification/2026-07-28/changelog"
  - title: "MCP 2026-07-28 authorization: authorization server discovery"
    url: "https://modelcontextprotocol.io/specification/2026-07-28/basic/authorization/authorization-server-discovery"
  - title: "TypeScript SDK v2: protocol versions"
    url: "https://ts.sdk.modelcontextprotocol.io/v2/protocol-versions"
  - title: mcptest headless CLI and CI release gate
    url: "https://github.com/integry/mcptest/blob/master/docs/headless-release-gate.md"
---

A server that answers `curl` is not ready to ship. Real clients send a fixed sequence of requests, and each step can fail for a reason that a hand-written request never exercises: a preflight that rejects one header, an `Accept` check that is stricter than the specification, a session id the browser cannot read. This guide walks through that sequence, then shows the order mcptest checks it in, how to read the result, and how to run the same evaluation as a CI gate. For the manual request-by-request checks, keep the [testing guide](/docs/testing-guide) open alongside this one.

## What a client does when it connects

The order matters because a failure early in the sequence hides everything after it. A server that rejects the first discovery request never gets its tools listed, so fix problems top-down.

1. **Resolve the endpoint.** The client uses the exact URL it was given, for example `https://mcp.example.com/mcp`. Clients that support the deprecated HTTP+SSE transport may also try a sibling `/sse` path.
2. **Preflight (browsers only).** A browser sends `OPTIONS` before the first `POST`, because `Content-Type: application/json` and the `MCP-Protocol-Version`, `Mcp-Method`, and `Mcp-Name` headers are not on the CORS safelist. If the preflight fails, the browser never sends the request and the page sees only a generic network error.
3. **Pick a protocol era.** A client that supports `2026-07-28` sends `server/discover` with `MCP-Protocol-Version: 2026-07-28` and `Mcp-Method: server/discover`. If the server answers with a recognized modern result or error, the client stays stateless. If it answers `400` without a modern JSON-RPC error body, the client falls back to the 2025 handshake: `initialize`, then `notifications/initialized`, carrying any `Mcp-Session-Id` the server issued on every later request.
4. **Authorize when challenged.** A `401` with `WWW-Authenticate: Bearer resource_metadata="..."` sends the client to the Protected Resource Metadata document, then to the authorization server's metadata, then through OAuth with PKCE. Without a `resource_metadata` parameter, the client probes `/.well-known/oauth-protected-resource/<path>` and then `/.well-known/oauth-protected-resource`.
5. **Discover capabilities.** `tools/list`, `resources/list`, `resources/templates/list`, and `prompts/list`, each followed through `nextCursor` until the last page.
6. **Open optional streams.** A 2025 client may `GET` the endpoint for a server-to-client event stream; `405` means none is offered. A 2026 client opens change notifications with a `subscriptions/listen` `POST` instead, because the 2026 revision removed the `GET` stream.
7. **Call tools.** Each `tools/call` carries `Mcp-Name: <tool>` on 2026 requests. When the tool declares an `outputSchema`, clients validate `structuredContent` against it before using the result.

| Step | Typical failure | How it shows up |
| --- | --- | --- |
| Preflight | `Mcp-Method` or `Authorization` missing from `Access-Control-Allow-Headers` | Browser network error; `curl` works |
| Era selection | `Accept` check rejects a valid header | HTTP `406` on the first `POST` |
| Era selection | Body parser only accepts another media type | HTTP `415` |
| 2025 handshake | `Mcp-Session-Id` issued but not in `Access-Control-Expose-Headers` | `initialize` succeeds, the next request is rejected |
| Authorization | Metadata document only at one well-known path | Client stops at a `404` |
| Optional stream | `GET` answered with HTML or `text/plain` | SSE content-type mismatch |
| Tool calls | `structuredContent` drifts from `outputSchema` | Client rejects the result |

## What mcptest checks, and in what order

The same evaluator runs in the browser report and in the headless CLI. It follows the client sequence above and records each stage as a scored section.

### Connection and era negotiation

mcptest first tries a direct connection with automatic 2026 and 2025 negotiation, starting at the exact URL and moving to conventional sibling paths only when needed. In the browser, if the direct attempt fails in a way that looks like a CORS block, it retries through the mcptest proxy and records that the proxy was required. If the target answers `401` or `403` before negotiation completes, the run stops with an `authorization-required` outcome instead of a score. That is a prerequisite, not a failing grade.

### Scored sections

| Section | Points | What earns them |
| --- | ---: | --- |
| Core Protocol Adherence | 15 | A complete 2026 `server/discover` lifecycle or 2025 `initialize` handshake, with responses that pass the official SDK's schema validation |
| MCP Capabilities | 10 | `tools/list` (4), `resources/list` (3), and `prompts/list` (3) answering, with pagination followed; `resources/templates/list` is recorded but not scored |
| Transport Layer Modernity | 15 | Streamable HTTP earns 15; the deprecated HTTP+SSE transport earns 6 |
| Security Posture | 40 | Only when OAuth metadata exists: authorization-server metadata (20), a token endpoint (10), and PKCE `S256` (10) |
| Web Client Accessibility | 15 | Browser only: 15 when direct browser negotiation worked, 0 when the proxy was required |
| Performance Baseline | 15 | Endpoint selection plus negotiation under 500 ms (15), under 1 s (12), under 2.5 s (8), otherwise 4 |

A server without OAuth is scored out of the remaining sections; Security Posture is excluded rather than counted as zero. The headless CLI leaves Web Client Accessibility out, so a public server there is scored out of 55.

### Evidence that changes the decision but not the score

Two kinds of evidence are attached to the report without adding points:

- **Transport diagnostics.** Stable ids such as `transport.accept-header-406`, `transport.unsupported-media-type-415`, `transport.get-stream-405`, `transport.sse-content-type-mismatch`, `transport.cors-expose-headers-missing`, and `transport.target-rate-limited-429`. Each lists the requests that prove it and a fix for the TypeScript SDK, the Python SDK, and Cloudflare Workers. A diagnostic marked suspected is shown as a possibility and never blocks a release.
- **Tool surface and output contracts.** The discovered tools are analyzed for unconstrained inputs, oversized descriptions, and similar risks. Tool calls you make in the playground are checked against each tool's `outputSchema`, and a violation is reported as `tool.output-contract-violation`. The headless CLI does not call tools, so output contracts only appear in reports generated after playground calls.

## How to read the release decision

The top of every report answers one question: can this ship? The answer combines the protocol result, host compatibility profiles for ChatGPT, Claude, Cursor, VS Code Copilot, and a generic SDK client, transport diagnostics, tool-surface findings, and output contracts.

| Status | Meaning | What to do |
| --- | --- | --- |
| `ready` | No priorities at all | Ship |
| `review` | No blocker, but medium findings or unknown observations remain | Read each priority and decide; many are host behavior a single run cannot establish |
| `blocked` | Negotiation failed, or at least one high or critical priority exists | Fix the first priority and rerun |
| `unknown` | A required check was skipped, so the report is partial | Resolve the skipped check, then rerun |
| `authorization-required` | The target challenged before it could be assessed | Supply a credential or complete OAuth, then rerun |

Priorities are sorted critical, high, medium, then unknown. Each has a stable id, a source (Evaluation, Host compatibility, or Tool surface), the evidence, and a remediation. Detected transport errors such as a `406` become high priorities and block release; warnings such as a refused optional `GET` stream become medium priorities and only ask for review.

A first report against a small stateless server often reads `review`, with an unconstrained-inputs finding and several unknown host-compatibility observations, such as session behavior the evaluation could not establish. That is a normal starting point, not a failure. Constrain the inputs, then decide whether the remaining unknowns matter for the hosts you target.

## Run the same checks in CI

The headless command uses the same evaluator, profiles, and release-decision logic as the web report. It needs Node.js 22 and a checkout of the mcptest repository with dependencies installed:

```bash
npm ci
npm run mcptest -- https://staging.example.com/mcp
```

Each endpoint produces a JSON report that conforms to `https://mcptest.io/schemas/report/v2.schema.json` and a Markdown report, in `mcptest-reports/` by default. Credentials are passed by environment variable name, never as literal arguments:

```bash
export MCPTEST_BEARER_TOKEN='staging-token'
npm run mcptest -- --bearer-token-env MCPTEST_BEARER_TOKEN https://staging.example.com/mcp
```

The default gate fails on `blocked` or `unknown` and on any high or critical priority; `review` passes. A stricter gate that also fails on review decisions and medium findings looks like this:

```bash
npm run mcptest -- \
  --fail-on-result blocked,unknown,review \
  --fail-on-severity medium \
  https://staging.example.com/mcp
```

| Exit code | Meaning |
| ---: | --- |
| 0 | Every endpoint passed the configured thresholds |
| 1 | At least one completed evaluation failed a threshold |
| 2 | At least one endpoint requires interactive or browser authorization |
| 3 | Arguments, URLs, environment references, or thresholds are invalid |
| 4 | The evaluator threw unexpectedly or artifacts could not be written |

Run the gate against a staging deployment after it starts and before you promote it. Upload the reports with `if: always()` so a failed gate stays inspectable. The repository also ships a reusable workflow, `.github/workflows/mcptest-release-gate.yml`, that takes newline-separated endpoints and a credential mode; [the release gate documentation](https://github.com/integry/mcptest/blob/master/docs/headless-release-gate.md) has both the minimal job and the reusable-workflow call.

### What the headless run cannot tell you

A Node process is not a browser, so the CLI never claims browser access: CORS evidence is reported as unknown and is not added to the headless score. It also does not open a browser for OAuth; a target that challenges without an accepted bearer token or API key produces an `authorization-required` report and exit code 2. Run the browser report once per release candidate for those two areas, and see [CORS headers for browser clients](/learn/mcp-cors-headers-for-browser-clients) for what that report expects.

## Add the gate to CI

Put `npm run mcptest -- --endpoints-env MCPTEST_ENDPOINTS` in the deploy pipeline between "staging is up" and "promote to production", with the endpoint list in `MCPTEST_ENDPOINTS` and the report directory uploaded as an artifact. Start with the default thresholds, and tighten to `--fail-on-result blocked,unknown,review` once the first reports are clean.
