import React from 'react';
import ReactMarkdown from 'react-markdown';
import remarkGfm from 'remark-gfm';
import {
  formatExampleValue,
  normalizeArrayQuotes,
  getCapabilityInputSpec,
  getExampleValue,
  getMissingRequiredParams,
  hasParameterValue,
  type CapabilityInputDefinition,
} from '../utils/capabilityParams';
import ToolSchemaDetails from './ToolSchemaDetails';
import './ConnectedGuide.css';

// Use 'any' for now until correct SDK types are confirmed/exported
type SelectedTool = any;
type ResourceTemplate = any;
type Prompt = any; // Add Prompt type (using any for now)

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
  // Execution state
  isExecuting: boolean;
  executionStartTime: number | null;
  /** Renders the server's call history; `showRequest` switches back to the form. */
  renderCallHistory?: (showRequest: () => void) => React.ReactNode;
  callHistoryCount?: number;
  openHistoryRequest?: number;
  firstToolName?: string;
  onOpenFirstTool?: () => void;
}

/** Render server Markdown safely; long manuals expand on demand. */
const CapabilityDescription: React.FC<{ text: string; kind: string }> = ({ text, kind }) => (
  <div className="capability-description-text">
    {text.length <= 220 ? <ReactMarkdown remarkPlugins={[remarkGfm]}>{text}</ReactMarkdown> : (
      <details className="capability-description">
        <summary>About this {kind}</summary>
        <ReactMarkdown remarkPlugins={[remarkGfm]}>{text}</ReactMarkdown>
      </details>
    )}
  </div>
);

/** Resize after edits, restored history, examples, and column width changes. */
const JsonInput: React.FC<React.TextareaHTMLAttributes<HTMLTextAreaElement>> = (props) => {
  const ref = React.useRef<HTMLTextAreaElement>(null);
  React.useLayoutEffect(() => {
    const input = ref.current;
    if (!input) return;
    const resize = () => {
      input.style.height = 'auto';
      input.style.height = `${input.scrollHeight + 2}px`;
    };
    resize();
    if (typeof ResizeObserver === 'undefined') return;
    let width = input.clientWidth;
    const observer = new ResizeObserver(() => {
      if (width !== input.clientWidth) { width = input.clientWidth; resize(); }
    });
    observer.observe(input);
    return () => observer.disconnect();
  }, [props.value]);
  return <textarea {...props} ref={ref} />;
};

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
  isExecuting,
  executionStartTime,
  renderCallHistory,
  callHistoryCount = 0,
  openHistoryRequest = 0,
  firstToolName,
  onOpenFirstTool,
}) => {
  const panelId = React.useId();
  const [view, setView] = React.useState<'request' | 'history'>('request');
  const historyTabRef = React.useRef<HTMLButtonElement>(null);
  React.useEffect(() => {
    if (openHistoryRequest > 0) {
      setView('history');
      historyTabRef.current?.focus();
      historyTabRef.current?.scrollIntoView?.({ block: 'nearest' });
    }
  }, [openHistoryRequest]);
  const showingHistory = view === 'history' && Boolean(renderCallHistory) && isConnected;

  // Timer state
  const [elapsedTime, setElapsedTime] = React.useState<string>('');
  
  // Update timer display
  React.useEffect(() => {
    if (isExecuting && executionStartTime) {
      const interval = setInterval(() => {
        const elapsed = (Date.now() - executionStartTime) / 1000;
        setElapsedTime(elapsed.toFixed(1) + 's');
      }, 100);
      
      return () => clearInterval(interval);
    } else {
      setElapsedTime('');
    }
  }, [isExecuting, executionStartTime]);

  const selectedInputItem = selectedTool || selectedPrompt;
  const activeInputParams = selectedTool ? toolParams : promptParams;

  React.useEffect(() => {
    if (!selectedInputItem) return;

    const { definitions, required } = getCapabilityInputSpec(selectedInputItem);
    definitions.forEach((definition) => {
      if (
        definition.type === 'boolean'
        && required.includes(definition.name)
        && !hasParameterValue(activeInputParams[definition.name])
      ) {
        handleParamChange(definition.name, false);
      }
    });
  }, [selectedInputItem, activeInputParams, handleParamChange]);

  const missingRequiredParams = selectedInputItem
    ? getMissingRequiredParams(selectedInputItem, activeInputParams)
    : [];
  const canRun = isConnected && !isConnecting && !isExecuting && missingRequiredParams.length === 0;
  const actionLabel = selectedTool
    ? 'Run tool'
    : selectedPrompt
      ? 'Get prompt'
      : 'Read resource';

  // Handler for Enter key press
  const handleKeyDown = (e: React.KeyboardEvent) => {
    const isTextarea = (e.target as HTMLElement).tagName === 'TEXTAREA';
    if (e.key === 'Enter' && (!isTextarea || e.ctrlKey || e.metaKey)) {
      e.preventDefault();
      if (!canRun) return;
      if (selectedTool) {
        handleExecuteTool();
      } else if (selectedPrompt) {
        handleExecutePrompt();
      } else if (selectedResourceTemplate) {
        handleAccessResource();
      }
    }
  };

  // --- Render Helper for Input Parameters (Tools or Prompts) ---
  const renderInputParams = (
    item: SelectedTool | Prompt | null,
    params: Record<string, any>,
    paramType: 'tool' | 'prompt'
  ) => {
    if (!item) { return null; }
    const idPrefix = paramType === 'tool' ? 'param' : 'prompt-param';

    const { definitions: parameterDefinitions, required: requiredParams } = getCapabilityInputSpec(item);

    if (parameterDefinitions.length === 0) {
      return <>{item.description && <CapabilityDescription text={item.description} kind={paramType} />}<p className="text-muted">This {paramType} has no parameters.</p></>;
    }

    // Helper function to render a single input based on schema/arg definition
    const renderSingleInput = (definition: CapabilityInputDefinition) => {
        const name = definition.name;
        const isRequired = requiredParams.includes(name);
        const inputType = definition.type || 'text'; // Default to text if type is missing
        const isMissing = isRequired && !hasParameterValue(params[name]);
        const example = getExampleValue(definition);
        const exampleText = example !== undefined ? formatExampleValue(example) : undefined;
        const exampleFits = example !== undefined && (
          inputType === 'object' || inputType === 'array'
            ? typeof example === 'object'
            : inputType === 'boolean' ? typeof example === 'boolean'
              : inputType === 'integer' || inputType === 'number' ? typeof example === 'number'
                : typeof example === 'string' || typeof example === 'number'
        );
        const jsonValue = params[name] == null ? '' : typeof params[name] === 'string'
          ? params[name] : JSON.stringify(params[name], null, 2);
        const exampleHintId = `${idPrefix}-${name}-example`;

        return (
            <div key={`${idPrefix}-${name}`} className="param-form mb-3">
            <label htmlFor={`${idPrefix}-${name}`} className={`form-label ${inputType === 'boolean' ? 'param-boolean-label' : ''}`}>
                {inputType === 'boolean' && (
                  <input type="checkbox" className="form-check-input" id={`${idPrefix}-${name}`}
                    checked={!!params[name]} onChange={(e) => handleParamChange(name, e.target.checked)}
                    onKeyDown={handleKeyDown} aria-required={isRequired}
                    aria-describedby={definition.description ? `${idPrefix}-${name}-description` : undefined} />
                )}
                {name} {isRequired && <span className="required-mark" aria-label="required">*</span>} {definition.type && <span className="param-type">{definition.type}{inputType === 'array' ? ' (JSON)' : ''}</span>}
            </label>
            {definition.description && <p className="param-description" id={`${idPrefix}-${name}-description`}>{definition.description}</p>}
            {exampleText !== undefined && (
              <p className="param-example" id={exampleHintId}>
                Example: <code>{exampleText}</code>
                {exampleFits && (
                  <button
                    type="button"
                    className="btn btn-link btn-sm param-example-use"
                    onClick={() => handleParamChange(
                      name,
                      inputType === 'object' || inputType === 'array' ? JSON.stringify(example, null, 2) : example
                    )}
                    aria-label={`Use the example value for ${name}`}
                  >
                    Use example
                  </button>
                )}
              </p>
            )}

            {inputType === 'array' && <p className="param-description" id={`${idPrefix}-${name}-json-help`}>JSON array; single-quoted strings are accepted.</p>}
            {/* Input rendering logic based on type */}
            {inputType === 'boolean' ? null : inputType === 'integer' || inputType === 'number' ? (
                <input
                type="number"
                className="form-control"
                id={`${idPrefix}-${name}`}
                value={params[name] ?? ''}
                onChange={(e) => handleParamChange(name, e.target.value === '' ? undefined : Number(e.target.value))}
                onKeyDown={handleKeyDown}
                placeholder={definition.default !== undefined ? `Default: ${definition.default}` : ''}
                required={isRequired}
                aria-required={isRequired}
                aria-invalid={isMissing}
                />
            ) : inputType === 'string' && definition.enum ? (
                <select
                className="form-select"
                id={`${idPrefix}-${name}`}
                value={params[name] ?? ''}
                onChange={(e) => handleParamChange(name, e.target.value)}
                onKeyDown={handleKeyDown}
                required={isRequired}
                aria-required={isRequired}
                aria-invalid={isMissing}
                >
                <option value="" disabled>{definition.description || `Select ${name}`}</option>
                {definition.enum.map((option: string) => (<option key={option} value={option}>{option}</option>))}
                </select>
            ) : inputType === 'object' || inputType === 'array' ? (
                <JsonInput
                className="form-control font-monospace param-json-input"
                id={`${idPrefix}-${name}`}
                rows={inputType === 'array' ? Math.min(10, jsonValue.split('\n').length) : 5}
                value={jsonValue}
                onBlur={(e) => {
                  if (inputType === 'array') {
                    const normalized = normalizeArrayQuotes(e.target.value);
                    if (normalized !== e.target.value) handleParamChange(name, normalized);
                  }
                }}
                onChange={(e) => handleParamChange(name, e.target.value)}
                onKeyDown={handleKeyDown}
                aria-describedby={inputType === 'array' ? `${idPrefix}-${name}-json-help` : undefined}
                placeholder={inputType === 'array' ? 'e.g., ["TypeScript", "TSX"]' : 'e.g., { }'}
                required={isRequired}
                aria-required={isRequired}
                aria-invalid={isMissing}
                spellCheck={false}
                />
            ) : inputType === 'string' && (definition.format === 'text' || definition.format === 'textarea') ? (
                <textarea
                className="form-control"
                id={`${idPrefix}-${name}`}
                rows={3}
                value={params[name] ?? ''}
                onChange={(e) => handleParamChange(name, e.target.value)}
                onKeyDown={handleKeyDown}
                placeholder={definition.default !== undefined ? String(definition.default) : ''}
                required={isRequired}
                aria-required={isRequired}
                aria-invalid={isMissing}
                />
            ) : ( // Default to text input
                <input
                type="text"
                className="form-control"
                id={`${idPrefix}-${name}`}
                value={params[name] ?? ''}
                onChange={(e) => handleParamChange(name, e.target.value)}
                onKeyDown={handleKeyDown}
                placeholder={definition.default !== undefined
                  ? `Default: ${definition.default}`
                  : exampleText !== undefined ? `e.g. ${exampleText}` : `Enter ${name}`}
                aria-describedby={exampleText !== undefined ? exampleHintId : undefined}
                required={isRequired}
                aria-required={isRequired}
                aria-invalid={isMissing}
                />
            )}
            </div>
        );
    };


    const hasRequired = parameterDefinitions.some(({ name }) => requiredParams.includes(name));
    return (
      <>
        {item.description && <CapabilityDescription text={item.description} kind={paramType} />}
        {hasRequired && (
          <p className="param-required-legend">
            Fields marked <span className="required-mark" aria-hidden="true">*</span> are required.
          </p>
        )}
        {parameterDefinitions.map((definition) => renderSingleInput(definition))}
      </>
    );
  }; // End of renderInputParams

  // --- Render Helper for Resource Template Arguments ---
  const renderResourceTemplateArgs = () => {
    if (!selectedResourceTemplate) { return null; }
    const args = parseUriTemplateArgs(selectedResourceTemplate.uriTemplate);
    if (args.length === 0) {
      return <p className="text-muted">This resource has no parameters.</p>;
    }

    return (
      <>
        {selectedResourceTemplate.description && (
          <details className="capability-description">
            <summary>About this resource</summary>
            <p>{selectedResourceTemplate.description}</p>
          </details>
        )}
        {args.map((argName) => (
          <div key={argName} className="param-form mb-3">
            <label htmlFor={`res-arg-${argName}`} className="form-label">{argName}</label>
            <input
              type="text"
              className="form-control"
              id={`res-arg-${argName}`}
              value={resourceArgs[argName] ?? ''}
              onChange={(e) => handleResourceArgChange(argName, e.target.value)}
              onKeyDown={handleKeyDown}
              placeholder={`Enter value for {${argName}}`}
            />
          </div>
        ))}
      </>
    );
  }; // End of renderResourceTemplateArgs

  // --- Main Component Return ---
  return (
    // Add conditional class for deactivated state
    <div className={`card request-panel ${!isConnected ? 'panel-deactivated' : ''}`}>
      <div className="card-header">
        <div className="request-panel-heading">
          <h5 className="mb-0 text-truncate">
            {showingHistory
             ? 'History'
             : selectedTool?.name
             || selectedPrompt?.name
             || selectedResourceTemplate?.name
             || selectedResourceTemplate?.uriTemplate
             || 'Select a capability'}
          </h5>
          {renderCallHistory && isConnected && (
            <div className="nav nav-tabs panel-view-tabs" role="tablist" aria-label="Request panel view"
              onKeyDown={(event) => {
                if (!['ArrowLeft', 'ArrowRight', 'Home', 'End'].includes(event.key)) return;
                event.preventDefault();
                const history = event.key === 'End' || (event.key !== 'Home' && !showingHistory);
                setView(history ? 'history' : 'request');
                event.currentTarget.querySelectorAll<HTMLButtonElement>('[role="tab"]')[history ? 1 : 0]?.focus();
              }}>
              <button type="button" className={`nav-link ${!showingHistory ? 'active' : ''}`} role="tab" id={`${panelId}-request`} aria-controls={`${panelId}-body`} tabIndex={!showingHistory ? 0 : -1} aria-selected={!showingHistory} onClick={() => setView('request')}>
                Request
              </button>
              <button type="button" className={`nav-link ${showingHistory ? 'active' : ''}`} ref={historyTabRef} role="tab" id={`${panelId}-history`} aria-controls={`${panelId}-body`} tabIndex={showingHistory ? 0 : -1} aria-selected={showingHistory} onClick={() => setView('history')}>
                History{callHistoryCount > 0 ? ` (${callHistoryCount})` : ''}
              </button>
            </div>
          )}
        </div>
      </div>
      <div className="card-body request-panel-body" id={`${panelId}-body`}
        role={renderCallHistory && isConnected ? 'tabpanel' : undefined}
        aria-labelledby={renderCallHistory && isConnected ? `${panelId}-${showingHistory ? 'history' : 'request'}` : undefined}>
        {showingHistory ? (
          renderCallHistory!(() => setView('request'))
        ) : !isConnected ? (
          <p className="text-muted p-2">Connect to an MCP server to build requests here.</p>
        ) : !selectedTool && !selectedResourceTemplate && !selectedPrompt ? (
          <div className="request-empty-state">
            <p className="request-empty-title">No capability selected</p>
            <p>
              Pick a tool from Capabilities to call it. Its description and a form built from its
              input schema appear here, with required fields marked, and <strong>Run tool</strong> sends the call.
            </p>
            {firstToolName && onOpenFirstTool && (
              <button type="button" className="btn btn-primary" onClick={onOpenFirstTool}>
                Open {firstToolName} <span aria-hidden="true">→</span>
              </button>
            )}
          </div>
        ) : (
          <div id="paramsArea">
            {/* Render parameters/arguments based on selection */}
            {selectedTool && renderInputParams(selectedTool, toolParams, 'tool')}
            {selectedTool && <ToolSchemaDetails tool={selectedTool} />}
            {selectedPrompt && renderInputParams(selectedPrompt, promptParams, 'prompt')}
            {selectedResourceTemplate && renderResourceTemplateArgs()}

          </div>
        )}

      </div>

        {/* Buttons */}
        {!showingHistory && (selectedTool || selectedPrompt || selectedResourceTemplate) && (
          <div className="request-actions">
            {missingRequiredParams.length > 0 && (
              <p className="request-validation" role="status">
                Complete {missingRequiredParams.map((name) => `“${name}”`).join(', ')} to continue.
              </p>
            )}
            <button
              id="executeBtn"
              className="btn btn-success w-100"
              onClick={selectedTool ? handleExecuteTool : selectedPrompt ? handleExecutePrompt : handleAccessResource}
              disabled={!canRun}
            >
             {isExecuting ? (
               <>
                 <span className="spinner-border spinner-border-sm" role="status" aria-hidden="true"></span>
                 <span className="ms-2">Running... {elapsedTime}</span>
               </>
             ) : (
               actionLabel
             )}
            </button>
          </div>
        )}
    </div>
  );
};

export default ParamsPanel;
