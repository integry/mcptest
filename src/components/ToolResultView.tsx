import { createPortal } from 'react-dom';
import JsonCode from './JsonCode';
import React, { useState } from 'react';
import type { LogEntry } from '../types';
import { OUTPUT_CONTRACT_FINDING_ID, type OutputContractResult } from '../utils/outputContract';
import FindingReferenceLink from './FindingReferenceLink';
import McpResponseDisplay from './McpResponseDisplay';
import './ToolResultView.css';
import './ConnectedGuide.css';

type ResultView = 'structured' | 'content' | 'raw';

interface ToolResultViewProps {
  logEntry: LogEntry;
  controlsTarget?: HTMLElement | null;
}

const JsonBlock: React.FC<{ value: unknown }> = ({ value }) => (
  <div className="event-data">
    <pre><JsonCode text={JSON.stringify(value, null, 2) ?? ''} /></pre>
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

const EXPLANATIONS: Record<'structured' | 'content' | 'raw' | 'plainRaw' | 'error', string> = {
  structured: 'Structured content is the typed JSON the tool returned in structuredContent, checked against its output schema when it declares one.',
  content: 'Content is the list of text, image or resource blocks a model reads from this call.',
  // The client keeps only the parsed tools/call result, not the response envelope.
  raw: 'This is the tool result rebuilt as JSON-RPC. The envelope is reconstructed, so the original request id is not shown.',
  plainRaw: 'This is the tool result as JSON, rebuilt from what the client parsed. The JSON-RPC envelope and request id are not shown.',
  error: 'The tool ran but reported a failure (isError: true). The content explains why; the connection itself is fine.',
};

/**
 * One line on what the current view shows, with a way to the result JSON.
 * `plain` results have no view tabs, so the link toggles the raw view itself.
 */
const ResultExplanation: React.FC<{
  kind: Exclude<keyof typeof EXPLANATIONS, 'plainRaw'>;
  plain?: boolean;
  hideToggle?: boolean;
  contentSummary?: string;
  rawShown: boolean;
  onViewRaw: () => void;
}> = ({ kind, plain = false, hideToggle = false, contentSummary, rawShown, onViewRaw }) => (
  <p className="tool-result-explanation">
    <span title={plain && !rawShown ? EXPLANATIONS.content : undefined}>
      {plain && !rawShown ? contentSummary : plain && rawShown ? EXPLANATIONS.plainRaw : EXPLANATIONS[kind]}
    </span>
    {!hideToggle && (plain || !rawShown) && (
      <button
        type="button"
        className="btn btn-outline-secondary btn-sm tool-result-raw-link"
        onClick={onViewRaw}
        {...(plain ? { 'aria-pressed': rawShown } : {})}
      >
        {plain && rawShown ? 'View formatted content' : 'View raw JSON'}
      </button>
    )}
  </p>
);

/**
 * Renders a tools/call result: structured output first when present, with
 * views for the unstructured content blocks and a reconstructed JSON-RPC response,
 * plus the output-contract verdict.
 */
const ToolResultView: React.FC<ToolResultViewProps> = ({ logEntry, controlsTarget }) => {
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

  const renderContent = (data: unknown, key?: number) => (
    <McpResponseDisplay
      key={key}
      logEntry={{ ...logEntry, data }}
      showTimestamp={false}
      spacesMode={true}
      toolName={logEntry.callContext?.name}
      hideControls={true}
      forceExpanded={true}
    />
  );

  // Render each block independently so multiple text blocks retain Markdown and line breaks.
  // Non-text blocks remain inspectable through the existing JSON fallback.
  const blocks = toolCall?.result.content ?? logEntry.data;
  const contentDisplay = Array.isArray(blocks)
    ? blocks.map((block, index) => renderContent([block], index))
    : renderContent(blocks);

  if (!toolCall) return contentDisplay;

  const hasSchema = toolCall.outputSchema !== undefined;
  const isError = toolCall.result.isError === true;
  // Reconstructed: only the parsed result is stored, not the server's envelope.
  const rawResponse = { jsonrpc: '2.0', result: toolCall.result };
  if (!hasStructuredContent && !hasSchema && !isError) {
    const contentBlocks = Array.isArray(blocks) ? blocks : [];
    const count = contentBlocks.length;
    const blockType = count > 0 && contentBlocks.every(block => block.type === 'text') ? 'text' : 'content';
    const contentSummary = `${count} ${blockType} ${count === 1 ? 'block' : 'blocks'} · unstructured`;
    // Keep protocol background in the tooltip so the output starts immediately.
    return (
      <div className="tool-result-view tool-result-view--plain">
        {controlsTarget && createPortal(
          <>
            <div className="tool-result-view-switch segmented-control" role="group" aria-label="Result format">
              {(['content', 'raw'] as const).map(format => (
                <button key={format} type="button" aria-pressed={view === format}
                  className={`segmented-control-item ${view === format ? 'active' : ''}`}
                  onClick={() => setView(format)}>{format === 'raw' ? 'Raw JSON' : 'Formatted'}</button>
              ))}
            </div>
            <span className="result-content-summary" title={EXPLANATIONS.content}>{contentSummary}</span>
          </>, controlsTarget)}
        {!controlsTarget && <ResultExplanation contentSummary={contentSummary}
          kind="content" plain rawShown={view === 'raw'} onViewRaw={() => setView(view === 'raw' ? 'content' : 'raw')} />}
        {view === 'raw' ? <JsonBlock value={toolCall.result} /> : contentDisplay}
      </div>
    );
  }

  const views: Array<{ id: ResultView; label: string }> = [
    ...(hasStructuredContent ? [{ id: 'structured' as const, label: 'Structured' }] : []),
    { id: 'content', label: 'Content' },
    { id: 'raw', label: 'JSON-RPC' },
  ];
  const activeView = views.some(item => item.id === view) ? view : 'content';

  const viewControls = (
    <div className="tool-result-view-switch segmented-control" role="tablist" aria-label="Result view">
        {views.map(item => (
          <button
            key={item.id}
            type="button"
            role="tab"
            aria-selected={activeView === item.id}
            className={`segmented-control-item ${activeView === item.id ? 'active' : ''}`}
            onClick={() => setView(item.id)}
          >
            {item.label}
          </button>
        ))}
      </div>
  );

  return (
    <div className="tool-result-view">
      {isError && (
        <div className="tool-result-error" role="alert">
          <i className="bi bi-exclamation-triangle-fill" aria-hidden="true"></i>
          <span>The tool reported an error (isError: true).</span>
        </div>
      )}
      <OutputContractVerdict contract={toolCall.contract} hasSchema={hasSchema} />
      <ResultExplanation hideToggle={!!controlsTarget}
        kind={isError ? 'error' : activeView === 'structured' ? 'structured' : activeView === 'raw' ? 'raw' : 'content'}
        rawShown={activeView === 'raw'}
        onViewRaw={() => setView('raw')}
      />
      {controlsTarget ? createPortal(viewControls, controlsTarget) : viewControls}
      <div className="tool-result-view-panel" role="tabpanel">
        {activeView === 'structured' && <JsonBlock value={toolCall.result.structuredContent} />}
        {activeView === 'content' && contentDisplay}
        {activeView === 'raw' && <JsonBlock value={rawResponse} />}
      </div>
    </div>
  );
};

export default ToolResultView;
