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
          className="btn btn-sm btn-outline-primary ms-2 flex-shrink-0" // Added flex-shrink-0
          title={`Add to space: ${spaces[0].name}`}
          onClick={() => handleAddToSpace(spaces[0].id)}
        >
          <i className="bi bi-plus-square"></i>
        </button>
      );
    }

    return (
      <div className="dropdown ms-2 d-inline-block flex-shrink-0"> {/* Added flex-shrink-0 */}
        <button
          className="btn btn-sm btn-outline-primary dropdown-toggle"
          type="button"
          id={`dropdownAddToSpace-${logEntry.timestamp}-${logEntry.id ?? 'fallback'}`} // Use timestamp/id
          data-bs-toggle="dropdown"
          aria-expanded="false"
          title="Add to Space..."
        >
           <i className="bi bi-plus-square"></i>
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
          style={{ height: 'calc(100vh - 250px)', overflowY: 'auto', backgroundColor: '#f8f9fa', border: '1px solid #dee2e6', fontFamily: 'monospace', fontSize: '0.85rem' }}
        >
          {responses.length === 0 ? (
            <p className="text-muted p-2">Logs and events will appear here...</p>
          ) : (
            responses.map((item, index) => { // Added index back for key
              const isResultType = item.type.toLowerCase() === 'tool_result' || item.type.toLowerCase() === 'resource_result';
              return (
                // Use d-flex on the outer div to align McpResponseDisplay and the button
                <div key={`${item.timestamp}-${index}`} className="d-flex align-items-start mb-1">
                   {/* McpResponseDisplay takes up available space */}
                   <McpResponseDisplay logEntry={item} showTimestamp={true} className="flex-grow-1" />
                   {/* Conditionally render the AddToSpaceControl, it will align to the right */}
                   {isResultType && <AddToSpaceControl logEntry={item} />}
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