#!/bin/bash

# This script has been deprecated.
# The OAuth worker now fully supports RFC7591 Dynamic Client Registration.
# Clients should use the standard /oauth/register endpoint to register themselves.
#
# Example:
# curl -X POST https://oauth-worker.livecart.workers.dev/oauth/register \
#   -H "Content-Type: application/json" \
#   -d '{
#     "client_name": "MCP SSE Tester",
#     "redirect_uris": ["https://mcptest.io/oauth/callback"],
#     "grant_types": ["authorization_code"],
#     "response_types": ["code"],
#     "scope": "openid profile email",
#     "token_endpoint_auth_method": "none"
#   }'

echo "This script is deprecated. Use the standard /oauth/register endpoint for dynamic client registration."
echo "See RFC7591 and the MCP specification for details."