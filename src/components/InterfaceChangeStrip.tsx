import React, { useId, useState } from 'react';
import type { InterfaceChangeKind, InterfaceDiff } from '../utils/reportDiff';
import './InterfaceChangeStrip.css';

interface InterfaceChangeStripProps {
  diff: InterfaceDiff;
  onDismiss: () => void;
}

type Tone = 'added' | 'removed' | 'changed';

const KIND_LABELS: Record<InterfaceChangeKind, { noun: [string, string]; prefix: string; tone: Tone }> = {
  'tool-removed': { noun: ['tool removed', 'tools removed'], prefix: '−', tone: 'removed' },
  'tool-added': { noun: ['tool added', 'tools added'], prefix: '+', tone: 'added' },
  'input-schema-changed': { noun: ['input schema changed', 'input schemas changed'], prefix: '', tone: 'changed' },
  'output-schema-changed': { noun: ['output schema changed', 'output schemas changed'], prefix: '', tone: 'changed' },
  'description-changed': { noun: ['description changed', 'descriptions changed'], prefix: '', tone: 'changed' },
  'resource-removed': { noun: ['resource removed', 'resources removed'], prefix: '−', tone: 'removed' },
  'resource-added': { noun: ['resource added', 'resources added'], prefix: '+', tone: 'added' },
  'prompt-removed': { noun: ['prompt removed', 'prompts removed'], prefix: '−', tone: 'removed' },
  'prompt-added': { noun: ['prompt added', 'prompts added'], prefix: '+', tone: 'added' },
  'protocol-changed': { noun: ['protocol version changed', 'protocol version changed'], prefix: '', tone: 'changed' },
  'transport-changed': { noun: ['transport changed', 'transport changed'], prefix: '', tone: 'changed' },
};

export const formatSnapshotDate = (iso: string): string => new Date(iso).toLocaleString([], {
  month: 'short', day: 'numeric', year: 'numeric', hour: '2-digit', minute: '2-digit',
});

const toneFor = (classification: string, breaking: boolean): Tone => (
  breaking || classification === 'removal' || classification === 'breaking'
    ? 'removed'
    : classification === 'addition' ? 'added' : 'changed'
);

const InterfaceChangeStrip: React.FC<InterfaceChangeStripProps> = ({ diff, onDismiss }) => {
  const [expanded, setExpanded] = useState(false);
  const listId = useId();
  if (diff.changes.length === 0) return null;
  const since = formatSnapshotDate(diff.beforeObservedAt);
  const kinds = (Object.keys(KIND_LABELS) as InterfaceChangeKind[]).filter((kind) => diff.counts[kind] > 0);

  return (
    <section className="interface-change-strip" aria-labelledby={`${listId}-title`}>
      <div className="interface-change-summary">
        <i className="bi bi-arrow-left-right interface-change-icon" aria-hidden="true"></i>
        <h2 id={`${listId}-title`} className="interface-change-title">
          What changed since <time dateTime={diff.beforeObservedAt}>{since}</time>
        </h2>
        <ul className="interface-change-chips" aria-label="Change counts">
          {kinds.map((kind) => {
            const label = KIND_LABELS[kind];
            const count = diff.counts[kind];
            return (
              <li key={kind} className={`interface-change-chip is-${label.tone}`}>
                {label.prefix}{count} {label.noun[count === 1 ? 0 : 1]}
              </li>
            );
          })}
        </ul>
        <div className="interface-change-actions">
          <button
            type="button"
            className="btn btn-sm btn-outline-secondary"
            aria-expanded={expanded}
            aria-controls={listId}
            onClick={() => setExpanded((value) => !value)}
          >
            {expanded ? 'Hide full diff' : 'View full diff'}
          </button>
          <button
            type="button"
            className="btn btn-sm btn-ghost interface-change-dismiss"
            onClick={onDismiss}
            aria-label="Dismiss interface changes"
            title="Dismiss"
          >
            <i className="bi bi-x-lg" aria-hidden="true"></i>
          </button>
        </div>
      </div>
      {expanded && (
        <div id={listId} className="interface-change-details">
          <p className="interface-change-source">
            Compared with {diff.beforeSource === 'report' ? 'the latest saved report' : 'your last visit'} in this browser.
            {diff.hasBreakingChanges ? ' Some changes can break existing clients.' : ''}
          </p>
          <ul className="interface-change-list">
            {diff.changes.map((change) => (
              <li key={`${change.kind}:${change.path}`} className={`interface-change-item is-${toneFor(change.classification, change.breaking)}`}>
                <span className="interface-change-item-title">{change.title}</span>
                {change.breaking && <span className="interface-change-breaking">Breaking</span>}
                <span className="interface-change-item-detail">{change.detail}</span>
                {change.schemaChanges && change.schemaChanges.length > 1 && (
                  <ul className="interface-change-schema-list">
                    {change.schemaChanges.map((schemaChange) => (
                      <li key={schemaChange.path + schemaChange.title}>
                        {schemaChange.title}: {schemaChange.detail}
                      </li>
                    ))}
                  </ul>
                )}
              </li>
            ))}
          </ul>
        </div>
      )}
    </section>
  );
};

export default InterfaceChangeStrip;
