import React from 'react';
import ConnectionErrorCard from './ConnectionErrorCard';

interface ConnectionPanelProps {
  serverUrl: string;
  setServerUrl: (url: string) => void;
  connectionStatus: string;
  isConnecting: boolean;
  isConnected: boolean;
  isDisconnected: boolean;
  recentServers: string[];
  handleConnect: () => void;
  handleDisconnect: () => void;
  connectionError?: { error: string; serverUrl: string; timestamp: Date; details?: string } | null;
  clearConnectionError?: () => void;
  // SSE-related props
  sseEnabled?: boolean;
  sseConnection?: {
    isConnected: boolean;
    isConnecting: boolean;
    connectionError: string | null;
    lastEventId: string | null;
    reconnectAttempts: number;
  };
  sessionId?: string | null;
  toggleSSE?: () => void;
}

const ConnectionPanel: React.FC<ConnectionPanelProps> = ({
  serverUrl,
  setServerUrl,
  connectionStatus,
  isConnecting,
  isConnected,
  isDisconnected,
  recentServers,
  handleConnect,
  handleDisconnect,
  connectionError,
  clearConnectionError,
  // SSE-related props
  sseEnabled = false,
  sseConnection,
  sessionId,
  toggleSSE,
}) => {
  // Return JSX directly without outer parentheses
  return <div className="card mb-3">
      <div className="card-header d-flex justify-content-between align-items-center">
        <h5 className="mb-0">Server Connection</h5>
        <span id="connectionStatus" className={`badge bg-${isConnected ? 'success' : (connectionStatus === 'Error' ? 'danger' : 'secondary')}`}>
          {connectionStatus}
        </span>
      </div>
      <div className="card-body">
        <div className="mb-3">
          <label htmlFor="serverUrl" className="form-label">MCP Server URL</label>
          <div className="input-group">
            <input
              type="text"
              className="form-control"
              id="serverUrl"
              placeholder="http://localhost:3033"
              value={serverUrl}
              onChange={(e: React.ChangeEvent<HTMLInputElement>) => setServerUrl(e.target.value)}
              disabled={isConnecting}
              list="recentServersList"
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
                 {isConnecting ? 'Connecting...' : 'Connect'}
               </button>
            )}
          </div>
          <datalist id="recentServersList">
            {recentServers.map((url) => (
              <option key={url} value={url} />
            ))}
          </datalist>
          <div className="form-text">Enter server URL or select from recent history. Base URL (e.g., http://localhost:3033)</div>
        </div>

        {/* SSE Settings */}
        {toggleSSE && (
          <div className="mb-3">
            <div className="form-check form-switch">
              <input
                className="form-check-input"
                type="checkbox"
                role="switch"
                id="sseToggle"
                checked={sseEnabled}
                onChange={toggleSSE}
                disabled={isConnecting}
              />
              <label className="form-check-label" htmlFor="sseToggle">
                Enable Server-Sent Events (SSE) Streaming
              </label>
            </div>
            {sseEnabled && (
              <div className="mt-2">
                <div className="row g-2">
                  <div className="col-sm-6">
                    <small className="text-muted">
                      <strong>SSE Status:</strong>{' '}
                      <span className={`badge bg-${
                        sseConnection?.isConnected ? 'success' : 
                        sseConnection?.isConnecting ? 'warning' : 
                        sseConnection?.connectionError ? 'danger' : 'secondary'
                      } ms-1`}>
                        {sseConnection?.isConnected ? 'Connected' :
                         sseConnection?.isConnecting ? 'Connecting' :
                         sseConnection?.connectionError ? 'Error' : 'Disconnected'}
                      </span>
                    </small>
                  </div>
                  {sessionId && (
                    <div className="col-sm-6">
                      <small className="text-muted">
                        <strong>Session:</strong> {sessionId.slice(-8)}
                      </small>
                    </div>
                  )}
                  {sseConnection?.lastEventId && (
                    <div className="col-sm-6">
                      <small className="text-muted">
                        <strong>Last Event:</strong> #{sseConnection.lastEventId}
                      </small>
                    </div>
                  )}
                  {sseConnection?.reconnectAttempts > 0 && (
                    <div className="col-sm-6">
                      <small className="text-muted">
                        <strong>Reconnect Attempts:</strong> {sseConnection.reconnectAttempts}
                      </small>
                    </div>
                  )}
                </div>
                {sseConnection?.connectionError && (
                  <div className="alert alert-danger mt-2 mb-0 py-1">
                    <small>SSE Error: {sseConnection.connectionError}</small>
                  </div>
                )}
              </div>
            )}
            <div className="form-text">
              {sseEnabled 
                ? "Real-time streaming enabled for server messages and events" 
                : "Enable to receive real-time streaming updates from MCP servers"}
            </div>
          </div>
        )}
        
        {connectionError && (
          <ConnectionErrorCard
            errorDetails={connectionError}
            onRetry={handleConnect}
            onDismiss={clearConnectionError}
          />
        )}
      </div>
    </div>;
};

export default ConnectionPanel;