---
title: OAuth for MCP explained
summary: Follow the MCP authorization sequence from a 401 challenge through resource and issuer discovery, PKCE and client registration, token exchange, and retry.
track: use
level: practitioner
order: 3
category: Authorization
readingTimeMinutes: 12
lastReviewed: "2026-11-11"
relatedSlugs:
  - connect-remote-mcp-server
  - designing-production-mcp-server
sourceLinks:
  - title: "MCP specification 2026-07-28: Authorization"
    url: "https://modelcontextprotocol.io/specification/2026-07-28/basic/authorization"
  - title: "MCP specification 2026-07-28: Authorization server discovery"
    url: "https://modelcontextprotocol.io/specification/2026-07-28/basic/authorization/authorization-server-discovery"
  - title: "MCP specification 2026-07-28: Client registration"
    url: "https://modelcontextprotocol.io/specification/2026-07-28/basic/authorization/client-registration"
  - title: "MCP specification 2026-07-28: Authorization security considerations"
    url: "https://modelcontextprotocol.io/specification/2026-07-28/basic/authorization/security-considerations"
  - title: "MCP specification: Authorization (2025-11-25)"
    url: "https://modelcontextprotocol.io/specification/2025-11-25/basic/authorization"
  - title: "RFC 9728: OAuth 2.0 Protected Resource Metadata"
    url: "https://www.rfc-editor.org/rfc/rfc9728"
  - title: "RFC 8414: OAuth 2.0 Authorization Server Metadata"
    url: "https://www.rfc-editor.org/rfc/rfc8414"
  - title: "RFC 7636: PKCE"
    url: "https://www.rfc-editor.org/rfc/rfc7636"
  - title: "RFC 9207: Authorization Server Issuer Identification"
    url: "https://www.rfc-editor.org/rfc/rfc9207"
  - title: MCP 2026-07-28 authorization changes
    url: "https://blog.modelcontextprotocol.io/posts/2026-07-28/"
  - title: "Cloudflare workers-oauth-provider"
    url: "https://github.com/cloudflare/workers-oauth-provider"
---
## The actors

A remote MCP deployment usually involves four parties:

- **The user**, who signs in and approves access.
- **The MCP client** (inside a host app such as Claude or VS Code), which makes requests.
- **The MCP server**, which in OAuth terms is a protected resource.
- **The authorization server**, which signs the user in and issues tokens.

The MCP server and the authorization server may share a domain, but they do not have to be the same service.

OAuth decides **who may access which protected resource, with which [scopes](/learn/mcp-glossary#scope)**. It does not decide whether a model should run a destructive tool. Clients still need clear tool descriptions, user consent and confirmation rules.

This page walks through the sequence. The [MCP OAuth 2.1 reference](/learn/mcp-oauth-2-1-reference) lists the exact rules and fields. Requirements here follow MCP 2026-07-28 unless a version is named.

## The sequence, step by step

### 1. MCP request and `401` challenge

The client sends an MCP request without a usable token. The server answers HTTP `401 Unauthorized` with a Bearer `WWW-Authenticate` challenge:

```http
HTTP/1.1 401 Unauthorized
WWW-Authenticate: Bearer resource_metadata="https://mcp.example.com/.well-known/oauth-protected-resource/mcp", scope="files:read"
```

- `resource_metadata` gives the URL of the protected resource metadata document. A server must either send it here or serve the document at a well-known URL.
- `scope` says what the request needs. Servers should include it.

The client must parse this header rather than read an error body. If `resource_metadata` is missing, the client tries the well-known URLs in order: first the path form (`/.well-known/oauth-protected-resource/mcp` for an endpoint at `/mcp`), then the root (`/.well-known/oauth-protected-resource`).

### 2. Protected-resource metadata

The client fetches the [protected resource metadata](/learn/mcp-glossary#protected-resource-metadata) document (RFC 9728):

```json
{
  "resource": "https://mcp.example.com/mcp",
  "authorization_servers": ["https://login.example.com"],
  "scopes_supported": ["files:read", "files:write"]
}
```

- `resource` identifies the MCP server.
- `authorization_servers` lists the issuers that can authorize access. MCP requires at least one.

The client validates these URLs and picks an issuer. It must not assume the MCP server's origin is also the issuer. If several issuers are listed, the client keeps separate client credentials and tokens for each.

### 3. Authorization-server metadata

Next the client fetches the issuer's metadata. MCP clients must support both OAuth Authorization Server Metadata (RFC 8414) and OpenID Connect Discovery. For an issuer without a path, they try `/.well-known/oauth-authorization-server`, then `/.well-known/openid-configuration`. Issuers with a path have a three-step order, listed in the [reference](/learn/mcp-oauth-2-1-reference#authorization-server-metadata-rfc-8414).

The document gives the authorization endpoint, token endpoint, supported PKCE methods, scopes and registration options. Two checks protect against attacks that swap one authorization server for another (mix-up attacks):

- The `issuer` in the document must be identical to the issuer the client used to build the URL. Otherwise the client must not use the metadata.
- The client must check for [PKCE](/learn/mcp-glossary#pkce) support. If `code_challenge_methods_supported` is missing, the client must refuse to continue. If `S256` is available, the client must use it and must not fall back to `plain`.

### 4. Establish client identity

A client ID tells the authorization server which software is asking. It does not prove who the user is. MCP lists four ways to get one, in this order of preference:

1. **Pre-registered client information** already configured for that issuer.
2. **A Client ID Metadata Document (CIMD).** The client ID is an HTTPS URL that serves a JSON document describing the client, including its redirect URIs. Clients use it when the issuer advertises `client_id_metadata_document_supported`. MCP 2026-07-28 recommends this option.
3. **[Dynamic Client Registration](/learn/mcp-glossary#dynamic-client-registration) (DCR, RFC 7591)**, when the issuer publishes a `registration_endpoint`. MCP 2026-07-28 deprecates DCR and keeps it for servers that do not support CIMD. A client that registers this way must send an `application_type`: `native` for desktop, mobile and CLI apps, `web` for browser apps.
4. **Asking the user** to enter client information, after someone registers the client with the authorization server.

Pre-registered and DCR credentials belong to one issuer. Store them keyed by the issuer, and register again if the protected resource metadata starts pointing to a different authorization server. A CIMD client ID is a URL, so it works with any server that supports CIMD.

### 5. Authorization code plus PKCE

The client:

1. creates a random, high-entropy `code_verifier` and derives an `S256` `code_challenge` from it;
2. records the `state`, the verifier and the expected issuer;
3. opens the authorization endpoint in a browser.

MCP requires the `resource` parameter (a [resource indicator](/learn/mcp-glossary#resource-indicator), RFC 8707) in both the authorization request and the token request. It binds the token to this MCP server. The user signs in and approves the scopes.

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

For `scope`, clients should use the `scope` from the `401` challenge. Without one, they request everything in `scopes_supported`; without that, they omit `scope`.

When the browser returns to the callback, the client checks `state`. It then checks the issuer (RFC 9207) before it uses the code:

- If the callback has an `iss` parameter, it must exactly match the expected issuer.
- If the server's metadata sets `authorization_response_iss_parameter_supported: true` and `iss` is missing, the client rejects the response.

Desktop and CLI clients usually use a loopback callback such as `http://127.0.0.1:<port>/...`. The exact callback must satisfy the authorization server's registration rules.

### 6. Token exchange

The client sends the code, the original `code_verifier`, the redirect URI, its client identity and `resource` to the token endpoint.

A desktop or CLI client is a public client: a secret shipped inside it would not stay secret, so PKCE protects the exchange instead. A confidential web client can also authenticate with its registered method.

The authorization server returns an access token and may return a refresh token. The client must not assume a refresh token will be issued. For public clients, the authorization server must rotate refresh tokens, so the client must store each new refresh token it receives. Keep tokens in platform-appropriate secure storage, respect their expiry, and never log them or show them to the model.

### 7. Authenticated MCP request

The client retries the MCP request with `Authorization: Bearer <access-token>`. The MCP server checks the token's signature or introspection result, issuer, audience (`resource`), expiry and scope. It must reject a token issued for another API, and must answer `401` to an invalid or expired token. It must not forward the client's token to upstream APIs.

If a later request needs more access, the server should answer `403 Forbidden` with `error="insufficient_scope"` and the needed scopes:

```http
HTTP/1.1 403 Forbidden
WWW-Authenticate: Bearer error="insufficient_scope", scope="files:read files:write", resource_metadata="https://mcp.example.com/.well-known/oauth-protected-resource/mcp"
```

The client should then authorize again, requesting the challenged scopes together with the scopes it already holds. It should limit the number of attempts and make the extra request visible to the user. The server should name every scope the operation needs in one challenge, so the user is asked only once.

## When manual client credentials are actually needed

Manual client information is the right choice when:

- an enterprise identity provider requires administrators to pre-register every application;
- redirect URIs must be allowlisted before use;
- the authorization server supports neither CIMD nor DCR;
- a client and server intentionally use a pre-agreed confidential client.

It is not a general requirement of MCP OAuth. If every user is asked to create an OAuth application, automatic client identity is probably unavailable or misconfigured. Before showing a client ID form, a client should check the authorization-server metadata for CIMD support and a `registration_endpoint`, and check whether it ships a pre-registration for that issuer.

Client secrets are easy to misuse. A secret inside a desktop app, CLI package or public configuration is not secret. Treat those clients as public clients and rely on PKCE, unless the provider offers a sound platform-specific mechanism.

## Failure map

| Failure | Evidence | Likely correction |
| --- | --- | --- |
| No authorization server found | Missing or invalid resource metadata | Fix `WWW-Authenticate` and the RFC 9728 well-known routes |
| Metadata ignored | `issuer` differs from the URL used to fetch it | Publish an `issuer` identical to the advertised authorization server, including any trailing slash |
| PKCE unsupported | Metadata has no usable `code_challenge_methods_supported` | Configure and advertise `S256`; do not downgrade |
| `invalid_redirect_uri` | Registered and actual callback differ | Register the exact callback; set the right `application_type` |
| `invalid_client` | Wrong issuer binding, registration or auth method | Register again for this issuer; check client authentication |
| Callback rejected | Missing or mismatched `iss` | Return the correct `iss`, or stop advertising support for it |
| Code exchange fails | State, verifier or redirect mismatch, or expired code | Keep transaction state intact; use the original verifier and callback |
| `invalid_target` | Authorization server rejects `resource` | Accept the published MCP resource as an audience; do not drop the parameter |
| MCP rejects a fresh token | Wrong audience, issuer or scope | Send `resource` in both requests and validate token claims |
| Refresh works once only | Rotated refresh token not saved | Store the newly returned refresh token atomically |
| `403` with `insufficient_scope` | Token valid but lacks a scope | Authorize again for the existing plus challenged scopes |
| Bare `403` from a tool | Signed in but operation forbidden | Check application permissions and the tool result; do not restart OAuth |

Log the sequence as redacted events: challenge source, metadata URLs, selected issuer, registration path, requested scopes, callback validation, token status and the authenticated retry. That is enough to debug most interoperability problems without recording codes, verifiers, tokens, secrets or personal data from the sign-in page.

## Read-only OAuth checks and fixes

The free [MCP OAuth checker](/tools/oauth-check) runs the discovery steps (1 to 4) and checks PKCE support and callback expectations from step 5. It does not register a client, send credentials or open the sign-in page. Each row shows the request URL and its evidence.

How to read the result:

- A failed path probe can be followed by a successful root or OIDC fallback. Judge the validation rows, not one fallback's `404`.
- "Clients can start OAuth" means the metadata is ready. It does not mean sign-in or token exchange was tested. Select **Open in inspector** to test a real connection.

For "failed to discover OAuth metadata", serve public JSON and check the issuer-path rules in the [OAuth reference](/learn/mcp-oauth-2-1-reference#sequence-at-a-glance). For "protected resource does not match expected", make the published `resource` match the MCP server's audience; see the [resource mismatch guide](/learn/mcp-oauth-protected-resource-mismatch). If a metadata URL is blocked, fix the access rather than guessing other endpoints.

For example, these are the discovery responses for an MCP server at `https://mcp.example.com/mcp` with issuer `https://auth.example.com`:

```json
{
  "resource": "https://mcp.example.com/mcp",
  "authorization_servers": ["https://auth.example.com"]
}
```

Serve that at `/.well-known/oauth-protected-resource/mcp`, or give its location in the `401` challenge. The issuer's `/.well-known/oauth-authorization-server` should list only endpoints and features it really implements:

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

Advertise CIMD or a `registration_endpoint` only when it works. An advertised registration endpoint does not mean every client will be accepted. In mcptest's October 2026 catalog sweep, Dropbox, Harness and ZoomInfo rejected registration under partner or vendor approval policies. GitHub's remote server does not support DCR: it needs a pre-registered GitHub App or OAuth App, or a personal access token. These are policy limits on client registration, not missing discovery metadata.

TypeScript SDK applications can send the challenge from their HTTP auth middleware. Replace the example origin with your deployment's origin:

```typescript
res.setHeader('Access-Control-Allow-Origin', '*');
res.setHeader('Access-Control-Expose-Headers', 'WWW-Authenticate');
res.setHeader('WWW-Authenticate',
  'Bearer resource_metadata="https://mcp.example.com/.well-known/oauth-protected-resource/mcp"');
res.status(401).end();
```

Python SDK applications can return the same challenge from their ASGI authentication layer:

```python
from starlette.responses import Response

return Response(status_code=401, headers={
    "Access-Control-Allow-Origin": "*",
    "Access-Control-Expose-Headers": "WWW-Authenticate",
    "WWW-Authenticate": 'Bearer resource_metadata="https://mcp.example.com/.well-known/oauth-protected-resource/mcp"',
})
```

Cloudflare's `workers-oauth-provider` sends the challenge and publishes the RFC 9728 document itself once you configure `resourceMetadata`. Set `resource` to the exact MCP URL clients use:

```typescript
resourceMetadata: {
  resource: 'https://mcp.example.com/mcp',
  authorization_servers: ['https://auth.example.com'],
},
```

These snippets cover HTTP responses, not a complete authorization server. Keep PKCE validation, audience checks and token validation in your auth provider. See the [Cloudflare deployment guide](/learn/remote-mcp-server-with-cloudflare-workers-agents) or the integration guides for [Auth0](/learn/secure-remote-mcp-server-with-auth0), [Clerk](/learn/secure-remote-mcp-server-with-clerk), [WorkOS](/learn/secure-remote-mcp-server-with-workos-authkit) and [Stytch](/learn/secure-remote-mcp-server-with-stytch).

Redirect allowlists are not part of discoverable metadata. Compare the callbacks the checker lists with your provider's configuration. Include Claude's callback, ChatGPT's callback variants, Cursor's localhost and hosted callbacks, and both VS Code callbacks (loopback and `vscode.dev`). See the [VS Code redirect guide](/learn/vscode-mcp-oauth-redirect-uris). Whether a provider accepts a callback is confirmed only by a real connection.
