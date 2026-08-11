import React, { useMemo } from 'react';
import {
  HOST_PROFILES,
  type AuthorizationScheme,
  type CompatibilityStatus,
  type Known,
} from '../compatibility';
import {
  getEvaluationMaxScore,
  getEvaluationPercentage,
  isLegacySkippedEvaluationSection,
  resolveEvaluationOutcome,
  type EvaluationReport,
} from '../utils/evaluation';
import type { OAuthTraceEventV1, OAuthTraceV1 } from '../utils/oauthTrace';
import {
  createCompatibilityMatrix,
  createObservedServerFacts,
  createReleaseDecision,
  type ReleaseReadinessStatus,
} from '../utils/releaseReadiness';
import { createReportDownload, saveReportDownload } from '../utils/reportDownloads';

interface ReleaseReadinessReportProps {
  report: EvaluationReport;
  oauthTrace?: OAuthTraceV1;
  expandedItems: Set<string>;
  onToggleItem: (key: string) => void;
}

const statusLabel: Record<CompatibilityStatus, string> = {
  compatible: 'Compatible',
  'compatible-with-caveats': 'Compatible with caveats',
  incompatible: 'Incompatible',
  unknown: 'Unknown',
};

const statusIcon: Record<CompatibilityStatus, string> = {
  compatible: 'bi-check-circle-fill',
  'compatible-with-caveats': 'bi-exclamation-circle-fill',
  incompatible: 'bi-x-circle-fill',
  unknown: 'bi-question-circle-fill',
};

const traceEventTitles: Record<OAuthTraceEventV1['type'], string> = {
  target_challenge: 'Server requested authorization',
  protected_resource_metadata: 'Protected resource discovered',
  authorization_server_metadata: 'Authorization server discovered',
  cimd: 'Client metadata document checked',
  dynamic_client_registration: 'OAuth client registered',
  pre_registered_client: 'Registered OAuth client selected',
  pkce: 'PKCE protection prepared',
  authorization_redirect: 'Authorization page opened',
  callback: 'Authorization callback received',
  token_exchange: 'Authorization code exchanged',
  refresh: 'Access token refreshed',
  mcp_retry: 'Authenticated MCP request retried',
  terminal_outcome: 'OAuth flight completed',
};

const traceEventTitle = (event: OAuthTraceEventV1): string => (
  event.type === 'target_challenge' && event.provenance === 'authenticated_proxy'
    ? 'Authenticated proxy requested access'
    : traceEventTitles[event.type]
);

const expectedOAuthStep = (
  event: OAuthTraceEventV1,
  schemes: Known<readonly AuthorizationScheme[]>
): boolean => (
  schemes !== 'unknown'
  && schemes.includes('oauth')
  && event.provenance !== 'authenticated_proxy'
  && (
    event.type === 'target_challenge'
    || event.outcome === 'challenged'
    || event.outcome === 'required'
    || event.outcome === 'redirected'
  )
);

const traceStepState = (
  event: OAuthTraceEventV1,
  schemes: Known<readonly AuthorizationScheme[]>
): string => {
  if (expectedOAuthStep(event, schemes)) return 'Required step';
  if (event.type === 'target_challenge' && event.provenance === 'authenticated_proxy') {
    return 'Proxy access required';
  }
  if (event.type === 'target_challenge' && event.provenance === 'direct_target') {
    if (schemes !== 'unknown' && schemes.includes('bearer')) return 'Bearer token required';
    if (schemes !== 'unknown' && schemes.includes('api-key')) return 'API key required';
    return 'Authorization required';
  }
  if (event.outcome === 'failed' || event.outcome === 'cancelled') return 'Needs attention';
  if (event.outcome === 'succeeded') return 'Complete';
  return event.outcome.charAt(0).toUpperCase() + event.outcome.slice(1);
};

const releaseIcon: Record<ReleaseReadinessStatus, string> = {
  ready: 'bi-check-circle-fill',
  blocked: 'bi-x-octagon-fill',
  review: 'bi-exclamation-diamond-fill',
  'authorization-required': 'bi-shield-lock-fill',
  unknown: 'bi-question-diamond-fill',
};

const scoreGrade = (percentage: number): string => {
  if (percentage >= 90) return 'A';
  if (percentage >= 80) return 'B';
  if (percentage >= 70) return 'C';
  if (percentage >= 60) return 'D';
  return 'F';
};

const ReleaseReadinessReport: React.FC<ReleaseReadinessReportProps> = ({
  report,
  oauthTrace,
  expandedItems,
  onToggleItem,
}) => {
  const facts = useMemo(() => createObservedServerFacts(report, oauthTrace), [report, oauthTrace]);
  const matrix = useMemo(() => createCompatibilityMatrix(report, oauthTrace), [report, oauthTrace]);
  const decision = useMemo(
    () => createReleaseDecision(report, matrix, report.toolSurfaceAnalysis, oauthTrace),
    [report, matrix, oauthTrace]
  );
  const toolSurface = report.toolSurfaceAnalysis;
  const authorizationSchemes = facts.authorization.schemes.value;
  const oauthApplies = authorizationSchemes !== 'unknown' && authorizationSchemes.includes('oauth');
  const reportIsScored = resolveEvaluationOutcome(report) === 'scored';
  const reportMaximum = reportIsScored ? getEvaluationMaxScore(report) : 0;
  const reportPercentage = reportIsScored ? getEvaluationPercentage(report) : 0;
  const prioritizedToolFindings = toolSurface
    ? [
        ...toolSurface.findings.critical,
        ...toolSurface.findings.high,
        ...toolSurface.findings.medium,
        ...toolSurface.findings.low,
        ...toolSurface.findings.info,
      ]
    : [];

  const download = (format: 'json' | 'markdown') => {
    saveReportDownload(createReportDownload(report, format, undefined, {
      releaseDecision: decision,
      compatibilityMatrix: matrix,
      toolSurfaceAnalysis: toolSurface,
      oauthTrace,
    }));
  };

  return (
    <div className="release-report">
      <section className={`release-decision release-decision-${decision.status}`} aria-labelledby="release-decision-title">
        <div className="release-decision-main">
          <i className={`bi ${releaseIcon[decision.status]}`} aria-hidden="true"></i>
          <div>
            <h3 id="release-decision-title">Can I ship?</h3>
            <p className="release-answer">{decision.answer}</p>
            <p className="mb-0">{decision.summary}</p>
          </div>
        </div>
        <div className="release-decision-actions">
          {reportIsScored && (
            <div className="release-score" aria-label={`Evaluation score ${report.finalScore} out of ${reportMaximum}`}>
              <strong>{report.finalScore} / {reportMaximum}</strong>
              <span>{Math.round(reportPercentage)}% · Grade {scoreGrade(reportPercentage)}</span>
            </div>
          )}
          <div className="release-downloads" aria-label="Download report">
            <button type="button" className="btn btn-outline-secondary" onClick={() => download('json')}>
              <i className="bi bi-filetype-json me-2" aria-hidden="true"></i>Download JSON
            </button>
            <button type="button" className="btn btn-outline-secondary" onClick={() => download('markdown')}>
              <i className="bi bi-markdown me-2" aria-hidden="true"></i>Download Markdown
            </button>
          </div>
        </div>
      </section>

      <section className="release-section" aria-labelledby="release-blockers-title">
        <div className="release-section-heading">
          <div>
            <h3 id="release-blockers-title">What blocks me?</h3>
            <p>Confirmed blockers and unresolved evidence across the full report.</p>
          </div>
          <span className="release-count">{decision.priorities.length}</span>
        </div>
        {decision.priorities.length === 0 ? (
          <div className="release-empty release-empty-success">
            <i className="bi bi-check-circle" aria-hidden="true"></i>
            No blocking or unresolved findings were identified.
          </div>
        ) : (
          <div className="release-priority-list">
            {decision.priorities.slice(0, 6).map((priority, index) => (
              <article className={`release-priority release-priority-${priority.severity}`} key={priority.id}>
                <span className="release-priority-number" aria-hidden="true">{index + 1}</span>
                <div>
                  <div className="release-priority-meta">
                    <span>{priority.source}</span>
                    <span>{priority.severity === 'unknown' ? 'Unknown' : `${priority.severity} priority`}</span>
                  </div>
                  <h4>{priority.title}</h4>
                  <p>{priority.detail}</p>
                  <p className="release-remediation"><strong>Fix first:</strong> {priority.remediation}</p>
                </div>
              </article>
            ))}
            {decision.priorities.length > 6 && (
              <p className="text-muted mb-0">{decision.priorities.length - 6} more findings appear in the detailed sections below.</p>
            )}
          </div>
        )}
      </section>

      <section className="release-section" aria-labelledby="host-compatibility-title">
        <div className="release-section-heading">
          <div>
            <h3 id="host-compatibility-title">Host compatibility</h3>
            <p>Verdicts use observed server evidence and versioned client assumptions. Unknown stays unknown.</p>
          </div>
        </div>
        <div className="compatibility-grid">
          {Object.values(matrix.assessments).map((assessment) => {
            const actionable = assessment.findings.filter((finding) => finding.outcome !== 'pass');
            const evidence = assessment.findings.flatMap((finding) => finding.evidence);
            return (
              <article className={`compatibility-card compatibility-${assessment.status}`} key={assessment.profileId}>
                <div className="compatibility-card-heading">
                  <div>
                    <h4>{HOST_PROFILES[assessment.profileId].name}</h4>
                    <span>Profile {assessment.profileVersion}</span>
                  </div>
                  <span className="compatibility-verdict">
                    <i className={`bi ${statusIcon[assessment.status]}`} aria-hidden="true"></i>
                    {statusLabel[assessment.status]}
                  </span>
                </div>
                {actionable.length === 0 ? (
                  <p className="mb-0">No client-specific caveats or blockers were found.</p>
                ) : (
                  <ul className="compatibility-findings">
                    {actionable.slice(0, 3).map((finding) => (
                      <li key={finding.ruleId}>
                        <strong>{finding.summary}</strong>
                        <span>{finding.remediation?.action || 'Collect the missing observation and rerun the report.'}</span>
                      </li>
                    ))}
                  </ul>
                )}
                <details className="release-details">
                  <summary>View verdict evidence and remediation</summary>
                  <div className="release-details-body">
                    {actionable.map((finding) => (
                      <div className="compatibility-detail" key={finding.ruleId}>
                        <h5>{finding.summary}</h5>
                        <p>{finding.detail}</p>
                        <p><strong>Remediation:</strong> {finding.remediation?.action || 'Collect the missing observation and rerun the report.'}</p>
                      </div>
                    ))}
                    <h5>Evidence</h5>
                    {evidence.length ? (
                      <ul>{evidence.map((item, index) => <li key={`${item.description}-${index}`}>{item.description}</li>)}</ul>
                    ) : <p>No evidence was retained for this verdict.</p>}
                  </div>
                </details>
              </article>
            );
          })}
        </div>
      </section>

      <section className="release-section" aria-labelledby="oauth-timeline-title">
        <div className="release-section-heading">
          <div>
            <h3 id="oauth-timeline-title">{oauthApplies ? 'OAuth' : 'Authentication'} flight recorder</h3>
            <p>{oauthApplies
              ? 'Expected direct-target OAuth challenges are shown as guided steps. Stored protocol data is always redacted.'
              : 'Target credentials and authenticated-proxy challenges retain their observed scheme and provenance. Stored protocol data is always redacted.'}</p>
          </div>
        </div>
        {!oauthTrace ? (
          <div className="release-empty">
            <i className="bi bi-shield-check" aria-hidden="true"></i>
            No OAuth flight was recorded for this target. Public and pre-authorized servers may not need one.
          </div>
        ) : (
          <>
            <ol className="oauth-timeline" aria-label="Guided OAuth timeline">
              {oauthTrace.events.map((event) => (
                <li className={event.outcome === 'failed' ? 'oauth-step-failed' : expectedOAuthStep(event, authorizationSchemes) ? 'oauth-step-expected' : ''} key={event.sequence}>
                  <span className="oauth-step-marker" aria-hidden="true">{event.sequence}</span>
                  <div>
                    <div className="oauth-step-heading">
                      <h4>{traceEventTitle(event)}</h4>
                      <span>{traceStepState(event, authorizationSchemes)}</span>
                    </div>
                    <p>{event.explanation}</p>
                    {event.timing?.durationMs !== undefined && <span className="oauth-step-time">{event.timing.durationMs} ms</span>}
                  </div>
                </li>
              ))}
            </ol>
            <details className="release-details oauth-raw">
              <summary>View raw trace (redacted)</summary>
              <div className="release-details-body">
                <p>Secrets, credential fields, fragments, and sensitive URL values are replaced before storage.</p>
                <pre>{JSON.stringify(oauthTrace, null, 2)}</pre>
              </div>
            </details>
          </>
        )}
      </section>

      <section className="release-section" aria-labelledby="tool-surface-title">
        <div className="release-section-heading">
          <div>
            <h3 id="tool-surface-title">Tool surface, context, and risk</h3>
            <p>Deterministic signals prioritize context cost, contract quality, ambiguity, and state-changing capabilities.</p>
          </div>
          {toolSurface && <code className="tool-fingerprint" title="Tool-surface fingerprint">{toolSurface.fingerprint.value}</code>}
        </div>
        {!toolSurface ? (
          <div className="release-empty">
            <i className="bi bi-question-circle" aria-hidden="true"></i>
            Tool definitions were not available, so tool-surface risk and context cost are unknown.
          </div>
        ) : (
          <>
            <div className="tool-metrics">
              <div><strong>{toolSurface.metrics.toolCount}</strong><span>Tools</span></div>
              <div><strong>{toolSurface.metrics.estimatedContextTokens.toLocaleString()}</strong><span>Estimated context tokens</span></div>
              <div><strong>{toolSurface.metrics.descriptions.qualityScore}%</strong><span>Description quality</span></div>
              <div><strong>{toolSurface.metrics.riskSignals.destructiveCapabilityToolCount}</strong><span>Destructive signals</span></div>
            </div>
            {prioritizedToolFindings.length === 0 ? (
              <div className="release-empty release-empty-success">No tool-surface findings were identified.</div>
            ) : (
              <div className="tool-findings">
                {prioritizedToolFindings.map((finding) => (
                  <article className="tool-finding" key={finding.id}>
                    <div>
                      <span className={`finding-severity finding-${finding.severity}`}>{finding.severity}</span>
                      <h4>{finding.title}</h4>
                    </div>
                    <p>{finding.summary}</p>
                    <p className="release-remediation"><strong>Remediation:</strong> {finding.remediation}</p>
                    {finding.evidence.length > 0 && (
                      <details className="release-details">
                        <summary>View finding evidence</summary>
                        <div className="release-details-body">
                          <ul>{finding.evidence.map((item, index) => (
                            <li key={`${item.tool}-${item.path}-${index}`}><strong>{item.tool}</strong> at <code>{item.path}</code>: {item.detail}</li>
                          ))}</ul>
                        </div>
                      </details>
                    )}
                  </article>
                ))}
              </div>
            )}
          </>
        )}
      </section>

      <details className="release-section release-protocol-details">
        <summary>View protocol checks and raw evidence</summary>
        <div className="release-details-body">
          {Object.entries(report.sections).filter(([key]) => key !== 'auth').map(([key, section]) => (
            <section className="protocol-section" key={key}>
              <div className="protocol-section-heading">
                <div><h4>{section.name}</h4><p>{section.description}</p></div>
                <span>{section.status === 'skipped'
                  || section.status === 'failed'
                  || (!section.status && isLegacySkippedEvaluationSection(section))
                  ? 'Not scored'
                  : `${section.score} / ${section.maxScore} points`}</span>
              </div>
              {section.details.map((detail, index) => {
                const detailKey = `protocol-${key}-${index}`;
                const expandable = detail.context || detail.metadata;
                return (
                  <div className="protocol-evidence" key={detailKey}>
                    {expandable ? (
                      <button type="button" onClick={() => onToggleItem(detailKey)} aria-expanded={expandedItems.has(detailKey)} aria-controls={`${detailKey}-body`}>
                        <span>{detail.text}</span><i className={`bi bi-chevron-${expandedItems.has(detailKey) ? 'up' : 'down'}`} aria-hidden="true"></i>
                      </button>
                    ) : <p>{detail.text}</p>}
                    {expandable && expandedItems.has(detailKey) && (
                      <div id={`${detailKey}-body`} className="protocol-evidence-body">
                        {detail.context && <p>{detail.context}</p>}
                        {detail.metadata !== undefined && <pre>{JSON.stringify(detail.metadata, null, 2)}</pre>}
                      </div>
                    )}
                  </div>
                );
              })}
            </section>
          ))}
        </div>
      </details>
    </div>
  );
};

export default ReleaseReadinessReport;
