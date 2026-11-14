import React, { useId } from 'react';
import {
  describeConnectionProgress,
  stageStatusWord,
  type ConnectionStage,
  type ConnectionStageStatus,
} from '../utils/connectionStages';
import './ConnectedGuide.css';

export const STAGE_ICONS: Record<ConnectionStageStatus, string> = {
  pending: 'bi-circle',
  active: 'bi-arrow-repeat',
  done: 'bi-check-circle-fill',
  skipped: 'bi-dash-circle',
  waiting: 'bi-person-check',
  failed: 'bi-x-circle-fill',
};

interface ConnectionProgressProps {
  stages: readonly ConnectionStage[];
  /** Visible heading; omitted where the surrounding panel already names it. */
  title?: string;
}

/**
 * The stages of a connection attempt as they happen. The visible list is
 * static markup; a separate polite live region announces the stage that
 * changed, so assistive technology hears progress without re-reading the list.
 */
const ConnectionProgress: React.FC<ConnectionProgressProps> = ({ stages, title = 'Connection progress' }) => {
  const announcement = describeConnectionProgress(stages);
  const titleId = useId();
  return (
    <div className="connection-progress">
      <p className="connection-progress-title" id={titleId}>{title}</p>
      <ol className="connection-stages" aria-labelledby={titleId}>
        {stages.map((stage) => (
          <li key={stage.id} className={`connection-stage connection-stage--${stage.status}`} data-stage={stage.id} data-status={stage.status}>
            <i className={`bi ${STAGE_ICONS[stage.status]} connection-stage-icon`} aria-hidden="true"></i>
            <span className="connection-stage-text">
              <span className="connection-stage-label">{stage.label}</span>
              <span className="visually-hidden">: {stageStatusWord(stage.status)}</span>
              {stage.detail && <span className="connection-stage-detail">{stage.detail}</span>}
            </span>
          </li>
        ))}
      </ol>
      <p className="visually-hidden" role="status" aria-live="polite">{announcement}</p>
    </div>
  );
};

export default ConnectionProgress;
