import React from 'react';
import ConnectionErrorCard from './ConnectionErrorCard';
import { TransportType } from '../types';

interface ConnectionPanelProps {
  serverUrl: string;
  setServerUrl: (url: string) => void;
  connectionStatus: string;
  transportType: TransportType | null;
  isConnecting: boolean;
  isConnected: boolean;
  isDisconnected: boolean;
  recentServers: string[];
  handleConnect: () => void;
  handleDisconnect: () => void;
  connectionError?: { error: string; serverUrl: string; timestamp: Date; details?: string } | null;
  clearConnectionError?: () => void;
}

const ConnectionPanel: React.FC<ConnectionPanelProps> = ({
  serverUrl,
  setServerUrl,
  connectionStatus,
  transportType,
  isConnecting,
  isConnected,
  isDisconnected,
  recentServers,
  handleConnect,
  handleDisconnect,
  connectionError,
  clearConnectionError,
}) => {
  // Return JSX directly without outer parentheses
  return <div className="card mb-3">
      <div className="card-header d-flex justify-content-between align-items-center">
        <h5 className="mb-0">Server Connection</h5>
        <div>
          {transportType && <span className={`badge bg-info me-2`}>{transportType === 'streamable-http' ? 'HTTP' : 'SSE'}</span>}
          <span id="connectionStatus" className={`badge bg-${isConnected ? 'success' : (connectionStatus === 'Error' ? 'danger' : 'secondary')}`}>
            {connectionStatus}
          </span>
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