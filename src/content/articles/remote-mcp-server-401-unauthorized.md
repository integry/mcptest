---
title: "Remote MCP server returns 401 Unauthorized: the cross-client checklist"
navTitle: Fix 401 Unauthorized
summary: Eight checks, in order, for an MCP server that answers 401 in Claude, ChatGPT, Cursor, VS Code or any other client, with what the playground shows when each one is the cause.
track: use
level: practitioner
order: 25
category: Troubleshooting
readingTimeMinutes: 10
lastReviewed: "2026-11-11"
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
  - title: "Claude docs: Authentication for connectors"
    url: "https://claude.com/docs/connectors/building/authentication"
  - title: "Claude docs: Troubleshoot your connector"
    url: "https://claude.com/docs/connectors/building/troubleshooting"
  - title: "Claude Code docs: MCP"
    url: "https://code.claude.com/docs/en/mcp"
  - title: "Anthropic IP addresses"
    url: "https://platform.claude.com/docs/en/api/ip-addresses"
  - title: "Cursor docs: MCP"
    url: "https://cursor.com/docs/context/mcp"
---
## Two different 401 problems

A `401 Unauthorized` from an MCP server means one of two things:

- **The client never got a token.** Sign-in did not start, or it failed partway through. This is a discovery or registration problem: checks 1 to 4.
- **The client has a token and the server still rejects it.** This is a token problem: audience, scope, expiry, or a proxy in the way. Checks 5 to 8.

A 401 on the very first request is expected. It proves the server is reachable and starts sign-in. Only a 401 after the client has signed in, or a sign-in that never starts, is a failure.

Work through the checks in order, because each one depends on the one before. Each check gives the symptom, the cause, how to confirm it, the fix, and what the mcptest playground shows. The checks follow the MCP authorization specification, revisions 2025-11-25 and 2026-07-28. The discovery order is the same in both; 2026-07-28 adds stricter issuer and registration rules, noted where they apply. For the full sequence explained step by step, read [OAuth for MCP explained](/learn/oauth-for-mcp-explained).

## 1. The 401 itself is well formed

**Symptom:** the client never opens a sign-in page.

**Cause:** the first unauthenticated request does not get a usable OAuth challenge. It should get this:

```http
HTTP/1.1 401 Unauthorized
WWW-Authenticate: Bearer resource_metadata="https://mcp.example.com/.well-known/oauth-protected-resource/mcp", scope="files:read"
```

`resource_metadata` points to the protected resource metadata document. A server must either send it or serve that document at a well-known URL (check 2). `scope` is recommended; it tells the client which scopes to request.

**Confirm:**

1. The status is `401`, not `403`, `400` or a `302` redirect to a login page. Claude, for example, starts sign-in only from a 401 and ignores `WWW-Authenticate` on a `200`.
2. The `WWW-Authenticate` header is present and uses the `Bearer` scheme.
3. The body is not an HTML page from a gateway. That suggests the request never reached the MCP server.

**Fix:** return the 401 with the header above from the MCP endpoint itself.

**In the playground:** the connection card shows **OAuth authorization required** and says the target is reachable and returned its own OAuth challenge. On the Report page, the OAuth flight recorder starts with **Server requested authorization** and records the challenge. A plain status card such as **MCP endpoint returned HTTP 403** means the server never sent a usable challenge.

## 2. Protected resource metadata is discoverable

**Symptom:** the client reports a discovery error, or "Couldn't reach the MCP server".

**Cause:** the client cannot find or read the protected resource metadata (RFC 9728). It fetches the URL from `resource_metadata`. If the header has none, it tries the well-known locations in order. For `https://mcp.example.com/mcp` those are:

1. `https://mcp.example.com/.well-known/oauth-protected-resource/mcp` (path inserted)
2. `https://mcp.example.com/.well-known/oauth-protected-resource` (root)

**Confirm:** fetch the document. It must include `authorization_servers` with at least one entry:

```json
{
  "resource": "https://mcp.example.com/mcp",
  "authorization_servers": ["https://auth.example.com"],
  "scopes_supported": ["files:read", "files:write"]
}
```

**Fix:**

- Make `resource` the exact URL clients use, including the path.
- List your main issuer first. Claude uses only the first `authorization_servers` entry and does not fall back to later ones.
- For browser-based clients, serve the document with CORS headers.

**In the playground:** the flight recorder shows **Protected resource discovered** with the document it found. When both well-known URLs return `404`, discovery is marked as failed with HTTP 404, and the OAuth panel asks for an **Authorization endpoint**, a **Token endpoint** and an **OAuth Client ID**. It asks only when it has proved the metadata is absent, not when CORS or rate limiting hid it. If the server is on a private or `.internal` address, the panel explains that the hosted proxy cannot reach it.

## 3. Authorization server metadata is reachable and complete

**Symptom:** discovery fails after the resource metadata was found, or the client refuses to continue before opening a browser.

**Cause:** the client cannot use the authorization server's metadata. It must support both RFC 8414 and OpenID Connect discovery. For an issuer with a path, such as `https://auth.example.com/tenant1`, it tries:

1. `https://auth.example.com/.well-known/oauth-authorization-server/tenant1`
2. `https://auth.example.com/.well-known/openid-configuration/tenant1`
3. `https://auth.example.com/tenant1/.well-known/openid-configuration`

Without a path, it tries `/.well-known/oauth-authorization-server`, then `/.well-known/openid-configuration`.

**Confirm** that the document:

- has an `issuer` identical to the issuer the client used to build the URL. Under 2026-07-28 a client must not use metadata whose issuer differs.
- lists `S256` in `code_challenge_methods_supported`. If this field is missing, a conforming client must stop.
- has `authorization_endpoint` and `token_endpoint` on HTTPS, plus `registration_endpoint` or `client_id_metadata_document_supported` if automatic registration is expected.

**Fix:** publish complete metadata at the issuer's well-known locations, including the issuer path. The authorization server must also be reachable from the client's network. For Claude, discovery requests come from the same Anthropic IP ranges as MCP requests (see check 8).

**In the playground:** **Authorization server discovered** shows the metadata and the endpoints taken from it. If the metadata does not advertise `S256`, the flow stops with "Incompatible authorization server: validated metadata does not advertise PKCE S256 support" before any browser window opens. If neither RFC 8414 nor OpenID Connect discovery returns a document, the panel says so and offers the manual endpoint fields described in check 2.

## 4. The client has an identity the server accepts

**Symptom:** the client asks for a client ID, reports that registration failed, or the provider's page shows a redirect URI error.

**Cause:** the client has no client ID the authorization server accepts. MCP lists four ways to get one, in this order of preference:

1. a pre-registered client ID;
2. a Client ID Metadata Document (CIMD), an HTTPS URL that serves as the client ID;
3. Dynamic Client Registration (DCR, RFC 7591);
4. a client ID the user enters.

DCR is deprecated in 2026-07-28, so new authorization servers should support CIMD.

**Confirm** which of these applies:

- **The server supports neither automatic option.** Claude Code reports "Incompatible auth server: does not support dynamic client registration". VS Code prompts for a client ID and secret. Cursor needs a client ID in the server's `auth` configuration.
- **The client cannot use the CIMD option.** Claude uses CIMD only when the metadata advertises both `"client_id_metadata_document_supported": true` and `"none"` in `token_endpoint_auth_methods_supported`. Otherwise it falls back to DCR.
- **The provider only accepts allowlisted clients.** No client ID you type will get past that; the provider must approve the client.
- **The redirect URI is not registered.** Each client uses its own:
  - Claude on the web, desktop and mobile: `https://claude.ai/api/mcp/auth_callback`
  - Claude Code: a loopback redirect on a changing port, on both `localhost` and `127.0.0.1`
  - Cursor desktop: `http://localhost:8787/callback`; Cursor on the web and Cursor agents: `https://www.cursor.com/agents/mcp/oauth/callback`
  - VS Code: `http://127.0.0.1:33418` and `https://vscode.dev/redirect`

**Fix:** support CIMD (or DCR) on the authorization server, or register an app with the provider and enter its client ID in the client. Register every redirect URI your users' clients need. For loopback redirects, match without the port.

**In the playground:** **OAuth client strategy selected** names the mechanism used. It is followed by **Client metadata document checked**, **OAuth client registered** or **Registered OAuth client selected**. A manual client ID is only requested when no automatic option works. A manual ID is a public client, bound to the issuer and resource it was entered for.

## 5. The token is issued for this server

**Symptom:** sign-in succeeds, but the first MCP request still gets 401. This is the most common case of "signed in, still 401".

**Cause:** the token's audience is not this MCP server. The client must send the RFC 8707 `resource` parameter, set to the MCP server's canonical URL, in both the authorization request and the token request. The server must check that each token was issued for it. It must reject a token issued for a different API, and must not pass tokens on to upstream APIs.

**Confirm:**

1. If the access token is a JWT, decode it and compare `aud` with the MCP server URL exactly: scheme, host, port and path.
2. Check that `iss` matches the issuer from check 3.
3. If the authorization server rejects the request with `invalid_target`, it does not accept the MCP server URL as a resource.

**Fix:** configure the provider to accept the MCP server URL as a resource or audience. Microsoft Entra ID, for example, needs it registered as an Application ID URI. Validate audience against the public URL clients use.

**In the playground:** mcptest always sends `resource` on authorization, token and refresh requests. If the provider rejects it, the error says it was `invalid_target` and explains why mcptest will not drop the parameter. If the token exchange succeeds but the server still refuses the token, **Authorization code exchanged** is followed by a failed **Authenticated MCP request retried** step that shows the server's 401.

## 6. The token has the scopes the tool needs

**Symptom:** most calls work, but one tool fails with `403`.

**Cause:** the token is valid but lacks a scope. The server should answer `403 Forbidden`, not 401, with a challenge naming the scopes:

```http
HTTP/1.1 403 Forbidden
WWW-Authenticate: Bearer error="insufficient_scope", scope="files:write", resource_metadata="https://mcp.example.com/.well-known/oauth-protected-resource/mcp"
```

**Confirm:** look for `error="insufficient_scope"` in the 403 response. A bare `403` with no challenge is an application permission error, not an OAuth problem.

**Fix:** on the server, put every scope an operation needs into a single challenge, so the user is asked only once. The client should sign in again, requesting the challenged scopes together with the scopes it already holds, and should cap the number of attempts.

**In the playground:** a `403 insufficient_scope` starts a step-up authorization that requests the granted scopes plus the challenged scope, without trying a refresh first. A bare `403` after sign-in is shown once with an explanation and the playground stops. It does not retry or redirect.

## 7. The token has not expired, or refresh works

**Symptom:** the server works for a while after sign-in, then returns 401.

**Cause:** the access token expired and refresh failed. A client with a refresh token should refresh once and retry once. Refresh fails when:

- the authorization server issued no refresh token. Some providers issue one only for the `offline_access` scope. Clients may request it when the authorization server lists it; Claude adds it automatically in that case.
- the refresh token was revoked or already rotated, and the provider returns `400 invalid_grant`.
- the refresh request omits `resource`, so the new token has the wrong audience.
- the token endpoint is slow. Claude allows 30 seconds for refresh and 10 seconds for the other OAuth endpoints.

**Confirm:** check whether the original token response contained a `refresh_token`, then look at the token endpoint's answer to the refresh request.

**Fix:** list `offline_access` in the authorization server's `scopes_supported` if it gates refresh tokens. Rotate refresh tokens for public clients and return the new one in the same response. Return `invalid_grant` for a refresh token that is no longer valid, and keep the token endpoint fast.

**In the playground:** a 401 with a stored refresh token shows **Access token refreshed** and one retry. If the refresh is rejected, the tokens are cleared and an **Authorize again** prompt shows the reason, for example `HTTP 400 invalid_grant`. A token that expires mid-session shows the 401; reconnecting performs the refresh.

## 8. Nothing between client and server changes the request

**Symptom:** everything above checks out, and the 401 persists.

**Cause:** something in the network path alters the request or the response.

**Confirm** by looking for:

- **A reverse proxy or API gateway that strips `Authorization`.** The server receives no token and challenges again. Check the request as it arrives at the application, not as the client sent it.
- **A redirect to another host.** Clients drop `Authorization` when they follow a redirect to a different origin.
- **A proxy that rewrites the host or path.** The server then compares the token's audience with an internal URL and rejects it.
- **A gateway that strips or rewrites `WWW-Authenticate`.** Clients then have nothing to discover.
- **Missing CORS headers for browser clients.** The preflight must allow `Authorization`, and `Access-Control-Expose-Headers` must include `WWW-Authenticate`, or the browser cannot read the challenge.
- **A WAF or CDN that blocks the client's cloud.** Claude connects from Anthropic's outbound ranges, `160.79.104.0/21` and `153.61.208.0/20`. A blocked range shows up as a 403 or 429 before OAuth starts.

**Fix:** forward `Authorization` and `WWW-Authenticate` unchanged, avoid cross-origin redirects, validate the audience against the public URL, and allowlist the client's IP ranges on both the MCP server and the authorization server.

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
