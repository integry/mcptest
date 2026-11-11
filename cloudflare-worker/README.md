# MCP Test Cloudflare Worker

This Cloudflare Worker provides data persistence for the MCP Test application using Durable Objects.

## Features

- Stores user data in Durable Objects indexed by Firebase user ID
- Validates Firebase JWT tokens from the Authorization header
- Provides GET endpoint to retrieve user data
- Provides POST endpoint to update user data
- Serves public catalog badges (`/badge/server/<id>.svg`) without authentication
- Serves public deterministic MCP fixture servers under `/fixtures/<name>/mcp` (see below)
- Stores anonymously published, redacted report artifacts (`POST /r`, `GET /r/<id>`,
  `DELETE /r/<id>`, `GET /r/endpoint/<encoded endpoint>`) in the `PublishedReports`
  Durable Object and serves live badges for them (`/badge/report/<encoded endpoint>.svg`).
  See `../CLOUDFLARE_DEPLOYMENT.md` for the validation rules, rate limits and removal flow.

## Public MCP fixture servers

`src/fixtures.js` serves small, deterministic MCP test servers that any client or tester
(including mcptest.io itself, from the browser) can point at. They are public, need no
account, and are stateless: no Durable Object or KV access, no outbound fetches, no
user-controlled URLs.

| Endpoint | Auth | What it does |
| --- | --- | --- |
| `https://mcptest.io/fixtures/echo/mcp` | none | Tools `echo`, `add`, `whoami` (negotiated protocol version, era and selected request headers), `headers` (header names received, values only for MCP/content-negotiation headers); resource `mcptest://fixtures/readme`; prompt `greeting`. |
| `https://mcptest.io/fixtures/auth-bearer/mcp` | `Authorization: Bearer mcptest-public-token` | Same tools as `echo`. Any other request gets `401` with `WWW-Authenticate: Bearer realm="mcptest.io fixtures"` (plus `error="invalid_token"` when a wrong credential was sent). The token is public on purpose. |
| `https://mcptest.io/fixtures/errors/mcp` | none | `protocol_error` (JSON-RPC error `-32603`), `tool_error` (result with `isError: true`), `invalid_params` (`-32602`), `http_500` (HTTP 500 with a JSON-RPC error body). |
| `https://mcptest.io/fixtures/slow/mcp` | none | `sleep` (`ms`, capped at 10 000) and `progress` (`steps` 1–10, `intervalMs` 0–1000; streams `notifications/progress` over SSE when the request has a `progressToken` and accepts `text/event-stream`). |
| `https://mcptest.io/fixtures/schemas/mcp` | none | `create_order` (nested objects, enums, arrays, optional fields) and `classify`, both with `outputSchema` and `structuredContent`. |

Any other `/fixtures/...` path answers `404` with the list of endpoints.

**Protocol revisions.** Every endpoint speaks both revisions the app's client negotiates:

- Stateless `2026-07-28`: probe with `server/discover`; each request carries the `_meta`
  envelope (`io.modelcontextprotocol/protocolVersion`, `io.modelcontextprotocol/clientCapabilities`)
  and matching `MCP-Protocol-Version` / `Mcp-Method` (and `Mcp-Name`) headers. A mismatch is
  `400` with `-32020`; an unsupported revision is `400` with `-32022` and the supported list.
- Stateful `2025-11-25` (and `2025-06-18`, `2025-03-26`, `2024-11-05`): `initialize` returns an
  `Mcp-Session-Id`, which later requests must send (`400` without it). The id is self-validating
  rather than stored, so an id this worker did not issue answers `404`, and a fresh `initialize`
  always works. `GET` (standalone SSE stream) and `DELETE` answer the permitted `405`.

**Limits.** Request bodies are capped at 16 KiB (`413`), JSON-RPC batches are rejected, delays
are capped at 10 s, and `Authorization`, `Cookie` and other credential-shaped header values are
never echoed back.

**CORS.** `Access-Control-Allow-Origin: *` on every response (including `401`/`5xx`), with
`Content-Type, Accept, Authorization, MCP-Protocol-Version, Mcp-Method, Mcp-Name, Mcp-Session-Id,
Last-Event-ID` allowed and `Mcp-Session-Id, MCP-Protocol-Version, WWW-Authenticate, Retry-After`
exposed; preflights answer `204` without authentication.

```bash
curl -s https://mcptest.io/fixtures/echo/mcp \
  -H 'Content-Type: application/json' -H 'Accept: application/json, text/event-stream' \
  -d '{"jsonrpc":"2.0","id":1,"method":"initialize","params":{"protocolVersion":"2025-11-25","capabilities":{},"clientInfo":{"name":"curl","version":"1"}}}'
npm run mcptest -- https://mcptest.io/fixtures/echo/mcp
```

The route is `mcptest.io/fixtures/*` in `wrangler.toml`. Tests: `src/fixtures.test.js` (unit) and
`src/fixtures.client.test.js` (the app's MCP client, release-gate CLI and session probes against a
local HTTP instance of the worker); run them with `npm --prefix cloudflare-worker test`.

## Catalog submissions

`src/submissions.js` serves `POST /api/catalog/submissions` for the app's `/submit` page. It is public (no Firebase token), validates the body against `public/schemas/catalog-submission/v1.schema.json`, rate limits per client address and per endpoint host with the `SubmissionRateLimiter` Durable Object, and triggers the `catalog-submission` `repository_dispatch` event that runs `.github/workflows/catalog-submission.yml`.

- `GITHUB_DISPATCH_TOKEN` (secret, required): fine-grained token for the repository with **Contents: Read and write**. Without it the route answers `503`.
- `TURNSTILE_SECRET` (secret, optional): when set, a valid Cloudflare Turnstile token is required; when unset, the check is skipped. Pair it with `VITE_TURNSTILE_SITE_KEY` in the app build.
- `GITHUB_DISPATCH_REPOSITORY` (var, optional): defaults to `integry/mcptest`.

```bash
npx wrangler secret put GITHUB_DISPATCH_TOKEN
npx wrangler secret put TURNSTILE_SECRET   # optional
```

See `docs/catalog-submissions.md` for the full flow.

## Configuration

Before deployment, update the `FIREBASE_PROJECT_ID` in `wrangler.toml` with your actual Firebase project ID:

```toml
[vars]
FIREBASE_PROJECT_ID = "your-actual-firebase-project-id"
```

## Deployment

1. Install Wrangler CLI:
   ```bash
   npm install -g wrangler
   ```

2. Login to Cloudflare:
   ```bash
   wrangler login
   ```

3. Deploy the worker:
   ```bash
   wrangler deploy
   ```

4. Copy the worker URL and add it to your `.env` file:
   ```
   VITE_CLOUDFLARE_WORKER_URL=https://mcptest-state-api.your-subdomain.workers.dev
   ```

## Development

To run the worker locally:

```bash
wrangler dev
```

## JWT Validation

The worker now includes proper Firebase JWT validation that:

1. **Verifies JWT signatures** using Firebase's public keys fetched from Google's servers
2. **Validates token expiration** to ensure the token hasn't expired
3. **Checks issuer and audience claims** to ensure the token was issued by Firebase for your project
4. **Caches public keys** to minimize API calls to Google's servers

The implementation uses the Web Crypto API available in Cloudflare Workers for cryptographic operations.

### Security Features

- **Signature Verification**: Uses RSA-SHA256 to verify the JWT signature against Firebase's public keys
- **Token Expiration**: Rejects expired tokens based on the `exp` claim
- **Issuer Validation**: Ensures the token was issued by `https://securetoken.google.com/{projectId}`
- **Audience Validation**: Ensures the token was issued for your specific Firebase project
- **Key Caching**: Caches Firebase public keys with proper expiration based on HTTP cache headers

### Error Handling

The worker returns specific error messages for different validation failures:
- "Invalid token format" - Token doesn't have three parts
- "Token expired" - Token's expiration time has passed
- "Invalid issuer" - Token wasn't issued by Firebase for your project
- "Invalid audience" - Token wasn't issued for your project
- "Invalid signature" - Token signature verification failed