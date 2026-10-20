import React, { useState } from 'react';
import { formatRunCounts, type SavedTestPlanV1 } from '../utils/savedTestPlans';
import './SavedTestPlansList.css';

interface SavedTestPlansListProps {
  plans: readonly SavedTestPlanV1[];
  activePlanId: string | null;
  disabled: boolean;
  onRun: (saved: SavedTestPlanV1) => void;
  onRename: (saved: SavedTestPlanV1, name: string) => void;
  onExport: (saved: SavedTestPlanV1) => void;
  onDelete: (saved: SavedTestPlanV1) => void;
}

const caseCount = (saved: SavedTestPlanV1): number => saved.plan.tools.reduce((total, tool) => total + tool.cases.length, 0);

const formatDate = (iso: string): string => {
  const date = new Date(iso);
  return Number.isNaN(date.getTime())
    ? iso
    : date.toLocaleString([], { month: 'short', day: 'numeric', hour: '2-digit', minute: '2-digit' });
};

const SavedTestPlansList: React.FC<SavedTestPlansListProps> = ({
  plans,
  activePlanId,
  disabled,
  onRun,
  onRename,
  onExport,
  onDelete,
}) => {
  const [renamingId, setRenamingId] = useState<string | null>(null);
  const [draftName, setDraftName] = useState('');

  const submitRename = (saved: SavedTestPlanV1) => {
    if (draftName.trim()) onRename(saved, draftName);
    setRenamingId(null);
  };

  return (
    <section className="saved-test-plans" aria-labelledby="saved-test-plans-title">
      <h3 id="saved-test-plans-title">Saved plans for this endpoint</h3>
      {plans.length === 0 ? (
        <p className="saved-test-plans-empty">
          Save a plan to run it again later, here or from this endpoint's report. Saved plans stay in this browser, with secrets in arguments redacted.
        </p>
      ) : (
        <ul className="saved-test-plans-list">
          {plans.map((saved) => (
            <li key={saved.id} className={`saved-test-plan ${saved.id === activePlanId ? 'is-active' : ''}`}>
              {renamingId === saved.id ? (
                <form
                  className="saved-test-plan-rename"
                  onSubmit={(event) => {
                    event.preventDefault();
                    submitRename(saved);
                  }}
                >
                  <input
                    className="form-control form-control-sm"
                    value={draftName}
                    onChange={(event) => setDraftName(event.target.value)}
                    aria-label={`New name for ${saved.name}`}
                    maxLength={120}
                    autoFocus
                  />
                  <button type="submit" className="btn btn-sm btn-primary">Save name</button>
                  <button type="button" className="btn btn-sm btn-outline-secondary" onClick={() => setRenamingId(null)}>Cancel</button>
                </form>
              ) : (
                <div className="saved-test-plan-summary">
                  <span className="saved-test-plan-name">{saved.name}</span>
                  <span className="saved-test-plan-meta">
                    {caseCount(saved)} {caseCount(saved) === 1 ? 'case' : 'cases'} · saved {formatDate(saved.updatedAt)}
                  </span>
                  {saved.lastRun && (
                    <span className={`saved-test-plan-run ${saved.lastRun.failed > 0 ? 'is-failing' : ''}`}>
                      Last run {formatDate(saved.lastRun.ranAt)}: {formatRunCounts(saved.lastRun)}
                    </span>
                  )}
                </div>
              )}
              <div className="saved-test-plan-actions">
                <button type="button" className="btn btn-sm btn-outline-primary" onClick={() => onRun(saved)} disabled={disabled} aria-label={`Run ${saved.name}`}>
                  Run
                </button>
                <button
                  type="button"
                  className="btn btn-sm btn-outline-secondary"
                  onClick={() => {
                    setDraftName(saved.name);
                    setRenamingId(saved.id);
                  }}
                  disabled={disabled}
                  aria-label={`Rename ${saved.name}`}
                >
                  Rename
                </button>
                <button type="button" className="btn btn-sm btn-outline-secondary" onClick={() => onExport(saved)} aria-label={`Export ${saved.name} as JSON`}>
                  Export JSON
                </button>
                <button type="button" className="btn btn-sm btn-outline-danger" onClick={() => onDelete(saved)} disabled={disabled} aria-label={`Delete ${saved.name}`}>
                  Delete
                </button>
              </div>
            </li>
          ))}
        </ul>
      )}
    </section>
  );
};

export default SavedTestPlansList;
