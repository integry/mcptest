import React, { useState, useEffect } from 'react';
import { getOAuthServiceName, OAUTH_SERVICES } from '../utils/oauthDiscovery';

interface OAuthConfigProps {
  serverUrl: string;
  onConfigured: () => void;
  onCancel: () => void;
}

const OAuthConfig: React.FC<OAuthConfigProps> = ({ serverUrl, onConfigured, onCancel }) => {
  const [clientId, setClientId] = useState('');
  const [clientSecret, setClientSecret] = useState('');
  const [showSecret, setShowSecret] = useState(false);
  const [serviceName, setServiceName] = useState<string | null>(null);
  const [serviceGuide, setServiceGuide] = useState<string>('');

  useEffect(() => {
    const name = getOAuthServiceName(serverUrl);
    setServiceName(name);
    
    // Load existing credentials if any
    const savedClientId = sessionStorage.getItem('oauth_client_id');
    if (savedClientId) {
      setClientId(savedClientId);
    }
    
    const savedClientSecret = sessionStorage.getItem('oauth_client_secret');
    if (savedClientSecret) {
      setClientSecret(savedClientSecret);
    }
    
    // Set service-specific guide
    if (name) {
      switch (name) {
        case 'GitHub':
          setServiceGuide(`
            To register your OAuth application with GitHub:
            1. Go to https://github.com/settings/developers
            2. Click "New OAuth App"
            3. Fill in:
               - Application name: MCP SSE Tester
               - Homepage URL: ${window.location.origin}
               - Authorization callback URL: ${window.location.origin}/oauth/callback
            4. Click "Register application"
            5. Copy the Client ID and Client Secret below
          `);
          break;
        case 'Google':
          setServiceGuide(`
            To register your OAuth application with Google:
            1. Go to https://console.cloud.google.com/apis/credentials
            2. Create a new OAuth 2.0 Client ID
            3. Choose "Web application"
            4. Add authorized redirect URI: ${window.location.origin}/oauth/callback
            5. Copy the Client ID and Client Secret below
          `);
          break;
        case 'Microsoft':
          setServiceGuide(`
            To register your OAuth application with Microsoft:
            1. Go to https://portal.azure.com/#blade/Microsoft_AAD_RegisteredApps/ApplicationsListBlade
            2. Click "New registration"
            3. Add redirect URI: ${window.location.origin}/oauth/callback (Web platform)
            4. Copy the Application (client) ID below
            5. Create a client secret under "Certificates & secrets"
          `);
          break;
        case 'Notion':
        case 'Notion MCP':
          setServiceGuide(`
            To register your OAuth application with Notion:
            1. Go to https://www.notion.so/my-integrations
            2. Click "New integration"
            3. Configure OAuth settings:
               - Redirect URI: ${window.location.origin}/oauth/callback
            4. Copy the OAuth client ID and secret below
          `);
          break;
        default:
          setServiceGuide(`
            To use OAuth with ${name}:
            1. Register your application in the service's developer portal
            2. Set the redirect URI to: ${window.location.origin}/oauth/callback
            3. Copy the client credentials below
          `);
      }
    } else {
      // Generic guide for any OAuth service
      const url = new URL(serverUrl);
      const serviceDomain = url.hostname;
      
      setServiceGuide(`
        OAuth 2.1 Authentication Required for ${serviceDomain}:
        
        This MCP server requires OAuth 2.1 authentication with PKCE.
        
        1. Register your application with the OAuth provider at ${serviceDomain}
        2. Configure the following settings:
           - Application Name: MCP SSE Tester (or your preferred name)
           - Application Type: Public (SPA/Native)
           - Redirect URI: ${window.location.origin}/oauth/callback
           - Grant Type: Authorization Code with PKCE
           - Scopes: As required by the service
        3. Copy the OAuth client credentials provided:
           - Client ID (required)
           - Client Secret (optional for public clients)
        4. Enter the credentials below to continue
        
        Note: This implementation follows OAuth 2.1 best practices with mandatory PKCE.
      `);
    }
  }, [serverUrl]);

  const handleSave = () => {
    if (!clientId) {
      alert('Client ID is required');
      return;
    }
    
    // Save credentials to session storage
    sessionStorage.setItem('oauth_client_id', clientId);
    if (clientSecret) {
      sessionStorage.setItem('oauth_client_secret', clientSecret);
    }
    
    onConfigured();
  };

  return (
    <div className="modal show d-block" style={{ backgroundColor: 'rgba(0,0,0,0.5)' }}>
      <div className="modal-dialog modal-lg">
        <div className="modal-content">
          <div className="modal-header">
            <h5 className="modal-title">
              OAuth 2.1 Manual Configuration {serviceName && `for ${serviceName}`}
            </h5>
            <button type="button" className="btn-close" onClick={onCancel}></button>
          </div>
          <div className="modal-body">
            <div className="alert alert-warning">
              <h6 className="alert-heading">⚠️ Manual Configuration Required</h6>
              <p className="mb-2">This OAuth provider does not support dynamic client registration (RFC7591).</p>
              <p className="mb-0">Per MCP specification, dynamic client registration is recommended for OAuth-enabled servers to allow seamless connection without manual configuration.</p>
            </div>
            
            <div className="alert alert-info">
              <h6 className="alert-heading">Setup Instructions</h6>
              <pre className="mb-0" style={{ whiteSpace: 'pre-wrap' }}>{serviceGuide.trim()}</pre>
            </div>
            
            <div className="mb-3">
              <label htmlFor="clientId" className="form-label">OAuth Client ID</label>
              <input
                type="text"
                className="form-control font-monospace"
                id="clientId"
                value={clientId}
                onChange={(e) => setClientId(e.target.value)}
                placeholder="Enter your OAuth client ID"
                autoComplete="off"
              />
            </div>
            
            <div className="mb-3">
              <label htmlFor="clientSecret" className="form-label">
                OAuth Client Secret 
                <span className="text-muted ms-2">(optional for public clients)</span>
              </label>
              <div className="input-group">
                <input
                  type={showSecret ? "text" : "password"}
                  className="form-control font-monospace"
                  id="clientSecret"
                  value={clientSecret}
                  onChange={(e) => setClientSecret(e.target.value)}
                  placeholder="Enter your OAuth client secret"
                  autoComplete="off"
                />
                <button
                  className="btn btn-outline-secondary"
                  type="button"
                  onClick={() => setShowSecret(!showSecret)}
                >
                  <i className={`bi bi-eye${showSecret ? '-slash' : ''}`}></i>
                </button>
              </div>
              <small className="text-muted">
                Some OAuth providers don't require a client secret for public clients (SPAs).
              </small>
            </div>
            
            <div className="alert alert-warning">
              <i className="bi bi-exclamation-triangle me-2"></i>
              <strong>Security Note:</strong> These credentials are stored in your browser's session storage 
              and will be cleared when you close the tab. Never share these credentials publicly.
            </div>
          </div>
          <div className="modal-footer">
            <button type="button" className="btn btn-secondary" onClick={onCancel}>
              Cancel
            </button>
            <button 
              type="button" 
              className="btn btn-primary" 
              onClick={handleSave}
              disabled={!clientId}
            >
              Save Configuration
            </button>
          </div>
        </div>
      </div>
    </div>
  );
};

export default OAuthConfig;