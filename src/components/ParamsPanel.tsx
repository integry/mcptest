import React from 'react';

// Use 'any' for now until correct SDK types are confirmed/exported
type SelectedTool = any;
type ResourceTemplate = any;

interface ToolParameterSchema {
    type?: string;
    description?: string;
    default?: any;
    enum?: string[];
    format?: string;
    title?: string;
}

interface ParamsPanelProps {
  selectedTool: SelectedTool | null;
  selectedResourceTemplate: ResourceTemplate | null;
  toolParams: Record<string, any>;
  resourceArgs: Record<string, any>;
  isConnected: boolean;
  isConnecting: boolean;
  handleParamChange: (paramName: string, value: any) => void;
  handleResourceArgChange: (argName: string, value: any) => void;
  handleExecuteTool: () => void;
  handleAccessResource: () => void; // Placeholder for future use
  parseUriTemplateArgs: (templateString: string) => string[]; // Pass helper function
}

const ParamsPanel: React.FC<ParamsPanelProps> = ({
  selectedTool,
  selectedResourceTemplate,
  toolParams,
  resourceArgs,
  isConnected,
  isConnecting,
  handleParamChange,
  handleResourceArgChange,
  handleExecuteTool,
  handleAccessResource,
  parseUriTemplateArgs,
}) => {

  // --- Render Helper for Tool Parameters ---
  const renderToolParams = () => {
      if (!selectedTool) { return null; } // Should not be called if no tool selected
      if (!selectedTool.input_schema?.properties) { return <p className="text-muted">Tool has no defined parameters.</p>; }
      const { properties, required } = selectedTool.input_schema;
      return (
          <>
              {selectedTool.description && <p className="tool-description">{selectedTool.description}</p>}
              {Object.entries(properties).map(([name, schema]) => (
                  <div key={name} className="param-form mb-3">
                      <label htmlFor={`param-${name}`} className="form-label">{name} {required?.includes(name) ? '*' : ''} {(schema as any)?.type && <span className="text-muted ms-2">({(schema as any)?.type})</span>}</label>
                      {(schema as any)?.description && <p className="param-description">{(schema as any)?.description}</p>}
                      {(schema as any)?.type === 'boolean' ? (<div className="form-check"><input type="checkbox" className="form-check-input" id={`param-${name}`} checked={!!toolParams[name]} onChange={(e) => handleParamChange(name, e.target.checked)} /><label className="form-check-label" htmlFor={`param-${name}`}>{(schema as any)?.title || name}</label></div>
                      ) : (schema as any)?.type === 'integer' || (schema as any)?.type === 'number' ? (<input type="number" className="form-control" id={`param-${name}`} value={toolParams[name] ?? ''} onChange={(e) => handleParamChange(name, e.target.value === '' ? undefined : Number(e.target.value))} placeholder={(schema as any)?.default !== undefined ? `Default: ${(schema as any)?.default}` : ''} />
                      ) : (schema as any)?.type === 'string' && (schema as any)?.enum ? (<select className="form-select" id={`param-${name}`} value={toolParams[name] ?? ''} onChange={(e) => handleParamChange(name, e.target.value)}><option value="" disabled>{(schema as any)?.description || `Select ${name}`}</option>{(schema as any)?.enum.map((option: string) => (<option key={option} value={option}>{option}</option>))}</select>
                      ) : (schema as any)?.type === 'string' && ((schema as any)?.format === 'text' || (schema as any)?.format === 'textarea') ? (<textarea className="form-control" id={`param-${name}`} rows={3} value={toolParams[name] ?? ''} onChange={(e) => handleParamChange(name, e.target.value)} placeholder={(schema as any)?.description || ''} />
                      ) : (<input type="text" className="form-control" id={`param-${name}`} value={toolParams[name] ?? ''} onChange={(e) => handleParamChange(name, e.target.value)} placeholder={(schema as any)?.default !== undefined ? `Default: ${(schema as any)?.default}` : ''} />
                      )}
                  </div>
              ))}
          </>
      );
  };

  // --- Render Helper for Resource Template Arguments ---
  const renderResourceTemplateArgs = () => {
      if (!selectedResourceTemplate) { return null; }
      const args = parseUriTemplateArgs(selectedResourceTemplate.uriTemplate);
      if (args.length === 0) {
          return <p className="text-muted">Resource template has no arguments.</p>;
      }

      return (
          <>
              {selectedResourceTemplate.description && <p className="tool-description">{selectedResourceTemplate.description}</p>}
              {args.map((argName) => (
                  <div key={argName} className="param-form mb-3">
                      <label htmlFor={`res-arg-${argName}`} className="form-label">{argName}</label>
                      <input
                          type="text"
                          className="form-control"
                          id={`res-arg-${argName}`}
                          value={resourceArgs[argName] ?? ''}
                          onChange={(e) => handleResourceArgChange(argName, e.target.value)}
                          placeholder={`Enter value for {${argName}}`}
                      />
                  </div>
              ))}
          </>
      );
  };


  return (
    <div className="card mb-3">
      <div className="card-header">
        <h5>
          {selectedTool ? `Tool Parameters (${selectedTool.name})`
           : selectedResourceTemplate ? `Resource Arguments (${selectedResourceTemplate.name || selectedResourceTemplate.uriTemplate})`
           : 'Parameters / Arguments'}
        </h5>
      </div>
      <div className="card-body" style={{ maxHeight: 'calc(100vh - 250px)', overflowY: 'auto' }}>
        <div id="paramsArea">
          {selectedTool && renderToolParams()}
          {selectedResourceTemplate && renderResourceTemplateArgs()}
          {!selectedTool && !selectedResourceTemplate && <p className="text-muted p-2">Select a tool or resource template.</p>}
        </div>
        {selectedTool && (
          <button
            id="executeToolBtn"
            className="btn btn-success w-100 mt-3"
            onClick={handleExecuteTool}
            disabled={!selectedTool || !isConnected || isConnecting}
          >
            Execute Tool
          </button>
        )}
        {selectedResourceTemplate && (
          <button
            id="accessResourceBtn"
            className="btn btn-info w-100 mt-3"
            onClick={handleAccessResource}
            disabled={!selectedResourceTemplate || !isConnected || isConnecting}
          >
            Access Resource
          </button>
        )}
      </div>
    </div>
  );
};

export default ParamsPanel;