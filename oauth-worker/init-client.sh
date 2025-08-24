#!/bin/bash

# Initialize the mcptest-client in the OAuth worker
# Run this once after deploying the OAuth worker

echo "Initializing mcptest-client..."

response=$(curl -X POST https://oauth-worker.livecart.workers.dev/init-client \
  -H "Content-Type: application/json" \
  -s)

echo "Response: $response"

# Also check the debug endpoint
echo -e "\nChecking OAuth state..."
curl -s https://oauth-worker.livecart.workers.dev/debug/oauth-state | jq .