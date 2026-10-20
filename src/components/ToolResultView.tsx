import React, { useState } from 'react';
import type { LogEntry } from '../types';
import { OUTPUT_CONTRACT_FINDING_ID, type OutputContractResult } from '../utils/outputContract';
import FindingReferenceLink from './FindingReferenceLink';
import McpResponseDisplay from './McpResponseDisplay';
import './ToolResultView.css';

type ResultView = 'structured' | 'content' | 'raw';

interface ToolResultViewProps {
  logEntry: LogEntry;
}

const JsonBlock: React.FC<{ value: unknown }> = ({ value }) => (
  <div className="event-data">
    <pre><code className="language-json">{JSON.stringify(value, null, 2)}</code></pre>
  </div>
);

export const OutputContractVerdict: React.FC<{ contract: OutputContractResult; hasSchema: boolean }> = ({
  contract,
  hasSchema,
}) => {
  if (contract.status === 'pass') {
    return (
      <div className="output-contract output-contract--pass" role="status">
        <i className="bi bi-check-circle-fill" aria-hidden="true"></i>
        <span>Structured output matches the declared output schema.</span>
      </div>
    );
  }
  if (contract.status === 'fail') {
    const count = contract.violations.length;
    return (
      <div className="output-contract output-contract--fail" role="alert">
        <div className="output-contract-heading">
          <i className="bi bi-x-circle-fill" aria-hidden="true"></i>
          <span>
            Output contract broken: {count} {count === 1 ? 'problem' : 'problems'} found against the declared output schema.
          </span>
          <FindingReferenceLink id={OUTPUT_CONTRACT_FINDING_ID} />
        </div>
        <ul className="output-contract-violations">
          {contract.violations.map((violation, index) => (
            <li key={`${violation.path}-${index}`}>
              <code>{violation.path}</code>
              <span>{violation.message}</span>
            </li>
          ))}
        </ul>
      </div>
    );
  }
  if (contract.status === 'not-checked' && hasSchema) {
    return (
      <div className="output-contract output-contract--neutral" role="status">
        <i className="bi bi-dash-circle" aria-hidden="true"></i>
        <span>Not validated: error results are exempt from the output schema.</span>
      </div>
    );
  }
  if (contract.status === 'no-schema' && contract.hasStructuredContent) {
    return (
      <p className="output-contract-note">
        This tool declares no output schema, so its structured output is shown without validation.
      </p>
    );
  }
  return null;
};

/**
 * Renders a tools/call result: structured output first when present, with
 * views for the unstructured content blocks and the raw JSON-RPC response,
 * plus the output-contract verdict.
 */
const ToolResultView: React.FC<ToolResultViewProps> = ({ logEntry }) => {
  const toolCall = logEntry.toolCall;
  const hasStructuredContent = toolCall?.result.structuredContent !== undefined;
  const defaultView: ResultView = hasStructuredContent ? 'structured' : 'content';
  const [view, setView] = useState<ResultView>(defaultView);
  const [shownEntry, setShownEntry] = useState(logEntry);
  if (shownEntry !== logEntry) {
    // A new result starts on its primary view again.
    setShownEntry(logEntry);
    setView(defaultView);
  }

  const contentDisplay = (
    <McpResponseDisplay
      logEntry={logEntry}
      showTimestamp={false}
      spacesMode={true}
      toolName={logEntry.callContext?.name}
      hideControls={true}
      forceExpanded={true}
    />
  );

  if (!toolCall) return contentDisplay;

  const hasSchema = toolCall.outputSchema !== undefined;
  const isError = toolCall.result.isError === true;
  if (!hasStructuredContent && !hasSchema && !isError) return contentDisplay;

  const views: Array<{ id: ResultView; label: string }> = [
    ...(hasStructuredContent ? [{ id: 'structured' as const, label: 'Structured' }] : []),
    { id: 'content', label: 'Content' },
    { id: 'raw', label: 'JSON-RPC' },
  ];
  const activeView = views.some(item => item.id === view) ? view : 'content';

  return (
    <div className="tool-result-view">
      {isError && (
        <div className="tool-result-error" role="alert">
          <i className="bi bi-exclamation-triangle-fill" aria-hidden="true"></i>
          <span>The tool reported an error (isError: true).</span>
        </div>
      )}
      <OutputContractVerdict contract={toolCall.contract} hasSchema={hasSchema} />
      <div className="tool-result-view-switch" role="tablist" aria-label="Result view">
        {views.map(item => (
          <button
            key={item.id}
            type="button"
            role="tab"
            aria-selected={activeView === item.id}
            className={`btn btn-sm ${activeView === item.id ? 'btn-secondary' : 'btn-outline-secondary'}`}
            onClick={() => setView(item.id)}
          >
            {item.label}
          </button>
        ))}
      </div>
      <div className="tool-result-view-panel" role="tabpanel">
        {activeView === 'structured' && <JsonBlock value={toolCall.result.structuredContent} />}
        {activeView === 'content' && contentDisplay}
        {activeView === 'raw' && <JsonBlock value={{ jsonrpc: '2.0', result: toolCall.result }} />}
      </div>
    </div>
  );
};

export default ToolResultView;
