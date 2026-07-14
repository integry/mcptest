# OAuth Dashboard Card Fix

## Issue
OAuth executions saved to dashboard cards were not working properly:
- "Authentication Required" warning shown on cards
- "Authorize Again" button failed with error: "Failed to start OAuth reauthorization: OAuth client credentials not configured"
- OAuth tokens were not being saved or authentication was not attempted

## Root Cause
When users view saved dashboard cards, the OAuth client credentials (client_id and client_secret) may not be configured in their session. The `handleReauthorizeCard` function was immediately throwing an error when credentials were missing.

## Solution
1. Modified `handleReauthorizeCard` in App.tsx to check for OAuth credentials
2. If credentials are missing, the function now:
   - Stores the pending reauth information (spaceId, cardId, serverUrl)
   - Shows the OAuth configuration modal
   - After user provides credentials, automatically continues with the reauth flow

## Changes Made
1. Added OAuth config states to App.tsx:
   - `needsOAuthConfig`: boolean to control modal visibility
   - `oauthConfigServerUrl`: string to store the server URL for configuration

2. Modified `handleReauthorizeCard` function:
   - Added check for missing client credentials
   - Instead of throwing error, now shows OAuth config modal
   - Stores pending reauth info in sessionStorage

3. Added OAuth config modal rendering:
   - Modal appears when credentials are needed
   - After configuration, automatically continues reauth flow
   - Proper cleanup of pending reauth data

## Testing
1. Create an OAuth-protected execution and save to dashboard
2. Clear browser session/use different browser
3. Load the dashboard with saved OAuth card
4. Click "Authorize Again" button
5. OAuth config modal should appear
6. After providing credentials, OAuth flow should continue automatically