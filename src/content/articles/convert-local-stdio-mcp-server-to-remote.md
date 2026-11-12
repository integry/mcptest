---
title: How to convert a local stdio MCP server to a remote server
navTitle: Convert stdio to remote
summary: Move a stdio server to Streamable HTTP in TypeScript or Python, choose stateless 2026 or stateful 2025 behavior, add authorization, and update client configuration.
track: build
level: practitioner
order: 21
category: Migration
readingTimeMinutes: 9
lastReviewed: "2026-11-11"
metaTitle: Convert MCP Server to Remote (stdio to Streamable HTTP) | mcptest.io
metaDescription: Convert an MCP server to remote with the current TypeScript and Python SDKs. Streamable HTTP, stateless 2026 versus stateful 2025 sessions, OAuth, and the client config change.
relatedSlugs:
  - remote-vs-local
  - deploy-remote-mcp-server
  - oauth-for-mcp-explained
  - mcp-cors-headers-for-browser-clients
sourceLinks:
  - title: "TypeScript SDK v2: serve over HTTP"
    url: "https://ts.sdk.modelcontextprotocol.io/v2/serving/http"
  - title: "TypeScript SDK v2: support legacy clients"
    url: "https://ts.sdk.modelcontextprotocol.io/v2/serving/legacy-clients"
  - title: "TypeScript SDK v2: require authorization"
    url: "https://ts.sdk.modelcontextprotocol.io/v2/serving/authorization"
  - title: "Python SDK v2: what's new (FastMCP renamed to MCPServer)"
    url: "https://py.sdk.modelcontextprotocol.io/whats-new/"
  - title: "Python SDK v2: deploy and scale"
    url: "https://py.sdk.modelcontextprotocol.io/run/deploy/"
  - title: "Python SDK v2: authorization"
    url: "https://py.sdk.modelcontextprotocol.io/run/authorization/"
  - title: MCP 2026-07-28 Streamable HTTP transport
    url: "https://modelcontextprotocol.io/specification/2026-07-28/basic/transports/streamable-http"
  - title: "Claude Code: connect to MCP servers"
    url: "https://code.claude.com/docs/en/mcp"
---

Converting a stdio server to a remote one rarely changes its tools, resources, or prompts. It changes four other things: how the server starts, whom it trusts, where its state lives, and what the client configuration contains.

A stdio server is a process the client starts and talks to over standard input and output. A remote server is an HTTP service that many clients reach over the network, using the Streamable HTTP transport. [Remote vs. local MCP servers](/docs/remote-vs-local) explains the two transports; this guide is the conversion.

The examples use the current SDK major versions:

- **TypeScript v2** replaced the single `@modelcontextprotocol/sdk` package with `@modelcontextprotocol/server`, `@modelcontextprotocol/client`, and framework adapters such as `@modelcontextprotocol/express`.
- **Python `mcp` 2.x** renamed `FastMCP` from `mcp.server.fastmcp` to `MCPServer`. Importing the old path raises a `ModuleNotFoundError` that points at the migration guide.

A v1 server keeps working on `mcp<2` or `@modelcontextprotocol/sdk` 1.x, but start new remote deployments on v2.

## What changes when the server leaves the user's machine

| Concern | stdio | Remote Streamable HTTP |
| --- | --- | --- |
| Who starts it | The client, once per connection | Your platform; one service for every client |
| Credentials | Environment variables in the client config | A token on every request, verified by the server |
| Files and local tools | The user's machine | Only what the server host can reach |
| State | One process per user, so module variables are per user | Shared by every caller; per-user state needs explicit handles |
| Security boundary | The process that launched it | `Host` and `Origin` validation, authorization, rate limits |
| Logging | Anything on stdout corrupts the protocol | Normal HTTP service logging |

The state row causes the most surprises. A module-level variable that held "the current project" was safe when each user had a private process. On a shared HTTP service it leaks between callers. Fix it in one of two ways:

- Move it into a database keyed by the authenticated user.
- Return an opaque handle from one tool and accept it as an argument in the next, as described in [designing a production MCP server](/learn/designing-production-mcp-server).

## Separate the server definition from the transport

Both SDKs serve HTTP from a factory or a server object that does not care how it is reached. Put tool registration in one module and keep each transport in its own entry point.

```typescript
// tools.ts
import { McpServer } from '@modelcontextprotocol/server';
import * as z from 'zod/v4';

export function buildServer(): McpServer {
  const server = new McpServer({ name: 'notes', version: '1.2.0' });
  server.registerTool(
    'search-notes',
    {
      description: 'Search saved notes by keyword',
      inputSchema: z.object({ query: z.string().min(1).max(200) }),
      outputSchema: z.object({ matches: z.array(z.object({ id: z.string(), title: z.string() })) }),
    },
    async ({ query }) => {
      const matches = [{ id: 'n1', title: `Notes about ${query}` }];
      return { content: [{ type: 'text', text: JSON.stringify({ matches }) }], structuredContent: { matches } };
    }
  );
  return server;
}
```

The existing stdio entry point becomes three lines and keeps working for local users:

```typescript
// stdio.ts
import { serveStdio } from '@modelcontextprotocol/server/stdio';
import { buildServer } from './tools.js';

serveStdio(buildServer);
```

## Serve it over Streamable HTTP in TypeScript

`createMcpHandler` takes the factory and returns a web-standard handler. The factory runs once per HTTP request, so register everything inside it and keep connection pools at module scope. On Node, `toNodeHandler` adapts the handler to Express.

```bash
npm install @modelcontextprotocol/server @modelcontextprotocol/express @modelcontextprotocol/node express zod
```

```typescript
// http.ts
import { createMcpExpressApp } from '@modelcontextprotocol/express';
import { toNodeHandler } from '@modelcontextprotocol/node';
import { createMcpHandler } from '@modelcontextprotocol/server';
import { buildServer } from './tools.js';

const handler = createMcpHandler(buildServer);
const app = createMcpExpressApp({
  host: '0.0.0.0',
  allowedHosts: ['mcp.example.com'],
  allowedOrigins: ['app.example.com'],
});
const node = toNodeHandler(handler);

app.all('/mcp', (req, res) => void node(req, res, req.body));
app.listen(Number(process.env.PORT ?? 3000), '0.0.0.0');

process.on('SIGTERM', async () => {
  await handler.close();
  process.exit(0);
});
```

`createMcpExpressApp` installs `express.json()` and DNS-rebinding protection. With the default `127.0.0.1` bind, it only accepts localhost `Host` and `Origin` values. Once you bind to all interfaces, the protection is off unless you name values yourself:

- `allowedHosts`: the public hostnames clients connect to.
- `allowedOrigins`: the hostnames of web apps allowed to call the server from a browser. The transport specification requires `Origin` validation. Requests without an `Origin` header, which non-browser clients normally send, still pass.

The handler itself validates no `Host`, `Origin`, or token.

## Serve it over Streamable HTTP in Python

The decorators do not change. Replace `mcp.run()` with the ASGI app and allowlist the hostname you deploy behind:

```python
# server.py
from mcp.server import MCPServer
from mcp.server.transport_security import TransportSecuritySettings

mcp = MCPServer("notes")


@mcp.tool()
def search_notes(query: str) -> list[str]:
    """Search saved notes by keyword."""
    return [f"Notes about {query}"]


security = TransportSecuritySettings(
    allowed_hosts=["mcp.example.com", "mcp.example.com:*"],
    allowed_origins=["https://app.example.com"],
)
app = mcp.streamable_http_app(transport_security=security)
```

```bash
uvicorn server:app --host 0.0.0.0 --port 8000
```

Without `transport_security`, the app accepts only localhost `Host` headers. A deployed server then answers every request with `421 Misdirected Request`, and only the server log names the rejected hostname. Unlike the TypeScript options, `allowed_origins` takes full origins, including the scheme.

The endpoint is `/mcp`; change it with `streamable_http_path`. Transport options such as `stateless_http` and `transport_security` belong to `run()` or `streamable_http_app()`. Passing them to the `MCPServer` constructor raises a `TypeError`.

## Stateless 2026 or stateful 2025 sessions

A 2026 server needs no session, so it scales behind a plain load balancer. The `2026-07-28` revision removed the `initialize` handshake and the `Mcp-Session-Id` header. Each request carries its protocol version and client capabilities in `params._meta`. Over HTTP it also carries the `MCP-Protocol-Version` and `Mcp-Method` headers, plus `Mcp-Name` on `tools/call`, `resources/read`, and `prompts/get`. Any instance can answer any request.

Many clients still speak a 2025 revision, which opens with `initialize` and may expect a session. Most vendors do not document which protocol versions their clients negotiate, so serve both. The SDKs handle both eras from one endpoint, but their defaults differ.

| Behavior | TypeScript v2 `createMcpHandler` | Python v2 `streamable_http_app()` |
| --- | --- | --- |
| 2026 requests | Served statelessly | Served statelessly |
| 2025 requests, default | Served per request with no session (`legacy: 'stateless'`) | Stateful: issues `Mcp-Session-Id`, needs sticky routing across workers |
| 2025 `GET` stream and `DELETE` | `405` | Served on a session |
| Stateless 2025 option | The default | `stateless_http=True` (affects only the 2025 leg) |
| Refuse 2025 clients | `legacy: 'reject'` | Not needed for most servers |

Choose stateless unless your 2025 clients need server-initiated requests, such as sampling or elicitation, or notifications on the `GET` stream. Those need a session.

- **TypeScript:** a sessionful 2025 deployment uses `NodeStreamableHTTPServerTransport` with a `sessionIdGenerator`. Route 2025 traffic to it with `isLegacyRequest`, in front of a `createMcpHandler(..., { legacy: 'reject' })` handler. The SDK's legacy-clients guide shows that wiring.
- **Python:** a stateful 2025 leg across several workers needs session affinity. Separately, any deployment with several instances must give each one the same `RequestStateSecurity(keys=[...])` and the same server name, or a multi-round-trip tool call that lands on another instance fails.

If you keep sessions, browser clients must be able to read the session id: list `Mcp-Session-Id` in `Access-Control-Expose-Headers`, as covered in [CORS headers for browser clients](/learn/mcp-cors-headers-for-browser-clients).

## Add authorization

On stdio the client passed an API key through the environment. A remote server is an OAuth resource server instead. It verifies a bearer token on every request and publishes Protected Resource Metadata (RFC 9728) so clients can find your authorization server. [OAuth for MCP, explained](/learn/oauth-for-mcp-explained) walks through the client side of that flow.

In TypeScript, `requireBearerAuth` gates the route and `mcpAuthMetadataRouter` serves the metadata:

```typescript
import {
  createMcpExpressApp,
  getOAuthProtectedResourceMetadataUrl,
  mcpAuthMetadataRouter,
  requireBearerAuth,
} from '@modelcontextprotocol/express';
import type { OAuthTokenVerifier } from '@modelcontextprotocol/express';
import { toNodeHandler } from '@modelcontextprotocol/node';
import { createMcpHandler } from '@modelcontextprotocol/server';
import type { AuthInfo, OAuthMetadata } from '@modelcontextprotocol/server';
import { buildServer } from './tools.js';

declare function verifyJwt(token: string): Promise<{ sub: string; scope: string; exp: number; aud: string }>;
declare const oauthMetadata: OAuthMetadata; // your authorization server's RFC 8414 document

const mcpServerUrl = new URL('https://mcp.example.com/mcp');

const verifier: OAuthTokenVerifier = {
  async verifyAccessToken(token: string): Promise<AuthInfo> {
    const claims = await verifyJwt(token);
    return {
      token,
      clientId: claims.sub,
      scopes: claims.scope.split(' '),
      expiresAt: claims.exp,
      resource: new URL(claims.aud),
    };
  },
};

const app = createMcpExpressApp({
  host: '0.0.0.0',
  allowedHosts: ['mcp.example.com'],
  allowedOrigins: ['app.example.com'],
});
app.use(mcpAuthMetadataRouter({ oauthMetadata, resourceServerUrl: mcpServerUrl }));

const auth = requireBearerAuth({
  verifier,
  requiredScopes: ['notes:read'],
  resourceMetadataUrl: getOAuthProtectedResourceMetadataUrl(mcpServerUrl),
  expectedResource: mcpServerUrl,
});
const node = toNodeHandler(createMcpHandler(buildServer));
app.all('/mcp', auth, (req, res) => void node(req, res, req.body));
app.listen(3000);
```

A request without a valid token gets `401` with `WWW-Authenticate: Bearer error="invalid_token", ..., resource_metadata="https://mcp.example.com/.well-known/oauth-protected-resource/mcp"`. A valid token that lacks a required scope gets `403` with `error="insufficient_scope"`. Always populate `expiresAt`: the SDK rejects a token without it. With `expectedResource` set, it also rejects a token whose `resource` is not your server URL.

In Python, pass a `TokenVerifier` and `AuthSettings` to the constructor:

```python
from pydantic import AnyHttpUrl

from mcp.server import MCPServer
from mcp.server.auth.provider import AccessToken, TokenVerifier
from mcp.server.auth.settings import AuthSettings

from notes.auth import verify_jwt  # your code: returns an AccessToken, or None to reject


class JwtVerifier(TokenVerifier):
    async def verify_token(self, token: str) -> AccessToken | None:
        return await verify_jwt(token)


mcp = MCPServer(
    "notes",
    token_verifier=JwtVerifier(),
    auth=AuthSettings(
        issuer_url=AnyHttpUrl("https://auth.example.com"),
        resource_server_url=AnyHttpUrl("https://mcp.example.com/mcp"),
        required_scopes=["notes:read"],
        validate_token_resource=True,
    ),
)
```

Both SDKs publish the metadata at the path-aware location, `/.well-known/oauth-protected-resource/mcp`, and not at the root `/.well-known/oauth-protected-resource`. Clients follow the `resource_metadata` URL from the challenge when it is present. Otherwise they probe the path-aware location first, then the root.

A server that challenges without publishing metadata produces errors like "Protected Resource Metadata request failed: 404", reported against the Python client in [python-sdk#1495](https://github.com/modelcontextprotocol/python-sdk/issues/1495). A resource URL that names an internal host or path instead of the public one sends clients to the wrong metadata URL. Set `resource_server_url` or `mcpServerUrl` to the exact URL clients connect to.

## What changes in the client configuration

A stdio entry tells the client how to start a process and which secrets to pass it:

```json
{
  "mcpServers": {
    "notes": {
      "type": "stdio",
      "command": "node",
      "args": ["dist/stdio.js"],
      "env": { "NOTES_API_KEY": "replace-me" }
    }
  }
}
```

The remote entry is a URL. With OAuth, the client discovers the authorization server and signs the user in; there is no secret in the file:

```json
{
  "mcpServers": {
    "notes": {
      "type": "http",
      "url": "https://mcp.example.com/mcp"
    }
  }
}
```

In Claude Code:

- The equivalent command is `claude mcp add --transport http notes https://mcp.example.com/mcp`. Run `/mcp` in Claude Code to sign in.
- For a server that uses a static token instead of OAuth, add `--header "Authorization: Bearer <token>"`.
- In `.mcp.json`, keep `"type": "http"`. Claude Code reads an entry with no `type` as a stdio server.

Clients that only speak stdio can reach the remote server through a bridge such as `npx -y mcp-remote https://mcp.example.com/mcp`. Field names vary by client; [connecting to a remote MCP server](/learn/connect-remote-mcp-server) covers the common ones.

Publish the full endpoint URL, including `/mcp`. A bare hostname makes clients guess paths, and an SSE URL selects the deprecated HTTP+SSE transport.

## Check the converted endpoint

Before you hand out the URL, confirm that both protocol eras answer. The [testing guide](/docs/testing-guide) has the `curl` requests for a 2026 `server/discover` and a 2025 `initialize`.

Then check what `curl` cannot: a real browser preflight, which response headers browser code can read, and a real tool call validated against its `outputSchema`. If any request fails with `406`, `415`, or `405`, [the status-code guide](/learn/mcp-406-not-acceptable-415-and-405) maps each one to its SDK-level cause.

## Test the converted server in the playground

Open `https://mcptest.io/server/` followed by your endpoint without `https://`, for example [mcptest.io/server/mcp.example.com/mcp](/server/mcp.example.com/mcp) for `https://mcp.example.com/mcp`. The playground then:

- connects from the browser and negotiates 2026 or 2025,
- shows any transport diagnostics with the requests behind them,
- validates each tool call you make against its declared output schema.
