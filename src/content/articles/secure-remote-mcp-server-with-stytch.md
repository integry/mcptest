---
title: "Secure a remote MCP server with Stytch Connected Apps"
navTitle: "MCP authorization with Stytch"
summary: "Use Stytch Connected Apps for MCP OAuth with pre-registered public clients, a custom domain for issuer checks, protected resource metadata, PKCE, a required MCP-specific audience, and a broker for CIMD and DCR clients."
track: "build"
level: "practitioner"
order: 407
category: "Authorization"
readingTimeMinutes: 8
lastReviewed: "2026-11-11"
metaTitle: "MCP authorization with Stytch | mcptest.io"
metaDescription: "Use Stytch Connected Apps for MCP OAuth with pre-registered public clients, a custom domain for issuer checks, protected resource metadata, PKCE, a required MCP-specific audience, and a broker for CIMD and DCR clients."
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
  - title: "Stytch: MCP authorization overview"
    url: "https://stytch.com/docs/connected-apps/guides/mcp-auth-overview"
  - title: "Stytch: build the authorization and consent flow"
    url: "https://stytch.com/docs/connected-apps/build-login-flow/login-flow"
  - title: "Stytch: client types, CIMD, DCR and public clients"
    url: "https://stytch.com/docs/connected-apps/oauth-learn-more/client-types"
  - title: "Stytch: access token claims and custom audiences"
    url: "https://stytch.com/docs/api-reference/b2b/api/connected-apps/tokens/connected-app-access-token-object"
  - title: "Stytch: OAuth scopes and RBAC"
    url: "https://stytch.com/docs/connected-apps/oauth-learn-more/oauth-scopes"
  - title: "Stytch: Connected Apps custom domains"
    url: "https://stytch.com/docs/connected-apps/resources/custom-domains"
  - title: "Stytch: Connected Apps FAQ (issuer and RFC 9207)"
    url: "https://stytch.com/docs/connected-apps/resources/faq"
---

Stytch Connected Apps turns your application into an OAuth and OpenID Connect authorization server for third-party clients, including MCP clients. Stytch handles client registration and issues tokens. Your app hosts the sign-in and consent page. Your MCP server validates each token and enforces access to data.

This guide was checked against Stytch's documentation on **11 November 2026**. For the protocol rules, see the [OAuth 2.1 reference](/learn/mcp-oauth-2-1-reference).

One distinction matters throughout. A Stytch RBAC "resource" is a permission target, such as a database table. MCP's [`resource` parameter](/learn/mcp-glossary#resource-indicator) (RFC 8707) is the URL of your MCP server. A permission named after a table does not restrict a token to your MCP endpoint.

## Before you start

- A Stytch Consumer or B2B project. Use a test environment and test data while you set this up.
- A React or Next.js app that already signs users in with Stytch.
- A custom auth domain for the project, such as `https://login.example.com`. Step 1 explains why MCP clients need it.
- The exact public URL of your MCP endpoint, for example `https://mcp.example.com/mcp`.

## Step 1: Configure a custom auth domain

Configure a custom auth domain for your project, and make every Stytch call through it, including the frontend SDK.

Without one, the issuer does not match. Stytch's FAQ says the authorization response's `iss` parameter then uses your project ID, such as `stytch.com/project-live-xxx`, while tokens and metadata use your default project domain, such as `https://{noun}-{verb}-{number}.customers.stytch.com`. Stytch advertises `authorization_response_iss_parameter_supported: true`, and under [RFC 9207](/learn/mcp-oauth-2-1-reference#issuer-validation-rfc-9207) clients must then reject any `iss` that differs from the issuer. A custom domain makes them the same. Stytch's MCP guide strongly recommends it.

The issuer is the domain you call Stytch through. Read it from that domain's discovery document; do not assume the API base URL is the issuer. When you change domains, check the issuer and the JWKS URL together.

## Step 2: Build the authorization page

The authorization endpoint is a page in your own app.

1. In the Stytch Dashboard, under **Frontend SDKs**, enable the frontend SDK for your app's domain.
2. Mount Stytch's `<IdentityProvider />` component (Consumer, from `@stytch/react`) or `<B2BIdentityProvider />` (B2B, from `@stytch/react/b2b`) on a page, for example `/oauth/authorize`.
3. Enter that page's URL in the **Authorization URL** field under **Connected Apps**.

The user must already have an active Stytch session when the component renders. Check for a session first. If there is none, send the user to your login page and then back to the authorization page with the same query string. You can also build this page with Stytch's API instead of the component.

## Step 3: Choose how clients register

Under **Connected Apps** in the Dashboard:

- **A pre-registered client.** Create a Connected App by hand, choose **Third-Party Public**, and register its exact redirect URI. This is the only kind of client that can carry your MCP server's audience (Step 5), so it is the only kind this guide's verifier accepts.
- **Client ID Metadata Document (CIMD).** The client ID is an HTTPS URL that serves the client's metadata. Stytch fetches the document instead of asking you to register the client. Stytch labels CIMD as Beta, and creates every CIMD client as a **Third-Party Public** client. Stytch re-fetches the document periodically, which overwrites manual edits to the client.
- **Dynamic Client Registration (DCR).** **Allow dynamic client registration** is opt-in.

Tokens that Stytch issues to CIMD and DCR clients do not name your MCP server, so a correct verifier rejects them. Leave both off unless you run the authorization server described at the end of Step 5, which registers those clients itself.

Public clients use token endpoint authentication `none` and must use PKCE. Their refresh tokens rotate on every use, and Stytch detects replay. Confidential clients keep the same refresh token. A client ID from another Stytch project does not work here.

## Step 4: Configure scopes

Stytch supports the standard OpenID scopes `openid`, `profile`, `email`, `phone` and `offline_access`. Clients get a refresh token only when `offline_access` is granted.

For your data, create a custom scope such as `read:data` and map it to the RBAC permissions your read tool needs. A user can grant only the scopes whose permissions they hold; Stytch drops the rest. Check permissions inside each tool too. A scope that allows reading documents does not say which customer's documents a tool may read.

## Step 5: Decide what the audience check can prove

Stytch access tokens are RS256 JWTs signed with your project's JWKS. Their `aud` claim always contains your **project ID**. A client can carry one extra audience, set as `access_token_custom_audience` on the client object, which Stytch appends to `aud`.

The project ID is shared by every service and client in the project, so it does not show that a token was issued for your MCP server. Never use it as the audience your server requires:

- **Pre-registered clients.** Set `access_token_custom_audience` to your MCP endpoint URL on each client, and require that exact value in your verifier. A token Stytch issued for another service in the same project lacks it and fails.
- **CIMD and DCR clients.** You cannot set a custom audience on each one, so their tokens carry only the project ID. Your verifier must reject them. A separate Stytch project per server does not fix this: the project ID still names the project, not the resource, and anything added to the project later would share it.

Stytch's documentation does not say that it maps an RFC 8707 `resource` request to `aud`. To accept CIMD or DCR clients, put an MCP-facing authorization server in front of Stytch. It must issue its own resource-bound tokens, handle consent and PKCE itself, and use Stytch only to sign the user in. Then advertise that server's issuer in your metadata. Do not strip `resource`, and do not forward a Stytch session token as an MCP access token.

## Step 6: Publish protected resource metadata

Serve this JSON at `https://mcp.example.com/.well-known/oauth-protected-resource/mcp`. Replace the endpoint and the custom domain with your own values:

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

- Make the route public: no login, no cookie.
- `authorization_servers` must equal the `issuer` in Stytch's metadata for your custom domain exactly.
- On an unauthenticated request to `/mcp`, return `401` with `WWW-Authenticate: Bearer resource_metadata="https://mcp.example.com/.well-known/oauth-protected-resource/mcp"`.

This document is configuration, not a protected server. Add it to the [complete Hono application](/learn/remote-mcp-server-with-hono) and replace that app's issuer, resource and scope settings.

## Step 7: Verify the access token

With `jose`, check the issuer and the audience you chose in Step 5:

```typescript
import { createRemoteJWKSet, jwtVerify } from 'jose';

const ISSUER = 'https://login.example.com';
const JWKS = createRemoteJWKSet(new URL(`${ISSUER}/.well-known/jwks.json`));

// Your MCP endpoint URL, set as access_token_custom_audience on each
// pre-registered client. Never the Stytch project ID.
const AUDIENCE = process.env.MCP_TOKEN_AUDIENCE?.trim();
if (!AUDIENCE?.startsWith('https://')) {
  throw new Error('MCP_TOKEN_AUDIENCE must be this MCP server\'s URL, not the Stytch project ID');
}

export async function verifyAccessToken(token: string, requiredScope: string) {
  const { payload } = await jwtVerify(token, JWKS, { issuer: ISSUER, audience: AUDIENCE });
  const scopes = typeof payload.scope === 'string' ? payload.scope.split(' ') : [];
  return { payload, allowed: scopes.includes(requiredScope) };
}
```

`jwtVerify` checks the signature, expiry, issuer and audience. The startup check matters: `jose` skips the audience check when `audience` is `undefined`, and a non-null assertion such as `process.env.MCP_TOKEN_AUDIENCE!` does not stop that at runtime. The check also refuses a project ID such as `project-live-xxx`, which every token in the project carries. Either mistake would let tokens issued for other services through. Answer a failure with `401`. When `allowed` is false, answer `403` with `error="insufficient_scope"`.

Stytch's Node SDK offers `client.idp.introspectTokenLocal(token)`, which can also check an RBAC permission with its `authorization_check` option. It always checks the project ID as the audience and has no option for another audience, so a passing result does not show that the token is for your MCP server. If you use it, also check that the returned audience includes your MCP URL.

Do not accept an ID token, a session JWT or a decoded but unverified payload as an access token. In a B2B project, tie each record lookup to the verified member and organization. Test with a member who has fewer permissions, and with a user from a second organization.

## Check discovery with curl

Set the three variables to your values, then run the commands. They need only Bash and curl.

```bash
MCP_ORIGIN='https://mcp.example.com'
MCP_PATH='/mcp'
ISSUER='https://login.example.com'

# 1. Protected resource metadata: expect public JSON.
curl --fail-with-body --silent --show-error \
  "${MCP_ORIGIN}/.well-known/oauth-protected-resource${MCP_PATH}"

# 2. Authorization server metadata: check issuer, S256 and registration.
curl --fail-with-body --silent --show-error \
  "${ISSUER%/}/.well-known/oauth-authorization-server"

# 3. Unauthenticated MCP request: expect 401 and a WWW-Authenticate header.
curl --silent --show-error --include -X POST "${MCP_ORIGIN}${MCP_PATH}" \
  -H 'Content-Type: application/json' \
  -H 'Accept: application/json, text/event-stream' \
  --data '{"jsonrpc":"2.0","id":1,"method":"ping"}'

# 4. CORS preflight for browser clients: expect a 2xx response.
curl --silent --show-error --include -X OPTIONS "${MCP_ORIGIN}${MCP_PATH}" \
  -H 'Origin: https://mcptest.io' \
  -H 'Access-Control-Request-Method: POST' \
  -H 'Access-Control-Request-Headers: authorization, content-type, mcp-protocol-version'
```

In Stytch's metadata, check that:

- `issuer` equals your custom domain and the value in `authorization_servers`.
- `code_challenge_methods_supported` includes `S256`.
- `registration_endpoint` and `client_id_metadata_document_supported` are absent or off, unless the issuer is the authorization server from Step 5 rather than Stytch.

Use the RFC 8414 document above. Stytch's `/.well-known/openid-configuration` may not list `registration_endpoint`. For browser clients, the `401` and `403` responses must also expose `WWW-Authenticate` through `Access-Control-Expose-Headers`. To run the same checks in the browser, use the [MCP OAuth checker](/tools/oauth-check).

## Test sign-in on mcptest.io

1. Open your `/mcp` URL in the [mcptest.io playground](/).
2. Start authorization. Check the discovered issuer and the registration method used.
3. Sign in as a test user, approve access, list tools, then call one read-only tool.

Create a **Third-Party Public** client with the exact redirect URI `https://mcptest.io/oauth/callback` and your MCP URL as `access_token_custom_audience`, and enter its client ID in the playground. Never give a browser a client secret. If the playground reports an issuer mismatch on the callback, revisit Step 1.

Then test the failure paths. None of them may run the tool:

| Request | Expected result |
| --- | --- |
| Expired token | `401` |
| Token issued for another audience | `401` |
| Token whose `aud` holds only the project ID, such as one from a CIMD or DCR client | `401` |
| Valid token without `read:data` | `403` with `insufficient_scope` |

Use the [401 troubleshooting guide](/learn/remote-mcp-server-401-unauthorized) to tell discovery, registration and verification failures apart.

**What was checked.** The TypeScript snippet type-checks against `jose` 6, and the JSON and Bash syntax were checked locally. The `introspectTokenLocal` behavior was read from the `stytch` 14.3.0 package. The project setup, a real authorization code exchange, refresh, consent and revocation need a Stytch project and were not run.
