import React, { useEffect, useMemo, useRef, useState } from 'react';
import type { Client } from '@modelcontextprotocol/client';
import type { Tool } from '../types';
import type {
  DeterministicCaseResult,
  DeterministicTestCaseV1,
  DeterministicTestPlanV1,
} from '../types/deterministicTests';
import {
  generateDeterministicTestPlan,
  inferToolSafety,
  parseDeterministicTestPlan,
  runDeterministicPlan,
  serializeDeterministicTestPlan,
  validateDeterministicAssertions,
} from '../utils/deterministicTests';

interface DeterministicTestPanelProps {
  open: boolean;
  onClose: () => void;
  tools: Tool[];
  client: Client | null;
  serverUrl: string;
  connectionSummary: string;
}

type JsonDraft = {
  arguments: string;
  assertions: string;
  argumentsError?: string;
  assertionsError?: string;
};

const createDrafts = (plan: DeterministicTestPlanV1): Record<string, JsonDraft> => Object.fromEntries(
  plan.tools.flatMap(tool => tool.cases.map(testCase => [testCase.id, {
    arguments: JSON.stringify(testCase.arguments, null, 2),
    assertions: JSON.stringify(testCase.assertions, null, 2),
  }]))
);

const downloadPlan = (plan: DeterministicTestPlanV1) => {
  const blob = new Blob([serializeDeterministicTestPlan(plan)], { type: 'application/json' });
  const url = URL.createObjectURL(blob);
  const anchor = document.createElement('a');
  anchor.href = url;
  anchor.download = `mcptest-${plan.serverUrl.replace(/[^a-z0-9]+/gi, '-').replace(/^-|-$/g, '') || 'server'}-plan.json`;
  anchor.click();
  URL.revokeObjectURL(url);
};

const resultClass = (status: DeterministicCaseResult['status']) => ({
  passed: 'success',
  failed: 'danger',
  blocked: 'warning',
  cancelled: 'secondary',
}[status]);

export const DeterministicTestPanel: React.FC<DeterministicTestPanelProps> = ({
  open,
  onClose,
  tools,
  client,
  serverUrl,
  connectionSummary,
}) => {
  const [plan, setPlan] = useState<DeterministicTestPlanV1 | null>(null);
  const [drafts, setDrafts] = useState<Record<string, JsonDraft>>({});
  const [results, setResults] = useState<DeterministicCaseResult[]>([]);
  const [isRunning, setIsRunning] = useState(false);
  const [confirmedUnsafeFixtureSignature, setConfirmedUnsafeFixtureSignature] = useState<string | null>(null);
  const [notice, setNotice] = useState('');
  const [expandedCase, setExpandedCase] = useState<string | null>(null);
  const importRef = useRef<HTMLInputElement>(null);
  const abortRef = useRef<AbortController | null>(null);
  const runGenerationRef = useRef(0);
  const planBindingRef = useRef<{
    client: Client;
    serverUrl: string;
    toolSurfaceSignature: string;
  } | null>(null);
  const toolSurfaceSignature = JSON.stringify(tools);
  const planIsCurrent = planBindingRef.current?.client === client
    && planBindingRef.current.serverUrl === serverUrl
    && planBindingRef.current.toolSurfaceSignature === toolSurfaceSignature;

  useEffect(() => {
    if (!open) return;
    runGenerationRef.current += 1;
    abortRef.current?.abort();
    abortRef.current = null;
    setIsRunning(false);
    setResults([]);
    setConfirmedUnsafeFixtureSignature(null);
    setExpandedCase(null);
    setNotice('');

    if (!client || tools.length === 0) {
      planBindingRef.current = null;
      setPlan(null);
      setDrafts({});
      return;
    }

    const generated = generateDeterministicTestPlan(tools, serverUrl);
    planBindingRef.current = { client, serverUrl, toolSurfaceSignature };
    setPlan(generated);
    setDrafts(createDrafts(generated));
    // The serialized signature intentionally covers schemas, descriptions, and annotations.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [open, client, serverUrl, toolSurfaceSignature]);

  const selectedCases = useMemo(() => plan?.tools.flatMap(tool => (
    tool.cases.filter(testCase => testCase.selected).map(testCase => ({ tool, testCase }))
  )) || [], [plan]);
  const discoveredSafety = useMemo(() => new Map(tools.map(tool => [tool.name, inferToolSafety(tool)])), [tools]);
  const selectedUnsafeCases = useMemo(() => selectedCases
    .filter(({ tool, testCase }) => {
      const actual = discoveredSafety.get(testCase.toolName);
      return tool.safety.writeCapable || tool.safety.destructive || actual?.writeCapable || actual?.destructive;
    }), [discoveredSafety, selectedCases]);
  const selectedUnsafeTools = useMemo(() => [...new Set(selectedUnsafeCases
    .map(({ tool }) => tool.toolName))], [selectedUnsafeCases]);
  const unsafeFixtureSignature = useMemo(() => selectedUnsafeCases
    .map(({ testCase }) => JSON.stringify({ id: testCase.id, fixture: testCase }))
    .join('\u0000'), [selectedUnsafeCases]);
  const unsafeConfirmed = unsafeFixtureSignature.length > 0
    && confirmedUnsafeFixtureSignature === unsafeFixtureSignature;

  useEffect(() => {
    setConfirmedUnsafeFixtureSignature(null);
  }, [unsafeFixtureSignature]);

  useEffect(() => {
    setConfirmedUnsafeFixtureSignature(null);
  }, [open, client, serverUrl, connectionSummary]);

  const hasDraftErrors = Object.values(drafts).some(draft => draft.argumentsError || draft.assertionsError);

  const updateCase = (caseId: string, update: Partial<DeterministicTestCaseV1>) => {
    setConfirmedUnsafeFixtureSignature(null);
    setPlan(current => current ? {
      ...current,
      tools: current.tools.map(tool => ({
        ...tool,
        cases: tool.cases.map(testCase => testCase.id === caseId ? { ...testCase, ...update } : testCase),
      })),
    } : current);
  };

  const updateJsonDraft = (testCase: DeterministicTestCaseV1, field: 'arguments' | 'assertions', value: string) => {
    let parsed: unknown;
    let error: string | undefined;
    try {
      parsed = JSON.parse(value);
      if (field === 'arguments' && (typeof parsed !== 'object' || parsed === null || Array.isArray(parsed))) {
        throw new Error('Arguments must be a JSON object.');
      }
      if (field === 'assertions') validateDeterministicAssertions(parsed, testCase.id);
    } catch (cause) {
      error = cause instanceof Error ? cause.message : String(cause);
    }
    setConfirmedUnsafeFixtureSignature(null);
    const errorKey = field === 'arguments' ? 'argumentsError' : 'assertionsError';
    setDrafts(current => ({
      ...current,
      [testCase.id]: { ...current[testCase.id], [field]: value, [errorKey]: error },
    }));
    if (!error) updateCase(testCase.id, field === 'arguments'
      ? { arguments: parsed as Record<string, unknown> }
      : { assertions: parsed as DeterministicTestCaseV1['assertions'] });
  };

  const handleRun = async () => {
    if (!client || !plan || !planIsCurrent || selectedCases.length === 0 || hasDraftErrors) return;
    const runGeneration = runGenerationRef.current + 1;
    runGenerationRef.current = runGeneration;
    setIsRunning(true);
    setResults([]);
    setNotice('');
    const controller = new AbortController();
    abortRef.current = controller;
    try {
      await runDeterministicPlan(client, plan, {
        caseIds: selectedCases.map(({ testCase }) => testCase.id),
        confirmedUnsafeToolNames: unsafeConfirmed ? selectedUnsafeTools : [],
        unsafeToolNames: [...discoveredSafety.entries()]
          .filter(([, safety]) => safety.writeCapable || safety.destructive)
          .map(([name]) => name),
        signal: controller.signal,
        onResult: result => {
          if (runGenerationRef.current === runGeneration) {
            setResults(current => [...current, result]);
          }
        },
      });
    } catch (cause) {
      if (runGenerationRef.current === runGeneration) {
        setNotice(`Run failed: ${cause instanceof Error ? cause.message : String(cause)}`);
      }
    } finally {
      if (runGenerationRef.current === runGeneration) {
        abortRef.current = null;
        setIsRunning(false);
        setConfirmedUnsafeFixtureSignature(null);
      }
    }
  };

  const handleExport = () => {
    if (!plan || !planIsCurrent || hasDraftErrors) return;
    try {
      downloadPlan(plan);
    } catch (cause) {
      setNotice(`Export failed: ${cause instanceof Error ? cause.message : String(cause)}`);
    }
  };

  const handleImport = async (event: React.ChangeEvent<HTMLInputElement>) => {
    const file = event.target.files?.[0];
    event.target.value = '';
    if (!file) return;
    try {
      const parsed = parseDeterministicTestPlan(await file.text());
      const undiscoveredToolNames = parsed.tools
        .map(tool => tool.toolName)
        .filter(toolName => !discoveredSafety.has(toolName));
      if (undiscoveredToolNames.length > 0) {
        throw new Error(`Plan contains tools not advertised by the connected server: ${undiscoveredToolNames.join(', ')}.`);
      }
      const imported = {
        ...parsed,
        tools: parsed.tools.map(tool => {
          const actual = discoveredSafety.get(tool.toolName);
          if (!actual) throw new Error(`Tool ${tool.toolName} is no longer available on the connected server.`);
          return {
            ...tool,
            safety: {
              writeCapable: tool.safety.writeCapable || actual.writeCapable,
              destructive: tool.safety.destructive || actual.destructive,
              reasons: [...new Set([...tool.safety.reasons, ...actual.reasons])],
            },
          };
        }),
      };
      setPlan(imported);
      setDrafts(createDrafts(imported));
      setResults([]);
      setConfirmedUnsafeFixtureSignature(null);
      setNotice(`Imported ${imported.tools.length} tool plans from ${file.name}.`);
    } catch (cause) {
      setNotice(`Import failed: ${cause instanceof Error ? cause.message : String(cause)}`);
    }
  };

  if (!open) return null;

  return (
    <div className="deterministic-tests-backdrop" role="presentation">
      <section className="deterministic-tests-dialog" role="dialog" aria-modal="true" aria-labelledby="deterministic-tests-title">
        <header className="deterministic-tests-header">
          <div>
            <h2 id="deterministic-tests-title">Deterministic tool tests</h2>
            <p>{connectionSummary}. Runs use this connected session and require no model or API key.</p>
          </div>
          <button className="btn btn-sm btn-outline-secondary" onClick={() => {
            setConfirmedUnsafeFixtureSignature(null);
            onClose();
          }} disabled={isRunning} aria-label="Close deterministic tests">
            <i className="bi bi-x-lg" aria-hidden="true" />
          </button>
        </header>

        <div className="deterministic-tests-toolbar">
          <button className="btn btn-sm btn-outline-secondary" onClick={() => importRef.current?.click()} disabled={isRunning}>Import JSON</button>
          <button className="btn btn-sm btn-outline-secondary" onClick={handleExport} disabled={!plan || !planIsCurrent || isRunning || hasDraftErrors}>Export JSON</button>
          <button className="btn btn-sm btn-outline-secondary" onClick={() => {
            const generated = generateDeterministicTestPlan(tools, serverUrl);
            setPlan(generated);
            setDrafts(createDrafts(generated));
            setResults([]);
            setConfirmedUnsafeFixtureSignature(null);
            setNotice('Generated a fresh plan from the discovered tool surface.');
          }} disabled={isRunning || !client || tools.length === 0}>Regenerate</button>
          <input ref={importRef} type="file" accept="application/json,.json" className="visually-hidden" onChange={handleImport} />
          <span className="text-muted">Plan version {plan?.version || '—'}</span>
        </div>

        {notice && <div className="deterministic-tests-notice" role="status">{notice}</div>}

        <div className="deterministic-tests-content">
          <div className="deterministic-tests-plan">
            {!plan || plan.tools.length === 0 ? (
              <p className="text-muted">No discovered tools are available for a test plan.</p>
            ) : plan.tools.map(tool => (
              <details className="test-tool" key={tool.toolName} open>
                <summary>
                  <span>{tool.toolName}</span>
                  {(tool.safety.writeCapable || tool.safety.destructive) && (
                    <span className="badge bg-warning text-dark">Confirmation required</span>
                  )}
                  <span className="text-muted">{tool.cases.filter(item => item.selected).length} selected</span>
                </summary>
                {(tool.safety.writeCapable || tool.safety.destructive) && (
                  <p className="test-safety-reason">{tool.safety.reasons.join(' ') || 'This tool may change server data.'}</p>
                )}
                <div className="test-case-list">
                  {tool.cases.map(testCase => {
                    const draft = drafts[testCase.id];
                    const expanded = expandedCase === testCase.id;
                    return (
                      <article className={`test-case ${testCase.selected ? 'test-case-selected' : ''}`} key={testCase.id}>
                        <div className="test-case-heading">
                          <label>
                            <input
                              type="checkbox"
                              checked={testCase.selected}
                              onChange={event => updateCase(testCase.id, { selected: event.target.checked })}
                              disabled={isRunning}
                            />
                            <span>{testCase.name}</span>
                          </label>
                          <span className="text-muted">{testCase.timeoutMs} ms</span>
                          <button className="btn btn-sm btn-link" onClick={() => setExpandedCase(expanded ? null : testCase.id)}>
                            {expanded ? 'Done editing' : 'Edit fixture'}
                          </button>
                        </div>
                        {expanded && draft && (
                          <div className="test-case-editor">
                            <label>
                              Case name
                              <input className="form-control" value={testCase.name} onChange={event => updateCase(testCase.id, { name: event.target.value })} />
                            </label>
                            <label>
                              Timeout in milliseconds
                              <input className="form-control" type="number" min="1" value={testCase.timeoutMs} onChange={event => updateCase(testCase.id, { timeoutMs: Math.max(1, Number(event.target.value)) })} />
                            </label>
                            <label className="test-json-field">
                              Fixture arguments
                              <textarea className="form-control font-monospace" rows={7} value={draft.arguments} onChange={event => updateJsonDraft(testCase, 'arguments', event.target.value)} />
                            </label>
                            {draft.argumentsError && <p className="test-json-error">Invalid fixture arguments: {draft.argumentsError}</p>}
                            <label className="test-json-field">
                              Structural assertions
                              <textarea className="form-control font-monospace" rows={7} value={draft.assertions} onChange={event => updateJsonDraft(testCase, 'assertions', event.target.value)} />
                            </label>
                            {draft.assertionsError && <p className="test-json-error">Invalid structural assertions: {draft.assertionsError}</p>}
                          </div>
                        )}
                      </article>
                    );
                  })}
                </div>
              </details>
            ))}
          </div>

          <aside className="deterministic-tests-results" aria-label="Test evidence">
            <h3>Run evidence</h3>
            {results.length === 0 ? (
              <p className="text-muted">Select cases and run them to see pass or fail evidence, timing, and redacted data.</p>
            ) : results.map(result => (
              <details className="test-result" key={`${result.caseId}-${result.startedAt}`}>
                <summary>
                  <span className={`badge bg-${resultClass(result.status)}`}>{result.status}</span>
                  <span>{result.toolName} · {result.caseName}</span>
                  <span className="text-muted">{result.durationMs} ms</span>
                </summary>
                {result.error && (
                  <div className="test-error-evidence">
                    <strong>{result.error.type}{result.error.code !== undefined ? ` (${result.error.code})` : ''}</strong>
                    <span>{result.error.retryable ? 'Retryable' : 'Not retryable'}</span>
                    <p>{result.error.message}</p>
                    {Object.keys(result.error.identifiers).length > 0 && <pre>{JSON.stringify(result.error.identifiers, null, 2)}</pre>}
                  </div>
                )}
                {result.assertions.map((evidence, index) => (
                  <p className={evidence.passed ? 'test-assertion-pass' : 'test-assertion-fail'} key={index}>
                    {evidence.passed ? 'Pass: ' : 'Fail: '}{evidence.message}
                  </p>
                ))}
                <h4>Redacted request</h4>
                <pre>{JSON.stringify(result.request, null, 2)}</pre>
                {result.response !== undefined && <><h4>Redacted response</h4><pre>{JSON.stringify(result.response, null, 2)}</pre></>}
                <h4>Reproducible case</h4>
                <pre>{JSON.stringify(result.reproducibleCase, null, 2)}</pre>
              </details>
            ))}
          </aside>
        </div>

        <footer className="deterministic-tests-footer">
          <div>
            {selectedUnsafeTools.length > 0 && (
              <label className="unsafe-confirmation">
                <input
                  type="checkbox"
                  checked={unsafeConfirmed}
                  onChange={event => setConfirmedUnsafeFixtureSignature(event.target.checked ? unsafeFixtureSignature : null)}
                  disabled={isRunning}
                />
                I explicitly confirm running write-capable or destructive fixtures for {selectedUnsafeTools.join(', ')}.
              </label>
            )}
            {hasDraftErrors && <span className="test-json-error">Fix invalid fixture JSON or assertions before running or exporting.</span>}
          </div>
          <div className="d-flex gap-2">
            {isRunning && <button className="btn btn-outline-danger" onClick={() => abortRef.current?.abort()}>Cancel run</button>}
            <button
              className="btn btn-primary"
              onClick={handleRun}
              disabled={isRunning || !client || !planIsCurrent || selectedCases.length === 0 || hasDraftErrors || (selectedUnsafeTools.length > 0 && !unsafeConfirmed)}
            >
              {isRunning ? 'Running…' : `Run ${selectedCases.length} selected ${selectedCases.length === 1 ? 'case' : 'cases'}`}
            </button>
          </div>
        </footer>
      </section>
    </div>
  );
};

export default DeterministicTestPanel;
