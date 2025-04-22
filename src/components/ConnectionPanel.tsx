import React from 'react';

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
                 onClick={handleConnect}
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
      </div>
    </div>;
};

export default ConnectionPanel;