import React, { useRef, useEffect } from 'react'; // Removed useState as it's no longer needed here
// Showdown is no longer needed here
import { Space, SpaceCard, SelectedTool, ResourceTemplate, LogEntry } from '../types'; // Import necessary types including LogEntry
import McpResponseDisplay from './McpResponseDisplay'; // Import the new component

// Remove duplicate LogEntry definition - it's imported from ../types now
// interface LogEntry {
//   type: string;
//   data: any; // Allow data to be parsed JSON or string
//   timestamp: string;
//   eventId?: string | null;
//   event?: string;
//   id?: number | string;
//   method?: string;
//   params?: any;
//   // Add fields to potentially capture the context of the call for "Add to Space"
//   callContext?: {
//       serverUrl: string;
//       type: 'tool' | 'resource';
//       name: string; // Tool name or Resource URI
//       params: Record<string, any>; // Input params/args
//   }
// }

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
  // Showdown converter is no longer needed here, moved to McpResponseDisplay

  useEffect(() => {
    if (autoScroll && responseAreaRef.current) {
      responseAreaRef.current.scrollTop = responseAreaRef.current.scrollHeight;
    }
  }, [responses, autoScroll]);

  // --- Add to Space Button/Dropdown Component (Keep this logic here) ---
  const AddToSpaceControl: React.FC<{ logEntry: LogEntry }> = ({ logEntry }) => {
    const contextType = logEntry.type.toLowerCase() === 'tool_result' ? 'tool' : 'resource';
    const contextName = contextType === 'tool' ? selectedTool?.name : selectedResourceTemplate?.uri;
    const contextParams = contextType === 'tool' ? toolParams : resourceArgs;

    if (!contextName || !serverUrl) {
      return null;
    }

    const cardData: Omit<SpaceCard, 'id'> = {
      title: contextName,
      serverUrl: serverUrl,
      type: contextType,
      name: contextName,
      params: contextParams,
    };

    const handleAddToSpace = (spaceId: string) => {
      onAddCardToSpace(spaceId, cardData);
    };

    if (spaces.length === 0) {
      return null;
    }

    if (spaces.length === 1) {
      return (
        <button
          className="btn btn-sm btn-outline-primary ms-2"
          title={`Add to space: ${spaces[0].name}`}
          onClick={() => handleAddToSpace(spaces[0].id)}
        >
          <i className="bi bi-plus-square"></i> Add
        </button>
      );
    }

    return (
      <div className="dropdown ms-2 d-inline-block">
        <button
          className="btn btn-sm btn-outline-primary dropdown-toggle"
          type="button"
          id={`dropdownAddToSpace-${logEntry.timestamp}`}
          data-bs-toggle="dropdown"
          aria-expanded="false"
          title="Add to Space..."
        >
           <i className="bi bi-plus-square"></i> Add
        </button>
        <ul className="dropdown-menu dropdown-menu-sm" aria-labelledby={`dropdownAddToSpace-${logEntry.timestamp}`}>
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
            responses.map((item, index) => {
              const isResultType = item.type.toLowerCase() === 'tool_result' || item.type.toLowerCase() === 'resource_result';
              return (
                // Wrapper div to handle layout with potential button
                <div key={index} className="d-flex align-items-start mb-1">
                   <McpResponseDisplay logEntry={item} className="flex-grow-1" />
                   {/* Conditionally render the AddToSpaceControl */}
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