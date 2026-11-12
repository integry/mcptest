import React, { useEffect, useId, useRef } from 'react';
import { listOutcome, type CapabilitySection, type ConnectionStage, type ListOutcome } from '../utils/connectionStages';
import type { DiscoveryStatus } from '../hooks/useToolsAndResources';
import './ConnectedGuide.css';

export type ConnectedAuthMode = 'oauth' | 'api-key' | 'bearer-token' | 'none';
export type ConnectedNextAction = 'call-tool' | 'share-report' | 'run-report' | 'retry-lists';

export interface CapabilityCount {
  count: number;
  /** False when the server did not advertise the capability at all. */
  offered: boolean;
}

interface ConnectedSummaryProps {
  serverName?: string;
  serverVersion?: string;
  serverUrl: string;
  protocolVersion: string | null;
  transportType: string | null;
  authMode: ConnectedAuthMode;
  isProxied?: boolean;
  counts: { tools: CapabilityCount; resources: CapabilityCount; prompts: CapabilityCount };
  discovery: DiscoveryStatus;
  listStage: Pick<ConnectionStage, 'status' | 'detail'>;
  nextAction: ConnectedNextAction;
  reportHref: string;
  onCallTool: () => void;
  /** Re-requests every list; offered when the tools list failed. */
  onRetryLists?: () => void;
  /** Changes once per established connection; focus moves here when it does. */
  connectionKey: string;
}

const AUTH_LABEL: Record<ConnectedAuthMode, string> = {
  oauth: 'OAuth',
  'api-key': 'API key',
  'bearer-token': 'Bearer token',
  none: 'No auth',
};

const plural = (count: number, singular: string, pluralWord = `${singular}s`) => (
  `${count} ${count === 1 ? singular : pluralWord}`
);

const hostOf = (url: string): string => {
  try { return new URL(url).host; } catch { return url; }
};

/**
 * The one next action. "Run the full report" (whose text says the server lists
 * no tools) needs a settled, empty tools list; a failed tools list is retried.
 */
export const chooseNextAction = ({ hasSuccessfulRun, toolCount, listing, toolsOutcome }: {
  hasSuccessfulRun: boolean;
  toolCount: number;
  listing: boolean;
  toolsOutcome: ListOutcome;
}): ConnectedNextAction => {
  if (hasSuccessfulRun) return 'share-report';
  if (toolCount > 0 || listing) return 'call-tool';
  return toolsOutcome === 'failed' ? 'retry-lists' : 'run-report';
};

/** What the report shares, and what it never shares. Kept to one line. */
export const SHARE_REPORT_EXPLANATION = 'Runs the protocol, auth, CORS and tool checks for this endpoint and gives you a link to share. Tokens, keys, auth headers and URL query values are redacted.';

/**
 * The connected summary: who the server is, how the session was negotiated,
 * what it offers, and one obvious next action.
 */
const ConnectedSummary: React.FC<ConnectedSummaryProps> = ({
  serverName,
  serverVersion,
  serverUrl,
  protocolVersion,
  transportType,
  authMode,
  isProxied,
  counts,
  discovery,
  listStage,
  nextAction,
  reportHref,
  onCallTool,
  onRetryLists,
  connectionKey,
}) => {
  const headingId = useId();
  const headingRef = useRef<HTMLHeadingElement>(null);
  const focusedKey = useRef<string | null>(null);

  // After a connect the Connect button is gone and focus would fall to the
  // page. Move it to the summary, unless the visitor already moved it.
  useEffect(() => {
    if (focusedKey.current === connectionKey) return;
    focusedKey.current = connectionKey;
    const active = document.activeElement;
    const focusLost = !active || active === document.body || Boolean(active.closest?.('.connection-console'));
    if (focusLost) headingRef.current?.focus({ preventScroll: true });
  }, [connectionKey]);

  const listing = listStage.status !== 'done';
  // Status per advertised capability: a failed or paged list proves nothing about membership.
  const outcomes = (['tools', 'resources', 'prompts'] as const).map((section: CapabilitySection) => (
    [section, listOutcome(discovery, section, counts[section].offered)] as const
  ));
  const failedLists = outcomes.filter(([, outcome]) => outcome === 'failed').map(([section]) => section);
  const partialLists = outcomes.filter(([, outcome]) => outcome === 'partial').map(([section]) => section);
  const toolsOutcome = outcomes[0][1];
  const countPill = (item: CapabilityCount, singular: string) => (
    item.offered || item.count > 0
      ? <span className="badge bg-light">{plural(item.count, singular)}</span>
      : <span className="badge bg-light connected-summary-absent">No {singular}s offered</span>
  );

  return (
    <section className="connected-summary" aria-labelledby={headingId}>
      <div className="connected-summary-identity">
        <h2 id={headingId} className="connected-summary-name" tabIndex={-1} ref={headingRef}>
          {serverName || hostOf(serverUrl)}
          {serverVersion && <span className="connected-summary-version">v{serverVersion}</span>}
        </h2>
        <ul className="connected-summary-facts" aria-label="Session">
          <li><span className="badge bg-success">Connected</span></li>
          {protocolVersion && <li><span className="badge bg-secondary">MCP {protocolVersion}</span></li>}
          {transportType && (
            <li>
              <span className="badge bg-secondary">
                {transportType === 'streamable-http' ? 'Streamable HTTP' : 'Legacy SSE'}
              </span>
            </li>
          )}
          <li><span className={`badge ${authMode === 'none' ? 'bg-secondary' : 'bg-info'}`}>{AUTH_LABEL[authMode]}</span></li>
          {isProxied && <li><span className="badge bg-warning">Via proxy</span></li>}
        </ul>
        <ul className="connected-summary-facts" aria-label="Capabilities">
          <li>{countPill(counts.tools, 'tool')}</li>
          <li>{countPill(counts.resources, 'resource')}</li>
          <li>{countPill(counts.prompts, 'prompt')}</li>
          {listing && <li><span className="badge bg-info">Listing capabilities</span></li>}
          {!listing && failedLists.length > 0 && (
            <li><span className="badge bg-warning">{failedLists.join(', ')} list failed</span></li>
          )}
          {!listing && partialLists.length > 0 && (
            <li><span className="badge bg-warning">{partialLists.join(', ')} list incomplete</span></li>
          )}
        </ul>
        <p className="visually-hidden" role="status" aria-live="polite">
          {listing ? 'Listing tools, resources and prompts.' : `Connected. ${listStage.detail || ''}.`}
        </p>
      </div>
      <div className="connected-summary-next">
        {nextAction === 'call-tool' && (
          <>
            <button type="button" className="btn btn-primary" onClick={onCallTool}>
              <i className="bi bi-play-fill" aria-hidden="true"></i> Call a tool
            </button>
            <p>Pick a tool, fill in its parameters and run it to see the server’s real response.</p>
          </>
        )}
        {nextAction === 'share-report' && (
          <>
            <a className="btn btn-primary" href={reportHref}>
              <i className="bi bi-share" aria-hidden="true"></i> Share report
            </a>
            <p>{SHARE_REPORT_EXPLANATION}</p>
          </>
        )}
        {nextAction === 'run-report' && (
          <>
            <a className="btn btn-primary" href={reportHref}>
              <i className="bi bi-clipboard-check" aria-hidden="true"></i> Run the full report
            </a>
            <p>
              {listing
                ? 'Capabilities are still loading.'
                : toolsOutcome === 'partial'
                  ? 'The server reported more tools on later pages, which this view does not load; the report still checks its protocol, auth and CORS.'
                  : 'This server lists no tools to call; the report still checks its protocol, auth and CORS.'}
            </p>
          </>
        )}
        {nextAction === 'retry-lists' && (
          <>
            <button type="button" className="btn btn-primary" onClick={onRetryLists}>
              <i className="bi bi-arrow-clockwise" aria-hidden="true"></i> Retry listing
            </button>
            <p>The tools list request failed, so mcptest cannot tell which tools this server offers. Logs &amp; Events has the error.</p>
          </>
        )}
      </div>
    </section>
  );
};

export default ConnectedSummary;
