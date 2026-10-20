import React, { useEffect, useState } from 'react';
import {
  formatRunCounts,
  loadSavedTestPlans,
  runnableCaseIds,
  unsafePlanToolNames,
  type SavedTestPlanV1,
} from '../utils/savedTestPlans';
import './SavedPlanRunAction.css';

export interface SavedPlanRunRequest {
  id: string;
  endpoint: string;
  plan: SavedTestPlanV1['plan'];
  confirmedUnsafeToolNames: string[];
}

interface SavedPlanRunActionProps {
  endpoint: string;
  disabled: boolean;
  onRun: (request: SavedPlanRunRequest) => void;
}

/**
 * Offers the newest saved test plan for this endpoint. The report then runs it
 * on its own connection and keeps only the pass/fail counts.
 */
const SavedPlanRunAction: React.FC<SavedPlanRunActionProps> = ({ endpoint, disabled, onRun }) => {
  const [saved, setSaved] = useState<SavedTestPlanV1 | undefined>(() => loadSavedTestPlans(endpoint)[0]);
  const [confirmed, setConfirmed] = useState(false);

  useEffect(() => {
    setSaved(loadSavedTestPlans(endpoint)[0]);
    setConfirmed(false);
  }, [endpoint, disabled]);

  if (!saved) return null;
  const runnable = runnableCaseIds(saved.plan).length;
  const unsafeTools = unsafePlanToolNames(saved.plan);

  return (
    <section className="saved-plan-run" aria-labelledby="saved-plan-run-title">
      <div className="saved-plan-run-text">
        <h5 id="saved-plan-run-title">Saved test plan</h5>
        <p>
          {saved.name} · {runnable} runnable {runnable === 1 ? 'case' : 'cases'}
          {saved.lastRun ? ` · last run: ${formatRunCounts(saved.lastRun)}` : ''}.
          {' '}The report shows pass and fail counts only, never arguments or results.
        </p>
        {unsafeTools.length > 0 && (
          <label className="saved-plan-run-confirm">
            <input
              type="checkbox"
              className="form-check-input"
              checked={confirmed}
              onChange={(event) => setConfirmed(event.target.checked)}
              disabled={disabled}
            />
            <span>Also run write-capable tools: {unsafeTools.join(', ')}. Without this they count as blocked.</span>
          </label>
        )}
      </div>
      <button
        type="button"
        className="btn btn-outline-primary"
        disabled={disabled || runnable === 0}
        onClick={() => onRun({
          id: saved.id,
          endpoint,
          plan: saved.plan,
          confirmedUnsafeToolNames: confirmed ? unsafeTools : [],
        })}
      >
        Run saved plan
      </button>
    </section>
  );
};

export default SavedPlanRunAction;
