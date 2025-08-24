# Cloudflare OAuth Worker Setup Guide

## Quick Fix for KV Namespace Error

The deployment is failing because a KV namespace ID needs to be configured. Here's how to fix it:

### Option 1: Create KV Namespace via Cloudflare Dashboard (Recommended)

1. Go to your Cloudflare Dashboard
2. Navigate to Workers & Pages → KV
3. Click "Create namespace"
4. Name it: `oauth-worker-kv` (or any name you prefer)
5. Copy the namespace ID that's generated
6. Update `wrangler.toml` line 8 with the actual ID:
   ```toml
   id = "YOUR_ACTUAL_KV_NAMESPACE_ID_HERE"
   ```

### Option 2: Create KV Namespace via Wrangler CLI

1. Install wrangler globally if not already installed:
   ```bash
   npm install -g wrangler
   ```

2. Authenticate with Cloudflare:
   ```bash
   wrangler login
   ```

3. Create the KV namespace:
   ```bash
   wrangler kv namespace create "OAUTH_KV" --account-id YOUR_ACCOUNT_ID
   ```

4. The command will output something like:
   ```
   🌀 Creating namespace with title "oauth-worker-OAUTH_KV"
   ✨ Success!
   Add the following to your configuration file in your kv_namespaces array:
   { binding = "OAUTH_KV", id = "abcd1234567890..." }
   ```

5. Copy the ID and update `wrangler.toml`

### Option 3: Use Environment-Specific KV Namespace

If you're using Cloudflare Pages with different environments, you can:

1. Create the KV namespace in your Cloudflare dashboard
2. Go to your Pages project settings
3. Add the KV namespace binding in the "Functions" tab
4. Set the binding name as `OAUTH_KV`

This way, you don't need to hardcode the ID in `wrangler.toml`.

## Important Notes

- The KV namespace is required for the OAuth provider to store authorization codes and tokens
- Each environment (production, staging, etc.) should have its own KV namespace
- The binding name `OAUTH_KV` must match what's expected by the `@cloudflare/workers-oauth-provider` package

## After Setting Up KV Namespace

Once you've created the KV namespace and updated the configuration:

1. Commit and push the updated `wrangler.toml`
2. The Cloudflare Pages deployment should succeed
3. The OAuth worker will be available at your worker URL
4. You'll need to initialize the OAuth client as described in the README