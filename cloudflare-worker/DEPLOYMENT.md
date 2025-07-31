# Cloudflare Worker Deployment

This directory contains a Cloudflare Worker that provides state management for MCP Test using Durable Objects.

## Quick Deployment

Use the `deploy.sh` script for one-command deployment:

```bash
# Set required environment variables
export CLOUDFLARE_ACCOUNT_ID="your-account-id"
export CLOUDFLARE_API_TOKEN="your-api-token"  
export FIREBASE_PROJECT_ID="your-firebase-project-id"

# Deploy the worker
./deploy.sh
```

## Environment Variables

### Required

- `CLOUDFLARE_ACCOUNT_ID`: Your Cloudflare account ID
- `CLOUDFLARE_API_TOKEN`: Your Cloudflare API token with Worker deployment permissions
- `FIREBASE_PROJECT_ID`: Your Firebase project ID for authentication

### Optional

- `WORKER_NAME`: Name of the worker (default: `mcptest-state-api`)
- `WORKER_ENV`: Deployment environment (default: `production`)

## Deployment Script Features

The `deploy.sh` script provides:

- ✅ Automatic environment variable validation
- ✅ Temporary wrangler.toml generation with your configuration
- ✅ Support for multiple environments (production, staging, dev)
- ✅ Colored output for better readability
- ✅ Automatic cleanup of temporary files
- ✅ Help documentation (`./deploy.sh --help`)

## Manual Deployment

If you prefer manual deployment:

1. Update `wrangler.toml` with your configuration
2. Set your Cloudflare API token:
   ```bash
   export CLOUDFLARE_API_TOKEN="your-token"
   ```
3. Deploy using wrangler:
   ```bash
   wrangler deploy
   ```

## Prerequisites

- Node.js and npm installed
- Wrangler CLI installed: `npm install -g wrangler`
- Cloudflare account with Workers enabled
- Firebase project for authentication

## Deployment Environments

Deploy to different environments:

```bash
# Production (default)
./deploy.sh

# Staging
export WORKER_ENV=staging
./deploy.sh

# Development
export WORKER_ENV=dev
./deploy.sh
```

## Viewing Logs

After deployment, view worker logs:

```bash
wrangler tail mcptest-state-api
```

## Troubleshooting

- **Missing wrangler**: Install with `npm install -g wrangler`
- **Authentication errors**: Ensure your API token has Worker deployment permissions
- **Firebase errors**: Verify your Firebase project ID is correct