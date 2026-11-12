---
title: "MCP server authentication patterns: API keys, bearer tokens, and OAuth with a hosted identity provider"
navTitle: Authentication patterns
summary: The three ways to protect a remote MCP server, tested code for an API key gate and an OAuth resource server, the settings WorkOS AuthKit, Auth0, and Stytch need, and which clients can use each pattern.
track: build
level: practitioner
order: 35
category: Authorization
readingTimeMinutes: 8
lastReviewed: "2026-10-21"
metaTitle: MCP Server Authentication Patterns (API Key, Bearer, OAuth) | mcptest.io
metaDescription: How to authenticate a remote MCP server. API key and static bearer gates, OAuth 2.1 with WorkOS AuthKit, Auth0, or Stytch, audience validation, CIMD versus DCR, and which MCP clients support each.
relatedSlugs:
  - oauth-for-mcp-explained
  - mcp-oauth-2-1-reference
  - remote-mcp-server-401-unauthorized
  - remote-mcp-server-with-express
  - mcp-client-support-matrix
sourceLinks:
  - title: MCP 2026-07-28 authorization
    url: "https://modelcontextprotocol.io/specification/2026-07-28/basic/authorization"
  - title: MCP 2026-07-28 client registration
    url: "https://modelcontextprotocol.io/specification/2026-07-28/basic/authorization/client-registration"
  - title: "TypeScript SDK v2: require authorization"
    url: "https://ts.sdk.modelcontextprotocol.io/v2/serving/authorization"
  - title: "WorkOS: AuthKit for MCP"
    url: "https://workos.com/docs/authkit/mcp"
  - title: "Auth0 for AI Agents: register your MCP client application"
    url: "https://auth0.com/ai/docs/mcp/guides/registering-your-mcp-client-application"
  - title: "Auth0 for AI Agents: call your APIs on a user's behalf"
    url: "https://auth0.com/ai/docs/mcp/get-started/call-your-apis-on-users-behalf"
  - title: "Stytch: MCP authorization overview"
    url: "https://stytch.com/docs/connected-apps/guides/mcp-auth-overview"
  - title: "GitHub Docs: configure MCP servers for Copilot cloud agent"
    url: "https://docs.github.com/en/copilot/how-tos/copilot-on-github/customize-copilot/configure-mcp-servers"
---

A remote MCP server needs to know who is calling before it runs a tool, and the MCP specification only standardizes one way to find out: OAuth 2.1, with the server acting as a resource server. In practice there are three patterns in use, and the right one depends less on security preference than on which clients have to connect. This page compares them, gives tested code for the API key gate and the OAuth resource server, lists the settings each hosted identity provider needs, and maps which clients support which pattern.

## The three patterns

| Pattern | Who issues the credential | Per-user identity | Clients that can use it |
| --- | --- | --- | --- |
| **API key** in `Authorization: Bearer` or a custom header | You, once, out of band | Per key, not per user | Any client that lets you set a header: Claude Code, Cursor, VS Code, Codex, Gemini CLI, Windsurf, Zed, Copilot CLI and cloud agent. Not ChatGPT. |
| **Static bearer token**, such as a personal access token from your product | Your product, per user | Yes, if the token maps to a user | The same as API keys; the user pastes a token |
| **OAuth 2.1 with a hosted identity provider** | The identity provider, after the user signs in | Yes, with scopes | Every major client with a browser sign-in: Claude, ChatGPT, Cursor, VS Code, Codex, Gemini CLI, Zed, Copilot CLI. Not JetBrains AI Assistant or Copilot cloud agent. |

The specification makes authorization optional, and says a local stdio server should take credentials from its environment instead. For a remote server open to more than one person, OAuth is the only pattern every chat-style client can complete without the user handling a secret. API keys remain the right choice for automation, CI, and agents that run without a person present.

## Pattern 1: an API key gate

An API key gate is a few lines in front of the MCP handler. This version runs on any web-standard runtime, stores only SHA-256 digests of issued keys, and accepts the key either as a bearer token or as `X-API-Key`, so it works with clients that only let you set `Authorization` and with tools, like mcptest's CLI, that send `X-API-Key`. It was type-checked with `@modelcontextprotocol/server` 2.3.1 and run on Node.js 22.

```typescript
// server.ts
import { createMcpHandler, McpServer, type AuthInfo } from '@modelcontextprotocol/server';
import { z } from 'zod';

// SHA-256 hex digests of the keys you issued; the keys themselves are never stored.
const KEY_DIGESTS = new Map<string, string>([
  [process.env.ACME_KEY_SHA256 ?? '', 'acme-ci'],
]);

async function sha256Hex(value: string): Promise<string> {
  const digest = await crypto.subtle.digest('SHA-256', new TextEncoder().encode(value));
  return [...new Uint8Array(digest)].map((byte) => byte.toString(16).padStart(2, '0')).join('');
}

async function authenticateApiKey(request: Request): Promise<AuthInfo | Response> {
  const header = request.headers.get('Authorization');
  const key = header?.match(/^Bearer (.+)$/i)?.[1] ?? request.headers.get('X-API-Key');
  const clientId = key ? KEY_DIGESTS.get(await sha256Hex(key)) : undefined;
  if (!key || !clientId) {
    return Response.json(
      { jsonrpc: '2.0', error: { code: -32001, message: 'A valid API key is required' }, id: null },
      { status: 401, headers: { 'WWW-Authenticate': 'Bearer realm="orders-mcp"' } }
    );
  }
  return { token: key, clientId, scopes: ['orders:read'] };
}

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
      content: [{ type: 'text', text: `Order ${id} for ${ctx.http?.authInfo?.clientId}: shipped` }],
    })
  );
  return server;
}

const handler = createMcpHandler(buildServer);

export default {
  async fetch(request: Request): Promise<Response> {
    const auth = await authenticateApiKey(request);
    if (auth instanceof Response) return auth;
    return handler.fetch(request, { authInfo: auth });
  },
};
```

Hashing first means the lookup never compares a raw secret byte by byte, and a leaked database contains no usable keys. Passing `authInfo` to `handler.fetch` gives tools the caller's identity as `ctx.http.authInfo`. Add the CORS headers from the [CORS reference](/learn/mcp-cors-headers-for-browser-clients) if browser clients will connect, and list `X-API-Key` in `Access-Control-Allow-Headers`.

**What the 401 should not contain.** This challenge has no `resource_metadata` and the server publishes no OAuth metadata, because there is no OAuth. That is deliberate, but some clients probe anyway. Copilot CLI 1.0.101, configured with a static `Authorization` header, answered a `401` by requesting `/.well-known/oauth-protected-resource/mcp`, `/.well-known/oauth-protected-resource`, and `/mcp/.well-known/oauth-protected-resource` before giving up, which is why a wrong key can look like an OAuth failure in client logs. Return `401` only when the key is missing or wrong, never for a valid key.

**What mcptest reports.** Without a key, the headless gate stops at **authorization-required** and exits with code 2. With the key in an environment variable, `npm run mcptest -- --api-key-env MCPTEST_API_KEY https://mcp.example.com/mcp` sends it as `X-API-Key`; the run scored 49 out of 55, because Security Posture is only scored when OAuth metadata exists.

## Pattern 2: static bearer tokens

A personal access token is an API key bound to a user. Generate it in your product, show it once, store its digest with the user id, and look it up exactly as above; the only change is that `clientId` becomes the user. Give tokens an expiry and a revocation path, because nothing in MCP refreshes them.

Do not confuse this with OAuth bearer tokens. A static token is opaque to the client. An OAuth access token is obtained by the client through a flow, is short-lived, and must be validated for its audience.

## Pattern 3: OAuth with a hosted identity provider

In this pattern the MCP server never issues tokens. It is an OAuth 2.1 resource server, and the hosted provider is the authorization server. The server has four jobs, all required by the 2026-07-28 specification:

1. **Publish Protected Resource Metadata (RFC 9728)** at `/.well-known/oauth-protected-resource/mcp` for an endpoint at `/mcp`, naming the exact `resource` URL and the provider's issuer in `authorization_servers`.
2. **Challenge with `401`** and `WWW-Authenticate: Bearer resource_metadata="..."`, ideally with `scope`. Clients only start sign-in from a `401`.
3. **Validate every token**: signature against the provider's JWKS, `iss`, expiry, and an audience that is this server. The specification forbids accepting tokens issued for anything else, and forbids passing a client's token through to upstream APIs.
4. **Enforce scopes** per operation, answering `403` with `error="insufficient_scope"` and the scopes needed.

The SDKs do most of this. Tested, complete servers: [Express](/learn/remote-mcp-server-with-express) with `requireBearerAuth` and `mcpAuthMetadataRouter`, [Hono](/learn/remote-mcp-server-with-hono) and [Cloudflare Workers](/learn/remote-mcp-server-with-cloudflare-workers-agents) with the fetch-level `requireBearerAuth`, [FastAPI](/learn/remote-mcp-server-with-fastapi) with `TokenVerifier` and `AuthSettings`, and [Next.js](/learn/remote-mcp-server-with-nextjs) with `withMcpAuth`. The core of every one is the same JWT check:

```typescript
const { payload } = await jwtVerify(token, jwks, { issuer: ISSUER, audience: 'https://mcp.example.com/mcp' });
```

Copy `ISSUER` exactly from the provider's discovery document; `jose` compares it as a string, so a missing or extra trailing slash fails every token.

### Client registration: CIMD first, DCR for compatibility

Before signing in, a client needs a client ID at the provider. The 2026-07-28 specification says authorization servers and clients **should** support Client ID Metadata Documents, where the client ID is an HTTPS URL serving the client's metadata. Dynamic Client Registration is deprecated and kept only for backward compatibility. Clients try a pre-registered ID first, then CIMD when the provider advertises `client_id_metadata_document_supported`, then DCR, then ask the user.

Many clients in use today still rely on DCR, so enable both on the provider until your client mix proves otherwise.

### Provider settings

| Provider | `authorization_servers` and issuer | JWKS | Audience | Registration |
| --- | --- | --- | --- | --- |
| WorkOS AuthKit | Your AuthKit domain | `https://<authkit domain>/oauth2/jwks` | Register the MCP server URL as a Resource Indicator; tokens carry it in `aud` | CIMD is off by default; enable it under Connect → Configuration. DCR can also be enabled there for older clients |
| Auth0 | Your tenant's custom or canonical domain | `https://<domain>/.well-known/jwks.json` | Create an API whose identifier is the MCP server URL, and enable the **Resource Parameter Compatibility Profile** so the client's `resource` parameter selects it | Auth0 recommends manually registering clients from their CIMD; Dynamic Client Registration is a tenant setting under Settings → Advanced |
| Stytch Connected Apps | Your Stytch project domain | `<project domain>/.well-known/jwks.json` | Stytch's own examples check the project ID as the audience, not the MCP URL | DCR is opt-in in the Connected Apps dashboard; CIMD support was announced in October 2025 |

Two provider details change your code. Stytch's authorization endpoint is a page you host with Stytch's components, so the sign-in screen lives in your app. And with Stytch's project-ID audience, all MCP servers in one project accept each other's tokens; use one project per server, or add a check of a custom claim, if that matters.

### OAuth versus the clients that cannot do it

JetBrains AI Assistant does not implement OAuth for MCP servers; the request is open as LLM-25012. GitHub's Copilot cloud agent explicitly does not support remote servers that use OAuth. For those, either accept a second credential type, such as a personal access token next to OAuth, or point users at a local bridge such as `mcp-remote`. Accepting both is common: try the JWT check, fall back to a token lookup, and return the OAuth challenge only when both fail.

## What each client supports

<!-- compat-matrix clients="claude-ai,claude-code,chatgpt,codex-cli,cursor,vscode-copilot,windsurf,gemini-cli" -->

Four clients are not in that dataset yet. Their current documentation says:

| Client | Custom headers | OAuth | Guide |
| --- | --- | --- | --- |
| Zed | `headers` in `context_servers` | Yes, since v0.230.0; registers with CIMD by default, DCR supported, pre-registered client ID since v1.4.2 | [Zed](/learn/connect-mcp-server-to-zed) |
| JetBrains AI Assistant | Not documented | No (LLM-25012) | [JetBrains AI Assistant](/learn/connect-mcp-server-to-jetbrains-ai-assistant) |
| GitHub Copilot CLI | `headers`, with `${VAR}` expanded from the shell | Yes, with an optional pre-registered `oauthClientId` | [Copilot CLI and cloud agent](/learn/connect-mcp-server-to-github-copilot-cli-and-coding-agent) |
| GitHub Copilot cloud agent | `headers`, with `COPILOT_MCP_` secrets | No | [Copilot CLI and cloud agent](/learn/connect-mcp-server-to-github-copilot-cli-and-coding-agent) |

## Choosing

- **A public server for chat clients:** OAuth with a hosted provider. ChatGPT and claude.ai cannot send your API key in practice.
- **An internal server used from IDEs and CI:** API keys or personal access tokens, issued per person or per pipeline.
- **Both audiences:** OAuth plus personal access tokens on the same endpoint, with the OAuth challenge as the `401` response.

Whatever you choose, test the failure paths as well as the happy path: no credential, a wrong one, a token for another audience, and a token without the needed scope.

## Check your auth in the playground

Paste your endpoint into the [MCP Playground](/) and connect. The OAuth flight recorder shows each discovery request, the registration method the provider accepted, and the token exchange; for an API key server, add the key as a header and confirm the tool list loads. When it passes, gate deploys on it with `--bearer-token-env` or `--api-key-env` as described in [How to test an MCP server before you deploy it](/learn/test-mcp-server-before-deploying#run-the-same-checks-in-ci).
