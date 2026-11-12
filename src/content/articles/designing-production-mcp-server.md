---
title: Designing a production MCP server
summary: Design focused tools and schemas, control context cost, choose a deployment state model, and build observable, rate-limited failure handling.
track: build
level: expert
order: 2
category: Production engineering
readingTimeMinutes: 14
lastReviewed: "2026-11-11"
relatedSlugs:
  - should-you-build-mcp-server
  - mcp-server-trust-checklist
sourceLinks:
  - title: "MCP 2026-07-28 specification: Tools"
    url: "https://modelcontextprotocol.io/specification/2026-07-28/server/tools"
  - title: "MCP 2026-07-28 specification: Server primitives"
    url: "https://modelcontextprotocol.io/specification/2026-07-28/server/index"
  - title: "MCP 2026-07-28 specification: Overview (statelessness, _meta, trace context)"
    url: "https://modelcontextprotocol.io/specification/2026-07-28/basic/index"
  - title: "MCP 2026-07-28 specification: Streamable HTTP"
    url: "https://modelcontextprotocol.io/specification/2026-07-28/basic/transports/streamable-http"
  - title: "MCP 2026-07-28 specification: Authorization"
    url: "https://modelcontextprotocol.io/specification/2026-07-28/basic/authorization"
  - title: "MCP 2026-07-28 specification: Caching"
    url: "https://modelcontextprotocol.io/specification/2026-07-28/server/utilities/caching"
  - title: "MCP 2026-07-28 specification: Cancellation"
    url: "https://modelcontextprotocol.io/specification/2026-07-28/basic/patterns/cancellation"
  - title: MCP 2026-07-28 changelog
    url: "https://modelcontextprotocol.io/specification/2026-07-28/changelog"
  - title: MCP 2026-07-28 specification overview
    url: "https://blog.modelcontextprotocol.io/posts/2026-07-28/"
  - title: "MCP TypeScript SDK: Supporting 2026-07-28"
    url: "https://ts.sdk.modelcontextprotocol.io/v2/migration/support-2026-07-28"
  - title: MCP Inspector
    url: "https://github.com/modelcontextprotocol/inspector"
---
This guide targets the [2026-07-28 revision](/learn/mcp-protocol-versions-explained) of MCP, the current one, and notes where servers that also serve 2025-era clients must behave differently. The rules quoted come from the specification; the rest is design advice.

## Design the capability boundary first

Start from the decisions a user makes, not from the endpoints of the upstream API. A tool should be one understandable operation whose result the model can evaluate.

- `find_customer_orders` is clearer than a generic `request` tool.
- Separate `create_draft_invoice` and `send_invoice` tools keep an approval step between drafting and sending. One `manage_invoice` tool would hide it.

Pick the primitive by who controls it. The specification defines this control model:

| Primitive | Controlled by | Use it for |
| --- | --- | --- |
| [Prompt](/learn/mcp-glossary#prompt) | User | Reusable templates the user invokes, such as slash commands |
| [Resource](/learn/mcp-glossary#resource) | Application | Context the client or user chooses to attach, such as file contents |
| [Tool](/learn/mcp-glossary#tool) | Model | Retrieval or actions the model decides to call |

Turning everything into tools throws away these signals, which clients use for their UI and for consent.

## Tool names, descriptions, and schemas

A tool definition is an interface designed for a model. Keep the name stable and distinct from its neighbours. The specification recommends names of 1 to 128 characters using only ASCII letters, digits, `_`, `-` and `.`, unique within the server.

The description should say:

- when to use the tool, and when not to;
- what side effects it has;
- what authorization it expects;
- what the result means.

Leave out marketing language, and do not ship near-duplicate tools.

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

Constrain enums, lengths, numeric ranges, and additional properties. Schemas without `$schema` are read as JSON Schema 2020-12. Descriptions carry meaning for the model, but the server must enforce security and tenancy itself: the specification requires servers to validate all tool inputs and implement access controls. Never rely on the model to follow prose.

When clients can use structured results, declare an `outputSchema` and return `structuredContent`. Also return the same data as a text block, which the specification recommends for clients that only pass text to the model. See [output schemas and structured content](/learn/mcp-tool-output-schemas-and-structured-content) for the details and the 2025 differences.

Other rules for tool results:

- Return stable IDs alongside display labels.
- Paginate large collections.
- Return actionable domain errors, such as "project not found for this tenant", instead of raw stack traces.
- Do not expose an unrestricted SQL, shell, filesystem, or fetch-any-URL tool unless that power is the product itself, isolated and governed by a policy you can enforce.

## Control context and token cost

Every tool name, description and schema can end up in the model's context and compete for its attention. More tools can make tool selection worse before any tool returns data. Measure the serialized size of the tool list for each authenticated role, and keep the default list short.

Ways to keep it short:

- Group tools around user jobs and remove aliases.
- Return only the tools the presented credentials allow. The specification permits a `tools/list` that varies by the authorization on the request.
- Test selection among tools that are easy to confuse.

The list must not change for other reasons. The specification says it **MUST NOT** vary per connection or as a side effect of other requests. Servers **SHOULD** also return tools in a deterministic order, which lets clients cache the list and improves prompt-cache hit rates.

In 2026-07-28, `tools/list` results carry two required [caching](https://modelcontextprotocol.io/specification/2026-07-28/server/utilities/caching) hints:

- `ttlMs`: how long, in milliseconds, the client may treat the result as fresh.
- `cacheScope`: `"public"` if the result is the same for every caller, `"private"` if it varies by user. A list filtered by authorization must be `"private"`, so shared gateways do not serve one user's tools to another.

Tool results need budgets too:

- Return the smallest result that supports the next decision. Link to detail with cursors or [resource links](/learn/mcp-glossary#resource).
- Truncate only with an explicit marker and a way to continue.
- Treat text from upstream systems as data, never as instructions, and keep its provenance so the host can show where it came from.

## Idempotency and writes

Writes get repeated. A network times out after the server has committed, a user clicks twice, or a client refreshes an expired token and sends the request again.

Make a repeated write safe:

1. Accept an idempotency key, or derive a stable identity for the operation.
2. Store the final result under that key.
3. Return the same result when a legitimate retry arrives.
4. Scope keys by tenant, user, tool, and a bounded time window.

For high-impact actions, separate preview from commit. Before a write the user confirms, return the proposed recipients, amount, permissions or diff. Prefer reversible operations, and include stable audit IDs in results.

[Tool annotations](/learn/mcp-glossary#tool) such as `readOnlyHint` or `destructiveHint` help clients decide when to ask for confirmation. They are hints only: the specification says clients **MUST** treat annotations as untrusted unless the server is trusted. Server-side authorization is still required.

## Stateless protocol versus application state

Do not confuse protocol state with business state. They changed separately in 2026.

- **2025 revisions (2025-03-26 to 2025-11-25):** the client sends `initialize`, and the server may assign a session with the `Mcp-Session-Id` header.
- **2026-07-28:** there is no handshake and no protocol session. Every request carries its protocol version and client capabilities in `params._meta`. Servers must not rely on earlier requests for that context, and must implement `server/discover` to advertise supported versions and capabilities.

A server that also serves 2025 clients has to run both models: stateless for requests with 2026 `_meta`, sessions for an `initialize`. Test both paths explicitly. The [versioning guide](/learn/mcp-protocol-versions-explained) has the negotiation rules.

A stateless HTTP handler can still run a stateful product:

- Keep durable workflow state in a database.
- Return an opaque job, draft, cursor or transaction ID, and accept it as an argument on later calls. The specification requires state that spans requests to be referenced by an explicit identifier like this.
- Let any healthy instance process the next request. Keep only disposable caches in memory.

This is what allows ordinary load balancing, rolling deploys, and recovery when a process dies.

The specification's [stateful tools guidance](https://modelcontextprotocol.io/specification/2026-07-28/server/tools) adds four points about such handles:

- A handle is a name, not a permission. Check the caller's authorization against it on every call.
- Make it opaque, so it cannot be parsed or guessed.
- State its lifetime in the description of the tool that creates it, for example "drafts expire after 24 hours".
- Answer an expired or unknown handle with a tool execution error that says so, so the model can create a new one.

If a legacy 2025 client path needs state pinned to a session, define its expiry, routing, draining and what happens when it is lost. Never let an in-memory session be the only record of a completed external write.

## Authentication and tenant isolation

Over HTTP, the MCP server is an OAuth resource server. Validate every request on its own:

- the token's issuer, expiry and scopes;
- that the token was issued for this server as its audience (the specification requires this);
- the tenant and subject it represents.

Accept only tokens issued for your server. The specification forbids accepting or passing through any other token, so call upstream APIs with their own credentials.

Map each credential to an internal principal before dispatching the tool. Then authorize the specific object and action. A valid token does not grant access to every record named in the arguments.

Keep upstream service credentials on the server:

- Encrypt refresh tokens at rest and restrict who can decrypt them.
- Rotate keys, and make revocation take effect.

Transport-specific rules:

- **stdio:** the authorization specification does not apply; servers read credentials from the environment. Pass only the variables the server needs, and document its filesystem and network access.
- **HTTP:** validate the `Origin` header on every request and reject an invalid one with `403`. Bind local-only servers to `127.0.0.1`. Serve over HTTPS, set request and body size limits, and do not follow arbitrary redirects or fetch arbitrary URLs.

## Logging and tracing

Operational logs are separate from MCP tool results. For each request, record:

- a request or correlation ID and the protocol version;
- the client name and version, if sent, which are self-reported and must not drive security decisions;
- the authenticated principal or a tenant pseudonym;
- the tool name, outcome and latency;
- the upstream dependency and retry count;
- the rate-limit decision;
- an estimate of the bytes or tokens returned.

Redact arguments and results by default. Allow field-level diagnostics only under explicit governance.

The 2026-07-28 revision changes two things here:

- **Trace context.** `_meta` reserves the keys `traceparent`, `tracestate` and `baggage` for [OpenTelemetry](https://opentelemetry.io/) propagation, in W3C Trace Context and Baggage format. Continue that trace into upstream API calls so a failed tool call can be followed end to end.
- **Protocol logging.** `logging/setLevel` is removed. A client asks for log messages per request with `io.modelcontextprotocol/logLevel` in `_meta`, and the server must not send `notifications/message` for requests without it. The Logging feature is also deprecated; the specification suggests `stderr` for stdio servers and OpenTelemetry otherwise.

Never log authorization codes, PKCE verifiers, access or refresh tokens, client secrets, or full sensitive documents.

Define metrics and alerts for:

- authentication failures;
- per-tool latency and error rate;
- throttling and dependency saturation;
- idempotency replays;
- unexpected changes to the tool list.

Audit writes separately: actor, authorization decision, normalized action, target, result, and a reference for reversing the operation.

## Rate limits and load shedding

The specification requires servers to rate limit tool invocations. Limit by tenant, user, client, tool cost and upstream quota, not only by IP address. Give cheap reads and expensive exports or writes separate limits.

When you refuse a request, return a stable, machine-readable error with a safe retry hint. Clients should add jitter and cap the number of attempts.

Bound everything that can grow:

- concurrency;
- request size and response size;
- page size;
- streaming duration.

When overloaded, reject before starting expensive work. For long operations, create a durable job and return its handle instead of holding one request open indefinitely. The optional `io.modelcontextprotocol/tasks` extension standardizes this pattern; it replaces the experimental tasks of 2025-11-25.

Handle cancellation:

- **Streamable HTTP:** the client cancels by closing the request's response stream. The server **MUST** treat that as cancellation and **SHOULD** stop work.
- **stdio:** the client sends `notifications/cancelled`.

Cancellation can arrive after a write committed, so durable state must let anyone inspect an ambiguous outcome.

## Failure handling contract

MCP has two error channels:

- **Protocol errors** are JSON-RPC errors, for example `-32602` for an unknown tool.
- **Tool execution errors** are results with `isError: true` and a text explanation the model can act on. Since 2025-11-25, input validation failures belong here.

Authentication failures are HTTP responses. Classify failures so clients and operators know what to do:

- **Invalid input:** a tool execution error that names the fields, without echoing secrets. Do not retry unchanged.
- **Unauthenticated:** HTTP `401` with a `WWW-Authenticate: Bearer` challenge that includes `resource_metadata`, so the client can find the authorization server.
- **Missing scope:** HTTP `403` with `error="insufficient_scope"` and every scope the operation needs in one challenge, so the client can step up once.
- **Not permitted:** a permission the user cannot gain by consenting again. Say what is missing, without suggesting that a new login will help.
- **Conflict or idempotent replay:** return the existing resource, or report a version conflict.
- **Dependency unavailable or rate limited:** say whether a retry is safe and when.
- **Unknown outcome:** return a correlation or operation ID that can be queried before repeating a write.
- **Internal defect:** a stable public error for the client; the full redacted trace for operators; no stack traces or secrets.

Test each class with timeouts injected:

- before commit and after commit;
- while the response is streaming;
- during a token refresh;
- across a deploy or restart.

## Production readiness gate

Before publishing, require:

- schema validation tests;
- authorization and cross-tenant tests;
- idempotency tests;
- protocol version and transport compatibility tests, for both eras if you serve both;
- context-size measurements of the tool list;
- rate-limit behaviour;
- dependency-failure injection;
- assertions that secrets are redacted from logs;
- restart and redeploy checks;
- a human review of every write tool.

Run the server in the [MCP Playground](/) and in the official [Inspector](https://github.com/modelcontextprotocol/inspector), then test it in every client you claim to support.

Publish, alongside the server:

- the endpoint, and its authentication and scopes;
- the tool inventory;
- a data handling statement;
- the hosting owner and a support channel;
- the change policy;
- the matrix of clients and versions you tested;
- the date of the last review.

Operations and evidence are part of the integration, not follow-up work.

See also: [tool annotations and client retries](/learn/mcp-tool-annotations-and-client-retries), [long-running tools](/learn/mcp-long-running-tools), [tool errors agents can act on](/learn/mcp-tool-errors-agents-can-act-on) and [bot protection that blocks MCP clients](/learn/mcp-bot-protection-blocking-clients).
