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
      'Access-Control-Allow-Origin': '*', // Allow any origin for dynamic client registration
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

    // Special endpoint to get or create mcptest client
    if (url.pathname == "/oauth/ensure-client") {
      try {
        // Use the existing client ID that we know works
        // This was created via dynamic registration and has the correct redirect URIs
        const clientId = "5iA4IxGmFOIEau2p";
        
        // Verify the client exists
        try {
          const client = await env.OAUTH_PROVIDER.lookupClient(clientId);
          
          return new Response(JSON.stringify({
            clientId: clientId,
            clientName: client.clientName || "MCP SSE Tester",
            redirectUris: client.redirectUris || [
              "https://mcptest.io/oauth/callback",
              "https://app.mcptest.io/oauth/callback",
              "https://staging.mcptest.io/oauth/callback"
            ]
          }), {
            status: 200,
            headers: { 
              "Content-Type": "application/json",
              ...corsHeaders
            }
          });
        } catch (lookupError) {
          // If client doesn't exist, return error
          throw new Error(`Client ${clientId} not found. Please use the dynamic registration endpoint.`);
        }
      } catch (error) {
        console.error('[OAuth Worker] Ensure client error:', error);
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



    // Debug endpoint to test PKCE
    if (url.pathname == "/debug/pkce-test") {
      try {
        const testVerifier = url.searchParams.get('verifier');
        const testChallenge = url.searchParams.get('challenge');
        
        if (!testVerifier || !testChallenge) {
          return new Response(JSON.stringify({
            error: 'Missing parameters',
            usage: 'Add ?verifier=XXX&challenge=YYY to test PKCE'
          }), {
            status: 400,
            headers: { 
              "Content-Type": "application/json",
              ...corsHeaders
            }
          });
        }
        
        // Test PKCE verification
        const encoder = new TextEncoder();
        const data = encoder.encode(testVerifier);
        const digest = await crypto.subtle.digest('SHA-256', data);
        const computedChallenge = btoa(String.fromCharCode(...new Uint8Array(digest)))
          .replace(/\+/g, '-')
          .replace(/\//g, '_')
          .replace(/=/g, '');
        
        const matches = computedChallenge === testChallenge;
        
        return new Response(JSON.stringify({
          verifier: testVerifier,
          providedChallenge: testChallenge,
          computedChallenge: computedChallenge,
          matches: matches,
          verifierLength: testVerifier.length,
          challengeLength: testChallenge.length
        }, null, 2), {
          status: 200,
          headers: { 
            "Content-Type": "application/json",
            ...corsHeaders
          }
        });
      } catch (error) {
        return new Response(JSON.stringify({ 
          error: 'pkce_test_error',
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

    // Debug endpoint to check OAuth provider state
    if (url.pathname == "/debug/oauth-state") {
      try {
        // Try to list all clients (this might not work depending on the library)
        const debugInfo = {
          timestamp: new Date().toISOString(),
          kvNamespace: env.OAUTH_KV ? 'Connected' : 'Not connected',
          oauthProvider: env.OAUTH_PROVIDER ? 'Initialized' : 'Not initialized',
          kvKeys: []
        };
        
        // List all KV keys to see what's stored
        try {
          const list = await env.OAUTH_KV.list();
          debugInfo.kvKeys = list.keys.map(k => ({ 
            name: k.name, 
            metadata: k.metadata 
          }));
          
          // Get the actual data for each client
          debugInfo.kvClients = {};
          for (const key of list.keys) {
            if (key.name.startsWith('client:')) {
              try {
                const data = await env.OAUTH_KV.get(key.name);
                debugInfo.kvClients[key.name] = JSON.parse(data);
              } catch (e) {
                debugInfo.kvClients[key.name] = { error: e.message };
              }
            }
          }
        } catch (e) {
          debugInfo.kvListError = e.message;
        }
        
        // Try to look up mcptest-client
        try {
          const client = await env.OAUTH_PROVIDER.lookupClient('mcptest-client');
          debugInfo.mcptestClient = {
            exists: true,
            client: client,
            redirectUris: client?.redirectUris || []
          };
        } catch (e) {
          debugInfo.mcptestClient = {
            exists: false,
            error: e.message
          };
          
          // Try direct KV lookup
          try {
            const kvData = await env.OAUTH_KV.get('client:mcptest-client');
            if (kvData) {
              debugInfo.kvDirectLookup = {
                found: true,
                data: JSON.parse(kvData)
              };
            } else {
              debugInfo.kvDirectLookup = {
                found: false
              };
            }
          } catch (kvError) {
            debugInfo.kvDirectLookup = {
              error: kvError.message
            };
          }
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