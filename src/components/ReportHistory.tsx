import React, { useMemo } from 'react';
import { diffPublicReports, type ReportDiffChange } from '../utils/reportDiff';
import {
  REPORT_SNAPSHOT_RETENTION_PER_ENDPOINT,
  REPORT_SNAPSHOT_RETENTION_TOTAL,
  snapshotsForEndpoint,
  type ReportSnapshotV1,
} from '../utils/reportHistory';

interface ReportHistoryProps {
  endpoint: string;
  snapshots: readonly ReportSnapshotV1[];
  onDeleteSnapshot: (id: string) => void;
  onDeleteAll: () => void;
  onExportAll: () => void;
}

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

const snapshotResult = (snapshot: ReportSnapshotV1): string => {
  if (!snapshot.report.score) {
    return snapshot.report.outcome.status === 'authorization-required'
      ? 'Authorization required, not scored'
      : `${snapshot.report.outcome.status.charAt(0).toUpperCase()}${snapshot.report.outcome.status.slice(1)}, not scored`;
  }
  return `${Math.round(snapshot.report.score.percentage)}% score`;
};

const ReportHistory: React.FC<ReportHistoryProps> = ({
  endpoint,
  snapshots,
  onDeleteSnapshot,
  onDeleteAll,
  onExportAll,
}) => {
  const endpointSnapshots = useMemo(
    () => snapshotsForEndpoint(snapshots, endpoint),
    [endpoint, snapshots]
  );

  if (endpointSnapshots.length === 0) return null;

  return (
    <section className="release-section report-history" aria-labelledby="report-history-title">
      <div className="release-section-heading report-history-heading">
        <div>
          <h3 id="report-history-title">Report history</h3>
          <p>
            Snapshots stay in this browser. The newest {REPORT_SNAPSHOT_RETENTION_PER_ENDPOINT} per endpoint
            and {REPORT_SNAPSHOT_RETENTION_TOTAL} overall are retained; older snapshots are removed automatically.
          </p>
        </div>
        <div className="report-history-actions">
          <button type="button" className="btn btn-outline-secondary" onClick={onExportAll}>
            <i className="bi bi-download me-2" aria-hidden="true"></i>Export history
          </button>
          <button type="button" className="btn btn-outline-danger" onClick={onDeleteAll}>
            <i className="bi bi-trash3 me-2" aria-hidden="true"></i>Delete all history
          </button>
        </div>
      </div>

      <ol className="report-history-list">
        {endpointSnapshots.map((snapshot, index) => {
          const previous = endpointSnapshots[index + 1];
          const diff = previous ? diffPublicReports(previous.report, snapshot.report) : undefined;
          const importantCount = diff?.changes.filter((change) => (
            change.breaking || change.classification === 'risk' || change.classification === 'unknown'
          )).length || 0;
          return (
            <li className="report-history-item" key={snapshot.id}>
              <div className="report-history-item-heading">
                <div>
                  <h4>{new Date(snapshot.createdAt).toLocaleString()}</h4>
                  <p>{snapshotResult(snapshot)}</p>
                </div>
                <button
                  type="button"
                  className="btn btn-sm btn-outline-danger"
                  onClick={() => onDeleteSnapshot(snapshot.id)}
                  aria-label={`Delete snapshot from ${new Date(snapshot.createdAt).toLocaleString()}`}
                >
                  Delete snapshot
                </button>
              </div>

              {!diff ? (
                <p className="report-history-baseline">First retained snapshot; there is no earlier baseline to compare.</p>
              ) : diff.changes.length === 0 ? (
                <div className="report-diff-empty">
                  <i className="bi bi-check-circle" aria-hidden="true"></i>
                  No semantic drift from the previous snapshot.
                </div>
              ) : (
                <details className="report-diff" open={index === 0}>
                  <summary>
                    {diff.hasBreakingChanges
                      ? `${diff.changes.filter((change) => change.breaking).length} breaking changes`
                      : importantCount > 0
                        ? `${importantCount} changes need review`
                        : `${diff.changes.length} compatible or cosmetic changes`}
                  </summary>
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
                </details>
              )}
            </li>
          );
        })}
      </ol>
    </section>
  );
};

export default ReportHistory;
