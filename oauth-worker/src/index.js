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
    // Note: In production, you should restrict Access-Control-Allow-Origin to specific domains
    // For MCP compatibility, we allow all origins to support dynamic client registration from any domain
    const corsHeaders = {
      'Access-Control-Allow-Origin': '*', // Required for MCP dynamic client registration from any domain
      'Access-Control-Allow-Methods': 'GET, POST, OPTIONS',
      'Access-Control-Allow-Headers': 'Content-Type, Authorization, MCP-Protocol-Version',
      'Access-Control-Max-Age': '86400',
    };

    // Handle OPTIONS preflight requests
    if (request.method === 'OPTIONS') {
      return new Response(null, {
        status: 200,
        headers: corsHeaders
      });
    }
    
    // Handle OAuth 2.0 Authorization Server Metadata (RFC8414)
    if (url.pathname === "/.well-known/oauth-authorization-server") {
      const baseUrl = `${url.protocol}//${url.host}`;
      
      const metadata = {
        issuer: baseUrl,
        authorization_endpoint: `${baseUrl}/oauth/authorize`,
        token_endpoint: `${baseUrl}/oauth/token`,
        registration_endpoint: `${baseUrl}/oauth/register`,
        scopes_supported: ["openid", "profile", "email"],
        response_types_supported: ["code"],
        response_modes_supported: ["query"],
        grant_types_supported: ["authorization_code"],
        code_challenge_methods_supported: ["S256"],
        token_endpoint_auth_methods_supported: ["none"], // Public clients only
        service_documentation: "https://mcptest.io/docs",
        ui_locales_supported: ["en"],
      };
      
      return new Response(JSON.stringify(metadata, null, 2), {
        status: 200,
        headers: {
          'Content-Type': 'application/json',
          ...corsHeaders
        }
      });
    }

    // Note: Non-standard endpoints /oauth/check-client and /oauth/ensure-client
    // have been removed to ensure OAuth 2.1 compliance.
    // Clients should use the standard /oauth/register endpoint for dynamic client registration.

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
          state: oauthReqInfo.state,
          codeChallenge: oauthReqInfo.codeChallenge,
          codeChallengeMethod: oauthReqInfo.codeChallengeMethod
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

        console.log('[OAuth Worker] Authorization completed, redirecting to:', redirectTo);
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

    // Handle dynamic client registration endpoint (RFC7591)
    if (url.pathname == "/oauth/register") {
      // Handle OPTIONS preflight for CORS
      if (request.method === 'OPTIONS') {
        return new Response(null, {
          status: 200,
          headers: corsHeaders
        });
      }
      
      if (request.method !== 'POST') {
        return new Response(JSON.stringify({
          error: 'invalid_request',
          error_description: 'Only POST method is allowed for client registration'
        }), {
          status: 405,
          headers: {
            'Content-Type': 'application/json',
            ...corsHeaders
          }
        });
      }
      
      try {
        const registrationRequest = await request.json();
        console.log('[OAuth Worker] Dynamic client registration request:', registrationRequest);
        
        // Validate required fields per RFC7591
        if (!registrationRequest.redirect_uris || !Array.isArray(registrationRequest.redirect_uris) || registrationRequest.redirect_uris.length === 0) {
          return new Response(JSON.stringify({
            error: 'invalid_client_metadata',
            error_description: 'redirect_uris is required and must be a non-empty array'
          }), {
            status: 400,
            headers: {
              'Content-Type': 'application/json',
              ...corsHeaders
            }
          });
        }
        
        // Generate a unique client ID
        const clientId = `mcp_${Date.now()}_${Math.random().toString(36).substring(2, 9)}`;
        
        // Create the client
        const clientData = {
          clientId: clientId,
          clientName: registrationRequest.client_name || 'MCP Client',
          redirectUris: registrationRequest.redirect_uris,
          publicClient: true, // MCP clients are public clients
          grantTypes: registrationRequest.grant_types || ['authorization_code'],
          responseTypes: registrationRequest.response_types || ['code'],
          scope: registrationRequest.scope || 'openid profile email',
          tokenEndpointAuthMethod: 'none', // Public client
          clientUri: registrationRequest.client_uri,
          logoUri: registrationRequest.logo_uri,
          tosUri: registrationRequest.tos_uri,
          policyUri: registrationRequest.policy_uri
        };
        
        // Register the client with the OAuth provider
        await env.OAUTH_PROVIDER.createClient(clientData);
        
        console.log('[OAuth Worker] Client registered successfully:', clientId);
        
        // Return the registration response per RFC7591
        const registrationResponse = {
          client_id: clientId,
          client_id_issued_at: Math.floor(Date.now() / 1000),
          redirect_uris: registrationRequest.redirect_uris,
          grant_types: clientData.grantTypes,
          response_types: clientData.responseTypes,
          scope: clientData.scope,
          token_endpoint_auth_method: 'none',
          client_name: clientData.clientName,
          client_uri: registrationRequest.client_uri,
          logo_uri: registrationRequest.logo_uri,
          tos_uri: registrationRequest.tos_uri,
          policy_uri: registrationRequest.policy_uri
        };
        
        return new Response(JSON.stringify(registrationResponse), {
          status: 201,
          headers: {
            'Content-Type': 'application/json',
            'Cache-Control': 'no-store',
            'Pragma': 'no-cache',
            ...corsHeaders
          }
        });
      } catch (error) {
        console.error('[OAuth Worker] Registration error:', error);
        return new Response(JSON.stringify({
          error: 'server_error',
          error_description: error.message
        }), {
          status: 500,
          headers: {
            'Content-Type': 'application/json',
            ...corsHeaders
          }
        });
      }
    }


    // Note: Debug endpoints have been removed for production deployment.
    // This ensures OAuth 2.1 compliance and security best practices.

    
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
  
  // Allow public client registration for SPAs per MCP specification
  disallowPublicClientRegistration: false,
  
  // Enable dynamic client registration per RFC7591 and MCP spec
  dynamicClientRegistration: true,
  
  // Custom error handler to log more details
  onError: ({ code, description, status, headers }) => {
    console.error(`[OAuth Worker] Error response: ${status} ${code} - ${description}`);
    
    // Log additional details for PKCE errors
    if (code === 'invalid_grant' && description.includes('PKCE')) {
      console.error('[OAuth Worker] PKCE verification failed. This usually means:');
      console.error('  1. The code_verifier sent to /token doesn\'t match the code_challenge from /authorize');
      console.error('  2. The authorization code was used with a different session');
      console.error('  3. The PKCE parameters were not properly stored between requests');
    }
  }
});

// Note: The setupClient helper function has been removed.
// Clients should use the standard /oauth/register endpoint for dynamic client registration
// as specified in RFC7591 and the MCP specification.