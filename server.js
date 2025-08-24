const express = require('express');
const path = require('path');
const crypto = require('crypto');
const app = express();
const PORT = process.env.PORT || 3000;

// Middleware for parsing JSON bodies
app.use(express.json());

// Serve static files
app.use(express.static(path.join(__dirname)));

// In-memory storage for OAuth codes (in production, use a database)
const authorizationCodes = new Map();

// OAuth 2.1 Authorization endpoint
app.get('/oauth/authorize', (req, res) => {
  console.log('[OAuth Server] Authorization request received:', req.query);
  
  const { 
    response_type, 
    client_id, 
    redirect_uri, 
    code_challenge,
    code_challenge_method,
    scope,
    state 
  } = req.query;
  
  // Basic validation
  if (response_type !== 'code') {
    return res.status(400).json({ error: 'unsupported_response_type' });
  }
  
  if (!client_id || !redirect_uri || !code_challenge) {
    return res.status(400).json({ error: 'invalid_request', error_description: 'Missing required parameters' });
  }
  
  // Generate authorization code
  const code = crypto.randomBytes(32).toString('base64url');
  
  // Store code with associated data (expires in 10 minutes)
  authorizationCodes.set(code, {
    client_id,
    redirect_uri,
    code_challenge,
    code_challenge_method: code_challenge_method || 'S256',
    scope: scope || 'openid profile email',
    expires: Date.now() + 10 * 60 * 1000
  });
  
  // Redirect back to client with authorization code
  const redirectUrl = new URL(redirect_uri);
  redirectUrl.searchParams.set('code', code);
  if (state) {
    redirectUrl.searchParams.set('state', state);
  }
  
  console.log('[OAuth Server] Redirecting with code to:', redirectUrl.toString());
  res.redirect(redirectUrl.toString());
});

// OAuth 2.1 Token endpoint
app.post('/oauth/token', (req, res) => {
  console.log('[OAuth Server] Token request received:', req.body);
  
  const { 
    grant_type, 
    code, 
    redirect_uri, 
    client_id,
    code_verifier 
  } = req.body;
  
  // Basic validation
  if (grant_type !== 'authorization_code') {
    return res.status(400).json({ error: 'unsupported_grant_type' });
  }
  
  if (!code || !redirect_uri || !client_id || !code_verifier) {
    return res.status(400).json({ error: 'invalid_request', error_description: 'Missing required parameters' });
  }
  
  // Retrieve stored authorization code
  const storedData = authorizationCodes.get(code);
  
  if (!storedData) {
    return res.status(400).json({ error: 'invalid_grant', error_description: 'Invalid authorization code' });
  }
  
  // Check if code has expired
  if (Date.now() > storedData.expires) {
    authorizationCodes.delete(code);
    return res.status(400).json({ error: 'invalid_grant', error_description: 'Authorization code expired' });
  }
  
  // Validate client_id and redirect_uri match
  if (storedData.client_id !== client_id || storedData.redirect_uri !== redirect_uri) {
    return res.status(400).json({ error: 'invalid_grant', error_description: 'Client or redirect URI mismatch' });
  }
  
  // Validate PKCE code_verifier
  const challenge = crypto
    .createHash('sha256')
    .update(code_verifier)
    .digest('base64url');
    
  if (challenge !== storedData.code_challenge) {
    return res.status(400).json({ error: 'invalid_grant', error_description: 'PKCE verification failed' });
  }
  
  // Remove used code
  authorizationCodes.delete(code);
  
  // Generate access token (in production, use proper JWT)
  const access_token = crypto.randomBytes(32).toString('base64url');
  const refresh_token = crypto.randomBytes(32).toString('base64url');
  
  console.log('[OAuth Server] Token issued successfully');
  
  // Return tokens
  res.json({
    access_token,
    token_type: 'Bearer',
    expires_in: 3600,
    refresh_token,
    scope: storedData.scope
  });
});

// Serve index.html for root path and SPA routes
app.get('/', (req, res) => {
  res.sendFile(path.join(__dirname, 'index.html'));
});

// Handle OAuth callback route for SPA
app.get('/oauth/callback', (req, res) => {
  res.sendFile(path.join(__dirname, 'index.html'));
});

// Start server
app.listen(PORT, () => {
  console.log(`MCP SSE Tester server running at http://localhost:${PORT}`);
  console.log(`Access the tester by opening the above URL in your browser`);
  console.log(`OAuth endpoints available at:`);
  console.log(`  - Authorization: http://localhost:${PORT}/oauth/authorize`);
  console.log(`  - Token: http://localhost:${PORT}/oauth/token`);
});
