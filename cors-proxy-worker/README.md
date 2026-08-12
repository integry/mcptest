# MCP Test CORS Proxy Worker

This Cloudflare Worker provides a CORS proxy for authenticated users of the MCP Test application.

## Features

- **Authentication Required**: Only users logged in with Firebase authentication can use the proxy
- **CORS Headers**: Automatically adds appropriate CORS headers to all responses
- **Security**: Validates target URLs and only allows HTTP/HTTPS protocols
- **Preflight Handling**: Properly handles OPTIONS preflight requests

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

`getOperatorOAuthClient` intentionally has no browser endpoint. A deployment that activates one
of these clients must keep authorization-code exchange and the client secret inside the Worker and
must never serialize the secret into responses, URLs, reports, logs, or browser storage. Without
that deployment-specific server flow, the UI truthfully reports the provider prerequisite and keeps
the supported bearer-token alternative available where the provider offers one.

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

## Development

Run the worker locally:
```bash
npm run dev
```

View logs from deployed worker:
```bash
npm run tail
```
