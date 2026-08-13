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
