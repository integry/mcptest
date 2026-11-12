---
title: Should you build an MCP server?
summary: A decision framework for choosing MCP, a normal API, direct function calling, client-specific apps or skills, or an integration gateway.
track: understand
level: newcomer
order: 3
category: Strategy
readingTimeMinutes: 8
lastReviewed: "2026-11-11"
relatedSlugs:
  - designing-production-mcp-server
  - mcp-clients-compared
sourceLinks:
  - title: MCP introduction
    url: "https://modelcontextprotocol.io/docs/getting-started/intro"
  - title: MCP architecture (2026-07-28)
    url: "https://modelcontextprotocol.io/specification/2026-07-28/architecture"
  - title: MCP server features (2026-07-28)
    url: "https://modelcontextprotocol.io/specification/2026-07-28/server/index"
  - title: MCP 2026-07-28 key changes
    url: "https://modelcontextprotocol.io/specification/2026-07-28/changelog"
  - title: MCP Apps overview
    url: "https://modelcontextprotocol.io/extensions/apps/overview"
  - title: Build with Agent Skills
    url: "https://modelcontextprotocol.io/docs/develop/build-with-agent-skills"
---
## Start with the distribution problem

An MCP server is an adapter that lets AI applications (hosts) discover and call your capabilities. It pays off when several hosts should use the same focused set of tools. It does not replace your system of record or your normal API, and it does not guarantee that models use the tools correctly.

Ask first: **who is the consumer?** If the only consumer is your own backend, direct application code or function calling is usually simpler. If users want the same integration in Claude Code, VS Code, Cursor, ChatGPT and other MCP hosts, one tested MCP server replaces a separate adapter for each client.

## Compare the options

| Option | Best when | You own | Main trade-off |
| --- | --- | --- | --- |
| Normal API | Deterministic software clients need stable service contracts | HTTP/API contract, SDKs, auth, versioning | AI hosts still need an adapter and tool descriptions |
| Direct function calling | One application controls the model loop and a small tool set | Model-provider schema, execution, retries, consent UX | Tight coupling to that application and model API |
| MCP server | Several MCP hosts should discover the same tools, resources or prompts | Protocol adapter, transport, auth, compatibility testing across clients and protocol revisions | More clients to test, and they differ in what they support |
| Client-specific plugin/app | One client's unique UI, distribution, or policy is the product | That platform's packaging, review, and lifecycle | Faster fit in one host, less cross-client reuse |
| Skill/instruction package | The missing piece is repeatable know-how for tools that already exist | Instructions, examples, optional scripts | It cannot provide secure live access by itself |
| Gateway/aggregator | Many internal APIs or MCP servers need one policy and discovery boundary | Routing, namespacing, identity, policy, observability | Concentrated trust, context size, and operational complexity |

These options compose. A common production design is a stable REST or event API as the source of truth, a narrow MCP server as one adapter, OAuth for user delegation, and optional client-specific packaging for installation or richer UI.

## Signals that justify MCP

### Cross-client reuse is real

You can name the clients, you have users on more than one of them, and you have a compatibility test plan. Two actual consumers with the same core jobs are stronger evidence than “the ecosystem might want it”. MCP standardizes how tools are discovered and called; each host still decides how the model uses them and when to ask the user.

### User authorization belongs at the integration boundary

A remote MCP server can act for the signed-in user, with scoped access granted through OAuth. This helps when users connect their own SaaS accounts: the client gets a token for your MCP server only, never the user's password or your upstream service credentials. Per-user tokens also give you revocation and a per-user audit trail.

### Runtime discovery improves the experience

Clients list your tools and resources at run time through one protocol, instead of each host copying them into its own function schema. This matters when capabilities change or depend on the scopes a user granted, as long as the list stays small and predictable enough for hosts and models to use. Since `2026-07-28`, list results also carry a cache lifetime (`ttlMs`), so clients can avoid re-fetching an unchanged list.

### The server has a focused boundary

Good MCP servers cover one coherent domain: incident investigation, design lookup, ticket workflows, policy-controlled database exploration, or local project automation. A thin wrapper around every endpoint of a large API usually produces ambiguous tools, oversized schemas and unsafe writes.

## Signals to choose something simpler

Use your **normal API** when consumers are deterministic services, mobile/web applications, batch jobs, or partners who need conventional SDKs, caching, webhooks, and SLAs. MCP can sit above it later.

Use **direct function calling** when one product owns the agent loop and needs only a handful of internal functions. You pass native types directly, keep latency low and build exactly one approval experience. No cross-client benefit offsets the extra protocol boundary.

Use a **client-specific app or plugin** when the differentiator is proprietary UI, marketplace distribution, background behaviour or host-only APIs. [MCP Apps](https://modelcontextprotocol.io/extensions/apps/overview), an official MCP extension, can add interactive UI that works in more than one host, but support and review policies still differ by client.

Use a **skill** when the tools already exist and the problem is teaching an agent a workflow, domain convention or sequence of checks. Skills can include instructions and scripts, but they must not carry credentials, and static guidance is not an authorization boundary.

Use a **gateway** only when centralized policy earns its cost: shared identity translation, tool namespacing, tenant isolation, allowlists, auditing, or controlled access to many backends. A gateway that merges hundreds of tools without curation inflates the model's context, raises the risk of name collisions, widens the damage a compromise can do, and makes failures harder to trace.

## The decision worksheet

Answer each question with evidence, not aspiration:

1. **Consumers:** Which two or more MCP clients will you support in the next release?
2. **Job:** What user outcome requires model-directed access rather than an ordinary UI or API call?
3. **Primitives:** Are you exposing actions (tools), attachable context (resources), or user-selected templates (prompts)?
4. **Authorization:** Is access per-user, per-tenant, or service-to-service? Which scopes and revocation path exist?
5. **Risk:** What can read, write, delete, spend money, message people, or expose sensitive data?
6. **Discovery cost:** How many tool definitions and schema tokens will clients receive? Can the set be smaller?
7. **Operations:** Who owns availability, rate limits, audit logs, credential storage, migrations, and incident response? If state must span calls, how will you return it as an explicit handle, now that `2026-07-28` has no protocol sessions?
8. **Compatibility:** How will you serve and test both stateless `2026-07-28` clients and clients that still start with a 2025 `initialize` handshake?
9. **Alternative:** What is the simplest non-MCP implementation, and what measurable reuse would MCP add?

Build when the cross-client, authorization and discovery benefits are concrete and the team accepts the operational work. Otherwise, keep the core capability behind a normal API and add the MCP adapter later, once usage shows which tools are worth exposing.

If the answer is yes, continue with [Designing a production MCP server](/learn/designing-production-mcp-server) before choosing an SDK or hosting provider.
