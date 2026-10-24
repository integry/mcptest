---
title: Which MCP tool changes break clients, and how to ship them safely
navTitle: Breaking tool changes
summary: Clients cache tools/list, so a deploy that changes a tool can break agents that still hold the old schema. Which changes break callers, which only change behavior, why list_changed does not save a stateless server, and how to version and ship changes safely.
track: build
level: practitioner
order: 27
category: Tool contracts
readingTimeMinutes: 9
lastReviewed: "2026-10-24"
metaTitle: Which MCP Tool Changes Break Clients | mcptest.io
metaDescription: Which MCP tool changes are breaking for clients that cached tools/list. Removed tools, new required inputs, narrowed types, output schemas, descriptions, annotations, list_changed limits and versioning.
relatedSlugs:
  - mcp-tool-output-schemas-and-structured-content
  - designing-production-mcp-server
  - test-mcp-server-before-deploying
  - mcp-server-connected-but-no-tools
sourceLinks:
  - title: "MCP 2026-07-28 specification: tools (listing, list changed, output schema, annotations)"
    url: "https://modelcontextprotocol.io/specification/2026-07-28/server/tools"
  - title: "MCP 2025-11-25 specification: tools"
    url: "https://modelcontextprotocol.io/specification/2025-11-25/server/tools"
  - title: MCP 2026-07-28 changelog (caching, subscriptions/listen, stateless lifecycle)
    url: "https://modelcontextprotocol.io/specification/2026-07-28/changelog"
  - title: "MCP 2026-07-28 specification: overview"
    url: "https://modelcontextprotocol.io/specification/2026-07-28/basic/index"
  - title: "MCP 2025-11-25 specification: Streamable HTTP transport"
    url: "https://modelcontextprotocol.io/specification/2025-11-25/basic/transports"
---

An MCP client does not ask for your tool list before every call. It lists tools when it connects, keeps the result, and builds tool calls from that copy. Some clients keep it for the life of the process, some for the `ttlMs` your 2026-07-28 server returned, and a published ChatGPT app keeps it until an admin refreshes it. A deploy that changes a tool therefore meets clients that still hold the previous schema. This guide sorts changes by what they do to those clients, then covers how to ship the ones that break.

To see how a specific change is classified, paste the old and new `tools/list` results into the [breaking-change check](/tools/breaking-changes). It applies exactly the rules below.

## Why a cached tool list matters

Three things happen between your deploy and the moment a client sees the new list:

- **The client keeps its copy.** Desktop clients typically list tools once per server start. Agents built on an SDK often list once per session. Under 2026-07-28, list results carry `ttlMs` and `cacheScope`, and a client may reuse a list until the TTL expires.
- **The model keeps its copy.** Tool definitions sit in the model's context for the rest of a conversation. A model that has seen `search(query)` keeps calling it with those arguments even after the client refreshes.
- **Generated code keeps its copy.** Clients that use structured output often generate a parser or type from `outputSchema`, and that code does not change until someone regenerates it.

A change is breaking when a call or a parser that was valid against the old listing can fail against the new server. A change is risky when nothing fails validation but behavior changes. Everything else is safe.

## The notification does not solve it

The protocol does have a way to tell clients the list changed: a server that declares `tools.listChanged` can send `notifications/tools/list_changed`, and the client lists tools again. Do not rely on it to make a breaking change safe:

- **It needs an open channel.** Under 2025-11-25 Streamable HTTP, a server can only push a notification on a stream the client is holding open, such as the optional GET stream of a session. A stateless server, one that issues no `Mcp-Session-Id` and answers each POST independently, has nowhere to send it. Under 2026-07-28 there are no sessions at all, and change notifications arrive only on a `subscriptions/listen` stream the client opened with `toolsListChanged: true`. Many clients never open one.
- **It arrives after the deploy.** Requests already in flight, and conversations whose context already holds the old definitions, still use the old schema.
- **Clients are not required to act on it immediately**, and a TTL-based cache is valid until it expires by definition.

Treat the notification as a way to pick up additive changes sooner, not as a migration mechanism.

## Removing or renaming a tool {#removing-or-renaming-a-tool}

**Breaking.** A client that cached the old list still calls the old name and gets an unknown-tool error. A rename is a removal plus an addition, so it breaks exactly as badly; the check reports it as a rename when the new tool keeps the same input schema and description.

Ship it by adding the new tool first, keeping the old name working as an alias for at least one cache lifetime (your longest `ttlMs`, and in practice a few weeks for published apps), and only then removing it. Mark the old tool as deprecated in its description so models prefer the new one.

## Adding a required input {#adding-a-required-input}

**Breaking.** Old callers do not know about the input, so they never send it, and their calls fail validation. Making an existing optional input required is the same change.

Add the input as optional with a server-side default instead. If the value truly cannot be defaulted, add a new tool that requires it and keep the old one.

## Removing an input {#removing-an-input}

What happens depends on `additionalProperties`:

- **Breaking** when the schema sets `additionalProperties: false`. Callers that still send the input now send an undeclared property and fail validation.
- **Risky** otherwise. Calls still validate, but the server silently ignores something the caller meant, which is worse to debug than an error.

Keep accepting the input and ignore it with a log line until callers stop sending it.

## Narrowing an input {#narrowing-an-input}

**Breaking.** Any change that rejects a value the old schema accepted:

- the type narrows, for example `string` to `integer`, or `["string", "null"]` to `string`;
- an enum loses a value, or a free-form input gains an enum;
- `additionalProperties: false` is added;
- a property gains a schema stricter than what the old `additionalProperties` allowed.

Widening is the safe direction: `integer` to `number`, adding an enum value, dropping `additionalProperties: false`.

## Changing the output contract {#changing-the-output-contract}

Outputs run the other way: the client is the reader, so a change is breaking when it produces something an old parser does not expect.

- **Adding an `outputSchema` to a tool that had none: breaking for structured-output clients.** Once a tool declares an output schema, the server must return `structuredContent` that conforms, and clients that use structured output start validating against the new contract and parsing `structuredContent` instead of the text they relied on.
- **Removing the `outputSchema`: breaking.** Clients lose the contract they parse against.
- **Removing an output property, changing its type, or no longer guaranteeing a required property: breaking.**
- **An enum in the output gaining values: risky.** A client that switches over the known values meets one it does not handle.
- **Adding an output property, or returning a narrower type: safe.**

See [output schemas and structured content](/learn/mcp-tool-output-schemas-and-structured-content) for how clients validate.

## Rewriting a description {#rewriting-a-description}

**Risky.** Models choose tools from their names and descriptions. A rewritten description can make an agent pick the tool in situations it used to avoid, or stop picking it. Nothing fails, so this shows up as a quality regression rather than an error. The check compares wording and treats a small edit as safe and a substantial rewrite as risky. Changing an input's `default` is risky for the same reason: callers that omit the input get different behavior without changing anything.

Evaluate a description change like a prompt change: run the agent tasks that depend on the tool before and after.

## Changing annotations {#changing-annotations}

Annotations are hints, but clients use them to decide what to auto-approve and what to confirm.

- **Risky:** `readOnlyHint` going from `true` to `false` (or being dropped, since the default is `false`), `destructiveHint: true` being added, `idempotentHint` going from `true` to `false`, `openWorldHint` becoming `true`. A client that auto-approved a read-only tool may now let it write.
- **Safe:** the reverse changes, and a `title` change.

## Prompts and resources {#prompts-and-resources}

The same logic applies when a server lists prompts and resources. Removing a prompt or a resource, or making a prompt argument required, is breaking. Removing a prompt argument is risky. Adding prompts, resources or optional arguments is safe. The check compares them only when both listings include them.

## Changes that are safe {#changes-that-are-safe}

Old clients never notice these, and they see the new capability after their next refresh:

- adding a tool, prompt or resource;
- adding an optional input, or making a required input optional;
- adding an enum value or widening a type on an input;
- adding an output property;
- changing a title, an input's description or examples, or rewording a description slightly.

## Changes mcptest cannot classify {#changes-mcptest-cannot-classify}

Some schema keywords have no reliable compatibility rule, for example `pattern`, `maxLength` or a `oneOf` rewrite. The check reports these as risky and says which keyword changed. Stored report snapshots also redact parts of schemas, such as enum values, and keep no output schemas or annotations, so comparisons against a published report say what they could not compare.

## Versioning strategies

Pick one approach and use it consistently:

- **Additive only.** Never remove or narrow; add new optional inputs and new tools. This is the simplest strategy and covers most servers.
- **Versioned tool names.** Ship `search_v2` next to `search`, mark the old one deprecated in its description, and remove it after the cache window. Models handle two similar tools well when the descriptions say which one to prefer.
- **Versioned endpoints.** Serve a new endpoint, such as `/mcp/v2`, for a redesign and keep the old endpoint running. Clients move when their configuration changes, never by surprise.

Whatever the strategy, keep `ttlMs` honest: a short TTL shortens the window in which clients hold an old list, at the cost of more listing traffic.

## Check every deploy

1. Save the current `tools/list` result before you deploy, then compare it with the new one in the [breaking-change check](/tools/breaking-changes), or point the check at the live endpoint and compare against its latest published report.
2. Publish a report and turn on **Watch weekly**. For public servers that list tools without authorization, mcptest lists the tools once a week, publishes each classified change in an Atom feed for the endpoint, and shows "breaking change" on the live report badge until you publish a newer report.
3. Run the [release-readiness checks](/learn/test-mcp-server-before-deploying) for everything else a deploy can break.
