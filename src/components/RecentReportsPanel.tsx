import React, { useState } from 'react';
import { TestedServer } from '../types';

interface RecentReportsPanelProps {
  testedServers: TestedServer[];
  onSelectServer: (url: string) => void;
  onRemoveServer: (url: string) => void;
  isRunning: boolean;
}

export const RecentReportsPanel: React.FC<RecentReportsPanelProps> = ({
  testedServers,
  onSelectServer,
  onRemoveServer,
  isRunning,
}) => {
  const [showAll, setShowAll] = useState(false);

  const handleSelect = (url: string) => {
    if (isRunning) return;
    onSelectServer(url);
  };

  if (testedServers.length === 0) {
    return null; // Don't render if no recent servers
  }

  const INITIAL_DISPLAY_COUNT = 5;
  const shouldShowSeeMore = testedServers.length > INITIAL_DISPLAY_COUNT;
  const serversToShow = showAll ? testedServers : testedServers.slice(0, INITIAL_DISPLAY_COUNT);

  return (
    <div className="card mb-3">
      <div className="card-header">
        <h6 className="mb-0">Recently Tested Servers</h6>
      </div>
      <ul
        className="list-group list-group-flush"
        style={{
          maxHeight: showAll ? '300px' : 'none',
          overflowY: showAll ? 'auto' : 'visible'
        }}
      >
        {serversToShow.map((server) => (
          <li key={server.url} className="list-group-item d-flex justify-content-between align-items-center p-2">
            <div
              title={server.url}
              style={{
                cursor: isRunning ? 'default' : 'pointer',
                flexGrow: 1,
                marginRight: '10px',
                overflow: 'hidden',
                textOverflow: 'ellipsis',
                whiteSpace: 'nowrap',
              }}
              onClick={() => handleSelect(server.url)}
            >
              <span style={{ textDecoration: isRunning ? 'none' : 'underline', color: isRunning ? 'grey' : 'var(--primary-color)' }}>
                {server.url}
              </span>
              <br />
              <small className="text-muted">Last Score: {server.score}</small>
            </div>
            <button
              className="btn btn-sm btn-outline-danger py-0 px-1"
              onClick={() => onRemoveServer(server.url)}
              title="Remove from list"
              style={{ lineHeight: '1' }}
              disabled={isRunning}
            >
              &times;
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
