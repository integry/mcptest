import React, { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import type { EvaluationReport } from '../utils/evaluation';
import type { OAuthTraceV1 } from '../utils/oauthTrace';
import type { PublicReport } from '../utils/reportArtifact';
import { diffPublicReports } from '../utils/reportDiff';
import { getReportUrl } from '../utils/badges';
import {
  PublishedReportError,
  createPublishableReportJson,
  deletePublishedReport,
  fetchPublishedReport,
  fetchPublishedReportIndex,
  forgetRemovalToken,
  getPublishedReportsApiBase,
  isPublishableEndpoint,
  loadRemovalTokens,
  publishReport,
  saveRemovalToken,
  type PublishReportResult,
  type PublishedReportEntry,
  type PublishedReportIndex,
  type PublishedReportSummary,
} from '../utils/publishedReports';
import ReportDiffChanges from './ReportDiffChanges';
import './PublishedReportHistory.css';

interface PublishedReportHistoryProps {
  /** The endpoint whose published history is shown; the canonical /report/<endpoint> target. */
  endpoint?: string;
  /** The current run; enables "Publish report" when present. */
  report?: EvaluationReport | null;
  oauthTrace?: OAuthTraceV1;
  canPublish?: boolean;
  /** Called with the published endpoint once snapshots exist, or null when none do. */
  onPublishedStateChange?: (publishedEndpoint: string | null) => void;
}

const RELEASE_LABELS: Record<NonNullable<PublishedReportSummary['releaseStatus']>, string> = {
  ready: 'Ready to ship',
  blocked: 'Blocked',
  review: 'Needs review',
  'authorization-required': 'Authorization required',
  unknown: 'Unknown',
};

export const describePublishedSummary = (summary: PublishedReportSummary): string => {
  if (summary.status === 'scored') {
    const release = summary.releaseStatus ? RELEASE_LABELS[summary.releaseStatus] : 'Scored';
    return typeof summary.scorePercentage === 'number'
      ? `${release} · ${Math.round(summary.scorePercentage)}% score`
      : release;
  }
  if (summary.status === 'authorization-required') return 'Authorization required, not scored';
  return `${summary.status.charAt(0).toUpperCase()}${summary.status.slice(1)}, not scored`;
};

const formatDate = (value: string): string => {
  const time = Date.parse(value);
  return Number.isNaN(time) ? value : new Date(time).toLocaleString();
};

const errorMessage = (error: unknown): string => {
  if (error instanceof PublishedReportError) return error.message;
  return error instanceof Error ? error.message : 'Unknown error';
};

const copyText = async (value: string): Promise<boolean> => {
  if (typeof navigator === 'undefined' || typeof navigator.clipboard?.writeText !== 'function') return false;
  try {
    await navigator.clipboard.writeText(value);
    return true;
  } catch {
    return false;
  }
};

/**
 * Published history for an endpoint: the latest stored run, every retained
 * snapshot with its permalink, a semantic diff between any two snapshots, and
 * the anonymous "Publish report" action with its one-time removal token.
 */
const PublishedReportHistory: React.FC<PublishedReportHistoryProps> = ({
  endpoint,
  report,
  oauthTrace,
  canPublish = true,
  onPublishedStateChange,
}) => {
  const apiBase = getPublishedReportsApiBase();
  const [index, setIndex] = useState<PublishedReportIndex | undefined>();
  const [loading, setLoading] = useState(false);
  const [loadError, setLoadError] = useState<string | null>(null);
  const [publishing, setPublishing] = useState(false);
  const [publishError, setPublishError] = useState<string | null>(null);
  const [publishResult, setPublishResult] = useState<PublishReportResult | null>(null);
  const [removalTokens, setRemovalTokens] = useState<Record<string, string>>({});
  const [artifacts, setArtifacts] = useState<Record<string, PublicReport>>({});
  const [compare, setCompare] = useState<{ before: string; after: string } | null>(null);
  const [diffError, setDiffError] = useState<string | null>(null);
  const [copied, setCopied] = useState<string | null>(null);
  const [copyFailed, setCopyFailed] = useState(false);
  const requestVersion = useRef(0);

  const publishable = Boolean(apiBase && endpoint && isPublishableEndpoint(endpoint));

  const loadIndex = useCallback(async (target: string) => {
    const version = requestVersion.current + 1;
    requestVersion.current = version;
    setLoading(true);
    setLoadError(null);
    try {
      const loaded = await fetchPublishedReportIndex(target);
      if (requestVersion.current !== version) return;
      setIndex(loaded);
    } catch (error) {
      if (requestVersion.current !== version) return;
      setIndex(undefined);
      setLoadError(`Published history could not be loaded: ${errorMessage(error)}`);
    } finally {
      if (requestVersion.current === version) setLoading(false);
    }
  }, []);

  useEffect(() => {
    setIndex(undefined);
    setPublishResult(null);
    setPublishError(null);
    setCompare(null);
    setArtifacts({});
    if (!publishable || !endpoint) return;
    void loadIndex(endpoint);
  }, [endpoint, publishable, loadIndex]);

  useEffect(() => {
    try {
      setRemovalTokens(loadRemovalTokens(window.localStorage));
    } catch {
      setRemovalTokens({});
    }
  }, []);

  const snapshots = useMemo(() => index?.snapshots ?? [], [index]);

  useEffect(() => {
    if (!onPublishedStateChange || !publishable) return;
    if (index === undefined) return;
    onPublishedStateChange(snapshots.length > 0 ? index.endpoint : null);
  }, [index, snapshots, publishable, onPublishedStateChange]);

  // Default comparison: the newest snapshot against the one before it.
  useEffect(() => {
    if (snapshots.length < 2) {
      setCompare(null);
      return;
    }
    setCompare((current) => {
      const ids = new Set(snapshots.map((entry) => entry.id));
      if (current && ids.has(current.before) && ids.has(current.after)) return current;
      return { before: snapshots[1].id, after: snapshots[0].id };
    });
  }, [snapshots]);

  useEffect(() => {
    if (!compare) return;
    const missing = [compare.before, compare.after].filter((id) => !artifacts[id]);
    if (missing.length === 0) return;
    let cancelled = false;
    setDiffError(null);
    void Promise.all(missing.map(async (id) => [id, await fetchPublishedReport(id)] as const))
      .then((loaded) => {
        if (cancelled) return;
        setArtifacts((current) => ({ ...current, ...Object.fromEntries(loaded) }));
      })
      .catch((error: unknown) => {
        if (!cancelled) setDiffError(`The snapshots could not be compared: ${errorMessage(error)}`);
      });
    return () => {
      cancelled = true;
    };
  }, [compare, artifacts]);

  const diff = useMemo(() => {
    if (!compare) return undefined;
    const before = artifacts[compare.before];
    const after = artifacts[compare.after];
    return before && after ? diffPublicReports(before, after) : undefined;
  }, [compare, artifacts]);

  const copy = async (key: string, value: string) => {
    const ok = await copyText(value);
    setCopied(ok ? key : null);
    setCopyFailed(!ok);
  };

  const handlePublish = async () => {
    if (!report || !endpoint) return;
    setPublishing(true);
    setPublishError(null);
    setPublishResult(null);
    try {
      const result = await publishReport(createPublishableReportJson(report, oauthTrace));
      setPublishResult(result);
      if (result.removalToken) {
        try {
          saveRemovalToken(result.id, result.removalToken, window.localStorage);
          setRemovalTokens((current) => ({ ...current, [result.id]: result.removalToken as string }));
        } catch {
          // The token is still shown once on the page.
        }
      }
      await loadIndex(endpoint);
    } catch (error) {
      setPublishError(`The report could not be published: ${errorMessage(error)}`);
    } finally {
      setPublishing(false);
    }
  };

  const handleDelete = async (entry: PublishedReportEntry) => {
    const token = removalTokens[entry.id];
    if (!token || !endpoint) return;
    if (!window.confirm('Remove this published snapshot from mcptest.io? Its permalink will stop working.')) return;
    setPublishError(null);
    try {
      await deletePublishedReport(entry.id, token);
      try {
        forgetRemovalToken(entry.id, window.localStorage);
      } catch {
        // Keeping a stale token is harmless.
      }
      setRemovalTokens(({ [entry.id]: _removed, ...rest }) => rest);
      if (publishResult?.id === entry.id) setPublishResult(null);
      await loadIndex(endpoint);
    } catch (error) {
      setPublishError(`The snapshot could not be removed: ${errorMessage(error)}`);
    }
  };

  if (!publishable || !endpoint) return null;

  const latest = snapshots[0];
  const canonicalUrl = getReportUrl(index?.endpoint ?? endpoint);
  const permalink = (entry: PublishedReportEntry) => `${apiBase}/r/${entry.id}`;

  return (
    <section className="release-section published-reports" aria-labelledby="published-reports-title">
      <div className="release-section-heading published-reports-heading">
        <div>
          <h3 id="published-reports-title">Published history</h3>
          <p>
            Published snapshots are stored on mcptest.io for this endpoint and shared by permalink;
            the newest {index?.retention ?? 20} redacted runs are kept. Publishing is anonymous and
            sends only the redacted public artifact.
          </p>
        </div>
        <div className="published-reports-actions">
          <button
            type="button"
            className="btn btn-outline-secondary"
            onClick={() => void copy('report-link', canonicalUrl)}
          >
            <i className={`bi ${copied === 'report-link' ? 'bi-check2' : 'bi-link-45deg'} me-2`} aria-hidden="true"></i>
            {copied === 'report-link' ? 'Link copied' : 'Copy report link'}
          </button>
          {report && (
            <button
              type="button"
              className="btn btn-primary"
              onClick={() => void handlePublish()}
              disabled={publishing || !canPublish}
            >
              <i className="bi bi-cloud-upload me-2" aria-hidden="true"></i>
              {publishing ? 'Publishing...' : 'Publish report'}
            </button>
          )}
        </div>
      </div>

      {copyFailed && (
        <p className="published-reports-note" role="status">
          Copying is not available in this browser. Select the text and copy it manually.
        </p>
      )}
      {publishError && <div className="alert alert-danger" role="alert">{publishError}</div>}
      {loadError && <div className="alert alert-warning" role="alert">{loadError}</div>}

      {publishResult && (
        <div className="published-result" role="status">
          <p className="published-result-title">
            <i className="bi bi-check-circle me-2" aria-hidden="true"></i>
            {publishResult.deduplicated
              ? 'An identical run was already published; its permalink is unchanged.'
              : 'Report published.'}
            {' '}Permalink: <a href={publishResult.url} target="_blank" rel="noopener noreferrer">{publishResult.url}</a>
          </p>
          {publishResult.removalToken && (
            <div className="published-token">
              <label htmlFor="published-removal-token">
                Removal token. It is shown once and kept only in this browser; save it to delete this snapshot later.
              </label>
              <div className="published-token-row">
                <input
                  id="published-removal-token"
                  className="form-control"
                  readOnly
                  value={publishResult.removalToken}
                  onFocus={(event) => event.currentTarget.select()}
                  spellCheck={false}
                />
                <button
                  type="button"
                  className="btn btn-outline-secondary"
                  onClick={() => void copy('token', publishResult.removalToken as string)}
                >
                  {copied === 'token' ? 'Copied' : 'Copy token'}
                </button>
              </div>
            </div>
          )}
        </div>
      )}

      {loading && !index && (
        <p className="published-reports-note" role="status">Loading published history...</p>
      )}

      {index && snapshots.length === 0 && !loading && (
        <p className="published-reports-note">
          No published runs for this endpoint yet.
          {report ? ' Publish this report to create the first permalink and a live badge.' : ''}
        </p>
      )}

      {latest && (
        <div className={`published-latest published-latest-${latest.summary.releaseStatus ?? latest.summary.status}`}>
          <div>
            <span className="published-latest-label">Latest published run</span>
            <h4>{describePublishedSummary(latest.summary)}</h4>
            <p>
              Published {formatDate(latest.createdAt)}
              {latest.lastPublishedAt !== latest.createdAt ? `, seen again ${formatDate(latest.lastPublishedAt)}` : ''}
              {latest.summary.generatorVersion ? ` · mcptest ${latest.summary.generatorVersion}` : ''}
            </p>
          </div>
          <div className="published-latest-links">
            <a className="btn btn-sm btn-outline-secondary" href={permalink(latest)} target="_blank" rel="noopener noreferrer">
              <i className="bi bi-filetype-json me-1" aria-hidden="true"></i>JSON permalink
            </a>
          </div>
        </div>
      )}

      {snapshots.length > 0 && (
        <ol className="published-list" aria-label="Published snapshots">
          {snapshots.map((entry, position) => (
            <li className="published-item" key={entry.id}>
              <div>
                <h4>{formatDate(entry.createdAt)}{position === 0 ? ' (latest)' : ''}</h4>
                <p>{describePublishedSummary(entry.summary)}</p>
              </div>
              <div className="published-item-actions">
                <a className="btn btn-sm btn-outline-secondary" href={permalink(entry)} target="_blank" rel="noopener noreferrer">
                  Permalink
                </a>
                <button
                  type="button"
                  className="btn btn-sm btn-outline-secondary"
                  onClick={() => void copy(entry.id, permalink(entry))}
                  aria-label={`Copy permalink for snapshot from ${formatDate(entry.createdAt)}`}
                >
                  {copied === entry.id ? 'Copied' : 'Copy'}
                </button>
                {removalTokens[entry.id] && (
                  <button
                    type="button"
                    className="btn btn-sm btn-outline-danger"
                    onClick={() => void handleDelete(entry)}
                    aria-label={`Remove published snapshot from ${formatDate(entry.createdAt)}`}
                  >
                    Remove
                  </button>
                )}
              </div>
            </li>
          ))}
        </ol>
      )}

      {snapshots.length >= 2 && compare && (
        <div className="published-compare">
          <div className="published-compare-controls">
            <label>
              Compare
              <select
                className="form-select form-select-sm"
                aria-label="Earlier snapshot"
                value={compare.before}
                onChange={(event) => setCompare({ ...compare, before: event.target.value })}
              >
                {snapshots.map((entry) => (
                  <option key={entry.id} value={entry.id}>{formatDate(entry.createdAt)}</option>
                ))}
              </select>
            </label>
            <label>
              with
              <select
                className="form-select form-select-sm"
                aria-label="Later snapshot"
                value={compare.after}
                onChange={(event) => setCompare({ ...compare, after: event.target.value })}
              >
                {snapshots.map((entry) => (
                  <option key={entry.id} value={entry.id}>{formatDate(entry.createdAt)}</option>
                ))}
              </select>
            </label>
          </div>
          {diffError ? (
            <div className="alert alert-warning mb-0" role="alert">{diffError}</div>
          ) : diff ? (
            <ReportDiffChanges diff={diff} emptyMessage="No semantic drift between these snapshots." />
          ) : (
            <p className="published-reports-note" role="status">Loading snapshots to compare...</p>
          )}
        </div>
      )}
    </section>
  );
};

export default PublishedReportHistory;
