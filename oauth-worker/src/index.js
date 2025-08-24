import { OAuthProvider } from "@cloudflare/workers-oauth-provider";
import { WorkerEntrypoint } from "cloudflare:workers";

// API handler for authorized requests
class ApiHandler extends WorkerEntrypoint {
  fetch(request) {
    let url = new URL(request.url);
    
    // For this MCP test application, we don't have actual API endpoints
    // Just return a simple response for demonstration
    if (url.pathname.startsWith("/api/")) {
      return new Response(JSON.stringify({
        message: "API endpoint accessed",
        user: this.ctx.props,
        path: url.pathname
      }), {
        headers: { "Content-Type": "application/json" }
      });
    }

    return new Response("Not found", { status: 404 });
  }
}

// Default handler for non-API requests and authorization flow
const defaultHandler = {
  async fetch(request, env, ctx) {
    let url = new URL(request.url);

    // Handle the authorization UI
    if (url.pathname == "/oauth/authorize") {
      try {
        // Parse the OAuth authorization request
        let oauthReqInfo = await env.OAUTH_PROVIDER.parseAuthRequest(request);
        
        // Auto-register mcptest-client if it doesn't exist
        if (oauthReqInfo.clientId === "mcptest-client") {
          // Check if the redirect URI is valid for mcptest.io domain
          const redirectUrl = new URL(oauthReqInfo.redirectUri);
          const isValidRedirect = redirectUrl.hostname === 'mcptest.io' || 
                                  redirectUrl.hostname.endsWith('.mcptest.io');
          
          if (!isValidRedirect || redirectUrl.pathname !== '/oauth/callback') {
            throw new Error('Invalid redirect URI - must be https://*.mcptest.io/oauth/callback');
          }
          
          try {
            // Try to look up the client first
            await env.OAUTH_PROVIDER.lookupClient(oauthReqInfo.clientId);
          } catch (error) {
            // Client doesn't exist, create it automatically with the specific redirect URI
            console.log('[OAuth Worker] Auto-registering mcptest-client for:', oauthReqInfo.redirectUri);
            await env.OAUTH_PROVIDER.createClient({
              clientId: "mcptest-client",
              clientName: "MCP SSE Tester",
              redirectUris: [
                oauthReqInfo.redirectUri  // Use the actual redirect URI from the request
              ],
              publicClient: true,
              grantTypes: ["authorization_code"],
              responseTypes: ["code"],
              scope: "openid profile email"
            });
          }
          
          // Check if we need to add this redirect URI to existing client
          try {
            const clientInfo = await env.OAUTH_PROVIDER.lookupClient(oauthReqInfo.clientId);
            if (!clientInfo.redirectUris.includes(oauthReqInfo.redirectUri)) {
              // Add the new redirect URI to the existing client
              console.log('[OAuth Worker] Adding new redirect URI to mcptest-client:', oauthReqInfo.redirectUri);
              clientInfo.redirectUris.push(oauthReqInfo.redirectUri);
              await env.OAUTH_PROVIDER.updateClient(oauthReqInfo.clientId, clientInfo);
            }
          } catch (updateError) {
            console.error('Failed to update client redirect URIs:', updateError);
          }
        }
        
        // Look up client information
        let clientInfo = await env.OAUTH_PROVIDER.lookupClient(oauthReqInfo.clientId);
        
        // For this simplified implementation, auto-approve the authorization
        // In a real application, you would render a consent UI here
        console.log('[OAuth Worker] Authorization request:', {
          clientId: oauthReqInfo.clientId,
          redirectUri: oauthReqInfo.redirectUri,
          scope: oauthReqInfo.scope,
          state: oauthReqInfo.state
        });
        
        // Complete the authorization
        let { redirectTo } = await env.OAUTH_PROVIDER.completeAuthorization({
          request: oauthReqInfo,
          userId: "mcptest-user", // Static user ID for this test application
          metadata: {
            authorized_at: new Date().toISOString(),
            client_name: clientInfo.clientName || oauthReqInfo.clientId
          },
          scope: oauthReqInfo.scope || ["openid", "profile", "email"],
          props: {
            userId: "mcptest-user",
            username: "MCP Test User",
            email: "user@mcptest.example.com"
          }
        });

        console.log('[OAuth Worker] Redirecting to:', redirectTo);
        return Response.redirect(redirectTo, 302);
      } catch (error) {
        console.error('[OAuth Worker] Authorization error:', error);
        return new Response(JSON.stringify({ 
          error: 'server_error',
          error_description: error.message 
        }), {
          status: 500,
          headers: { "Content-Type": "application/json" }
        });
      }
    }

    // Handle client registration UI (if needed)
    if (url.pathname == "/oauth/register-client") {
      // In a real application, you would have a UI for client registration
      // For now, we'll create a simple client registration endpoint
      return new Response(`
        <html>
          <body>
            <h1>Client Registration</h1>
            <p>Use the OAuthHelpers API to register clients programmatically.</p>
          </body>
        </html>
      `, {
        headers: { "Content-Type": "text/html" }
      });
    }


    return new Response("Not found", { status: 404 });
  }
};

// Export the OAuthProvider as the Worker entrypoint
export default new OAuthProvider({
  // API routes - for this test app, we'll use /api/ prefix
  apiRoute: "/api/",
  
  // API handler
  apiHandler: ApiHandler,
  
  // Default handler for non-API requests
  defaultHandler: defaultHandler,
  
  // OAuth endpoints
  authorizeEndpoint: "/oauth/authorize",
  tokenEndpoint: "/oauth/token",
  
  // Optional: Dynamic client registration endpoint
  clientRegistrationEndpoint: "/oauth/register",
  
  // Supported scopes
  scopesSupported: ["openid", "profile", "email"],
  
  // Disable implicit flow (following OAuth 2.1 best practices)
  allowImplicitFlow: false,
  
  // Allow public client registration for SPAs like our MCP tester
  disallowPublicClientRegistration: false
});

// Helper function to create the initial client (can be called separately)
export async function setupClient(env) {
  // Create the MCP test client if it doesn't exist
  const clientId = "mcptest-client";
  
  try {
    // Check if client already exists
    const existingClient = await env.OAUTH_PROVIDER.lookupClient(clientId);
    if (existingClient) {
      console.log('Client already exists:', clientId);
      return;
    }
  } catch (error) {
    // Client doesn't exist, create it
  }
  
  // Create the client
  await env.OAUTH_PROVIDER.createClient({
    clientId: clientId,
    clientName: "MCP SSE Tester",
    redirectUris: [
      "https://mcptest.io/oauth/callback"
    ],
    // Public client (no secret) for SPA
    publicClient: true,
    grantTypes: ["authorization_code"],
    responseTypes: ["code"],
    scope: "openid profile email",
    logoUri: "https://mcptest.pages.dev/logo.png",
    policyUri: "https://mcptest.pages.dev/privacy",
    tosUri: "https://mcptest.pages.dev/terms"
  });
  
  console.log('Client created:', clientId);
}