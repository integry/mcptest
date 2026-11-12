---
title: "Secure a remote MCP server with WorkOS AuthKit"
navTitle: "MCP authorization with WorkOS"
summary: "Configure WorkOS AuthKit and Connect for MCP with CIMD, resource indicators, protected resource metadata and exact JWT audience checks, then test OAuth on mcptest.io."
track: "build"
level: "practitioner"
order: 406
category: "Authorization"
readingTimeMinutes: 6
lastReviewed: "2026-10-24"
metaTitle: "MCP authorization with WorkOS | mcptest.io"
metaDescription: "Configure WorkOS AuthKit and Connect for MCP with CIMD, resource indicators, protected resource metadata and exact JWT audience checks, then test OAuth on mcptest.io."
relatedSlugs:
  - mcp-oauth-2-1-reference
  - mcp-server-authentication-patterns
  - remote-mcp-server-with-hono
  - remote-mcp-server-401-unauthorized
sourceLinks:
  - title: "MCP: authorization specification"
    url: "https://modelcontextprotocol.io/specification/2026-07-28/basic/authorization"
  - title: "WorkOS: MCP integration"
    url: "https://workos.com/docs/authkit/mcp"
  - title: "WorkOS: Connect overview"
    url: "https://workos.com/docs/authkit/connect"
  - title: "WorkOS: resource indicators announcement"
    url: "https://workos.com/changelog/resource-indicators-for-mcp-auth"
  - title: "WorkOS: CIMD support announcement"
    url: "https://workos.com/changelog/client-id-metadata-support-for-mcp-auth"
---

WorkOS AuthKit can provide the authorization server for your MCP service through **Connect**. AuthKit's normal sign-in establishes who is using your app; Connect handles a third-party client's delegated access. Your MCP server is still the resource server, responsible for validating access tokens and authorizing tools.

This guide focuses on those provider settings, checked on **24 October 2026**. The complete protocol rules live in the [OAuth 2.1 reference](/learn/mcp-oauth-2-1-reference), while [authentication patterns](/learn/mcp-server-authentication-patterns) explains where to put the verifier.

## Enable MCP onboarding in the right environment

Use the WorkOS environment and AuthKit domain corresponding to the data your MCP tools expose. In its MCP configuration, enable CIMD onboarding for clients that publish an HTTPS client metadata document. Enable DCR for older clients when needed. [WorkOS's CIMD announcement](https://workos.com/changelog/client-id-metadata-support-for-mcp-auth) explains that Connect supports both; the older announcement's contact-support instructions are historical, so follow the current MCP dashboard documentation for your environment.

Discover the actual issuer's `/.well-known/oauth-authorization-server` document. Confirm it advertises `S256`, the authorization-code flow, token endpoint methods and your intended client registration path. Do not hardcode another environment's registration URL or copy a client secret into a browser tester.

[Connect's overview](https://workos.com/docs/authkit/connect) distinguishes user OAuth applications from machine-to-machine integrations. A `client_credentials` integration represents a different actor and does not stand in for an interactive user's consent flow. For a manually registered client, choose a public-client configuration appropriate to the host; if that is unavailable in your environment, use the supported MCP onboarding route or a compatible server-side host.

## Register the MCP resource URL

Add the exact MCP endpoint as a **Resource Indicator**, for example `https://mcp.example.com/mcp`, in the WorkOS dashboard. [WorkOS's MCP guide](https://workos.com/docs/authkit/mcp) says issued `aud` matches the requested configured resource. With no Resource Indicators configured, the provider can ignore `resource` and issue the environment client ID as audience instead. That is a configuration trap: do not loosen your verifier to accept the environment ID just to make the flow succeed.

Use explicit resource URLs for development and production. Start with exact URLs rather than a wildcard, then verify a token obtained for development fails at production. [WorkOS announced resource indicators in May 2026](https://workos.com/changelog/resource-indicators-for-mcp-auth); an older integration may still be using the earlier audience behavior.

If you set a default Resource Indicator for clients that omit `resource`, confirm its effect on new grants and refresh flows using the current docs. Existing authorizations can retain their old audience. Reauthorize your test client after changing resource configuration rather than diagnosing a stale token as a verifier bug.

## Publish the resource's metadata

Serve this complete JSON document at `https://mcp.example.com/.well-known/oauth-protected-resource/mcp`, replacing the example endpoint and issuer with your deployment values:

```json
{
  "resource": "https://mcp.example.com/mcp",
  "authorization_servers": [
    "https://YOUR-APP.authkit.app"
  ],
  "scopes_supported": [
    "profile"
  ],
  "bearer_methods_supported": [
    "header"
  ]
}
```

Make that GET route public. On an unauthenticated `/mcp` request, return `401` and a `WWW-Authenticate` Bearer challenge whose `resource_metadata` points to that document. The MCP server owns this document; the provider owns the authorization-server discovery document. Do not put a client secret or a registration endpoint into protected resource metadata.

This is a configuration document, not a complete protected server. Wire it into the [complete authenticated Hono application](/learn/remote-mcp-server-with-hono), replacing that app's issuer, resource, verifier and scope settings as described below. For the full protocol flow, use the [OAuth 2.1 reference](/learn/mcp-oauth-2-1-reference); for where enforcement belongs, use [server authentication patterns](/learn/mcp-server-authentication-patterns).

## Validate identity and authorization separately

Use the AuthKit domain's discovered JWKS and exact issuer in the JWT verifier, and require `https://mcp.example.com/mcp` as audience. Check expiry and scope before tool dispatch. Pass the verified user and organization context through to your data layer; a token for one organization must not gain access by providing another organization's ID in tool arguments.

For the Hono example, change its required scope to the scope your provider actually grants. The metadata above uses `profile` for an identity-reading experiment. That scope alone is not permission to read your business records. Add your own role/permission checks before exposing such tools, and keep the advertised metadata consistent with the scopes your authorization server supports.

Keep refresh policy separate from tool permissions. The client may request `offline_access` when supported to stay connected, but it is not a data-access scope to require for an ordinary read tool. A refresh token belongs at the client, not in your MCP tool arguments.

## Check discovery before opening a chat app

These Bash commands require only curl. Replace both example values with your deployment's exact resource and issuer, then run:

```bash
export MCP_ENDPOINT='https://mcp.example.com/mcp'
export MCP_ISSUER='https://YOUR-APP.authkit.app'
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

## When a successful login still fails

If consent completes and the next request returns `401`, compare resource metadata, the requested `resource`, and the token's verified audience. A missing Resource Indicator or stale grant is more likely than a reason to accept any token from the issuer. If no consent screen opens at all, inspect client onboarding and callback registration first.

A custom AuthKit domain changes discovery and issuer configuration; an MCP custom domain changes the resource. Update each at its own boundary. Reusing an OAuth client ID across a different issuer can fail even when both domains belong to your company.

## Test it on mcptest.io

Open the protected `/mcp` URL in the [mcptest.io playground](/). Start authorization, inspect the discovered issuer and registration path, sign in as a test user, list tools, then call one read-only tool. If automatic registration is unavailable, pre-register a public client with the exact redirect URI `https://mcptest.io/oauth/callback` and supply its client ID. Never give a browser a client secret.

Then try an expired token, a token issued for another resource, and a valid token lacking the required scope. Expect `401`, `401`, and a scope denial respectively; none should execute the protected tool. Check the user/organization boundary with two test accounts. Use the [401 troubleshooting guide](/learn/remote-mcp-server-401-unauthorized) to distinguish discovery, registration and verification failures.

The metadata JSON and shell syntax were checked locally. Provider tenant setup, real authorization-code exchange, refresh, consent and revocation need a configured account and were not run during authoring. Passing the transport checks alone does not establish those behaviors.
