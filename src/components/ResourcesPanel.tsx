import React from 'react';

// Use 'any' for now until correct SDK types are confirmed/exported
type ResourceTemplate = any;

interface ResourcesPanelProps {
  resources: ResourceTemplate[];
  selectedResourceTemplate: ResourceTemplate | null;
  isConnected: boolean;
  isConnecting: boolean;
  handleListResources: () => void;
  handleSelectResourceTemplate: (template: ResourceTemplate) => void;
}

const ResourcesPanel: React.FC<ResourcesPanelProps> = ({
  resources,
  selectedResourceTemplate,
  isConnected,
  isConnecting,
  handleListResources,
  handleSelectResourceTemplate,
}) => {
  return (
    <div className="card mb-3">
       <div className="card-header d-flex justify-content-between">
         <h5>Available Resource Templates</h5>
         <button
           id="listResourcesBtn"
           className="btn btn-sm btn-outline-primary"
           onClick={handleListResources} // Use passed handler
           disabled={!isConnected || isConnecting}
         >
           Refresh Templates
         </button>
       </div>
       <div className="card-body p-0">
         <ul id="resourcesList" className="list-group list-group-flush" style={{ maxHeight: '150px', overflowY: 'auto' }}>
           {resources.length === 0 ? (
             <li className="list-group-item text-muted">
               {isConnected ? 'No templates found or click "Refresh Templates"' : 'Connect to server to list templates'}
             </li>
           ) : (
             resources.map((template: any) => (
               <li
                 key={template.uriTemplate} // Use correct key
                 className={`list-group-item list-group-item-action ${selectedResourceTemplate?.uriTemplate === template.uriTemplate ? 'active' : ''}`}
                 onClick={() => handleSelectResourceTemplate(template)} // Use passed handler
                 style={{ cursor: 'pointer' }}
                 title={template.description || template.uriTemplate}
               >
                 {template.uriTemplate}
               </li>
             ))
           )}
         </ul>
       </div>
    </div>
  );
};

export default ResourcesPanel;