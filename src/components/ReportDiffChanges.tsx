import React from 'react';
import type { ReportDiff, ReportDiffChange } from '../utils/reportDiff';

const classificationLabel = (change: ReportDiffChange): string => {
  if (change.breaking && change.classification === 'removal') return 'Breaking removal';
  const labels: Record<ReportDiffChange['classification'], string> = {
    breaking: 'Breaking',
    removal: 'Removal',
    risk: 'Risk change',
    unknown: 'Unknown',
    addition: 'Addition',
    change: 'Changed',
  };
  return labels[change.classification];
};

/** One-line headline for a diff: breaking changes first, then changes needing review. */
export const describeReportDiff = (diff: ReportDiff): string => {
  const importantCount = diff.changes.filter((change) => (
    change.breaking || change.classification === 'risk' || change.classification === 'unknown'
  )).length;
  return diff.hasBreakingChanges
    ? `${diff.changes.filter((change) => change.breaking).length} breaking changes`
    : importantCount > 0
      ? `${importantCount} changes need review`
      : `${diff.changes.length} compatible or cosmetic changes`;
};

interface ReportDiffChangesProps {
  diff: ReportDiff;
  /** Rendered when the diff has no changes. */
  emptyMessage?: string;
  /** Wraps the counts and list in a <details> with this summary when set. */
  collapsible?: { open: boolean };
}

/** Semantic diff between two public report artifacts: counts by classification and each change. */
const ReportDiffChanges: React.FC<ReportDiffChangesProps> = ({
  diff,
  emptyMessage = 'No semantic drift from the previous snapshot.',
  collapsible,
}) => {
  if (diff.changes.length === 0) {
    return (
      <div className="report-diff-empty">
        <i className="bi bi-check-circle" aria-hidden="true"></i>
        {emptyMessage}
      </div>
    );
  }

  const body = (
    <>
      <div className="report-diff-summary" aria-label="Diff counts">
        {Object.entries(diff.counts)
          .filter(([, count]) => count > 0)
          .map(([classification, count]) => (
            <span className={`report-diff-count report-diff-${classification}`} key={classification}>
              {count} {classification === 'risk' ? 'risk changes' : classification}
            </span>
          ))}
      </div>
      <ul className="report-diff-list">
        {diff.changes.map((change) => (
          <li
            className={`report-diff-change report-diff-change-${change.classification}${change.breaking ? ' report-diff-change-breaking' : ''}`}
            key={`${change.category}:${change.path}:${change.title}`}
          >
            <div>
              <span>{classificationLabel(change)} · {change.category}</span>
              <h5>{change.title}</h5>
            </div>
            <p>{change.detail}</p>
          </li>
        ))}
      </ul>
    </>
  );

  if (!collapsible) return <div className="report-diff">{body}</div>;
  return (
    <details className="report-diff" open={collapsible.open}>
      <summary>{describeReportDiff(diff)}</summary>
      {body}
    </details>
  );
};

export default ReportDiffChanges;
