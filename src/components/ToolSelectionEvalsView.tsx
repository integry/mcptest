import React, { useMemo, useState } from 'react';
import {
  LOCAL_TOOL_SELECTION_FIXTURE,
  LOCAL_TOOL_SELECTION_FIXTURE_JSON,
  calculateMetrics,
  compareRuns,
  createProvider,
  getRunnableCases,
  getSessionCredential,
  parseDataset,
  redactReportCredential,
  runEvaluation,
  setSessionCredential,
  suggestCases,
  type EvalArm,
  type EvalMetrics,
  type EvalProviderId,
  type EvalRunReportV1,
  type ToolSelectionDatasetV1,
} from '../evals';

const providerModels: Record<EvalProviderId, string> = {
  fixture: 'fixture-v1',
  openai: 'gpt-5-mini',
  anthropic: 'claude-sonnet-4-20250514',
};

const armLabels: Record<EvalArm, string> = {
  'with-mcp': 'With MCP tools',
  'without-mcp': 'Without MCP tools',
  'plain-context': 'Tool data as plain context',
};

const formatPercent = (value: number | null): string => value === null ? 'Not applicable' : `${(value * 100).toFixed(1)}%`;
const formatCost = (value: number | null): string => value === null ? 'Unavailable' : value ? `$${value.toFixed(5)}` : '$0.00';
const formatMilliseconds = (value: number | null, digits = 0): string => value === null ? 'Unavailable' : `${value.toFixed(digits)} ms`;

const downloadJson = (report: EvalRunReportV1, filename: string, credential: string) => {
  const safeReport = redactReportCredential(report, credential);
  const url = URL.createObjectURL(new Blob([JSON.stringify(safeReport, null, 2)], { type: 'application/json' }));
  const anchor = document.createElement('a');
  anchor.href = url;
  anchor.download = filename;
  anchor.click();
  URL.revokeObjectURL(url);
};

const MetricsTable: React.FC<{ metrics: EvalMetrics }> = ({ metrics }) => (
  <div className="table-responsive">
    <table className="table table-sm align-middle mb-0 eval-metrics-table">
      <thead>
        <tr>
          <th>Selection</th>
          <th>No tool</th>
          <th>Valid schema</th>
          <th>Arguments</th>
          <th>Tool called</th>
          <th>Figures grounded</th>
          <th>Latency mean / p95</th>
          <th>Approx. cost</th>
        </tr>
      </thead>
      <tbody>
        <tr>
          <td>{formatPercent(metrics.selectionAccuracy)}</td>
          <td>{formatPercent(metrics.noToolAccuracy)}</td>
          <td>{formatPercent(metrics.argumentSchemaValidity)}</td>
          <td>{formatPercent(metrics.assertionAccuracy)}</td>
          <td>{formatPercent(metrics.expectedToolCallRate)}</td>
          <td>{formatPercent(metrics.figureGroundingAccuracy)}</td>
          <td>{formatMilliseconds(metrics.latencyMs.mean)} / {formatMilliseconds(metrics.latencyMs.p95)}</td>
          <td>{formatCost(metrics.approximateTokenCost)}</td>
        </tr>
      </tbody>
    </table>
  </div>
);

const ToolSelectionEvalsView: React.FC = () => {
  const [dataset, setDataset] = useState<ToolSelectionDatasetV1>(LOCAL_TOOL_SELECTION_FIXTURE);
  const [datasetText, setDatasetText] = useState(LOCAL_TOOL_SELECTION_FIXTURE_JSON);
  const [datasetError, setDatasetError] = useState('');
  const [provider, setProvider] = useState<EvalProviderId>('fixture');
  const [model, setModel] = useState(providerModels.fixture);
  const [credential, setCredential] = useState('');
  const [trials, setTrials] = useState(3);
  const [arms, setArms] = useState<EvalArm[]>(['with-mcp', 'without-mcp', 'plain-context']);
  const [inputPrice, setInputPrice] = useState(0);
  const [outputPrice, setOutputPrice] = useState(0);
  const [running, setRunning] = useState(false);
  const [progress, setProgress] = useState({ completed: 0, total: 0 });
  const [runError, setRunError] = useState('');
  const [reports, setReports] = useState<EvalRunReportV1[]>([]);
  const latest = reports.length ? reports[reports.length - 1] : undefined;
  const baseline = reports.length > 1 ? reports[reports.length - 2] : undefined;
  const comparison = baseline && latest ? compareRuns(baseline, latest) : undefined;
  const runnableCount = getRunnableCases(dataset).length;
  const pendingSuggestions = (dataset.suggestions || []).filter(item => item.reviewStatus === 'unreviewed').length;

  const armMetrics = useMemo(() => latest
    ? latest.configuration.arms.map(arm => ({
        arm,
        metrics: calculateMetrics(latest.results.filter(result => result.arm === arm)),
      }))
    : [], [latest]);

  const updateProvider = (next: EvalProviderId) => {
    setProvider(next);
    setModel(providerModels[next]);
    setCredential(next === 'fixture' ? '' : getSessionCredential(next));
  };

  const applyDataset = () => {
    try {
      const next = parseDataset(datasetText);
      if (next.id !== dataset.id) setReports([]);
      setDataset(next);
      setDatasetError('');
    } catch (error) {
      setDatasetError(error instanceof Error ? error.message : String(error));
    }
  };

  const updateDataset = (next: ToolSelectionDatasetV1) => {
    if (next.id !== dataset.id) setReports([]);
    setDataset(next);
    setDatasetText(JSON.stringify(next, null, 2));
    setDatasetError('');
  };

  const generateSuggestions = () => {
    updateDataset({
      ...dataset,
      suggestions: [...(dataset.suggestions || []), ...suggestCases(dataset)],
    });
  };

  const reviewSuggestion = (id: string, reviewStatus: 'approved' | 'rejected') => {
    updateDataset({
      ...dataset,
      suggestions: (dataset.suggestions || []).map(item => item.id === id ? { ...item, reviewStatus } : item),
    });
  };

  const toggleArm = (arm: EvalArm) => {
    setArms(current => current.includes(arm) ? current.filter(item => item !== arm) : [...current, arm]);
  };

  const run = async () => {
    setRunError('');
    setRunning(true);
    setProgress({ completed: 0, total: runnableCount * arms.length * trials });
    try {
      if (provider !== 'fixture') setSessionCredential(provider, credential);
      const report = await runEvaluation(dataset, {
        provider,
        model: model.trim(),
        arms,
        trials,
        inputCostPerMillionTokens: inputPrice,
        outputCostPerMillionTokens: outputPrice,
      }, createProvider(provider, credential), (completed, total) => setProgress({ completed, total }), credential);
      const safeReport = redactReportCredential(report, credential);
      setReports(current => [...current, safeReport]);
    } catch (error) {
      setRunError(error instanceof Error ? error.message : String(error));
    } finally {
      setRunning(false);
    }
  };

  return (
    <div className="tool-evals container-xl pb-5">
      <div className="tool-evals-hero">
        <div>
          <h1>Tool-selection evaluations</h1>
          <p>Measure tool choice, arguments, and grounded answers with a local fixture or your own model provider.</p>
        </div>
        <span className="badge rounded-pill text-bg-success">Opt in</span>
      </div>

      <div className="alert alert-info" role="note">
        These are isolated model evaluations. They do not reproduce real ChatGPT, Claude, Cursor, or other host behavior, where system prompts, tool routing, and runtime policies differ.
      </div>

      <section className="card">
        <div className="card-body">
          <div className="d-flex flex-wrap align-items-start justify-content-between gap-3 mb-3">
            <div>
              <h2 className="h4 mb-1">Dataset</h2>
              <p className="text-muted mb-0">Version {dataset.version} · {runnableCount} runnable cases · description {dataset.descriptionRevision} · schema {dataset.schemaRevision}</p>
            </div>
            <div className="d-flex gap-2">
              <button className="btn btn-outline-secondary btn-sm" type="button" onClick={() => updateDataset(LOCAL_TOOL_SELECTION_FIXTURE)}>Reset local fixture</button>
              <button className="btn btn-outline-primary btn-sm" type="button" onClick={generateSuggestions}>Suggest cases</button>
            </div>
          </div>
          <label className="form-label" htmlFor="eval-dataset">Manual dataset JSON</label>
          <textarea
            id="eval-dataset"
            className="form-control font-monospace eval-dataset-editor"
            value={datasetText}
            onChange={event => setDatasetText(event.target.value)}
            spellCheck={false}
          />
          {datasetError && <div className="alert alert-danger mt-3 mb-0" style={{ whiteSpace: 'pre-wrap' }}>{datasetError}</div>}
          <button className="btn btn-primary mt-3" type="button" onClick={applyDataset}>Validate and use dataset</button>
        </div>
      </section>

      {(dataset.suggestions || []).length > 0 && (
        <section className="card">
          <div className="card-body">
            <h2 className="h4">Review synthetic suggestions</h2>
            <p className="text-muted">Generated cases never run until you approve them. {pendingSuggestions} still need review.</p>
            <div className="d-grid gap-2">
              {(dataset.suggestions || []).map(suggestion => (
                <div className="eval-suggestion" key={suggestion.id}>
                  <div>
                    <strong>{suggestion.prompt}</strong>
                    <div className="text-muted small">Expected: {suggestion.expectedNoTool ? 'no tool' : suggestion.acceptableTools?.join(' or ')} · {suggestion.reviewStatus}</div>
                  </div>
                  {suggestion.reviewStatus === 'unreviewed' && (
                    <div className="d-flex gap-2">
                      <button className="btn btn-success btn-sm" type="button" onClick={() => reviewSuggestion(suggestion.id, 'approved')}>Approve</button>
                      <button className="btn btn-outline-secondary btn-sm" type="button" onClick={() => reviewSuggestion(suggestion.id, 'rejected')}>Reject</button>
                    </div>
                  )}
                </div>
              ))}
            </div>
          </div>
        </section>
      )}

      <section className="card">
        <div className="card-body">
          <h2 className="h4">Run configuration</h2>
          <div className="row g-3">
            <div className="col-md-4">
              <label className="form-label" htmlFor="eval-provider">Provider</label>
              <select id="eval-provider" className="form-select" value={provider} onChange={event => updateProvider(event.target.value as EvalProviderId)}>
                <option value="fixture">Local fixture (no API call)</option>
                <option value="openai">OpenAI</option>
                <option value="anthropic">Anthropic</option>
              </select>
            </div>
            <div className="col-md-5">
              <label className="form-label" htmlFor="eval-model">Model</label>
              <input id="eval-model" className="form-control" value={model} onChange={event => setModel(event.target.value)} />
            </div>
            <div className="col-md-3">
              <label className="form-label" htmlFor="eval-trials">Trials per case and arm</label>
              <input id="eval-trials" className="form-control" type="number" min="1" max="20" value={trials} onChange={event => setTrials(Number(event.target.value))} />
            </div>
            {provider !== 'fixture' && (
              <div className="col-12">
                <label className="form-label" htmlFor="eval-credential">Session-only API key</label>
                <input
                  id="eval-credential"
                  className="form-control"
                  type="password"
                  autoComplete="off"
                  value={credential}
                  onChange={event => setCredential(event.target.value)}
                />
                <div className="form-text">Stored only in this tab&apos;s session storage. It is never added to datasets, reports, or application logs.</div>
              </div>
            )}
            <fieldset className="col-12">
              <legend className="form-label">Comparison arms</legend>
              <div className="d-flex flex-wrap gap-3">
                {(Object.keys(armLabels) as EvalArm[]).map(arm => (
                  <div className="form-check" key={arm}>
                    <input className="form-check-input" id={`arm-${arm}`} type="checkbox" checked={arms.includes(arm)} onChange={() => toggleArm(arm)} />
                    <label className="form-check-label" htmlFor={`arm-${arm}`}>{armLabels[arm]}</label>
                  </div>
                ))}
              </div>
            </fieldset>
            <div className="col-md-3">
              <label className="form-label" htmlFor="input-price">Input $ / million tokens</label>
              <input id="input-price" className="form-control" type="number" min="0" step="0.01" value={inputPrice} onChange={event => setInputPrice(Number(event.target.value))} />
            </div>
            <div className="col-md-3">
              <label className="form-label" htmlFor="output-price">Output $ / million tokens</label>
              <input id="output-price" className="form-control" type="number" min="0" step="0.01" value={outputPrice} onChange={event => setOutputPrice(Number(event.target.value))} />
            </div>
          </div>
          {runError && <div className="alert alert-danger mt-3 mb-0">{runError}</div>}
          <div className="d-flex align-items-center gap-3 mt-4">
            <button className="btn btn-primary" type="button" onClick={run} disabled={running || !arms.length || !model.trim()}>
              {running ? 'Running evaluation…' : `Run ${runnableCount * arms.length * trials} trials`}
            </button>
            {running && <span className="text-muted">{progress.completed} of {progress.total}</span>}
          </div>
        </div>
      </section>

      {latest && (
        <section className="card">
          <div className="card-body">
            <div className="d-flex flex-wrap justify-content-between gap-3 mb-3">
              <div>
                <h2 className="h4 mb-1">Latest results</h2>
                <p className="text-muted mb-0">{latest.configuration.provider} · {latest.configuration.model} · {latest.configuration.trials} repeated trials</p>
              </div>
              <button
                className="btn btn-outline-secondary btn-sm align-self-start"
                type="button"
                onClick={() => downloadJson(
                  latest,
                  `${latest.dataset.id}-${latest.id}.json`,
                  latest.configuration.provider === 'fixture' ? '' : getSessionCredential(latest.configuration.provider)
                )}
              >Download report</button>
            </div>
            <MetricsTable metrics={latest.metrics} />
            <p className="form-text mt-2">
              Figures grounded is scored only when the figure was supplied as plain context or through a successfully completed expected tool-result turn.
            </p>
            <div className="row g-3 mt-2">
              {armMetrics.map(({ arm, metrics }) => (
                <div className="col-12" key={arm}>
                  <h3 className="h6">{armLabels[arm]}</h3>
                  <MetricsTable metrics={metrics} />
                </div>
              ))}
            </div>
            <div className="mt-4">
              <h3 className="h5">Spread and tail behavior</h3>
              <p className="mb-1">Latency: mean {formatMilliseconds(latest.metrics.latencyMs.mean, 1)}, p50 {formatMilliseconds(latest.metrics.latencyMs.p50, 1)}, p95 {formatMilliseconds(latest.metrics.latencyMs.p95, 1)}.</p>
              <p className="text-muted">Range {formatMilliseconds(latest.metrics.latencyMs.min, 1)}–{formatMilliseconds(latest.metrics.latencyMs.max, 1)}; spread {formatMilliseconds(latest.metrics.latencyMs.spread, 1)}.</p>
            </div>
            <div className="mt-4">
              <h3 className="h5">Confusion pairs</h3>
              {latest.metrics.confusionPairs.length ? (
                <ul>
                  {latest.metrics.confusionPairs.map(pair => <li key={`${pair.expected}-${pair.observed}`}>{pair.expected} → {pair.observed}: {pair.count}</li>)}
                </ul>
              ) : <p className="text-muted">No tool-selection confusions in this run.</p>}
            </div>
            <details className="mt-3">
              <summary>Inspect individual trials</summary>
              <div className="table-responsive mt-2">
                <table className="table table-sm">
                  <thead><tr><th>Case</th><th>Arm</th><th>Trial</th><th>Observed</th><th>Schema</th><th>Grounded</th><th>Error</th></tr></thead>
                  <tbody>
                    {latest.results.map((result, index) => (
                      <tr key={`${result.caseId}-${result.arm}-${result.trial}-${index}`}>
                        <td>{result.caseId}</td><td>{armLabels[result.arm]}</td><td>{result.trial}</td>
                        <td>{result.observedTools === null ? 'Unavailable' : result.observedTools.join(', ') || 'No tool'}</td>
                        <td>{result.argumentSchemaValid === null ? '—' : result.argumentSchemaValid ? 'Valid' : 'Invalid'}</td>
                        <td>{result.figuresGrounded === null ? '—' : result.figuresGrounded ? 'Yes' : 'No'}</td>
                        <td>{result.error || '—'}</td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            </details>
          </div>
        </section>
      )}

      {comparison && (
        <section className="card">
          <div className="card-body">
            <h2 className="h4">Compared with previous run</h2>
            <p>
              Description revision {comparison.descriptionRevisionChanged ? 'changed' : 'unchanged'}; schema revision {comparison.schemaRevisionChanged ? 'changed' : 'unchanged'}.
            </p>
            <ul className="mb-0">
              <li>Selection accuracy: {comparison.metricDeltas.selectionAccuracy === null ? 'not comparable' : `${(comparison.metricDeltas.selectionAccuracy! * 100).toFixed(1)} points`}</li>
              <li>Schema validity: {comparison.metricDeltas.argumentSchemaValidity === null ? 'not comparable' : `${(comparison.metricDeltas.argumentSchemaValidity! * 100).toFixed(1)} points`}</li>
              <li>Mean latency: {comparison.latencyMeanDeltaMs === null ? 'not comparable' : `${comparison.latencyMeanDeltaMs.toFixed(1)} ms`}</li>
              <li>Regressions: {comparison.regressions.length ? comparison.regressions.join(', ') : 'none detected'}</li>
            </ul>
          </div>
        </section>
      )}
    </div>
  );
};

export default ToolSelectionEvalsView;
