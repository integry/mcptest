import React, { useEffect, useMemo, useRef, useState } from 'react';
import { Link } from 'react-router-dom';
import { checkOAuthReadiness, type OAuthCheckReport } from '../utils/oauthChecker';
import { createDiscoveryFetch, createOAuthChallengeProbe } from '../utils/discoveryFetch';
import { getServerUrl } from '../utils/urlUtils';
import { CLIENT_COMPATIBILITY } from '../data/clientCompatibility';
import { OAUTH_CHECKER_COPY as copy } from '../content/oauthCheckerCopy';
import './DiscoveryCheckerView.css';

const labels = { pass: 'Pass', fail: 'Failed', unknown: 'Unverified', skipped: 'Skipped' };
const styles = { pass: 'found', fail: 'invalid', unknown: 'unreachable', skipped: 'skipped' };
const GUIDE = '/learn/oauth-for-mcp-explained';

export default function OAuthCheckerView() {
  const [input, setInput] = useState('');
  const [report, setReport] = useState<OAuthCheckReport>();
  const [error, setError] = useState('');
  const [busy, setBusy] = useState(false);
  const id = 'oauth-endpoint';
  const active = useRef(0);
  useEffect(() => () => { active.current++; }, []);
  const fetchDocument = useMemo(() => createDiscoveryFetch({ proxyUrl: import.meta.env.VITE_PROXY_URL }), []);
  const probeEndpoint = useMemo(() => createOAuthChallengeProbe(), []);
  const run = async (event: React.FormEvent) => {
    event.preventDefault();
    const runId = ++active.current;
    setBusy(true); setError(''); setReport(undefined);
    try {
      const result = await checkOAuthReadiness(input, { fetchDocument, probeEndpoint });
      if (runId === active.current) setReport(result);
    } catch {
      if (runId === active.current) setError('Enter an HTTPS MCP endpoint without credentials, query parameters or a fragment. HTTP is allowed for localhost.');
    } finally { if (runId === active.current) setBusy(false); }
  };
  return <div className="discovery-checker">
    <header className="discovery-header"><h1>{copy.heading}</h1><p>{copy.lede}</p></header>
    <form className="discovery-form" onSubmit={run} noValidate>
      <label className="form-label" htmlFor={id}>MCP endpoint URL</label>
      <div className="discovery-form-row">
        <input className="form-control" id={id} type="url" inputMode="url" autoComplete="off" spellCheck={false}
          placeholder="https://example.com/mcp" value={input} maxLength={2048}
          aria-describedby={`${id}-hint`} aria-invalid={Boolean(error)} onChange={event => setInput(event.target.value)} />
        <button className="btn btn-primary" disabled={busy || !input.trim()}>{busy ? 'Checking…' : 'Check OAuth'}</button>
      </div>
      <p className="discovery-hint" id={`${id}-hint`}>{copy.hint}</p>
    </form>
    <p className="discovery-hint"><Link className="text-decoration-underline" to={GUIDE}>How MCP OAuth discovery works, step by step</Link></p>
    {busy && <p role="status">Checking OAuth discovery…</p>}
    {error && <p role="alert">{error}</p>}
    {report && <div aria-live="polite">
      <h2>{report.verdict}</h2>
      <p>Classification: {report.classification}. Metadata readiness does not prove that registration, the login page, callbacks or token exchange will succeed.</p>
      {report.providerNote && <p className="alert alert-info">{report.providerNote}</p>}
      <p><a className="btn btn-outline-primary" href={getServerUrl(report.endpoint)}>Open in inspector</a></p>
      <ol className="discovery-rows">
        {report.rows.map(row => <li className={`discovery-row is-${styles[row.status]}`} key={row.id} data-testid={`oauth-${row.id}`}>
          <div className="discovery-row-head"><span className={`discovery-status is-${styles[row.status]}`}>{labels[row.status]}</span><div className="discovery-row-title"><h3>{row.title}</h3></div></div>
          <p className="discovery-row-url"><code>{row.url}</code></p><p>{row.evidence}</p>
          {row.fix && <p><strong>Guidance: </strong>{row.fix} <Link className="text-decoration-underline" to={`${GUIDE}#read-only-oauth-checks-and-fixes`}>Examples and fixes</Link></p>}
        </li>)}
      </ol>
      <section className="discovery-section"><h2>Client redirect URIs</h2>
        <p>Compare these documented callbacks with your provider allow-list. The checker cannot inspect that configuration.</p>
        <ul>
          <li>mcptest: <code>https://mcptest.io/oauth/callback</code></li>
          {CLIENT_COMPATIBILITY.clients.filter(client => ['claude-ai', 'chatgpt', 'vscode-copilot', 'cursor'].includes(client.id)).map(client =>
            <li key={client.id}><Link className="text-decoration-underline" to={client.guidePath}>{client.name}</Link>: {(Array.isArray(client.oauthCallbacks.value) ? client.oauthCallbacks.value : []).map(callback => <code className="me-2" key={callback.uri}>{callback.uri}</code>)} {client.oauthCallbacks.note}</li>)}
        </ul>
      </section>
      <section className="discovery-section"><h2>Fix your server</h2>
        <p><Link className="text-decoration-underline" to={`${GUIDE}#read-only-oauth-checks-and-fixes`}>TypeScript SDK, Python SDK and Cloudflare examples</Link>. See the <Link className="text-decoration-underline" to="/learn/mcp-oauth-2-1-reference#sequence-at-a-glance">OAuth reference</Link> and <Link className="text-decoration-underline" to="/learn/mcp-oauth-protected-resource-mismatch">resource mismatch guide</Link>.</p>
        <p>Provider guides: {['auth0', 'clerk', 'workos-authkit', 'stytch'].map((provider, index) => <React.Fragment key={provider}>{index > 0 && ', '}<Link className="text-decoration-underline" to={`/learn/secure-remote-mcp-server-with-${provider}`}>{provider}</Link></React.Fragment>)}.</p>
      </section>
    </div>}
  </div>;
}
