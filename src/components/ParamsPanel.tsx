import React from 'react';

// Use 'any' for now until correct SDK types are confirmed/exported
type SelectedTool = any;
type ResourceTemplate = any;
type Prompt = any; // Add Prompt type (using any for now)

interface InputParameterSchema { // Renamed for reusability
    type?: string;
    description?: string;
    default?: any;
    enum?: string[];
    format?: string;
    title?: string;
    // Added properties from the 'arguments' array format
    name?: string;
    required?: boolean;
}

interface ParamsPanelProps {
  selectedTool: SelectedTool | null;
  selectedResourceTemplate: ResourceTemplate | null;
  selectedPrompt: Prompt | null; // Add selectedPrompt
  toolParams: Record<string, any>;
  resourceArgs: Record<string, any>;
  promptParams: Record<string, any>; // Add promptParams
  isConnected: boolean;
  isConnecting: boolean;
  handleParamChange: (paramName: string, value: any) => void; // Note: App.tsx passes a wrapper
  handleResourceArgChange: (argName: string, value: any) => void;
  handleExecuteTool: () => void;
  handleExecutePrompt: () => void; // Add handleExecutePrompt
  handleAccessResource: () => void;
  parseUriTemplateArgs: (templateString: string) => string[];
  // History props
  toolHistory: any[];
  resourceHistory: any[];
  setToolParams: React.Dispatch<React.SetStateAction<Record<string, any>>>;
  setResourceArgs: React.Dispatch<React.SetStateAction<Record<string, any>>>;
}

const ParamsPanel: React.FC<ParamsPanelProps> = ({
  selectedTool,
  selectedResourceTemplate,
  selectedPrompt,
  toolParams,
  resourceArgs,
  promptParams,
  isConnected,
  isConnecting,
  handleParamChange, // Note: App.tsx passes a wrapper that determines type (tool/prompt)
  handleResourceArgChange,
  handleExecuteTool,
  handleExecutePrompt,
  handleAccessResource,
  parseUriTemplateArgs,
  // History props
  toolHistory,
  resourceHistory,
  setToolParams,
  setResourceArgs,
}) => {

  // --- Render Helper for Input Parameters (Tools or Prompts) ---
  const renderInputParams = (
    item: SelectedTool | Prompt | null,
    params: Record<string, any>,
    paramType: 'tool' | 'prompt'
  ) => {
    if (!item) { return null; }
    const idPrefix = paramType === 'tool' ? 'param' : 'prompt-param';

    let parameterDefinitions: InputParameterSchema[] = [];
    let requiredParams: string[] = [];

    // Check for inputSchema.properties format
    const inputSchema = item.inputSchema || item.input_schema;
    if (inputSchema?.properties) {
      parameterDefinitions = Object.entries(inputSchema.properties).map(([name, schema]) => ({ name, ...(schema as object) } as InputParameterSchema));
      requiredParams = inputSchema.required || [];
    }
    // Check for arguments array format
    else if (Array.isArray(item.arguments) && item.arguments.length > 0) {
      parameterDefinitions = item.arguments;
      // Extract required from the arguments array itself
      requiredParams = item.arguments.filter((arg: any) => arg.required).map((arg: any) => arg.name);
    }

    if (parameterDefinitions.length === 0) {
      return <p className="text-muted">{paramType === 'tool' ? 'Tool' : 'Prompt'} has no defined parameters.</p>;
    }

    // Helper function to render a single input based on schema/arg definition
    const renderSingleInput = (definition: InputParameterSchema) => {
        const name = definition.name!; // Name should always exist here
        const isRequired = requiredParams.includes(name);
        const inputType = definition.type || 'text'; // Default to text if type is missing

        return (
            <div key={`${idPrefix}-${name}`} className="param-form mb-3">
            <label htmlFor={`${idPrefix}-${name}`} className="form-label">
                {name} {isRequired ? '*' : ''} {definition.type && <span className="text-muted ms-2">({definition.type})</span>}
            </label>
            {definition.description && <p className="param-description">{definition.description}</p>}

            {/* Input rendering logic based on type */}
            {inputType === 'boolean' ? (
                <div className="form-check">
                <input
                    type="checkbox"
                    className="form-check-input"
                    id={`${idPrefix}-${name}`}
                    checked={!!params[name]}
                    onChange={(e) => handleParamChange(name, e.target.checked)}
                />
                <label className="form-check-label" htmlFor={`${idPrefix}-${name}`}>
                    {definition.title || name}
                </label>
                </div>
            ) : inputType === 'integer' || inputType === 'number' ? (
                <input
                type="number"
                className="form-control"
                id={`${idPrefix}-${name}`}
                value={params[name] ?? ''}
                onChange={(e) => handleParamChange(name, e.target.value === '' ? undefined : Number(e.target.value))}
                placeholder={definition.default !== undefined ? `Default: ${definition.default}` : ''}
                />
            ) : inputType === 'string' && definition.enum ? (
                <select
                className="form-select"
                id={`${idPrefix}-${name}`}
                value={params[name] ?? ''}
                onChange={(e) => handleParamChange(name, e.target.value)}
                >
                <option value="" disabled>{definition.description || `Select ${name}`}</option>
                {definition.enum.map((option: string) => (<option key={option} value={option}>{option}</option>))}
                </select>
            ) : inputType === 'string' && (definition.format === 'text' || definition.format === 'textarea') ? (
                <textarea
                className="form-control"
                id={`${idPrefix}-${name}`}
                rows={3}
                value={params[name] ?? ''}
                onChange={(e) => handleParamChange(name, e.target.value)}
                placeholder={definition.description || ''}
                />
            ) : ( // Default to text input
                <input
                type="text"
                className="form-control"
                id={`${idPrefix}-${name}`}
                value={params[name] ?? ''}
                onChange={(e) => handleParamChange(name, e.target.value)}
                placeholder={definition.default !== undefined ? `Default: ${definition.default}` : (definition.description || `Enter ${name}`)}
                />
            )}
            </div>
        );
    };


    return (
      <>
        {item.description && <p className="tool-description">{item.description}</p>}
        {parameterDefinitions.map((definition) => renderSingleInput(definition))}
      </>
    );
  }; // End of renderInputParams

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
  }; // End of renderResourceTemplateArgs

  // --- History Click Handlers ---
  const handleToolHistoryClick = (historyItem: any) => {
    setToolParams(historyItem);
  };

  const handleResourceHistoryClick = (historyItem: any) => {
    setResourceArgs(historyItem);
  };

  // --- Render Helper for History List ---
  const renderHistoryList = (history: any[], onClick: (item: any) => void) => {
    if (!history || history.length === 0) {
      return <p className="text-muted small mt-2">No recent history.</p>;
    }
    return (
      <div className="mt-3 border-top pt-3">
        <h6>Recent Calls:</h6>
        <ul className="list-group list-group-flush" style={{ maxHeight: '150px', overflowY: 'auto' }}>
          {history.map((item, index) => (
            <li key={index} className="list-group-item list-group-item-action p-2" onClick={() => onClick(item)} style={{ cursor: 'pointer', lineHeight: '1.3' }}>
              {Object.entries(item).map(([key, value]) => (
                <div key={key} style={{ marginBottom: '2px' }}>
                  <span style={{ fontSize: '0.75em', color: '#6c757d', display: 'block' }}>{key}:</span>
                  <span style={{ wordBreak: 'break-all', fontSize: '0.85em' }}>{JSON.stringify(value)}</span> {/* Stringify value in case it's not a string */}
                </div>
              ))}
            </li>
          ))}
        </ul>
      </div>
    );
  };


  // --- Main Component Return ---
  return (
    // Add conditional class for deactivated state
    <div className={`card mb-3 ${!isConnected ? 'panel-deactivated' : ''}`}>
      <div className="card-header">
        <h5>
          {selectedTool ? `Tool Parameters (${selectedTool.name})`
           : selectedPrompt ? `Prompt Parameters (${selectedPrompt.name})`
           : selectedResourceTemplate ? `Resource Arguments (${selectedResourceTemplate.name || selectedResourceTemplate.uriTemplate})`
           : 'Parameters / Arguments'}
        </h5>
      </div>
      <div className="card-body" style={{ maxHeight: 'calc(100vh - 250px)', overflowY: 'auto' }}>
        <div id="paramsArea">
          {/* Render parameters/arguments based on selection */}
          {selectedTool && renderInputParams(selectedTool, toolParams, 'tool')}
          {selectedPrompt && renderInputParams(selectedPrompt, promptParams, 'prompt')}
          {selectedResourceTemplate && renderResourceTemplateArgs()}
          {!selectedTool && !selectedPrompt && !selectedResourceTemplate && <p className="text-muted p-2">Select a tool, prompt, or resource template.</p>}

          {/* Render History */}
          {selectedTool && renderHistoryList(toolHistory, handleToolHistoryClick)}
          {selectedResourceTemplate && renderHistoryList(resourceHistory, handleResourceHistoryClick)}

        </div>

        {/* Buttons */}
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
         {selectedPrompt && (
          <button
            id="executePromptBtn"
            className="btn btn-primary w-100 mt-3"
            onClick={handleExecutePrompt}
            disabled={!selectedPrompt || !isConnected || isConnecting}
          >
            Execute Prompt
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