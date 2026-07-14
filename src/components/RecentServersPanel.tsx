import React, { useState } from 'react';

interface RecentServersPanelProps {
  recentServers: string[];
  setServerUrl: (url: string) => void;
  // Update handleConnect signature to accept optional URL
  handleConnect: (urlToConnect?: string) => void;
  removeRecentServer: (urlToRemove: string) => void;
  isConnected: boolean;
  isConnecting: boolean;
}

export const RecentServersPanel: React.FC<RecentServersPanelProps> = ({
  recentServers,
  setServerUrl,
  handleConnect,
  removeRecentServer,
  isConnected,
  isConnecting,
}) => {
  const [showAll, setShowAll] = useState(false);

  const handleReconnect = (url: string) => {
    if (isConnecting) return; // Only prevent if actively connecting
    setServerUrl(url); // Update the input field immediately
    // Call handleConnect directly with the specific URL
    // The handleConnect in useConnection now handles the auto-disconnect logic
    handleConnect(url);
  };

  if (recentServers.length === 0) {
    return null; // Don't render if no recent servers
  }

  const INITIAL_DISPLAY_COUNT = 5;
  const shouldShowSeeMore = recentServers.length > INITIAL_DISPLAY_COUNT;
  const serversToShow = showAll ? recentServers : recentServers.slice(0, INITIAL_DISPLAY_COUNT);

  return (
    <div className="card mb-3">
      <div className="card-header">
        <h6 className="mb-0">Recent Connections</h6>
      </div>
      <ul 
        className="list-group list-group-flush"
        style={{
          maxHeight: showAll ? '300px' : 'none',
          overflowY: showAll ? 'auto' : 'visible'
        }}
      >
        {serversToShow.map((url) => (
          <li key={url} className="list-group-item d-flex justify-content-between align-items-center p-2">
            <span
              title={url}
              style={{
                cursor: isConnected || isConnecting ? 'default' : 'pointer',
                textDecoration: isConnected || isConnecting ? 'none' : 'underline',
                color: isConnected || isConnecting ? 'grey' : 'var(--primary-color)',
                flexGrow: 1,
                marginRight: '10px',
                overflow: 'hidden',
                textOverflow: 'ellipsis',
                whiteSpace: 'nowrap',
              }}
              onClick={() => handleReconnect(url)}
            >
              {url}
            </span>
            <button
              className="btn btn-sm btn-outline-danger py-0 px-1"
              onClick={() => removeRecentServer(url)}
              title="Remove from list"
              style={{ lineHeight: '1' }} // Adjust button height
            >
              &times; {/* Use times symbol for remove */}
            </button>
          </li>
        ))}
      </ul>
      {shouldShowSeeMore && !showAll && (
        <div className="card-footer text-center p-2">
          <button 
            className="btn btn-sm btn-link p-0"
            onClick={() => setShowAll(true)}
            style={{ textDecoration: 'none' }}
          >
            See more...
          </button>
        </div>
      )}
    </div>
  );
};