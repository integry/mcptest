// OAuth 2.1 Cloudflare Worker for handling authorization callbacks
// This worker replaces the localhost Express server for OAuth flows

export default {
  async fetch(request, env, ctx) {
    const url = new URL(request.url);
    
    // CORS headers for cross-origin requests
    const corsHeaders = {
      'Access-Control-Allow-Origin': '*',
      'Access-Control-Allow-Methods': 'GET, POST, OPTIONS',
      'Access-Control-Allow-Headers': 'Content-Type, Authorization',
      'Access-Control-Max-Age': '86400',
    };

    // Handle preflight OPTIONS requests
    if (request.method === 'OPTIONS') {
      return new Response(null, {
        status: 200,
        headers: corsHeaders
      });
    }

    // Route handling
    try {
      if (url.pathname === '/oauth/authorize' && request.method === 'GET') {
        return handleAuthorize(request, url, corsHeaders, env);
      } else if (url.pathname === '/oauth/token' && request.method === 'POST') {
        return handleToken(request, corsHeaders, env);
      } else {
        return new Response('Not Found', { 
          status: 404,
          headers: corsHeaders 
        });
      }
    } catch (error) {
      console.error('Worker error:', error);
      return new Response(JSON.stringify({ error: 'internal_server_error' }), {
        status: 500,
        headers: { ...corsHeaders, 'Content-Type': 'application/json' }
      });
    }
  },
};

// Handle OAuth authorization endpoint
async function handleAuthorize(request, url, corsHeaders, env) {
  console.log('[OAuth Worker] Authorization request received:', url.searchParams.toString());
  
  const searchParams = url.searchParams;
  const response_type = searchParams.get('response_type');
  const client_id = searchParams.get('client_id');
  const redirect_uri = searchParams.get('redirect_uri');
  const code_challenge = searchParams.get('code_challenge');
  const code_challenge_method = searchParams.get('code_challenge_method');
  const scope = searchParams.get('scope');
  const state = searchParams.get('state');
  
  // Basic validation
  if (response_type !== 'code') {
    return new Response(JSON.stringify({ error: 'unsupported_response_type' }), {
      status: 400,
      headers: { ...corsHeaders, 'Content-Type': 'application/json' }
    });
  }
  
  if (!client_id || !redirect_uri || !code_challenge) {
    return new Response(JSON.stringify({ 
      error: 'invalid_request', 
      error_description: 'Missing required parameters' 
    }), {
      status: 400,
      headers: { ...corsHeaders, 'Content-Type': 'application/json' }
    });
  }
  
  // Generate authorization code
  const code = generateRandomString(32);
  
  // Store authorization code data in KV (expires in 10 minutes)
  const authData = {
    client_id,
    redirect_uri,
    code_challenge,
    code_challenge_method: code_challenge_method || 'S256',
    scope: scope || 'openid profile email',
    created_at: Date.now()
  };
  
  // Store in KV with 10-minute expiration
  await env.OAUTH_CODES.put(
    `auth_code:${code}`, 
    JSON.stringify(authData),
    { expirationTtl: 600 } // 10 minutes
  );
  
  // Redirect back to client with authorization code
  const redirectUrl = new URL(redirect_uri);
  redirectUrl.searchParams.set('code', code);
  if (state) {
    redirectUrl.searchParams.set('state', state);
  }
  
  console.log('[OAuth Worker] Redirecting with code to:', redirectUrl.toString());
  
  return Response.redirect(redirectUrl.toString(), 302);
}

// Handle OAuth token endpoint
async function handleToken(request, corsHeaders, env) {
  console.log('[OAuth Worker] Token request received');
  
  let body;
  try {
    body = await request.json();
  } catch (e) {
    return new Response(JSON.stringify({ 
      error: 'invalid_request', 
      error_description: 'Invalid JSON body' 
    }), {
      status: 400,
      headers: { ...corsHeaders, 'Content-Type': 'application/json' }
    });
  }
  
  console.log('[OAuth Worker] Token request body:', body);
  
  const { 
    grant_type, 
    code, 
    redirect_uri, 
    client_id,
    code_verifier 
  } = body;
  
  // Basic validation
  if (grant_type !== 'authorization_code') {
    return new Response(JSON.stringify({ error: 'unsupported_grant_type' }), {
      status: 400,
      headers: { ...corsHeaders, 'Content-Type': 'application/json' }
    });
  }
  
  if (!code || !redirect_uri || !client_id || !code_verifier) {
    return new Response(JSON.stringify({ 
      error: 'invalid_request', 
      error_description: 'Missing required parameters' 
    }), {
      status: 400,
      headers: { ...corsHeaders, 'Content-Type': 'application/json' }
    });
  }
  
  // Retrieve stored authorization code data
  const storedDataJson = await env.OAUTH_CODES.get(`auth_code:${code}`);
  
  if (!storedDataJson) {
    return new Response(JSON.stringify({ 
      error: 'invalid_grant', 
      error_description: 'Invalid authorization code' 
    }), {
      status: 400,
      headers: { ...corsHeaders, 'Content-Type': 'application/json' }
    });
  }
  
  const storedData = JSON.parse(storedDataJson);
  
  // Check if code has expired (older than 10 minutes)
  if (Date.now() - storedData.created_at > 600000) {
    await env.OAUTH_CODES.delete(`auth_code:${code}`);
    return new Response(JSON.stringify({ 
      error: 'invalid_grant', 
      error_description: 'Authorization code expired' 
    }), {
      status: 400,
      headers: { ...corsHeaders, 'Content-Type': 'application/json' }
    });
  }
  
  // Validate client_id and redirect_uri match
  if (storedData.client_id !== client_id || storedData.redirect_uri !== redirect_uri) {
    return new Response(JSON.stringify({ 
      error: 'invalid_grant', 
      error_description: 'Client or redirect URI mismatch' 
    }), {
      status: 400,
      headers: { ...corsHeaders, 'Content-Type': 'application/json' }
    });
  }
  
  // Validate PKCE code_verifier
  const challenge = await sha256Base64Url(code_verifier);
  
  if (challenge !== storedData.code_challenge) {
    return new Response(JSON.stringify({ 
      error: 'invalid_grant', 
      error_description: 'PKCE verification failed' 
    }), {
      status: 400,
      headers: { ...corsHeaders, 'Content-Type': 'application/json' }
    });
  }
  
  // Delete used authorization code
  await env.OAUTH_CODES.delete(`auth_code:${code}`);
  
  // Generate access token (in production, use proper JWT)
  const access_token = generateRandomString(32);
  const refresh_token = generateRandomString(32);
  
  // Store tokens in KV for validation (optional, for production use)
  await env.OAUTH_CODES.put(
    `access_token:${access_token}`,
    JSON.stringify({
      client_id,
      scope: storedData.scope,
      created_at: Date.now()
    }),
    { expirationTtl: 3600 } // 1 hour
  );
  
  console.log('[OAuth Worker] Token issued successfully');
  
  // Return tokens
  return new Response(JSON.stringify({
    access_token,
    token_type: 'Bearer',
    expires_in: 3600,
    refresh_token,
    scope: storedData.scope
  }), {
    status: 200,
    headers: { ...corsHeaders, 'Content-Type': 'application/json' }
  });
}

// Generate random string for codes and tokens
function generateRandomString(length) {
  const array = new Uint8Array(length);
  crypto.getRandomValues(array);
  return btoa(String.fromCharCode(...array))
    .replace(/\+/g, '-')
    .replace(/\//g, '_')
    .replace(/=/g, '');
}

// SHA256 hash function for PKCE verification
async function sha256Base64Url(text) {
  const encoder = new TextEncoder();
  const data = encoder.encode(text);
  const hash = await crypto.subtle.digest('SHA-256', data);
  const base64 = btoa(String.fromCharCode(...new Uint8Array(hash)));
  return base64
    .replace(/\+/g, '-')
    .replace(/\//g, '_')
    .replace(/=/g, '');
}