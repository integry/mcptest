# OAuth Cloudflare Worker

This Cloudflare Worker provides OAuth 2.1 authorization endpoints to replace the localhost server for production deployments. It handles authorization code flow with PKCE for secure authentication.

## Features

- OAuth 2.1 compliant authorization code flow
- PKCE (Proof Key for Code Exchange) support
- Cloudflare KV storage for authorization codes
- CORS support for cross-origin requests
- Secure token generation
- 10-minute authorization code expiration

## Endpoints

- `GET /oauth/authorize` - Authorization endpoint
- `POST /oauth/token` - Token exchange endpoint

## Prerequisites

1. Cloudflare account with Workers enabled
2. Wrangler CLI installed (`npm install -g wrangler`)
3. Node.js and npm installed

## Setup Instructions

### 1. Install Dependencies

```bash
cd oauth-worker
npm install
```

### 2. Create KV Namespace

Create a KV namespace for storing OAuth codes:

```bash
wrangler kv namespace create "OAUTH_CODES"
```

Copy the namespace ID from the output and update it in `wrangler.toml`:

```toml
[[kv_namespaces]]
binding = "OAUTH_CODES"
id = "YOUR_KV_NAMESPACE_ID"
```

### 3. Deploy the Worker

```bash
./deploy.sh
```

Or manually:

```bash
wrangler deploy
```

### 4. Configure Your Application

Update your `.env` file:

```env
# Enable Cloudflare OAuth
VITE_USE_CLOUDFLARE_OAUTH=true

# Your deployed worker URL
VITE_OAUTH_WORKER_URL=https://mcptest-oauth-worker.workers.dev
```

## Development

To run locally:

```bash
wrangler dev
```

## Security Considerations

1. **PKCE Verification**: The worker verifies PKCE challenges to prevent authorization code interception
2. **Code Expiration**: Authorization codes expire after 10 minutes
3. **One-time Use**: Authorization codes are deleted after successful token exchange
4. **CORS**: Configure CORS headers as needed for your deployment

## Customization

### Client Configuration

Currently, the worker uses a hardcoded client ID (`mcptest-client`). For production use, consider:

1. Storing client configurations in KV
2. Implementing client registration endpoints
3. Adding client secret validation (for confidential clients)

### Token Format

The current implementation generates random tokens. For production, consider:

1. Using JWT tokens with proper signing
2. Implementing token introspection endpoints
3. Adding refresh token rotation

## Troubleshooting

### KV Namespace Issues

If you encounter KV namespace errors:

1. Ensure the namespace ID in `wrangler.toml` is correct
2. Verify the namespace exists: `wrangler kv namespace list`
3. Check worker logs: `wrangler tail`

### CORS Errors

If you see CORS errors:

1. Verify the `Access-Control-Allow-Origin` header matches your application origin
2. Check that preflight OPTIONS requests are handled correctly
3. Ensure all required headers are included in `Access-Control-Allow-Headers`

### Authorization Flow Issues

1. Check browser console for detailed error messages
2. Verify PKCE parameters are being stored and retrieved correctly
3. Ensure redirect URIs match exactly
4. Monitor worker logs for server-side errors

## Monitoring

View real-time logs:

```bash
wrangler tail
```

## License

This OAuth worker is part of the MCP SSE Tester project.