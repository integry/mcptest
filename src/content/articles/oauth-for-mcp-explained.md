---
title: OAuth for MCP explained
summary: Follow the MCP authorization sequence from a 401 challenge through resource and issuer discovery, PKCE and client registration, token exchange, and retry.
track: use
level: practitioner
order: 3
category: Authorization
readingTimeMinutes: 10
lastReviewed: 2026-08-17
relatedSlugs:
  - connect-remote-mcp-server
  - designing-production-mcp-server
sourceLinks:
  - title: "MCP specification: Authorization (2025-11-25)"
    url: "https://modelcontextprotocol.io/specification/2025-11-25/basic/authorization"
  - title: "MCP draft: Client registration approaches"
    url: "https://modelcontextprotocol.io/specification/draft/basic/authorization"
  - title: "RFC 9728: OAuth 2.0 Protected Resource Metadata"
    url: "https://www.rfc-editor.org/rfc/rfc9728"
  - title: "RFC 8414: OAuth 2.0 Authorization Server Metadata"
    url: "https://www.rfc-editor.org/rfc/rfc8414"
  - title: "RFC 7636: PKCE"
    url: "https://www.rfc-editor.org/rfc/rfc7636"
  - title: MCP 2026-07-28 authorization changes
    url: "https://blog.modelcontextprotocol.io/posts/2026-07-28/"
---
## The actors

A remote MCP deployment commonly involves four parties: the user, an MCP host/client, the MCP server acting as an OAuth protected resource, and an authorization server that authenticates the user and issues tokens. The MCP server and authorization server may share a domain, but the protocol does not require them to be the same service.

OAuth answers **who may access which protected resource with which scopes**. It does not decide whether a model should invoke a destructive tool. Clients still need understandable tool descriptions, user consent, and confirmation policy.

## The sequence, step by step

### 1. MCP request and `401` challenge

The client attempts an MCP request without a usable token. The MCP server responds with HTTP `401 Unauthorized` and a Bearer `WWW-Authenticate` challenge. When present, its `resource_metadata` parameter gives the protected-resource metadata URL; `scope` can state what the current request needs.

```http
HTTP/1.1 401 Unauthorized
WWW-Authenticate: Bearer resource_metadata="https://mcp.example.com/.well-known/oauth-protected-resource", scope="files:read"
```

A client must parse the challenge rather than scraping an error body. If `resource_metadata` is absent, current MCP rules define well-known URL fallbacks based on the MCP endpoint.

### 2. Protected-resource metadata

The client fetches the RFC 9728 document. Its `resource` identifies the MCP resource and `authorization_servers` lists issuers that may authorize access. The client validates URLs and chooses an appropriate issuer; it must not assume the MCP origin is also the issuer.

```json
{
  "resource": "https://mcp.example.com/mcp",
  "authorization_servers": ["https://login.example.com"],
  "scopes_supported": ["files:read", "files:write"]
}
```

### 3. Authorization-server metadata

The client fetches OAuth Authorization Server Metadata (RFC 8414) and, where applicable, OpenID Connect discovery. It obtains the authorization endpoint, token endpoint, supported PKCE methods, scopes, and client-registration capabilities. Issuer validation matters: accepting metadata or tokens for the wrong issuer enables mix-up and token-redirection attacks.

MCP clients must verify PKCE support and use `S256` when technically capable. If the relevant metadata does not advertise a supported code challenge method, the client should stop instead of silently downgrading.

### 4. Establish client identity

A client ID tells the authorization server which software is asking; it is not proof of the user. Current MCP guidance recognizes these paths, in priority order when supported:

1. **Pre-registered client information** already configured for that issuer.
2. **Client ID Metadata Documents (CIMD)**, where an HTTPS URL serves as the client ID and describes redirect URIs and other metadata. The 2026 specification direction prefers CIMD.
3. **Dynamic Client Registration (DCR)** using an advertised registration endpoint. DCR remains a compatibility mechanism and the 2026 release marks it deprecated in favor of CIMD.
4. **Manual client information** entered after someone registers the client with the authorization server.

Credentials obtained through DCR or manual registration must be bound to the issuer. Do not reuse a client ID/secret when protected-resource metadata changes to a different authorization server.

### 5. Authorization code plus PKCE

The client creates a high-entropy `code_verifier`, derives an `S256` `code_challenge`, stores state, and opens the authorization endpoint. MCP requires the `resource` parameter in both authorization and token requests so the token is bound to the intended MCP server. The user authenticates and approves scopes.

A simplified authorization request contains:

```text
response_type=code
client_id=https://client.example.com/oauth/metadata.json
redirect_uri=http://127.0.0.1:6276/oauth/callback
code_challenge=<base64url-sha256>
code_challenge_method=S256
state=<unpredictable-value>
resource=https://mcp.example.com/mcp
scope=files:read
```

The client verifies returned state and, in current protocol guidance, validates issuer information when supplied before redeeming the code. Desktop and CLI clients commonly use a loopback callback. The exact callback must satisfy the authorization server's registration rules.

### 6. Token exchange

The client sends the code, original verifier, redirect URI, client identity, and resource to the token endpoint. A public desktop or CLI client cannot keep a global embedded secret confidential; PKCE protects the code exchange. A confidential web client can also authenticate with its registered method.

The authorization server returns an access token and may return a refresh token. The client stores them using platform-appropriate secure storage, observes expiration, and rotates refresh tokens when required. Tokens must not be logged or exposed to the model.

### 7. Authenticated MCP request

The client retries the MCP request with `Authorization: Bearer <access-token>`. The MCP server validates signature or introspection result, issuer, audience/resource, expiration, and scope. A valid token intended for some other API must be rejected.

If a later request needs more privilege, another `401` challenge may request additional scope. The client should preserve already granted scopes, ask for the minimum increment, and make the step-up visible to the user.

## When manual client credentials are actually needed

Manual values are appropriate when an enterprise identity provider requires administrators to pre-register every application; when redirect URIs must be allowlisted before use; when the authorization server supports neither CIMD nor DCR; or when a client/server partnership intentionally uses a pre-agreed confidential client.

They are not a universal prerequisite for MCP OAuth. Asking every user to create an OAuth application is often a sign that automatic client identity is unavailable or misconfigured. Before showing a client-ID form, inspect authorization-server metadata for CIMD support and `registration_endpoint`, and check whether the client ships issuer-specific registration.

A client secret is especially easy to misuse. A secret distributed inside a desktop binary, CLI package, or public configuration is not secret. Treat such clients as public clients and rely on PKCE unless the provider has a defensible platform-specific mechanism.

## Failure map

| Failure | Evidence | Likely correction |
| --- | --- | --- |
| No authorization server found | Missing/invalid resource metadata | Fix `WWW-Authenticate` and RFC 9728 well-known routes |
| PKCE unsupported | Metadata lacks usable `code_challenge_methods_supported` | Configure `S256`; do not downgrade |
| `invalid_redirect_uri` | Registration and actual callback differ | Register the exact callback; set correct native/web application type |
| `invalid_client` | Wrong issuer binding, registration, or auth method | Re-register for this issuer; verify client authentication |
| Code exchange fails | State/verifier/redirect mismatch or expired code | Keep transaction state intact; use the original verifier and callback |
| MCP rejects a fresh token | Wrong resource/audience, issuer, or scope | Include `resource` in both requests and validate token claims |
| Refresh works once only | Rotation not persisted | Atomically store the newly returned refresh token |
| `403` from a tool | Authenticated but operation forbidden | Inspect application permission and tool result; do not restart OAuth blindly |

Log the sequence as redacted events: challenge source, metadata URLs, selected issuer, registration path, requested scopes, callback validation, token status, and authenticated retry. This is enough to debug interoperability without recording codes, verifiers, tokens, secrets, or personal authorization-page data.

## Read-only OAuth checks and fixes

The free [MCP OAuth checker](/tools/oauth-check) follows steps 1–5 above without registering a client, sending credentials or opening authorization. Each request has a URL and evidence. A failed path probe can be followed by a successful root or OIDC fallback; judge the validation rows, not an individual fallback's 404. “Clients can start OAuth” means the metadata is ready, not that login or token exchange was verified. Continue with **Open in inspector** to test a real connection.

For “failed to discover OAuth metadata,” serve public JSON and check the issuer-path rules in the [OAuth reference](/learn/mcp-oauth-2-1-reference#sequence-at-a-glance). For “protected resource does not match expected,” fix the published `resource` to match the MCP audience, using the [resource mismatch guide](/learn/mcp-oauth-protected-resource-mismatch). Do not replace an access-blocked metadata URL with guessed endpoints.

For example, these are the discovery response shapes for `https://mcp.example.com/mcp` and issuer `https://auth.example.com`:

```json
{
  "resource": "https://mcp.example.com/mcp",
  "authorization_servers": ["https://auth.example.com"]
}
```

Serve that at `/.well-known/oauth-protected-resource/mcp` (or advertise its location in the 401 challenge). The issuer's `/.well-known/oauth-authorization-server` should advertise real endpoints and capabilities your server implements:

```json
{
  "issuer": "https://auth.example.com",
  "authorization_endpoint": "https://auth.example.com/authorize",
  "token_endpoint": "https://auth.example.com/token",
  "response_types_supported": ["code"],
  "grant_types_supported": ["authorization_code", "refresh_token"],
  "token_endpoint_auth_methods_supported": ["none"],
  "code_challenge_methods_supported": ["S256"],
  "client_id_metadata_document_supported": true
}
```

Only advertise CIMD or a `registration_endpoint` when implemented. DCR advertising does not prove arbitrary clients will be accepted: Dropbox, Harness and ZoomInfo rejected registration in the recorded sweep under partner/vendor policies. GitHub requires a configured confidential client. These are client-mode restrictions, not automatically missing discovery metadata.

TypeScript SDK applications can serve the challenge from their HTTP auth middleware (replace the example origin with the deployment origin):

```typescript
res.setHeader('Access-Control-Allow-Origin', '*');
res.setHeader('Access-Control-Expose-Headers', 'WWW-Authenticate');
res.setHeader('WWW-Authenticate',
  'Bearer resource_metadata="https://mcp.example.com/.well-known/oauth-protected-resource/mcp"');
res.status(401).end();
```

Python SDK applications can return the same challenge in their ASGI authentication layer:

```python
from starlette.responses import Response

return Response(status_code=401, headers={
    "Access-Control-Allow-Origin": "*",
    "Access-Control-Expose-Headers": "WWW-Authenticate",
    "WWW-Authenticate": 'Bearer resource_metadata="https://mcp.example.com/.well-known/oauth-protected-resource/mcp"',
})
```

For Cloudflare `workers-oauth-provider`, check the resource metadata exposed by the wrapper and use an equivalent response for rejected unauthenticated MCP requests:

```typescript
return new Response(null, { status: 401, headers: {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Expose-Headers': 'WWW-Authenticate',
  'WWW-Authenticate': 'Bearer resource_metadata="https://mcp.example.com/.well-known/oauth-protected-resource/mcp"',
} });
```

These snippets describe HTTP responses, not complete authorization implementations. Keep PKCE validation, audience enforcement and token validation in the auth provider. See the [Cloudflare deployment guide](/learn/remote-mcp-server-with-cloudflare-workers-agents) or the integration guides for [Auth0](/learn/secure-remote-mcp-server-with-auth0), [Clerk](/learn/secure-remote-mcp-server-with-clerk), [WorkOS](/learn/secure-remote-mcp-server-with-workos-authkit) and [Stytch](/learn/secure-remote-mcp-server-with-stytch).

Redirect allow-lists are not discoverable metadata. Compare the callbacks in the checker with the provider's configuration, including Claude, ChatGPT's callback-specific variant, Cursor's hosted callback and both VS Code loopback and `vscode.dev` callbacks. Follow the [VS Code redirect guide](/learn/vscode-mcp-oauth-redirect-uris); exact callback acceptance remains unverified until connection.
