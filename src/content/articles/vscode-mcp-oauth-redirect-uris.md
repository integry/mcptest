---
title: "VS Code MCP OAuth redirect URIs: loopback ports and login failures"
navTitle: VS Code OAuth redirects
summary: Fix rejected VS Code MCP redirect URIs and trace the case where an OAuth page opens but connecting fails, from registration to token exchange.
track: build
level: practitioner
order: 447
category: Authorization
readingTimeMinutes: 6
lastReviewed: "2026-11-11"
metaTitle: "VS Code MCP OAuth Redirect URIs and Fixes | mcptest.io"
metaDescription: "Fix VS Code MCP OAuth callbacks for 127.0.0.1:33418 and vscode.dev/redirect. Diagnose when login opens but connecting fails, including Figma authorize URLs."
relatedSlugs:
  - troubleshooting
  - mcp-oauth-protected-resource-mismatch
  - connect-mcp-server-to-vs-code
  - remote-mcp-server-401-unauthorized
sourceLinks:
  - title: "VS Code MCP developer OAuth checklist"
    url: "https://code.visualstudio.com/api/extension-guides/ai/mcp"
  - title: "VS Code source: OAuth client registration and default port"
    url: "https://github.com/microsoft/vscode/blob/main/src/vs/base/common/oauth.ts"
  - title: "VS Code source: loopback callback server"
    url: "https://github.com/microsoft/vscode/blob/main/src/vs/workbench/api/node/loopbackServer.ts"
  - title: "RFC 8252: loopback interface redirection"
    url: "https://www.rfc-editor.org/rfc/rfc8252.html#section-7.3"
  - title: "MCP 2026-07-28: Authorization"
    url: "https://modelcontextprotocol.io/specification/2026-07-28/basic/authorization"
  - title: "Figma remote MCP server setup"
    url: "https://developers.figma.com/docs/figma-mcp-server/remote-server-installation/"
---

## http://127.0.0.1:33418 https://vscode.dev/redirect

```text
http://127.0.0.1:33418 https://vscode.dev/redirect
```

These are VS Code's OAuth callbacks, also called redirect URIs. They are where the provider sends the browser back after sign-in. They are not MCP server endpoints. VS Code's [MCP developer guide](https://code.visualstudio.com/api/extension-guides/ai/mcp) tells authorization server authors to allow both. VS Code also lists them when it asks you for a pre-registered client ID.

If the provider rejects the callback, the connection fails even though the server is reachable and the login page opens.

## What VS Code actually sends

The VS Code source code shows more detail than the two-line list:

- **Registration.** With Dynamic Client Registration, VS Code registers four redirect URIs: `https://insiders.vscode.dev/redirect`, `https://vscode.dev/redirect`, `http://127.0.0.1/` and `http://127.0.0.1:33418/`. Note the trailing slashes. It registers as a public client: `token_endpoint_auth_method` is `none` and `application_type` is `native`.
- **Client ID Metadata Document.** If the server advertises `client_id_metadata_document_supported`, VS Code uses its own metadata document URL as the client ID instead of registering.
- **Loopback port.** VS Code tries port 33418 first. If that port is in use, it falls back to a random port. The loopback redirect is `http://127.0.0.1:<port>/`.

## Fix for client users

1. Add the publisher's MCP endpoint with the [VS Code setup guide](/learn/connect-mcp-server-to-vs-code), then start authentication from that server entry.
2. Keep VS Code running until the browser returns to it.
3. If the browser cannot reach the loopback callback, make sure the browser runs on the same machine as VS Code. A remote desktop or a browser on another host cannot reach `127.0.0.1` on your machine.
4. To clear a stale registration, run **Authentication: Remove Dynamic Authentication Providers** from the Command Palette, then connect again.
5. If the provider rejects the callback, ask the publisher to allow VS Code's callbacks.

Pasting a callback URL into the server URL field does not help. The server URL must be the MCP endpoint.

## Fix for authorization server authors

1. Allow VS Code's callbacks exactly as it sends them, including the scheme, `127.0.0.1` (not `localhost`) and the trailing slash on loopback URIs.
2. Accept any port on loopback callbacks. [RFC 8252 section 7.3](https://www.rfc-editor.org/rfc/rfc8252.html#section-7.3) says the authorization server MUST allow any port for loopback IP redirect URIs. VS Code registers `http://127.0.0.1:33418/` only for servers that ignore this rule, and it can still fall back to another port.
3. Match every other part of the URI exactly, and match hosted HTTPS callbacks exactly. Never allow wildcard domains or open redirects.
4. Treat VS Code as a public native client: authorization code flow with PKCE and no client secret.
5. Check that the `redirect_uri` on the token request equals the one on the authorization request. Behind a proxy, keep the public scheme.
6. Keep `state` and PKCE validation, and make authorization codes short-lived and single-use.

## The OAuth page opens but connecting fails

A Figma authorize URL such as `https://www.figma.com/oauth/mcp?...` in your browser history shows that authorization started, not that MCP connected. Figma's MCP endpoint is `https://mcp.figma.com/mcp`, as in the [Figma setup guide](https://developers.figma.com/docs/figma-mcp-server/remote-server-installation/). Do not paste an authorize URL into the server field, and do not reopen a saved one. Its `state`, PKCE challenge or code belong to an attempt that has expired.

**Client users:** start a fresh connection, consent with the intended account, and return to VS Code. Note where it fails:

1. Before consent
2. On the callback
3. During the token exchange
4. On the first MCP request with the new token

Share only redacted errors, because authorize URLs carry state.

**Server authors:** trace the same four stages in your logs. Check callback registration, `state`, the PKCE verifier, code expiry, the token endpoint authentication method, and CORS for browser clients. If the token is issued but MCP returns `401`, check the token's issuer, audience, expiry and scopes. For a `/mcp` resource mismatch, see the [protected resource mismatch guide](/learn/mcp-oauth-protected-resource-mismatch).

## Verify with mcptest

1. Run the endpoint through the [MCP OAuth checker](/tools/oauth-check). It checks the challenge, metadata, registration options and PKCE, and lists VS Code's documented callbacks next to the other clients'. It cannot read your provider's allowed list.
2. [Open the inspector](/) and complete its OAuth flow. Check the message log and the first authenticated request.

The inspector uses its own callback, `https://mcptest.io/oauth/callback`, so it cannot prove that VS Code's callbacks are allowed. Finish by connecting from VS Code and listing tools. For errors after sign-in, see the [troubleshooting hub](/docs/troubleshooting).
