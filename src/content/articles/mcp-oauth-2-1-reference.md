---
title: MCP OAuth 2.1 reference
navTitle: OAuth 2.1 reference
summary: Reference for MCP authorization covering RFC 9728 and RFC 8414 discovery, PKCE S256, CIMD versus dynamic registration, RFC 8707 audience, step-up, refresh, iss validation, confused deputy, and what a browser client can do.
track: reference
level: expert
order: 23
category: Authorization
readingTimeMinutes: 8
lastReviewed: "2026-10-20"
metaTitle: MCP OAuth 2.1 reference (RFC 9728, 8414, 7636, 7591, 8707) | mcptest.io
metaDescription: MCP authorization reference with protected resource metadata, authorization server discovery order, PKCE, client ID metadata documents, resource indicators, step-up scopes and RFC 9207.
relatedSlugs:
  - oauth-for-mcp-explained
  - mcp-http-headers-reference
  - mcp-protocol-versions-explained
  - troubleshooting
sourceLinks:
  - title: "MCP 2026-07-28: Authorization"
    url: "https://modelcontextprotocol.io/specification/2026-07-28/basic/authorization"
  - title: "MCP 2026-07-28: Authorization server discovery"
    url: "https://modelcontextprotocol.io/specification/2026-07-28/basic/authorization/authorization-server-discovery"
  - title: "MCP 2026-07-28: Client registration"
    url: "https://modelcontextprotocol.io/specification/2026-07-28/basic/authorization/client-registration"
  - title: "MCP 2026-07-28: Authorization security considerations"
    url: "https://modelcontextprotocol.io/specification/2026-07-28/basic/authorization/security-considerations"
  - title: "MCP 2025-11-25: Authorization"
    url: "https://modelcontextprotocol.io/specification/2025-11-25/basic/authorization"
  - title: "MCP 2025-11-25: Security best practices"
    url: "https://modelcontextprotocol.io/specification/2025-11-25/basic/security_best_practices"
  - title: "RFC 6749: The OAuth 2.0 Authorization Framework"
    url: "https://www.rfc-editor.org/rfc/rfc6749"
  - title: "RFC 6750: Bearer Token Usage"
    url: "https://www.rfc-editor.org/rfc/rfc6750"
  - title: "RFC 7591: OAuth 2.0 Dynamic Client Registration"
    url: "https://www.rfc-editor.org/rfc/rfc7591"
  - title: "RFC 7636: Proof Key for Code Exchange"
    url: "https://www.rfc-editor.org/rfc/rfc7636"
  - title: "RFC 8414: OAuth 2.0 Authorization Server Metadata"
    url: "https://www.rfc-editor.org/rfc/rfc8414"
  - title: "RFC 8707: Resource Indicators for OAuth 2.0"
    url: "https://www.rfc-editor.org/rfc/rfc8707"
  - title: "RFC 9207: Authorization Server Issuer Identification"
    url: "https://www.rfc-editor.org/rfc/rfc9207"
  - title: "RFC 9728: OAuth 2.0 Protected Resource Metadata"
    url: "https://www.rfc-editor.org/rfc/rfc9728"
  - title: "OAuth 2.1 draft (draft-ietf-oauth-v2-1-13, cited by MCP)"
    url: "https://datatracker.ietf.org/doc/html/draft-ietf-oauth-v2-1-13"
  - title: OAuth Client ID Metadata Document draft
    url: "https://datatracker.ietf.org/doc/draft-ietf-oauth-client-id-metadata-document/"
---

This page lists the rules and fields. For the narrative walk-through of the same sequence, read [OAuth for MCP explained](/learn/oauth-for-mcp-explained). Requirements are from MCP 2026-07-28 unless a version is named. Authorization is optional in MCP: HTTP servers that use it SHOULD conform, and stdio servers SHOULD NOT and should take credentials from the environment instead.

## Sequence at a glance

| Step | Standard | Client action |
| --- | --- | --- |
| 1 | RFC 9728 | Call the MCP server without a token, receive `401` |
| 2 | RFC 9728 | Fetch protected resource metadata, read `authorization_servers` |
| 3 | RFC 8414 / OIDC Discovery | Fetch authorization server metadata, verify `issuer` and PKCE support |
| 4 | CIMD / RFC 7591 | Identify the client: pre-registered, metadata document, or dynamic registration |
| 5 | OAuth 2.1, RFC 7636, RFC 8707 | Authorization code request with PKCE `S256`, `state` and `resource` |
| 6 | RFC 9207 | Validate `iss` on the callback before using the code |
| 7 | OAuth 2.1, RFC 8707 | Token request with `code_verifier` and `resource` |
| 8 | RFC 6750 | Retry with `Authorization: Bearer`; step up on `insufficient_scope` |

## Protected resource metadata (RFC 9728)

An MCP server MUST publish an RFC 9728 document. The document MUST list at least one entry in `authorization_servers`.

| Field | RFC 9728 status | Notes |
| --- | --- | --- |
| `resource` | REQUIRED | Must match the URL used to find the document |
| `authorization_servers` | OPTIONAL in RFC 9728, required by MCP | Issuer identifiers |
| `scopes_supported` | RECOMMENDED | MCP: the minimal set for basic use |
| `bearer_methods_supported` | OPTIONAL | `header`, `body`, `query`; MCP clients send the token in the `Authorization` header and never in the query string |

Discovery order for clients:

1. The `resource_metadata` parameter of `WWW-Authenticate` on the `401`, when present.
2. The path-inserted well-known URI: `https://example.com/.well-known/oauth-protected-resource/public/mcp` for an endpoint at `/public/mcp`.
3. The root well-known URI: `https://example.com/.well-known/oauth-protected-resource`.

```http
HTTP/1.1 401 Unauthorized
WWW-Authenticate: Bearer resource_metadata="https://mcp.example.com/.well-known/oauth-protected-resource/mcp", scope="files:read"
```

When several authorization servers are listed, the client chooses. In 2026-07-28 it MUST keep separate client credentials and tokens per authorization server.

## Authorization server metadata (RFC 8414)

Clients MUST support both RFC 8414 and OpenID Connect Discovery. For an issuer with a path, `https://auth.example.com/tenant1`, try in order:

1. `https://auth.example.com/.well-known/oauth-authorization-server/tenant1`
2. `https://auth.example.com/.well-known/openid-configuration/tenant1`
3. `https://auth.example.com/tenant1/.well-known/openid-configuration`

For an issuer without a path, try `/.well-known/oauth-authorization-server` and then `/.well-known/openid-configuration`.

The `issuer` in the document MUST be identical to the issuer used to build the URL (RFC 8414 section 3.3). Otherwise the client MUST NOT use the metadata.

## PKCE S256 (RFC 7636)

- `code_verifier`: 43 to 128 characters from `[A-Za-z0-9-._~]`.
- `code_challenge = BASE64URL(SHA256(ASCII(code_verifier)))`, sent with `code_challenge_method=S256`.
- A client that can use `S256` MUST NOT fall back to `plain`.
- MCP clients MUST verify PKCE support before authorizing. If `code_challenge_methods_supported` is absent, the client MUST refuse to proceed. RFC 8414 says an omitted field means the server does not support PKCE.

## Client registration

Priority for a client that supports every option:

1. Pre-registered client information for this authorization server.
2. Client ID Metadata Document, when the authorization server sets `client_id_metadata_document_supported`.
3. Dynamic Client Registration, when it publishes a `registration_endpoint`.
4. Ask the user.

| | Client ID Metadata Document | Dynamic Client Registration (RFC 7591) |
| --- | --- | --- |
| Status in 2026-07-28 | Recommended (SHOULD) | Deprecated; kept for servers without CIMD |
| `client_id` | An HTTPS URL with a path that serves the metadata JSON | Issued by the authorization server |
| Required metadata | `client_id` (equal to the URL), `client_name`, `redirect_uris` | Sent in the registration POST |
| State per server | None; the ID is portable | One registration per authorization server |
| Server checks | Fetch the document, match `client_id` and `redirect_uris` | Policy on open registration |

`application_type` (2026-07-28): clients MUST send an appropriate value during dynamic registration. Use `native` for desktop, mobile, CLI and localhost apps, and `web` for remote browser apps. OpenID providers default to `web`, which can reject native redirect URIs.

Credentials are bound to the issuer. Persisted client credentials MUST be keyed by the authorization server's `issuer`, MUST NOT be reused with another authorization server, and require re-registration when it changes. RFC 6749 section 2.2: "The client identifier is unique to the authorization server."

## Resource indicators and token audience (RFC 8707)

- The client MUST send `resource` on both the authorization request and the token request, even if the authorization server does not advertise support.
- The value is the canonical URI of the MCP server: an absolute URI with a scheme and no fragment. Prefer the most specific URI, with a lowercase scheme and host and no trailing slash unless it is meaningful.
- Valid: `https://mcp.example.com/mcp`, `https://mcp.example.com`, `https://mcp.example.com:8443`.
- Invalid: `mcp.example.com` (no scheme), `https://mcp.example.com#fragment`.
- The MCP server MUST validate that the token was issued for it (its audience), and MUST answer `401` to invalid or expired tokens.
- An authorization server that rejects the resource answers `invalid_target`.

## Scopes and step-up on insufficient_scope

Initial scope selection (SHOULD):

1. `scope` from the `401` challenge. It is authoritative.
2. Otherwise, all of `scopes_supported` from the protected resource metadata.
3. Otherwise, omit `scope`.

At runtime, a server SHOULD answer a request that needs more scope with `403` (RFC 6750 section 3.1):

```http
HTTP/1.1 403 Forbidden
WWW-Authenticate: Bearer error="insufficient_scope", scope="files:read files:write", resource_metadata="https://mcp.example.com/.well-known/oauth-protected-resource/mcp"
```

Clients acting for a user SHOULD re-authorize with the union of scopes already requested and the challenged scopes, and SHOULD cap the number of attempts. Servers SHOULD name every scope the operation needs in a single challenge.

## Refresh tokens

- Authorization servers MUST rotate refresh tokens issued to public clients and SHOULD issue short-lived access tokens.
- Clients MUST keep refresh tokens confidential, SHOULD list `refresh_token` in `grant_types`, and MUST NOT assume one will be issued.
- Clients MAY request `offline_access` when the authorization server lists it. MCP servers SHOULD NOT put it in challenges or `scopes_supported`.

## Issuer validation (RFC 9207)

2026-07-28. Before redirecting, the client records the issuer with the PKCE verifier and `state`. On the callback:

| `authorization_response_iss_parameter_supported` | `iss` present | Action |
| --- | --- | --- |
| `true` | Yes | Compare by exact string |
| `true` | No | Reject |
| `false` or absent | Yes | Compare by exact string |
| `false` or absent | No | Proceed |

There is no normalization before the comparison. On a mismatch, the client MUST NOT act on or display `error`, `error_description` or `error_uri`. This blocks mix-up attacks between authorization servers.

## Confused deputy

The attack described in the [security best practices](https://modelcontextprotocol.io/specification/2025-11-25/basic/security_best_practices):

1. An MCP proxy server uses one static client ID with a third-party authorization server and lets MCP clients register dynamically.
2. The user has consented once, so the third-party server sets a consent cookie.
3. An attacker registers a client with their own `redirect_uri` and sends the user a link.
4. The cookie skips the consent screen, and the authorization code goes to the attacker.

Required mitigations: a per-client consent screen run by the proxy before the third-party flow, showing the client name, scopes and `redirect_uri`, with CSRF protection and framing blocked. Consent cookies must be `__Host-`, `Secure`, `HttpOnly`, `SameSite=Lax`, signed and bound to the client ID. `redirect_uri` must match exactly, and `state` must be single-use and short-lived.

## Token passthrough

MCP servers MUST NOT accept tokens that were not issued for them, and MUST NOT forward the client's token to upstream APIs. Calls to upstream APIs use a separate token issued to the MCP server. Passthrough bypasses audience checks, rate limits and audit trails.

## Browser public clients: what mcptest does

mcptest runs in the browser as a public client: it holds no client secret and stores its state in `sessionStorage` by default. The behavior below is in `src/utils/oauthFlow.ts`.

| Rule | mcptest |
| --- | --- |
| PKCE | Always `S256`. Refuses to continue when validated metadata does not advertise `S256` |
| Registration order | A client ID you pre-registered for that issuer, then the metadata document `https://mcptest.io/oauth/client-metadata.json` when the server advertises CIMD, then dynamic registration with `application_type: "web"`. It asks you for a client ID only when none of these works |
| Client secret | Never requested for a public client |
| `resource` | Sent on the authorization, token and refresh requests. An `invalid_target` rejection is explained, not worked around by dropping the parameter |
| Issuer binding | Client credentials are stored per issuer. The callback's `iss` is checked under RFC 9207 rules before any error is read |
| Concurrent flows | Each flow stores its own verifier under its `state`, a callback is single-use, and at most five pending flows live for 30 minutes |
| Step-up | Requests the union of granted and challenged scopes, without trying a refresh first |
| Bare `403` with a token | Shown once with an explanation, without retrying or redirecting |
| Expired token | Refreshes once and retries once. A rejected refresh asks you to authorize again and shows the reason |

What a browser client cannot do:

- **Read cross-origin responses without CORS.** Metadata, registration and token endpoints often omit CORS headers. When a direct metadata GET is unreadable, mcptest retries it through its proxy. On mcptest.io, token requests go through a hosted relay that re-discovers the issuer itself and checks the token endpoint, so it cannot be pointed at an arbitrary URL.
- **Keep a secret.** Anything shipped to the browser is public, so confidential clients and `client_secret_*` authentication are out of scope.
- **Use a loopback redirect.** On mcptest.io the redirect URI is the hosted `https://mcptest.io/oauth/callback`. A client ID you pre-register with a provider must allow that exact URI.
- **Reach private networks freely.** Mixed-content rules and Private Network Access limit calls from a public HTTPS page to localhost or internal hosts. mcptest explains these limits instead of bypassing them.
- **See the `WWW-Authenticate` header** unless the server exposes it through CORS. Without it, mcptest falls back to well-known discovery.

## Pre-login troubleshooting

The manual catalog sweep (`npm run oauth-sweep`) exercises the inspector's real OAuth flow without signing in. A login page proves only that the pre-login steps worked; browser CORS, user consent and token exchange still need separate checks. See the October 2026 sweep report in the repository for per-server HTTP evidence.

| Failure | Fix for the server author or operator |
| --- | --- |
| HTTP 401 without usable discovery | Add `WWW-Authenticate: Bearer resource_metadata="https://…"`; serve JSON at that exact URL. Also serve the path-suffixed or root [RFC 9728 location](#protected-resource-metadata-rfc-9728). Expose `WWW-Authenticate` through CORS for browser clients. |
| Missing or mismatched issuer | Publish [RFC 8414 or OIDC metadata](#authorization-server-metadata-rfc-8414) at the issuer's well-known locations, including the issuer path. Make `issuer` exactly equal the advertised authorization server, including trailing slashes. Clients must not disable issuer validation. |
| Resource URL mismatch (observed at New Relic) | Publish the canonical MCP resource in [protected-resource metadata](#protected-resource-metadata-rfc-9728). `/mcp` and `/mcp/` are different resource paths: either redirect to the canonical endpoint or correct the metadata. Do not ask clients to remove the resource binding. |
| No S256 advertised | Implement [PKCE S256](#pkce-s256-rfc-7636) and advertise `code_challenge_methods_supported: ["S256"]`. Do not ask clients to downgrade to `plain`. |
| `invalid_target` (observed at Semgrep) | Accept the exact `resource` identifier published in resource metadata as an allowed audience at authorization and token exchange. Fix the metadata if it names the wrong resource. Keep [RFC 8707 audience binding](#resource-indicators-and-token-audience-rfc-8707). |
| `invalid_redirect_uri` / “Invalid redirect URI” (observed at Canva) | Honor the exact redirect URI accepted during registration: `https://mcptest.io/oauth/callback`. Keep it unchanged when validating the authorization request. A successful registration alone does not establish callback compatibility. |
| Advertised HTTPS client ID rejected | If `client_id_metadata_document_supported` is true, fetch and validate the [published document](https://mcptest.io/oauth/client-metadata.json) and its redirect URI. Otherwise correct the advertised capability and publish a working registration route. |
| No automatic client registration | Pre-registered clients are a supported provider policy. Register an application and use the inspector's public client ID form when available. GitHub and Slack require operator-managed confidential applications; their secrets belong in the operator service. See [client registration](#client-registration). |
| Registration restricted to trusted partners or hosts (observed at Dropbox and Harness) | Complete the provider's approval process or configure a trusted host/domain for the client. Publishing a registration endpoint does not make registration open to every client. Retrying unchanged metadata will not resolve an explicit policy rejection. |
| Registration response cannot be used by this client | Return the agreed redirect URI, grant types, response types and `application_type`, and a token authentication method consistent with authorization-server metadata. A public `none` client must not receive a required secret. Confidential client modes need a hosted relay; the credential-free sweep does not configure one. |
| HTTP 403 challenge page, HTTP 429, HTTP 5xx or timeout | Check WAF rules, service health and rate limits. Allow discovery and authorization GETs for legitimate clients. Honor `Retry-After`; a headless probe cannot establish whether an interactive browser can pass an anti-bot challenge. |

## Try it

Open [Linear in the playground](/server/https://mcp.linear.app/mcp/mcp), a public catalog server that answers with a `401` OAuth challenge. Start authorization to watch discovery, client registration and the token exchange run against a real provider.
