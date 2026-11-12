import React, { useEffect, useId, useRef } from 'react';
import type { ConnectionStage } from '../utils/connectionStages';
import type { DiscoveryStatus } from '../hooks/useToolsAndResources';
import './ConnectedGuide.css';

export type ConnectedAuthMode = 'oauth' | 'api-key' | 'bearer-token' | 'none';
export type ConnectedNextAction = 'call-tool' | 'share-report' | 'run-report';

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
  const failedLists = (Object.entries(discovery) as Array<[keyof DiscoveryStatus, string]>)
    .filter(([, state]) => state === 'failed')
    .map(([section]) => section === 'resourceTemplates' ? 'resource templates' : section);
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
            <p>{listing ? 'Capabilities are still loading.' : 'This server lists no tools to call; the report still checks its protocol, auth and CORS.'}</p>
          </>
        )}
      </div>
    </section>
  );
};

export default ConnectedSummary;
