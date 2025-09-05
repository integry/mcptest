import React, { useEffect } from 'react';
import { useLocation, useNavigate } from 'react-router-dom';
import { oauthConfig, getOAuthServerType } from '../config/oauth';

const OAuthCallback: React.FC = () => {
  const location = useLocation();
  const navigate = useNavigate();

  // Helper function to add log entries to sessionStorage for the main app to retrieve
  const addOAuthLog = (type: 'info' | 'error' | 'warning', message: string) => {
    const logs = JSON.parse(sessionStorage.getItem('oauth_callback_logs') || '[]');
    logs.push({
      type,
      message,
      timestamp: new Date().toISOString()
    });
    sessionStorage.setItem('oauth_callback_logs', JSON.stringify(logs));
  };

  useEffect(() => {
    const handleOAuthCallback = async () => {
      // Clear previous logs
      sessionStorage.setItem('oauth_callback_logs', '[]');
      
      addOAuthLog('info', '🔄 OAuth Callback: Processing authorization response...');
      
      const params = new URLSearchParams(location.search);
      const code = params.get('code');
      const error = params.get('error');
      const errorDescription = params.get('error_description');
      const codeVerifier = sessionStorage.getItem('pkce_code_verifier');
      const serverUrl = sessionStorage.getItem('oauth_server_url');
      // Get client ID from server-specific registration only
      const serverHost = serverUrl ? new URL(serverUrl).host : '';
      const dynamicClientKey = `oauth_client_${serverHost}`;
      const dynamicClientData = sessionStorage.getItem(dynamicClientKey);
      let clientId: string | null = null;
      let clientSecret: string | null = null;
      
      // Check for server-specific client (either dynamically registered or manually configured)
      if (dynamicClientData) {
        try {
          const parsedClient = JSON.parse(dynamicClientData);
          clientId = parsedClient.clientId;
          clientSecret = parsedClient.clientSecret;
          const registrationType = parsedClient.registeredManually ? 'manually configured' : 'dynamically registered';
          addOAuthLog('info', `📋 Using ${registrationType} client for ${serverHost}: ${clientId}`);
        } catch (e) {
          addOAuthLog('warning', '⚠️ Failed to parse server-specific client data');
        }
      } else {
        addOAuthLog('error', `❌ No OAuth client credentials found for ${serverHost}`);
      }
      
      
      // Log received parameters
      addOAuthLog('info', `📄 Callback parameters:\n  - Authorization code: ${code ? `${code.substring(0, 10)}...` : 'Not provided'}\n  - Error: ${error || 'None'}\n  - Error description: ${errorDescription || 'None'}\n  - PKCE verifier stored: ${codeVerifier ? 'Yes' : 'No'}\n  - PKCE verifier value: ${codeVerifier ? `${codeVerifier.substring(0, 10)}...` : 'Not found'}\n  - Server URL stored: ${serverUrl || 'Not found'}\n  - Client ID stored: ${clientId}`);
      
      // Check for authorization errors
      if (error) {
        addOAuthLog('error', `❌ Authorization failed: ${error}\n  - Description: ${errorDescription || 'No description provided'}`);
        navigate('/', { 
          state: { 
            oauthError: `Authorization failed: ${error}`,
            oauthErrorDetails: errorDescription 
          } 
        });
        return;
      }

      if (code && codeVerifier && serverUrl) {
        addOAuthLog('info', '✅ All required parameters present, proceeding with token exchange...');
        
        try {
          // Get saved OAuth endpoints from discovery (per server)
          const serverHost = serverUrl ? new URL(serverUrl).host : '';
          const savedEndpoints = sessionStorage.getItem(`oauth_endpoints_${serverHost}`);
          let tokenUrl = oauthConfig.tokenEndpoint; // Default fallback
          let supportsPKCE = true;
          let customHeaders: Record<string, string> = {};
          
          if (savedEndpoints) {
            try {
              const endpoints = JSON.parse(savedEndpoints);
              tokenUrl = endpoints.tokenEndpoint;
              supportsPKCE = endpoints.supportsPKCE ?? true;
              customHeaders = endpoints.customHeaders || {};
              addOAuthLog('info', `📋 Using discovered OAuth endpoints:\n  - Token endpoint: ${tokenUrl}\n  - PKCE support: ${supportsPKCE ? 'Yes' : 'No'}`);
            } catch (e) {
              addOAuthLog('warning', '⚠️ Failed to parse saved OAuth endpoints, using defaults');
            }
          }
          
          addOAuthLog('info', `🔑 Step 1/3: Preparing token exchange request:\n  - Server Type: ${getOAuthServerType()}\n  - Token endpoint: ${tokenUrl}\n  - Grant type: authorization_code\n  - Client ID: ${clientId}\n  - Redirect URI: ${oauthConfig.redirectUri}\n  - Code verifier length: ${codeVerifier.length} chars`);
          
          const requestBody: any = {
            grant_type: 'authorization_code',
            code,
            redirect_uri: oauthConfig.redirectUri,
            client_id: clientId,
          };
          
          // OAuth 2.1 requires PKCE - always include code_verifier
          if (codeVerifier) {
            requestBody.code_verifier = codeVerifier;
          }
          
          // Include client_secret if available (for confidential clients)
          if (clientSecret) {
            requestBody.client_secret = clientSecret;
            addOAuthLog('info', '🔑 Including client_secret in token request (confidential client)');
          } else {
            addOAuthLog('info', '🔓 No client_secret provided (public client)');
          }
          
          addOAuthLog('info', '📤 Step 2/3: Sending POST request to token endpoint...');
          
          const formData = new URLSearchParams();
          Object.entries(requestBody).forEach(([key, value]) => {
            formData.append(key, value);
          });
          
          const tokenResponse = await fetch(tokenUrl, {
            method: 'POST',
            headers: { 
              'Content-Type': 'application/x-www-form-urlencoded',
              ...customHeaders // Include any service-specific headers
            },
            body: formData.toString(),
          });
          
          addOAuthLog('info', `📥 Token endpoint response: ${tokenResponse.status} ${tokenResponse.statusText}`);

          if (tokenResponse.ok) {
            addOAuthLog('info', '✅ Step 3/3: Token exchange successful!');
            
            const tokenData = await tokenResponse.json();
            const { access_token, refresh_token, expires_in, token_type } = tokenData;
            
            addOAuthLog('info', `🎉 Tokens received:\n  - Access token: ${access_token ? `${access_token.substring(0, 20)}...` : 'Not provided'}\n  - Refresh token: ${refresh_token ? 'Yes' : 'No'}\n  - Token type: ${token_type || 'Bearer'}\n  - Expires in: ${expires_in ? `${expires_in} seconds` : 'Not specified'}`);
            
            // Store tokens per server
            const serverHost = serverUrl ? new URL(serverUrl).host : '';
            sessionStorage.setItem(`oauth_access_token_${serverHost}`, access_token);
            if (refresh_token) {
              sessionStorage.setItem(`oauth_refresh_token_${serverHost}`, refresh_token);
            }
            sessionStorage.removeItem('pkce_code_verifier');
            
            // Mark OAuth as completed to prevent immediate re-authentication
            sessionStorage.setItem('oauth_completed_time', Date.now().toString());
            
            addOAuthLog('info', '💾 Tokens stored in session storage, cleaning up PKCE verifier...');
            addOAuthLog('info', '✅ OAuth flow completed successfully! Redirecting...');
            
            // Check if we have a stored return view state
            const returnViewJson = sessionStorage.getItem('oauth_return_view');
            let targetPath = '/'; // Default to home
            
            if (returnViewJson) {
              try {
                const returnView = JSON.parse(returnViewJson);
                addOAuthLog('info', `🔄 Returning to ${returnView.activeView} view`);
                
                // Don't clear the return view here - let App.tsx handle it after navigation
                // This ensures the view state is available when App.tsx processes the OAuth success
              } catch (e) {
                addOAuthLog('warning', '⚠️ Failed to parse return view state');
              }
            }
            
            // Redirect with success message - App.tsx will handle the actual navigation based on return view
            navigate(targetPath, { state: { oauthSuccess: true } });
          } else {
            addOAuthLog('error', `❌ Step 3/3 FAILED: Token exchange failed with status ${tokenResponse.status}`);
            
            const errorData = await tokenResponse.text();
            console.error('Failed to exchange authorization code for token:', errorData);
            
            // Try to parse error data as JSON if possible
            let errorDetails = errorData;
            try {
              const errorJson = JSON.parse(errorData);
              errorDetails = JSON.stringify(errorJson, null, 2);
            } catch (e) {
              // Keep as plain text if not JSON
            }
            
            // Log response headers for debugging
            const responseHeaders = Array.from(tokenResponse.headers.entries())
              .map(([key, value]) => `    ${key}: ${value}`)
              .join('\n');
            
            addOAuthLog('error', `📋 Error details:\n  - Status: ${tokenResponse.status} ${tokenResponse.statusText}\n  - Headers:\n${responseHeaders}\n  - Body: ${errorDetails}`);
            
            // Provide more specific error message based on status code
            let errorMessage = 'Failed to obtain access token';
            if (tokenResponse.status === 401) {
              errorMessage = 'Authentication failed: Invalid client credentials or authorization code';
              addOAuthLog('error', '🔒 401 Unauthorized: This typically means the client credentials or authorization code are invalid');
            } else if (tokenResponse.status === 400) {
              errorMessage = 'Bad request: Invalid OAuth parameters';
              addOAuthLog('error', '📝 400 Bad Request: Check that all OAuth parameters are correct');
            } else if (tokenResponse.status === 403) {
              errorMessage = 'Forbidden: The server rejected the token request';
              addOAuthLog('error', '🚫 403 Forbidden: The server explicitly rejected this request');
            }
            
            navigate('/', { state: { 
              oauthError: errorMessage,
              oauthErrorDetails: errorData 
            } });
          }
        } catch (error) {
          console.error('Error during token exchange:', error);
          addOAuthLog('error', `💥 Network or processing error during token exchange:\n  - Error: ${error instanceof Error ? error.message : 'Unknown error'}\n  - This might be due to CORS restrictions, network issues, or server problems`);
          navigate('/', { state: { oauthError: 'Error during authentication' } });
        }
      } else {
        console.error('Missing required OAuth callback parameters');
        addOAuthLog('error', `❌ Missing required OAuth callback parameters:\n  - Authorization code: ${code ? 'Present' : 'MISSING'}\n  - PKCE verifier: ${codeVerifier ? 'Present' : 'MISSING'}\n  - Server URL: ${serverUrl ? 'Present' : 'MISSING'}`);
        navigate('/', { state: { oauthError: 'Invalid authentication response' } });
      }
    };

    handleOAuthCallback();
  }, [location, navigate]);

  return (
    <div className="container-fluid vh-100 d-flex align-items-center justify-content-center">
      <div className="text-center">
        <div className="spinner-border text-primary mb-3" role="status">
          <span className="visually-hidden">Loading...</span>
        </div>
        <h4>Processing authentication...</h4>
        <p className="text-muted">Please wait while we complete the authentication process.</p>
      </div>
    </div>
  );
};

export default OAuthCallback;