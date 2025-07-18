import React, { useState, useEffect } from 'react';
import ConnectionErrorCard from './ConnectionErrorCard';
import { TransportType } from '../types';

// List of suggested servers to randomly select from
const SUGGESTED_SERVERS = [
  'mcp.context7.com',
  'mcp.deepwiki.com',
  'mcp.api.coingecko.com'
];

// Select a random server for the placeholder
const getRandomServer = () => {
  const randomIndex = Math.floor(Math.random() * SUGGESTED_SERVERS.length);
  return SUGGESTED_SERVERS[randomIndex];
};

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
}) => {
  const [connectionTimer, setConnectionTimer] = useState(0);

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
  // Return JSX directly without outer parentheses
  return <div className={`card mb-3 ${isConnected ? 'border-success' : ''}`}>
      <div className={`card-header d-flex justify-content-between align-items-center ${isConnected ? 'bg-success bg-opacity-10' : ''}`}>
        <h5 className="mb-0">Server Connection</h5>
        <div>
          {transportType && <span className={`badge ${transportType === 'streamable-http' ? 'bg-success' : 'bg-primary'} me-2`}>{transportType === 'streamable-http' ? 'HTTP' : 'SSE'}</span>}
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
              placeholder={`${getRandomServer()} (https:// added automatically)`}
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
              <div className="form-text">For example, https://{getRandomServer()}/ or http://localhost:3001</div>
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
        </div>
        
        {connectionError && (
          <ConnectionErrorCard
            errorDetails={connectionError}
            onRetry={() => handleConnect()}
            onDismiss={clearConnectionError}
          />
        )}
      </div>
    </div>;
};

export default ConnectionPanel;