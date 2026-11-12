---
title: "VS Code MCP OAuth redirect URIs: loopback ports and login failures"
navTitle: VS Code OAuth redirects
summary: Fix rejected VS Code MCP redirect URIs and trace the case where an OAuth page opens but connecting fails, from registration to token exchange.
track: build
level: practitioner
order: 447
category: Authorization
readingTimeMinutes: 6
lastReviewed: "2026-10-25"
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
  - title: "RFC 8252: loopback interface redirection"
    url: "https://www.rfc-editor.org/rfc/rfc8252.html#section-7.3"
  - title: "MCP authorization specification"
    url: "https://modelcontextprotocol.io/specification/2025-11-25/basic/authorization"
  - title: "Figma remote MCP server setup"
    url: "https://developers.figma.com/docs/figma-mcp-server/remote-server-installation/"
---

## http://127.0.0.1:33418 https://vscode.dev/redirect

```text
http://127.0.0.1:33418 https://vscode.dev/redirect
```

These are OAuth callbacks, not MCP server endpoints. VS Code's [MCP developer checklist](https://code.visualstudio.com/api/extension-guides/ai/mcp) tells authorization-server authors to allow both. A rejected callback can stop a connection even when the server is reachable and the provider's login page opens.

## Fix for client users

Add the publisher's MCP endpoint using the [VS Code setup guide](/learn/connect-mcp-server-to-vs-code), then initiate authentication from that connection. Keep VS Code running until the browser returns. Inspect the server's output for a rejected `redirect_uri`, a token-exchange error or a resource mismatch. If localhost refuses the callback, confirm the client is still listening on that machine; a remote browser or forwarded desktop session may be on a different host.

Use VS Code's **Authentication: Remove Dynamic Authentication Providers** command when a stale registration needs removal, then reconnect. Ask the publisher to allow the callback if registration is rejected. Replacing the MCP URL with a callback URL will not fix registration.

## Fix for authorization-server authors

Register the callback URIs documented by VS Code, and compare the actual `redirect_uri` sent during authorization with the registered client metadata. Preserve the scheme, loopback IP and path. Configure the client as a public native client with authorization-code flow and PKCE; do not require a desktop client to embed a secret.

Loopback ports may vary. [RFC 8252 section 7.3](https://www.rfc-editor.org/rfc/rfc8252.html#section-7.3) requires support for a dynamically chosen loopback port. Apply the port exception specifically to loopback redirects, while matching the remaining URI components and enforcing exact matching for the HTTPS callback. Do not enable arbitrary wildcard domains or open redirects. Test the callback actually used by each supported VS Code environment, including its path, rather than assuming one fixed port works everywhere.

Ensure your supported registration flow records those callbacks and returns the browser to the same URI used in the token request. A reverse proxy must preserve the public callback scheme. Validate state and PKCE and keep codes short-lived and single-use.

## The OAuth page opens but connecting fails

A Figma `/oauth/mcp` authorize URL in browser history shows that authorization started, not that MCP connected. Use the [official Figma setup](https://developers.figma.com/docs/figma-mcp-server/remote-server-installation/) to obtain the MCP endpoint. Do not paste an authorize URL into the server field or reuse a saved authorize URL: its state, PKCE challenge or code may belong to an expired attempt.

**Client users:** start a fresh connection, complete consent with the intended account, and return to the initiating client. Note which stage fails: before consent, on callback, during token exchange, or on the first authenticated MCP request. Share only redacted errors; authorize URLs can contain sensitive state.

**Server authors:** trace those same stages using correlation IDs. Check callback registration, state, PKCE verifier, code expiry, token-endpoint authentication mode, and CORS for browser clients. If the token is issued but MCP returns `401`, check issuer, audience, expiry and scopes. For a mismatched `/mcp` resource, use the [protected-resource mismatch guide](/learn/mcp-oauth-protected-resource-mismatch).

## Verify with the inspector

Run the endpoint in the [discovery checker](/tools/discovery) to check OAuth metadata and browser readability, then [open the inspector](/) and follow its OAuth connection flow. Inspect the message log and the first authenticated request. These checks can isolate metadata and exchange failures, but the inspector uses its own callback and cannot certify VS Code's registered redirect list. Finish by reconnecting from VS Code and successfully listing tools. See the [troubleshooting hub](/docs/troubleshooting) for errors after authentication.
