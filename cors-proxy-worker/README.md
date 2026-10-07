# MCP Test CORS Proxy Worker

This Cloudflare Worker provides a CORS proxy for the MCP Test application. Anyone can use it
without signing in; caller-based limits keep it from becoming a generic bulk tunnel, and signing
in with Firebase lifts those limits.

## Features

- **Anonymous by Default**: No login is needed. Callers are governed, targets are never judged
- **Caller-Based Limits**: Cloudflare Rate Limiting bindings cap anonymous callers per IP and signed-in callers per Firebase uid; anonymous responses are also capped in size and stream lifetime (see [Caller limits](#caller-limits))
- **CORS Headers**: Automatically adds appropriate CORS headers to all responses
- **Security**: Validates target URLs and only allows HTTP/HTTPS protocols
- **Preflight Handling**: Properly handles OPTIONS preflight requests
- **Hosted OAuth Exchange**: Proactively exchanges authorization codes and refresh tokens through an issuer-bound, caller-limited `/oauth/token` route for providers without browser CORS
- **Hosted OAuth Registration**: Relays bounded public-client DCR through a caller-limited, issuer-rediscovered `/oauth/register` route without becoming a generic JSON proxy
- **Operator OAuth Client ID**: Returns only the public client ID through a caller-limited, exact resource/issuer-bound `/oauth/client` route for approved GitHub and Slack host applications

## Setup

1. Install dependencies:
   ```bash
   npm install
   ```

2. Deploy the worker:
   ```bash
   npm run deploy
   ```

3. After deployment, update the `VITE_PROXY_URL` in your frontend `.env` file with the deployed worker URL:
   ```
   VITE_PROXY_URL=https://mcptest-cors-proxy.your-account.workers.dev
   ```

## Operator-owned and hosted OAuth clients

Hosted OAuth is free and is enabled only for these exact provider/target pairs:

- Slack: `https://mcp.slack.com/mcp` with issuer `https://mcp.slack.com`
- GitHub: `https://api.githubcopilot.com/mcp` with issuer `https://github.com/login/oauth`

Create the provider applications using the official [Slack MCP setup](https://docs.slack.dev/ai/slack-mcp-server/)
and [GitHub OAuth application setup](https://docs.github.com/en/apps/oauth-apps/building-oauth-apps/creating-an-oauth-app).
Both applications must register this exact redirect URI:

```text
https://cors-proxy-worker.livecart.workers.dev/oauth/hosted/callback
```

Slack and GitHub require fixed confidential host applications, while Figma requires an approved
catalog client. Set provider credentials, scope policies, and the hosted-flow encryption key in
server-side Worker bindings. The commands below use encrypted Worker secrets for every value; never
put confidential values in `wrangler.toml`, Pages variables, frontend `.env` files, or build arguments:

```bash
wrangler secret put SLACK_OAUTH_CLIENT_ID
wrangler secret put SLACK_OAUTH_CLIENT_SECRET
wrangler secret put SLACK_OAUTH_SCOPES
wrangler secret put GITHUB_OAUTH_CLIENT_ID
wrangler secret put GITHUB_OAUTH_CLIENT_SECRET
wrangler secret put GITHUB_OAUTH_SCOPES
wrangler secret put FIGMA_OAUTH_CLIENT_ID
wrangler secret put FIGMA_OAUTH_CLIENT_SECRET
wrangler secret put HOSTED_OAUTH_ENCRYPTION_KEY
```

`HOSTED_OAUTH_ENCRYPTION_KEY` is a base64url-encoded 32-byte random key. Configure
`HOSTED_OAUTH_CALLBACK_URL` and `PUBLIC_APP_ORIGIN` as non-secret Worker bindings, and keep the
`HOSTED_OAUTH_BROKER` Durable Object binding and migration from `wrangler.toml`.

`SLACK_OAUTH_SCOPES` and `GITHUB_OAUTH_SCOPES` are explicit, space-separated least-privilege
allowlists for the corresponding operator application. Configure only scopes that the application
is approved to request and that are required for the MCP tools mcptest.io intends to expose. The
Worker uses this list when a provider challenge omits `scope`, rejects challenge scopes outside the
list, and refuses to start hosted OAuth when the binding is absent, invalid, or contains a scope the
trusted MCP resource does not advertise. It never falls back to an empty request or to every scope
advertised by the provider.

Authorization transactions expire after 10 minutes and are single-use. Provider access and refresh
tokens are AES-256-GCM encrypted in Durable Object storage, never returned to browser code, and
refreshed server-side 60 seconds before provider expiry. The browser receives only an opaque grant
reference, kept in `sessionStorage` for the current tab; the reference expires server-side after 30
days and is valid only for the same Firebase user and exact normalized MCP target. The proxy resolves
that reference and places the provider access token on the existing isolated target-authorization
channel. Firebase credentials are never forwarded to the MCP target.

If a provider app or secret is missing, the endpoint returns `provider_not_configured`; the UI does
not offer a confidential-client form as a fallback. Figma hosted OAuth remains disabled until
mcptest.io is approved for the Figma MCP Catalog. The Figma operator-client configuration remains
server-only; its client secret must never be serialized into responses, URLs, reports, logs, or
browser storage. The UI keeps supported bearer-token alternatives available where providers offer
them.

GitHub and Slack browser authorization is **not production-ready until both secrets for that
provider are present**. The `/oauth/client` route fails with one safe
`operator_client_not_configured` prerequisite when either value is absent. It returns only
`client_id`; it never returns the client secret, Firebase credential, request body, or user
identity. Its resource and issuer inputs must match a closed exact Worker policy.

The `/oauth/token` route resolves these values only after checking the caller's limits and
rediscovering the issuer's token endpoint. It injects confidential client authentication into the
upstream request inside the Worker and never serializes the secret into responses, URLs, reports,
logs, or browser storage. Without configured values, the UI reports the operator prerequisite and
keeps the supported bearer-token alternative available where the provider offers one.

## Caller limits

The proxy never validates, allowlists, or handshake-gates the target: people legitimately test
broken and non-compliant MCP servers. Instead it limits the caller. The limits double as the
spend cap for the ~$5/month Workers Paid plan.

| Tier | Key | Requests | Request body size | Response size | Stream lifetime |
| --- | --- | --- | --- | --- | --- |
| Anonymous | `CF-Connecting-IP` | 60 / 60 s (`ANON_RATE_LIMITER`) | 1 MB per request | 5 MB per response | 5 minutes |
| Signed in | Firebase uid | 600 / 60 s (`USER_RATE_LIMITER`) | unlimited | unlimited | unlimited |

Request rates are configured in `wrangler.toml` (`[[ratelimits]]`); the size and lifetime caps
are the `ANONYMOUS_MAX_REQUEST_BYTES`, `ANONYMOUS_MAX_RESPONSE_BYTES` and
`ANONYMOUS_MAX_STREAM_DURATION_MS` constants in
`src/index.ts`. When a binding is missing (local dev, tests) the Worker fails open and logs once.

When a request limit is hit, the proxy answers `429` with `Retry-After`,
`X-MCP-Proxy-Response-Source: proxy`, `X-MCP-Proxy-Limit: anonymous|signed-in`,
`X-MCP-Proxy-Limit-Kind`, CORS headers, and a JSON body such as
`{ "error": "rate_limited", "tier": "anonymous", "signInLiftsLimit": true }` so the app can tell
"sign in to lift the limit" apart from a target `429`.

Anonymous request bodies are counted as they are forwarded: a declared `Content-Length` above the
cap is refused before anything reaches the target, and a streamed body is cut off before the
first byte over the cap, aborting the upstream request and answering with the marked `429`
(`X-MCP-Proxy-Limit-Kind: request_bytes`).

A declared response `Content-Length` above the cap is answered with the same marked `429` up front.
Anonymous responses that pass the size or lifetime cap mid-stream carry an
`X-MCP-Proxy-Limit-Signal: <token>` header; at the cut-off the proxy appends
`\0mcptest-proxy-limit:<token>\n` followed by the JSON reason (`"limit": "response_bytes"` or
`"stream_duration"`) and closes the stream. The app strips the trailer and reports a proxy caller
limit rather than an MCP server failure.

## Usage

The proxy expects:
- A `target` query parameter with the URL to proxy
- Optionally, an `Authorization` header with a valid Firebase JWT token. Without it the request
  uses the anonymous tier; a present but invalid token is rejected with `401` so the app can
  refresh it
- Optional target credentials in ordinary headers. If the target itself needs
  `Authorization`, send it as `X-MCP-Authorization`; the worker remaps it only
  after identifying the caller and never forwards the Firebase token.

Example:
```
GET https://mcptest-cors-proxy.workers.dev/?target=https://api.example.com/data
Authorization: Bearer <firebase-jwt-token>   # optional; lifts the anonymous limits
```

The OAuth token route is reserved for `https://mcptest.io`. It accepts only caller-limited
form-urlencoded `POST` requests, derives the upstream endpoint from OAuth/OIDC discovery for the
validated issuer, checks that it exactly matches the browser's persisted endpoint binding, blocks
private and unrelated targets, and returns a minimized no-store JSON response. Authorization codes,
PKCE verifiers, refresh tokens, Firebase credentials, form bodies, and client secrets are never put
in a URL or log.

The OAuth registration route is likewise reserved for `https://mcptest.io`. It accepts only the
hosted callback and an allow-listed JSON registration document, rediscovers the asserted issuer,
requires the advertised registration endpoint to match exactly, rejects redirects and private or
special-use address literals, and exposes only bounded JSON client fields or OAuth error fields.
Production intentionally does not make a separate DNS-over-HTTPS request before outbound OAuth
fetches: that lookup cannot pin the address used by a later fetch and proved unreliable within the
Worker runtime. Instead, the required `global_fetch_strictly_public` compatibility flag rejects
private or changing DNS destinations at connection time. Removing that flag is a security-sensitive
configuration change and is guarded by the Worker test suite. Provider cookies and internal response
headers are never forwarded.

## Development

Run the worker locally:
```bash
npm run dev
```

View logs from deployed worker:
```bash
npm run tail
```
