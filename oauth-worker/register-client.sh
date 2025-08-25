#!/bin/bash

# Register mcptest-client using the OAuth 2.0 Dynamic Client Registration endpoint

echo "Registering mcptest-client via dynamic registration endpoint..."

response=$(curl -X POST https://oauth-worker.livecart.workers.dev/oauth/register \
  -H "Content-Type: application/json" \
  -d '{
    "client_name": "MCP SSE Tester",
    "redirect_uris": [
      "https://mcptest.io/oauth/callback",
      "https://app.mcptest.io/oauth/callback",
      "https://staging.mcptest.io/oauth/callback"
    ],
    "grant_types": ["authorization_code"],
    "response_types": ["code"],
    "scope": "openid profile email",
    "token_endpoint_auth_method": "none"
  }' \
  -s)

echo "Response:"
echo "$response" | jq .

# Extract client_id if successful
client_id=$(echo "$response" | jq -r '.client_id // empty')
if [ -n "$client_id" ]; then
  echo -e "\nClient registered successfully!"
  echo "Client ID: $client_id"
  echo -e "\nIMPORTANT: Update your frontend configuration to use this client ID instead of 'mcptest-client'"
else
  echo -e "\nRegistration failed. Check the response above for errors."
fi