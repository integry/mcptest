import React from 'react';

interface SuggestedServersPanelProps {
  setServerUrl: (url: string) => void;
  handleConnect: (urlToConnect?: string) => void;
  isConnected: boolean;
  isConnecting: boolean;
}

interface SuggestedServer {
  name: string;
  url: string;
}

const SUGGESTED_SERVERS: SuggestedServer[] = [
  {
    name: 'Deepwiki',
    url: 'https://mcp.deepwiki.com'
  },
  {
    name: 'Coingecko',
    url: 'https://mcp.api.coingecko.com'
  }
];

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
    <div className="card mb-3">
      <div className="card-header">
        <h6 className="mb-0">Suggested Servers</h6>
        <small className="text-muted">Not sure where to begin? Check our curated list of remote MCP servers.</small>
      </div>
      <ul className="list-group list-group-flush">
        {SUGGESTED_SERVERS.map((server) => (
          <li key={server.url} className="list-group-item d-flex justify-content-between align-items-center p-2">
            <div
              style={{
                cursor: isConnected || isConnecting ? 'default' : 'pointer',
                flexGrow: 1,
                overflow: 'hidden',
              }}
              onClick={() => handleServerClick(server.url)}
            >
              <div
                style={{
                  fontWeight: 500,
                  color: isConnected || isConnecting ? 'grey' : 'var(--primary-color)',
                  textDecoration: isConnected || isConnecting ? 'none' : 'underline',
                }}
              >
                {server.name}
              </div>
              <small
                style={{
                  color: '#666',
                  overflow: 'hidden',
                  textOverflow: 'ellipsis',
                  whiteSpace: 'nowrap',
                }}
                title={server.url}
              >
                {server.url}
              </small>
            </div>
          </li>
        ))}
      </ul>
    </div>
  );
};