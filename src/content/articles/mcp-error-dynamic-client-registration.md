---
title: "does not support dynamic client registration: MCP"
navTitle: "Dynamic registration unsupported"
summary: "Resolve incompatible MCP OAuth client registration by distinguishing missing DCR, pre-registered client configuration and CIMD support."
track: "build"
level: "practitioner"
order: 449
category: "Authorization"
readingTimeMinutes: 5
lastReviewed: "2026-10-26"
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
  - title: "MCP client registration"
    url: "https://modelcontextprotocol.io/specification/2025-11-25/basic/authorization"
---

## Incompatible auth server: does not support dynamic client registration

```text
Incompatible auth server: does not support dynamic client registration
```

**Which clients print it:** [Cline #14625](https://github.com/cline/cline/issues/14625) reports this in September 2026. [Claude Code #67258](https://github.com/anthropics/claude-code/issues/67258) records the same message with an `SDK auth failed` prefix on version 2.1.172. [GitHub MCP #2532](https://github.com/github/github-mcp-server/issues/2532) also reports it for OpenCode. These are version-specific reports, not a promise that every release has the same limitation.

## Likely causes, ranked by recurrence in the reports

1. **No mutually supported registration method.** The GitHub and Cline reports recur around providers without usable Dynamic Client Registration (DCR). Inspect the issuer metadata for `registration_endpoint` and compare the provider's supported authentication method with the client's configuration.
2. **A pre-registered client is not actually being selected.** The Box report reproduces DCR being attempted despite configured OAuth credentials. Check which client id and issuer the failing flow uses, rather than assuming the presence of a settings field proves it was read.
3. **Discovery failed earlier.** Cline's report includes metadata 404s. Missing metadata can hide the provider's capabilities; distinguish a failed GET from valid metadata that intentionally omits DCR.

The ordering reflects the linked cases; there is no public frequency census.

## Fix for client users

First fix [metadata discovery](/learn/mcp-error-failed-to-discover-oauth-metadata). If discovery succeeds, use the provider's documented pre-registered application configuration when your client supports it. Ensure its allowed callback matches this host. If the client still requests DCR, record the host version and redacted registration request for the client maintainer.

The [MCP authorization specification](https://modelcontextprotocol.io/specification/2025-11-25/basic/authorization) supports pre-registration and Client ID Metadata Documents (CIMD) as well as DCR. A provider can require a registered application without being broken. Select a supported client/provider pairing; repeated sign-in cannot add a registration API. Keep confidential application secrets out of browser configuration and source control.

## Fix for server authors

Document the supported client identification methods. Advertise a working `registration_endpoint` only if you implement DCR. If using CIMD, advertise `client_id_metadata_document_supported` and validate fetched client documents and redirect URIs. For pre-registration, document how operators obtain a client id and which client types can use it.

These settings belong to the authorization server. A TypeScript or Python MCP resource server must point to that issuer; adding a fake registration URL to its metadata cannot implement registration. Keep token audience validation in place while resolving compatibility. After registration works, an [invalid_redirect_uri](/learn/mcp-error-invalid-redirect-uri) is a separate callback validation failure.

## Check with mcptest

Use **Test your server** to inspect discovery and client registration. The [client registration reference](/learn/mcp-oauth-2-1-reference#client-registration) explains the inspector's supported methods; [pre-login troubleshooting](/learn/mcp-oauth-2-1-reference#pre-login-troubleshooting) distinguishes missing registration from provider policy. No transport diagnostic id detects DCR incompatibility. Reaching the login page verifies only pre-login steps, so complete consent and a fresh tools listing too.
