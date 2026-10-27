import React, { useId, useRef, useState } from 'react';
import {
  BREAKING_CHANGES_GUIDE_PATH,
  classifyBreakingChanges,
  parseToolsListPayload,
  toolSurfaceFromInterfaceSnapshot,
  type BreakingChangeReport,
} from '../utils/breakingChanges';
import BreakingChangeFindings from './BreakingChangeFindings';
import './BreakingChanges.css';

type Mode = 'paste' | 'live';
type Baseline = 'published' | 'browser';

interface BreakingChangesViewProps {
  /** Prefills the live endpoint, e.g. from `?endpoint=`. */
  initialEndpoint?: string;
}

interface Result {
  report: BreakingChangeReport;
  /** What the earlier listing was, in words. */
  baseline: string;
}

const EXAMPLE_BEFORE = JSON.stringify({
  tools: [
    {
      name: 'search_issues',
      description: 'Search issues in a repository by text query',
      inputSchema: {
        type: 'object',
        properties: { query: { type: 'string' }, state: { type: 'string', enum: ['open', 'closed', 'all'] } },
        required: ['query'],
        additionalProperties: false,
      },
      annotations: { readOnlyHint: true },
    },
    { name: 'get_issue', description: 'Get one issue by number', inputSchema: { type: 'object', properties: { number: { type: 'integer' } }, required: ['number'] } },
  ],
}, null, 2);

const EXAMPLE_AFTER = JSON.stringify({
  tools: [
    {
      name: 'search_issues',
      description: 'Search issues in a repository by text query',
      inputSchema: {
        type: 'object',
        properties: {
          query: { type: 'string' },
          repo: { type: 'string' },
          state: { type: 'string', enum: ['open', 'closed'] },
          limit: { type: 'integer' },
        },
        required: ['query', 'repo'],
        additionalProperties: false,
      },
      annotations: { readOnlyHint: true },
    },
    { name: 'fetch_issue', description: 'Get one issue by number', inputSchema: { type: 'object', properties: { number: { type: 'integer' } }, required: ['number'] } },
    { name: 'close_issue', description: 'Close an issue', inputSchema: { type: 'object', properties: { number: { type: 'integer' } }, required: ['number'] }, annotations: { destructiveHint: true } },
  ],
}, null, 2);

const errorText = (error: unknown): string => (error instanceof Error ? error.message : String(error));

const formatDate = (value: string): string => {
  const time = Date.parse(value);
  return Number.isNaN(time) ? value : new Date(time).toLocaleString();
};

/**
 * /tools/breaking-changes: classifies the difference between two listings of
 * a remote MCP server as breaking, risky or safe for clients that cached the
 * earlier one. Pasted payloads are compared in the browser; the live check
 * lists the endpoint without credentials and compares it with its latest
 * published report or the last connection saved in this browser.
 */
const BreakingChangesView: React.FC<BreakingChangesViewProps> = ({ initialEndpoint = '' }) => {
  const id = useId();
  const fieldId = (name: string) => `${id}-${name}`;
  const [mode, setMode] = useState<Mode>('paste');
  const [before, setBefore] = useState('');
  const [after, setAfter] = useState('');
  const [pasteErrors, setPasteErrors] = useState<{ before?: string; after?: string }>({});
  const [endpoint, setEndpoint] = useState(initialEndpoint);
  const [baseline, setBaseline] = useState<Baseline>('published');
  const [checking, setChecking] = useState(false);
  const [liveError, setLiveError] = useState<string | null>(null);
  const [result, setResult] = useState<Result | null>(null);
  const resultsRef = useRef<HTMLElement>(null);
  const liveRequest = useRef(0);

  const showResult = (next: Result) => {
    setResult(next);
    // Move focus to the results so keyboard and screen-reader users land on them.
    requestAnimationFrame(() => resultsRef.current?.focus());
  };

  const comparePasted = (event: React.FormEvent) => {
    event.preventDefault();
    const left = parseToolsListPayload(before);
    const right = parseToolsListPayload(after);
    const errors = {
      ...(left.ok ? {} : { before: left.error }),
      ...(right.ok ? {} : { after: right.error }),
    };
    setPasteErrors(errors);
    if (!left.ok || !right.ok) {
      setResult(null);
      return;
    }
    showResult({ report: classifyBreakingChanges(left.snapshot, right.snapshot), baseline: 'the first pasted listing' });
  };

  const loadExample = () => {
    setBefore(EXAMPLE_BEFORE);
    setAfter(EXAMPLE_AFTER);
    setPasteErrors({});
    setResult(null);
  };

  const checkLive = async (event: React.FormEvent) => {
    event.preventDefault();
    const target = endpoint.trim();
    if (!target) return;
    const request = liveRequest.current + 1;
    liveRequest.current = request;
    setChecking(true);
    setLiveError(null);
    setResult(null);
    try {
      // Loaded on demand: a paste-only visit never fetches the MCP SDK.
      const [{ fetchLiveInterface }, snapshots, published] = await Promise.all([
        import('../utils/liveInterface'),
        import('../utils/interfaceSnapshot'),
        import('../utils/publishedReports'),
      ]);
      let earlier;
      let description: string;
      if (baseline === 'published') {
        const index = await published.fetchPublishedReportIndex(target);
        if (!index) throw new Error('Published reports are not available for this endpoint (it must be a public http(s) URL).');
        const latest = index.snapshots[0];
        if (!latest) throw new Error('This endpoint has no published report yet. Publish one from the report page, or compare against the last connection saved in this browser.');
        earlier = snapshots.interfaceSnapshotFromReport(await published.fetchPublishedReport(latest.id));
        description = `the report published ${formatDate(latest.createdAt)}`;
      } else {
        earlier = snapshots.loadPreviousInterfaceSnapshot(target, window.localStorage);
        if (!earlier) throw new Error('This browser has no saved connection to this endpoint. Connect in the playground first, or compare against the latest published report.');
        description = `the connection saved in this browser on ${formatDate(earlier.observedAt)}`;
      }
      const live = await fetchLiveInterface(target);
      const current = snapshots.confirmedInterfaceSnapshot(snapshots.createInterfaceSnapshot(live.input), live.confirmed, earlier);
      const left = toolSurfaceFromInterfaceSnapshot(earlier);
      const right = toolSurfaceFromInterfaceSnapshot(current);
      if (!left) throw new Error('The saved baseline does not record a complete tool list, so it cannot be compared.');
      if (!right) throw new Error('The endpoint did not return a complete tool list.');
      if (liveRequest.current !== request) return;
      showResult({ report: classifyBreakingChanges(left, right), baseline: description });
    } catch (error) {
      if (liveRequest.current !== request) return;
      setLiveError(errorText(error));
    } finally {
      if (liveRequest.current === request) setChecking(false);
    }
  };

  return (
    <div className="breaking-changes">
      <header className="breaking-changes-header">
        <h1>MCP breaking-change check</h1>
        <p>
          Will this deploy break the agents that already use your server? Compare two tools/list results and every
          difference is classified as breaking, risky or safe for clients that cached the old listing, with the reason.
        </p>
        <p>
          Pasted payloads never leave your browser. Read <a href={BREAKING_CHANGES_GUIDE_PATH}>which MCP tool changes break clients</a> for
          the rules and how to ship changes safely.
        </p>
      </header>

      <section className="breaking-changes-section" aria-labelledby={fieldId('compare')}>
        <h2 id={fieldId('compare')}>Compare</h2>
        <fieldset className="breaking-changes-modes">
          <legend>What to compare</legend>
          <div className="form-check">
            <input
              className="form-check-input"
              type="radio"
              id={fieldId('mode-paste')}
              name={fieldId('mode')}
              checked={mode === 'paste'}
              onChange={() => setMode('paste')}
            />
            <label className="form-check-label" htmlFor={fieldId('mode-paste')}>Paste two tools/list payloads</label>
          </div>
          <div className="form-check">
            <input
              className="form-check-input"
              type="radio"
              id={fieldId('mode-live')}
              name={fieldId('mode')}
              checked={mode === 'live'}
              onChange={() => setMode('live')}
            />
            <label className="form-check-label" htmlFor={fieldId('mode-live')}>Check a live endpoint</label>
          </div>
        </fieldset>

        {mode === 'paste' ? (
          <form onSubmit={comparePasted} noValidate>
            <div className="breaking-changes-payloads">
              {([
                ['before', 'Before (currently deployed)', before, setBefore],
                ['after', 'After (about to ship)', after, setAfter],
              ] as const).map(([key, label, value, setValue]) => (
                <div key={key}>
                  <label htmlFor={fieldId(key)} className="form-label">{label}</label>
                  <textarea
                    id={fieldId(key)}
                    className={`form-control${pasteErrors[key] ? ' is-invalid' : ''}`}
                    value={value}
                    spellCheck={false}
                    placeholder={'{"tools": [ ... ]}'}
                    onChange={(event) => setValue(event.target.value)}
                    aria-invalid={Boolean(pasteErrors[key])}
                    aria-describedby={`${fieldId(`${key}-hint`)}${pasteErrors[key] ? ` ${fieldId(`${key}-error`)}` : ''}`}
                  />
                  <p id={fieldId(`${key}-hint`)} className="breaking-changes-hint">
                    A tools/list result or the whole JSON-RPC response; add prompts and resources to compare them too.
                  </p>
                  {pasteErrors[key] && <div id={fieldId(`${key}-error`)} className="invalid-feedback d-block">{pasteErrors[key]}</div>}
                </div>
              ))}
            </div>
            <div className="breaking-changes-actions">
              <button type="submit" className="btn btn-primary">Compare</button>
              <button type="button" className="btn btn-outline-secondary" onClick={loadExample}>Load an example</button>
            </div>
          </form>
        ) : (
          <form className="breaking-changes-live" onSubmit={(event) => void checkLive(event)} noValidate>
            <label htmlFor={fieldId('endpoint')} className="form-label">MCP endpoint URL</label>
            <input
              id={fieldId('endpoint')}
              type="url"
              inputMode="url"
              autoComplete="url"
              spellCheck={false}
              className={`form-control${liveError ? ' is-invalid' : ''}`}
              placeholder="https://mcp.example.com/mcp"
              value={endpoint}
              onChange={(event) => setEndpoint(event.target.value)}
              aria-describedby={`${fieldId('endpoint-hint')}${liveError ? ` ${fieldId('live-error')}` : ''}`}
            />
            <p id={fieldId('endpoint-hint')} className="breaking-changes-hint">
              The endpoint is listed from your browser without credentials. For a server that requires authorization,
              connect in the playground and paste its tools/list instead.
            </p>
            <fieldset className="mt-3">
              <legend className="form-label fs-6">Compare against</legend>
              <div className="form-check">
                <input
                  className="form-check-input"
                  type="radio"
                  id={fieldId('baseline-published')}
                  name={fieldId('baseline')}
                  checked={baseline === 'published'}
                  onChange={() => setBaseline('published')}
                />
                <label className="form-check-label" htmlFor={fieldId('baseline-published')}>Its latest published report</label>
              </div>
              <div className="form-check">
                <input
                  className="form-check-input"
                  type="radio"
                  id={fieldId('baseline-browser')}
                  name={fieldId('baseline')}
                  checked={baseline === 'browser'}
                  onChange={() => setBaseline('browser')}
                />
                <label className="form-check-label" htmlFor={fieldId('baseline-browser')}>The last connection saved in this browser</label>
              </div>
            </fieldset>
            {liveError && <div id={fieldId('live-error')} className="invalid-feedback d-block" role="alert">{liveError}</div>}
            <div className="breaking-changes-actions">
              <button type="submit" className="btn btn-primary" disabled={checking || !endpoint.trim()}>
                {checking ? 'Checking…' : 'Check endpoint'}
              </button>
            </div>
          </form>
        )}
      </section>

      <p className="published-reports-note">Publish a report and enable Watch weekly to get free Slack, Discord, or HTTPS webhook alerts for breaking and risky changes. Configure one destination in Published history with your removal token. <a href="/learn/which-mcp-tool-changes-break-clients#weekly-push-alerts">Learn about weekly alerts</a>.</p>

      {result && (
        <section
          ref={resultsRef}
          className="breaking-changes-section"
          aria-labelledby={fieldId('results')}
          tabIndex={-1}
        >
          <h2 id={fieldId('results')}>Results</h2>
          <p className="breaking-changes-baseline">Compared with {result.baseline}.</p>
          <BreakingChangeFindings report={result.report} idPrefix={fieldId('finding')} />
        </section>
      )}
    </div>
  );
};

export default BreakingChangesView;
