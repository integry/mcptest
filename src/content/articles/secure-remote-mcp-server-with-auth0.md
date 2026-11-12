---
title: "Secure a remote MCP server with Auth0 OAuth 2.1"
navTitle: "MCP authorization with Auth0"
summary: "Configure Auth0 for MCP with protected resource metadata, resource audience checks, PKCE and CIMD or DCR, including Early Access features and third-party client limitations."
track: "build"
level: "practitioner"
order: 404
category: "Authorization"
readingTimeMinutes: 8
lastReviewed: "2026-11-11"
metaTitle: "MCP authorization with Auth0 | mcptest.io"
metaDescription: "Configure Auth0 for MCP with protected resource metadata, resource audience checks, PKCE and CIMD or DCR, including Early Access features and third-party client limitations."
relatedSlugs:
  - mcp-oauth-2-1-reference
  - mcp-server-authentication-patterns
  - remote-mcp-server-with-hono
  - remote-mcp-server-401-unauthorized
sourceLinks:
  - title: "MCP: authorization specification"
    url: "https://modelcontextprotocol.io/specification/2026-07-28/basic/authorization"
  - title: "Auth0 for AI Agents: Resource Parameter Compatibility Profile"
    url: "https://auth0.com/ai/docs/mcp/guides/resource-param-compatibility-profile"
  - title: "Auth0 for AI Agents: register your MCP client application"
    url: "https://auth0.com/ai/docs/mcp/guides/registering-your-mcp-client-application"
  - title: "Auth0: CIMD registration overview"
    url: "https://auth0.com/docs/get-started/auth0-overview/create-applications/cimd-overview"
  - title: "Auth0: register applications with CIMD"
    url: "https://auth0.com/docs/get-started/auth0-overview/create-applications/register-applications-with-cimd"
  - title: "Auth0: Dynamic Client Registration"
    url: "https://auth0.com/docs/get-started/applications/dynamic-client-registration"
  - title: "Auth0: configure third-party applications"
    url: "https://auth0.com/docs/get-started/applications/third-party-applications/configure-third-party-applications"
  - title: "Auth0: security controls for third-party applications"
    url: "https://auth0.com/docs/get-started/applications/third-party-applications/security-controls"
  - title: "Auth0: CIMD and Application Profiles announcement (22 October 2026)"
    url: "https://auth0.com/blog/scaling-ai-agent-identity-cimd-application-profiles/"
  - title: "Auth0 Support: MCP audience error and resource compatibility"
    url: "https://support.auth0.com/center/s/article/mcp-audience-error-with-auth0"
  - title: "auth0-api-js: verify access tokens"
    url: "https://github.com/auth0/auth0-auth-js/tree/main/packages/auth0-api-js"
---

Auth0 can act as the authorization server for a remote MCP server. It signs users in, collects consent and issues access tokens. Your MCP server is the resource server: it decides which tokens and actions it accepts. Adding an Auth0 login page to a web app does not protect its MCP endpoint.

This guide covers the Auth0 settings. It was checked against Auth0's documentation on **11 November 2026**. For the protocol rules, see the [OAuth 2.1 reference](/learn/mcp-oauth-2-1-reference).

## Before you start

- An Auth0 tenant. Use a development tenant and test users while you set this up.
- Your tenant domain, for example `YOUR-TENANT.us.auth0.com`. The issuer is `https://YOUR-TENANT.us.auth0.com/`, with a trailing slash.
- The exact public URL of your MCP endpoint, for example `https://mcp.example.com/mcp`.
- An MCP server that can verify JWTs, such as the [Hono example](/learn/remote-mcp-server-with-hono).

MCP clients connect as **third-party applications** in Auth0. Auth0 applies stricter rules to them, and several steps below exist because of that.

## Step 1: Enable the tenant settings for MCP

In the Auth0 Dashboard, open **Settings → Advanced**. In the **Settings** section, enable:

- **Resource Parameter Compatibility Profile.** MCP clients send the [`resource` parameter](/learn/mcp-glossary#resource-indicator) (RFC 8707), and Auth0 traditionally expects `audience`. With this profile on, Auth0 uses `resource` to choose the token's audience when it is present. If a request carries both, `audience` wins.
- **Include Issuer in Authorization Responses.** Auth0 then adds `iss` to the authorization response, so clients can detect mix-up attacks ([RFC 9207](/learn/mcp-oauth-2-1-reference#issuer-validation-rfc-9207)).

Without the compatibility profile, a client that sends only `resource` gets a token for the default userinfo audience. Third-party clients may not use that audience, so the flow fails. [Auth0's support article](https://support.auth0.com/center/s/article/mcp-audience-error-with-auth0) describes this error. Do not work around it by dropping `resource` or by accepting userinfo tokens.

With the profile on, Auth0 does not forward `resource` to upstream identity providers.

## Step 2: Create an API for the MCP server

1. Open **Applications → APIs** and select **+ Create API**.
2. Set **Identifier** to your exact MCP endpoint, `https://mcp.example.com/mcp`. Auth0 treats a trailing slash as part of the value, and you cannot change the identifier later.
3. On the **Permissions** tab, add a narrow permission such as `orders:read`.
4. If clients should stay signed in, enable **Allow Offline Access** so they can request refresh tokens.

If you use role-based access control, enable **Add Permissions in the Access Token** to get a `permissions` claim. The `scope` claim then contains only the requested permissions that the user also holds.

## Step 3: Let third-party clients use the API and a login method

1. **API access.** On the API's **Settings** tab, under **Default Permissions for Third Party Apps**, select **Authorized** for **User-Delegated Access**, then choose the scopes. DCR clients get no API access without these defaults, because you cannot grant access to each one by hand.
2. **Login method.** Open **Authentication**, select the connection your users sign in with, and enable **Promote Connection to Domain Level**. Third-party applications can only use domain-level connections.

Grant only the scopes an unknown client should get. Every MCP client a user approves receives them.

## Step 4: Choose how clients register

MCP clients usually have no client ID for your tenant in advance. Auth0 offers three ways to get one. For production, Auth0 recommends CIMD over DCR.

**Client ID Metadata Document (CIMD).** The client ID is an HTTPS URL that serves the client's metadata. Both switches are in **Settings → Advanced**:

- **Client ID Metadata Document Registration** advertises CIMD support in Auth0's metadata. You can then import a client by its metadata URL.
- **Dynamic CIMD Registration** lets unknown CIMD clients register themselves during authorization. It requires the first switch, is in Early Access, and allows at most 500 dynamically registered clients per tenant.

**Dynamic Client Registration (DCR).** In **Settings → Advanced**, enable **Dynamic Client Registration (DCR)**. This opens a public registration endpoint, so anyone can create clients in your tenant.

**A pre-registered client.** Create an application by hand and register its exact callback URL.

CIMD clients have fixed rules in Auth0:

- They must be a native or regular web application.
- They cannot use shared-secret authentication (`client_secret_post`, `client_secret_basic`, `client_secret_jwt`). Public clients use `none` with PKCE. Confidential clients must use `private_key_jwt`, which is Enterprise-only.
- A CIMD client registered manually cannot become dynamic, or the reverse. Delete it and register it again.

All third-party applications also have limits. Login fails if your tenant has active Rules; migrate them to Actions. Consent is always shown. Callback URLs must be exact, without wildcards. OIDC scopes and ID tokens (`openid`, `profile`, `email`) are not supported, so a client that requests them may fail.

The [22 October 2026 announcement](https://auth0.com/blog/scaling-ai-agent-identity-cimd-application-profiles/) labels Dynamic CIMD Registration and Application Profiles as Early Access, and the docs still do. Check that your tenant has them before you rely on them.

## Step 5: Publish protected resource metadata

Serve this JSON at `https://mcp.example.com/.well-known/oauth-protected-resource/mcp`. Replace the endpoint and tenant with your own values:

```json
{
  "resource": "https://mcp.example.com/mcp",
  "authorization_servers": [
    "https://YOUR-TENANT.us.auth0.com/"
  ],
  "scopes_supported": [
    "orders:read"
  ],
  "bearer_methods_supported": [
    "header"
  ]
}
```

- Make the route public: no login, no cookie.
- `resource` must equal the API identifier from Step 2 exactly.
- `authorization_servers` must equal the `issuer` in Auth0's metadata, including the trailing slash.
- List only API permissions in `scopes_supported`. Auth0 does not support OIDC scopes for third-party applications.
- On an unauthenticated request to `/mcp`, return `401` with `WWW-Authenticate: Bearer resource_metadata="https://mcp.example.com/.well-known/oauth-protected-resource/mcp"`.

This document is configuration, not a protected server. Add it to the [complete Hono application](/learn/remote-mcp-server-with-hono) and replace that app's issuer, resource and scope settings.

## Step 6: Verify the access token

Auth0's MCP guides verify tokens with [`@auth0/auth0-api-js`](https://github.com/auth0/auth0-auth-js/tree/main/packages/auth0-api-js):

```typescript
// verify.ts
import { ApiClient } from '@auth0/auth0-api-js';

const MCP_RESOURCE_URL = 'https://mcp.example.com/mcp';
const apiClient = new ApiClient({
  domain: process.env.AUTH0_DOMAIN!, // for example YOUR-TENANT.us.auth0.com
  audience: MCP_RESOURCE_URL,
});

export async function verifyMcpToken(token: string, requiredScope: string) {
  const claims = await apiClient.verifyAccessToken({ accessToken: token });
  const scopes = typeof claims.scope === 'string' ? claims.scope.split(' ') : [];
  if (!scopes.includes(requiredScope)) {
    return { ok: false as const, status: 403, scope: requiredScope };
  }
  return { ok: true as const, subject: claims.sub, scopes };
}
```

`verifyAccessToken` checks the signature, `iss`, `aud`, `exp` and `nbf`, and throws `VerifyAccessTokenError` when a check fails. Answer that with `401`. When the scope is missing, answer `403` with `WWW-Authenticate: Bearer error="insufficient_scope", scope="orders:read"`.

- Use only verified claims. Keep the verified `sub` for per-record checks inside each tool.
- An Auth0 ID token is for the OAuth client. It is not an access token for your MCP server.
- Do not forward the MCP token to other APIs. Auth0 supports [on-behalf-of token exchange](https://auth0.com/ai/docs/mcp/get-started/call-your-apis-on-users-behalf) to get a separate token for a downstream API.
- If you change domains, keep the issuer, JWKS URL and the tokens' `iss` consistent. A custom domain and the canonical tenant domain are different strings to a verifier.

## Check discovery with curl

Set the three variables to your values, then run the commands. They need only Bash and curl.

```bash
MCP_ORIGIN='https://mcp.example.com'
MCP_PATH='/mcp'
ISSUER='https://YOUR-TENANT.us.auth0.com/'

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

In Auth0's metadata, check that:

- `issuer` equals the value in `authorization_servers` exactly, including the trailing slash.
- `code_challenge_methods_supported` includes `S256`.
- `client_id_metadata_document_supported` is `true` if you enabled CIMD, and `registration_endpoint` is present if you enabled DCR.

For browser clients, the `401` and `403` responses must also expose `WWW-Authenticate` through `Access-Control-Expose-Headers`. To run the same checks in the browser, use the [MCP OAuth checker](/tools/oauth-check).

## Test sign-in on mcptest.io

1. Open your `/mcp` URL in the [mcptest.io playground](/).
2. Start authorization. Check the discovered issuer and the registration method used.
3. Sign in as a test user, approve access, list tools, then call one read-only tool.

If automatic registration is off, create an application with the exact callback URL `https://mcptest.io/oauth/callback`, set its token endpoint authentication method to **None**, and enter its client ID in the playground. Never give a browser a client secret.

Then test the failure paths. None of them may run the tool:

| Request | Expected result |
| --- | --- |
| Expired token | `401` |
| Token issued for another API | `401` |
| Valid token without `orders:read` | `403` with `insufficient_scope` |

Check the boundary between users with two test accounts. Use the [401 troubleshooting guide](/learn/remote-mcp-server-401-unauthorized) to tell discovery, registration and verification failures apart.

**What was checked.** The TypeScript snippet type-checks against `@auth0/auth0-api-js` 1.7.0, and the JSON and Bash syntax were checked locally. The tenant setup, a real authorization code exchange, refresh, consent and revocation need an Auth0 tenant and were not run.
