import React from 'react';
import { Link } from 'react-router-dom';

import { getCatalogServers } from '../utils/catalogUtils';

interface SuggestedServersPanelProps {
  setServerUrl: (url: string) => void;
  handleConnect: (urlToConnect?: string) => void;
  isConnected: boolean;
  isConnecting: boolean;
}

const suggestedCatalogServers = getCatalogServers()
  .filter((server) => server.tags.includes('suggested') && server.status !== 'offline')
  .slice(0, 4);

export const SuggestedServersPanel: React.FC<SuggestedServersPanelProps> = ({
  setServerUrl,
  handleConnect,
  isConnected,
  isConnecting,
}) => {
  const handleServerClick = (url: string) => {
    if (isConnecting) return;
    setServerUrl(url);
    handleConnect(url);
  };

  return (
    <div className="card mb-3 suggested-servers-panel">
      <div className="card-header">
        <h6 className="mb-0">Suggested Servers</h6>
      </div>
      <div className="card-body p-3">
        <small className="text-muted d-block mb-3">Not sure where to begin? Check our curated list of remote MCP servers.</small>
        <ul className="list-group">
        {suggestedCatalogServers.map((server) => (
          <li key={server.url} className="list-group-item suggested-server-row p-3">
            <div
              style={{
                cursor: isConnected || isConnecting ? 'default' : 'pointer',
                display: 'flex',
                alignItems: 'flex-start',
                gap: '12px',
              }}
              onClick={() => handleServerClick(server.url)}
            >
              {server.logoUrl && (
                <img
                  src={server.logoUrl}
                  alt={`${server.name} logo`}
                  style={{
                    width: '48px',
                    height: '48px',
                    objectFit: 'contain',
                    flexShrink: 0,
                  }}
                />
              )}
              <div style={{ flexGrow: 1, overflow: 'hidden' }}>
                <div
                  style={{
                    fontWeight: 600,
                    fontSize: '16px',
                    color: isConnected || isConnecting ? 'grey' : 'var(--primary-color)',
                    textDecoration: isConnected || isConnecting ? 'none' : 'underline',
                    marginBottom: '4px',
                  }}
                >
                  {server.name}
                </div>
                <div
                  style={{
                    fontSize: '14px',
                    color: '#666',
                    marginBottom: '8px',
                    lineHeight: '1.4',
                  }}
                >
                  {server.description}
                </div>
                <small
                  style={{
                    color: '#999',
                    fontSize: '12px',
                  }}
                  title={server.url}
                >
                  {server.url}
                </small>
              </div>
            </div>
          </li>
        ))}
        </ul>
      </div>
      <div className="card-footer text-center p-2">
        <Link to="/catalog" className="btn btn-sm btn-link p-0" style={{ textDecoration: 'none' }}>
          Browse the full server catalog &rarr;
        </Link>
      </div>
    </div>
  );
};
