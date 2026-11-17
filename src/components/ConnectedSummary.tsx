import ActionIcon from './ActionIcon';
import React, { useEffect, useId, useRef, useMemo, useState } from 'react';
import { STAGE_ICONS } from './ConnectionProgress';
import { listOutcome, STAGE_LABELS, stageStatusWord, type CapabilitySection, type ConnectionStage, type ListOutcome } from '../utils/connectionStages';
import type { DiscoveryStatus } from '../hooks/useToolsAndResources';
import './ConnectedGuide.css';
import { CatalogServerLogo } from './CatalogServerLogo';
import { getCatalogServerByEndpoint } from '../utils/catalogUtils';

export type ConnectedAuthMode = 'oauth' | 'api-key' | 'bearer-token' | 'none';
export type ConnectedNextAction = 'call-tool' | 'share-report' | 'run-report' | 'retry-lists';

export interface CapabilityCount {
  count: number;
  /** False when the server did not advertise the capability at all. */
  offered: boolean;
}

interface ConnectedSummaryProps {
  actions?: React.ReactNode;
  resilienceAction?: React.ReactNode;
  serverName?: string;
  serverVersion?: string;
  serverDescription?: string;
  serverUrl: string;
  originalServerUrl?: string;
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

const sameEndpoint = (left: string, right: string): boolean => {
  try { return new URL(left).href === new URL(right).href; }
  catch { return left === right; }
};

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
  actions,
  resilienceAction,
  serverName,
  serverVersion,
  serverDescription,
  serverUrl,
  originalServerUrl,
  protocolVersion,
  transportType,
  authMode,
  isProxied,
  counts,
  discovery,
  listStage,
  nextAction,
  reportHref,
  onRetryLists,
  connectionKey,
}) => {
  const headingId = useId();
  const [copyState, setCopyState] = useState('');
  const catalogServer = useMemo(() => getCatalogServerByEndpoint(serverUrl), [serverUrl]);
  useEffect(() => { setCopyState(''); }, [serverUrl]);
  const copyEndpoint = async () => {
    try {
      await navigator.clipboard.writeText(serverUrl);
      setCopyState('Endpoint copied');
    } catch { setCopyState('Could not copy endpoint'); }
  };
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

  return (
    <section className="connected-summary" aria-labelledby={headingId}>
      <div className="connected-summary-identity">
        <div className="connected-summary-title-row">
          {catalogServer ? <CatalogServerLogo name={catalogServer.name} logoUrl={catalogServer.logoUrl} /> : (
            <span className="connected-summary-server-icon" aria-hidden="true"><i className="bi bi-hdd-network" /></span>
          )}
          <h2 id={headingId} className="connected-summary-name" tabIndex={-1} ref={headingRef}>
            {serverName || hostOf(serverUrl)}
            {serverVersion && <span className="connected-summary-version">v{serverVersion}</span>}
          </h2>
          <span className="badge bg-success connected-status">Connected</span>
        </div>
      </div>
      <div className="connected-summary-metadata">
        <div className="connected-summary-endpoint">
          {originalServerUrl && !sameEndpoint(originalServerUrl, serverUrl) && <span>Entered: <code>{originalServerUrl}</code> · </span>}
          <span>{originalServerUrl && !sameEndpoint(originalServerUrl, serverUrl) ? 'Discovered:' : 'Endpoint:'} <code className="connected-endpoint-url">{serverUrl}</code></span>
          <button type="button" className="btn btn-sm connected-endpoint-copy" onClick={() => void copyEndpoint()} aria-label="Copy endpoint URL" title={copyState || 'Copy endpoint URL'}>
            <i className={`bi ${copyState === 'Endpoint copied' ? 'bi-check-lg' : 'bi-copy'}`} aria-hidden="true" />
          </button>
          <span className="visually-hidden" aria-live="polite">{copyState}</span>
        </div>
        <ul className="connected-summary-facts" aria-label="Session">
          {protocolVersion && <li><span className="session-detail">MCP {protocolVersion}</span></li>}
          {transportType && (
            <li>
              <span className="session-detail">
                {transportType === 'streamable-http' ? 'Streamable HTTP' : 'Legacy SSE'}
              </span>
            </li>
          )}
          <li><span className="session-detail">{AUTH_LABEL[authMode]}</span></li>
          {isProxied && <li><span className="session-detail session-detail--proxy">Via proxy</span></li>}
        </ul>

        <ul className="connected-summary-facts connected-summary-counts" aria-label="Capabilities">
          <li>{plural(counts.tools.count, 'tool')}</li>
          <li>{plural(counts.resources.count, 'resource')}</li>
          <li>{plural(counts.prompts.count, 'prompt')}</li>
          {listing && <li><span className="session-detail">Listing capabilities</span></li>}
          {!listing && failedLists.length > 0 && (
            <li><span className="session-detail">{failedLists.join(', ')} list failed</span></li>
          )}
          {!listing && partialLists.length > 0 && (
            <li><span className="session-detail">{partialLists.join(', ')} list incomplete</span></li>
          )}
        </ul>
      </div>
      {serverDescription && <p className="connected-summary-description" title={serverDescription}>{serverDescription}</p>}
      <div className="connected-summary-progress">
        {/* The fourth connection stage: the panel's stage list is gone once the
            session exists, so the list requests advance and complete here. */}
        <ol hidden={!listing} className="connection-stages connected-summary-list-stage" aria-label="Capability listing">
          <li className={`connection-stage connection-stage--${listStage.status}`} data-stage="list" data-status={listStage.status}>
            <i className={`bi ${STAGE_ICONS[listStage.status]} connection-stage-icon`} aria-hidden="true"></i>
            <span className="connection-stage-text">
              <span className="connection-stage-label">{STAGE_LABELS.list}</span>
              <span className="visually-hidden">: {stageStatusWord(listStage.status)}</span>
              {listStage.detail && <span className="connection-stage-detail">{listStage.detail}</span>}
            </span>
          </li>
        </ol>
        <p className="visually-hidden" role="status" aria-live="polite">
          {listing
            ? `${STAGE_LABELS.list}: ${listStage.detail || 'in progress'}.`
            : `Connected. ${listStage.detail || ''}.`}
        </p>
      </div>
      <div className="connected-summary-next">
        {resilienceAction}
        {nextAction === 'share-report' && (
          <div className="share-report-actions">
            <span className="share-report-help">
              <a className="btn btn-outline-secondary" href={reportHref} aria-describedby={`${headingId}-share-help`}>
                <ActionIcon name="share" /> Share report
              </a>
              <span role="tooltip" id={`${headingId}-share-help`}>{SHARE_REPORT_EXPLANATION}</span>
            </span>
          </div>
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
        {actions}
      </div>
    </section>
  );
};

export default ConnectedSummary;
