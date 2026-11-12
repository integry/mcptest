---
title: "Secure a remote MCP server with Clerk OAuth 2.1"
navTitle: "MCP authorization with Clerk"
summary: "Use Clerk as an MCP authorization server: register the MCP server URL, enable CIMD or DCR, publish protected resource metadata, and verify OAuth tokens with an audience and scope check."
track: "build"
level: "practitioner"
order: 405
category: "Authorization"
readingTimeMinutes: 7
lastReviewed: "2026-11-11"
metaTitle: "MCP authorization with Clerk | mcptest.io"
metaDescription: "Use Clerk as an MCP authorization server: register the MCP server URL, enable CIMD or DCR, publish protected resource metadata, and verify OAuth tokens with an audience and scope check."
relatedSlugs:
  - mcp-oauth-2-1-reference
  - mcp-server-authentication-patterns
  - remote-mcp-server-with-nextjs
  - remote-mcp-server-401-unauthorized
sourceLinks:
  - title: "MCP: authorization specification"
    url: "https://modelcontextprotocol.io/specification/2026-07-28/basic/authorization"
  - title: "Clerk: build an MCP server"
    url: "https://clerk.com/docs/nextjs/guides/ai/mcp/build-mcp-server"
  - title: "Clerk: OAuth implementation and client onboarding"
    url: "https://clerk.com/docs/guides/configure/auth-strategies/oauth/how-clerk-implements-oauth"
  - title: "Clerk: Client ID Metadata Documents"
    url: "https://clerk.com/docs/guides/configure/auth-strategies/oauth/client-id-metadata-documents"
  - title: "Clerk: verify OAuth access tokens"
    url: "https://clerk.com/docs/nextjs/guides/development/verifying-oauth-access-tokens"
---

Clerk's OAuth server lets an MCP client get delegated access to your application's users. This is different from signing users in to your website with a session cookie. Your MCP endpoint must accept only OAuth access tokens issued for it, and check their scopes on every tool call.

This guide follows Clerk's [Build an MCP server](https://clerk.com/docs/nextjs/guides/ai/mcp/build-mcp-server) guide for Next.js and was checked against it on **11 November 2026**. For the protocol rules, see the [OAuth 2.1 reference](/learn/mcp-oauth-2-1-reference).

## Before you start

- A Clerk application with your framework's quickstart completed. Clerk's MCP guide requires Node.js 22.18 or later.
- The exact URL of your MCP endpoint. For local work, Clerk uses `http://localhost:3000/mcp` on a development instance. For a hosted server, use the full HTTPS URL, such as `https://mcp.example.com/mcp`.
- Your Clerk Frontend API URL. It is the issuer: `https://YOUR-INSTANCE.clerk.accounts.dev` for a development instance, or `https://clerk.example.com` in production.

Use one URL for the MCP endpoint everywhere: Clerk setup, client configuration, metadata and the token audience check. Clerk's guide uses `/mcp` with no query string and no trailing slash.

## Step 1: Register the MCP server in Clerk

1. In the Clerk Dashboard, open **Agents → MCP servers** and select **Add MCP server** (or **Get started** for your first server).
2. Enter the full endpoint in **MCP URL** and select **Add server**.

When you add your first MCP server, Clerk turns on audience (`aud`) claims in OAuth access tokens. This is what lets your server reject tokens issued for something else. If you select **Allow public clients to connect**, the Dashboard also turns on CIMD support. Existing client restrictions and the instance-wide PKCE setting stay unchanged.

You can do the same step from a coding agent with Clerk's MCP server: call `configure_mcp_server` with `application_id`, `instance` and `resource_url`. Pass `dry_run: true` first to preview. Add localhost URLs through the Dashboard instead.

## Step 2: Choose how clients register

MCP clients usually have no client ID for your app in advance. Configure this under **OAuth applications → Settings → Client onboarding**:

- **Publish CIMD support.** With a Client ID Metadata Document (CIMD), the client ID is an HTTPS URL that serves the client's metadata. Clerk treats every CIMD client as a public client, requires PKCE with `S256`, and always shows the consent screen. This setting is off by default. **Client admission** then controls who may connect: any compatible CIMD client (the default), only pre-registered and previously connected clients, or only pre-registered clients.
- **Publish DCR support.** Enable this only for clients that need [Dynamic Client Registration](/learn/mcp-glossary#dynamic-client-registration). With DCR on, the consent screen is always enforced. Clerk recommends CIMD, because it does not expose an unauthenticated registration endpoint.
- **Default scopes for dynamic clients.** Clerk applies these scopes when a CIMD or DCR client omits `scope`. Keep them narrow.

CIMD clients need a reachable consent page. Keep the Account Portal enabled, or configure your own OAuth consent page. OAuth applications on Clerk's legacy OAuth implementation do not support CIMD.

**PKCE for other clients.** Under **OAuth applications → Settings → Authorization security**, **Require PKCE** enforces PKCE for every manually and dynamically registered application. It is on by default for new instances.

**A pre-registered client.** If you do not allow automatic onboarding, create an OAuth application by hand. Turn on **Public** so it can exchange the code without a secret, and turn on **Require PKCE** for it, because **Public** does not enforce PKCE by itself. Register its exact redirect URI.

## Step 3: Pick scopes and the token format

Clerk's built-in scopes include `openid`, `profile`, `email`, `public_metadata`, `private_metadata` and `offline_access`, plus `user:org:read` when Organizations is enabled. Clerk's MCP guide requires `profile` and `email` for a tool that returns the user's profile.

For your own data, create a custom scope such as `orders:read` on the **Scopes** tab, and assign it only to the applications that need it. A verified token tells you who the user is. It does not grant access to every organization or record, so check that inside each tool.

Clerk issues OAuth access tokens as JWTs by default. Under **Access token format** you can switch to opaque tokens, which can be revoked immediately. The verifier below handles both.

## Step 4: Verify tokens with an audience check

Install the packages Clerk's guide uses:

```bash
npm install @clerk/backend @clerk/mcp-tools mcp-handler @modelcontextprotocol/server
```

Then verify each request with `authenticateRequest`. This is the core of Clerk's `lib/mcp-auth.ts`:

```typescript
// lib/mcp-auth.ts
import { createClerkClient } from '@clerk/backend';
import { verifyClerkToken } from '@clerk/mcp-tools/server';

export const MCP_RESOURCE_URL = 'https://mcp.example.com/mcp';
export const REQUIRED_SCOPES = ['profile', 'email'];

const clerkClient = createClerkClient({
  secretKey: process.env.CLERK_SECRET_KEY,
  publishableKey: process.env.CLERK_PUBLISHABLE_KEY ?? process.env.NEXT_PUBLIC_CLERK_PUBLISHABLE_KEY,
});

export async function verifyMcpToken(request: Request) {
  const requestState = await clerkClient.authenticateRequest(request, {
    acceptsToken: 'oauth_token',
    audience: MCP_RESOURCE_URL,
  });
  if (!requestState.isAuthenticated) return undefined;
  return verifyClerkToken(requestState.toAuth(), requestState.token);
}
```

- `acceptsToken: 'oauth_token'` accepts only OAuth access tokens issued by your instance. By default, Clerk accepts session tokens and rejects OAuth tokens.
- `audience` makes Clerk check that the token's `aud` includes your MCP URL, and reject tokens with no audience. Always pass it. Without it, the audience is not checked.
- `verifyClerkToken` returns the token's `clientId`, `scopes` and the user ID in `extra.userId`.

Clerk's guide wraps the MCP route with `withMcpAuth` from `mcp-handler`, passing `required: true`, `requiredScopes: REQUIRED_SCOPES` and `resourceMetadataPath: '/.well-known/oauth-protected-resource/mcp'`. The wrapper answers `401` with a `WWW-Authenticate` challenge when the token is missing or invalid. Use the guide's files together. Copying only the auth wrapper into another server can leave the discovery routes or the scope check out.

## Step 5: Publish protected resource metadata

Clerk's guide serves the metadata from `app/.well-known/oauth-protected-resource/mcp/route.ts` with `protectedResourceHandlerClerk({ resource: MCP_RESOURCE_URL, scopes_supported: REQUIRED_SCOPES })`. On another framework, serve the equivalent JSON at `https://mcp.example.com/.well-known/oauth-protected-resource/mcp`:

```json
{
  "resource": "https://mcp.example.com/mcp",
  "authorization_servers": [
    "https://YOUR-INSTANCE.clerk.accounts.dev"
  ],
  "scopes_supported": [
    "profile",
    "email"
  ],
  "bearer_methods_supported": [
    "header"
  ]
}
```

Keep the `.well-known` routes public. Clerk's guide also adds `app/.well-known/oauth-authorization-server/route.ts` with `authServerMetadataHandlerClerk()`, which serves Clerk's authorization server metadata from your origin for clients that look for it there.

## Check discovery with curl

Set the three variables to your values, then run the commands. They need only Bash and curl.

```bash
MCP_ORIGIN='https://mcp.example.com'
MCP_PATH='/mcp'
ISSUER='https://YOUR-INSTANCE.clerk.accounts.dev'

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

In Clerk's metadata, check that:

- `issuer` equals the value in `authorization_servers` exactly.
- `code_challenge_methods_supported` includes `S256`.
- `client_id_metadata_document_supported` is `true` if you enabled CIMD. Clerk omits the field otherwise.
- `registration_endpoint` is present if you enabled DCR.

For hosted servers, the Clerk Dashboard also runs connection checks. Fix any reported issue, then select **Re-test connection**. To run the same discovery checks in the browser, use the [MCP OAuth checker](/tools/oauth-check).

## Test sign-in on mcptest.io

1. Open your hosted `/mcp` URL in the [mcptest.io playground](/). For a localhost server, Clerk recommends a client on the same machine.
2. Start authorization. Check the discovered issuer and the registration method used.
3. Sign in as a test user, approve access, list tools, and call one read-only tool.

If automatic registration is off, create a public OAuth application with the exact redirect URI `https://mcptest.io/oauth/callback`, and enter its client ID in the playground. Never give a browser a client secret.

Then test the failure paths. None of them may run the tool:

| Request | Expected result |
| --- | --- |
| Expired token | `401` |
| Token issued for another resource, or a session token | `401` |
| Valid token without a required scope | `403` with `insufficient_scope` |

Use the [401 troubleshooting guide](/learn/remote-mcp-server-401-unauthorized) to tell discovery, registration and verification failures apart.

**What was checked.** The function names and import paths were checked against the published `@clerk/mcp-tools` 0.9.0 and `mcp-handler` 2.3.1 packages, and the JSON and Bash syntax locally. The tenant setup, a real authorization code exchange, refresh, consent and revocation need a Clerk account and were not run.
