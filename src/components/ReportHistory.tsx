import React, { useMemo } from 'react';
import { diffPublicReports } from '../utils/reportDiff';
import ReportDiffChanges from './ReportDiffChanges';
import {
  REPORT_SNAPSHOT_RETENTION_PER_ENDPOINT,
  REPORT_SNAPSHOT_RETENTION_TOTAL,
  snapshotsForEndpoint,
  type ReportSnapshotV1,
} from '../utils/reportHistory';

interface ReportHistoryProps {
  endpoint?: string;
  snapshots: readonly ReportSnapshotV1[];
  onDeleteSnapshot: (id: string) => void;
  onDeleteAll: () => void;
  onExportAll: () => void;
}

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
    () => endpoint ? snapshotsForEndpoint(snapshots, endpoint) : [],
    [endpoint, snapshots]
  );

  if (snapshots.length === 0) return null;

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

      {endpointSnapshots.length > 0 && (
        <ol className="report-history-list">
          {endpointSnapshots.map((snapshot, index) => {
            const previous = endpointSnapshots[index + 1];
            const diff = previous ? diffPublicReports(previous.report, snapshot.report) : undefined;
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
                ) : (
                  <ReportDiffChanges diff={diff} collapsible={{ open: index === 0 }} />
                )}
              </li>
            );
          })}
        </ol>
      )}
    </section>
  );
};

export default ReportHistory;
