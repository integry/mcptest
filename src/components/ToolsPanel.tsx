import React from 'react';

// Use 'any' for now until correct SDK types are confirmed/exported
type ToolDefinition = any;
type SelectedTool = any;

interface ToolsPanelProps {
  tools: ToolDefinition[];
  selectedTool: SelectedTool | null;
  isConnected: boolean;
  isConnecting: boolean;
  handleListTools: () => void;
  handleSelectTool: (tool: ToolDefinition) => void;
}

const ToolsPanel: React.FC<ToolsPanelProps> = ({
  tools,
  selectedTool,
  isConnected,
  isConnecting,
  handleListTools,
  handleSelectTool,
}) => {
  return (
    <div className="card mb-3">
       <div className="card-header d-flex justify-content-between">
         <h5>Available Tools</h5>
         <button
           id="listToolsBtn"
           className="btn btn-sm btn-outline-primary"
           onClick={handleListTools} // Use passed handler
           disabled={!isConnected || isConnecting}
         >
           Refresh Tools
         </button>
       </div>
       <div className="card-body p-0">
         <ul id="toolsList" className="list-group list-group-flush" style={{ maxHeight: '200px', overflowY: 'auto' }}>
           {tools.length === 0 ? (
             <li className="list-group-item text-muted">
               {isConnected ? 'No tools found or click "Refresh Tools"' : 'Connect to server to list tools'}
             </li>
           ) : (
             tools.map((tool: any) => (
               <li
                 key={tool.name}
                 className={`list-group-item list-group-item-action ${selectedTool?.name === tool.name ? 'active' : ''}`}
                 onClick={() => handleSelectTool(tool)} // Use passed handler
                 style={{ cursor: 'pointer' }}
                 title={tool.description || tool.name}
               >
                 {tool.name}
               </li>
             ))
           )}
         </ul>
       </div>
    </div>
  );
};

export default ToolsPanel;