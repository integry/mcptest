import React from 'react';
import type {
  TransportDiagnostic,
  TransportDiagnosticEvidence,
} from '../types/transportDiagnostics';
import { formatRetryWait } from '../utils/transportDiagnostics';
import FindingReferenceLink from './FindingReferenceLink';
import './TransportDiagnosticsPanel.css';

interface TransportDiagnosticsPanelProps {
  diagnostics: readonly TransportDiagnostic[];
  /** Seconds left before a rate-limited target accepts a retry, when known. */
  retryRemainingSeconds?: number;
  /** Absolute time the target asked clients to wait until. */
  retryAt?: Date;
  /** The requested wait is outstanding but ends beyond any representable time. */
  retryUnavailable?: boolean;
}

const severityLabel = (diagnostic: TransportDiagnostic): string => {
  if (diagnostic.status === 'not-checked') return 'Not checked';
  if (diagnostic.status === 'suspected') return 'Possible';
  return diagnostic.severity === 'error' ? 'Error' : diagnostic.severity === 'warning' ? 'Warning' : 'Info';
};

const severityBadge = (diagnostic: TransportDiagnostic): string => {
  if (diagnostic.status === 'not-checked') return 'bg-secondary';
  if (diagnostic.status === 'suspected') return 'bg-light text-dark border';
  return diagnostic.severity === 'error' ? 'bg-danger' : diagnostic.severity === 'warning' ? 'bg-warning text-dark' : 'bg-info text-dark';
};

const evidenceRequest = (evidence: TransportDiagnosticEvidence): string => {
  const route = evidence.route === 'proxy' ? 'via mcptest proxy' : 'direct browser';
  const status = evidence.status !== undefined ? ` → HTTP ${evidence.status}` : '';
  return `${evidence.method}${evidence.mcpMethod ? ` ${evidence.mcpMethod}` : ''} (${route})${status}`;
};

const headerList = (headers: Record<string, string> | undefined): string | undefined => {
  const entries = Object.entries(headers || {});
  return entries.length > 0 ? entries.map(([name, value]) => `${name}: ${value}`).join('; ') : undefined;
};

const TransportDiagnosticsPanel: React.FC<TransportDiagnosticsPanelProps> = ({
  diagnostics,
  retryRemainingSeconds,
  retryAt,
  retryUnavailable = false,
}) => {
  if (diagnostics.length === 0) return null;

  return (
    <div className="mb-3">
      <strong>Transport diagnostics</strong>
      <div className="transport-diagnostics mt-2">
        {diagnostics.map((diagnostic) => {
          const modifier = diagnostic.status === 'detected' ? diagnostic.severity : diagnostic.status;
          const rateLimited = diagnostic.id === 'transport.target-rate-limited-429'
            && diagnostic.status === 'detected';
          return (
            <article
              key={diagnostic.id}
              className={`transport-diagnostic transport-diagnostic--${modifier}`}
              aria-label={diagnostic.title}
            >
              <div className="transport-diagnostic__header">
                <span className={`badge ${severityBadge(diagnostic)}`}>{severityLabel(diagnostic)}</span>
                <h6 className="transport-diagnostic__title">{diagnostic.title}</h6>
                <FindingReferenceLink id={diagnostic.id} className="transport-diagnostic__id" />
              </div>

              {diagnostic.status === 'not-checked' ? (
                <p className="small mb-0">{diagnostic.notCheckedReason}</p>
              ) : (
                <>
                  {diagnostic.status === 'suspected' && diagnostic.unconfirmedReason && (
                    <p className="small mb-2 fw-semibold">{diagnostic.unconfirmedReason}</p>
                  )}
                  <p className="small mb-2">{diagnostic.explanation}</p>
                  {rateLimited && (
                    <p className="small mb-2">
                      {diagnostic.retryAfterSeconds !== undefined ? (
                        <>
                          <span className="transport-diagnostic__wait">
                            The server asked clients to wait {formatRetryWait(diagnostic.retryAfterSeconds)}
                            {retryAt ? ` (until ${retryAt.toLocaleTimeString()})` : ''}.
                          </span>{' '}
                          {retryUnavailable
                            ? 'That wait ends too far in the future to show a time, so retry is not available.'
                            : retryRemainingSeconds !== undefined && retryRemainingSeconds > 0
                              ? `Retry is available in ${formatRetryWait(retryRemainingSeconds)}.`
                              : 'You can retry now.'}
                        </>
                      ) : (
                        'The server did not send a readable Retry-After header, so wait before retrying.'
                      )}
                    </p>
                  )}
                  {diagnostic.evidence.length > 0 && (
                    <ul className="transport-diagnostic__evidence">
                      {diagnostic.evidence.map((evidence, index) => {
                        const seen = headerList(evidence.headersSeen);
                        const sent = headerList(evidence.headersSent);
                        return (
                          <li key={`${evidence.endpoint}-${evidence.method}-${index}`}>
                            <code className="text-break">{evidenceRequest(evidence)}</code>{' '}
                            {evidence.observation}
                            {sent && <><br /><small>Sent: <code>{sent}</code></small></>}
                            {seen && <><br /><small>Response headers read: <code>{seen}</code></small></>}
                          </li>
                        );
                      })}
                    </ul>
                  )}
                  <p className="small mb-1"><strong>How to fix:</strong> {diagnostic.remediation.summary}</p>
                  <details>
                    <summary className="small">Code hints for common stacks</summary>
                    {diagnostic.remediation.hints.map((hint) => (
                      <div key={hint.stack} className="mt-2">
                        <span className="small fw-semibold">{hint.stack}</span>
                        <pre className="transport-diagnostic__hint"><code>{hint.code}</code></pre>
                      </div>
                    ))}
                  </details>
                </>
              )}
            </article>
          );
        })}
      </div>
    </div>
  );
};

export default TransportDiagnosticsPanel;
