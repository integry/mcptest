import React from 'react';
import { LogEntry, Space, SpaceCard, SelectedTool, ResourceTemplate } from '../types';
import ToolResultView from './ToolResultView';
import FailureGuidanceSummary, { FailureLearnLink } from './FailureGuidance';
import { getCallGuidance } from '../utils/connectionGuidance';
import { SHARE_REPORT_EXPLANATION } from './ConnectedSummary';
import './ConnectedGuide.css';

interface ResultPanelProps {
  lastResult: LogEntry | null;
  isConnected: boolean;
  serverUrl?: string;
  spaces: Space[];
  onAddCardToSpace: (spaceId: string, cardData: Omit<SpaceCard, 'id'>) => void;
  selectedTool: SelectedTool | null;
  selectedResourceTemplate: ResourceTemplate | null;
  toolParams: Record<string, any>;
  resourceArgs: Record<string, any>;
  /** Set after the first successful run while the share hint is active. */
  shareReportHref?: string;
  onDismissShareHint?: () => void;
  /** The scrolling result region; focus moves here after a call. */
  resultRef?: React.Ref<HTMLDivElement>;
}

/** A failed call (no result at all): plain guidance first, then the raw error. */
const CallFailure: React.FC<{ entry: LogEntry }> = ({ entry }) => {
  const message = typeof entry.data === 'string' ? entry.data : JSON.stringify(entry.data);
  const guidance = getCallGuidance({ message });
  return (
    <section className="call-failure alert alert-danger" aria-label="Call failed" data-guidance-id={guidance.id}>
      <FailureGuidanceSummary guidance={guidance} />
      <p className="failure-technical-label">Technical detail</p>
      <pre className="call-failure-detail"><code>{message}</code></pre>
      <FailureLearnLink guidance={guidance} />
    </section>
  );
};

export const ShareReportHint: React.FC<{ href: string; onDismiss?: () => void }> = ({ href, onDismiss }) => (
  <aside className="onboarding-hint onboarding-hint--share" aria-label="Next step: share a report">
    <div className="onboarding-hint-text">
      <p className="onboarding-hint-title"><i className="bi bi-share onboarding-hint-icon" aria-hidden="true"></i> Next: share a report</p>
      <p>{SHARE_REPORT_EXPLANATION}</p>
      <a className="btn btn-sm btn-primary" href={href}>Share report</a>
    </div>
    {onDismiss && (
      <button type="button" className="btn btn-sm btn-ghost" onClick={onDismiss} aria-label="Dismiss the share report hint">
        Dismiss
      </button>
    )}
  </aside>
);

const ResultPanel: React.FC<ResultPanelProps> = ({
  lastResult,
  isConnected,
  shareReportHref,
  onDismissShareHint,
  resultRef,
}) => {
  return (
    <div className={`h-100 d-flex flex-column ${!isConnected ? 'panel-deactivated' : ''}`}>
      <div className="p-3 flex-grow-1 overflow-auto result-region" ref={resultRef} tabIndex={-1} role="region" aria-label="Last result">
        {lastResult ? (
          <>
            {lastResult.type === 'error' ? <CallFailure entry={lastResult} /> : <ToolResultView logEntry={lastResult} />}
            {shareReportHref && <ShareReportHint href={shareReportHref} onDismiss={onDismissShareHint} />}
          </>
        ) : (
          <div className="result-empty-state">
            <p className="result-empty-title">No calls yet</p>
            <p>
              Run a tool and its result appears here: structured content when the tool returns it,
              the content blocks a model reads, and the raw JSON-RPC response.
            </p>
          </div>
        )}
      </div>
    </div>
  );
};

export default ResultPanel;
