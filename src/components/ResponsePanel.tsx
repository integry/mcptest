import React, { useRef, useEffect } from 'react';
import { Space, SpaceCard, SelectedTool, ResourceTemplate, LogEntry } from '../types'; // Import necessary types including LogEntry
import McpResponseDisplay from './McpResponseDisplay'; // Import the new component

interface ResponsePanelProps {
  responses: LogEntry[];
  autoScroll: boolean;
  setAutoScroll: (autoScroll: boolean) => void;
  handleClearResponse: () => void;
  isConnected: boolean;
  // Props for "Add to Space"
  spaces: Space[];
  onAddCardToSpace: (spaceId: string, cardData: Omit<SpaceCard, 'id'>) => void;
  // Context needed to create a card
  serverUrl: string;
  selectedTool: SelectedTool | null;
  selectedResourceTemplate: ResourceTemplate | null;
  toolParams: Record<string, any>;
  resourceArgs: Record<string, any>;
  onRunAgain?: (callContext: LogEntry['callContext']) => void;
}

const ResponsePanel: React.FC<ResponsePanelProps> = ({
  responses,
  autoScroll,
  setAutoScroll,
  handleClearResponse,
  isConnected,
  spaces,
  onAddCardToSpace,
  serverUrl,
  selectedTool,
  selectedResourceTemplate,
  toolParams,
  resourceArgs,
  onRunAgain,
}) => {
  const responseAreaRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    if (autoScroll && responseAreaRef.current) {
      responseAreaRef.current.scrollTop = responseAreaRef.current.scrollHeight;
    }
  }, [responses, autoScroll]);

  // --- Add to Space Button/Dropdown Component ---
  const AddToSpaceControl: React.FC<{ logEntry: LogEntry }> = ({ logEntry }) => {
    const contextType = logEntry.type.toLowerCase() === 'tool_result' ? 'tool' : 'resource';
    // Use callContext if available, otherwise fallback to current selection
    const contextName = logEntry.callContext?.name ?? (contextType === 'tool' ? selectedTool?.name : selectedResourceTemplate?.uri);
    const contextParams = logEntry.callContext?.params ?? (contextType === 'tool' ? toolParams : resourceArgs);
    const contextServerUrl = logEntry.callContext?.serverUrl ?? serverUrl;


    if (!contextName || !contextServerUrl) {
      console.warn("AddToSpaceControl: Missing contextName or serverUrl", { contextName, contextServerUrl, logEntry });
      return null;
    }

    const cardData: Omit<SpaceCard, 'id'> = {
      title: contextName, // Default title
      serverUrl: contextServerUrl,
      type: contextType,
      name: contextName,
      params: contextParams,
    };

    const handleAddToSpace = (spaceId: string) => {
      onAddCardToSpace(spaceId, cardData);
    };

    if (spaces.length === 0) {
      return <span className="ms-2 text-muted small">(No spaces)</span>; // Indicate no spaces available
    }

    if (spaces.length === 1) {
      return (
        <button
          className="btn btn-sm btn-outline-primary flex-shrink-0"
          style={{ fontSize: '0.8rem', padding: '0.2rem 0.4rem' }}
          title={`Add to space: ${spaces[0].name}`}
          onClick={() => handleAddToSpace(spaces[0].id)}
        >
          <i className="bi bi-plus-square"></i> Add to space
        </button>
      );
    }

    return (
      <div className="dropdown d-inline-block flex-shrink-0">
        <button
          className="btn btn-sm btn-outline-primary dropdown-toggle"
          style={{ fontSize: '0.8rem', padding: '0.2rem 0.4rem' }}
          type="button"
          id={`dropdownAddToSpace-${logEntry.timestamp}-${logEntry.id ?? 'fallback'}`}
          data-bs-toggle="dropdown"
          aria-expanded="false"
          title="Add to Space..."
        >
           <i className="bi bi-plus-square me-1"></i>Add to space
        </button>
        <ul className="dropdown-menu dropdown-menu-sm" aria-labelledby={`dropdownAddToSpace-${logEntry.timestamp}-${logEntry.id ?? 'fallback'}`}>
          {spaces.map(space => (
            <li key={space.id}>
              <button className="dropdown-item" type="button" onClick={() => handleAddToSpace(space.id)}>
                {space.name}
              </button>
            </li>
          ))}
        </ul>
      </div>
    );
  };

  // --- Main Render ---
  return (
      <div className={`card mb-3 ${!isConnected ? 'panel-deactivated' : ''}`}>
        <div className="card-header d-flex justify-content-between">
          <h5>Logs & Events</h5>
          <div className="form-check form-switch">
          <input
            className="form-check-input"
            type="checkbox"
            id="autoScrollSwitch"
            checked={autoScroll}
            onChange={(e: React.ChangeEvent<HTMLInputElement>) => setAutoScroll(e.target.checked)}
          />
          <label className="form-check-label" htmlFor="autoScrollSwitch">Auto-scroll</label>
        </div>
      </div>
      <div className="card-body p-0">
        <div
          id="responseArea"
          ref={responseAreaRef}
          className="response-area p-2"
          style={{ height: 'calc(100vh - 250px)', overflowY: 'auto', fontFamily: 'monospace', fontSize: '0.85rem' }}
        >
          {responses.length === 0 ? (
            <p className="text-muted p-2">Logs and events will appear here...</p>
          ) : (
            responses
              .filter((item, index) => {
                // Filter out info messages that are directly before or after tool_result/resource_result
                const isInfo = item.type.toLowerCase() === 'info';
                if (!isInfo) return true;
                
                // Check if this info message is related to tool execution
                const infoText = typeof item.data === 'string' ? item.data : JSON.stringify(item.data);
                const isToolInfo = infoText.includes('Executing tool:') || 
                                   infoText.includes('Tool "') || 
                                   infoText.includes('--- End Tool');
                
                if (!isToolInfo) return true;
                
                // Filter out tool-related info messages
                return false;
              })
              .map((item, index) => {
                const isResultType = item.type.toLowerCase() === 'tool_result' || item.type.toLowerCase() === 'resource_result';
                return (
                  <div key={`${item.timestamp}-${index}`} className="mb-2">
                     <McpResponseDisplay 
                       logEntry={item} 
                       showTimestamp={true} 
                       className="" 
                       addToSpaceButton={isResultType ? <AddToSpaceControl logEntry={item} /> : undefined}
                       showExcerpt={true}
                       onRunAgain={isResultType && onRunAgain && item.callContext ? () => onRunAgain(item.callContext) : undefined}
                     />
                  </div>
                );
              })
          )}
        </div>
      </div>
      <div className="card-footer">
        <button
          id="clearResponseBtn"
          className="btn btn-sm btn-outline-secondary"
          onClick={handleClearResponse}
          disabled={responses.length === 0}
        >
          Clear Logs
        </button>
      </div>
    </div>
  );
};

export default ResponsePanel;