---
title: "does not support dynamic client registration: MCP"
navTitle: "Dynamic registration unsupported"
summary: "Resolve incompatible MCP OAuth client registration by distinguishing missing DCR, pre-registered client configuration and CIMD support."
track: "build"
level: "practitioner"
order: 449
category: "Authorization"
readingTimeMinutes: 5
lastReviewed: "2026-11-11"
metaTitle: "does not support dynamic client registration: MCP | mcptest.io"
metaDescription: "Resolve incompatible MCP OAuth client registration by distinguishing missing DCR, pre-registered client configuration and CIMD support."
relatedSlugs:
  - troubleshooting
  - mcp-error-failed-to-discover-oauth-metadata
  - mcp-error-invalid-redirect-uri
  - mcp-oauth-2-1-reference
sourceLinks:
  - title: "Claude Code Box pre-configured client report #67258"
    url: "https://github.com/anthropics/claude-code/issues/67258"
  - title: "Cline GitHub registration report #14625"
    url: "https://github.com/cline/cline/issues/14625"
  - title: "GitHub MCP registration request #2532"
    url: "https://github.com/github/github-mcp-server/issues/2532"
  - title: "MCP TypeScript SDK: client auth source"
    url: "https://github.com/modelcontextprotocol/typescript-sdk/blob/main/packages/client/src/client/auth.ts"
  - title: "MCP 2026-07-28: Client registration"
    url: "https://modelcontextprotocol.io/specification/2026-07-28/basic/authorization/client-registration"
---

## Incompatible auth server: does not support dynamic client registration

```text
Incompatible auth server: does not support dynamic client registration
```

**Which clients print it.** The text comes from the MCP TypeScript SDK's OAuth client, so clients built on it show the same words:

- Claude Code adds an `SDK auth failed:` prefix. [Claude Code #67258](https://github.com/anthropics/claude-code/issues/67258) reports it on version 2.1.172 with Box.
- [Cline #14625](https://github.com/cline/cline/issues/14625), filed in September 2026, reports it with GitHub's MCP server.
- [GitHub MCP #2532](https://github.com/github/github-mcp-server/issues/2532) says it blocks OpenCode.

These are reports about specific versions. Other releases may behave differently.

**What it means.** The client found the authorization server's metadata, so discovery worked. It had no client ID to use, so it tried [Dynamic Client Registration](/learn/mcp-glossary#dynamic-client-registration) (DCR). The metadata has no `registration_endpoint`, so there was nowhere to register.

The SDK reaches this point only when all three of these are true:

1. The client has no saved or pre-registered client ID for this issuer. A client ID saved for a different issuer is discarded.
2. The client cannot use a Client ID Metadata Document (CIMD). Either the server does not advertise `client_id_metadata_document_supported: true`, or the client has no metadata URL.
3. The authorization server metadata has no `registration_endpoint`.

The [MCP specification](https://modelcontextprotocol.io/specification/2026-07-28/basic/authorization/client-registration) allows pre-registration, CIMD and DCR, and now deprecates DCR. A provider that requires a registered application is not broken. The client and the provider simply share no registration method.

## Likely causes, most common first

1. **The provider supports only pre-registered applications.** GitHub and Box are examples. Their metadata has no registration endpoint, and the client has no client ID configured.
2. **A client ID is configured but not used.** In the Box report, Claude Code tried DCR even though OAuth credentials were configured. The client may not read the setting, or the setting may be bound to a different issuer.
3. **The server supports CIMD but the client does not, or the reverse.** The client falls back to DCR, which the server does not offer.

## How to confirm

1. Fetch the issuer's metadata at `/.well-known/oauth-authorization-server` or `/.well-known/openid-configuration`.
2. Look for `registration_endpoint` and `client_id_metadata_document_supported`. If neither is present, only pre-registration can work.
3. Run the endpoint through the [MCP OAuth checker](/tools/oauth-check). Its **Client registration options (RFC 7591 / CIMD)** row shows whether DCR and CIMD are advertised, and the token endpoint authentication methods.
4. If you configured a client ID, check which issuer it was registered with. Compare it with the issuer in the metadata.

## Fix for client users

1. Check the provider's documentation for a pre-registered application, then register one.
2. Set its allowed callback to your client's exact redirect URI.
3. Enter the client ID in your client's OAuth settings, if it has them. Claude Code accepts `--client-id`, and Zed and Copilot CLI accept a client ID in their config.
4. If the client still tries DCR, report its version and the redacted registration attempt to the client's maintainers.

Signing in again will not help, because no registration API exists to call. Keep confidential client secrets out of browser settings and source control. Some providers, GitHub among them, issue only confidential applications; a browser client cannot use those.

## Fix for server authors

Decide which client identification methods you support, and document them:

- **CIMD.** Advertise `client_id_metadata_document_supported: true`. Fetch and validate each client's metadata document and its redirect URIs.
- **DCR.** Advertise a working `registration_endpoint` only if you implement it.
- **Pre-registration.** Document how users get a client ID, and which client types (public or confidential) you issue.

These settings belong to the authorization server, not the MCP server. Adding a registration URL to protected resource metadata does not implement registration. Keep token audience validation in place while you fix compatibility. Once registration works, an [invalid_redirect_uri](/learn/mcp-error-invalid-redirect-uri) error is a separate callback problem.

## Check with mcptest

The [MCP OAuth checker](/tools/oauth-check) reports which registration methods the server advertises without registering anything. The [client registration reference](/learn/mcp-oauth-2-1-reference#client-registration) explains the order mcptest uses: a client ID you entered, then CIMD, then DCR. The [pre-login troubleshooting table](/learn/mcp-oauth-2-1-reference#pre-login-troubleshooting) separates missing registration from provider policy. To test a pre-registered client, enter its client ID in the [inspector](/), sign in and list tools. Reaching the login page proves only the steps before it.
