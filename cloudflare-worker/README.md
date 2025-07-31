# MCP Test Cloudflare Worker

This Cloudflare Worker provides data persistence for the MCP Test application using Durable Objects.

## Features

- Stores user data in Durable Objects indexed by Firebase user ID
- Validates Firebase JWT tokens from the Authorization header
- Provides GET endpoint to retrieve user data
- Provides POST endpoint to update user data

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

## Note on JWT Validation

The current implementation includes a placeholder JWT validation function. In production, you should:

1. Use a proper JWT validation library
2. Verify the Firebase JWT signature using Firebase's public keys
3. Check token expiration
4. Validate the issuer and audience claims

Example libraries for JWT validation in Workers:
- `@tsndr/cloudflare-worker-jwt`
- Custom implementation using Web Crypto API