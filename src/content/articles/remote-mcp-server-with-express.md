---
title: "Build a remote MCP server with Express"
navTitle: Remote server with Express
summary: A complete, tested Express server for MCP with the official SDK v2 adapters, Host and Origin checks, CORS, an OAuth bearer check against a hosted identity provider, and the result mcptest reports for it.
track: build
level: practitioner
order: 30
category: Frameworks
readingTimeMinutes: 7
lastReviewed: "2026-10-21"
metaTitle: Remote MCP Server with Express (SDK v2) | mcptest.io
metaDescription: Build a remote MCP server with Express and the TypeScript SDK v2. createMcpExpressApp, toNodeHandler, CORS, requireBearerAuth with JWT verification, and the checks mcptest runs on it.
relatedSlugs:
  - remote-mcp-server-with-hono
  - mcp-server-authentication-patterns
  - mcp-cors-headers-for-browser-clients
  - deploy-remote-mcp-server
  - test-mcp-server-before-deploying
sourceLinks:
  - title: "TypeScript SDK v2: serve with Express"
    url: "https://ts.sdk.modelcontextprotocol.io/v2/serving/express"
  - title: "TypeScript SDK v2: require authorization"
    url: "https://ts.sdk.modelcontextprotocol.io/v2/serving/authorization"
  - title: "Express: cors middleware"
    url: "https://expressjs.com/en/resources/middleware/cors.html"
  - title: "jose: createRemoteJWKSet and jwtVerify"
    url: "https://github.com/panva/jose"
  - title: MCP 2026-07-28 authorization
    url: "https://modelcontextprotocol.io/specification/2026-07-28/basic/authorization"
---

Express is still the most common way to put an MCP server on the internet, and the TypeScript SDK v2 ships an adapter package for it. This guide builds one complete server: a read-only tool, `Host` and `Origin` validation, CORS for browser clients, and an OAuth bearer check against a hosted identity provider. Every line below was type-checked and run, and the last section shows the exact result mcptest reported for it.

## What was tested

| Package | Version |
| --- | --- |
| `@modelcontextprotocol/server` | 2.3.1 |
| `@modelcontextprotocol/express` | 2.0.2 |
| `@modelcontextprotocol/node` | 2.1.1 |
| `express` | 5.3.0 |
| `cors` | 2.8.6 |
| `jose` | 6.2.13 |
| `zod` | 4.6.7 |

The server ran on Node.js 22 with `tsx`, against a local identity provider that serves RFC 8414 metadata and a JWKS, and signs RS256 access tokens.

```bash
npm install @modelcontextprotocol/server @modelcontextprotocol/express @modelcontextprotocol/node express cors jose zod
npm install -D typescript tsx @types/express @types/cors @types/node
```

The file uses top-level `await`, so set `"type": "module"` in `package.json` and `"module": "NodeNext"` in `tsconfig.json`.

## The complete server

```typescript
// server.ts
import cors from 'cors';
import {
  createMcpExpressApp,
  getOAuthProtectedResourceMetadataUrl,
  mcpAuthMetadataRouter,
  requireBearerAuth,
} from '@modelcontextprotocol/express';
import { toNodeHandler } from '@modelcontextprotocol/node';
import {
  createMcpHandler,
  McpServer,
  OAuthError,
  OAuthErrorCode,
  type OAuthMetadata,
  type OAuthTokenVerifier,
} from '@modelcontextprotocol/server';
import { createRemoteJWKSet, jwtVerify } from 'jose';
import { z } from 'zod';

const PUBLIC_URL = new URL(process.env.PUBLIC_URL ?? 'https://mcp.example.com/mcp');
const ISSUER = process.env.OAUTH_ISSUER ?? 'https://auth.example.com';
const ALLOWED_ORIGINS = ['https://mcptest.io', 'https://app.example.com'];

// createMcpHandler calls this factory for every request.
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
    async ({ id }, ctx) => ({
      content: [{ type: 'text', text: `Order ${id} for ${ctx.http?.authInfo?.clientId ?? 'anonymous'}: shipped` }],
    })
  );
  return server;
}

// Verify JWT access tokens issued by the identity provider for this server.
const oauthMetadata = (await fetch(new URL('/.well-known/oauth-authorization-server', ISSUER)).then((r) =>
  r.json()
)) as OAuthMetadata;
const jwks = createRemoteJWKSet(new URL(String(oauthMetadata.jwks_uri)));
const verifier: OAuthTokenVerifier = {
  async verifyAccessToken(token) {
    try {
      const { payload } = await jwtVerify(token, jwks, { issuer: oauthMetadata.issuer, audience: PUBLIC_URL.href });
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

const app = createMcpExpressApp({
  host: '0.0.0.0',
  allowedHosts: [PUBLIC_URL.hostname],
  allowedOrigins: ALLOWED_ORIGINS.map((origin) => new URL(origin).hostname),
});

// 1. CORS first, so preflights and 401 challenges carry the headers.
app.use(
  cors({
    origin: ALLOWED_ORIGINS,
    methods: ['GET', 'POST', 'DELETE', 'OPTIONS'],
    allowedHeaders: [
      'Content-Type', 'Accept', 'Authorization',
      'MCP-Protocol-Version', 'Mcp-Method', 'Mcp-Name',
      'Mcp-Session-Id', 'Last-Event-ID',
    ],
    exposedHeaders: ['Mcp-Session-Id', 'MCP-Protocol-Version', 'WWW-Authenticate', 'Retry-After'],
    maxAge: 7200,
  })
);

// 2. OAuth discovery documents, public.
app.use(mcpAuthMetadataRouter({ oauthMetadata, resourceServerUrl: PUBLIC_URL, scopesSupported: ['orders:read'] }));

// 3. Bearer check, then the MCP handler.
const auth = requireBearerAuth({
  verifier,
  expectedResource: PUBLIC_URL,
  requiredScopes: ['orders:read'],
  resourceMetadataUrl: getOAuthProtectedResourceMetadataUrl(PUBLIC_URL),
});
const mcp = toNodeHandler(createMcpHandler(buildServer));
app.all('/mcp', auth, (req, res) => void mcp(req, res, req.body));

app.get('/healthz', (_req, res) => void res.send('ok'));
app.listen(Number(process.env.PORT ?? 3000));
```

## How the pieces fit

**`createMcpExpressApp`** returns an Express app with a JSON body parser and the transport's `Host` and `Origin` checks already installed. The `host` option does not choose the listening interface; it decides the default protection. With the default, `127.0.0.1`, only localhost `Host` headers are accepted, so a deployed server answers every request with `403` and `Invalid Host: mcp.example.com`. Set `host: '0.0.0.0'` and list your public hostname in `allowedHosts`. `allowedOrigins` takes hostnames without a scheme, and requests without an `Origin` header, which is every desktop and command-line client, pass.

**`createMcpHandler(buildServer)`** serves both protocol eras from one stateless handler. A 2026-07-28 client gets `server/discover` and self-describing requests; a 2025 client gets `initialize` answered by a fresh instance per request. Because nothing is held between requests, `GET` and `DELETE` on `/mcp` answer `405`, which the specification allows and which mcptest reports as a warning, not a failure. **`toNodeHandler`** adapts it to Express's `req` and `res`; pass `req.body` because the body parser has already read the stream.

**CORS goes first.** Browsers send the preflight without credentials. If `requireBearerAuth` ran before `cors()`, the preflight would get `401` without CORS headers and the browser would never send the real request. Registered first, the middleware answers the preflight with `204` and also decorates the `401`, so a browser client can read `WWW-Authenticate`. The [CORS reference](/learn/mcp-cors-headers-for-browser-clients) explains each header.

**`mcpAuthMetadataRouter`** publishes the Protected Resource Metadata document at `/.well-known/oauth-protected-resource/mcp`, the path-inserted form a client derives from `https://mcp.example.com/mcp`, and mirrors the identity provider's metadata at `/.well-known/oauth-authorization-server` for older clients that look there. The metadata is fetched once at startup, so a misconfigured issuer fails the deploy instead of the first sign-in.

**`requireBearerAuth`** is the auth hook. It parses the header, calls your verifier, and then:

| Token | Response |
| --- | --- |
| Missing, malformed, expired, or signed by another issuer | `401` with `WWW-Authenticate: Bearer error="invalid_token", scope="orders:read", resource_metadata="..."` |
| Valid, but `aud` is another resource | `401`, because the verifier sets `audience` and `expectedResource` compares `AuthInfo.resource` |
| Valid, but without `orders:read` | `403` with `error="insufficient_scope"` |
| Valid | The request continues; tools read the result as `ctx.http.authInfo` |

The verifier must set `expiresAt`: the SDK refuses tokens without an expiry. Checking the audience is not optional either. The 2026-07-28 authorization specification requires a server to accept only tokens issued for itself, which is what `audience: PUBLIC_URL.href` in `jwtVerify` enforces. Your identity provider must put that URL in `aud`, usually because the client sent it as the RFC 8707 `resource` parameter. [Authentication patterns](/learn/mcp-server-authentication-patterns) shows the provider-side settings for WorkOS, Auth0, and Stytch, and a shorter API key gate if you do not need OAuth.

## Check it before you deploy

Start the server with `PUBLIC_URL` and `OAUTH_ISSUER` set, then run these requests. Each output below was captured from the server above.

An unauthenticated request must get a challenge a client can follow:

```bash
curl -i -X POST http://localhost:3000/mcp -H 'Content-Type: application/json' -d '{}'
```

```http
HTTP/1.1 401 Unauthorized
Access-Control-Expose-Headers: Mcp-Session-Id,MCP-Protocol-Version,WWW-Authenticate,Retry-After
WWW-Authenticate: Bearer error="invalid_token", error_description="Missing Authorization header", scope="orders:read", resource_metadata="http://localhost:3000/.well-known/oauth-protected-resource/mcp"
```

The metadata document must name the exact URL clients use, with its path:

```json
{"resource":"http://localhost:3000/mcp","authorization_servers":["http://localhost:4000"],"scopes_supported":["orders:read"]}
```

A preflight from an allowed origin must be granted, and a request from any other origin refused:

```bash
curl -i -X OPTIONS http://localhost:3000/mcp \
  -H "Origin: https://mcptest.io" \
  -H "Access-Control-Request-Method: POST" \
  -H "Access-Control-Request-Headers: authorization,content-type,mcp-method,mcp-name,mcp-protocol-version"
```

That returned `204` with the allow-lists from the code. The same `POST` with `Origin: https://evil.example` returned `403`. With a valid token, a 2026 `server/discover` returned `supportedVersions: ["2026-07-28"]` and a 2025 `initialize` returned `protocolVersion: "2025-11-25"` as an SSE response. The [testing guide](/docs/testing-guide) has the full bodies for both requests.

## What mcptest reported for this server

The headless gate runs the same evaluator as the web report. It only sends credentials over HTTPS, so the run went through a local TLS proxy, with a token minted for that URL:

```bash
export MCPTEST_BEARER_TOKEN="$(cat token.txt)"
npm run mcptest -- --bearer-token-env MCPTEST_BEARER_TOKEN https://localhost:8443/mcp
```

| Section | Score | Why |
| --- | ---: | --- |
| Core Protocol Adherence | 15 / 15 | Stateless `server/discover` lifecycle at `2026-07-28` |
| MCP Capabilities | 4 / 10 | `tools/list` answered; the server offers no resources or prompts |
| Transport Layer Modernity | 15 / 15 | Streamable HTTP |
| Security Posture | 40 / 40 | Protected resource metadata, authorization-server metadata, a token endpoint, PKCE `S256` |
| Performance Baseline | 15 / 15 | Negotiation in 91 ms |

The total was 89 out of 95; the headless run leaves out Web Client Accessibility. The release decision was **review**, not **ready**, because of host-compatibility observations a single run cannot settle, such as whether the identity provider issues refresh tokens and accepts each host's redirect URI. An earlier version of the tool with a bare `z.object` and no property description added a medium `tool.schema.unconstrained-inputs` finding. `z.strictObject` emits `additionalProperties: false`, which cleared it.

## Express mistakes that look like protocol bugs

- **`app.post('/mcp', ...)` only.** `GET` and `DELETE` then fall through to Express's `404` HTML page instead of a JSON-RPC `405`. Use `app.all`.
- **The 100 kb body limit.** The adapter's JSON parser keeps Express's default. A `tools/call` with a 200 kB argument was refused with `413` and an HTML error page before the MCP handler ran, which clients report as a transport error rather than a tool error. Set `jsonLimit: '1mb'`, or whatever your largest argument needs, on `createMcpExpressApp` instead of adding a second `express.json()`.
- **Authentication behind a path prefix.** `app.use('/api', auth)` with the MCP route mounted elsewhere leaves `/mcp` open. Attach `auth` to the MCP route itself.
- **A reverse proxy that buffers.** Responses that stream progress use SSE. [Deploying a remote MCP server](/learn/deploy-remote-mcp-server) has the nginx and platform settings that keep streams flowing.

## Run the gate on your deployment

Deploy to staging, then open the endpoint in the [MCP Playground](/) to complete OAuth in the browser and get the Web Client Accessibility score, or add `npm run mcptest -- --bearer-token-env MCPTEST_BEARER_TOKEN https://staging.example.com/mcp` to the pipeline as described in [How to test an MCP server before you deploy it](/learn/test-mcp-server-before-deploying#run-the-same-checks-in-ci).
