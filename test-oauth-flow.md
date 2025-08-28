# OAuth 2.1 Dynamic Client Registration Test Guide

This guide explains how to test the OAuth 2.1 flow with dynamic client registration as implemented per the MCP specification.

## Implementation Summary

The OAuth implementation now follows the MCP specification:

1. **OAuth 2.0 Authorization Server Metadata Discovery (RFC8414)**
   - Clients discover OAuth endpoints at `/.well-known/oauth-authorization-server`
   - Falls back to default endpoints if discovery fails

2. **OAuth 2.0 Dynamic Client Registration (RFC7591)**
   - Clients automatically register at the `/register` endpoint
   - No manual configuration required for MCP-compliant servers

3. **OAuth 2.1 Compliance**
   - PKCE is mandatory for all public clients
   - Implicit flow is disabled
   - Authorization code flow with PKCE is used

## Test Flow

### 1. Start the OAuth Worker (if testing locally)
```bash
cd oauth-worker
npm run dev
```

### 2. Start the MCP SSE Tester
```bash
npm run dev
```

### 3. Test OAuth Flow

1. Navigate to the MCP SSE Tester UI
2. Enter a server URL (e.g., `https://oauth-worker.livecart.workers.dev/mcp`)
3. Check "Use OAuth Authentication"
4. Click "Connect"

### Expected Behavior

1. **Metadata Discovery**: The client will attempt to discover OAuth endpoints at:
   ```
   https://oauth-worker.livecart.workers.dev/.well-known/oauth-authorization-server
   ```

2. **Dynamic Client Registration**: If discovery succeeds and includes a registration endpoint, the client will:
   - POST to `/oauth/register` with client metadata
   - Receive a dynamically generated client_id
   - Store the registration for future use

3. **Authorization Flow**: The client will:
   - Generate PKCE parameters
   - Redirect to the authorization endpoint
   - Exchange the authorization code for tokens using PKCE

### Manual Configuration Fallback

For services that don't support dynamic registration (like GitHub, Google, etc.), the UI will:
1. Show a warning that manual configuration is required
2. Provide service-specific instructions
3. Allow users to enter their client credentials manually

## Key Changes Made

1. **oauthDiscovery.ts**:
   - Added proper metadata discovery per RFC8414
   - Implemented dynamic client registration per RFC7591
   - Added fallback to default endpoints per MCP spec

2. **useConnection.ts**:
   - Removed hardcoded client IDs
   - Added dynamic client registration flow
   - Updated to use discovered endpoints

3. **oauth-worker/index.js**:
   - Added `/.well-known/oauth-authorization-server` endpoint
   - Implemented `/oauth/register` for dynamic registration
   - Updated CORS to allow any origin

4. **OAuthCallback.tsx**:
   - Updated to use dynamically registered clients
   - Falls back to test client ID only for test servers

5. **config/oauth.ts**:
   - Removed hardcoded credentials
   - Added comments about dynamic registration

## Security Considerations

- Client credentials are stored in sessionStorage (cleared on tab close)
- PKCE is always used for public clients
- Dynamic registration reduces the need to share client secrets
- Each domain gets its own dynamically registered client

## Troubleshooting

If OAuth flow fails:
1. Check browser console for detailed logs
2. Verify the server supports OAuth metadata discovery
3. For non-compliant servers, manual configuration may be required
4. Ensure redirect URI matches exactly: `{origin}/oauth/callback`