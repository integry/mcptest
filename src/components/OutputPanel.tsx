import React, { useState } from 'react';
import { LogEntry, Space, SpaceCard, SelectedTool, ResourceTemplate } from '../types';
import McpResponseDisplay from './McpResponseDisplay';
import ResultPanel from './ResultPanel';
import ResponsePanel from './ResponsePanel';
import { getResultShareUrl } from '../utils/urlUtils';
import { useShare } from '../hooks/useShare';

interface OutputPanelProps {
  lastResult: LogEntry | null;
  responses: LogEntry[];
  autoScroll: boolean;
  setAutoScroll: (autoScroll: boolean) => void;
  handleClearResponse: () => void;
  isConnected: boolean;
  spaces: Space[];
  onAddCardToSpace: (spaceId: string, cardData: Omit<SpaceCard, 'id'>) => void;
  serverUrl: string;
  selectedTool: SelectedTool | null;
  selectedResourceTemplate: ResourceTemplate | null;
  toolParams: Record<string, any>;
  resourceArgs: Record<string, any>;
  onRunAgain?: (callContext: LogEntry['callContext']) => void;
  useProxy?: boolean;
}

const OutputPanel: React.FC<OutputPanelProps> = (props) => {
  const [activeTab, setActiveTab] = useState<'result' | 'logs'>('result');
  const [isContentExpanded, setIsContentExpanded] = useState(false);
  const [isFullscreen, setIsFullscreen] = useState(false);
  const { share, shareStatus, shareMessage } = useShare();
  
  // Handle share button click
  const handleShareResult = () => {
    if (!props.lastResult || !props.lastResult.callContext || !props.serverUrl) return;
    
    // Normalize the server URL - remove protocol if present
    const normalizedUrl = props.serverUrl.replace(/^https?:\/\//, '');
    
    // Generate share URL
    const shareUrl = `${window.location.origin}${getResultShareUrl(
      normalizedUrl,
      props.lastResult.callContext.type,
      props.lastResult.callContext.name,
      props.lastResult.callContext.params
    )}`;
    
    share({
      url: shareUrl,
      title: `MCP Result: ${props.lastResult.callContext.name}`,
      text: `Check out this MCP result from ${props.serverUrl}`,
    });
  };

  // Handle add to dashboard
  const handleAddToSpace = (spaceId: string) => {
    if (!props.lastResult || !props.lastResult.callContext) return;
    
    const contextType = props.lastResult.callContext.type;
    const contextName = props.lastResult.callContext.name;
    const contextParams = props.lastResult.callContext.params;
    const contextServerUrl = props.lastResult.callContext.serverUrl || props.serverUrl;
    
    if (!contextName || !contextServerUrl) return;
    
    const cardData: Omit<SpaceCard, 'id'> = {
      title: contextName,
      serverUrl: contextServerUrl,
      type: contextType,
      name: contextName,
      params: contextParams,
      useProxy: props.useProxy,
    };
    
    props.onAddCardToSpace(spaceId, cardData);
  };
  
  return (
    <div className="card mt-3 flex-grow-1">
      <div className="card-header p-0 d-flex justify-content-between align-items-center">
        <ul className="nav nav-tabs flex-grow-0" id="outputTabs" role="tablist">
          <li className="nav-item" role="presentation">
            <button 
              className={`nav-link ${activeTab === 'result' ? 'active' : ''}`} 
              id="result-tab" 
              onClick={() => setActiveTab('result')}
              type="button" 
              role="tab" 
              aria-controls="result-panel" 
              aria-selected={activeTab === 'result'}
            >
              Result
            </button>
          </li>
          <li className="nav-item" role="presentation">
            <button 
              className={`nav-link ${activeTab === 'logs' ? 'active' : ''}`} 
              id="logs-tab" 
              onClick={() => setActiveTab('logs')}
              type="button" 
              role="tab" 
              aria-controls="logs-panel" 
              aria-selected={activeTab === 'logs'}
            >
              Logs & Events
            </button>
          </li>
        </ul>
        {activeTab === 'result' && props.lastResult && (
          <div className="d-flex align-items-center pe-3">
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
              {props.lastResult.callContext && props.serverUrl && (
                <div className="position-relative">
                  <button
                    type="button"
                    className="btn btn-sm btn-outline-secondary"
                    style={{ fontSize: '0.8rem', padding: '0.2rem 0.4rem' }}
                    onClick={handleShareResult}
                    title="Share result link"
                    disabled={shareStatus !== 'idle'}
                  >
                    {shareStatus === 'success' ? <i className="bi bi-check-lg"></i> : <i className="bi bi-share"></i>}
                  </button>
                  {shareStatus !== 'idle' && (
                    <div className="notification-tooltip">
                      {shareMessage}
                    </div>
                  )}
                </div>
              )}
            </div>
            
            {/* Add to Dashboard button/dropdown */}
            {props.lastResult.callContext && props.spaces.length > 0 && (
              props.spaces.length === 1 ? (
                <button
                  className="btn btn-sm btn-outline-primary ms-2"
                  style={{ fontSize: '0.8rem', padding: '0.2rem 0.4rem' }}
                  title={`Add to dashboard: ${props.spaces[0].name}`}
                  onClick={() => handleAddToSpace(props.spaces[0].id)}
                >
                  <i className="bi bi-plus-square"></i> Add to dashboard
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
                    title="Add to Dashboard..."
                  >
                    <i className="bi bi-plus-square me-1"></i>Add to dashboard
                  </button>
                  <ul className="dropdown-menu dropdown-menu-sm" aria-labelledby={`dropdownAddToSpace-result`}>
                    {props.spaces.map(space => (
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
        {activeTab === 'logs' && (
          <div className="form-check form-switch pe-3">
            <input
              className="form-check-input"
              type="checkbox"
              id="autoScrollSwitch"
              checked={props.autoScroll}
              onChange={(e: React.ChangeEvent<HTMLInputElement>) => props.setAutoScroll(e.target.checked)}
            />
            <label className="form-check-label" htmlFor="autoScrollSwitch">Auto-scroll</label>
          </div>
        )}
      </div>
      <div className="card-body p-0 d-flex flex-column" style={{ height: 'calc(100vh - 250px)' }}>
        <div className="tab-content flex-grow-1 overflow-hidden" id="outputTabsContent">
          <div className={`tab-pane fade ${activeTab === 'result' ? 'show active' : ''} h-100`} id="result-panel" role="tabpanel" aria-labelledby="result-tab">
            <ResultPanel {...props} isContentExpanded={isContentExpanded} />
          </div>
          <div className={`tab-pane fade ${activeTab === 'logs' ? 'show active' : ''} h-100`} id="logs-panel" role="tabpanel" aria-labelledby="logs-tab">
            <ResponsePanel {...props} />
          </div>
        </div>
      </div>
      
      {/* Fullscreen modal */}
      {isFullscreen && props.lastResult && (
        <div className="modal show d-block" tabIndex={-1} style={{ backgroundColor: 'rgba(0,0,0,0.8)' }}>
          <div className="modal-dialog modal-fullscreen">
            <div className="modal-content">
              <div className="modal-header">
                <h5 className="modal-title">{props.lastResult.callContext?.name || 'Result'} - Output</h5>
                <button
                  type="button"
                  className="btn-close"
                  onClick={() => setIsFullscreen(false)}
                ></button>
              </div>
              <div className="modal-body p-3" style={{ fontFamily: 'monospace', fontSize: '0.85rem' }}>
                <McpResponseDisplay
                  logEntry={props.lastResult}
                  showTimestamp={false}
                  spacesMode={true}
                  toolName={props.lastResult.callContext?.name}
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

export default OutputPanel;