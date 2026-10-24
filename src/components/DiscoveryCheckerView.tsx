import React, { useCallback, useEffect, useId, useMemo, useRef, useState } from 'react';
import { Link, useSearchParams } from 'react-router-dom';
import {
  buildDiscoveryFixGuidance,
  checkMcpDiscovery,
  hasValidServerCard,
  normalizeDiscoveryTarget,
  type DiscoveryCatalogEntry,
  type DiscoveryFetch,
  type DiscoveryReport,
  type DiscoveryRow,
  type DiscoveryRowKind,
  type DiscoveryRowStatus,
} from '../utils/mcpDiscovery';
import { createDiscoveryFetch } from '../utils/discoveryFetch';
import { SERVER_CARD_SCHEMA_SOURCE } from '../utils/serverCardValidation';
import { getCatalogServers } from '../utils/catalogUtils';
import { getCatalogServerPath } from '../utils/catalogSeo';
import { DISCOVERY_COPY, DISCOVERY_GUIDE_PATH } from '../content/discoveryCopy';
import './DiscoveryCheckerView.css';
const SEP_2127_URL = 'https://modelcontextprotocol.io/seps/2127-mcp-server-cards';

export interface DiscoveryCheckerViewProps {
  /** Replaceable for tests. */
  fetchDocument?: DiscoveryFetch;
  catalog?: readonly DiscoveryCatalogEntry[];
  proxyUrl?: string;
}

const STATUS_LABELS: Record<DiscoveryRowStatus, string> = {
  found: 'Found',
  'not-found': 'Not found',
  invalid: 'Invalid',
  unreachable: 'Unreachable',
  skipped: 'Skipped',
};

const STATUS_ICONS: Record<DiscoveryRowStatus, string> = {
  found: 'bi-check-circle-fill',
  'not-found': 'bi-dash-circle',
  invalid: 'bi-x-circle-fill',
  unreachable: 'bi-exclamation-triangle-fill',
  skipped: 'bi-slash-circle',
};

const SECTIONS: Array<{ id: string; title: string; kinds: DiscoveryRowKind[]; description: string }> = [
  {
    id: 'cards',
    title: 'Server Cards',
    kinds: ['server-card', 'ai-catalog'],
    description: 'SEP-2127 cards at the domain-root locations clients probe, the AI Catalog the final SEP uses for domain discovery, and <endpoint>/server-card for each endpoint found.',
  },
  {
    id: 'oauth',
    title: 'OAuth metadata',
    kinds: ['oauth'],
    description: 'RFC 9728 protected resource metadata for each endpoint, and the authorization server metadata it names.',
  },
  {
    id: 'listings',
    title: 'Registry and catalog',
    kinds: ['registry', 'catalog'],
    description: 'Entries in the official MCP Registry and the mcptest.io catalog with an endpoint on this domain.',
  },
];

const defaultCatalog = (): DiscoveryCatalogEntry[] => getCatalogServers().map(server => {
  const transport = server.declaredTransport === 'legacy-sse' ? 'sse' as const : 'streamable-http' as const;
  const urls = [server.browserUrl ?? server.url, ...(server.alternativeEndpoints ?? []).map(endpoint => endpoint.url)];
  return {
    id: server.id,
    name: server.name,
    path: getCatalogServerPath(server.id),
    endpoints: Array.from(new Set(urls)).map(url => ({ url, transport })),
  };
});

const isExternal = (href: string): boolean => /^https?:\/\//.test(href);

const CopyButton: React.FC<{ text: string; label: string }> = ({ text, label }) => {
  const [copied, setCopied] = useState(false);
  useEffect(() => {
    if (!copied) return undefined;
    const timer = window.setTimeout(() => setCopied(false), 2000);
    return () => window.clearTimeout(timer);
  }, [copied]);
  return (
    <button
      type="button"
      className="btn btn-sm btn-outline-secondary discovery-copy"
      onClick={() => {
        navigator.clipboard?.writeText(text).then(() => setCopied(true), () => setCopied(false));
      }}
      aria-label={copied ? `${label} copied` : `Copy ${label}`}
    >
      <i className={`bi ${copied ? 'bi-check-lg' : 'bi-copy'}`} aria-hidden="true" />
      <span>{copied ? 'Copied' : 'Copy'}</span>
    </button>
  );
};

const CodeSample: React.FC<{ code: string; label: string }> = ({ code, label }) => (
  <div className="discovery-code">
    <CopyButton text={code} label={label} />
    <pre><code>{code}</code></pre>
  </div>
);

const RowLink: React.FC<{ href: string; children: React.ReactNode }> = ({ href, children }) => (
  isExternal(href)
    ? <a href={href} target="_blank" rel="noopener noreferrer">{children}<span className="visually-hidden"> (opens in a new tab)</span></a>
    : <Link to={href}>{children}</Link>
);

const DiscoveryRowItem: React.FC<{ row: DiscoveryRow }> = ({ row }) => (
  <li className={`discovery-row is-${row.status}`} data-testid={`discovery-row-${row.id}`} data-status={row.status}>
    <div className="discovery-row-head">
      <span className={`discovery-status is-${row.status}`}>
        <i className={`bi ${STATUS_ICONS[row.status]}`} aria-hidden="true" />
        {STATUS_LABELS[row.status]}
      </span>
      <div className="discovery-row-title">
        <h3>{row.title}</h3>
        <span className="discovery-row-source">{row.source}</span>
      </div>
    </div>
    <p className="discovery-row-url">
      <span className="visually-hidden">Fetched </span>
      <code>{row.url}</code>
    </p>
    <p className="discovery-row-summary">{row.summary}</p>
    {row.errors.length > 0 && (
      <ul className="discovery-row-errors" aria-label="Problems">
        {row.errors.map(error => <li key={error}>{error}</li>)}
      </ul>
    )}
    {row.warnings.length > 0 && (
      <ul className="discovery-row-warnings" aria-label="Warnings">
        {row.warnings.map(warning => <li key={warning}>{warning}</li>)}
      </ul>
    )}
    {row.links.length > 0 && (
      <ul className="discovery-row-links">
        {row.links.map(link => <li key={link.href}><RowLink href={link.href}>{link.label}</RowLink></li>)}
      </ul>
    )}
    {(row.attempts.length > 0 || row.preview) && (
      <details className="discovery-row-details">
        <summary>Requests{row.preview ? ' and response' : ''}</summary>
        {row.attempts.length > 0 && (
          <ul className="discovery-attempts">
            {row.attempts.map((attempt, index) => (
              <li key={`${attempt.url}-${index}`}>
                <code>GET {attempt.url}</code>
                {' '}
                {attempt.status !== undefined
                  ? `HTTP ${attempt.status}${attempt.contentType ? `, ${attempt.contentType}` : ''}`
                  : `failed (${attempt.failure ?? 'network'})`}
                {attempt.route === 'proxy' ? ', through the mcptest proxy' : attempt.route === 'direct' ? ', from your browser' : ''}
              </li>
            ))}
          </ul>
        )}
        {row.preview && <pre className="discovery-preview"><code>{row.preview}</code></pre>}
      </details>
    )}
  </li>
);

const FixGuidance: React.FC<{ report: DiscoveryReport }> = ({ report }) => {
  const guidance = useMemo(() => buildDiscoveryFixGuidance(report), [report]);
  return (
    <section className="discovery-section discovery-fix" aria-labelledby="discovery-fix-heading">
      <h2 id="discovery-fix-heading">Publish a Server Card for {report.domain}</h2>
      <p>
        No valid Server Card was found. This is the smallest card that passes the schema
        {guidance.endpointKnown
          ? <> for the endpoint found above, <code>{guidance.endpoint}</code>.</>
          : <>; replace <code>{guidance.endpoint}</code> with your MCP endpoint.</>}
        {' '}Change <code>name</code>, <code>version</code> and <code>description</code> to match what your server reports.
      </p>
      <ol className="discovery-fix-steps">
        <li>
          <p>
            Serve the card at <code>{guidance.cardUrl}</code> (the location SEP-2127 reserves:
            your endpoint URL plus <code>/server-card</code>) with
            {' '}<code>Content-Type: {guidance.cardContentType}</code>.
          </p>
          <CodeSample code={guidance.card} label="server card JSON" />
        </li>
        <li>
          <p>
            List it in an AI Catalog at <code>{guidance.catalogUrl}</code>, served with
            {' '}<code>Content-Type: {guidance.catalogContentType}</code>, so clients find the card from the domain alone.
          </p>
          <CodeSample code={guidance.catalog} label="AI Catalog JSON" />
        </li>
        <li>
          <p>Send these headers on both documents, so browser-based clients can read them:</p>
          <CodeSample code={guidance.headers} label="response headers" />
        </li>
      </ol>
      <p className="discovery-hint">
        Some clients and extensions still probe the draft location <code>{report.origin}/.well-known/mcp/server-card.json</code>;
        serving the same card there as well does no harm. Then publish the server to the
        {' '}<a href="https://github.com/modelcontextprotocol/registry" target="_blank" rel="noopener noreferrer">official MCP Registry<span className="visually-hidden"> (opens in a new tab)</span></a>.
        {' '}The <Link to={DISCOVERY_GUIDE_PATH}>discoverability guide</Link> walks through each step.
      </p>
    </section>
  );
};

const DiscoveryCheckerView: React.FC<DiscoveryCheckerViewProps> = ({
  fetchDocument,
  catalog,
  proxyUrl = import.meta.env.VITE_PROXY_URL as string | undefined,
}) => {
  const [searchParams, setSearchParams] = useSearchParams();
  const queryDomain = searchParams.get('domain') ?? '';
  const [input, setInput] = useState(queryDomain);
  const [inputError, setInputError] = useState<string>();
  const [report, setReport] = useState<DiscoveryReport>();
  const [checkError, setCheckError] = useState<string>();
  const [checking, setChecking] = useState(false);
  const runId = useRef(0);
  const fieldId = useId();

  const fetcher = useMemo(
    () => fetchDocument ?? createDiscoveryFetch({ proxyUrl }),
    [fetchDocument, proxyUrl]
  );
  const catalogEntries = useMemo(() => catalog ?? defaultCatalog(), [catalog]);

  const run = useCallback(async (domain: string) => {
    const id = ++runId.current;
    setChecking(true);
    setCheckError(undefined);
    setReport(undefined);
    try {
      const result = await checkMcpDiscovery(domain, { fetch: fetcher, catalog: catalogEntries });
      if (id === runId.current) setReport(result);
    } catch (error) {
      if (id === runId.current) setCheckError(error instanceof Error ? error.message : 'The check failed.');
    } finally {
      if (id === runId.current) setChecking(false);
    }
  }, [fetcher, catalogEntries]);

  // The domain lives in the URL, so a result is shareable and Back re-runs the previous check.
  useEffect(() => {
    setInput(queryDomain);
    if (!queryDomain) {
      runId.current++;
      setReport(undefined);
      setChecking(false);
      return;
    }
    const target = normalizeDiscoveryTarget(queryDomain);
    if ('error' in target) {
      setInputError(target.error);
      return;
    }
    setInputError(undefined);
    void run(target.domain);
  }, [queryDomain, run]);

  const submit = (event: React.FormEvent) => {
    event.preventDefault();
    const target = normalizeDiscoveryTarget(input);
    if ('error' in target) {
      setInputError(target.error);
      return;
    }
    setInputError(undefined);
    if (target.domain === queryDomain) void run(target.domain);
    else setSearchParams({ domain: target.domain });
  };

  const validCard = report ? hasValidServerCard(report) : false;

  return (
    <div className="discovery-checker">
      <header className="discovery-header">
        <h1>{DISCOVERY_COPY.heading}</h1>
        <p>{DISCOVERY_COPY.lede}</p>
      </header>

      <form className="discovery-form" onSubmit={submit} noValidate>
        <label htmlFor={`${fieldId}-domain`} className="form-label">{DISCOVERY_COPY.inputLabel}</label>
        <div className="discovery-form-row">
          <input
            id={`${fieldId}-domain`}
            type="text"
            inputMode="url"
            autoComplete="url"
            spellCheck={false}
            className={`form-control${inputError ? ' is-invalid' : ''}`}
            placeholder={DISCOVERY_COPY.placeholder}
            value={input}
            maxLength={253}
            onChange={event => { setInput(event.target.value); setInputError(undefined); }}
            aria-invalid={Boolean(inputError)}
            aria-describedby={`${fieldId}-hint${inputError ? ` ${fieldId}-error` : ''}`}
          />
          <button type="submit" className="btn btn-primary" disabled={checking || !input.trim()}>
            {checking ? 'Checking…' : DISCOVERY_COPY.submit}
          </button>
        </div>
        {inputError && <div id={`${fieldId}-error`} className="invalid-feedback d-block">{inputError}</div>}
        <p id={`${fieldId}-hint`} className="discovery-hint">
          {DISCOVERY_COPY.hint}
          {!proxyUrl && DISCOVERY_COPY.noProxyHint}
        </p>
      </form>

      {checking && (
        <div className="view-loading" role="status" aria-live="polite">
          <span className="spinner-border spinner-border-sm" aria-hidden="true" />
          <span className="ms-2">Checking {queryDomain || input}…</span>
        </div>
      )}
      {checkError && <div className="alert alert-danger" role="alert">{checkError}</div>}

      {report && (
        <div className="discovery-results" aria-live="polite">
          <section className="discovery-section discovery-endpoints" aria-labelledby="discovery-endpoints-heading">
            <h2 id="discovery-endpoints-heading">
              {report.endpoints.length === 0
                ? `No MCP endpoint advertised by ${report.domain}`
                : `${report.endpoints.length} MCP endpoint${report.endpoints.length === 1 ? '' : 's'} on ${report.domain}`}
            </h2>
            {report.endpoints.length > 0 ? (
              <ul className="discovery-endpoint-list">
                {report.endpoints.map(endpoint => (
                  <li key={endpoint.url} className="discovery-endpoint">
                    <div>
                      <code>{endpoint.url}</code>
                      <span className="discovery-endpoint-meta">
                        {endpoint.transport === 'sse' ? 'Legacy SSE' : 'Streamable HTTP'} · from {endpoint.sources.join(', ')}
                      </span>
                    </div>
                    {/* A document link: the router would collapse the endpoint's "//" in the path. */}
                    <a className="btn btn-sm btn-outline-primary" href={endpoint.inspectorPath}>
                      <i className="bi bi-terminal" aria-hidden="true" /> Test in inspector
                    </a>
                  </li>
                ))}
              </ul>
            ) : (
              <p className="discovery-hint">None of the locations below names an endpoint.</p>
            )}
            <p className="discovery-hint">
              Checked {new Date(report.checkedAt).toLocaleString()}. Server Cards are validated against the v1 schema of the
              {' '}<a href={SEP_2127_URL} target="_blank" rel="noopener noreferrer">SEP-2127<span className="visually-hidden"> (opens in a new tab)</span></a>
              {' '}extension (<a href="/schemas/server-card/v1.schema.json">vendored copy</a> of the
              {' '}<a href={SERVER_CARD_SCHEMA_SOURCE.url} target="_blank" rel="noopener noreferrer">upstream schema<span className="visually-hidden"> (opens in a new tab)</span></a>,
              retrieved {SERVER_CARD_SCHEMA_SOURCE.retrieved}).
            </p>
          </section>

          {SECTIONS.map(section => {
            const rows = report.rows.filter(row => section.kinds.includes(row.kind));
            return (
              <section key={section.id} className="discovery-section" aria-labelledby={`discovery-${section.id}-heading`}>
                <h2 id={`discovery-${section.id}-heading`}>{section.title}</h2>
                <p className="discovery-hint">{section.description}</p>
                <ul className="discovery-rows">
                  {rows.map(row => <DiscoveryRowItem key={row.id} row={row} />)}
                </ul>
              </section>
            );
          })}

          {!validCard && <FixGuidance report={report} />}
        </div>
      )}

      {!report && !checking && (
        <p className="discovery-hint discovery-guide-link">
          {DISCOVERY_COPY.guidePrompt}<Link to={DISCOVERY_GUIDE_PATH}>{DISCOVERY_COPY.guideLink}</Link>.
        </p>
      )}
    </div>
  );
};

export default DiscoveryCheckerView;
