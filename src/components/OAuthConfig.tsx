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
  onBearerToken?: (token: string) => void | Promise<void>;
}

const OAuthConfig: React.FC<OAuthConfigProps> = ({
  serverUrl,
  onConfigured,
  onCancel,
  prerequisite,
  currentUser,
  onBearerToken,
}) => {
  const [clientId, setClientId] = useState('');
  const [bearerToken, setBearerToken] = useState('');
  const [configurationError, setConfigurationError] = useState<string | null>(null);
  const [isStartingHosted, setIsStartingHosted] = useState(false);
  const serviceDomain = new URL(serverUrl).host;
  const callbackUrl = getOAuthCallbackUrl();
  const isProxyAuthenticationPrerequisite = prerequisite?.kind === 'proxy_authentication_required';
  const canConfigureClient = !isProxyAuthenticationPrerequisite
    && (prerequisite?.canConfigureClient ?? true);
  const title = prerequisite?.kind === 'provider_approval_required'
    ? `${prerequisite.providerName} approval is required`
    : prerequisite?.kind === 'proxy_authentication_required'
      ? 'mcptest proxy authentication required'
      : prerequisite?.kind === 'transient_discovery_failure'
        ? 'OAuth discovery is temporarily unavailable'
    : prerequisite?.kind === 'discovery_blocked_invalid'
      ? 'OAuth discovery could not be completed'
      : prerequisite?.configurationMode === 'operator-confidential'
        ? `${prerequisite.providerName} host application required`
      : `Register an OAuth application for ${prerequisite?.providerName || serviceDomain}`;

  useEffect(() => {
    setClientId('');

    // Only load credentials bound to the authorization server discovered for this resource.
    const storedClient = loadManualOAuthClient(serverUrl);
    if (storedClient) {
      setClientId(storedClient.clientId);
    }
  }, [serverUrl]);

  const handleSave = () => {
    if (!clientId) {
      alert('Client ID is required');
      return;
    }
    
    try {
      saveManualOAuthClient(serverUrl, clientId);
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
          {prerequisite?.kind === 'proxy_authentication_required'
            ? 'mcptest.io opened this prerequisite only after the proxy returned its own authentication response. Target OAuth discovery has not started.'
            : 'mcptest.io connected without credentials first and only opened this panel after the MCP target returned an HTTP authentication challenge.'}
        </p>

        {prerequisite?.kind === 'provider_approval_required' && (
          <p>
            The advertised registration endpoint was attempted and returned
            {prerequisite.httpStatus ? ` HTTP ${prerequisite.httpStatus}` : ' a rejection'}.
            Supplying arbitrary ordinary OAuth credentials is not expected to bypass the provider&apos;s
            catalog approval. An approved client configuration must be explicitly provisioned by the
            mcptest operator before it can be used here.
          </p>
        )}

        {!isProxyAuthenticationPrerequisite
          && prerequisite?.configurationMode === 'operator-confidential' && (
          <div className="alert alert-info" role="note">
            This provider requires a fixed confidential host application. Its client secret and token
            exchange belong in operator-controlled server configuration; mcptest will not ask you to
            paste that secret into the browser or save it in browser storage.
          </div>
        )}

        {!isProxyAuthenticationPrerequisite && prerequisite?.supportsBearerToken && (
          <div className="oauth-bearer-option mb-4">
            <h6>Use a {prerequisite.bearerTokenName || 'bearer token'}</h6>
            <p className="mb-0">
              This provider supports a bearer token on the MCP request. The token stays in memory
              for the request and is not added to the URL or OAuth client storage.
            </p>
            {onBearerToken ? (
              <form
                className="mt-3"
                onSubmit={(event) => {
                  event.preventDefault();
                  const token = bearerToken.trim();
                  if (token) void onBearerToken(token);
                }}
              >
                <label className="form-label" htmlFor="oauth-prerequisite-bearer-token">
                  {prerequisite.bearerTokenName || 'Bearer token'}
                </label>
                <input
                  id="oauth-prerequisite-bearer-token"
                  className="form-control"
                  type="password"
                  value={bearerToken}
                  onChange={(event) => setBearerToken(event.target.value)}
                  autoComplete="new-password"
                  spellCheck={false}
                />
                <button className="btn btn-primary mt-3" type="submit" disabled={!bearerToken.trim()}>
                  Retry with bearer token
                </button>
              </form>
            ) : (
              <p className="mt-2 mb-0">
                Use the target <code>Authorization: Bearer …</code> credential option in Playground
                or Report.
              </p>
            )}
          </div>
        )}

        {prerequisite?.kind === 'discovery_blocked_invalid' && (
          <p>
            Failing stage: <strong>{prerequisite.failedStage}</strong>. The exact URL, direct or proxy
            route, status, and sanitized response are available in the OAuth flight recorder.
          </p>
        )}

        {prerequisite && prerequisite.kind !== 'proxy_authentication_required' && (
          <div className="oauth-prerequisite-details mb-4">
            <p className="mb-2"><strong>Redirect URI:</strong> <code>{callbackUrl}</code></p>
            <p className="mb-2">
              <strong>PKCE:</strong> {prerequisite.pkceS256
                ? 'S256 is advertised and will be used.'
                : 'S256 was not advertised in the readable authorization metadata.'}
            </p>
            <p className="mb-2">
              <strong>Scopes:</strong> {prerequisite.hostedProvider
                ? prerequisite.hostedScope
                  ? prerequisite.hostedScope.split(/\s+/).filter(Boolean).join(', ')
                  : 'The explicit operator policy will supply least-privilege scopes; advertised scopes are not requested automatically.'
                : prerequisite.requiredScopes.length
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

        {!isProxyAuthenticationPrerequisite && (
          <div className="d-flex flex-wrap gap-2 mb-4">
            {prerequisite?.registrationUrl && (
              <a className="btn btn-outline-primary" href={prerequisite.registrationUrl} target="_blank" rel="noreferrer">
                Open provider registration
              </a>
            )}
            {prerequisite?.documentationUrl && (
              <a className="btn btn-outline-secondary" href={prerequisite.documentationUrl} target="_blank" rel="noreferrer">
                {prerequisite.kind === 'provider_approval_required'
                  ? 'Read catalog and approval documentation'
                  : 'Read provider documentation'}
              </a>
            )}
          </div>
        )}

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
              public client ID. It remains bound to this exact MCP resource and issuer. Confidential
              clients must be configured by the operator instead.
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
            
            <p className="text-muted small">
              The public client ID is stored only in this tab&apos;s session storage. Client secrets are
              never accepted or persisted by this browser flow.
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
