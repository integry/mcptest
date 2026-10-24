---
title: "Secure a remote MCP server with Auth0 OAuth 2.1"
navTitle: "MCP authorization with Auth0"
summary: "Configure Auth0 for MCP with protected resource metadata, resource audience checks, PKCE and CIMD or DCR, including October 2026 Early Access and tenant limitations."
track: "build"
level: "practitioner"
order: 404
category: "Authorization"
readingTimeMinutes: 7
lastReviewed: "2026-10-24"
metaTitle: "MCP authorization with Auth0 | mcptest.io"
metaDescription: "Configure Auth0 for MCP with protected resource metadata, resource audience checks, PKCE and CIMD or DCR, including October 2026 Early Access and tenant limitations."
relatedSlugs:
  - mcp-oauth-2-1-reference
  - mcp-server-authentication-patterns
  - remote-mcp-server-with-hono
  - remote-mcp-server-401-unauthorized
sourceLinks:
  - title: "MCP: authorization specification"
    url: "https://modelcontextprotocol.io/specification/2026-07-28/basic/authorization"
  - title: "Auth0: CIMD registration overview"
    url: "https://auth0.com/docs/get-started/auth0-overview/create-applications/cimd-overview"
  - title: "Auth0: register applications with CIMD"
    url: "https://auth0.com/docs/get-started/auth0-overview/create-applications/register-applications-with-cimd"
  - title: "Auth0: October 22 CIMD announcement"
    url: "https://auth0.com/blog/scaling-ai-agent-identity-cimd-application-profiles/"
  - title: "Auth0 Support: MCP audience error and resource compatibility"
    url: "https://support.auth0.com/center/s/article/mcp-audience-error-with-auth0"
  - title: "Auth0: secure an MCP server and configure DCR"
    url: "https://auth0.com/blog/secure-csharp-mcp-server-with-auth0/"
---

Auth0 can act as the authorization server for a remote MCP service: it signs users in, obtains consent, and issues access tokens. Your MCP server still decides which tokens and actions it accepts. Adding an Auth0 login page to a web app does not automatically protect its MCP endpoint.

This guide covers the provider-specific setup, checked on **24 October 2026**. Keep the [OAuth reference](/learn/mcp-oauth-2-1-reference) open for the protocol requirements rather than reimplementing the OAuth flow in your tools.

## Configure the API audience first

In Auth0, create an API representing the MCP resource. Use the canonical endpoint, such as `https://mcp.example.com/mcp`, as its identifier, and define a narrow permission such as `orders:read`. Configure the appropriate user connection and consent policy for third-party clients. A client being registered must not automatically grant it every API permission.

Enable **Resource Parameter Compatibility Profile** in the tenant's advanced settings. [Auth0's support article](https://support.auth0.com/center/s/article/mcp-audience-error-with-auth0) explains the otherwise confusing failure: an MCP client sends `resource`, but a tenant expecting `audience` can fall back to the userinfo audience and reject a third-party client. Do not fix this by dropping `resource` or accepting a userinfo token.

Decide whether you issue refresh tokens, enable the required offline access configuration, and use rotation for public clients. Confirm the permissions actually present in the access token; requesting a scope is not proof it was granted.

## Choose CIMD, DCR or a pre-registered client

[Auth0's current CIMD docs](https://auth0.com/docs/get-started/auth0-overview/create-applications/register-applications-with-cimd) distinguish two toggles: **Client ID Metadata Document Registration** publishes support; **Dynamic CIMD Registration** allows previously unknown clients to onboard during authorization. Publishing support alone does not enable automatic onboarding. For a browser public client use `none` token-endpoint authentication with PKCE. Confidential CIMD clients use `private_key_jwt`, which the docs limit to Enterprise; shared-secret methods are unavailable for CIMD.

The [22 October announcement](https://auth0.com/blog/scaling-ai-agent-identity-cimd-application-profiles/) labels dynamic CIMD and Application Profiles **Early Access**. Do not assume your tenant has them. If dynamic CIMD is unavailable, manually import the client's published metadata URL or use an explicitly pre-registered public client. Traditional DCR is another supported fallback when deliberately enabled; [Auth0's MCP setup article](https://auth0.com/blog/secure-csharp-mcp-server-with-auth0/) covers the tenant-level DCR switch and its open-registration tradeoff.

[CIMD's overview](https://auth0.com/docs/get-started/auth0-overview/create-applications/cimd-overview) also documents strict third-party controls: active legacy Rules can make login fail, so migrate applicable logic to Actions. A CIMD client cannot simply switch between manual and dynamic modes. Treat migration as a credential/consent change and test it with the host you intend to support.

## Publish the resource's metadata

Serve this complete JSON document at `https://mcp.example.com/.well-known/oauth-protected-resource/mcp`, replacing the example endpoint and issuer with your deployment values:

```json
{
  "resource": "https://mcp.example.com/mcp",
  "authorization_servers": [
    "https://YOUR-TENANT.auth0.com/"
  ],
  "scopes_supported": [
    "orders:read"
  ],
  "bearer_methods_supported": [
    "header"
  ]
}
```

Make that GET route public. On an unauthenticated `/mcp` request, return `401` and a `WWW-Authenticate` Bearer challenge whose `resource_metadata` points to that document. The MCP server owns this document; the provider owns the authorization-server discovery document. Do not put a client secret or a registration endpoint into protected resource metadata.

This is a configuration document, not a complete protected server. Wire it into the [complete authenticated Hono application](/learn/remote-mcp-server-with-hono), replacing that app's issuer, resource, verifier and scope settings as described below. For the full protocol flow, use the [OAuth 2.1 reference](/learn/mcp-oauth-2-1-reference); for where enforcement belongs, use [server authentication patterns](/learn/mcp-server-authentication-patterns).

## Verify the access token at the MCP boundary

For the Hono application's JWT verifier, use the Auth0 tenant's discovered JWKS, the exact token issuer including its trailing slash, and your MCP API identifier as the expected audience. Verify signature, expiry and issuer; then require `orders:read` before invoking the tool. Preserve the verified subject and tenant context for per-record authorization. An Auth0 ID token is for the OAuth client and is not the MCP API access token.

Use only the token's verified claims. If your API uses a `permissions` claim in addition to `scope`, make that mapping explicit in server policy; do not assume a generic OAuth middleware checks application permissions. Return `403 insufficient_scope` with the needed scope when the token is otherwise valid. Keep upstream API credentials separate from the MCP token.

When changing domains, keep the authorization issuer, its discovery/JWKS URLs and issued token `iss` consistent. A custom login hostname and a different tenant hostname are not interchangeable strings to a verifier.

## Check discovery before opening a chat app

These Bash commands require only curl. Replace both example values with your deployment's exact resource and issuer, then run:

```bash
export MCP_ENDPOINT='https://mcp.example.com/mcp'
export MCP_ISSUER='https://YOUR-TENANT.auth0.com/'
curl --fail-with-body --silent --show-error \
  'https://mcp.example.com/.well-known/oauth-protected-resource/mcp'
curl --fail-with-body --silent --show-error \
  "${MCP_ISSUER%/}/.well-known/oauth-authorization-server" \
  || curl --fail-with-body --silent --show-error \
    "${MCP_ISSUER%/}/.well-known/openid-configuration"
curl --silent --show-error --include \
  -H 'Accept: application/json, text/event-stream' "$MCP_ENDPOINT"
curl --silent --show-error --include -X OPTIONS "$MCP_ENDPOINT" \
  -H 'Origin: https://mcptest.io' \
  -H 'Access-Control-Request-Method: POST' \
  -H 'Access-Control-Request-Headers: authorization, mcp-protocol-version, mcp-method'
```

Change the metadata URL as well as the endpoint when using your domain. Expect public JSON metadata, a `401` challenge for the unauthenticated MCP request, and a successful CORS preflight. Ensure error responses expose `WWW-Authenticate`. Inspect provider discovery next: its `issuer` must match exactly, `code_challenge_methods_supported` must include `S256`, and the registration/authentication method must work for your actual client. A browser public client cannot keep a secret.

## Test it on mcptest.io

Open the protected `/mcp` URL in the [mcptest.io playground](/). Start authorization, inspect the discovered issuer and registration path, sign in as a test user, list tools, then call one read-only tool. If automatic registration is unavailable, pre-register a public client with the exact redirect URI `https://mcptest.io/oauth/callback` and supply its client ID. Never give a browser a client secret.

Then try an expired token, a token issued for another resource, and a valid token lacking the required scope. Expect `401`, `401`, and a scope denial respectively; none should execute the protected tool. Check the user/organization boundary with two test accounts. Use the [401 troubleshooting guide](/learn/remote-mcp-server-401-unauthorized) to distinguish discovery, registration and verification failures.

The metadata JSON and shell syntax were checked locally. Provider tenant setup, real authorization-code exchange, refresh, consent and revocation need a configured account and were not run during authoring. Passing the transport checks alone does not establish those behaviors.
