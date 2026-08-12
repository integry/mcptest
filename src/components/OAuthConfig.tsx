import React, { useState, useEffect } from 'react';
import {
  getOAuthCallbackUrl,
  loadManualOAuthClient,
  saveManualOAuthClient,
  type OAuthPrerequisite,
} from '../utils/oauthFlow';
import { beginHostedOAuthFlow } from '../utils/hostedOAuth';

interface OAuthConfigProps {
  serverUrl: string;
  onConfigured: () => void;
  onCancel: () => void;
  prerequisite?: OAuthPrerequisite;
  currentUser?: { getIdToken: () => Promise<string> } | null;
}

const OAuthConfig: React.FC<OAuthConfigProps> = ({
  serverUrl,
  onConfigured,
  onCancel,
  prerequisite,
  currentUser,
}) => {
  const [clientId, setClientId] = useState('');
  const [clientSecret, setClientSecret] = useState('');
  const [showSecret, setShowSecret] = useState(false);
  const [configurationError, setConfigurationError] = useState<string | null>(null);
  const [isStartingHosted, setIsStartingHosted] = useState(false);
  const serviceDomain = new URL(serverUrl).host;
  const callbackUrl = getOAuthCallbackUrl();
  const canConfigureClient = prerequisite?.canConfigureClient ?? true;
  const title = prerequisite?.kind === 'provider_approval_required'
    ? `${prerequisite.providerName} approval is required`
    : prerequisite?.kind === 'discovery_blocked_invalid'
      ? 'OAuth discovery could not be completed'
      : `Register an OAuth application for ${prerequisite?.providerName || serviceDomain}`;

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

  const handleHostedAuthorization = async () => {
    const proxyUrl = import.meta.env.VITE_PROXY_URL as string | undefined;
    if (!proxyUrl || !currentUser || !prerequisite?.issuer || !prerequisite.hostedProvider) {
      setConfigurationError('Sign in and use a deployment with the authenticated proxy configured to continue.');
      return;
    }
    setIsStartingHosted(true);
    setConfigurationError(null);
    try {
      await beginHostedOAuthFlow({
        serverUrl,
        issuer: prerequisite.issuer,
        resourceMetadataUrl: prerequisite.resourceMetadataUrl,
        scope: prerequisite.hostedScope,
        proxyUrl,
        firebaseToken: await currentUser.getIdToken(),
      });
    } catch (error) {
      setConfigurationError(error instanceof Error ? error.message : 'Hosted OAuth could not start.');
      setIsStartingHosted(false);
    }
  };

  return (
    <section className="card oauth-prerequisite-panel" role="region" aria-labelledby="oauth-config-title">
      <div className="card-body p-4">
        <div className="d-flex align-items-start justify-content-between gap-3 mb-3">
          <div>
            <h5 id="oauth-config-title" className="mb-2">{title}</h5>
            <p className="text-muted mb-0">
              {prerequisite?.explanation || `OAuth discovery found that ${serviceDomain} requires a pre-registered client.`}
            </p>
          </div>
          <button type="button" className="btn-close" onClick={onCancel} aria-label="Close"></button>
        </div>

        <p>
          mcptest.io connected without credentials first and only opened this panel after the MCP
          target returned an HTTP authentication challenge.
        </p>

        {prerequisite?.kind === 'provider_approval_required' && (
          <p>
            The advertised registration endpoint was attempted and returned
            {prerequisite.httpStatus ? ` HTTP ${prerequisite.httpStatus}` : ' a rejection'}.
            Supplying arbitrary client credentials is not expected to bypass provider approval.
          </p>
        )}

        {prerequisite?.kind === 'discovery_blocked_invalid' && (
          <p>
            Failing stage: <strong>{prerequisite.failedStage}</strong>. The exact URL, direct or proxy
            route, status, and sanitized response are available in the OAuth flight recorder.
          </p>
        )}

        {prerequisite && (
          <div className="oauth-prerequisite-details mb-4">
            <p className="mb-2"><strong>Redirect URI:</strong> <code>{callbackUrl}</code></p>
            <p className="mb-2">
              <strong>PKCE:</strong> {prerequisite.pkceS256
                ? 'S256 is advertised and will be used.'
                : 'S256 was not advertised in the readable authorization metadata.'}
            </p>
            <p className="mb-2">
              <strong>Scopes:</strong> {prerequisite.requiredScopes.length
                ? prerequisite.requiredScopes.join(', ')
                : 'The provider will determine the required scopes during authorization.'}
            </p>
            <p className="mb-0">
              <strong>Browser/public client secret:</strong>{' '}
              {prerequisite.publicClientSecretSupported === true
                ? 'A public client without a secret is supported by the advertised metadata.'
                : prerequisite.publicClientSecretSupported === false
                  ? 'The provider does not support safely keeping a client secret in a public browser client.'
                  : 'The provider metadata does not state that a secretless public client is supported.'}
            </p>
          </div>
        )}

        <div className="d-flex flex-wrap gap-2 mb-4">
          {prerequisite?.registrationUrl && (
            <a className="btn btn-outline-primary" href={prerequisite.registrationUrl} target="_blank" rel="noreferrer">
              Open provider registration
            </a>
          )}
          {prerequisite?.documentationUrl && (
            <a className="btn btn-outline-secondary" href={prerequisite.documentationUrl} target="_blank" rel="noreferrer">
              Read provider documentation
            </a>
          )}
        </div>

        {configurationError && (
          <div className="alert alert-danger" role="alert">{configurationError}</div>
        )}

        {prerequisite?.hostedProvider && (
          <div className="mb-4">
            <h6>Continue with mcptest.io hosted OAuth</h6>
            <p className="text-muted">
              The operator-owned {prerequisite.providerName} client secret stays in the Worker.
              Provider access and refresh tokens remain server-side and are usable only for this
              signed-in user and exact MCP target.
            </p>
            <button
              type="button"
              className="btn btn-primary"
              onClick={() => void handleHostedAuthorization()}
              disabled={isStartingHosted}
            >
              {isStartingHosted ? 'Opening provider authorization...' : `Authorize with ${prerequisite.providerName}`}
            </button>
          </div>
        )}

        {canConfigureClient && (
          <>
            <h6>Configure an existing client</h6>
            <p className="text-muted">
              Register <code>{callbackUrl}</code>, use Authorization Code with PKCE, and enter the
              resulting client information. It remains bound to this exact MCP resource and issuer.
            </p>

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
                Leave this empty only when the provider supports a secretless public client.
              </small>
            </div>

            <p className="text-muted small">
              Client information is stored only in this tab&apos;s session storage. A secret placed in
              browser storage is not confidential; do not use a production confidential-client secret.
            </p>

            <button type="button" className="btn btn-primary" onClick={handleSave} disabled={!clientId}>
              Save and continue
            </button>
          </>
        )}
      </div>
    </section>
  );
};

export default OAuthConfig;
