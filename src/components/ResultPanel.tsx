import React from 'react';
import { LogEntry } from '../types';
import McpResponseDisplay from './McpResponseDisplay';
import { getResultShareUrl } from '../utils/urlUtils';

interface ResultPanelProps {
  lastResult: LogEntry | null;
  isConnected: boolean;
  serverUrl?: string;
}

const ResultPanel: React.FC<ResultPanelProps> = ({ lastResult, isConnected, serverUrl }) => {
  // Handle share button click
  const handleShareResult = () => {
    if (!lastResult || !lastResult.callContext || !serverUrl) return;
    
    // Normalize the server URL - remove protocol if present
    const normalizedUrl = serverUrl.replace(/^https?:\/\//, '');
    
    // Generate share URL
    const shareUrl = `${window.location.origin}${getResultShareUrl(
      normalizedUrl,
      lastResult.callContext.type,
      lastResult.callContext.name,
      lastResult.callContext.params
    )}`;
    
    // Copy to clipboard
    navigator.clipboard.writeText(shareUrl).then(() => {
      // Show temporary feedback (we'll use a simple alert for now)
      alert('Result share link copied to clipboard!');
    }).catch(err => {
      console.error('Failed to copy result share link:', err);
      alert('Failed to copy result share link. Please try again.');
    });
  };

  return (
    <div className={`card mb-3 ${!isConnected ? 'panel-deactivated' : ''}`}>
      <div className="card-header d-flex justify-content-between align-items-center">
        <h5 className="mb-0">Result</h5>
        {lastResult && lastResult.callContext && serverUrl && (
          <button
            type="button"
            className="btn btn-sm btn-outline-secondary"
            onClick={handleShareResult}
            title="Share result link"
          >
            <i className="bi bi-share"></i>
          </button>
        )}
      </div>
      <div className="card-body" style={{ minHeight: '150px' }}>
        {lastResult ? (
          <McpResponseDisplay
            logEntry={lastResult}
            showTimestamp={false}
            spacesMode={true}
            toolName={lastResult.callContext?.name}
          />
        ) : (
          <p className="text-muted p-2">The result of the last execution will appear here.</p>
        )}
      </div>
    </div>
  );
};

export default ResultPanel;