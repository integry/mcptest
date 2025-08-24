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
      "http://localhost:5173/oauth/callback",
      "http://localhost:3000/oauth/callback",
      "https://mcptest.pages.dev/oauth/callback",
      "https://mcptest.integry.io/oauth/callback"
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