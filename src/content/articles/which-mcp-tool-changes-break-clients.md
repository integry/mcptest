---
title: Which MCP tool changes break clients, and how to ship them safely
navTitle: Breaking tool changes
summary: Clients cache tools/list, so a deploy that changes a tool can break agents that still hold the old schema. Which changes break callers, which only change behavior, why list_changed does not save a stateless server, and how to version and ship changes safely.
track: build
level: practitioner
order: 28
category: Tool contracts
readingTimeMinutes: 10
lastReviewed: "2026-11-11"
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

An MCP client does not fetch your tool list before every call. It lists tools, keeps the result, and builds calls from that copy. How long it keeps the copy depends on the client:

- some keep it until the process restarts;
- a client talking to a 2026-07-28 server may keep it for the `ttlMs` your server returned;
- a ChatGPT plugin published to a workspace keeps the tools it saw at publish time until an admin refreshes it.

So a deploy that changes a tool meets clients that still hold the old schema. This guide sorts changes by what they do to those clients, then shows how to ship the ones that break.

To see how a specific change is classified, paste the old and new `tools/list` results into the [breaking-change check](/tools/breaking-changes). It applies the rules below.

## Why a cached tool list matters

Between your deploy and the moment a client uses the new list, three copies of the old one can still be in use:

- **The client's copy.** Desktop clients typically list tools when they start the server. Agents built on an SDK often list once per connection. Under 2026-07-28, every `tools/list` result carries `ttlMs` (how many milliseconds the client may treat it as fresh) and `cacheScope` (`public` or `private`), so a client can legitimately reuse an old list until the TTL runs out.
- **The model's copy.** Tool definitions stay in the model's context for the rest of a conversation. A model that has seen `search(query)` keeps calling it that way, even after the client refreshes its list.
- **Generated code.** Clients that use structured output often generate a parser or type from `outputSchema`. That code does not change until someone regenerates it.

The rest of this guide uses three labels:

- **Breaking:** a call or a parser that was valid against the old listing can fail against the new server.
- **Risky:** nothing fails validation, but behavior changes.
- **Safe:** old clients never notice.

## The notification does not solve it

A server that declares `tools.listChanged` can send `notifications/tools/list_changed`, and the client then lists tools again. Do not rely on it to make a breaking change safe:

- **It needs an open channel.** Under 2025-11-25 Streamable HTTP, a notification that is not part of a request's response needs a stream the client holds open, such as the optional GET stream. A stateless server, one that issues no `Mcp-Session-Id` and answers each POST on its own, usually offers no such stream. Under 2026-07-28 there are no sessions at all: the notification reaches only clients that opened a `subscriptions/listen` stream with `toolsListChanged: true`. A client that has not opened one never hears about the change.
- **It arrives after the deploy.** Requests already in flight still use the old schema, and so do conversations whose context holds the old definitions.
- **It only marks the cache stale.** Under 2026-07-28 the notification invalidates a cached list even before its TTL expires, but the client fetches the new list only when it next needs it. Nothing updates what the model already read.

Treat the notification as a way to pick up additive changes sooner, not as a migration mechanism.

## Removing or renaming a tool {#removing-or-renaming-a-tool}

**Breaking.** A client with the old list still calls the old name and gets an unknown-tool error. A rename is a removal plus an addition, so it breaks in the same way. The check reports a removed tool and an added tool as a rename when they have the same input schema and a similar description.

To ship it:

1. Add the new tool.
2. Keep the old name working as an alias for at least one cache lifetime: your longest `ttlMs`, and in practice a few weeks for published plugins.
3. Say in the old tool's description that it is deprecated, so models prefer the new one.
4. Remove the old tool.

## Adding a required input {#adding-a-required-input}

**Breaking.** Old callers do not know about the input, so they never send it, and their calls fail validation. Making an existing optional input required is the same change.

Add the input as optional with a server-side default instead. If the value truly cannot be defaulted, add a new tool that requires it and keep the old one.

## Removing an input {#removing-an-input}

The result depends on `additionalProperties`:

- **Breaking** when the schema sets `additionalProperties: false`. Callers that still send the input now send an undeclared property and fail validation.
- **Risky** otherwise. Calls still validate, but the server silently ignores something the caller meant. That is harder to debug than an error.

Keep accepting the input, and ignore it with a log line, until callers stop sending it.

## Narrowing an input {#narrowing-an-input}

**Breaking.** This covers any change that rejects a value the old schema accepted:

- the type narrows, for example `string` to `integer`, or `["string", "null"]` to `string`;
- an enum loses a value, or a free-form input gains an enum;
- `additionalProperties: false` is added;
- a new optional property declares a schema stricter than what the old `additionalProperties` allowed for it.

Widening is the safe direction: `integer` to `number`, adding an enum value, dropping `additionalProperties: false`.

## Changing the output contract {#changing-the-output-contract}

For outputs the roles are reversed: the client reads what the server writes. A change is breaking when the server can now produce something an old parser does not expect.

- **Adding an `outputSchema` to a tool that had none: breaking for structured-output clients.** Once a tool declares an output schema, the server must return conforming `structuredContent`. Clients that use structured output start validating against the new contract and parse `structuredContent` instead of the text they relied on.
- **Removing the `outputSchema`: breaking.** Clients lose the contract they parse against.
- **Removing an output property, changing its type, or making a required property optional: breaking.**
- **Output values no longer limited to the old enum: risky.** This covers new enum values and a dropped `enum`. A client that switches over the known values meets one it does not handle.
- **Adding an output property, returning fewer types, or returning fewer enum values: safe.**

The check compares `type`, `properties`, `required`, `enum` and `items` in output schemas. It does not report changes to other output keywords, such as `pattern` or `format`, so review those by hand.

See [output schemas and structured content](/learn/mcp-tool-output-schemas-and-structured-content) for how clients validate.

## Rewriting a description {#rewriting-a-description}

**Risky.** Models choose tools from their names and descriptions. A rewritten description can make an agent pick the tool where it used to avoid it, or stop picking it. Nothing fails, so the change shows up as a quality regression, not an error.

The check compares the words in the old and new descriptions. A small edit is safe; a substantial rewrite, or adding or removing the description entirely, is risky.

Changing an input's `default` is risky for the same reason: callers that omit the input get different behavior without changing anything.

Evaluate a description change like a prompt change: run the agent tasks that depend on the tool before and after.

## Changing annotations {#changing-annotations}

Annotations are hints. Clients still use them to decide what to auto-approve and what to confirm.

- **Risky:**
  - `readOnlyHint` going from `true` to `false`, or being dropped (the default is `false`). A client that auto-approved a read-only tool may now let it write.
  - `destructiveHint: true` being added.
  - `idempotentHint` going from `true` to `false`, or being dropped (the default is `false`).
  - `openWorldHint` going from `false` to `true`, or being dropped (the default is `true`).
- **Safe:** the reverse changes, and a `title` change.

## Prompts and resources {#prompts-and-resources}

The same logic applies to prompts, resources and resource templates:

- **Breaking:** removing a prompt, a resource or a resource template, or making a prompt argument required.
- **Risky:** removing a prompt argument.
- **Safe:** adding prompts, resources, templates or optional arguments.

The check compares these only when both listings include them.

## Changes that are safe {#changes-that-are-safe}

Old clients never notice these. They see the new capability after their next refresh:

- adding a tool, prompt or resource;
- adding an optional input, or making a required input optional;
- adding an enum value or widening a type on an input;
- adding an output property;
- changing a title, an input's description or examples, or rewording a description slightly.

## Changes mcptest cannot classify {#changes-mcptest-cannot-classify}

Some input-schema keywords have no reliable compatibility rule, for example `pattern`, `maxLength` or a rewritten `oneOf`. The check reports a change to one of these as risky and names the keyword.

Comparisons against a published report have further limits. Stored report snapshots redact parts of input schemas, such as enum values and defaults, and keep no output schemas or annotations. The result lists what could not be compared.

## Versioning strategies

Pick one approach and use it consistently:

- **Additive only.** Never remove or narrow; add new optional inputs and new tools. This is the simplest strategy and covers most servers.
- **Versioned tool names.** Ship `search_v2` next to `search`, mark the old one deprecated in its description, and remove it after the cache window. Say in the descriptions which tool to prefer, so models do not split calls between them.
- **Versioned endpoints.** For a redesign, serve a new endpoint such as `/mcp/v2` and keep the old one running. Clients move when their configuration changes, never by surprise.

Whatever the strategy, keep `ttlMs` honest. A short TTL shortens the window in which clients hold an old list, at the cost of more listing traffic.

## Check every deploy

1. Before you deploy, save the current `tools/list` result. After the deploy, compare it with the new one in the [breaking-change check](/tools/breaking-changes). The check can also list a live endpoint and compare it with its latest published report or with the last connection saved in your browser.
2. Publish a report and turn on **Watch weekly**. For public servers that list tools without authorization, mcptest then lists the tools once a week and publishes each classified change in an Atom feed for the endpoint. When it finds a breaking change, the live report badge shows "breaking change" until you publish a newer report.
3. Run the [release-readiness checks](/learn/test-mcp-server-before-deploying) for everything else a deploy can break.

## Weekly push alerts

After you publish and enable **Watch weekly**, open **Alerts** in Published history and save one destination: a Slack incoming webhook, a Discord webhook, or a generic HTTPS webhook.

- **Who can manage it:** anyone holding the removal token of a retained snapshot for the endpoint. No account is needed, so keep the removal token safe.
- **Where the URL is kept:** inside the endpoint's Durable Object. Only its kind and host can be read back.
- **What triggers an alert:** breaking and risky changes. The alert lists the findings and links to the report and this guide. Safe changes appear only in the Atom feed.
- **Rate limits:** at most one alert per run, and one per 24 hours unless the classification changes.
- **Delivery:** each attempt times out after five seconds, follows no redirects, and is retried once. Five consecutive failed deliveries disable the destination. Published history shows the last delivery result; save the destination again to re-enable it.
- **Testing:** **Send test alert** checks delivery, at most once per minute.
- **Removal:** removing the final published snapshot deletes the alert destination.

### Verifying webhook alerts

Generic webhooks receive JSON with these fields: `event` (`watch.breaking`, `watch.risky` or `watch.test`), `endpoint`, `classifiedAt`, `summary`, `counts`, `topFindings`, `reportUrl`, `feedUrl` and `guideUrl`. Slack and Discord receive their native message formats.

Setup shows a random signing secret once. Save it securely. Replacing a destination rotates its secret.

To verify a delivery:

1. Read `X-Mcptest-Signature`. It is `sha256=` followed by the lowercase hex HMAC-SHA256 of the **exact raw UTF-8 request body**, keyed with the displayed secret as UTF-8 text. Do not hex-decode the secret. In Node.js: `createHmac('sha256', secret).update(rawBody).digest('hex')`.
2. Compare the signatures in constant time before you parse or process the JSON.
3. Check `classifiedAt` and deduplicate events to reject replays. A retry carries the same body.

The free watch checks public, unauthenticated servers weekly and supports one destination. It does not include email, more frequent checks or multiple destinations.
