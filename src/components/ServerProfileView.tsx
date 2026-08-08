import React from 'react';
import { Link } from 'react-router-dom';
import type { CatalogServer } from '../types/catalog';
import {
  formatCatalogTransport,
  getEffectiveCatalogTransport,
} from '../utils/catalogSeo';

interface ServerProfileViewProps {
  server?: CatalogServer;
  onTestServer: (server: CatalogServer) => void;
}

const formatCheckedAt = (checkedAt?: string) => {
  if (!checkedAt) {
    return 'Awaiting a recorded validation run';
  }

  const parsed = new Date(checkedAt);
  return Number.isNaN(parsed.getTime()) ? checkedAt : parsed.toLocaleString();
};

const statusLabel = (server: CatalogServer) => {
  if (server.status === 'online') return 'Online when last tested';
  if (server.status === 'offline') return 'Offline when last tested';
  return 'Live status not yet verified';
};

const ServerProfileView: React.FC<ServerProfileViewProps> = ({ server, onTestServer }) => {
  if (!server) {
    return (
      <div className="server-profile-empty card">
        <div className="card-body text-center py-5">
          <div className="server-profile-empty-icon mb-3" aria-hidden="true">
            <i className="bi bi-hdd-network"></i>
          </div>
          <h1 className="h3">MCP server not found</h1>
          <p className="text-muted mb-4">
            This server report does not exist, or its catalog identifier has changed.
          </p>
          <Link className="btn btn-primary" to="/catalog">Browse the server catalog</Link>
        </div>
      </div>
    );
  }

  const effectiveTransport = getEffectiveCatalogTransport(server);
  const transportWasValidated = server.transport !== 'unknown';
  const statusClass = server.status === 'online'
    ? 'server-status-online'
    : server.status === 'offline'
      ? 'server-status-offline'
      : 'server-status-unknown';

  return (
    <article className="server-profile">
      <nav aria-label="Breadcrumb" className="server-profile-breadcrumb">
        <ol className="breadcrumb mb-0">
          <li className="breadcrumb-item"><Link to="/catalog">Server Catalog</Link></li>
          <li className="breadcrumb-item active" aria-current="page">{server.name}</li>
        </ol>
      </nav>

      <header className="server-profile-hero">
        <div className="server-profile-glow" aria-hidden="true"></div>
        <div className="server-profile-identity">
          <div className="server-profile-logo" aria-hidden={!server.logoUrl}>
            {server.logoUrl ? (
              <img src={server.logoUrl} alt={`${server.name} logo`} />
            ) : (
              <i className="bi bi-cpu"></i>
            )}
          </div>
          <div>
            <div className="server-profile-eyebrow">MCP server report</div>
            <h1>{server.name}</h1>
            <p>{server.description}</p>
          </div>
        </div>

        <div className="server-profile-actions">
          <button className="btn btn-primary" type="button" onClick={() => onTestServer(server)}>
            <i className="bi bi-play-fill me-1" aria-hidden="true"></i>
            Test in Playground
          </button>
          {server.homepageUrl && (
            <a className="btn btn-outline-secondary" href={server.homepageUrl} target="_blank" rel="noopener noreferrer">
              Product site <i className="bi bi-box-arrow-up-right ms-1" aria-hidden="true"></i>
            </a>
          )}
        </div>
      </header>

      <section className="server-profile-signal-grid" aria-label="Connection summary">
        <div className="server-signal-card">
          <span className="server-signal-label">Live status</span>
          <strong className={statusClass}><span className="server-status-dot"></span>{statusLabel(server)}</strong>
          <small>{formatCheckedAt(server.checkedAt)}</small>
        </div>
        <div className="server-signal-card">
          <span className="server-signal-label">Transport</span>
          <strong>{formatCatalogTransport(effectiveTransport)}</strong>
          <small>{transportWasValidated ? 'Observed by the catalog probe' : 'Declared by the catalog; validation pending'}</small>
        </div>
        <div className="server-signal-card">
          <span className="server-signal-label">Authentication</span>
          <strong>{server.requiresOAuth ? 'OAuth 2.1' : 'No auth declared'}</strong>
          <small>{server.requiresOAuth ? 'Interactive authorization required' : 'Connect without credentials based on current listing'}</small>
        </div>
        <div className="server-signal-card">
          <span className="server-signal-label">Category</span>
          <strong>{server.category}</strong>
          <small>{server.tags.filter((tag) => tag !== 'suggested').slice(0, 3).join(' · ')}</small>
        </div>
      </section>

      <div className="server-profile-content-grid">
        <section className="card server-profile-section">
          <div className="card-body">
            <div className="server-section-heading">
              <span className="server-section-icon"><i className="bi bi-diagram-3" aria-hidden="true"></i></span>
              <div>
                <div className="server-profile-eyebrow">Connection specification</div>
                <h2>How to connect</h2>
              </div>
            </div>

            <dl className="server-spec-list">
              <div>
                <dt>Remote endpoint</dt>
                <dd><code>{server.url}</code></dd>
              </div>
              <div>
                <dt>MCP transport</dt>
                <dd>{formatCatalogTransport(effectiveTransport)}</dd>
              </div>
              <div>
                <dt>Credential flow</dt>
                <dd>{server.requiresOAuth ? 'OAuth 2.1 authorization code flow with PKCE' : 'No authentication advertised by the catalog entry'}</dd>
              </div>
              <div>
                <dt>Client environment</dt>
                <dd>Remote MCP clients with HTTP transport support</dd>
              </div>
            </dl>

            <div className="server-endpoint-box">
              <div>
                <span>Endpoint</span>
                <code>{server.url}</code>
              </div>
              <button
                type="button"
                className="btn btn-sm btn-outline-secondary"
                onClick={() => navigator.clipboard?.writeText(server.url)}
                aria-label={`Copy ${server.name} MCP endpoint`}
              >
                <i className="bi bi-copy" aria-hidden="true"></i>
              </button>
            </div>
          </div>
        </section>

        <aside className="card server-profile-section server-validation-panel">
          <div className="card-body">
            <div className="server-section-heading">
              <span className="server-section-icon"><i className="bi bi-activity" aria-hidden="true"></i></span>
              <div>
                <div className="server-profile-eyebrow">Compatibility report</div>
                <h2>Latest evidence</h2>
              </div>
            </div>
            <div className={`server-validation-state ${statusClass}`}>
              <span className="server-status-dot"></span>
              <div>
                <strong>{statusLabel(server)}</strong>
                <span>{formatCheckedAt(server.checkedAt)}</span>
              </div>
            </div>
            <p className="text-muted small mb-3">
              {server.validationMessage || 'No automated probe result is stored yet. Use the Playground to run a fresh browser-side connection test.'}
            </p>
            <button className="btn btn-outline-primary w-100" type="button" onClick={() => onTestServer(server)}>
              Run a compatibility test
            </button>
          </div>
        </aside>
      </div>

      <section className="card server-profile-section">
        <div className="card-body">
          <div className="server-section-heading">
            <span className="server-section-icon"><i className="bi bi-braces-asterisk" aria-hidden="true"></i></span>
            <div>
              <div className="server-profile-eyebrow">Capabilities and references</div>
              <h2>Server context</h2>
            </div>
          </div>
          <div className="d-flex flex-wrap gap-2 mb-4">
            {server.tags.map((tag) => <span className="server-tag" key={tag}>{tag}</span>)}
          </div>
          <div className="d-flex flex-wrap gap-3">
            {server.homepageUrl && <a href={server.homepageUrl} target="_blank" rel="noopener noreferrer">Product documentation <i className="bi bi-arrow-up-right"></i></a>}
            {server.sourceUrl && <a href={server.sourceUrl} target="_blank" rel="noopener noreferrer">Source repository <i className="bi bi-arrow-up-right"></i></a>}
            <Link to="/docs/testing-guide">MCP testing guide <i className="bi bi-arrow-right"></i></Link>
          </div>
        </div>
      </section>
    </article>
  );
};

export default ServerProfileView;
