---
title: "invalid_redirect_uri: MCP OAuth callback fixes"
navTitle: "invalid_redirect_uri"
summary: "Find the stage rejecting an MCP OAuth callback and align registered, advertised and requested redirect URIs without weakening validation."
track: "build"
level: "practitioner"
order: 450
category: "Authorization"
readingTimeMinutes: 5
lastReviewed: "2026-11-11"
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
  - title: "RFC 7591: client registration error codes"
    url: "https://www.rfc-editor.org/rfc/rfc7591.html#section-3.2.2"
  - title: "RFC 6749: redirection endpoint matching"
    url: "https://www.rfc-editor.org/rfc/rfc6749.html#section-3.1.2.3"
  - title: "RFC 8252: loopback interface redirection"
    url: "https://www.rfc-editor.org/rfc/rfc8252.html#section-7.3"
  - title: "MCP 2026-07-28: Authorization security considerations"
    url: "https://modelcontextprotocol.io/specification/2026-07-28/basic/authorization/security-considerations"
---

## invalid_redirect_uri

```text
invalid_redirect_uri
```

**What it is.** `invalid_redirect_uri` is an OAuth error code from the authorization server, not from the MCP client or the MCP transport. [RFC 7591](https://www.rfc-editor.org/rfc/rfc7591.html#section-3.2.2) defines it for client registration: "The value of one or more redirection URIs is invalid." Some providers also show it on the authorization page when the requested `redirect_uri` is not registered.

The redirect URI, or callback, is where the provider sends the browser back with the authorization code. Every client has its own: a hosted URL for web clients, or a loopback address such as `http://127.0.0.1:33418/` or `http://localhost:3118/callback` for desktop and CLI clients.

**Where it appears.**

- [Claude Code #58054](https://github.com/anthropics/claude-code/issues/58054): Meta's MCP server answered a registration request for a `localhost` callback with `400 invalid_redirect_uri`, while hosted claude.ai callbacks were accepted. Claude Code itself showed `SDK auth failed: The provided redirect_uris are not registered for this client.`
- [Claude Code #37747](https://github.com/anthropics/claude-code/issues/37747): the browser showed `invalid_redirect_uri` because the client's metadata document listed `http://localhost/callback` without a port, while the client sent `http://localhost:3118/callback`. The reporter saw it from version 2.1.80.

## Likely causes, most common first

1. **The provider does not accept this kind of callback.** Many providers allow only HTTPS callbacks, or only callbacks of approved clients. A desktop or CLI client's loopback callback is then rejected at registration, as in the Meta report.
2. **The registered and requested URIs differ.** The scheme, host, port, path or trailing slash differs between the registration (or CIMD document) and the authorization request. `localhost` and `127.0.0.1` are different hosts.
3. **A stale registration or a proxy.** The client changed its callback port or path after it registered. Or a server behind a proxy builds an `http://` callback instead of `https://`.

## How to confirm

1. Find the request that failed:
   - **Registration:** the POST to the `registration_endpoint` returns `400` with `"error": "invalid_redirect_uri"`.
   - **Authorization:** the provider shows an error page in the browser and does not redirect back.
   - **Token exchange:** a mismatched `redirect_uri` usually returns `invalid_grant`, not this error.
2. Copy the decoded `redirect_uri` from that request. Leave `code`, `state` and tokens out of anything you share.
3. Compare it character by character with the registered URIs: the registration request, the client's CIMD document, or the provider's dashboard.

## Fix for client users

- Use the integration your provider documents for your client. A hosted connector's callback and a CLI's loopback listener are not interchangeable.
- If you use a pre-registered client ID, add your client's exact callback to the provider's allowed list.
- After you change the callback or client, remove the old connection and connect again, so the client registers afresh.
- If the client builds the wrong callback, send its version and the redacted mismatch to the client's maintainers.

For VS Code's loopback and `vscode.dev` callbacks, see the [VS Code redirect guide](/learn/vscode-mcp-oauth-redirect-uris).

## Fix for authorization server authors

Keep redirect validation. The [MCP security considerations](https://modelcontextprotocol.io/specification/2026-07-28/basic/authorization/security-considerations) say authorization servers MUST validate exact redirect URIs against registered values, and every redirect URI must be `localhost` or HTTPS. [RFC 6749 section 3.1.2.3](https://www.rfc-editor.org/rfc/rfc6749.html#section-3.1.2.3) requires simple string comparison when the full URI was registered. Never accept arbitrary domains, and never redirect to an unvalidated URI to report an error.

There is one exception. For native apps, [RFC 8252 section 7.3](https://www.rfc-editor.org/rfc/rfc8252.html#section-7.3) says the authorization server MUST allow any port for loopback IP redirect URIs. Match everything except the port for `http://127.0.0.1` and `http://[::1]` callbacks. The exception does not cover hosted HTTPS callbacks.

Then:

- Decide which native and web clients you support, and document their callbacks.
- With CIMD, validate the authorization request against the `redirect_uris` in the client's fetched document.
- Behind TLS termination, configure the framework's trusted proxy and external URL, so it builds `https://` callbacks.

This is registration and identity provider configuration. Changing the MCP transport will not fix it.

## Check with mcptest

The [MCP OAuth checker](/tools/oauth-check) lists the documented callbacks of mcptest, Claude, ChatGPT, VS Code and Cursor under **Client redirect URIs**. Compare them with your provider's allowed list; the checker cannot read that list. The [inspector](/) uses its own hosted callback, `https://mcptest.io/oauth/callback`, as described in the [browser client reference](/learn/mcp-oauth-2-1-reference#browser-public-clients-what-mcptest-does). A successful sign-in there does not prove that a CLI's loopback callback is allowed, so test again in the client that failed. If registration fails before any callback is checked, see [DCR incompatibility](/learn/mcp-error-dynamic-client-registration).
