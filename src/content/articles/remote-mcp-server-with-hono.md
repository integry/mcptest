---
title: "Build a remote MCP server with Hono, on Node, Bun, or Cloudflare Workers"
navTitle: Remote server with Hono
summary: One tested Hono file that serves MCP with the SDK v2 adapter, CORS, and an OAuth bearer check, and runs unchanged on Node.js, Bun, and Cloudflare Workers, with the runtime-specific pitfalls for each.
track: build
level: practitioner
order: 31
category: Frameworks
readingTimeMinutes: 6
lastReviewed: "2026-10-21"
metaTitle: Remote MCP Server with Hono (Workers, Bun, Node) | mcptest.io
metaDescription: Build a remote MCP server with Hono and the TypeScript SDK v2. createMcpHonoApp, requireBearerAuth on a fetch handler, CORS, and deployment notes for Cloudflare Workers and Bun.
relatedSlugs:
  - remote-mcp-server-with-express
  - remote-mcp-server-with-cloudflare-workers-agents
  - mcp-server-authentication-patterns
  - mcp-cors-headers-for-browser-clients
  - deploy-remote-mcp-server
sourceLinks:
  - title: "TypeScript SDK v2: serve with Hono"
    url: "https://ts.sdk.modelcontextprotocol.io/v2/serving/hono"
  - title: "TypeScript SDK v2: require authorization"
    url: "https://ts.sdk.modelcontextprotocol.io/v2/serving/authorization"
  - title: "Hono: CORS middleware"
    url: "https://hono.dev/docs/middleware/builtin/cors"
  - title: "Hono: Cloudflare Workers"
    url: "https://hono.dev/docs/getting-started/cloudflare-workers"
  - title: "Hono: Bun"
    url: "https://hono.dev/docs/getting-started/bun"
  - title: "Bun: HTTP server (idleTimeout)"
    url: "https://bun.com/docs/api/http"
---

Hono runs on every major JavaScript runtime through the web-standard `fetch(request)` interface, and so does the MCP TypeScript SDK v2. That makes it the shortest path to one MCP server you can run locally on Node.js, ship to Cloudflare Workers, or serve from Bun without touching the code. This guide builds that server with CORS and an OAuth bearer check, then covers what differs on each runtime. The same file was type-checked once and run on all three.

## What was tested

| Package or runtime | Version |
| --- | --- |
| `@modelcontextprotocol/server` | 2.3.1 |
| `@modelcontextprotocol/hono` | 2.0.2 |
| `hono` | 4.13.13 |
| `jose` | 6.2.13 |
| `zod` | 4.6.7 |
| Node.js with `@hono/node-server` | 22.23 with 2.1.5 |
| Bun | 1.4.3 |
| Cloudflare Workers, local `workerd` through `wrangler dev` | Wrangler 4.151.2 |

```bash
npm install @modelcontextprotocol/server @modelcontextprotocol/hono hono jose zod
```

## The complete app

```typescript
// app.ts
import { createMcpHonoApp } from '@modelcontextprotocol/hono';
import {
  createMcpHandler,
  getOAuthProtectedResourceMetadataUrl,
  McpServer,
  OAuthError,
  OAuthErrorCode,
  requireBearerAuth,
  type AuthInfo,
  type OAuthTokenVerifier,
} from '@modelcontextprotocol/server';
import type { Context } from 'hono';
import { cors } from 'hono/cors';
import { createRemoteJWKSet, jwtVerify } from 'jose';
import { z } from 'zod';

const PUBLIC_URL = new URL('https://mcp.example.com/mcp');
const ISSUER = 'https://auth.example.com';
const JWKS_URL = new URL('https://auth.example.com/.well-known/jwks.json');
const ALLOWED_ORIGINS = ['https://mcptest.io', 'https://app.example.com'];

function buildServer() {
  const server = new McpServer({ name: 'orders', version: '1.0.0' });
  server.registerTool(
    'get-order',
    {
      description: 'Look up one order by its id and return its shipping status',
      inputSchema: z.strictObject({
        id: z.string().regex(/^ord_[a-z0-9]{1,32}$/).describe('Order id, for example ord_123'),
      }),
      annotations: { readOnlyHint: true },
    },
    async ({ id }) => ({ content: [{ type: 'text', text: `Order ${id}: shipped` }] })
  );
  return server;
}

const jwks = createRemoteJWKSet(JWKS_URL);
const verifier: OAuthTokenVerifier = {
  async verifyAccessToken(token) {
    try {
      const { payload } = await jwtVerify(token, jwks, { issuer: ISSUER, audience: PUBLIC_URL.href });
      return {
        token,
        clientId: String(payload.client_id ?? payload.azp ?? payload.sub),
        scopes: typeof payload.scope === 'string' ? payload.scope.split(' ') : [],
        expiresAt: payload.exp,
        resource: PUBLIC_URL,
      };
    } catch (error) {
      throw new OAuthError(OAuthErrorCode.InvalidToken, (error as Error).message);
    }
  },
};

const authenticate = requireBearerAuth({
  verifier,
  expectedResource: PUBLIC_URL,
  requiredScopes: ['orders:read'],
  resourceMetadataUrl: getOAuthProtectedResourceMetadataUrl(PUBLIC_URL),
});
const handler = createMcpHandler(buildServer);

const app = createMcpHonoApp({
  host: '0.0.0.0',
  allowedHosts: [PUBLIC_URL.hostname],
  allowedOrigins: ALLOWED_ORIGINS.map((origin) => new URL(origin).hostname),
});

app.use(
  '*',
  cors({
    origin: ALLOWED_ORIGINS,
    allowMethods: ['GET', 'POST', 'DELETE', 'OPTIONS'],
    allowHeaders: [
      'Content-Type', 'Accept', 'Authorization',
      'MCP-Protocol-Version', 'Mcp-Method', 'Mcp-Name',
      'Mcp-Session-Id', 'Last-Event-ID',
    ],
    exposeHeaders: ['Mcp-Session-Id', 'MCP-Protocol-Version', 'WWW-Authenticate', 'Retry-After'],
    maxAge: 7200,
  })
);

app.get('/.well-known/oauth-protected-resource/mcp', (c) =>
  c.json({
    resource: PUBLIC_URL.href,
    authorization_servers: [ISSUER],
    scopes_supported: ['orders:read'],
    bearer_methods_supported: ['header'],
  })
);

app.all('/mcp', async (c: Context) => {
  const auth: AuthInfo | Response = await authenticate(c.req.raw);
  if (auth instanceof Response) return auth;
  return handler.fetch(c.req.raw, { parsedBody: c.get('parsedBody'), authInfo: auth });
});

export default app;
```

## How the pieces fit

**`createMcpHonoApp`** returns a `Hono` instance with `Host` and `Origin` validation and a JSON body parser that stores the body as `parsedBody`. Like the Express adapter, its default `host` of `127.0.0.1` accepts only localhost `Host` headers. On any public deployment, set `host: '0.0.0.0'` and list the real hostname in `allowedHosts`, including the `workers.dev` hostname if clients use it.

**The auth hook is the runtime-neutral `requireBearerAuth`** from `@modelcontextprotocol/server`, not a Hono middleware. It takes a web `Request` and resolves either to the verified `AuthInfo` or to a ready-made `Response`: `401` with a `WWW-Authenticate` challenge pointing at the metadata document, or `403 insufficient_scope`. Passing the `AuthInfo` as `{ authInfo }` makes it available to tools as `ctx.http.authInfo`. Hono's own `bearerAuth` middleware compares against fixed tokens and does not emit `resource_metadata`, so clients cannot start OAuth from its challenge.

**The metadata route** is a plain JSON response. `authorization_servers` lists your identity provider's issuer, and `resource` must be the exact public URL with its path. Clients read it from `resource_metadata` in the challenge or probe `/.well-known/oauth-protected-resource/mcp` directly.

**`cors()` is registered on `*`**, so it covers the metadata route and decorates `401` responses. It also answers preflights before the `/mcp` handler runs, which matters because a preflight never carries `Authorization`. The `Context` annotation on the `/mcp` route is what lets `c.get('parsedBody')` type-check; the adapter does not declare its variables on the app type.

The handler is stateless: 2026 clients use `server/discover`, 2025 clients get a per-request `initialize`, and `GET /mcp` answers `405`.

## Run it on Node.js

```typescript
// node.ts
import { serve } from '@hono/node-server';
import app from './app.js';

serve({ fetch: app.fetch, port: Number(process.env.PORT ?? 3000) });
```

Run it with `npx tsx node.ts`. Behind a TLS proxy and against a local identity provider, the headless mcptest gate scored this server 89 out of 95: 15 for the 2026-07-28 lifecycle, 4 of 10 for capabilities because it offers tools but no resources or prompts, 15 for Streamable HTTP, 40 for the OAuth metadata and PKCE `S256`, and 15 for performance. The decision was **review**, driven by host-compatibility observations such as token refresh that one run cannot establish.

## Deploy to Cloudflare Workers

The same `app.ts` is the Worker entry point. A minimal `wrangler.jsonc`:

```json
{
  "name": "orders-mcp",
  "main": "app.ts",
  "compatibility_date": "2026-10-01"
}
```

Under `wrangler dev`, the Worker answered the 2026 `server/discover`, the 2025 `initialize`, the preflight, and the `401` challenge exactly as Node did, and an SDK client completed `tools/list` and `tools/call` with a token. Things to know on Workers:

- **No `process.env`.** That is why the configuration above is in constants. To configure per environment, read `c.env` inside the route and build the verifier lazily, or keep constants and use one Worker per environment.
- **Do not fetch at module scope.** Workers refuse network I/O during global initialization. `createRemoteJWKSet` fetches lazily on the first verification and caches keys in the isolate, so it is safe at module scope; a top-level `await fetch(...)` is not.
- **The `workers.dev` hostname is a second host.** Add it to `allowedHosts` if you publish it, or the `Host` check answers `403`.
- **Edge rules answer before your code.** A WAF or rate-limit rule returns its own `403` or `429` without your CORS headers, so a browser reports a network error.

If you want the Cloudflare-managed handler with built-in CORS and `Host` checks instead of Hono, see [Build a remote MCP server on Cloudflare Workers with the Agents SDK](/learn/remote-mcp-server-with-cloudflare-workers-agents).

## Run it on Bun

Bun serves a module whose default export has a `fetch` method, so `bun run app.ts` starts the same app on port 3000, or on `PORT` if it is set. Bun 1.4.3 served the same requests and tool call as Node and Workers.

One default needs changing. `Bun.serve` closes a connection after **10 seconds** with no data. A test tool that waited 15 seconds before answering had its response cut off at about 10 seconds with no status code, while the same tool completed with `idleTimeout` raised:

```typescript
// bun.ts
import app from './app.js';

export default { fetch: app.fetch, idleTimeout: 120 };
```

The value is in seconds and the maximum is 255. Long tool calls should also emit progress notifications, which upgrade the response to SSE and keep bytes flowing.

## Check the deployment

Before you give clients the URL, confirm these against the deployed host, not just locally:

1. `POST /mcp` without a token returns `401` with `resource_metadata` pointing at your public hostname, not at `localhost` or an internal name.
2. `GET /.well-known/oauth-protected-resource/mcp` returns your public `resource` URL.
3. An `OPTIONS` preflight from an allowed origin returns `204` with `Authorization` and `Mcp-Method` in `Access-Control-Allow-Headers`.
4. A token minted for a different `aud` returns `401`, not `200`.

The [CORS reference](/learn/mcp-cors-headers-for-browser-clients#check-the-headers-without-a-browser) has the exact `curl` commands.

## Test it in the playground

Open the deployed endpoint in the [MCP Playground](/) to sign in through your identity provider from the browser and get the Web Client Accessibility score the headless run cannot measure, then add the [release gate](/learn/test-mcp-server-before-deploying#run-the-same-checks-in-ci) to your deploy pipeline.
