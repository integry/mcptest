# OAuth Client Setup Instructions

The OAuth worker now automatically handles the `mcptest-client` without any manual setup required.

## How it Works

1. **Automatic Client Registration**: When the OAuth worker receives an authorization request for `mcptest-client`, it automatically creates the client if it doesn't exist.

2. **Dynamic Subdomain Support**: The OAuth worker accepts any subdomain of mcptest.io:
   - `https://mcptest.io/oauth/callback`
   - `https://app.mcptest.io/oauth/callback`
   - `https://staging.mcptest.io/oauth/callback`
   - `https://any-subdomain.mcptest.io/oauth/callback`

3. **Security**: Only redirect URIs matching the pattern `https://*.mcptest.io/oauth/callback` are allowed.

## Deployment

Simply deploy the OAuth worker:
```bash
cd oauth-worker
npm run deploy
```

No additional setup is required. The client will be created automatically on first use.