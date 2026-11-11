import React from 'react';
import type {
  ToolContextCostDeltaV1,
  ToolContextCostFindingV1,
  ToolContextCostPartsV1,
  ToolContextCostToolV1,
  ToolContextCostV1,
} from '../types/toolContextCost';
import {
  describeContextCostDelta,
  describeToolContextCostDelta,
  formatEstimate,
  formatShare,
} from '../utils/toolTokenCost';
import './ToolContextCost.css';

const PART_LABELS: Record<keyof ToolContextCostPartsV1, string> = {
  nameDescription: 'Name and description',
  parameters: 'Input parameters',
  inputSchema: 'Rest of input schema',
  outputSchema: 'Output schema',
  annotations: 'Annotations',
  other: 'Other fields and JSON structure',
};

/** Tools shown before the "show more" disclosure. */
const VISIBLE_TOOLS = 10;

const ShareBar: React.FC<{ share: number }> = ({ share }) => (
  <span className="tool-context-cost-bar" aria-hidden="true">
    <span style={{ width: `${Math.min(100, Math.max(0, share * 100))}%` }} />
  </span>
);

const ToolRow: React.FC<{ tool: ToolContextCostToolV1; label: string }> = ({ tool, label }) => {
  const parts = (Object.keys(PART_LABELS) as (keyof ToolContextCostPartsV1)[])
    .filter((part) => (tool.parts[part] ?? 0) > 0);
  return (
    <li className="tool-context-cost-row">
      <details>
        <summary>
          <code className="tool-context-cost-name">{tool.name}</code>
          <span className="tool-context-cost-figure">{formatEstimate(tool.estimate)}</span>
          <span className="tool-context-cost-share">{formatShare(tool.share)}</span>
          <ShareBar share={tool.share} />
        </summary>
        <div className="tool-context-cost-detail">
          <table className="table table-sm mb-2">
            <caption className="visually-hidden">{`Parts of ${tool.name}, in ${label}`}</caption>
            <thead><tr><th scope="col">Part</th><th scope="col">Estimate</th></tr></thead>
            <tbody>
              {parts.map((part) => (
                <tr key={part}><th scope="row">{PART_LABELS[part]}</th><td>{formatEstimate(tool.parts[part])}</td></tr>
              ))}
            </tbody>
          </table>
          {tool.parameters.length > 0 && (
            <table className="table table-sm mb-0">
              <caption className="visually-hidden">{`Input parameters of ${tool.name}, heaviest first`}</caption>
              <thead><tr><th scope="col">Parameter</th><th scope="col">Estimate</th><th scope="col">Share of tool</th></tr></thead>
              <tbody>
                {tool.parameters.map((parameter) => (
                  <tr key={parameter.name}>
                    <th scope="row">
                      <code>{parameter.name}</code>
                      <span className="tool-context-cost-required">{parameter.required ? 'required' : 'optional'}</span>
                    </th>
                    <td>{formatEstimate(parameter.estimate)}</td>
                    <td>{formatShare(tool.estimate > 0 ? parameter.estimate / tool.estimate : 0)}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          )}
          {tool.omittedParameterCount > 0 && (
            <p className="tool-context-cost-note">
              {tool.omittedParameterCount} smaller parameter{tool.omittedParameterCount === 1 ? '' : 's'} not listed.
            </p>
          )}
        </div>
      </details>
    </li>
  );
};

export const ContextCostFindings: React.FC<{ findings: readonly ToolContextCostFindingV1[] }> = ({ findings }) => (
  findings.length === 0 ? null : (
    <div className="tool-findings tool-context-cost-findings">
      {findings.map((finding) => (
        <article className="tool-finding" key={`${finding.id}:${finding.subject ?? ''}`}>
          <div>
            <span className={`finding-severity finding-${finding.severity}`}>{finding.severity}</span>
            <h4>{finding.title}</h4>
          </div>
          <p>{finding.summary}</p>
          <p className="release-remediation"><strong>Remediation:</strong> {finding.remediation}</p>
        </article>
      ))}
    </div>
  )
);

interface ToolContextCostPanelProps {
  cost: ToolContextCostV1;
  /** Findings to leave out, e.g. a total already reported by the surface analysis. */
  hideFindingIds?: readonly string[];
  headingId?: string;
}

/**
 * Estimated context cost of the tool definitions: totals, the heaviest tools
 * with their share, and per-part and per-parameter detail on expansion.
 */
export const ToolContextCostPanel: React.FC<ToolContextCostPanelProps> = ({
  cost,
  hideFindingIds = [],
  headingId = 'tool-context-cost-title',
}) => {
  const heaviest = cost.tools[0];
  const visible = cost.tools.slice(0, VISIBLE_TOOLS);
  const more = cost.tools.slice(VISIBLE_TOOLS);
  const label = cost.method.label;
  // Discovery stopped part-way: the figures describe only the tools received.
  const partial = cost.listingIncomplete === true;
  const received = partial ? ' received' : '';
  return (
    <section className="tool-context-cost" aria-labelledby={headingId}>
      <h4 id={headingId}>Context cost by tool</h4>
      {partial && (
        <p className="tool-context-cost-incomplete" role="note" data-testid="context-cost-incomplete">
          <strong>Tool discovery did not complete.</strong> The total and shares cover only
          the {cost.toolCount} tool{cost.toolCount === 1 ? '' : 's'} received; the server may list more.
        </p>
      )}
      <div className="tool-metrics">
        <div><strong>{formatEstimate(cost.estimatedTotal)}</strong><span>{partial ? `Total of tools received, ${label}` : `Total, ${label}`}</span></div>
        <div><strong>{formatEstimate(cost.medianPerTool)}</strong><span>Median per tool{received}</span></div>
        <div><strong>{cost.toolCount}</strong><span>{partial ? 'Tools received and counted' : 'Tools counted'}</span></div>
        <div>
          <strong>{heaviest ? formatShare(heaviest.share) : '—'}</strong>
          <span>{heaviest ? `Heaviest tool share${partial ? ' of tools received' : ''}` : 'No tools'}</span>
        </div>
      </div>
      <p className="tool-context-cost-method">
        <strong>Estimate, not an exact count.</strong> {cost.method.description} Method: <code>{cost.method.id}</code>.
      </p>
      {visible.length > 0 && (
        <>
          <div className="tool-context-cost-columns" aria-hidden="true">
            <span>Tool (expand for parts and parameters)</span><span>Estimate</span><span>Share</span>
          </div>
          <ol className="tool-context-cost-list" aria-label={`Heaviest tools, ${label}`}>
            {visible.map((tool) => <ToolRow key={tool.name} tool={tool} label={label} />)}
          </ol>
          {more.length > 0 && (
            <details className="release-details tool-context-cost-more">
              <summary>Show {more.length} more tool{more.length === 1 ? '' : 's'}</summary>
              <ol className="tool-context-cost-list" start={VISIBLE_TOOLS + 1}>
                {more.map((tool) => <ToolRow key={tool.name} tool={tool} label={label} />)}
              </ol>
            </details>
          )}
          {cost.omittedToolCount > 0 && (
            <p className="tool-context-cost-note">
              {cost.omittedToolCount} lighter tool{cost.omittedToolCount === 1 ? ' is' : 's are'} counted in the total but not listed.
            </p>
          )}
        </>
      )}
      <ContextCostFindings findings={cost.findings.filter((finding) => !hideFindingIds.includes(finding.id))} />
    </section>
  );
};

/** Before/after change of the estimated context cost, overall and per changed tool. */
export const ToolContextCostDelta: React.FC<{ delta: ToolContextCostDeltaV1 }> = ({ delta }) => {
  const direction = delta.delta > 0 ? 'up' : delta.delta < 0 ? 'down' : 'same';
  return (
    <div className={`tool-context-cost-delta is-${direction}`} data-testid="context-cost-delta">
      <p className="tool-context-cost-delta-total">
        <strong>Context cost:</strong> {describeContextCostDelta(delta)}
      </p>
      {delta.tools.length > 0 && (
        <ul className="tool-context-cost-delta-list" aria-label="Context cost change per tool">
          {delta.tools.map((tool) => (
            <li key={`${tool.status}:${tool.name}`} className={`is-${tool.status}`}>
              {describeToolContextCostDelta(tool)}
            </li>
          ))}
        </ul>
      )}
      {delta.omittedToolCount > 0 && (
        <p className="tool-context-cost-note">{delta.omittedToolCount} smaller per-tool changes not listed.</p>
      )}
      <p className="tool-context-cost-note">
        Estimates ({delta.method.id}), not exact counts for any model.
        {!delta.complete && ' Per-tool changes cover only the tools both snapshots listed in detail.'}
        {delta.limitation && ` ${delta.limitation}`}
      </p>
    </div>
  );
};

/** Whether a delta is worth showing: the total or some tool changed. */
export const contextCostDeltaChanged = (delta: ToolContextCostDeltaV1 | undefined): delta is ToolContextCostDeltaV1 => (
  Boolean(delta) && (delta!.delta !== 0 || delta!.tools.length > 0)
);
