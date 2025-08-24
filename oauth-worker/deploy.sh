#!/bin/bash

# OAuth Worker Deployment Script
# This script deploys the OAuth Cloudflare Worker

set -e

# Colors for output
RED='\033[0;31m'
GREEN='\033[0;32m'
YELLOW='\033[1;33m'
NC='\033[0m' # No Color

echo -e "${GREEN}=== OAuth Worker Deployment ===${NC}"

# Check if wrangler is installed
if ! command -v wrangler &> /dev/null; then
    echo -e "${RED}Error: wrangler CLI is not installed${NC}"
    echo "Please install wrangler first: npm install -g wrangler"
    exit 1
fi

# Navigate to oauth-worker directory
cd "$(dirname "$0")"

# Check if KV namespace exists
echo -e "${YELLOW}Checking KV namespace...${NC}"
KV_NAMESPACE_ID=$(wrangler kv namespace list | grep -o '"id": "[^"]*"' | grep -o '[^"]*$' | head -1 || true)

if [ -z "$KV_NAMESPACE_ID" ]; then
    echo -e "${YELLOW}Creating KV namespace for OAuth codes...${NC}"
    wrangler kv namespace create "OAUTH_CODES"
    echo -e "${GREEN}KV namespace created!${NC}"
    echo -e "${YELLOW}Please update the KV namespace ID in wrangler.toml${NC}"
    echo "You can find the ID in the output above"
else
    echo -e "${GREEN}Using existing KV namespace: $KV_NAMESPACE_ID${NC}"
fi

# Deploy the worker
echo -e "${YELLOW}Deploying OAuth worker...${NC}"
wrangler deploy

# Get the deployed URL
WORKER_URL=$(wrangler deployments list | grep -o 'https://[^[:space:]]*' | head -1 || true)

if [ -n "$WORKER_URL" ]; then
    echo -e "${GREEN}✅ OAuth Worker deployed successfully!${NC}"
    echo -e "${GREEN}Worker URL: $WORKER_URL${NC}"
    echo ""
    echo -e "${YELLOW}Next steps:${NC}"
    echo "1. Update your .env file with:"
    echo "   VITE_USE_CLOUDFLARE_OAUTH=true"
    echo "   VITE_OAUTH_WORKER_URL=$WORKER_URL"
    echo ""
    echo "2. OAuth endpoints are available at:"
    echo "   - Authorization: $WORKER_URL/oauth/authorize"
    echo "   - Token: $WORKER_URL/oauth/token"
else
    echo -e "${GREEN}✅ OAuth Worker deployed successfully!${NC}"
    echo -e "${YELLOW}Check your Cloudflare dashboard for the worker URL${NC}"
fi