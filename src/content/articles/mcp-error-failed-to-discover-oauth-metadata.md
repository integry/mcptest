---
title: "Failed to discover OAuth metadata: MCP fixes"
navTitle: "OAuth metadata discovery"
summary: "Trace failed MCP OAuth discovery from the challenge to issuer metadata, separating refresh failures, wrong paths and browser CORS."
track: "build"
level: "practitioner"
order: 448
category: "Authorization"
readingTimeMinutes: 5
lastReviewed: "2026-11-11"
metaTitle: "Failed to discover OAuth metadata: MCP fixes | mcptest.io"
metaDescription: "Trace failed MCP OAuth discovery from the challenge to issuer metadata, separating refresh failures, wrong paths and browser CORS."
relatedSlugs:
  - troubleshooting
  - mcp-error-dynamic-client-registration
  - mcp-oauth-protected-resource-mismatch
  - remote-mcp-server-401-unauthorized
sourceLinks:
  - title: "Claude Code token refresh report #19454"
    url: "https://github.com/anthropics/claude-code/issues/19454"
  - title: "MCP Inspector path-mounted discovery report #1168"
    url: "https://github.com/modelcontextprotocol/inspector/issues/1168"
  - title: "Cline discovery failures #14625"
    url: "https://github.com/cline/cline/issues/14625"
  - title: "MCP 2026-07-28: Authorization server discovery"
    url: "https://modelcontextprotocol.io/specification/2026-07-28/basic/authorization/authorization-server-discovery"
  - title: "RFC 8414: OAuth 2.0 Authorization Server Metadata"
    url: "https://www.rfc-editor.org/rfc/rfc8414"
---

## Failed to discover OAuth metadata

```text
Failed to discover OAuth metadata
```

**Where it appears.** Claude Code shows this message. [Claude Code #19454](https://github.com/anthropics/claude-code/issues/19454), filed on 20 January 2026, reports it when an Atlassian token refresh fails; the report has a title and no other detail. The guided OAuth flow in MCP Inspector 0.x throws the same text in its metadata discovery step. The MCP SDKs themselves word their errors differently, so the text alone does not tell you which request failed.

**What it means.** The client could not get usable [authorization server metadata](/learn/mcp-oauth-2-1-reference#authorization-server-metadata-rfc-8414) (RFC 8414 or OpenID Connect Discovery). Without it, the client does not know the authorization and token endpoints, so it stops before the login page. Discovery runs again when the client signs in afresh, and in some clients when it refreshes a token. A connection that worked yesterday can therefore fail today.

## Likely causes, most common first

1. **The metadata is not at any URL the client tried.** For an issuer with a path, such as `https://auth.example.com/tenant1`, clients must try the path-inserted URL first: `https://auth.example.com/.well-known/oauth-authorization-server/tenant1`. A server that publishes only one location, or a client that tries only the root, gets `404` everywhere. [Inspector #1168](https://github.com/modelcontextprotocol/inspector/issues/1168) shows a path-aware URL that was never tried. [Cline #14625](https://github.com/cline/cline/issues/14625) shows GitHub's issuer returning `404` for RFC 8414 metadata.
2. **The server publishes no protected resource metadata.** Without it, the client has no `authorization_servers` value. MCP Inspector 0.x, like other clients that follow older spec versions, then looks for authorization server metadata on the MCP server's own origin. If the origin does not serve it, discovery fails.
3. **The response is not usable metadata.** A login page, a WAF challenge, a redirect to HTML, or invalid JSON all fail. So does a document whose `issuer` differs from the issuer the client used to build the URL. In a browser, missing CORS headers make an existing document unreadable.
4. **Something changed or failed during refresh.** If the error appears only when a token is renewed, the client's saved issuer may no longer match, or the provider's well-known route may have failed at that moment.

## How to confirm

1. Request the MCP endpoint without a token. Read the `resource_metadata` URL in the `WWW-Authenticate` header of the `401`.
2. Fetch that document and read `authorization_servers`. If there is no header, try `/.well-known/oauth-protected-resource/<path>` and then `/.well-known/oauth-protected-resource` on the MCP server's origin.
3. For each issuer, fetch the candidate URLs in the [order the specification lists](/learn/mcp-oauth-2-1-reference#authorization-server-metadata-rfc-8414). Record the status, the `Content-Type` and the `issuer` field of each response.
4. Run the endpoint through the [MCP OAuth checker](/tools/oauth-check). Its **Authorization server discovery** row fails with "Failed to discover OAuth metadata from the advertised authorization servers." when no candidate works, and it lists every URL it tried. A `404` on one candidate followed by a later success is normal; judge the row, not each request.

If a fresh sign-in works but refresh fails, cause 4 is the likely one. Include that difference in a bug report.

## Fix for client users

- Use the publisher's full endpoint URL, including its path.
- Remove the connection with your client's own controls and connect again. This clears saved issuer and token state.
- If the metadata URL returns `404` or HTML, signing in again will not help. Report the URL, the status and a redacted response to the server author.
- Do not substitute another issuer, turn off issuer checks or share credentials.

If metadata loads and the next error is about registration, see [dynamic client registration](/learn/mcp-error-dynamic-client-registration). If the metadata `resource` differs from your endpoint, see the [resource mismatch guide](/learn/mcp-oauth-protected-resource-mismatch).

## Fix for server authors

Publish [protected resource metadata](/learn/mcp-glossary#protected-resource-metadata) for the public endpoint, and list the real issuer in `authorization_servers`. Return a challenge that points to it on every unauthenticated request:

```http
HTTP/1.1 401 Unauthorized
WWW-Authenticate: Bearer resource_metadata="https://mcp.example.com/.well-known/oauth-protected-resource/mcp"
```

On the authorization server:

- Serve RFC 8414 metadata, OpenID Connect Discovery, or both, at the well-known locations for your issuer, including the path-inserted form when the issuer has a path.
- Return JSON with `Content-Type: application/json`, without a login, a cookie or a redirect.
- Make `issuer` exactly equal the value listed in `authorization_servers`, including any trailing slash.
- For browser clients, send `Access-Control-Allow-Origin` on the metadata responses, and expose `WWW-Authenticate` on the `401`.
- Check that your proxy or CDN routes `/.well-known/` paths to the metadata handler.

This is identity provider and routing configuration. Changing a tool handler will not fix it. Test a fresh sign-in and a token refresh against the same endpoint.

## Check with mcptest

Enter the full endpoint in the [MCP OAuth checker](/tools/oauth-check) and read the **Protected resource metadata validation** and **Authorization server discovery** rows. The [pre-login troubleshooting reference](/learn/mcp-oauth-2-1-reference#pre-login-troubleshooting) lists fixes for missing discovery and issuer mismatches. If the checker passes but a browser client still fails, look for [missing CORS headers](/learn/mcp-transport-diagnostics-reference#transport-cors-expose-headers-missing). Then [connect in the inspector](/), sign in, and test refresh separately.
