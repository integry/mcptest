---
title: "invalid_redirect_uri: MCP OAuth callback fixes"
navTitle: "invalid_redirect_uri"
summary: "Find the stage rejecting an MCP OAuth callback and align registered, advertised and requested redirect URIs without weakening validation."
track: "build"
level: "practitioner"
order: 450
category: "Authorization"
readingTimeMinutes: 5
lastReviewed: "2026-10-26"
metaTitle: "invalid_redirect_uri: MCP OAuth callback fixes | mcptest.io"
metaDescription: "Find the stage rejecting an MCP OAuth callback and align registered, advertised and requested redirect URIs without weakening validation."
relatedSlugs:
  - troubleshooting
  - vscode-mcp-oauth-redirect-uris
  - mcp-error-dynamic-client-registration
  - mcp-oauth-protected-resource-mismatch
sourceLinks:
  - title: "Claude Code Meta callback rejection #58054"
    url: "https://github.com/anthropics/claude-code/issues/58054"
  - title: "Claude Code CIMD callback regression #37747"
    url: "https://github.com/anthropics/claude-code/issues/37747"
  - title: "OAuth native app loopback redirects"
    url: "https://www.rfc-editor.org/rfc/rfc8252.html#section-7.3"
  - title: "OAuth redirect validation"
    url: "https://www.rfc-editor.org/rfc/rfc6749.html#section-3.1.2"
---

## invalid_redirect_uri

```text
invalid_redirect_uri
```

**Where it appears:** [Claude Code #58054](https://github.com/anthropics/claude-code/issues/58054) records a Meta MCP registration response rejecting a localhost callback. The issuer returns the error; it is not a universal MCP transport failure. [Claude Code #37747](https://github.com/anthropics/claude-code/issues/37747) reports a separate CIMD callback mismatch on 2.1.80+. Its affected-version claim is the reporter's observation.

## Likely causes, ranked by the report evidence

1. **Provider callback policy excludes the host's callback.** The Meta reproduction contrasts accepted hosted callbacks with a rejected localhost callback. Inspect the registration response: failure before an authorization code exists identifies registration policy, not token exchange.
2. **The registered or published URI differs from the request.** The CIMD report identifies a port discrepancy. Compare scheme, host, port, path and trailing slash across the client document or registration, authorize request and token request.
3. **Old registration or reverse-proxy configuration.** If those current values match, inspect the saved client id and the public callback generated behind a proxy. This is a diagnostic hypothesis, not a confirmed cause of every instance of this error.

These priorities are qualitative, not ecosystem frequency statistics.

## Fix for client users

Record which endpoint returned the error: registration, authorization or token exchange. Copy the decoded `redirect_uri` value for comparison, excluding `code`, `state` and tokens from shared logs. Use the provider's documented integration for your host; a hosted connector callback is not interchangeable with a CLI's local listener.

Re-register through supported controls after changing the callback or client identity. If the callback is generated incorrectly by the host, provide the client maintainer the version and redacted mismatch. For VS Code's particular loopback and hosted redirects, use the [existing VS Code guide](/learn/vscode-mcp-oauth-redirect-uris).

## Fix for server and authorization-server authors

[OAuth redirect validation](https://www.rfc-editor.org/rfc/rfc6749.html#section-3.1.2) requires matching the registered callback. Preserve that validation. Permit only deliberately registered callbacks; do not accept arbitrary domains or redirect to an unvalidated URI on error.

For native applications, [RFC 8252 loopback rules](https://www.rfc-editor.org/rfc/rfc8252.html#section-7.3) permit an ephemeral port with a loopback IP redirect. Apply that specific exception where the provider supports native clients; it is not a wildcard exemption for hosted callbacks. Decide explicitly which native and web clients your provider supports.

Compare the actual CIMD `redirect_uris` or DCR response with the authorize request, and keep the token exchange's redirect consistent. This fix generally belongs in client registration or the identity provider, not the TypeScript/Python transport. If a framework constructs URLs behind TLS termination, configure its trusted proxy and external HTTPS URL correctly.

## Check with mcptest

**Test your server** starts an independent browser OAuth flow. The [OAuth pre-login troubleshooting reference](/learn/mcp-oauth-2-1-reference#pre-login-troubleshooting) covers callback rejection; there is no transport diagnostic id for it. The inspector uses its [hosted browser callback](/learn/mcp-oauth-2-1-reference#browser-public-clients-what-mcptest-does), so success there cannot prove a CLI loopback callback is allowed. Re-test in the originally failing host as well. If registration never gets this far, see [DCR incompatibility](/learn/mcp-error-dynamic-client-registration).
