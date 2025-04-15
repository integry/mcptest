import React from 'react';

interface ConnectionPanelProps {
  serverUrl: string;
  setServerUrl: (url: string) => void;
  connectionStatus: string;
  isConnecting: boolean;
  isConnected: boolean;
  isDisconnected: boolean;
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
  handleConnect,
  handleDisconnect,
}) => {
  return (
    <div className="card mb-3">
      <div className="card-header"><h5>Server Connection</h5></div>
      <div className="card-body">
        <div className="mb-3">
          <label htmlFor="serverUrl" className="form-label">MCP Server URL</label>
          <input
            type="text"
            className="form-control"
            id="serverUrl"
            placeholder="http://localhost:3033"
            value={serverUrl}
            onChange={(e: React.ChangeEvent<HTMLInputElement>) => setServerUrl(e.target.value)}
            disabled={!isDisconnected || isConnecting}
          />
          <div className="form-text">Base URL (e.g., http://localhost:3033)</div>
        </div>
        <div className="d-flex justify-content-between mb-2">
          <button
            id="connectBtn"
            className="btn btn-primary"
            onClick={handleConnect}
            disabled={!isDisconnected || isConnecting || !serverUrl}
          >
            {isConnecting && connectionStatus === 'Connecting...' ? 'Connecting...' : 'Connect'}
          </button>
          <button
            id="disconnectBtn"
            className="btn btn-secondary"
            onClick={() => handleDisconnect()} // Ensure it calls the passed function
            disabled={connectionStatus === 'Disconnected' || isConnecting}
          >
            {isConnecting && connectionStatus !== 'Connecting...' ? 'Disconnecting...' : 'Disconnect'}
          </button>
          <span id="connectionStatus" className={`badge bg-${isConnected ? 'success' : (connectionStatus === 'Error' ? 'danger' : 'secondary')} align-self-center`}>
            {connectionStatus}
          </span>
        </div>
        <div className="alert alert-info">
           <small>Connects via POST to /mcp, expects text/event-stream response.</small>
        </div>
      </div>
    </div>
  );
};

export default ConnectionPanel;