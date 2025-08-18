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
  serverType?: 'remote' | 'local';
  setServerType?: (type: 'remote' | 'local') => void;
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
  serverType = 'remote',
  setServerType,
}) => {
  const [connectionTimer, setConnectionTimer] = useState(0);
  const [placeholder] = useState(() => {
    const randomIndex = Math.floor(Math.random() * SUGGESTED_SERVERS.length);
    return SUGGESTED_SERVERS[randomIndex];
  });
  const { share, shareStatus, shareMessage } = useShare();
  const { currentUser } = useAuth();
  const [localServerType, setLocalServerType] = useState<'remote' | 'local'>(serverType);

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
  // Return JSX directly without outer parentheses
  return <div className={`card mb-3 ${isConnected ? 'border-success' : ''}`} style={{ marginTop: '0', minHeight: '200px' }}>
      <div className={`card-header d-flex justify-content-between align-items-center ${isConnected ? 'bg-success bg-opacity-10' : ''}`}>
        <h5 className="mb-0">Server Connection</h5>
        <div className="d-flex align-items-center gap-2">
          {transportType && <span className={`badge ${transportType === 'streamable-http' ? 'bg-success' : transportType === 'stdio' ? 'bg-info' : 'bg-primary'} me-2`}>{transportType === 'streamable-http' ? 'HTTP' : transportType === 'stdio' ? 'STDIO' : 'SSE'}</span>}
          {isProxied && isConnected && <span className="badge bg-warning text-dark">Proxy</span>}
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
        {setServerType && (
          <div className="mb-3">
            <div className="form-check form-check-inline">
              <input
                className="form-check-input"
                type="radio"
                name="serverType"
                id="remoteServer"
                value="remote"
                checked={localServerType === 'remote'}
                onChange={() => {
                  setLocalServerType('remote');
                  setServerType('remote');
                }}
                disabled={isConnecting || isConnected}
              />
              <label className="form-check-label" htmlFor="remoteServer">
                Remote (HTTP)
              </label>
            </div>
            <div className="form-check form-check-inline">
              <input
                className="form-check-input"
                type="radio"
                name="serverType"
                id="localServer"
                value="local"
                checked={localServerType === 'local'}
                onChange={() => {
                  setLocalServerType('local');
                  setServerType('local');
                }}
                disabled={isConnecting || isConnected}
              />
              <label className="form-check-label" htmlFor="localServer">
                Local (stdio)
              </label>
            </div>
          </div>
        )}
        <div className="mb-3">
          <label htmlFor="serverUrl" className="form-label">
            {localServerType === 'remote' ? 'MCP Server URL' : 'Local Server Command'}
          </label>
          <div className="input-group">
            <input
              type="text"
              className="form-control"
              id="serverUrl"
              placeholder={
                localServerType === 'remote'
                  ? `${placeholder}`
                  : 'e.g., node path/to/server.js'
              }
              value={serverUrl}
              onChange={(e: React.ChangeEvent<HTMLInputElement>) => setServerUrl(e.target.value)}
              onKeyDown={(e: React.KeyboardEvent<HTMLInputElement>) => {
                if (e.key === 'Enter' && !isConnecting && serverUrl && !isConnected) {
                  e.preventDefault();
                  handleConnect();
                }
              }}
              disabled={isConnecting || isConnected}
              list={isConnected || localServerType === 'local' ? undefined : "recentServersList"}
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
                 {isConnecting ? ('Connecting... (' + connectionTimer + 's)') : 'Connect'}
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
              <div className="form-text">
                {localServerType === 'remote' 
                  ? `For example, https://${placeholder}/ or http://localhost:3001`
                  : 'Enter the command to start your local MCP server'}
              </div>
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
          {import.meta.env.VITE_PROXY_URL && !isConnected && setUseProxy && localServerType === 'remote' && (
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
        </div>
        
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
    </div>;
};

export default ConnectionPanel;