import React, { useState } from 'react';
import { LogEntry, Space, SpaceCard, SelectedTool, ResourceTemplate } from '../types';
import McpResponseDisplay from './McpResponseDisplay';
import { getResultShareUrl } from '../utils/urlUtils';

interface ResultPanelProps {
  lastResult: LogEntry | null;
  isConnected: boolean;
  serverUrl?: string;
  spaces: Space[];
  onAddCardToSpace: (spaceId: string, cardData: Omit<SpaceCard, 'id'>) => void;
  selectedTool: SelectedTool | null;
  selectedResourceTemplate: ResourceTemplate | null;
  toolParams: Record<string, any>;
  resourceArgs: Record<string, any>;
}

const ResultPanel: React.FC<ResultPanelProps> = ({ 
  lastResult, 
  isConnected, 
  serverUrl,
  spaces,
  onAddCardToSpace,
  selectedTool,
  selectedResourceTemplate,
  toolParams,
  resourceArgs
}) => {
  const [isContentExpanded, setIsContentExpanded] = useState(false);
  const [isFullscreen, setIsFullscreen] = useState(false);
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

  // Handle add to space
  const handleAddToSpace = (spaceId: string) => {
    if (!lastResult || !lastResult.callContext) return;
    
    const contextType = lastResult.callContext.type;
    const contextName = lastResult.callContext.name;
    const contextParams = lastResult.callContext.params;
    const contextServerUrl = lastResult.callContext.serverUrl || serverUrl;
    
    if (!contextName || !contextServerUrl) return;
    
    const cardData: Omit<SpaceCard, 'id'> = {
      title: contextName,
      serverUrl: contextServerUrl,
      type: contextType,
      name: contextName,
      params: contextParams,
    };
    
    onAddCardToSpace(spaceId, cardData);
  };

  return (
    <div className={`card mb-3 ${!isConnected ? 'panel-deactivated' : ''}`}>
      <div className="card-header d-flex justify-content-between align-items-center">
        <h5 className="mb-0">Result</h5>
        {lastResult && (
          <div className="d-flex align-items-center">
            <div className="btn-group" role="group">
              <button
                className="btn btn-sm btn-outline-secondary"
                style={{ fontSize: '0.8rem', padding: '0.2rem 0.4rem' }}
                onClick={() => setIsContentExpanded(!isContentExpanded)}
                title={isContentExpanded ? 'Collapse' : 'Expand'}
              >
                <i className={`bi bi-arrows-${isContentExpanded ? 'collapse' : 'expand'}`}></i>
              </button>
              <button
                className="btn btn-sm btn-outline-secondary"
                style={{ fontSize: '0.8rem', padding: '0.2rem 0.4rem' }}
                onClick={() => setIsFullscreen(true)}
                title="Fullscreen"
              >
                <i className="bi bi-arrows-fullscreen"></i>
              </button>
              {lastResult.callContext && serverUrl && (
                <button
                  type="button"
                  className="btn btn-sm btn-outline-secondary"
                  style={{ fontSize: '0.8rem', padding: '0.2rem 0.4rem' }}
                  onClick={handleShareResult}
                  title="Share result link"
                >
                  <i className="bi bi-share"></i>
                </button>
              )}
            </div>
            
            {/* Add to Space button/dropdown */}
            {lastResult.callContext && spaces.length > 0 && (
              spaces.length === 1 ? (
                <button
                  className="btn btn-sm btn-outline-primary ms-2"
                  style={{ fontSize: '0.8rem', padding: '0.2rem 0.4rem' }}
                  title={`Add to space: ${spaces[0].name}`}
                  onClick={() => handleAddToSpace(spaces[0].id)}
                >
                  <i className="bi bi-plus-square"></i> Add to space
                </button>
              ) : (
                <div className="dropdown ms-2">
                  <button
                    className="btn btn-sm btn-outline-primary dropdown-toggle"
                    style={{ fontSize: '0.8rem', padding: '0.2rem 0.4rem' }}
                    type="button"
                    id={`dropdownAddToSpace-result`}
                    data-bs-toggle="dropdown"
                    aria-expanded="false"
                    title="Add to Space..."
                  >
                    <i className="bi bi-plus-square me-1"></i>Add to space
                  </button>
                  <ul className="dropdown-menu dropdown-menu-sm" aria-labelledby={`dropdownAddToSpace-result`}>
                    {spaces.map(space => (
                      <li key={space.id}>
                        <button className="dropdown-item" type="button" onClick={() => handleAddToSpace(space.id)}>
                          {space.name}
                        </button>
                      </li>
                    ))}
                  </ul>
                </div>
              )
            )}
          </div>
        )}
      </div>
      <div className="card-body" style={{ minHeight: '150px' }}>
        {lastResult ? (
          <McpResponseDisplay
            logEntry={lastResult}
            showTimestamp={false}
            spacesMode={true}
            toolName={lastResult.callContext?.name}
            hideControls={true}
            forceExpanded={isContentExpanded}
          />
        ) : (
          <p className="text-muted p-2">The result of the last execution will appear here.</p>
        )}
      </div>
      
      {/* Fullscreen modal */}
      {isFullscreen && lastResult && (
        <div className="modal show d-block" tabIndex={-1} style={{ backgroundColor: 'rgba(0,0,0,0.8)' }}>
          <div className="modal-dialog modal-fullscreen">
            <div className="modal-content">
              <div className="modal-header">
                <h5 className="modal-title">{lastResult.callContext?.name || 'Result'} - Output</h5>
                <button
                  type="button"
                  className="btn-close"
                  onClick={() => setIsFullscreen(false)}
                ></button>
              </div>
              <div className="modal-body p-3" style={{ fontFamily: 'monospace', fontSize: '0.85rem' }}>
                <McpResponseDisplay
                  logEntry={lastResult}
                  showTimestamp={false}
                  spacesMode={true}
                  toolName={lastResult.callContext?.name}
                  hideControls={true}
                  forceExpanded={true}
                />
              </div>
            </div>
          </div>
        </div>
      )}
    </div>
  );
};

export default ResultPanel;