import React from 'react';
import {
  explanationPathForRule,
  type BreakingChangeReport,
  type BreakingChangeSeverity,
  type BreakingChangeSubjectKind,
} from '../utils/breakingChanges';
import './BreakingChanges.css';

const SUBJECT_LABELS: Record<BreakingChangeSubjectKind, string> = {
  tool: 'Tool',
  prompt: 'Prompt',
  resource: 'Resource',
  resourceTemplate: 'Resource template',
};

const SEVERITY_LABELS: Record<BreakingChangeSeverity, string> = {
  breaking: 'Breaking',
  risky: 'Risky',
  safe: 'Safe',
};

interface BreakingChangeFindingsProps {
  report: BreakingChangeReport;
  /** Heading level for each subject group, so the list nests under the caller's heading. */
  headingLevel?: 3 | 4 | 5;
  emptyMessage?: string;
  /** Prefix for element ids, so two result lists can share a page. */
  idPrefix?: string;
}

/**
 * Classified interface changes: the "2 breaking, 1 risky, 4 safe" summary,
 * what could not be compared, then the findings grouped by tool, prompt or
 * resource, each linking to the guide section that explains its rule.
 */
const BreakingChangeFindings: React.FC<BreakingChangeFindingsProps> = ({
  report,
  headingLevel = 3,
  emptyMessage = 'No differences between the two listings.',
  idPrefix = 'breaking-changes',
}) => {
  const Heading = `h${headingLevel}` as 'h3' | 'h4' | 'h5';
  const status = report.counts.breaking > 0 ? 'breaking' : report.counts.risky > 0 ? 'risky' : 'safe';
  return (
    <div className="breaking-findings">
      <p className={`breaking-findings-summary is-${status}`} role="status" data-testid="breaking-changes-summary">
        <i
          className={`bi ${status === 'breaking' ? 'bi-x-octagon' : status === 'risky' ? 'bi-exclamation-triangle' : 'bi-check-circle'}`}
          aria-hidden="true"
        />
        {report.findings.length > 0 ? report.summary : emptyMessage}
      </p>
      {report.limitations.length > 0 && (
        <ul className="breaking-findings-limitations">
          {report.limitations.map((limitation) => <li key={limitation}>{limitation}</li>)}
        </ul>
      )}
      {report.groups.map((group) => {
        const headingId = `${idPrefix}-${group.subjectKind}-${group.subject}`.replace(/[^A-Za-z0-9_-]/g, '-');
        return (
          <section key={`${group.subjectKind}:${group.subject}`} className="breaking-findings-group" aria-labelledby={headingId}>
            <Heading id={headingId} className="breaking-findings-subject">
              <span className="breaking-findings-kind">{SUBJECT_LABELS[group.subjectKind]}</span>
              <code>{group.subject}</code>
            </Heading>
            <ul className="breaking-findings-list">
              {group.findings.map((finding, index) => (
                <li key={`${finding.path}:${finding.rule}:${index}`} className="breaking-finding">
                  <span className={`breaking-finding-severity is-${finding.severity}`}>{SEVERITY_LABELS[finding.severity]}</span>
                  <div className="breaking-finding-body">
                    <p className="breaking-finding-title">{finding.title}</p>
                    <p className="breaking-finding-reason">
                      {finding.reason}{' '}
                      <a href={explanationPathForRule(finding.rule)} aria-label={`Why: ${finding.title}`}>Why</a>
                    </p>
                  </div>
                </li>
              ))}
            </ul>
          </section>
        );
      })}
    </div>
  );
};

export default BreakingChangeFindings;
