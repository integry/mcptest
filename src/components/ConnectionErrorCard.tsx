import React, { useId, useMemo, useState } from 'react';
import {
  generateHttpCurlCommand,
  generateBearerHttpCurlCommand,
  generateSseCurlCommand,
  type ConnectionAttemptFact,
  type ConnectionErrorDetails,
  type DiagnosticTransportEvidence,
} from '../utils/connectionDiagnostics';

interface ConnectionErrorCardProps {
  errorDetails: ConnectionErrorDetails;
  onRetry?: () => void;
  onDismiss?: () => void;
  useProxy?: boolean;
  showProxyOption?: boolean;
  onRetryWithProxy?: () => void;
}

interface Diagnosis {
  badge: string;
  heading: string;
  summary: string;
  alertClass: string;
}

const attemptResult = (attempt: ConnectionAttemptFact): string => {
  if (attempt.status !== undefined) {
    const responseSource = attempt.responseSource || attempt.authenticationSource;
    const owner = responseSource === 'target'
      ? ' from target'
      : responseSource === 'proxy'
        ? ' from mcptest proxy'
        : '';
    return `HTTP ${attempt.status}${owner}`;
  }
  switch (attempt.failureKind) {
    case 'browser-unreadable': return 'Browser response unreadable';
    case 'timeout': return 'Timed out';
    case 'abort': return 'Aborted';
    case 'refused': return 'Connection refused';
    case 'network': return 'Network failure';
    default: return attempt.message || 'Failed';
  }
};

const transportLabel = (transport?: ConnectionAttemptFact['transportType']): string => (
  transport === 'streamable-http' ? 'Streamable HTTP' : transport === 'legacy-sse' ? 'Legacy SSE' : 'Unknown'
);

const inferTransportEvidence = (
  explicit: DiagnosticTransportEvidence | undefined,
  attempts: readonly ConnectionAttemptFact[]
): DiagnosticTransportEvidence => {
  if (explicit) return explicit;
  const transports = new Set(attempts.map(({ transportType }) => transportType).filter(Boolean));
  if (transports.size > 1) return 'both';
  return [...transports][0] || 'unknown';
};

const diagnose = (errorDetails: ConnectionErrorDetails): Diagnosis => {
  const attempts = errorDetails.attempts || [];
  const targetAuthentication = attempts.find(({ authenticationSource, status }) => (
    authenticationSource === 'target' && status === 401
  ));
  if (targetAuthentication) {
    return {
      badge: 'OAuth',
      heading: 'OAuth authorization required',
      summary: 'The MCP target is reachable and returned its own OAuth challenge. mcptest will use that challenge for OAuth discovery.',
      alertClass: 'alert-info border-info',
    };
  }

  const proxyAuthentication = attempts.find(({ authenticationSource, status }) => (
    authenticationSource === 'proxy' && (status === 401 || status === 403)
  ));
  if (proxyAuthentication) {
    return {
      badge: 'Proxy login',
      heading: 'mcptest proxy authentication required',
      summary: 'The proxy requested an mcptest login before it could inspect the target. This is not a target OAuth response.',
      alertClass: 'alert-warning border-warning',
    };
  }

  const readableHttp = attempts.find(({ route, status, authenticationSource, responseSource }) => (
    status !== undefined
    && authenticationSource !== 'proxy'
    && (route === 'direct' || responseSource === 'target')
  ));
  if (readableHttp) {
    const observer = readableHttp.route === 'proxy'
      ? 'The authenticated proxy observed'
      : 'The browser received';
    return {
      badge: `HTTP ${readableHttp.status}`,
      heading: `MCP endpoint returned HTTP ${readableHttp.status}`,
      summary: `${observer} a readable response for the exact candidate endpoint. Diagnose the HTTP status and path rather than treating it as a CORS failure.`,
      alertClass: 'alert-danger border-danger',
    };
  }

  const directAttempts = attempts.filter(({ route }) => route === 'direct');
  const allDirectBrowserUnreadable = directAttempts.length > 0
    && directAttempts.every(({ browserUnreadable }) => browserUnreadable);
  if (allDirectBrowserUnreadable) {
    const knownOAuth = errorDetails.expectedAuthentication === 'oauth';
    const knownReachableOAuth = knownOAuth && errorDetails.serverReachable === true;
    return {
      badge: 'Browser / CORS',
      heading: knownReachableOAuth
        ? 'Browser access blocked / OAuth server reachable'
        : 'Browser access blocked',
      summary: knownReachableOAuth
        ? 'The browser could not inspect the cross-origin response. This endpoint is cataloged as OAuth-protected, so use the authenticated proxy or the terminal probe to observe its expected challenge.'
        : knownOAuth
          ? 'The browser could not inspect the cross-origin response. This endpoint is cataloged as OAuth-protected, but the browser evidence alone cannot establish current server reachability.'
        : 'Every direct browser attempt ended without a readable HTTP response. Cross-origin policy or a rejected preflight may be hiding the target response; this evidence does not show that the server is down.',
      alertClass: 'alert-warning border-warning',
    };
  }

  const failureKind = attempts[0]?.failureKind;
  if (failureKind === 'timeout') {
    return { badge: 'Timeout', heading: 'MCP connection timed out', summary: 'The attempt exceeded its connection deadline without a response.', alertClass: 'alert-danger border-danger' };
  }
  if (failureKind === 'abort') {
    return { badge: 'Aborted', heading: 'MCP connection aborted', summary: 'The connection was cancelled before it completed.', alertClass: 'alert-secondary border-secondary' };
  }
  if (failureKind === 'refused') {
    return { badge: 'Refused', heading: 'MCP connection refused', summary: 'The network path produced a concrete connection-refused failure.', alertClass: 'alert-danger border-danger' };
  }
  if (failureKind === 'network') {
    return { badge: 'Network', heading: 'MCP network connection failed', summary: 'The attempt produced a readable network-layer failure.', alertClass: 'alert-danger border-danger' };
  }

  return {
    badge: 'Connection error',
    heading: 'MCP server connection failed',
    summary: 'The MCP session could not be established. Review the candidate evidence below.',
    alertClass: 'alert-danger border-danger',
  };
};

const ConnectionErrorCard: React.FC<ConnectionErrorCardProps> = ({
  errorDetails,
  onRetry,
  onDismiss,
  useProxy,
  showProxyOption,
  onRetryWithProxy,
}) => {
  const [httpCurlCopied, setHttpCurlCopied] = useState(false);
  const [sseCurlCopied, setSseCurlCopied] = useState(false);
  const [bearerCurlCopied, setBearerCurlCopied] = useState(false);
  const headingId = useId();
  const attempts = errorDetails.attempts || [];
  const diagnosis = useMemo(() => diagnose(errorDetails), [errorDetails]);
  const transportEvidence = inferTransportEvidence(errorDetails.transportEvidence, attempts);
  const showHttpProbe = transportEvidence !== 'legacy-sse';
  const showSseProbe = transportEvidence !== 'streamable-http';
  const exploratory = transportEvidence === 'unknown';
  const browserBlocked = attempts.some(({ browserUnreadable }) => browserUnreadable)
    && attempts.filter(({ route }) => route === 'direct').every(({ browserUnreadable }) => browserUnreadable);
  const oauthExpected = errorDetails.expectedAuthentication === 'oauth'
    || attempts.some(({ authenticationSource, status }) => authenticationSource === 'target' && status === 401);
  const httpCurlCommand = generateHttpCurlCommand(errorDetails.serverUrl);
  const sseCurlCommand = generateSseCurlCommand(errorDetails.serverUrl);
  const bearerCurlCommand = errorDetails.supportsBearerToken
    ? generateBearerHttpCurlCommand(errorDetails.serverUrl)
    : undefined;

  const copyToClipboard = async (text: string, type: 'http' | 'sse' | 'bearer') => {
    try {
      await navigator.clipboard.writeText(text);
      if (type === 'http') {
        setHttpCurlCopied(true);
        setTimeout(() => setHttpCurlCopied(false), 2000);
      } else if (type === 'sse') {
        setSseCurlCopied(true);
        setTimeout(() => setSseCurlCopied(false), 2000);
      } else {
        setBearerCurlCopied(true);
        setTimeout(() => setBearerCurlCopied(false), 2000);
      }
    } catch (error) {
      console.error('Failed to copy connection diagnostic:', error);
    }
  };

  return (
    <section className={`alert ${diagnosis.alertClass} mb-3`} role="alert" aria-labelledby={headingId}>
      <div className="d-flex justify-content-between align-items-start gap-3">
        <div className="flex-grow-1 min-w-0">
          <div className="d-flex align-items-center flex-wrap gap-2 mb-2">
            <span className="badge bg-dark">{diagnosis.badge}</span>
            <small className="text-muted">{errorDetails.timestamp.toLocaleTimeString()}</small>
          </div>
          <h6 id={headingId} className="alert-heading">{diagnosis.heading}</h6>
          <p>{diagnosis.summary}</p>
          <div className="mb-3">
            <strong>Endpoint:</strong> <code className="text-break">{errorDetails.serverUrl}</code>
          </div>

          {attempts.length > 0 && (
            <div className="mb-3">
              <strong>Connection attempts</strong>
              <div className="table-responsive mt-1">
                <table className="table table-sm align-middle mb-0">
                  <caption className="visually-hidden">Connection candidates and observed outcomes</caption>
                  <thead>
                    <tr>
                      <th scope="col">Route</th>
                      <th scope="col">Candidate</th>
                      <th scope="col">Transport</th>
                      <th scope="col">Observed result</th>
                    </tr>
                  </thead>
                  <tbody>
                    {attempts.map((attempt, index) => (
                      <tr key={`${attempt.route}-${attempt.candidateUrl}-${attempt.transportType}-${index}`}>
                        <td>{attempt.route === 'proxy' ? 'Authenticated proxy' : 'Direct browser'}</td>
                        <td><code className="text-break">{attempt.candidateUrl}</code></td>
                        <td>{transportLabel(attempt.transportType)}</td>
                        <td>{attemptResult(attempt)}</td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            </div>
          )}

          <div className="mb-3">
            <strong>What to do next</strong>
            <ul className="mt-1 mb-0">
              {browserBlocked && !useProxy && showProxyOption && (
                <li>Enable <q>Automatically use proxy for CORS errors</q>, then retry so mcptest can inspect the target response.</li>
              )}
              {browserBlocked && useProxy && showProxyOption && (
                <li>Proxy fallback is enabled. Sign in to mcptest if the proxy login prerequisite is shown.</li>
              )}
              {browserBlocked && !showProxyOption && (
                <li>Use the exact terminal probe below or configure a trusted backend proxy to inspect the response outside the browser.</li>
              )}
              {!browserBlocked && attempts.some(({ failureKind }) => failureKind === 'http') && (
                <li>Verify that the publisher&apos;s exact MCP endpoint path matches the readable HTTP response.</li>
              )}
              {!browserBlocked && attempts.some(({ failureKind }) => failureKind === 'timeout') && (
                <li>Check target reachability and retry after confirming the service can respond within the connection deadline.</li>
              )}
              {!browserBlocked && attempts.some(({ failureKind }) => failureKind === 'refused') && (
                <li>Verify the host, port, firewall, and whether the MCP service is listening.</li>
              )}
              <li>Compare the exact endpoint&apos;s terminal response with the browser evidence below.</li>
            </ul>
          </div>

          <div className="mb-3">
            <strong>Terminal diagnostics</strong>
            {oauthExpected && showHttpProbe && (
              <p className="small mt-1 mb-2">
                Expected unauthenticated result: <strong>HTTP 401</strong> with a <code>WWW-Authenticate</code> Bearer challenge proves reachability and starts OAuth discovery. It is not an authenticated MCP session.
              </p>
            )}
            <div className="row mt-2 g-3">
              {showHttpProbe && (
                <div className={showSseProbe ? 'col-12 col-lg-6' : 'col-12'}>
                  <strong className="small">Streamable HTTP — exact endpoint (POST)</strong>
                  <div className="p-2 bg-light border rounded mt-1">
                    <pre className="mb-2 small text-wrap"><code>{httpCurlCommand}</code></pre>
                    <button type="button" className="btn btn-outline-secondary btn-sm" onClick={() => copyToClipboard(httpCurlCommand, 'http')} disabled={httpCurlCopied}>
                      {httpCurlCopied ? 'Copied!' : 'Copy HTTP curl'}
                    </button>
                    {bearerCurlCommand && (
                      <div className="mt-3 pt-3 border-top">
                        <strong className="small d-block mb-1">Bearer-token variant (placeholder only)</strong>
                        <pre className="mb-2 small text-wrap"><code>{bearerCurlCommand}</code></pre>
                        <button type="button" className="btn btn-outline-secondary btn-sm" onClick={() => copyToClipboard(bearerCurlCommand, 'bearer')} disabled={bearerCurlCopied}>
                          {bearerCurlCopied ? 'Copied!' : 'Copy bearer curl'}
                        </button>
                      </div>
                    )}
                  </div>
                </div>
              )}
              {showSseProbe && (
                <div className={showHttpProbe ? 'col-12 col-lg-6' : 'col-12'}>
                  <strong className="small">
                    {exploratory ? 'Exploratory legacy SSE — same exact endpoint (GET)' : 'Legacy SSE — exact endpoint (GET)'}
                  </strong>
                  <div className="p-2 bg-light border rounded mt-1">
                    <pre className="mb-2 small text-wrap"><code>{sseCurlCommand}</code></pre>
                    <button type="button" className="btn btn-outline-secondary btn-sm" onClick={() => copyToClipboard(sseCurlCommand, 'sse')} disabled={sseCurlCopied}>
                      {sseCurlCopied ? 'Copied!' : 'Copy SSE curl'}
                    </button>
                  </div>
                </div>
              )}
            </div>
            <small className="text-muted d-block mt-2">
              These commands preserve the endpoint exactly. They do not add a trailing slash, replace a custom path, or insert credentials.
            </small>
          </div>

          {(errorDetails.error || errorDetails.details) && (
            <details className="mb-2">
              <summary>Raw technical details</summary>
              <pre className="small bg-light border rounded p-2 mt-2 text-wrap mb-0"><code>
                {[errorDetails.error, errorDetails.details].filter(Boolean).join('\n\n')}
              </code></pre>
            </details>
          )}
        </div>
        {onDismiss && <button type="button" className="btn-close" aria-label="Close connection diagnostic" onClick={onDismiss} />}
      </div>

      {(onRetry || (browserBlocked && !useProxy && onRetryWithProxy)) && (
        <div className="d-flex flex-wrap gap-2 mt-3">
          {onRetry && <button type="button" className="btn btn-outline-secondary btn-sm" onClick={onRetry}>Retry connection</button>}
          {browserBlocked && !useProxy && onRetryWithProxy && (
            <button type="button" className="btn btn-primary btn-sm" onClick={onRetryWithProxy}>Enable proxy and retry</button>
          )}
        </div>
      )}
    </section>
  );
};

export default ConnectionErrorCard;
