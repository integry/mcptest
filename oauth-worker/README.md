# OAuth 2.1 Cloudflare Worker

This Cloudflare Worker implements OAuth 2.1 authorization endpoints using the `@cloudflare/workers-oauth-provider` package.

## Features

- OAuth 2.1 compliant authorization server
- PKCE (Proof Key for Code Exchange) support
- Automatic token management
- End-to-end encryption for sensitive data
- Support for dynamic client registration

## Setup

1. Install dependencies:
   ```bash
   npm install
   ```

2. Create a KV namespace in Cloudflare:
   ```bash
   wrangler kv:namespace create "OAUTH_KV"
   ```

3. Update `wrangler.toml` with your KV namespace ID from the output above.

4. Deploy the worker:
   ```bash
   npm run deploy
   ```

5. Initialize the OAuth client:
   After deployment, the `mcptest-client` needs to be created. This can be done by:
   - Using the Cloudflare Workers dashboard to manually invoke the `setupClient` function
   - Creating a temporary endpoint that calls `setupClient`
   - Using Wrangler tail to execute the function

## Configuration

The worker is configured to:
- Use `/oauth/authorize` for the authorization endpoint
- Use `/oauth/token` for the token endpoint
- Support dynamic client registration at `/oauth/register`
- Automatically approve authorization requests (for testing purposes)

## Endpoints

- `GET /oauth/authorize` - OAuth 2.1 authorization endpoint
- `POST /oauth/token` - OAuth 2.1 token endpoint
- `POST /oauth/register` - Dynamic client registration (RFC 7591)
- `GET /.well-known/oauth-authorization-server` - OAuth 2.1 metadata discovery (RFC 8414)

## Application Configuration

Update your application's `.env` file:

```env
# Your deployed worker URL
VITE_OAUTH_WORKER_URL=https://mcptest-oauth-worker.workers.dev
```

## Security

The `@cloudflare/workers-oauth-provider` package provides:
- Secrets stored only by hash
- End-to-end encryption for props/user data
- Automatic token expiration and rotation
- Protection against common OAuth attacks

## Development

Run the worker locally:
```bash
npm run dev
```

View logs:
```bash
npm run tail
```

## Implementation Details

This worker uses the `@cloudflare/workers-oauth-provider` package which:

1. **Handles all OAuth 2.1 protocol details** - Authorization codes, PKCE verification, token generation
2. **Provides secure storage** - Uses KV with encrypted props and hashed secrets
3. **Supports modern OAuth features** - Dynamic client registration, metadata discovery
4. **Simplifies implementation** - Wraps your worker code with OAuth functionality

The current implementation auto-approves authorization requests for testing purposes. In a production environment, you would implement a proper consent UI.

## Troubleshooting

### KV Namespace Issues
- Ensure the namespace ID in `wrangler.toml` is correct
- Verify the namespace exists: `wrangler kv:namespace list`
- The binding must be named `OAUTH_KV` as required by the package

### Client Setup
- The client must be created before use (see step 5 in Setup)
- Check worker logs for client creation status
- Verify redirect URIs match your application URLs

### CORS Errors
- The package handles CORS automatically for OAuth endpoints
- For custom endpoints, add appropriate CORS headers

## License

This OAuth worker is part of the MCP SSE Tester project.