---
title: Designing a production MCP server
summary: Design focused tools and schemas, control context cost, choose a deployment state model, and build observable, rate-limited failure handling.
track: build
level: expert
order: 2
category: Production engineering
readingTimeMinutes: 13
lastReviewed: 2026-08-17
relatedSlugs:
  - should-you-build-mcp-server
  - mcp-server-trust-checklist
sourceLinks:
  - title: "MCP specification: Tools"
    url: "https://modelcontextprotocol.io/specification/draft/server/tools"
  - title: "MCP specification: Server primitives"
    url: "https://modelcontextprotocol.io/specification/2025-06-18/server/index"
  - title: "MCP specification: Transports"
    url: "https://modelcontextprotocol.io/specification/2025-06-18/basic/transports"
  - title: MCP 2026-07-28 specification overview
    url: "https://blog.modelcontextprotocol.io/posts/2026-07-28/"
  - title: "MCP TypeScript SDK: Supporting 2026-07-28"
    url: "https://ts.sdk.modelcontextprotocol.io/v2/migration/support-2026-07-28"
  - title: MCP Inspector
    url: "https://github.com/modelcontextprotocol/inspector"
---
## Design the capability boundary first

Start from user decisions, not upstream API endpoints. A tool should represent one understandable operation with a result the model can evaluate. `find_customer_orders` is clearer than a generic `request` tool, while separate `create_draft_invoice` and `send_invoice` tools preserve an approval boundary that one `manage_invoice` tool would hide.

Use resources for context the application or user chooses to attach, prompts for user-invoked reusable templates, and tools for model-invoked retrieval or action. The official control model distinguishes these primitives; collapsing everything into tools discards useful client UX and consent signals.

## Tool names, descriptions, and schemas

A tool definition is model-facing interface design. Its name should be stable and distinct. Its description should say **when to use it, when not to use it, side effects, authorization expectations, and what the result means**. Avoid marketing language and near-duplicate tools.

Prefer a small input object with explicit fields:

```json
{
  "type": "object",
  "additionalProperties": false,
  "properties": {
    "projectId": {
      "type": "string",
      "description": "Stable project ID, not the display name"
    },
    "query": {
      "type": "string",
      "minLength": 1,
      "maxLength": 200
    },
    "limit": {
      "type": "integer",
      "minimum": 1,
      "maximum": 50,
      "default": 10
    }
  },
  "required": ["projectId", "query"]
}
```

Constrain enums, lengths, numeric ranges, and additional properties. Put human meaning in descriptions, but enforce security and tenancy on the server—never trust the model to honor prose. Define structured output when clients can use it, and keep a concise text representation for clients that primarily feed results back to a model.

Return stable IDs alongside labels. Paginate large collections. Provide actionable domain errors such as “project not found for this tenant” instead of raw stack traces. Do not expose an unrestricted SQL, shell, filesystem, or arbitrary-URL tool unless that power is the explicit, isolated product and its policy is enforceable.

## Control context and token cost

Every tool name, description, and schema may compete for model context and attention. More tools can reduce selection quality even before any tool returns data. Measure serialized definition size per authenticated role and keep the default surface narrow.

Useful controls include grouping around user jobs, eliminating aliases, returning only tools authorized for the presented credentials, paginating lists, and testing selection among confusing neighbors. Do not mutate the list as a side effect of unrelated calls. Current protocol guidance permits authorization-specific tool sets and recommends deterministic ordering, which also helps caching.

Tool results need budgets too. Return the smallest data that enables the next decision; provide cursors or stable resource links for detail. Truncate only with an explicit indicator and continuation method. Treat untrusted upstream text as data, not instructions, and preserve provenance so the host can show where content came from.

## Idempotency and writes

Models and clients retry. Networks time out after the server commits, users click twice, and OAuth refresh can replay a request. A write tool should accept an idempotency key or derive a safe operation identity, store the terminal result, and return the same outcome for a legitimate retry. Scope keys by tenant, user, tool, and a bounded time window.

Separate preview from commit for high-impact actions. Return the proposed recipients, amount, permissions, or diff before a confirmable write. Prefer reversible operations and include stable audit IDs. Tool annotations can communicate hints, but the specification tells clients to treat annotations from untrusted servers as untrusted; server-side authorization remains mandatory.

## Stateless protocol versus application state

Do not confuse transport session state with business state. Deployments through the 2025 protocol family may negotiate a session and use `Mcp-Session-Id`; the 2026-07-28 core removes initialization and the transport session, placing protocol metadata on each request. Supporting both eras requires explicit compatibility tests.

A stateless HTTP handler can still run a stateful product. Put durable workflow state in a database and return an opaque job, draft, cursor, or transaction ID. Any healthy instance should be able to process the next request. Keep only disposable caches in memory. This enables ordinary load balancing, rolling deploys, and recovery after process loss.

If a legacy client/server path genuinely needs connection-pinned state, define expiration, routing, draining, and loss behavior. Never let an in-memory session become the only record of a completed external write.

## Authentication and tenant isolation

Validate every request independently: issuer, resource/audience, expiry, scopes, tenant, and subject. Map credentials to an internal principal before tool dispatch. Then authorize the specific object and action; a valid token does not imply access to every record named in arguments.

Keep upstream service credentials server-side. Encrypt refresh tokens at rest, restrict decryption access, rotate keys, and make revocation effective. For local stdio, pass only necessary environment variables and document filesystem/network access. For HTTP, validate origins where required, bind local-only servers to loopback, use HTTPS, set request/body limits, and prevent arbitrary redirect or fetch behavior.

## Logging and tracing

Operational logs are not MCP tool results. Record a request/correlation ID, protocol version, client identity when available, authenticated principal/tenant pseudonym, tool name, outcome, latency, upstream dependency, retry count, rate-limit decision, and returned byte/token estimate. Redact arguments and results by default; allow carefully governed field-level diagnostics.

The 2026 protocol adds standard trace context in request metadata and changes protocol-level logging behavior. Regardless of revision, propagate trace IDs through upstream APIs so a failed tool call can be followed end to end. Never log authorization codes, PKCE verifiers, access/refresh tokens, client secrets, or full sensitive documents.

Define metrics and alerts for connection/auth failures, per-tool latency and error rate, throttling, dependency saturation, idempotency replays, and unexpected tool-list changes. Audit writes separately with actor, authorization decision, normalized action, target, result, and reversible-operation reference.

## Rate limits and load shedding

Limit by tenant, user, client, tool cost, and upstream quota—not only IP address. Separate cheap reads from expensive exports or writes. Return a stable, machine-readable error with a safe retry hint; add jitter to client retries and cap total attempts. Bound concurrency, request size, streaming duration, page size, and response size.

When overloaded, reject before starting expensive work. For long operations, create a durable job and return a handle instead of keeping one request alive indefinitely. Cancellation should stop downstream work when possible, but durable state must make ambiguous outcomes inspectable.

## Failure handling contract

Classify failures so clients and operators can act:

- **Invalid input:** identify fields without echoing secrets; do not retry unchanged.
- **Unauthenticated:** issue a standards-compliant HTTP challenge at the resource boundary.
- **Unauthorized operation:** explain the missing permission without pretending a new login always fixes it.
- **Conflict/idempotent replay:** return the existing resource or a version conflict.
- **Dependency unavailable/rate limited:** state whether retry is safe and when.
- **Unknown outcome:** return a correlation or operation ID that can be queried before repeating a write.
- **Internal defect:** stable public error, full redacted trace for operators, no stack or secret leakage.

Test each class with injected timeouts before commit, after commit, during response streaming, during token refresh, and across deploy/restart.

## Production readiness gate

Before publishing, require schema validation tests, authorization and cross-tenant tests, idempotency tests, protocol-version and transport compatibility, context-size measurements, rate-limit behavior, dependency-failure injection, secret-redaction assertions, reconnect/restart checks, and a human review of every write tool. Run the server in the [MCP Playground](/) and the official Inspector, then test in every client you claim to support.

Publish an endpoint, auth/scopes, tool inventory, data handling statement, hosting owner, support channel, change policy, tested client/version matrix, and last-reviewed date. Operations and evidence are part of the integration—not follow-up work.
