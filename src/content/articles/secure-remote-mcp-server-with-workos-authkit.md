---
title: "Secure a remote MCP server with WorkOS AuthKit"
navTitle: "MCP authorization with WorkOS"
summary: "Configure WorkOS AuthKit and Connect for MCP with CIMD, resource indicators, protected resource metadata and exact JWT audience checks, then test OAuth on mcptest.io."
track: "build"
level: "practitioner"
order: 406
category: "Authorization"
readingTimeMinutes: 7
lastReviewed: "2026-11-11"
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
  - title: "WorkOS: Connect OAuth applications"
    url: "https://workos.com/docs/authkit/connect/oauth"
  - title: "WorkOS: Connect authorize endpoint and scopes"
    url: "https://workos.com/docs/reference/workos-connect/authorize"
  - title: "WorkOS: resource indicators announcement"
    url: "https://workos.com/changelog/resource-indicators-for-mcp-auth"
  - title: "WorkOS: CIMD support announcement"
    url: "https://workos.com/changelog/client-id-metadata-support-for-mcp-auth"
---

WorkOS AuthKit can act as the authorization server for your MCP server. The feature that does this is **Connect**: it lets third-party apps, including MCP clients, get delegated access to your users. AuthKit signs users in and issues tokens. Your MCP server is the resource server: it validates every access token and decides what each tool may do.

This guide covers the WorkOS settings. It was checked against the [WorkOS MCP guide](https://workos.com/docs/authkit/mcp) on **11 November 2026**. For the protocol rules, see the [OAuth 2.1 reference](/learn/mcp-oauth-2-1-reference). For where to put the token check, see [authentication patterns](/learn/mcp-server-authentication-patterns).

## Before you start

- A WorkOS environment with AuthKit set up. Use a staging environment and test data while you wire this up.
- Your AuthKit domain, for example `https://youthful-ginger-43.authkit.app`. It is the issuer.
- The exact public URL of your MCP endpoint, for example `https://mcp.example.com/mcp`. You will use this one string as the resource indicator, the metadata `resource` and the token audience.
- An MCP server that can verify JWTs, such as the [Hono example](/learn/remote-mcp-server-with-hono).

## Step 1: Enable client registration

MCP clients usually have no client ID for your server in advance. They get one in one of two ways:

- **Client ID Metadata Document (CIMD).** The client ID is an HTTPS URL that serves the client's metadata. This is what the MCP specification recommends.
- **[Dynamic client registration](/learn/mcp-glossary#dynamic-client-registration) (DCR).** The client registers itself with a POST. The specification now deprecates it, but many clients still use it.

In the WorkOS Dashboard, open **Connect → Configuration** and enable CIMD. It is off by default. Enable DCR there too if you need to support clients that do not implement CIMD yet.

WorkOS's [CIMD changelog entry](https://workos.com/changelog/client-id-metadata-support-for-mcp-auth) (30 November 2025) still ends with "Contact us to get started". The current MCP guide documents CIMD as a dashboard setting instead, so follow the guide.

You can also create an OAuth application by hand under Connect. OAuth applications are confidential by default. For a browser or desktop client that cannot keep a secret, mark the application **Public** when you create it. Public applications must use [PKCE](/learn/mcp-glossary#pkce). Do not use an M2M application for this: it uses the `client_credentials` grant, which acts for an organization, not for a signed-in user.

## Step 2: Register the MCP server URL as a resource indicator

1. In the WorkOS Dashboard, add your exact MCP endpoint, `https://mcp.example.com/mcp`, as a **Resource Indicator**.
2. Add separate entries for development and production URLs.
3. Optional: open the **…** menu next to an entry and choose **Set as default**.

MCP clients send this URL as the [`resource` parameter](/learn/mcp-glossary#resource-indicator). WorkOS then issues access tokens whose `aud` claim equals the requested resource.

**If you configure no resource indicators,** WorkOS ignores `resource` and sets `aud` to the environment's client ID. Your verifier will then reject the tokens, which is correct. Fix the dashboard setting; do not loosen the verifier to accept the client ID.

**The default indicator** applies only to CIMD and DCR clients that omit `resource`. Hand-created OAuth and M2M applications never use it. Existing grants keep their old audience, and so do tokens refreshed from them. After you change resource settings, authorize your test client again.

WorkOS also supports wildcard indicators, such as `https://*.preview.example.com/mcp`. Start with exact URLs. Then confirm that a token issued for development is rejected by production.

## Step 3: Publish protected resource metadata

Serve this JSON at `https://mcp.example.com/.well-known/oauth-protected-resource/mcp`. Replace the endpoint and the AuthKit domain with your own values:

```json
{
  "resource": "https://mcp.example.com/mcp",
  "authorization_servers": [
    "https://YOUR-APP.authkit.app"
  ],
  "scopes_supported": [
    "openid",
    "profile",
    "email"
  ],
  "bearer_methods_supported": [
    "header"
  ]
}
```

- Make the route public: no login, no cookie.
- The `authorization_servers` value must equal the `issuer` in AuthKit's metadata exactly. AuthKit's issuer has no trailing slash.
- On an unauthenticated request to `/mcp`, return `401` with `WWW-Authenticate: Bearer resource_metadata="https://mcp.example.com/.well-known/oauth-protected-resource/mcp"`.

WorkOS's own sample serves the document at the root path, `/.well-known/oauth-protected-resource`, with the origin as `resource`. The path-suffixed location above is the one [RFC 9728](/learn/mcp-oauth-2-1-reference#protected-resource-metadata-rfc-9728) defines for an endpoint at `/mcp`. Use the full endpoint URL consistently in the dashboard, the metadata and the verifier.

**Scopes.** AuthKit's authorize endpoint accepts `openid`, `profile`, `email` and `offline_access`, and `profile` and `email` require `openid`. CIMD and DCR clients receive these standard scopes only; you cannot assign custom scopes to them per client. `offline_access` lets a client get a refresh token, so leave it out of `scopes_supported`. The MCP specification says servers should not advertise it.

This document is configuration, not a protected server. Add it to the [complete Hono application](/learn/remote-mcp-server-with-hono) and replace that app's issuer, resource and scope settings.

## Step 4: Verify the access token

WorkOS's MCP guide verifies tokens with `jose`. For the settings above:

```typescript
import { createRemoteJWKSet, jwtVerify } from 'jose';

const ISSUER = 'https://YOUR-APP.authkit.app';
const JWKS = createRemoteJWKSet(new URL(`${ISSUER}/oauth2/jwks`));

export async function verifyAccessToken(token: string) {
  const { payload } = await jwtVerify(token, JWKS, {
    issuer: ISSUER,
    audience: 'https://mcp.example.com/mcp',
  });
  return payload;
}
```

`jwtVerify` checks the signature, expiry, issuer and audience. A token issued for another resource fails the audience check.

Scopes do not authorize your data. WorkOS says Connect scopes do not enforce the user's role-based permissions, and Connect tokens carry no permissions claim. So check authorization yourself, before each tool runs:

- Use the verified `sub` (the user) and `org_id` (the organization the user selected).
- Never trust an organization or user ID passed in tool arguments.

**Tokens and refresh.** Access tokens use the default AuthKit application's **Access token duration**, which defaults to five minutes. Public clients, including every CIMD client, get a new refresh token on each refresh. Revoking a user's AuthKit sessions does not revoke their Connect authorizations. Use the authorized-applications API for that.

**Calling your other APIs.** Your other APIs reject tokens whose `aud` is the MCP server. To call one as the signed-in user, exchange the token with WorkOS's token exchange grant. Do not forward the MCP token.

## Check discovery with curl

Set the three variables to your values, then run the commands. They need only Bash and curl.

```bash
MCP_ORIGIN='https://mcp.example.com'
MCP_PATH='/mcp'
ISSUER='https://YOUR-APP.authkit.app'

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

In the AuthKit metadata, check that:

- `issuer` equals the value in `authorization_servers` exactly.
- `code_challenge_methods_supported` includes `S256`.
- `registration_endpoint` is present if you enabled DCR, and `client_id_metadata_document_supported` is `true` if you enabled CIMD.

For browser clients, the `401` and `403` responses must also expose `WWW-Authenticate` through `Access-Control-Expose-Headers`. To run the same checks in the browser, use the [MCP OAuth checker](/tools/oauth-check).

## Test sign-in on mcptest.io

1. Open your `/mcp` URL in the [mcptest.io playground](/).
2. Start authorization. Check the discovered issuer and the registration method used.
3. Sign in as a test user, list tools, then call one read-only tool.

If automatic registration is unavailable, create a public OAuth application with the exact redirect URI `https://mcptest.io/oauth/callback`. Then enter its client ID in the playground. Never give a browser a client secret.

Then test the failure paths. None of them may run the tool:

| Request | Expected result |
| --- | --- |
| Expired token | `401` |
| Token issued for another resource | `401` |
| User from a second organization asking for the first organization's records | Denied by your authorization check |

## When sign-in works but requests fail

- **`401` right after consent.** Compare the metadata `resource`, the `resource` the client requested and the token's `aud`. The usual cause is a missing resource indicator, or a grant from before you added one. Accepting any token from the issuer is not a fix.
- **No consent screen opens.** Check client registration (Step 1) and the client's redirect URI first.
- **Custom domains.** A custom AuthKit domain changes the issuer, the JWKS URL and discovery. A custom MCP domain changes the resource. Update each one in its own place. A client ID registered with one issuer does not work with another.

Use the [401 troubleshooting guide](/learn/remote-mcp-server-401-unauthorized) to tell discovery, registration and verification failures apart.

**What was checked.** The JSON, the Bash commands and the TypeScript snippet were checked locally against `jose` 6. The tenant setup, a real authorization code exchange, refresh, consent and revocation need a WorkOS account and were not run.
