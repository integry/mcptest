---
title: "Build a remote MCP server in Next.js with route handlers and mcp-handler"
navTitle: Remote server with Next.js
summary: A tested Next.js App Router MCP server built with mcp-handler 2.x, with OAuth through withMcpAuth, the protected resource metadata route, Origin checks and CORS that mcp-handler leaves to you, and what mcptest reported for it.
track: build
level: practitioner
order: 33
category: Frameworks
readingTimeMinutes: 6
lastReviewed: "2026-10-21"
metaTitle: Remote MCP Server in Next.js (mcp-handler v2) | mcptest.io
metaDescription: Build a remote MCP server in a Next.js route handler with mcp-handler 2.x and the MCP SDK v2. withMcpAuth, protectedResourceHandler, CORS and OPTIONS, Origin validation, and the checks mcptest runs.
relatedSlugs:
  - remote-mcp-server-with-hono
  - mcp-server-authentication-patterns
  - deploy-remote-mcp-server
  - mcp-cors-headers-for-browser-clients
  - test-mcp-server-before-deploying
sourceLinks:
  - title: "Vercel docs: deploy MCP servers to Vercel"
    url: "https://vercel.com/docs/mcp/deploy-mcp-servers-to-vercel"
  - title: "mcp-handler (vercel-labs) README and authorization guide"
    url: "https://github.com/vercel-labs/mcp-handler"
  - title: "Next.js: route.js file convention"
    url: "https://nextjs.org/docs/app/api-reference/file-conventions/route"
  - title: MCP 2026-07-28 authorization
    url: "https://modelcontextprotocol.io/specification/2026-07-28/basic/authorization"
---

In a Next.js app, an MCP server is a route handler. Vercel's documentation still points to `mcp-handler` from Vercel Labs for this, and version 2 is built on the official TypeScript SDK v2, so the same handler serves 2026-07-28 clients natively and 2025 clients through a stateless fallback. This guide builds a complete server with OAuth, CORS, and `Origin` checks, the parts the package does not do for you. It was built with `next build`, served with `next start`, and checked with mcptest.

## What was tested

| Package | Version |
| --- | --- |
| `next` | 16.4.2 |
| `react`, `react-dom` | 19.3.1 |
| `mcp-handler` | 2.3.0 |
| `@modelcontextprotocol/server` | 2.3.1 |
| `jose` | 6.2.13 |
| `zod` | 4.6.7 |

```bash
npm install mcp-handler@^2 @modelcontextprotocol/server@^2 zod@^4 jose
```

`mcp-handler` 2.x needs Node.js 20 or later and Next.js 13 or later. If your project still uses `@modelcontextprotocol/sdk` 1.x, stay on `mcp-handler` 1.x until you migrate; the 2.x `inputSchema` takes a full schema such as `z.object(...)`, not a raw shape, and its Redis-backed SSE transport is gone.

## Three files

The server lives at `/mcp`, so clients get `https://mcp.example.com/mcp`. Vercel's examples use `/api/mcp`; the package does not inspect the path, so either works as long as the metadata names the same URL.

### Token verification

```typescript
// lib/auth.ts
import { createRemoteJWKSet, jwtVerify } from 'jose';
import type { AuthInfo } from '@modelcontextprotocol/server';

export const PUBLIC_URL = process.env.MCP_PUBLIC_URL ?? 'https://mcp.example.com/mcp';
export const ISSUER = process.env.OAUTH_ISSUER ?? 'https://auth.example.com';
const jwks = createRemoteJWKSet(new URL(process.env.OAUTH_JWKS_URL ?? 'https://auth.example.com/.well-known/jwks.json'));

export async function verifyToken(_req: Request, bearerToken?: string): Promise<AuthInfo | undefined> {
  if (!bearerToken) return undefined;
  try {
    const { payload } = await jwtVerify(bearerToken, jwks, { issuer: ISSUER, audience: PUBLIC_URL });
    return {
      token: bearerToken,
      clientId: String(payload.client_id ?? payload.azp ?? payload.sub),
      scopes: typeof payload.scope === 'string' ? payload.scope.split(' ') : [],
      expiresAt: payload.exp,
      resource: new URL(PUBLIC_URL),
    };
  } catch {
    return undefined;
  }
}
```

### The MCP route

```typescript
// app/mcp/route.ts
import { originValidationResponse } from '@modelcontextprotocol/server';
import { createMcpHandler, withMcpAuth } from 'mcp-handler';
import { z } from 'zod';
import { PUBLIC_URL, verifyToken } from '../../lib/auth';

const ALLOWED_ORIGINS = ['https://mcptest.io', 'https://app.example.com'];

const mcp = createMcpHandler(
  (server) => {
    server.registerTool(
      'get-order',
      {
        description: 'Look up one order by its id and return its shipping status',
        inputSchema: z.strictObject({
          id: z.string().regex(/^ord_[a-z0-9]{1,32}$/).describe('Order id, for example ord_123'),
        }),
        annotations: { readOnlyHint: true },
      },
      async ({ id }, ctx) => ({
        content: [{ type: 'text', text: `Order ${id} for ${ctx.http?.authInfo?.clientId}: shipped` }],
      })
    );
  },
  { serverInfo: { name: 'orders', version: '1.0.0' } }
);

const authed = withMcpAuth(mcp, verifyToken, {
  required: true,
  requiredScopes: ['orders:read'],
  resourceUrl: new URL(PUBLIC_URL).origin,
  resourceMetadataPath: '/.well-known/oauth-protected-resource/mcp',
});

function withCors(request: Request, response: Response): Response {
  const origin = request.headers.get('Origin');
  const headers = new Headers(response.headers);
  headers.append('Vary', 'Origin');
  if (origin && ALLOWED_ORIGINS.includes(origin)) {
    headers.set('Access-Control-Allow-Origin', origin);
    headers.set('Access-Control-Allow-Methods', 'GET, POST, DELETE, OPTIONS');
    headers.set(
      'Access-Control-Allow-Headers',
      'Content-Type, Accept, Authorization, MCP-Protocol-Version, Mcp-Method, Mcp-Name, Mcp-Session-Id, Last-Event-ID'
    );
    headers.set('Access-Control-Expose-Headers', 'Mcp-Session-Id, MCP-Protocol-Version, WWW-Authenticate, Retry-After');
    headers.set('Access-Control-Max-Age', '7200');
  }
  return new Response(response.body, { status: response.status, statusText: response.statusText, headers });
}

async function handle(request: Request): Promise<Response> {
  const rejected = originValidationResponse(request, ALLOWED_ORIGINS.map((o) => new URL(o).hostname));
  return withCors(request, rejected ?? (await authed(request)));
}

export const maxDuration = 60;
export { handle as GET, handle as POST, handle as DELETE };
export async function OPTIONS(request: Request) {
  return withCors(request, new Response(null, { status: 204 }));
}
```

### The protected resource metadata route

```typescript
// app/.well-known/oauth-protected-resource/mcp/route.ts
import { metadataCorsOptionsRequestHandler, protectedResourceHandler } from 'mcp-handler';
import { ISSUER, PUBLIC_URL } from '../../../../lib/auth';

const handler = protectedResourceHandler({ authServerUrls: [ISSUER], resourceUrl: PUBLIC_URL });
const options = metadataCorsOptionsRequestHandler();

export { handler as GET, options as OPTIONS };
```

`next build` listed both as dynamic routes, `ƒ /mcp` and `ƒ /.well-known/oauth-protected-resource/mcp`. A folder whose name starts with a dot is an ordinary route segment in the App Router.

## What each part does, and what it does not

**`createMcpHandler` from `mcp-handler`** is not the SDK function of the same name. It takes a callback that receives a fresh `McpServer` for each request, plus one options object with `serverInfo`. It returns a `(request: Request) => Promise<Response>`, so it can be exported as a route method directly. It serves `server/discover` for 2026 clients and a stateless `initialize` for 2025 clients; `GET` returns `405`, and there is no session to keep.

**`withMcpAuth`** is the auth hook. It extracts the bearer token, calls `verifyToken`, and returns `401` with a `resource_metadata` challenge when `required` is true and no `AuthInfo` comes back, or `403 insufficient_scope` when a required scope is missing. Three details matter:

- **It does not check the audience.** Unlike the SDK's `requireBearerAuth`, there is no `expectedResource` option, so `verifyToken` must reject tokens issued for another resource. The `audience: PUBLIC_URL` in `jwtVerify` does that; a token minted for another `aud` got `401`.
- **It only checks expiry when `expiresAt` is set.** Always return it.
- **`resourceUrl` is an origin, not the resource.** The challenge URL is built as `resourceUrl + resourceMetadataPath`. Passing the full `https://mcp.example.com/mcp` produces `https://mcp.example.com/mcp/.well-known/oauth-protected-resource/mcp`, which does not exist. Without `resourceUrl`, the origin comes from `X-Forwarded-Host` and `X-Forwarded-Proto`, which is right on Vercel but often wrong behind other proxies.

**`protectedResourceHandler`** serves RFC 9728 metadata with permissive CORS. With an explicit `resourceUrl` it returned only `resource` and `authorization_servers`, for example `{"resource":"https://mcp.example.com/mcp","authorization_servers":["https://auth.example.com"]}`. Vercel's documentation places this route at the root `/.well-known/oauth-protected-resource`; that also works, because the challenge carries the exact metadata URL and clients fall back to the root location. The path-inserted form above is the one RFC 9728 clients try first.

**`Origin` validation is your job.** `mcp-handler` performs no `Host` or `Origin` check, so the route calls the SDK's `originValidationResponse` first. A `POST` with `Origin: https://evil.example` returned `403`; requests without an `Origin`, from desktop and CLI clients, pass.

**The `OPTIONS` export is required for browsers.** Without it, Next.js answers the preflight itself. A test route with only `POST` returned `204` with `allow: OPTIONS, POST` and no `Access-Control-*` headers, so a browser blocks the request. The `withCors` wrapper also decorates `401` responses, which is what lets a browser client read `WWW-Authenticate`.

## What mcptest reported for this server

Served by `next start` behind a local TLS proxy, with a token minted for that URL, the headless gate scored it 89 out of 95. Core Protocol Adherence was 15 for the stateless 2026-07-28 lifecycle, MCP Capabilities 4 of 10 because only `tools/list` exists, Transport 15 for Streamable HTTP, Security Posture 40 for the metadata, token endpoint, and PKCE `S256`, and Performance 15. The decision was **review** because of unknown host-compatibility observations, such as refresh-token support, that need the identity provider's configuration to settle. A `curl` check through the same proxy showed the challenge clients see:

```http
HTTP/1.1 401 Unauthorized
www-authenticate: Bearer error="invalid_token", error_description="No authorization provided", scope="orders:read", resource_metadata="https://localhost:8443/.well-known/oauth-protected-resource/mcp"
```

## Next.js and Vercel pitfalls

- **An auth proxy that redirects.** Next.js 16 renamed `middleware.ts` to `proxy.ts`. If it protects every route with a session check, MCP clients get a `302` to your login page instead of a `401`, and never start OAuth. Exclude `/mcp` and `/.well-known/` from its `matcher`.
- **`maxDuration`.** A route's function stops at its maximum duration. Set it to the longest tool call you support within your plan's limit.
- **Preview deployments behind Vercel Authentication.** A protected preview answers with Vercel's own authentication response, not MCP. Test the production domain or configure a protection bypass for automation. [Deploying a remote MCP server](/learn/deploy-remote-mcp-server#vercel) covers this and the catch-all rewrite that turns `GET /mcp` into an HTML page.

## Run it against your preview

Deploy, then paste the production URL into the [MCP Playground](/) to complete OAuth in the browser and see the Web Client Accessibility result, or run the [release gate](/learn/test-mcp-server-before-deploying#run-the-same-checks-in-ci) from CI with a bearer token before you promote the deployment.
