---
title: "Secure a remote MCP server with Clerk OAuth 2.1"
navTitle: "MCP authorization with Clerk"
summary: "Use Clerk as an MCP authorization server with CIMD or DCR, protected resource metadata, explicit OAuth-token verification and scope checks, and an audience-binding compatibility gate."
track: "build"
level: "practitioner"
order: 405
category: "Authorization"
readingTimeMinutes: 7
lastReviewed: "2026-10-24"
metaTitle: "MCP authorization with Clerk | mcptest.io"
metaDescription: "Use Clerk as an MCP authorization server with CIMD or DCR, protected resource metadata, explicit OAuth-token verification and scope checks, and an audience-binding compatibility gate."
relatedSlugs:
  - mcp-oauth-2-1-reference
  - mcp-server-authentication-patterns
  - remote-mcp-server-with-hono
  - remote-mcp-server-401-unauthorized
sourceLinks:
  - title: "MCP: authorization specification"
    url: "https://modelcontextprotocol.io/specification/2026-07-28/basic/authorization"
  - title: "Clerk: build an MCP server"
    url: "https://clerk.com/docs/nextjs/guides/ai/mcp/build-mcp-server"
  - title: "Clerk: OAuth implementation and client onboarding"
    url: "https://clerk.com/docs/guides/configure/auth-strategies/oauth/how-clerk-implements-oauth"
  - title: "Clerk: OAuth and PKCE overview"
    url: "https://clerk.com/docs/guides/configure/auth-strategies/oauth/overview"
  - title: "Clerk: verify OAuth access tokens"
    url: "https://clerk.com/docs/nextjs/guides/development/verifying-oauth-access-tokens"
---

Clerk's OAuth server lets an MCP client request delegated access from the users of your application. That is different from signing those users into your website with a session cookie. The MCP endpoint should accept the intended OAuth access token and enforce its permissions on every tool call.

The provider settings below were checked on **24 October 2026**. Clerk has a maintained [Next.js MCP implementation](https://clerk.com/docs/nextjs/guides/ai/mcp/build-mcp-server); prefer that integration when your application already uses Clerk's Next.js SDK.

## Configure client onboarding deliberately

In **OAuth applications → Settings → Client onboarding**, enable **Publish CIMD support**. Clerk supports an HTTPS metadata URL as the client's identity, requires `S256` PKCE for CIMD, and lets you control whether unknown clients may connect. Enable **Publish DCR support** only when a client needs traditional dynamic registration. These are authorization-server settings, not routes in your MCP app.

For manually registered or DCR clients, turn on the instance-level **Require PKCE** setting as well. [Clerk's OAuth overview](https://clerk.com/docs/guides/configure/auth-strategies/oauth/overview) explains this enforcement control; a website login working without PKCE is not evidence your MCP flow meets OAuth 2.1 expectations.

Use a pre-registered public OAuth client if automatic onboarding is disallowed. Register its exact redirect URI and use a client that can exchange the code without a secret. The [OAuth implementation docs](https://clerk.com/docs/guides/configure/auth-strategies/oauth/how-clerk-implements-oauth) describe public clients and configurable default scopes for clients that omit a scope request. Choose a narrow default; never make the omission of `scope` mean unrestricted access.

## Pick the intended tokens and permissions

Clerk currently issues JWT OAuth access tokens by default and also offers opaque access tokens for immediate revocation. Use a verifier that handles the configured format. For Next.js, [Clerk's verification guide](https://clerk.com/docs/nextjs/guides/development/verifying-oauth-access-tokens) shows explicitly accepting `oauth_token`. Do not rely on a middleware's default session-token acceptance or treat any authenticated website visitor as an authorized MCP client.

For a first integration, request Clerk's `profile` scope and expose a read-only profile tool, matching the provider's MCP walkthrough. For your own records, define an application scope such as `orders:read`, grant it only to the intended clients, and enforce it inside the API. A successful token verification identifies a principal; it does not establish access to every organization or database row.

Clerk's helper-based walkthrough uses `verifyClerkToken` with `withMcpAuth`, and `protectedResourceHandlerClerk` to expose resource metadata. Use the complete walkthrough's files together. Dropping only its authentication wrapper into an unrelated server can leave discovery routes or scope enforcement missing.

## Publish the resource's metadata

Serve this complete JSON document at `https://mcp.example.com/.well-known/oauth-protected-resource/mcp`, replacing the example endpoint and issuer with your deployment values:

```json
{
  "resource": "https://mcp.example.com/mcp",
  "authorization_servers": [
    "https://YOUR-INSTANCE.clerk.accounts.dev"
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

## Check resource binding before production

The reviewed Clerk MCP walkthrough establishes client onboarding and token verification, but does not establish how RFC 8707 `resource` requests are bound to a distinct audience for every arbitrary MCP resource. Do not infer that merely because a JWT contains `aud`, it was minted for your `/mcp` URL.

For your instance, inspect a verified OAuth token or its authoritative introspection result and confirm the documented audience mapping for your resource. Test a token issued for another API and make sure this MCP endpoint rejects it. Configure audience validation in the verifier where applicable. Never substitute `azp` or the user's ID for an audience check.

If the needed resource-specific binding is unavailable, use an MCP-facing authorization server or broker that implements it, with Clerk providing upstream user authentication. The broker must issue its own resource-bound tokens, obtain per-client consent and enforce redirect/PKCE rules. Your protected resource metadata must then advertise the **broker's** issuer. Passing a Clerk session token through unchanged is not a workaround.

This is an interoperability gate, not a claim that Clerk categorically lacks RFC 8707 support. Confirm the current capabilities of your instance before publishing a broad compatibility promise.

## Check discovery before opening a chat app

These Bash commands require only curl. Replace both example values with your deployment's exact resource and issuer, then run:

```bash
export MCP_ENDPOINT='https://mcp.example.com/mcp'
export MCP_ISSUER='https://YOUR-INSTANCE.clerk.accounts.dev'
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

Use the issuer's `/.well-known/oauth-authorization-server` document to inspect onboarding and PKCE. The MCP app's CORS must cover metadata, `401` and `403` responses; the provider's token endpoint needs its own browser-compatible path. Do not turn a confidential client into a public client by shipping its secret to the browser.

## Test it on mcptest.io

Open the protected `/mcp` URL in the [mcptest.io playground](/). Start authorization, inspect the discovered issuer and registration path, sign in as a test user, list tools, then call one read-only tool. If automatic registration is unavailable, pre-register a public client with the exact redirect URI `https://mcptest.io/oauth/callback` and supply its client ID. Never give a browser a client secret.

Then try an expired token, a token issued for another resource, and a valid token lacking the required scope. Expect `401`, `401`, and a scope denial respectively; none should execute the protected tool. Check the user/organization boundary with two test accounts. Use the [401 troubleshooting guide](/learn/remote-mcp-server-401-unauthorized) to distinguish discovery, registration and verification failures.

The metadata JSON and shell syntax were checked locally. Provider tenant setup, real authorization-code exchange, refresh, consent and revocation need a configured account and were not run during authoring. Passing the transport checks alone does not establish those behaviors.
