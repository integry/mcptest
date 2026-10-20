import React, { useEffect, useState } from 'react';
import {
  CALL_HISTORY_LIMIT_PER_SERVER,
  toJsonRpcRequest,
  type CallHistoryEntry,
} from '../utils/callHistory';
import './CallHistoryPanel.css';

interface CallHistoryPanelProps {
  calls: readonly CallHistoryEntry[];
  /** Names the connected server still offers; other entries cannot be replayed. */
  availableToolNames: ReadonlySet<string>;
  canRun: boolean;
  onReplay: (entry: CallHistoryEntry) => void;
  onClearServer: () => void;
  onClearAll: () => void;
}

const argumentPreview = (args: Record<string, unknown>): string => {
  const entries = Object.entries(args);
  if (entries.length === 0) return 'No arguments';
  return entries.map(([key, value]) => `${key}: ${JSON.stringify(value)}`).join(', ');
};

const formatDuration = (durationMs: number): string => (
  durationMs >= 1000 ? `${(durationMs / 1000).toFixed(1)} s` : `${durationMs} ms`
);

const formatTime = (iso: string): string => {
  const date = new Date(iso);
  const sameDay = date.toDateString() === new Date().toDateString();
  return sameDay
    ? date.toLocaleTimeString([], { hour: '2-digit', minute: '2-digit', second: '2-digit' })
    : date.toLocaleString([], { month: 'short', day: 'numeric', hour: '2-digit', minute: '2-digit' });
};

const copyText = async (value: string): Promise<boolean> => {
  try {
    await navigator.clipboard.writeText(value);
    return true;
  } catch {
    return false;
  }
};

const CallHistoryPanel: React.FC<CallHistoryPanelProps> = ({
  calls,
  availableToolNames,
  canRun,
  onReplay,
  onClearServer,
  onClearAll,
}) => {
  const [copiedId, setCopiedId] = useState<string | null>(null);
  const [copyFailedId, setCopyFailedId] = useState<string | null>(null);

  useEffect(() => {
    if (!copiedId) return;
    const timer = window.setTimeout(() => setCopiedId(null), 2000);
    return () => window.clearTimeout(timer);
  }, [copiedId]);

  const handleCopy = async (entry: CallHistoryEntry) => {
    const copied = await copyText(toJsonRpcRequest(entry));
    setCopiedId(copied ? entry.id : null);
    setCopyFailedId(copied ? null : entry.id);
  };

  const failures = calls.filter((call) => call.isError || call.outputVerdict === 'fail').length;

  return (
    <section className="call-history" aria-labelledby="call-history-title">
      <div className="call-history-heading">
        <h6 id="call-history-title">Call history</h6>
        <p>
          {calls.length === 0
            ? `The last ${CALL_HISTORY_LIMIT_PER_SERVER} tool calls to this server are kept in this browser.`
            : `${calls.length} of the last ${CALL_HISTORY_LIMIT_PER_SERVER} calls · ${failures} ${failures === 1 ? 'failure' : 'failures'}. Secrets in arguments are redacted.`}
        </p>
      </div>

      {calls.length > 0 && (
        <ol className="call-history-list">
          {calls.map((entry) => {
            const available = availableToolNames.has(entry.toolName);
            const replayLabel = entry.argumentsRedacted ? 'Load arguments' : 'Replay';
            const replayTitle = !available
              ? 'This server no longer lists this tool'
              : entry.argumentsRedacted
                ? 'Redacted values are not replayed; review the arguments, then run'
                : `Run ${entry.toolName} again with these arguments`;
            return (
              <li key={entry.id} className={`call-history-item ${entry.isError ? 'call-history-item--error' : ''}`}>
                <div className="call-history-row">
                  <span className="call-history-tool">{entry.toolName}</span>
                  <span className={`call-history-status ${entry.isError ? 'is-error' : 'is-ok'}`}>
                    <i className={`bi ${entry.isError ? 'bi-x-circle' : 'bi-check-circle'}`} aria-hidden="true"></i>
                    {entry.isError ? 'Error' : 'OK'}
                  </span>
                  {entry.outputVerdict && (
                    <span className={`call-history-verdict ${entry.outputVerdict === 'fail' ? 'is-error' : 'is-ok'}`}>
                      {entry.outputVerdict === 'pass'
                        ? 'Output schema met'
                        : `Output schema broken (${entry.outputViolationCount ?? 0})`}
                    </span>
                  )}
                  <span className="call-history-meta">
                    {formatDuration(entry.durationMs)} · <time dateTime={entry.calledAt}>{formatTime(entry.calledAt)}</time>
                  </span>
                </div>
                <code className="call-history-args" title={argumentPreview(entry.arguments)}>
                  {argumentPreview(entry.arguments)}
                </code>
                <p className="call-history-summary">{entry.resultSummary}</p>
                <div className="call-history-actions">
                  <button
                    type="button"
                    className="btn btn-sm btn-outline-primary"
                    onClick={() => onReplay(entry)}
                    disabled={!available || !canRun}
                    title={replayTitle}
                    aria-label={`${replayLabel}: ${entry.toolName}`}
                  >
                    <i className={`bi ${entry.argumentsRedacted ? 'bi-input-cursor-text' : 'bi-arrow-repeat'}`} aria-hidden="true"></i>
                    {replayLabel}
                  </button>
                  <button
                    type="button"
                    className="btn btn-sm btn-outline-secondary"
                    onClick={() => { void handleCopy(entry); }}
                    aria-label={`Copy ${entry.toolName} call as JSON-RPC`}
                  >
                    <i className={`bi ${copiedId === entry.id ? 'bi-check2' : 'bi-clipboard'}`} aria-hidden="true"></i>
                    {copiedId === entry.id ? 'Copied' : 'Copy as JSON-RPC'}
                  </button>
                  {copyFailedId === entry.id && (
                    <span className="call-history-copy-error" role="alert">Clipboard unavailable</span>
                  )}
                </div>
              </li>
            );
          })}
        </ol>
      )}

      <div className="call-history-footer">
        <button type="button" className="btn btn-sm btn-outline-secondary" onClick={onClearServer} disabled={calls.length === 0}>
          Clear this server
        </button>
        <button type="button" className="btn btn-sm btn-outline-danger" onClick={onClearAll}>
          Clear all servers
        </button>
      </div>
    </section>
  );
};

export default CallHistoryPanel;
