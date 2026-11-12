import React from 'react';
import type { ToolListConsistencyV1 } from '../types/toolListConsistency';
import {
  TOOL_LIST_INCONSISTENT_TITLE,
  describeToolListDifference,
  toolListConsistencySummary,
} from '../utils/toolListConsistencyReport';

interface ToolListConsistencyPanelProps {
  result: ToolListConsistencyV1 | undefined;
  titleId?: string;
}

const statusLabel: Record<ToolListConsistencyV1['status'], string> = {
  consistent: 'Passed',
  inconsistent: 'Finding',
  'not-checked': 'Not checked',
};

const statusIcon: Record<ToolListConsistencyV1['status'], string> = {
  consistent: 'bi-check-circle-fill',
  inconsistent: 'bi-exclamation-triangle-fill',
  'not-checked': 'bi-dash-circle',
};

const connectionLabel: Record<ToolListConsistencyV1['samples'][number]['connection'], string> = {
  evaluation: 'Evaluation connection',
  fresh: 'Fresh connection',
  same: 'Same connection',
};

const shortHash = (hash: string | undefined): string => {
  if (!hash) return '—';
  const [algorithm, value = ''] = hash.split(':');
  return `${algorithm}:${value.slice(0, 12)}`;
};

/** Readiness-view summary of the repeated tools/list check. */
const ToolListConsistencyPanel: React.FC<ToolListConsistencyPanelProps> = ({
  result,
  titleId = 'tool-list-consistency-title',
}) => {
  if (!result) return null;
  return (
    <section className="release-section tool-list-consistency" aria-labelledby={titleId} data-status={result.status}>
      <div className="release-section-heading">
        <div>
          <h3 id={titleId}>Tool list consistency</h3>
          <p>
            tools/list was requested {result.samples.length || result.requestedSamples} times
            {result.samples.some((sample) => sample.connection === 'fresh') ? ', on fresh connections where possible' : ''},
            {' '}{result.authentication}. Each complete result is hashed canonically, including descriptions and schemas.
          </p>
        </div>
        <span className="compatibility-verdict">
          <i className={`bi ${statusIcon[result.status]}`} aria-hidden="true"></i>
          {statusLabel[result.status]}
        </span>
      </div>
      {result.status === 'consistent' && (
        <div className="release-empty release-empty-success">
          <i className="bi bi-check-circle" aria-hidden="true"></i>
          {toolListConsistencySummary(result)}.
        </div>
      )}
      {result.status === 'not-checked' && (
        <div className="release-empty">
          <i className="bi bi-info-circle" aria-hidden="true"></i>
          {result.notCheckedReason || 'The tool list was not compared.'}
        </div>
      )}
      {result.status === 'inconsistent' && (
        <article className="tool-finding">
          <div>
            <span className="finding-severity finding-medium">medium</span>
            <h4>{TOOL_LIST_INCONSISTENT_TITLE}</h4>
          </div>
          <p>
            {result.distinctHashes} different results came back from {result.samples.filter((sample) => sample.status === 'complete').length} requests.
            Clients may see tools disappear and return between requests.
          </p>
          <ul>
            {result.differences.map((difference) => (
              <li key={difference.tool}>{describeToolListDifference(difference)}</li>
            ))}
          </ul>
        </article>
      )}
      {result.samples.length > 0 && (
        <details className="release-details">
          <summary>View requests and instance headers</summary>
          <div className="release-details-body">
            <table className="table table-sm mb-2">
              <thead>
                <tr><th scope="col">Request</th><th scope="col">Connection</th><th scope="col">Tools</th><th scope="col">Hash</th><th scope="col">Instance headers</th></tr>
              </thead>
              <tbody>
                {result.samples.map((sample) => (
                  <tr key={sample.index}>
                    <td>{sample.index}</td>
                    <td>{connectionLabel[sample.connection]}</td>
                    <td>{sample.status === 'complete' ? sample.toolCount : `Failed: ${sample.error}`}</td>
                    <td><code title={sample.hash}>{shortHash(sample.hash)}</code></td>
                    <td>{sample.instanceHeaders
                      ? Object.entries(sample.instanceHeaders).map(([name, value]) => `${name}: ${value}`).join(', ')
                      : '—'}</td>
                  </tr>
                ))}
              </tbody>
            </table>
            {result.headerNote && <p className="small text-muted mb-1">{result.headerNote}</p>}
            <p className="small text-muted mb-0">
              Lists were obtained {result.authentication}. Report history and breaking-change comparisons
              do not treat a change between authenticated and unauthenticated lists as drift.
            </p>
          </div>
        </details>
      )}
    </section>
  );
};

export default ToolListConsistencyPanel;
