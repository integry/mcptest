# Cloudflare OAuth Worker Setup Guide

## Setting Up KV Namespace for OAuth Worker

The OAuth worker requires a KV namespace to store authorization codes and tokens. The best approach is to configure this through the Cloudflare dashboard rather than hardcoding it in `wrangler.toml`.

### Step 1: Create the KV Namespace

1. Go to your [Cloudflare Dashboard](https://dash.cloudflare.com)
2. Navigate to **Workers & Pages** → **KV**
3. Click **"Create namespace"**
4. Name it: `oauth-worker-kv` (or any descriptive name)
5. Note the generated namespace ID

### Step 2: Configure KV Namespace ID as Secret

1. Go to **Workers & Pages** → Select `oauth-worker`
2. Go to **Settings** → **Variables and Secrets**
3. Under **Secrets**, click **"Add"**
4. Set:
   - Secret name: `OAUTH_KV`
   - Value: Your KV namespace ID (e.g., `c7741c3a32834498a8318f10968a018d`)
5. Click **"Save"**

The `wrangler.toml` is configured to reference this secret for the KV namespace binding.

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