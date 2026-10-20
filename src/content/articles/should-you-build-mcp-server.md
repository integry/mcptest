---
title: Should you build an MCP server?
summary: A decision framework for choosing MCP, a normal API, direct function calling, client-specific apps or skills, or an integration gateway.
track: understand
level: newcomer
order: 3
category: Strategy
readingTimeMinutes: 8
lastReviewed: 2026-08-17
relatedSlugs:
  - designing-production-mcp-server
  - mcp-clients-compared
sourceLinks:
  - title: MCP introduction
    url: "https://modelcontextprotocol.io/docs/getting-started/intro"
  - title: MCP architecture
    url: "https://modelcontextprotocol.io/specification/2025-06-18/architecture"
  - title: MCP server primitives
    url: "https://modelcontextprotocol.io/specification/2025-06-18/server/index"
  - title: MCP development paths
    url: "https://modelcontextprotocol.io/docs/develop/build-with-agent-skills"
---
## Start with the distribution problem

MCP is a protocol adapter between AI hosts and capabilities. It is most valuable when several compatible hosts should discover and invoke the same focused interface. It does not replace the system of record, erase the need for a normal API, or guarantee that models use tools correctly.

Ask first: **Who is the consumer?** If the only consumer is your own backend, direct application code or function calling is usually simpler. If users want the same integration in Claude Code, VS Code, Cursor, ChatGPT, and future MCP hosts, a tested MCP layer can reduce repeated client-specific adapters.

## Compare the options

| Option | Best when | You own | Main trade-off |
| --- | --- | --- | --- |
| Normal API | Deterministic software clients need stable service contracts | HTTP/API contract, SDKs, auth, versioning | AI hosts still need an adapter and tool descriptions |
| Direct function calling | One application controls the model loop and a small tool set | Model-provider schema, execution, retries, consent UX | Tight coupling to that application and model API |
| MCP server | Multiple MCP hosts should discover reusable tools/resources/prompts | Protocol adapter, transport, auth, compatibility testing | Broader interoperability surface and client variance |
| Client-specific plugin/app | One client's unique UI, distribution, or policy is the product | That platform's packaging, review, and lifecycle | Faster fit in one host, less cross-client reuse |
| Skill/instruction package | The missing piece is repeatable know-how using tools already available | Instructions, examples, optional scripts | It cannot create secure live access by itself |
| Gateway/aggregator | Many internal APIs or MCP servers need one policy and discovery boundary | Routing, namespacing, identity, policy, observability | Concentrated trust, context size, and operational complexity |

These options compose. A common production design is a stable REST or event API as the source of truth, a narrow MCP server as one adapter, OAuth for user delegation, and optional client-specific packaging for installation or richer UI.

## Signals that justify MCP

### Cross-client reuse is real

You have named client surfaces, users on more than one of them, and a compatibility test plan. “The ecosystem might want it” is weaker than two actual consumers with the same core jobs. MCP standardizes discovery and invocation, while each host keeps control of model orchestration and consent.

### User authorization belongs at the integration boundary

A remote MCP server can represent the current user and obtain scoped access through OAuth. This is useful when users connect their own SaaS accounts and the client should never receive the upstream password or long-lived service credential. It also supports revocation and per-user audit.

### Runtime discovery improves the experience

The available tools or resources can be described through one protocol rather than copied into each host's proprietary function schema. Discovery is valuable when capabilities evolve or vary by granted scopes—provided the catalog stays small and predictable enough for hosts and models to use.

### The server has a focused boundary

Good MCP servers express a coherent domain: incident investigation, design lookup, ticket workflows, database exploration with policy, or local project automation. A thin wrapper around every endpoint of a huge API usually creates ambiguous tools, excessive schemas, and unsafe writes.

## Signals to choose something simpler

Use your **normal API** when consumers are deterministic services, mobile/web applications, batch jobs, or partners who need conventional SDKs, caching, webhooks, and SLAs. MCP can sit above it later.

Use **direct function calling** when one product owns the agent loop and only needs a handful of internal functions. You can translate native types directly, minimize latency, and implement exactly one approval experience. There is no cross-client benefit to offset another protocol boundary.

Use a **client-specific app or plugin** when the differentiator is proprietary UI, marketplace distribution, background lifecycle, or host-only APIs. MCP Apps can add portable interactive content where supported, but client capability and review policies still differ.

Use a **skill** when tools already exist and the problem is teaching an agent a workflow, domain convention, or sequence of checks. Skills can include instructions and scripts, but they should not smuggle credentials or pretend static guidance is a live authorization boundary.

Use a **gateway** only when centralized policy earns its cost: shared identity translation, tool namespacing, tenant isolation, allowlists, auditing, or controlled access to many backends. A gateway that indiscriminately merges hundreds of tools increases model context, collision risk, blast radius, and debugging distance.

## The decision worksheet

Score each answer with evidence, not aspiration:

1. **Consumers:** Which two or more MCP clients will you support in the next release?
2. **Job:** What user outcome requires model-directed access rather than an ordinary UI or API call?
3. **Primitives:** Are you exposing actions (tools), attachable context (resources), or user-selected templates (prompts)?
4. **Authorization:** Is access per-user, per-tenant, or service-to-service? Which scopes and revocation path exist?
5. **Risk:** What can read, write, delete, spend money, message people, or expose sensitive data?
6. **Discovery cost:** How many tool definitions and schema tokens will clients receive? Can the set be smaller?
7. **Operations:** Who owns availability, rate limits, audit logs, credential storage, migrations, and incident response?
8. **Compatibility:** How will you test current and older protocol/client behavior?
9. **Alternative:** What is the simplest non-MCP implementation, and what measurable reuse would MCP add?

Build when the cross-client, authorization, and discovery benefits are concrete and the team accepts the operational boundary. Otherwise, keep the core capability behind a normal API and delay the adapter. That choice preserves the option to add MCP after usage clarifies the right tools.

If the answer is yes, continue with [Designing a production MCP server](/learn/designing-production-mcp-server) before choosing an SDK or hosting provider.
