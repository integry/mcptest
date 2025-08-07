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
  description: string;
  logo: string;
}

const SUGGESTED_SERVERS: SuggestedServer[] = [
  {
    name: 'Context7',
    url: 'https://mcp.context7.com/',
    description: 'LLMs rely on outdated or generic information about the libraries you use. Context7 pulls up-to-date, version-specific documentation and code examples directly from the source.',
    logo: '/context7-logo.png'
  },
  {
    name: 'DeepWiki',
    url: 'https://mcp.deepwiki.com',
    description: 'DeepWiki provides up-to-date documentation you can talk to, for every repo in the world. Think Deep Research for GitHub.',
    logo: '/deepwiki-logo.png'
  },
  {
    name: 'CoinGecko',
    url: 'https://mcp.api.coingecko.com',
    description: 'MCP Server for Crypto Price & Market Data. Access real-time market data, onchain analytics, and rich metadata for over 15k+ coins.',
    logo: '/coingecko-logo.png'
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
      </div>
      <div className="card-body p-3">
        <small className="text-muted d-block mb-3">Not sure where to begin? Check our curated list of remote MCP servers.</small>
      </div>
      <ul className="list-group list-group-flush">
        {SUGGESTED_SERVERS.map((server) => (
          <li key={server.url} className="list-group-item p-3">
            <div
              style={{
                cursor: isConnected || isConnecting ? 'default' : 'pointer',
                display: 'flex',
                alignItems: 'flex-start',
                gap: '12px',
              }}
              onClick={() => handleServerClick(server.url)}
            >
              <img
                src={server.logo}
                alt={`${server.name} logo`}
                style={{
                  width: '48px',
                  height: '48px',
                  objectFit: 'contain',
                  flexShrink: 0,
                }}
              />
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
  );
};