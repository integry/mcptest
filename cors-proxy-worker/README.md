# MCP Test CORS Proxy Worker

This Cloudflare Worker provides a CORS proxy for authenticated users of the MCP Test application.

## Features

- **Authentication Required**: Only users logged in with Firebase authentication can use the proxy
- **CORS Headers**: Automatically adds appropriate CORS headers to all responses
- **Security**: Validates target URLs and only allows HTTP/HTTPS protocols
- **Preflight Handling**: Properly handles OPTIONS preflight requests
- **Hosted OAuth Exchange**: Proactively exchanges authorization codes and refresh tokens through an issuer-bound, authenticated `/oauth/token` route for providers without browser CORS
- **Hosted OAuth Registration**: Relays bounded public-client DCR through an authenticated, issuer-rediscovered `/oauth/register` route without becoming a generic JSON proxy

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

### Operator-owned OAuth clients

Providers such as Slack and GitHub require a fixed confidential host application, while Figma
requires an approved catalog client. The Worker exposes a server-only configuration seam for
those deployments. Configure both values with encrypted Worker secrets, never with frontend
`VITE_` variables or checked-in Wrangler variables:

```bash
wrangler secret put SLACK_OAUTH_CLIENT_ID
wrangler secret put SLACK_OAUTH_CLIENT_SECRET
wrangler secret put GITHUB_OAUTH_CLIENT_ID
wrangler secret put GITHUB_OAUTH_CLIENT_SECRET
wrangler secret put FIGMA_OAUTH_CLIENT_ID
wrangler secret put FIGMA_OAUTH_CLIENT_SECRET
```

The `/oauth/token` route resolves these values only after authenticating the mcptest user and
rediscovering the issuer's token endpoint. It injects confidential client authentication into the
upstream request inside the Worker and never serializes the secret into responses, URLs, reports,
logs, or browser storage. Without configured values, the UI reports the operator prerequisite and
keeps the supported bearer-token alternative available where the provider offers one.

## Usage

The proxy expects:
- A `target` query parameter with the URL to proxy
- An `Authorization` header with a valid Firebase JWT token
- Optional target credentials in ordinary headers. If the target itself needs
  `Authorization`, send it as `X-MCP-Authorization`; the worker remaps it only
  after authenticating the caller and never forwards the Firebase token.

Example:
```
GET https://mcptest-cors-proxy.workers.dev/?target=https://api.example.com/data
Authorization: Bearer <firebase-jwt-token>
```

The OAuth token route is reserved for `https://mcptest.io`. It accepts only authenticated
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
