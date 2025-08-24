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

    // Add CORS headers for all responses
    const corsHeaders = {
      'Access-Control-Allow-Origin': 'https://mcptest.io',
      'Access-Control-Allow-Methods': 'GET, POST, OPTIONS',
      'Access-Control-Allow-Headers': 'Content-Type, Authorization',
      'Access-Control-Max-Age': '86400',
    };

    // Handle OPTIONS preflight requests
    if (request.method === 'OPTIONS') {
      return new Response(null, {
        status: 200,
        headers: corsHeaders
      });
    }

    // Handle client setup/check endpoint
    if (url.pathname == "/oauth/check-client") {
      try {
        const urlParams = new URLSearchParams(url.search);
        const clientId = urlParams.get('client_id');
        const redirectUri = urlParams.get('redirect_uri');
        
        if (clientId === "mcptest-client" && redirectUri) {
          // Check if the redirect URI is valid for mcptest.io domain
          const redirectUrl = new URL(redirectUri);
          const isValidRedirect = redirectUrl.hostname === 'mcptest.io' || 
                                  redirectUrl.hostname.endsWith('.mcptest.io');
          
          if (!isValidRedirect || redirectUrl.pathname !== '/oauth/callback') {
            return new Response(JSON.stringify({ 
              error: 'invalid_redirect_uri',
              error_description: 'Invalid redirect URI - must be https://*.mcptest.io/oauth/callback'
            }), {
              status: 400,
              headers: { 
                "Content-Type": "application/json",
                ...corsHeaders
              }
            });
          }
          
          // Check if client exists
          try {
            const clientInfo = await env.OAUTH_PROVIDER.lookupClient(clientId);
            // Check if this redirect URI needs to be added
            if (!clientInfo.redirectUris.includes(redirectUri)) {
              clientInfo.redirectUris.push(redirectUri);
              await env.OAUTH_PROVIDER.updateClient(clientId, clientInfo);
            }
            return new Response(JSON.stringify({ 
              success: true,
              client_exists: true,
              message: 'Client exists and redirect URI is registered'
            }), {
              status: 200,
              headers: { 
                "Content-Type": "application/json",
                ...corsHeaders
              }
            });
          } catch (error) {
            // Client doesn't exist, create it
            console.log('[OAuth Worker] Creating mcptest-client for:', redirectUri);
            await env.OAUTH_PROVIDER.createClient({
              clientId: "mcptest-client",
              clientName: "MCP SSE Tester",
              redirectUris: [redirectUri],
              publicClient: true,
              grantTypes: ["authorization_code"],
              responseTypes: ["code"],
              scope: "openid profile email"
            });
            return new Response(JSON.stringify({ 
              success: true,
              client_exists: true,
              message: 'Client created successfully'
            }), {
              status: 200,
              headers: { 
                "Content-Type": "application/json",
                ...corsHeaders
              }
            });
          }
        }
        
        return new Response(JSON.stringify({ 
          error: 'invalid_request',
          error_description: 'Invalid client_id or missing redirect_uri'
        }), {
          status: 400,
          headers: { 
            "Content-Type": "application/json",
            ...corsHeaders
          }
        });
      } catch (error) {
        console.error('[OAuth Worker] Check client error:', error);
        return new Response(JSON.stringify({ 
          error: 'server_error',
          error_description: error.message 
        }), {
          status: 500,
          headers: { 
            "Content-Type": "application/json",
            ...corsHeaders
          }
        });
      }
    }

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
          headers: { 
            "Content-Type": "application/json",
            ...corsHeaders
          }
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


    // Initialize mcptest-client endpoint
    if (url.pathname == "/init-client" && request.method === "POST") {
      try {
        // Check if client already exists
        try {
          await env.OAUTH_PROVIDER.lookupClient('mcptest-client');
          return new Response(JSON.stringify({ 
            success: true,
            message: 'Client already exists'
          }), {
            status: 200,
            headers: { 
              "Content-Type": "application/json",
              ...corsHeaders
            }
          });
        } catch (e) {
          // Client doesn't exist, create it
          await env.OAUTH_PROVIDER.createClient({
            clientId: "mcptest-client",
            clientName: "MCP SSE Tester",
            redirectUris: [
              "https://mcptest.io/oauth/callback",
              "https://app.mcptest.io/oauth/callback",
              "https://staging.mcptest.io/oauth/callback"
            ],
            publicClient: true,
            grantTypes: ["authorization_code"],
            responseTypes: ["code"],
            scope: "openid profile email"
          });
          
          return new Response(JSON.stringify({ 
            success: true,
            message: 'Client created successfully'
          }), {
            status: 201,
            headers: { 
              "Content-Type": "application/json",
              ...corsHeaders
            }
          });
        }
      } catch (error) {
        console.error('[OAuth Worker] Init client error:', error);
        return new Response(JSON.stringify({ 
          error: 'server_error',
          error_description: error.message 
        }), {
          status: 500,
          headers: { 
            "Content-Type": "application/json",
            ...corsHeaders
          }
        });
      }
    }

    // Debug endpoint to check OAuth provider state
    if (url.pathname == "/debug/oauth-state") {
      try {
        // Try to list all clients (this might not work depending on the library)
        const debugInfo = {
          timestamp: new Date().toISOString(),
          kvNamespace: env.OAUTH_KV ? 'Connected' : 'Not connected',
          oauthProvider: env.OAUTH_PROVIDER ? 'Initialized' : 'Not initialized'
        };
        
        // Try to look up mcptest-client
        try {
          const client = await env.OAUTH_PROVIDER.lookupClient('mcptest-client');
          debugInfo.mcptestClient = {
            exists: true,
            redirectUris: client.redirectUris || []
          };
        } catch (e) {
          debugInfo.mcptestClient = {
            exists: false,
            error: e.message
          };
        }
        
        return new Response(JSON.stringify(debugInfo, null, 2), {
          status: 200,
          headers: { 
            "Content-Type": "application/json",
            ...corsHeaders
          }
        });
      } catch (error) {
        return new Response(JSON.stringify({ 
          error: 'debug_error',
          message: error.message 
        }), {
          status: 500,
          headers: { 
            "Content-Type": "application/json",
            ...corsHeaders
          }
        });
      }
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