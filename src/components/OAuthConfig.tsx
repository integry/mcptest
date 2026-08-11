import React, { useState, useEffect } from 'react';
import { loadManualOAuthClient, saveManualOAuthClient } from '../utils/oauthFlow';

interface OAuthConfigProps {
  serverUrl: string;
  onConfigured: () => void;
  onCancel: () => void;
}

const OAuthConfig: React.FC<OAuthConfigProps> = ({ serverUrl, onConfigured, onCancel }) => {
  const [clientId, setClientId] = useState('');
  const [clientSecret, setClientSecret] = useState('');
  const [showSecret, setShowSecret] = useState(false);
  const [configurationError, setConfigurationError] = useState<string | null>(null);
  const serviceDomain = new URL(serverUrl).host;
  const callbackUrl = `${window.location.origin}/oauth/callback`;

  useEffect(() => {
    setClientId('');
    setClientSecret('');

    // Only load credentials bound to the authorization server discovered for this resource.
    const storedClient = loadManualOAuthClient(serverUrl);
    if (storedClient) {
      setClientId(storedClient.clientId);
      setClientSecret(storedClient.clientSecret || '');
    }
  }, [serverUrl]);

  const handleSave = () => {
    if (!clientId) {
      alert('Client ID is required');
      return;
    }
    
    try {
      saveManualOAuthClient(serverUrl, clientId, clientSecret || undefined);
      setConfigurationError(null);
      onConfigured();
    } catch (error) {
      setConfigurationError(
        error instanceof Error ? error.message : 'Could not save the OAuth client configuration.'
      );
    }
  };

  return (
    <div
      className="modal show d-block"
      style={{ backgroundColor: 'rgba(0,0,0,0.5)' }}
      role="dialog"
      aria-modal="true"
      aria-labelledby="oauth-config-title"
    >
      <div className="modal-dialog modal-lg">
        <div className="modal-content">
          <div className="modal-header">
            <h5 id="oauth-config-title" className="modal-title">
              Manual OAuth client setup
            </h5>
            <button type="button" className="btn-close" onClick={onCancel} aria-label="Close"></button>
          </div>
          <div className="modal-body">
            <div className="alert alert-warning">
              <h6 className="alert-heading">Automatic OAuth setup is unavailable for {serviceDomain}</h6>
              <p className="mb-2">
                mcptest.io first connected without credentials, received an authorization challenge,
                and completed OAuth provider discovery.
              </p>
              <p className="mb-0">
                The provider offers neither a usable Client ID Metadata path nor Dynamic Client
                Registration. A client registered with the provider is the remaining option.
              </p>
            </div>

            {configurationError && (
              <div className="alert alert-danger" role="alert">{configurationError}</div>
            )}
            
            <div className="mb-4">
              <h6>Register mcptest.io as a public OAuth client</h6>
              <ol className="mb-2">
                <li>Open the provider&apos;s developer or integration settings.</li>
                <li>Choose a public SPA/native client using Authorization Code with PKCE.</li>
                <li>
                  Add redirect URI <code>{callbackUrl}</code>.
                </li>
                <li>Copy the client ID below. Add a secret only if the provider requires one.</li>
              </ol>
              <p className="text-muted small mb-0">
                The credentials are bound to the authorization-server issuer already discovered for
                this MCP resource; they are not reused for other providers.
              </p>
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
              Save and continue
            </button>
          </div>
        </div>
      </div>
    </div>
  );
};

export default OAuthConfig;
