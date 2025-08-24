import React, { useEffect } from 'react';
import { useLocation, useNavigate } from 'react-router-dom';

const OAuthCallback: React.FC = () => {
  const location = useLocation();
  const navigate = useNavigate();

  useEffect(() => {
    const handleOAuthCallback = async () => {
      const params = new URLSearchParams(location.search);
      const code = params.get('code');
      const codeVerifier = sessionStorage.getItem('pkce_code_verifier');
      const serverUrl = sessionStorage.getItem('oauth_server_url');

      if (code && codeVerifier && serverUrl) {
        try {
          // Derive token endpoint from server URL
          const tokenUrl = `${serverUrl}/oauth/token`;
          
          const tokenResponse = await fetch(tokenUrl, {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({
              grant_type: 'authorization_code',
              code,
              redirect_uri: `${window.location.origin}/oauth/callback`,
              client_id: 'mcptest-client',
              code_verifier: codeVerifier,
            }),
          });

          if (tokenResponse.ok) {
            const { access_token, refresh_token } = await tokenResponse.json();
            sessionStorage.setItem('oauth_access_token', access_token);
            if (refresh_token) {
              sessionStorage.setItem('oauth_refresh_token', refresh_token);
            }
            sessionStorage.removeItem('pkce_code_verifier');
            
            // Redirect to home page with success message
            navigate('/', { state: { oauthSuccess: true } });
          } else {
            const errorData = await tokenResponse.text();
            console.error('Failed to exchange authorization code for token:', errorData);
            
            // Provide more specific error message based on status code
            let errorMessage = 'Failed to obtain access token';
            if (tokenResponse.status === 401) {
              errorMessage = 'Authentication failed: Invalid client credentials or authorization code';
            } else if (tokenResponse.status === 400) {
              errorMessage = 'Bad request: Invalid OAuth parameters';
            }
            
            navigate('/', { state: { 
              oauthError: errorMessage,
              oauthErrorDetails: errorData 
            } });
          }
        } catch (error) {
          console.error('Error during token exchange:', error);
          navigate('/', { state: { oauthError: 'Error during authentication' } });
        }
      } else {
        console.error('Missing required OAuth callback parameters');
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