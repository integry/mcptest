---
title: "MCP OAuth protected resource does not match expected: cause and fix"
navTitle: OAuth resource mismatch
summary: Diagnose an OAuth resource identity mismatch, compare the endpoint path with protected resource metadata, and decide whether the client configuration or server must change.
track: build
level: practitioner
order: 446
category: Authorization
readingTimeMinutes: 5
lastReviewed: "2026-11-11"
metaTitle: "MCP OAuth Protected Resource Mismatch: Fix | mcptest.io"
metaDescription: "Fix SDK auth failed: Protected resource does not match expected. Compare the MCP endpoint, RFC 9728 metadata resource and OAuth resource indicator."
relatedSlugs:
  - troubleshooting
  - vscode-mcp-oauth-redirect-uris
  - remote-mcp-server-401-unauthorized
  - mcp-oauth-2-1-reference
sourceLinks:
  - title: "RFC 9728: protected resource metadata validation"
    url: "https://www.rfc-editor.org/rfc/rfc9728.html#section-3.3"
  - title: "RFC 8707: resource indicators"
    url: "https://www.rfc-editor.org/rfc/rfc8707.html"
  - title: "MCP 2026-07-28 authorization: canonical server URI"
    url: "https://modelcontextprotocol.io/specification/2026-07-28/basic/authorization#canonical-server-uri"
  - title: "MCP TypeScript SDK: client auth source"
    url: "https://github.com/modelcontextprotocol/typescript-sdk/blob/main/packages/client/src/client/auth.ts"
  - title: "Claude Code #76096: Entra App ID URI resource rejected"
    url: "https://github.com/anthropics/claude-code/issues/76096"
  - title: "Obot #5939: protected resource port mismatch in Docker"
    url: "https://github.com/obot-platform/obot/issues/5939"
  - title: "Gemini CLI #20017: origin resource rejected for a path endpoint"
    url: "https://github.com/google-gemini/gemini-cli/issues/20017"
---

## SDK auth failed: Protected resource does not match expected

```text
SDK auth failed: Protected resource https://mcp.example.com/mcp does not match expected https://mcp.example.com/ (or origin)
```

**Which clients print it.** The text comes from the MCP TypeScript SDK's OAuth client, in both `@modelcontextprotocol/sdk` 1.x and `@modelcontextprotocol/client` 2.x. Claude Code adds the `SDK auth failed:` prefix. Other clients print the same sentence without it, for example `Error: Protected resource … (or origin)`. The Python SDK raises `Protected resource … does not match expected …` without `(or origin)`.

**What it means.** The first URL is the `resource` value in the server's [protected resource metadata](/learn/mcp-glossary#protected-resource-metadata). The second is the resource the client derived from the URL you configured. The client stops before opening a login page, because the metadata describes a different resource.

## How the client compares the two

The `resource` field identifies the protected server. It is not the URL of the metadata document. Under [RFC 9728 section 3.3](https://www.rfc-editor.org/rfc/rfc9728.html#section-3.3), a client must check that this value matches the resource it asked about. Otherwise it could send tokens to the wrong server.

The TypeScript and Python SDKs accept the metadata when both conditions hold:

1. The scheme, host and port are the same.
2. The path of the configured URL starts with the path of the metadata `resource`.

So metadata naming `https://mcp.example.com` is accepted for an endpoint at `https://mcp.example.com/mcp`. Metadata naming `/mcp` is rejected when you configured only the origin. In the TypeScript SDK, `/mcp/` is also rejected for an endpoint at `/mcp`. Some clients compare more strictly: [Gemini CLI #20017](https://github.com/google-gemini/gemini-cli/issues/20017) reported an origin `resource` being rejected for an endpoint with a path.

## Likely causes, most common first

1. **The configured URL is incomplete or out of date.** You added only the host, or an old path, and the server identifies itself with the full endpoint. For example, a bundled config uses `https://mcp.example.com` while the metadata says `https://mcp.example.com/mcp`.
2. **The metadata names an internal or non-URL identifier.** A reverse proxy or container exposes its internal address, as in [Obot #5939](https://github.com/obot-platform/obot/issues/5939), where the host port differed. Or the identity provider needs an identifier that is not the server URL, such as a Microsoft Entra App ID URI (`api://…`), as in [Claude Code #76096](https://github.com/anthropics/claude-code/issues/76096).
3. **A trailing slash or a stricter client.** The metadata says `/mcp/` and the endpoint is `/mcp`, or the client requires an exact match.

## How to confirm

1. Copy both URLs from the error message.
2. Fetch the metadata yourself and read `resource`. For an endpoint at `/mcp`, request `https://mcp.example.com/.well-known/oauth-protected-resource/mcp`. If that returns `404`, request `https://mcp.example.com/.well-known/oauth-protected-resource`.
3. Run the endpoint through the [MCP OAuth checker](/tools/oauth-check). The **Resource indicator and URL match (RFC 8707)** row shows the expected resource and the published one, and fails when they do not match.

## Fix for client users

1. Copy the full endpoint from the publisher's documentation. For example, Linear documents `https://mcp.linear.app/mcp`, not `https://mcp.linear.app`.
2. Remove the old connection or clear its cached sign-in with your client's own controls. Then reconnect.
3. If the documented URL still fails, report both URLs from the error to the server author. Redact tokens and authorization codes.

Do not edit the URL until the error disappears, and do not turn off validation. The check protects your tokens.

## Fix for server authors

Choose one canonical public URL for the MCP endpoint, for example `https://mcp.example.com/mcp`. Use it in your documentation, the metadata `resource` and the token audience check:

```json
{
  "resource": "https://mcp.example.com/mcp",
  "authorization_servers": ["https://auth.example.com"]
}
```

- Serve the document at the path-aware location, `/.well-known/oauth-protected-resource/mcp`.
- Point the `401` challenge's `resource_metadata` parameter at that document.
- Build the `resource` value from your public URL, not from the request the app sees behind a proxy. Internal hosts and ports must not appear in public metadata.
- Use the form without a trailing slash, as the [MCP canonical URI rules](https://modelcontextprotocol.io/specification/2026-07-28/basic/authorization#canonical-server-uri) recommend.

Clients send this value as the [`resource` parameter](/learn/mcp-glossary#resource-indicator) ([RFC 8707](https://www.rfc-editor.org/rfc/rfc8707.html)) on the authorization and token requests. Your authorization server must issue a token whose audience is that resource, and your server must reject tokens with any other audience. Your authorization server's issuer URL is not your resource identifier.

If the identity provider insists on its own identifier, as Entra does with App ID URIs, a standard MCP client cannot bridge the two. Put an authorization server or broker in front that accepts the MCP server URL as the resource.

## Check the fix

Run the endpoint through the [MCP OAuth checker](/tools/oauth-check) and confirm the resource row passes. Then [connect in the inspector](/), sign in and list tools. A passing metadata check does not prove that the token exchange or the audience check will succeed. If sign-in opens but the connection still fails, continue with [OAuth redirect troubleshooting](/learn/vscode-mcp-oauth-redirect-uris).
