---
title: "Build a remote MCP server on Cloudflare Workers with the Agents SDK"
navTitle: Workers with the Agents SDK
summary: A tested Worker built with createMcpHandler from the agents package, with Host and Origin checks, CORS for several origins, an OAuth bearer check for a hosted identity provider, why GET /mcp answers 405 (cloudflare/agents#403), and what mcptest reported.
track: build
level: practitioner
order: 34
category: Frameworks
readingTimeMinutes: 7
lastReviewed: "2026-10-21"
metaTitle: Remote MCP Server on Cloudflare Workers (Agents SDK) | mcptest.io
metaDescription: Build a remote MCP server on Cloudflare Workers with createMcpHandler from the agents package. corsOptions, allowedHostnames, OAuth with a hosted identity provider, and the GET 405 behavior from cloudflare/agents#403.
relatedSlugs:
  - remote-mcp-server-with-hono
  - deploy-remote-mcp-server
  - mcp-server-authentication-patterns
  - mcp-406-not-acceptable-415-and-405
  - mcp-cors-headers-for-browser-clients
sourceLinks:
  - title: "Cloudflare Agents: build a remote MCP server"
    url: "https://developers.cloudflare.com/agents/guides/remote-mcp-server/"
  - title: "Cloudflare Agents: MCP handler API"
    url: "https://developers.cloudflare.com/agents/model-context-protocol/apis/handler-api/"
  - title: "Cloudflare Agents: MCP authorization"
    url: "https://developers.cloudflare.com/agents/model-context-protocol/protocol/authorization/"
  - title: "cloudflare/agents#403: MCP should handle GET requests?"
    url: "https://github.com/cloudflare/agents/issues/403"
  - title: MCP 2026-07-28 Streamable HTTP transport
    url: "https://modelcontextprotocol.io/specification/2026-07-28/basic/transports/streamable-http"
---

Cloudflare's `agents` package wraps the MCP TypeScript SDK v2 handler for Workers: it adds route matching, CORS, and `Host` and `Origin` checks, and it understands Cloudflare's OAuth provider library. Cloudflare's guide now recommends its stateless `createMcpHandler` for new servers and marks `McpAgent`, the Durable Object class most older tutorials use, as deprecated. This guide builds a complete Worker with that handler and an OAuth check against a hosted identity provider, explains the `GET` `405` that confused developers in [cloudflare/agents#403](https://github.com/cloudflare/agents/issues/403), and shows what mcptest reported.

## What was tested

| Package | Version |
| --- | --- |
| `agents` | 0.29.0 |
| `@modelcontextprotocol/server` | 2.3.1 |
| `jose` | 6.2.13 |
| `zod` | 4.6.7 |
| `wrangler` (local `workerd`) | 4.151.2 |

```bash
npm install agents @modelcontextprotocol/server jose zod
npm install -D wrangler @cloudflare/workers-types typescript
```

```json
{
  "name": "orders-mcp",
  "main": "src/index.ts",
  "compatibility_date": "2026-10-01",
  "compatibility_flags": ["nodejs_compat"]
}
```

The Agents templates enable `nodejs_compat`. This Worker also ran without the flag at this compatibility date.

## The complete Worker

```typescript
// src/index.ts
import {
  getOAuthProtectedResourceMetadataUrl,
  McpServer,
  OAuthError,
  OAuthErrorCode,
  requireBearerAuth,
  type OAuthTokenVerifier,
} from '@modelcontextprotocol/server';
import { createMcpHandler } from 'agents/mcp/server';
import { createRemoteJWKSet, jwtVerify } from 'jose';
import { z } from 'zod';

const PUBLIC_URL = new URL('https://mcp.example.com/mcp');
const ISSUER = 'https://auth.example.com';
const JWKS_URL = new URL('https://auth.example.com/.well-known/jwks.json');
const ALLOWED_ORIGINS = new Set(['https://mcptest.io', 'https://app.example.com']);

function createServer() {
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
    async ({ id }, ctx) => ({
      content: [{ type: 'text', text: `Order ${id} for ${ctx.http?.authInfo?.clientId}: shipped` }],
    })
  );
  return server;
}

const mcp = createMcpHandler(createServer, {
  route: PUBLIC_URL.pathname,
  allowedHostnames: [PUBLIC_URL.hostname],
  allowedOriginHostnames: [...ALLOWED_ORIGINS].map((origin) => new URL(origin).hostname),
  corsOptions: {
    origin: 'https://mcptest.io',
    headers: 'Content-Type, Accept, Authorization, MCP-Protocol-Version, Mcp-Method, Mcp-Name, Mcp-Session-Id, Last-Event-ID',
    exposeHeaders: 'Mcp-Session-Id, MCP-Protocol-Version, WWW-Authenticate, Retry-After',
    maxAge: 7200,
  },
});

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

// corsOptions.origin is a single string, so echo any other allowed origin.
function withRequestOrigin(request: Request, response: Response): Response {
  const origin = request.headers.get('Origin');
  const headers = new Headers(response.headers);
  headers.append('Vary', 'Origin');
  if (origin && ALLOWED_ORIGINS.has(origin)) {
    headers.set('Access-Control-Allow-Origin', origin);
    headers.set('Access-Control-Expose-Headers', 'Mcp-Session-Id, MCP-Protocol-Version, WWW-Authenticate, Retry-After');
  }
  return new Response(response.body, { status: response.status, statusText: response.statusText, headers });
}

export default {
  async fetch(request, env, ctx) {
    const url = new URL(request.url);
    if (url.pathname === `/.well-known/oauth-protected-resource${PUBLIC_URL.pathname}`) {
      return Response.json(
        { resource: PUBLIC_URL.href, authorization_servers: [ISSUER], scopes_supported: ['orders:read'] },
        { headers: { 'Access-Control-Allow-Origin': '*' } }
      );
    }
    if (url.pathname !== PUBLIC_URL.pathname || request.method === 'OPTIONS') {
      return withRequestOrigin(request, await mcp(request, env, ctx));
    }
    const auth = await authenticate(request);
    if (auth instanceof Response) return withRequestOrigin(request, auth);
    return withRequestOrigin(request, await mcp.fetch(request, { authInfo: auth }));
  },
} satisfies ExportedHandler;
```

## What the handler does for you

`createMcpHandler` from `agents/mcp/server` returns a function you can call as `mcp(request, env, ctx)` and an object method, `mcp.fetch(request, { authInfo })`, for when your own code has already authenticated the request. Both run the same checks in this order:

| Check | Default | Set here |
| --- | --- | --- |
| Path | Exactly `/mcp`; anything else gets `404` | `route` |
| `Host` | Localhost and the Worker's own `workers.dev` hostname only | `allowedHostnames` with the custom domain |
| `Origin` | Localhost, `workers.dev`, and the hostname in `corsOptions.origin` | `allowedOriginHostnames`; requests without `Origin` always pass |
| Preflight | Answered with the `corsOptions` headers | Every MCP request header listed |
| Protocol | 2026 requests to the SDK handler; 2025 requests to a stateless compatibility lane | Unchanged |

Under `wrangler dev`, the preflight returned `200` with the configured headers, a `POST` with `Origin: https://evil.example` returned `403`, a 2026 `server/discover` returned `supportedVersions: ["2026-07-28"]`, and a 2025 `initialize` returned `2025-11-25` as an SSE response.

Two CORS details are easy to miss. `corsOptions.origin` is one string that every response carries, so a browser at a second allowed origin would be rejected; `withRequestOrigin` swaps in the request's `Origin` when it is on the list. And each `corsOptions` field replaces its default as a whole. The default `exposeHeaders` is `mcp-session-id` alone, which hides `WWW-Authenticate` from browser OAuth clients until you restate it.

## The auth hook

The handler does not verify tokens. It accepts verified identity in two ways: as `authInfo` passed to `mcp.fetch`, which is what this Worker does after the SDK's `requireBearerAuth`, or from Cloudflare's `@cloudflare/workers-oauth-provider`, which sets the verified context on `ctx` before calling the handler. Tools read either through `ctx.http.authInfo`; application data from the OAuth provider's `props` is available through `getMcpAuthContext()`.

Choose by who issues tokens:

- **A hosted identity provider** such as WorkOS AuthKit, Auth0, or Stytch issues and signs the tokens. The Worker is only a resource server: verify the JWT against the provider's JWKS, check `aud`, and publish Protected Resource Metadata naming the provider, as above.
- **The Worker is its own authorization server.** `OAuthProvider` from `@cloudflare/workers-oauth-provider` implements the authorization, token, and registration endpoints and stores grants in KV. It suits servers that sign users in with an upstream service such as GitHub. Cloudflare's [authorization guide](https://developers.cloudflare.com/agents/model-context-protocol/protocol/authorization/) has the full setup.

Unauthenticated, the Worker returned this, with the CORS headers a browser needs to read it:

```http
HTTP/1.1 401 Unauthorized
Access-Control-Allow-Origin: https://app.example.com
WWW-Authenticate: Bearer error="invalid_token", error_description="Missing Authorization header", scope="orders:read", resource_metadata="http://localhost:8788/.well-known/oauth-protected-resource/mcp"
Access-Control-Expose-Headers: Mcp-Session-Id, MCP-Protocol-Version, WWW-Authenticate, Retry-After
```

## The GET 405 pitfall

In August 2025, a developer following Cloudflare's remote server guide opened [cloudflare/agents#403](https://github.com/cloudflare/agents/issues/403), "MCP should handle GET requests?". The `wrangler dev` log showed `POST /mcp 200`, then `GET /mcp 405 Method Not Allowed`, and they expected the `GET` to open a stream for server notifications. The issue was closed two days later.

The behavior is still there, by design, and still correct:

- **2025-era clients** may send `GET` to the MCP endpoint after `initialize` to open a server-to-client SSE stream. The 2025 transport specification lets a server answer `405` when it offers no such stream, and clients must carry on. The Agents handler's compatibility lane creates a fresh server per `POST`, keeps no session, and answers `GET` and `DELETE` with `405`. Requests the server pushes on its own, such as elicitation and sampling, fail immediately in that lane.
- **2026-07-28 clients** never send that `GET`. The revision removed the standalone stream; change notifications travel on a `subscriptions/listen` `POST`, and interactive input uses the `input_required` result instead of a pushed request. The 2026 path through this handler supports both.

If a 2025-era run probes the stream, mcptest records `transport.get-stream-405` as a **warning**, with the request as evidence; it lowers no score and never blocks a release. The [status-code guide](/learn/mcp-406-not-acceptable-415-and-405) shows the full exchange. Only if you must serve stateful 2025 sessions, with pushed requests or resumable streams, do you need Cloudflare's legacy handler or `McpAgent` with a Durable Object per session.

One related limit: `mcp.notify` reaches `subscriptions/listen` streams open in the same isolate only. Another isolate serving the same Worker does not see the event.

## What mcptest reported for this Worker

Run under `wrangler dev` behind a local TLS proxy, with a token minted for that URL, the headless gate scored it 89 out of 95. Core Protocol Adherence was 15 for the 2026-07-28 lifecycle, MCP Capabilities 4 of 10 because only tools are offered, Transport 15 for Streamable HTTP, Security Posture 40 for the metadata, token endpoint, and PKCE `S256`, and Performance 15. The run negotiated 2026, so it sent no `GET` and reported no `405`. The decision was **review**, from host-compatibility observations such as token refresh that depend on the identity provider.

## Worker pitfalls

- **A custom domain without `allowedHostnames`.** The default `Host` allowlist only has localhost and `workers.dev`. Custom domains rely on Cloudflare routing unless you set the option; set it.
- **Fetching at module scope.** Workers block network I/O during global initialization. `createRemoteJWKSet` fetches on first use, which is safe; `await fetch(...)` at the top of the module is not.
- **Edge rules before the Worker.** A WAF or rate-limiting rule answers `403` or `429` without your CORS headers, so a browser client reports a network error. See [Deploying a remote MCP server](/learn/deploy-remote-mcp-server#cloudflare-workers).

## Check the deployed Worker

After `npx wrangler deploy`, open the custom-domain URL in the [MCP Playground](/) to sign in from the browser, confirm the preflight and `401` are readable, and call `get-order`. Then add the same URL to the [release gate](/learn/test-mcp-server-before-deploying#run-the-same-checks-in-ci) in CI.
