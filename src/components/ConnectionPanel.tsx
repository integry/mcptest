import React, { useState, useEffect } from 'react';
import ConnectionErrorCard from './ConnectionErrorCard';
import { TransportType } from '../types';
import { getServerUrl } from '../utils/urlUtils';
import { useShare } from '../hooks/useShare';
import { useAuth } from '../context/AuthContext';

// List of suggested servers to randomly select from
const SUGGESTED_SERVERS = [
  'mcp.context7.com',
  'mcp.deepwiki.com',
  'mcp.api.coingecko.com'
];

interface ConnectionPanelProps {
  serverUrl: string;
  setServerUrl: (url: string) => void;
  connectionStatus: string;
  transportType: TransportType | null;
  isConnecting: boolean;
  isConnected: boolean;
  isDisconnected: boolean;
  connectionStartTime: Date | null;
  recentServers: string[];
  handleConnect: () => void;
  handleDisconnect: () => void;
  handleAbortConnection: () => void;
  connectionError?: { error: string; serverUrl: string; timestamp: Date; details?: string } | null;
  clearConnectionError?: () => void;
  useProxy?: boolean;
  setUseProxy?: (useProxy: boolean) => void;
  isProxied?: boolean; // New prop
  useOAuth?: boolean;
  setUseOAuth?: (useOAuth: boolean) => void;
  isAuthFlowActive?: boolean;
  oauthProgress?: string;
  oauthUserInfo?: any; // User info from OAuth
  isOAuthConnection?: boolean; // Whether current connection uses OAuth
}

const ConnectionPanel: React.FC<ConnectionPanelProps> = ({
  serverUrl,
  setServerUrl,
  connectionStatus,
  transportType,
  isConnecting,
  isConnected,
  isDisconnected,
  connectionStartTime,
  recentServers,
  handleConnect,
  handleDisconnect,
  handleAbortConnection,
  connectionError,
  clearConnectionError,
  useProxy,
  setUseProxy,
  isProxied, // Destructure new prop
  useOAuth,
  setUseOAuth,
  isAuthFlowActive,
  oauthProgress,
  oauthUserInfo,
  isOAuthConnection,
}) => {
  const [connectionTimer, setConnectionTimer] = useState(0);
  const [placeholder] = useState(() => {
    const randomIndex = Math.floor(Math.random() * SUGGESTED_SERVERS.length);
    return SUGGESTED_SERVERS[randomIndex];
  });
  const [showUserInfoModal, setShowUserInfoModal] = useState(false);
  const { share, shareStatus, shareMessage } = useShare();
  const { currentUser } = useAuth();

  // Update timer every second while connecting
  useEffect(() => {
    let interval: NodeJS.Timeout;
    if (isConnecting && connectionStartTime) {
      interval = setInterval(() => {
        const elapsed = Math.floor((Date.now() - connectionStartTime.getTime()) / 1000);
        setConnectionTimer(elapsed);
      }, 1000);
    } else {
      setConnectionTimer(0);
    }
    return () => {
      if (interval) clearInterval(interval);
    };
  }, [isConnecting, connectionStartTime]);

  // Handle share button click
  const handleShareConnection = () => {
    if (!serverUrl) return;
    
    // Normalize the server URL - remove protocol if present
    const normalizedUrl = serverUrl.replace(/^https?:\/\//, '');
    
    // Determine transport method based on transportType
    const transportMethod = transportType === 'legacy-sse' ? 'sse' : 
                          transportType === 'streamable-http' ? 'mcp' : 
                          undefined;
    
    // Generate share URL
    const shareUrl = `${window.location.origin}${getServerUrl(normalizedUrl, transportMethod)}`;
    
    share({
      url: shareUrl,
      title: `MCP Connection: ${serverUrl}`,
      text: `Connect to MCP server at ${serverUrl}`,
    });
  };
  // Debug OAuth state
  useEffect(() => {
    console.log('[ConnectionPanel Debug] OAuth state:', {
      isConnected,
      useOAuth,
      isAuthFlowActive,
      oauthUserInfo,
      oauthProgress,
      isOAuthConnection
    });
  }, [isConnected, useOAuth, isAuthFlowActive, oauthUserInfo, oauthProgress, isOAuthConnection]);

  // Return JSX directly without outer parentheses
  return (
    <>
      <div className={`card mb-3 ${isConnected ? 'border-success' : ''}`} style={{ marginTop: '0', minHeight: '200px' }}>
      <div className={`card-header d-flex justify-content-between align-items-center ${isConnected ? 'bg-success bg-opacity-10' : ''}`}>
        <h5 className="mb-0">Server Connection</h5>
        <div className="d-flex align-items-center gap-2">
          {transportType && <span className={`badge ${transportType === 'streamable-http' ? 'bg-success' : 'bg-primary'} me-2`}>{transportType === 'streamable-http' ? 'HTTP' : 'SSE'}</span>}
          {isProxied && isConnected && <span className="badge bg-warning text-dark">Proxy</span>}
          {isConnected && isOAuthConnection && (
            <div className="d-flex align-items-center gap-1">
              <span className="badge bg-secondary text-white d-flex align-items-center gap-1">
                <i className="bi bi-shield-lock"></i>
                OAuth
                {oauthUserInfo ? (
                  <>
                    {oauthUserInfo.picture && (
                      <img
                        src={oauthUserInfo.picture}
                        alt="User avatar"
                        className="rounded-circle"
                        style={{ width: '16px', height: '16px' }}
                      />
                    )}
                    <span className="small">
                      {oauthUserInfo.name || oauthUserInfo.email || 'User'}
                    </span>
                  </>
                ) : (
                  <span className="small">Authenticated</span>
                )}
              </span>
              <button
                className="btn btn-sm btn-link text-decoration-none p-0"
                onClick={() => setShowUserInfoModal(true)}
                title={oauthUserInfo ? "View detailed OAuth user info" : "View OAuth session info"}
              >
                <i className="bi bi-info-circle"></i>
              </button>
            </div>
          )}
          <div aria-live="polite" className="d-inline-block">
            <span id="connectionStatus" className={`badge bg-${isConnected ? 'success' : (connectionStatus === 'Error' ? 'danger' : 'secondary')}`}>
              {connectionStatus}
            </span>
          </div>
          {isConnected && (
            <div className="position-relative">
              <button
                type="button"
                className="btn btn-sm btn-outline-secondary py-0"
                onClick={handleShareConnection}
                title="Share connection link"
                disabled={shareStatus !== 'idle'}
              >
                {shareStatus === 'success' ? <i className="bi bi-check-lg"></i> : <i className="bi bi-share"></i>}
              </button>
              {shareStatus !== 'idle' && (
                <div className="notification-tooltip" aria-live="polite">
                  {shareMessage}
                </div>
              )}
            </div>
          )}
        </div>
      </div>
      <div className="card-body">
        <div className="mb-3">
          <label htmlFor="serverUrl" className="form-label">MCP Server URL</label>
          <div className="input-group">
            <input
              type="text"
              className="form-control"
              id="serverUrl"
              placeholder={`${placeholder} (https:// added automatically)`}
              value={serverUrl}
              onChange={(e: React.ChangeEvent<HTMLInputElement>) => setServerUrl(e.target.value)}
              onKeyDown={(e: React.KeyboardEvent<HTMLInputElement>) => {
                if (e.key === 'Enter' && !isConnecting && serverUrl && !isConnected) {
                  e.preventDefault();
                  handleConnect();
                }
              }}
              disabled={isConnecting || isConnected}
              list={isConnected ? undefined : "recentServersList"}
              readOnly={isConnected}
            />
            {isConnected ? (
               <button
                 id="disconnectBtn"
                 className="btn btn-secondary"
                 onClick={handleDisconnect}
                 disabled={isConnecting}
               >
                 Disconnect
               </button>
            ) : (
               <button
                 id="connectBtn"
                 className="btn btn-primary"
                 onClick={() => handleConnect()} // Call without arguments
                 disabled={isConnecting || !serverUrl}
               >
                 {isConnecting ? `Connecting... (${connectionTimer}s)` : 'Connect'}
               </button>
            )}
          </div>
          {!isConnected && (
            <>
              <datalist id="recentServersList">
                {recentServers.map((url) => (
                  <option key={url} value={url} />
                ))}
              </datalist>
              <div className="form-text">For example, https://{placeholder}/ or http://localhost:3001</div>
            </>
          )}
          {isConnecting && (
            <div className="mt-2">
              <button
                type="button"
                className="btn btn-link btn-sm text-muted p-0"
                onClick={handleAbortConnection}
              >
                Abort connection
              </button>
            </div>
          )}
          {import.meta.env.VITE_PROXY_URL && !isConnected && setUseProxy && (
            <div className="mt-2">
              <div className="form-check">
                <input
                  className="form-check-input"
                  type="checkbox"
                  id="proxyFallbackCheck"
                  checked={useProxy !== undefined ? useProxy : true}
                  onChange={(e) => setUseProxy(e.target.checked)}
                  disabled={isConnecting || !currentUser}
                />
                <label className="form-check-label" htmlFor="proxyFallbackCheck">
                  Automatically use proxy for CORS errors
                  {!currentUser && <span className="text-muted ms-1">(login required)</span>}
                </label>
              </div>
              {!currentUser && useProxy && (
                <small className="text-warning d-block mt-1">
                  <i className="bi bi-exclamation-triangle-fill me-1"></i>
                  Please login to use the proxy feature
                </small>
              )}
            </div>
          )}
          {!isConnected && setUseOAuth && (
            <div className="mt-2">
              <div className="form-check">
                <input
                  className="form-check-input"
                  type="checkbox"
                  id="useOAuthCheck"
                  checked={useOAuth !== undefined ? useOAuth : false}
                  onChange={(e) => setUseOAuth(e.target.checked)}
                  disabled={isConnecting}
                />
                <label className="form-check-label" htmlFor="useOAuthCheck">
                  Use OAuth Authentication
                </label>
              </div>
            </div>
          )}
        </div>
        
        {isAuthFlowActive && oauthProgress && (
          <div className="alert alert-info mt-3 d-flex align-items-center" role="status">
            <div className="spinner-border spinner-border-sm me-2" role="status">
              <span className="visually-hidden">Loading...</span>
            </div>
            <div>
              <strong>OAuth Authentication in Progress</strong>
              <p className="mb-0 small">{oauthProgress}</p>
            </div>
          </div>
        )}
        
        {connectionError && (
          <ConnectionErrorCard
            errorDetails={connectionError}
            onRetry={() => handleConnect()}
            onDismiss={clearConnectionError}
            useProxy={useProxy}
            showProxyOption={!!import.meta.env.VITE_PROXY_URL}
            onRetryWithProxy={() => {
              if (setUseProxy) {
                setUseProxy(true);
                setTimeout(() => handleConnect(), 100);
              }
            }}
          />
        )}
      </div>
    </div>

    {/* OAuth User Info Modal */}
    {showUserInfoModal && (
      <div className="modal show d-block" tabIndex={-1} style={{ backgroundColor: 'rgba(0,0,0,0.5)' }}>
        <div className="modal-dialog">
          <div className="modal-content">
            <div className="modal-header">
              <h5 className="modal-title">OAuth {oauthUserInfo ? 'User' : 'Session'} Information</h5>
              <button
                type="button"
                className="btn-close"
                onClick={() => setShowUserInfoModal(false)}
                aria-label="Close"
              ></button>
            </div>
            <div className="modal-body">
              {oauthUserInfo ? (
                <>
                  {oauthUserInfo.picture && (
                    <div className="text-center mb-3">
                      <img
                        src={oauthUserInfo.picture}
                        alt="User avatar"
                        className="rounded-circle"
                        style={{ width: '100px', height: '100px' }}
                      />
                    </div>
                  )}
                  <div className="table-responsive">
                    <table className="table table-sm">
                      <tbody>
                        {Object.entries(oauthUserInfo).map(([key, value]) => (
                          <tr key={key}>
                            <td className="fw-bold">{key}:</td>
                            <td>{typeof value === 'object' ? JSON.stringify(value, null, 2) : String(value)}</td>
                          </tr>
                        ))}
                      </tbody>
                    </table>
                  </div>
                </>
              ) : (
                <div>
                  <div className="alert alert-info">
                    <i className="bi bi-shield-lock me-2"></i>
                    OAuth authentication is active for this connection
                  </div>
                  <h6>Session Details:</h6>
                  <table className="table table-sm">
                    <tbody>
                      <tr>
                        <td className="fw-bold">Status:</td>
                        <td>Authenticated</td>
                      </tr>
                      <tr>
                        <td className="fw-bold">Server:</td>
                        <td>{serverUrl}</td>
                      </tr>
                      <tr>
                        <td className="fw-bold">Token Type:</td>
                        <td>Bearer</td>
                      </tr>
                      <tr>
                        <td className="fw-bold">Connection Type:</td>
                        <td>OAuth 2.1 with PKCE</td>
                      </tr>
                    </tbody>
                  </table>
                  <p className="text-muted small mt-3">
                    User information is not available from this OAuth provider.
                  </p>
                </div>
              )}
            </div>
            <div className="modal-footer">
              <button
                type="button"
                className="btn btn-secondary"
                onClick={() => setShowUserInfoModal(false)}
              >
                Close
              </button>
            </div>
          </div>
        </div>
      </div>
    )}
    </>
  );
};

export default ConnectionPanel;