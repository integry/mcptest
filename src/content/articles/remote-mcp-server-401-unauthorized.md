---
title: "Remote MCP server returns 401 Unauthorized: the cross-client checklist"
navTitle: Fix 401 Unauthorized
summary: Eight checks, in order, for an MCP server that answers 401 in Claude, ChatGPT, Cursor, VS Code or any other client, with what the playground shows when each one is the cause.
track: use
level: practitioner
order: 25
category: Troubleshooting
readingTimeMinutes: 9
lastReviewed: "2026-10-20"
relatedSlugs:
  - oauth-for-mcp-explained
  - connect-remote-mcp-server
  - mcp-server-connected-but-no-tools
  - add-remote-mcp-server-to-claude
  - connect-mcp-server-to-vs-code
sourceLinks:
  - title: "MCP specification 2025-11-25: Authorization"
    url: "https://modelcontextprotocol.io/specification/2025-11-25/basic/authorization"
  - title: "MCP specification 2026-07-28: Authorization"
    url: "https://modelcontextprotocol.io/specification/2026-07-28/basic/authorization"
  - title: "MCP specification 2026-07-28: Client registration"
    url: "https://modelcontextprotocol.io/specification/2026-07-28/basic/authorization/client-registration"
  - title: "MCP specification 2026-07-28: Authorization server discovery"
    url: "https://modelcontextprotocol.io/specification/2026-07-28/basic/authorization/authorization-server-discovery"
  - title: "RFC 9728: OAuth 2.0 Protected Resource Metadata"
    url: "https://www.rfc-editor.org/rfc/rfc9728"
  - title: "RFC 8707: Resource Indicators for OAuth 2.0"
    url: "https://www.rfc-editor.org/rfc/rfc8707"
  - title: "RFC 8414: OAuth 2.0 Authorization Server Metadata"
    url: "https://www.rfc-editor.org/rfc/rfc8414"
  - title: "Claude docs: Troubleshoot your connector"
    url: "https://claude.com/docs/connectors/building/troubleshooting"
---
## Two different 401 problems

A `401 Unauthorized` from an MCP server means one of two things:

- **The client never got a token.** The sign-in did not start, or it failed partway through. This is a discovery or registration problem, covered by checks 1 to 5.
- **The client has a token and the server still rejects it.** This is a token problem: audience, scope, expiry or a proxy in the way. Checks 5 to 8 cover it.

Work through the checks in order. Each one depends on the one before it. The checks follow the MCP authorization specification, revisions 2025-11-25 and 2026-07-28; the discovery rules are the same in both. For the full sequence explained step by step, read [OAuth for MCP explained](/learn/oauth-for-mcp-explained). This page is the checklist for when it breaks.

A 401 on the first request is expected. It proves the server is reachable and starts the sign-in. Only a 401 after the client has signed in is a failure.

## 1. The 401 itself is well formed

The first unauthenticated request should get this:

```http
HTTP/1.1 401 Unauthorized
WWW-Authenticate: Bearer resource_metadata="https://mcp.example.com/.well-known/oauth-protected-resource/mcp", scope="files:read"
```

The `resource_metadata` parameter points to the protected resource metadata document. The `scope` parameter is recommended and tells the client which scopes to request. Check:

1. The status is `401`, not `403`, `400` or a `302` redirect to a login page. Clients only start OAuth discovery on a 401. Claude ignores `WWW-Authenticate` on a `200`.
2. The `WWW-Authenticate` header is present and uses the `Bearer` scheme.
3. The body is not an HTML page from a gateway, which suggests the request never reached the MCP server.

**In the playground:** the connection card shows **OAuth authorization required** and says the target is reachable and returned its own OAuth challenge. On the Report page, the OAuth flight recorder starts with **Server requested authorization** and records the challenge. A plain HTTP status card such as **MCP endpoint returned HTTP 403** means the server never sent a usable challenge.

## 2. Protected resource metadata is discoverable

The client fetches the URL from `resource_metadata`. If the header has none, the client must try the well-known locations in order. For `https://mcp.example.com/mcp` those are:

1. `https://mcp.example.com/.well-known/oauth-protected-resource/mcp` (path inserted)
2. `https://mcp.example.com/.well-known/oauth-protected-resource` (root)

The document must follow RFC 9728 and include `authorization_servers` with at least one entry:

```json
{
  "resource": "https://mcp.example.com/mcp",
  "authorization_servers": ["https://auth.example.com"],
  "scopes_supported": ["files:read", "files:write"]
}
```

Check that `resource` is the exact URL clients use, including the path. Some clients, Claude among them, use only the first `authorization_servers` entry. Browser-based clients must also be able to read the document through CORS.

**In the playground:** the flight recorder shows **Protected resource discovered** with the document it found. When both well-known URLs return `404`, discovery is marked as failed with HTTP 404, and the OAuth panel asks for an **Authorization endpoint**, a **Token endpoint** and an **OAuth Client ID**. It asks only when it has proved the metadata is absent, not when CORS or rate limiting hid it. If the server is on a private or `.internal` address, the panel explains that the hosted proxy cannot reach it.

## 3. Authorization server metadata is reachable and complete

Next the client fetches the authorization server's metadata. For an issuer with a path, such as `https://auth.example.com/tenant1`, the order is:

1. `https://auth.example.com/.well-known/oauth-authorization-server/tenant1`
2. `https://auth.example.com/.well-known/openid-configuration/tenant1`
3. `https://auth.example.com/tenant1/.well-known/openid-configuration`

Without a path, the client tries `/.well-known/oauth-authorization-server`, then `/.well-known/openid-configuration`. Check that the document:

- has an `issuer` identical to the URL the client used to build the well-known path. Under 2026-07-28 a client must not use metadata whose issuer differs.
- lists `S256` in `code_challenge_methods_supported`. If this field is missing, a conforming client must stop.
- has `authorization_endpoint` and `token_endpoint` on HTTPS, plus `registration_endpoint` or `client_id_metadata_document_supported` if automatic registration is expected.

**In the playground:** **Authorization server discovered** shows the metadata and the endpoints taken from it. If the metadata does not advertise `S256`, the flow stops with "Incompatible authorization server: validated metadata does not advertise PKCE S256 support" before any browser window opens. If neither RFC 8414 nor OpenID Connect discovery returns a document, the panel says so and offers the manual endpoint fields described in check 2.

## 4. The client has an identity the server accepts

A client identifies itself in one of four ways, in this order of preference: a pre-registered client ID, a Client ID Metadata Document, Dynamic Client Registration (RFC 7591), or a client ID the user enters. Dynamic Client Registration is deprecated in 2026-07-28, so new authorization servers should support Client ID Metadata Documents.

Common failures:

- **The server supports neither automatic option.** Clients report it directly. Claude Code says "Incompatible auth server: does not support dynamic client registration". VS Code and Cursor ask for a client ID. Register an app with the provider and enter its ID in the client.
- **The registration response is invalid.** Claude rejects a `client_secret_expires_at` written as a decimal, because RFC 7591 requires an integer.
- **The provider only accepts allowlisted clients.** No client ID you type will get past that; the provider must approve the client.
- **The redirect URI is not registered.** Each client uses its own: `https://claude.ai/api/mcp/auth_callback`, `http://localhost:8787/callback` for Cursor, `http://127.0.0.1:33418` and `https://vscode.dev/redirect` for VS Code.

**In the playground:** **OAuth client strategy selected** names the mechanism used. It is followed by **Client metadata document checked**, **OAuth client registered** or **Registered OAuth client selected**. A manual client ID is only requested when no automatic option works. A manual ID is a public client and is bound to the issuer and resource it was entered for.

## 5. The token is issued for this server

This is the most common cause of "signed in, still 401". The client must send the RFC 8707 `resource` parameter, set to the MCP server's canonical URL, in both the authorization request and the token request. The server must check that each token's audience is itself. A token issued for a different API, or with no audience, must be rejected, and the server must not pass it on to upstream APIs.

Check:

1. Decode the access token if it is a JWT and compare `aud` with the MCP server URL exactly: scheme, host, port and path.
2. If the authorization server rejects the request with `invalid_target`, configure the provider to accept the MCP server URL as a resource or audience. Microsoft Entra, for example, needs it registered as an application ID URI.
3. Check that `iss` matches the issuer from check 3.

**In the playground:** mcptest always sends `resource` on authorization, token and refresh requests. If the provider rejects it, the error says it was `invalid_target` and explains why mcptest will not drop the parameter. If the token exchange succeeds but the server still refuses it, **Authorization code exchanged** is followed by a failed **Authenticated MCP request retried** step that shows the server's 401.

## 6. The token has the scopes the tool needs

A valid token can still lack a scope. The server should then answer `403 Forbidden`, not 401, with a challenge naming the scope:

```http
HTTP/1.1 403 Forbidden
WWW-Authenticate: Bearer error="insufficient_scope", scope="files:write", resource_metadata="https://mcp.example.com/.well-known/oauth-protected-resource/mcp"
```

The client should sign in again for the union of the scopes it already holds and the challenged ones; 2026-07-28 requires that union. Servers should put every scope an operation needs into a single challenge, so the user is not asked several times. A bare `403` with no challenge is an application permission error, not an OAuth problem.

**In the playground:** a `403 insufficient_scope` starts a step-up authorization that requests the granted scopes plus the challenged scope, without trying a refresh first. A bare `403` after sign-in is shown once with an explanation and the playground stops. It does not retry or redirect.

## 7. The token has not expired, or refresh works

Access tokens expire. A client with a refresh token should refresh once and retry once. Refresh fails when:

- the authorization server did not issue a refresh token. Some providers require the `offline_access` scope, and ChatGPT's documentation mentions it explicitly.
- the refresh token was revoked or rotated, and the provider returns `400 invalid_grant`.
- the refresh request omits `resource`, so the new token has the wrong audience.
- the token endpoint is slow. Claude allows 30 seconds for refresh and 10 seconds for the other OAuth endpoints.

**In the playground:** a 401 with a stored refresh token shows **Access token refreshed** and one retry. If the refresh is rejected, the tokens are cleared and an **Authorize again** prompt shows the reason, for example `HTTP 400 invalid_grant`. A token that expires mid-session shows the 401; reconnecting performs the refresh.

## 8. Nothing between client and server changes the request

If everything above is correct and the 401 persists, something in the path is altering the request. Look for:

- **A reverse proxy or API gateway that strips `Authorization`.** The server receives no token and challenges again. Check the request as it arrives at the application, not as the client sent it.
- **A redirect to another host.** Clients drop `Authorization` when they follow a redirect to a different origin.
- **A proxy that rewrites the host or path.** The server then compares the token's audience with an internal URL and rejects it. Validate against the public URL.
- **A gateway that strips or rewrites `WWW-Authenticate`.** Clients then have nothing to discover.
- **Missing CORS headers for browser clients.** The preflight must allow `Authorization`, and `Access-Control-Expose-Headers` must include `WWW-Authenticate`, or the browser cannot read the challenge.
- **A WAF or CDN that blocks the client's cloud.** claude.ai connects from `160.79.104.0/21`; a blocked range shows up as a 403 or 429 before OAuth starts.

**In the playground:** if the 401 or 403 comes from mcptest's own proxy, the card says **mcptest proxy authentication required** and states that it is not a target OAuth response. A server whose challenge is readable through the proxy but not directly from the browser shows **Browser access blocked**, which points to CORS rather than OAuth.

## Quick map from symptom to check

| Symptom | Check |
| --- | --- |
| Sign-in never starts | 1, 2 |
| "Couldn't reach" or discovery error | 2, 3, 8 |
| Client asks for a client ID | 4 |
| Redirect URI error on the provider's page | 4 |
| Sign-in succeeds, first request returns 401 | 5, 8 |
| One tool fails with 403 | 6 |
| Works for an hour, then 401 | 7 |

## Verify the endpoint before you add it

Every client hides some of these steps. Open the [MCP Playground](/), paste the endpoint and connect, then open the Report page to see each OAuth step in order and where it stopped. Do this before you add the server to any client. A link of the form `https://mcptest.io/server/<your endpoint URL>` opens the playground with the server already filled in.
