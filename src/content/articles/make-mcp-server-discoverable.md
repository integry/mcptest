---
title: "How to make your MCP server discoverable: server cards, .well-known and the registry"
navTitle: Make your server discoverable
summary: Publish a SEP-2127 Server Card at your endpoint, list it in an AI Catalog at /.well-known/ai-catalog.json, serve OAuth metadata clients can read, and publish to the official MCP Registry, with copy-paste examples and a free checker.
track: build
level: practitioner
order: 27
category: Discovery
readingTimeMinutes: 8
lastReviewed: "2026-11-11"
metaTitle: "Make Your MCP Server Discoverable | mcptest.io"
metaDescription: "Make a remote MCP server discoverable: a SEP-2127 Server Card at <endpoint>/server-card, an AI Catalog in .well-known, OAuth metadata, and the official MCP Registry."
relatedSlugs:
  - deploy-remote-mcp-server
  - mcp-cors-headers-for-browser-clients
  - mcp-oauth-2-1-reference
  - mcp-changes-2026-10
sourceLinks:
  - title: "SEP-2127: MCP Server Cards"
    url: "https://modelcontextprotocol.io/seps/2127-mcp-server-cards"
  - title: "SEP-2127: MCP Server Cards (PR #2127)"
    url: "https://github.com/modelcontextprotocol/modelcontextprotocol/pull/2127"
  - title: "Server Card extension: discovery"
    url: "https://github.com/modelcontextprotocol/ext-server-card/blob/main/docs/discovery.md"
  - title: "Server Card extension: schema.json"
    url: "https://github.com/modelcontextprotocol/ext-server-card/blob/main/schema.json"
  - title: "AI Catalog specification"
    url: "https://github.com/Agent-Card/ai-catalog/blob/main/specification/ai-catalog.md"
  - title: "MCP Registry: about"
    url: "https://modelcontextprotocol.io/registry/about"
  - title: "MCP Registry: publishing remote servers"
    url: "https://modelcontextprotocol.io/registry/remote-servers"
  - title: "MCP Registry: authentication"
    url: "https://modelcontextprotocol.io/registry/authentication"
  - title: "MCP Registry: quickstart"
    url: "https://modelcontextprotocol.io/registry/quickstart"
  - title: "RFC 9728: OAuth 2.0 Protected Resource Metadata"
    url: "https://www.rfc-editor.org/rfc/rfc9728"
  - title: "RFC 8414: OAuth 2.0 Authorization Server Metadata"
    url: "https://www.rfc-editor.org/rfc/rfc8414"
---

A remote MCP server is easy to use once someone has its URL. Discovery is how they get that URL. A client, a browser extension or a registry crawler starts from a domain and finds the endpoint, its transport and how it authenticates, all before connecting.

There are three places to publish that information, and they complement each other. This guide shows each one with the smallest document that passes validation. To see what your domain publishes today, run it through the free [MCP discovery checker](/tools/discovery).

## The three ways a domain advertises a server

| Mechanism | Where | Who reads it |
| --- | --- | --- |
| Server Card ([SEP-2127](https://modelcontextprotocol.io/seps/2127-mcp-server-cards)) | `<endpoint>/server-card` | Clients and tools that have your endpoint or your AI Catalog |
| AI Catalog | `https://<domain>/.well-known/ai-catalog.json` | Clients that start from a domain and need the card's URL |
| Official MCP Registry | `registry.modelcontextprotocol.io` | Registry clients, aggregators and subregistries |

Server Cards are an optional MCP extension: SEP-2127 is a Final, Extensions Track proposal, and servers without a card keep working. The official registry is still in preview.

OAuth metadata is not a discovery document in the same sense. But a client that finds your endpoint still has to find your authorization server, so if the server requires OAuth, that metadata has to be readable too.

## Write a Server Card

A Server Card is a static JSON document that describes one remote server: its identity, its endpoints and the protocol versions they support. It does not list tools, resources or prompts; clients get those from the server after connecting. The schema lives in the [Server Card extension repository](https://github.com/modelcontextprotocol/ext-server-card/blob/main/schema.json). Four fields are required:

```json
{
  "$schema": "https://static.modelcontextprotocol.io/schemas/v1/server-card.schema.json",
  "name": "com.example/weather",
  "version": "1.4.0",
  "description": "Forecasts and severe weather alerts for any city.",
  "title": "Example Weather",
  "websiteUrl": "https://example.com/docs/mcp",
  "remotes": [
    {
      "type": "streamable-http",
      "url": "https://example.com/mcp",
      "supportedProtocolVersions": ["2025-11-25", "2026-07-28"]
    }
  ]
}
```

- **`$schema`** must be exactly `https://static.modelcontextprotocol.io/schemas/v1/server-card.schema.json`. The schema rejects date-versioned URLs and the registry's `server.schema.json`.
- **`name`** is reverse-DNS with exactly one slash, such as `com.example/weather`. Use the namespace of a domain you control, so it matches the name you would publish to the registry.
- **`version`** is your server's version and should be semver. Ranges such as `^1.2.3` or `1.x` are rejected.
- **`description`** is 1 to 100 characters.

`remotes` is optional in the schema, but without it the card names a server and gives no way to reach it. Each remote has:

- **`type`**: `streamable-http`, or `sse` for the deprecated HTTP+SSE transport.
- **`url`**: the endpoint. It can contain `{variables}`, such as `https://{tenant}.example.com/mcp`, described in a `variables` map with a `default` where one exists.
- **`headers`** (optional): headers the endpoint needs, with `isSecret: true` for credentials. Describe the header; never put a real value in a public card.
- **`supportedProtocolVersions`** (optional): lets a client tell whether it can connect before it tries.

The card is advisory. If it disagrees with what the live server reports through `server/discover`, clients should prefer the live values, and they must not use the card for security or access-control decisions. Keep `name`, `version` and the protocol versions in step with your server's runtime so clients see no mismatch.

## Serve the card at your endpoint

SEP-2127 reserves one recommended location: your Streamable HTTP URL plus `/server-card`. A server at `https://example.com/mcp` serves its card at `https://example.com/mcp/server-card`. A card may live at any other URL instead, as long as your AI Catalog points to it.

Serve it over HTTPS with these headers:

```http
Content-Type: application/mcp-server-card+json
Access-Control-Allow-Origin: *
Access-Control-Allow-Methods: GET
Access-Control-Allow-Headers: Content-Type, If-None-Match
Access-Control-Expose-Headers: ETag
Cache-Control: public, max-age=3600
ETag: "v1.4.0"
```

- **CORS is required.** The extension's discovery rules say hosted cards MUST send CORS headers. Browser-based clients can only read a cross-origin card that allows it, and because the card is public metadata, a wildcard origin is safe.
- **Caching is recommended.** Send `Cache-Control` and an `ETag`, and answer `If-None-Match` with `304 Not Modified` when the card has not changed.
- **Content negotiation.** Clients send `Accept: application/mcp-server-card+json`. If your framework negotiates content, make sure that request gets the card and not an error.

Earlier drafts of the proposal used `/.well-known/mcp/server-card.json`. The final design does not use `.well-known` for individual cards, because a card describes one server, not a whole site; `.well-known` is kept for the AI Catalog. Tools written against the drafts may still probe the old path, and serving the same card there as well does no harm.

## List the card in an AI Catalog

A client that only knows your domain cannot guess where your endpoint is. The AI Catalog answers that question. Publish it at `https://<domain>/.well-known/ai-catalog.json`, served as `application/ai-catalog+json`:

```json
{
  "specVersion": "1.0",
  "entries": [
    {
      "identifier": "urn:air:example.com:mcp:weather",
      "type": "application/mcp-server-card+json",
      "url": "https://example.com/mcp/server-card"
    }
  ]
}
```

- **`specVersion`** and **`entries`** are required at the top level.
- Each entry has an **`identifier`** (the `urn:air:{publisher}:{namespace}:{name}` form for open systems), the **`type`** `application/mcp-server-card+json`, and exactly one of **`url`** (where the card is) or **`data`** (the card itself, inline).

One catalog can list several servers, including servers that another company hosts on your behalf. Send the same CORS headers as on the card.

## Make the OAuth metadata readable

If the endpoint requires OAuth, a client that discovered it next fetches the protected resource metadata ([RFC 9728](https://www.rfc-editor.org/rfc/rfc9728)). For `https://example.com/mcp` that is `https://example.com/.well-known/oauth-protected-resource/mcp`:

```json
{
  "resource": "https://example.com/mcp",
  "authorization_servers": ["https://auth.example.com"],
  "scopes_supported": ["weather:read"],
  "bearer_methods_supported": ["header"]
}
```

`resource` must identify the endpoint. `authorization_servers` must name at least one server whose metadata ([RFC 8414](https://www.rfc-editor.org/rfc/rfc8414) or OpenID Connect discovery) publishes:

- the authorization and token endpoints;
- `S256` in `code_challenge_methods_supported`;
- either `client_id_metadata_document_supported: true` or a `registration_endpoint`.

Without one of the last two, a client that has no pre-registered client ID cannot sign in. Both metadata documents need CORS headers for browser clients. The [OAuth 2.1 reference](/learn/mcp-oauth-2-1-reference) covers the full flow.

## Publish to the official MCP Registry

The [official MCP Registry](https://modelcontextprotocol.io/registry/about) is the shared index that registry clients and subregistries read. A remote-only server needs a `server.json` with a `remotes` array and no `packages`:

```json
{
  "$schema": "https://static.modelcontextprotocol.io/schemas/2025-12-11/server.schema.json",
  "name": "com.example/weather",
  "title": "Example Weather",
  "description": "Forecasts and severe weather alerts for any city.",
  "version": "1.4.0",
  "remotes": [
    { "type": "streamable-http", "url": "https://example.com/mcp" }
  ]
}
```

Publish it with the `mcp-publisher` CLI:

```bash
mcp-publisher login http --domain example.com --private-key "$PRIVATE_KEY"
mcp-publisher publish
```

The login method decides which names you may publish:

- **GitHub login** grants `io.github.<username>/*` (or your organization's name).
- **HTTP login**, with a key file at `https://example.com/.well-known/mcp-registry-auth`, grants `com.example/*`.
- **DNS login**, with a TXT record on `example.com`, grants `com.example/*` and also subdomain namespaces such as `com.example.api/*`.

Domain-based names match the domain users see in the URL. The [authentication docs](https://modelcontextprotocol.io/registry/authentication) show how to generate the key pair. The registry verifies that you control the namespace; it does not verify that you control the remote URL, and the URL must be publicly reachable.

Use the same `name` in the registry and in your Server Card. Then a client that finds the card and a client that searches the registry identify the same server.

## Check what you published

The [MCP discovery checker](/tools/discovery) takes a domain and reports each location in this guide, with the exact URL it fetched:

- the draft and legacy `.well-known` card paths, the AI Catalog and every card it lists, validated against the v1 schema;
- `<endpoint>/server-card` for every endpoint it found;
- the protected resource metadata and authorization server metadata of each endpoint;
- official registry entries and mcptest.io catalog listings with an endpoint on the domain.

It reads each document from your browser first, so a missing CORS header shows up as a warning rather than passing silently. When nothing is found, it gives you a card and a catalog for your domain to copy. Every endpoint it finds links to the inspector, where you can check that the live server agrees with its card.
