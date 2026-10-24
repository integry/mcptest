---
title: "Secure a remote MCP server with Stytch Connected Apps"
navTitle: "MCP authorization with Stytch"
summary: "Use Stytch Connected Apps for MCP OAuth with CIMD or DCR, protected resource metadata, public-client PKCE, custom audience checks and explicit resource-binding limitations."
track: "build"
level: "practitioner"
order: 407
category: "Authorization"
readingTimeMinutes: 7
lastReviewed: "2026-10-24"
metaTitle: "MCP authorization with Stytch | mcptest.io"
metaDescription: "Use Stytch Connected Apps for MCP OAuth with CIMD or DCR, protected resource metadata, public-client PKCE, custom audience checks and explicit resource-binding limitations."
relatedSlugs:
  - mcp-oauth-2-1-reference
  - mcp-server-authentication-patterns
  - remote-mcp-server-with-hono
  - remote-mcp-server-401-unauthorized
sourceLinks:
  - title: "MCP: authorization specification"
    url: "https://modelcontextprotocol.io/specification/2026-07-28/basic/authorization"
  - title: "Stytch: Connected Apps overview"
    url: "https://stytch.com/docs/connected-apps/overview"
  - title: "Stytch: build the authorization and consent flow"
    url: "https://stytch.com/docs/connected-apps/build-login-flow/login-flow"
  - title: "Stytch: client types, CIMD, DCR and public clients"
    url: "https://stytch.com/docs/connected-apps/oauth-learn-more/client-types"
  - title: "Stytch: access token claims and custom audiences"
    url: "https://stytch.com/docs/api-reference/b2b/api/connected-apps/tokens/connected-app-access-token-object"
  - title: "Stytch: OAuth scopes and RBAC"
    url: "https://stytch.com/docs/connected-apps/oauth-learn-more/oauth-scopes"
  - title: "Stytch: MCP authorization guide"
    url: "https://stytch.com/blog/MCP-authentication-and-authorization-guide/"
---

Stytch Connected Apps can turn your application into an OAuth authorization server for third-party MCP clients. It supplies client onboarding and tokens, while your app supplies the user-facing authorization experience and your MCP service enforces access to data.

The setup below was reviewed on **24 October 2026**. It highlights a distinction easy to miss: Stytch's RBAC “resource” and MCP's RFC 8707 `resource` URL are different concepts. A permission named after a database table does not by itself restrict a token to your MCP endpoint.

## Build the authorization experience

Start with [Connected Apps](https://stytch.com/docs/connected-apps/overview) in the appropriate consumer or multi-tenant project. Its [login-flow guide](https://stytch.com/docs/connected-apps/build-login-flow/login-flow) describes the authorization UI and consent integration. Configure the login/consent URLs and connect them to your existing identity flow. Do not stop after enabling a dashboard toggle: the user still needs a real way to sign in and approve the requesting client.

Use a separate test project or environment and synthetic data while wiring this up. Identify the exact issuer from that environment's discovery document; do not assume the API base URL is the issuer written into access tokens. If you add a custom domain, recheck the issuer and JWKS configuration together.

## Use the right client type

The [client-types documentation](https://stytch.com/docs/connected-apps/oauth-learn-more/client-types) supports manual clients, DCR and CIMD. Enable automatic onboarding in Connected Apps only when intended. CIMD clients are third-party **public** clients; public clients use token-endpoint authentication `none` and require PKCE. Their refresh tokens rotate, whereas the docs describe different refresh behavior for confidential clients. Do not assume an arbitrary confidential-client setup meets the public-client requirements of a browser MCP tester.

For an older client, use DCR when enabled. If your policy forbids dynamic onboarding, manually pre-register a public client and its exact callback URI instead. Advertise only the registration features actually enabled in the issuer's metadata. A client ID from a different Stytch project is not interchangeable.

## Configure scopes and resource binding

Create a narrow custom scope such as `read:data`, mapping it to the RBAC actions your read tool needs. [Stytch's scope guide](https://stytch.com/docs/connected-apps/oauth-learn-more/oauth-scopes) explains that the authorizing user's permissions constrain what can be granted. Enforce the resulting permissions at the data layer too. OAuth permission to read documents does not select which customer's documents a tool argument may address.

Stytch's [access-token object documentation](https://stytch.com/docs/api-reference/b2b/api/connected-apps/tokens/connected-app-access-token-object) says Connected Apps access tokens are RS256 JWTs. The default audience is the project ID; `access_token_custom_audience` on a client can add another audience. For a controlled, pre-registered client, configure your MCP resource URL as the custom audience and require that exact value in the verifier. Accepting the project ID alone can accept tokens intended for other services in the same project.

There is a limitation to verify before allowing arbitrary clients: those token docs do not establish automatic per-request RFC 8707 audience binding for all dynamically onboarded CIMD/DCR clients. [Stytch's MCP guide](https://stytch.com/blog/MCP-authentication-and-authorization-guide/) describes the requirement to send `resource` in both authorization and token requests, but a protocol description is not proof your project's token issuance implements that mapping.

Check the current project configuration and real issued token. If resource binding cannot be enforced for dynamic clients, start with controlled pre-registration and a dedicated audience, or put a standards-compatible MCP authorization broker in front. The broker must issue its own resource-bound tokens and handle consent/PKCE itself, using Stytch upstream for identity. Then advertise the broker's issuer in metadata. Do not silently strip `resource` or forward an upstream session token as an MCP access token.

## Publish the resource's metadata

Serve this complete JSON document at `https://mcp.example.com/.well-known/oauth-protected-resource/mcp`, replacing the example endpoint and issuer with your deployment values:

```json
{
  "resource": "https://mcp.example.com/mcp",
  "authorization_servers": [
    "https://login.example.com"
  ],
  "scopes_supported": [
    "read:data"
  ],
  "bearer_methods_supported": [
    "header"
  ]
}
```

Make that GET route public. On an unauthenticated `/mcp` request, return `401` and a `WWW-Authenticate` Bearer challenge whose `resource_metadata` points to that document. The MCP server owns this document; the provider owns the authorization-server discovery document. Do not put a client secret or a registration endpoint into protected resource metadata.

This is a configuration document, not a complete protected server. Wire it into the [complete authenticated Hono application](/learn/remote-mcp-server-with-hono), replacing that app's issuer, resource, verifier and scope settings as described below. For the full protocol flow, use the [OAuth 2.1 reference](/learn/mcp-oauth-2-1-reference); for where enforcement belongs, use [server authentication patterns](/learn/mcp-server-authentication-patterns).

## Verify access tokens, not login artifacts

Use the issuer and JWKS from your configured authorization server, validate the access-token signature and expiry, and require the MCP resource audience. Match the granted scope or its verified permission mapping before invoking a tool. Do not treat an ID token, a session JWT, or a base64-decoded payload as an authorized API credential.

In a multi-tenant application, bind the tool's record access to the verified user/member and organization. Test a member with fewer permissions and a user from a second organization. Reject invalid tokens before the tool runs and return a scope challenge for an otherwise valid token that lacks the required permission.

## Check discovery before opening a chat app

These Bash commands require only curl. Replace both example values with your deployment's exact resource and issuer, then run:

```bash
export MCP_ENDPOINT='https://mcp.example.com/mcp'
export MCP_ISSUER='https://login.example.com'
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
