import React from 'react';
import { Link } from 'react-router-dom';
import type { CatalogServer } from '../types/catalog';
import {
  formatCatalogAuth,
  formatCatalogTimestamp,
  formatCatalogTransport,
  formatProtocolEra,
} from '../utils/catalogSeo';
import CapabilitiesProvided from './CapabilitiesProvided';
import { CatalogServerLogo } from './CatalogServerLogo';

interface ServerProfileViewProps {
  server?: CatalogServer;
  onTestServer: (server: CatalogServer) => void;
}

const formatCheckedAt = (checkedAt?: string) => {
  if (!checkedAt) {
    return 'Awaiting a recorded validation run';
  }

  const parsed = new Date(checkedAt);
  return Number.isNaN(parsed.getTime()) ? checkedAt : formatCatalogTimestamp(checkedAt);
};

const statusLabel = (server: CatalogServer) => {
  if (server.status === 'online') return 'Online when last tested';
  if (server.status === 'offline') return 'Offline when last tested';
  if (server.checkedAt) return 'Latest validation was inconclusive';
  return 'Validation pending — live status not yet verified';
};

const validationTransportNote = (server: CatalogServer) => {
  if (!server.checkedAt) return 'No validation result has been recorded';
  if (server.transport === 'unknown') return 'Latest validation did not verify a transport';
  return 'Observed by the latest catalog validation';
};

const validationDetail = (server: CatalogServer) => {
  if (server.validationMessage) return server.validationMessage;
  if (server.checkedAt) return 'The latest automated probe completed without additional validation detail.';
  return 'No automated probe result is stored yet. Use the Playground to run a fresh browser-side connection test.';
};

const authEvidenceNote = (server: CatalogServer) => {
  if (server.checkedAt && server.authType !== server.declaredAuthType) {
    return `Validation revised the declared ${formatCatalogAuth(server.declaredAuthType).toLowerCase()} method`;
  }
  if (server.checkedAt) return 'Merged from publisher metadata and the latest live probe';
  return 'Declared by the current catalog listing';
};

const browserAccessLabel = (server: CatalogServer) => {
  if (server.browserAccess === 'direct') return 'Direct browser connection verified';
  if (server.browserAccess === 'proxy-required') return 'Authenticated proxy required';
  return 'Browser access not yet measured';
};

const alternativeAuthLabel = (server: CatalogServer) => {
  const alternatives = server.alternativeAuthTypes?.map(formatCatalogAuth) ?? [];
  return alternatives.length ? `Also supports ${alternatives.join(' and ')}` : authEvidenceNote(server);
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

  const statusClass = server.status === 'online'
    ? 'server-status-online'
    : server.status === 'offline'
      ? 'server-status-offline'
      : 'server-status-unknown';

  return (
    <article className="server-profile">
      <nav aria-label="Breadcrumb" className="server-profile-breadcrumb">
        <ol className="breadcrumb mb-0">
          <li className="breadcrumb-item server-profile-breadcrumb-parent">
            <Link to="/catalog">Server Catalog</Link>
          </li>
          <li className="breadcrumb-item active server-profile-breadcrumb-current" aria-current="page">
            {server.name}
          </li>
        </ol>
      </nav>

      <header className="server-profile-hero">
        <div className="server-profile-glow" aria-hidden="true"></div>
        <div className="server-profile-identity">
          <CatalogServerLogo
            name={server.name}
            logoUrl={server.logoUrl}
            className="server-profile-logo"
          />
          <div>
            <h1>{server.name}</h1>
            <p>{server.description}</p>
          </div>
        </div>

        <div className="server-profile-actions">
          <button className="btn btn-primary server-profile-action" type="button" onClick={() => onTestServer(server)}>
            <i className="bi bi-play-fill me-1" aria-hidden="true"></i>
            Test in Playground
          </button>
          {server.homepageUrl && (
            <a className="btn btn-outline-secondary server-profile-action" href={server.homepageUrl} target="_blank" rel="noopener noreferrer">
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
          <span className="server-signal-label">Declared transport</span>
          <strong>{formatCatalogTransport(server.declaredTransport)}</strong>
          <small>Declared by the catalog source</small>
        </div>
        <div className="server-signal-card">
          <span className="server-signal-label">Live-validated transport</span>
          <strong>{formatCatalogTransport(server.transport)}</strong>
          <small>{validationTransportNote(server)}</small>
        </div>
        <div className="server-signal-card">
          <span className="server-signal-label">Authentication</span>
          <strong>{formatCatalogAuth(server.authType)}</strong>
          <small>{alternativeAuthLabel(server)}</small>
        </div>
        <div className="server-signal-card">
          <span className="server-signal-label">Protocol lifecycle</span>
          <strong>{formatProtocolEra(server.protocolEra, server.protocolVersion)}</strong>
          <small>{server.protocolEra === 'unknown' ? 'No lifecycle negotiation recorded' : 'Negotiated by the catalog validator'}</small>
        </div>
        <div className="server-signal-card">
          <span className="server-signal-label">Browser access</span>
          <strong>{browserAccessLabel(server)}</strong>
          <small>{server.browserUrl || 'Server-side validation is reported separately'}</small>
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
                <h2>How to connect</h2>
              </div>
            </div>

            <dl className="server-spec-list server-connection-specs">
              <div>
                <dt>Remote endpoint</dt>
                <dd><code className="technical-string technical-string-url">{server.url}</code></dd>
              </div>
              {server.validatedUrl && server.validatedUrl !== server.url && (
                <div>
                  <dt>Live-validated endpoint</dt>
                  <dd><code className="technical-string technical-string-url">{server.validatedUrl}</code></dd>
                </div>
              )}
              {server.browserUrl && server.browserUrl !== server.validatedUrl && (
                <div>
                  <dt>Browser-verified endpoint</dt>
                  <dd><code className="technical-string technical-string-url">{server.browserUrl}</code></dd>
                </div>
              )}
              <div>
                <dt>Declared MCP transport</dt>
                <dd>{formatCatalogTransport(server.declaredTransport)}</dd>
              </div>
              <div>
                <dt>Live-validated MCP transport</dt>
                <dd>{formatCatalogTransport(server.transport)}</dd>
              </div>
              <div>
                <dt>Credential flow</dt>
                <dd>{formatCatalogAuth(server.authType)}</dd>
              </div>
              {server.alternativeAuthTypes?.map((authType) => (
                <div key={authType}>
                  <dt>Alternative credential</dt>
                  <dd>{formatCatalogAuth(authType)}</dd>
                </div>
              ))}
              {server.alternativeEndpoints?.map((endpoint) => (
                <div key={endpoint.url}>
                  <dt>Alternative endpoint</dt>
                  <dd>
                    <code className="technical-string technical-string-url">{endpoint.url}</code>
                    {' — '}{endpoint.description}
                    {endpoint.authType ? ` (${formatCatalogAuth(endpoint.authType)})` : ''}
                  </dd>
                </div>
              ))}
              <div>
                <dt>Protocol lifecycle</dt>
                <dd>{formatProtocolEra(server.protocolEra, server.protocolVersion)}</dd>
              </div>
              <div>
                <dt>Client environment</dt>
                <dd>{browserAccessLabel(server)}</dd>
              </div>
            </dl>

            <div className="server-endpoint-box">
              <div>
                <span>Endpoint</span>
                <code className="technical-string technical-string-url">
                  {server.browserUrl || server.validatedUrl || server.url}
                </code>
              </div>
              <button
                type="button"
                className="btn btn-sm btn-ghost server-endpoint-copy"
                onClick={() => navigator.clipboard?.writeText(server.browserUrl || server.validatedUrl || server.url)}
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
              {validationDetail(server)}
            </p>
            <button className="btn btn-outline-primary w-100" type="button" onClick={() => onTestServer(server)}>
              Run a compatibility test
            </button>
          </div>
        </aside>
      </div>

      {server.capabilityInventory && (
        <section className="card server-profile-section" aria-labelledby="server-capabilities-title">
          <div className="card-body">
            <CapabilitiesProvided
              inventory={server.capabilityInventory}
              serverName={server.name}
              titleId="server-capabilities-title"
              titleLevel={2}
            />
          </div>
        </section>
      )}

      <section className="card server-profile-section">
        <div className="card-body">
          <div className="server-section-heading">
            <span className="server-section-icon"><i className="bi bi-braces-asterisk" aria-hidden="true"></i></span>
            <div>
              <h2>Server context</h2>
            </div>
          </div>
          <div className="d-flex flex-wrap gap-2 mb-4">
            {server.tags.map((tag) => <span className="server-tag" key={tag}>{tag}</span>)}
          </div>
          <div className="d-flex flex-wrap gap-3">
            {server.homepageUrl && <a href={server.homepageUrl} target="_blank" rel="noopener noreferrer">Product documentation <i className="bi bi-arrow-up-right"></i></a>}
            {server.sourceUrl && <a href={server.sourceUrl} target="_blank" rel="noopener noreferrer">Source repository <i className="bi bi-arrow-up-right"></i></a>}
            {server.listingSource.url && server.listingSource.url !== server.homepageUrl && <a href={server.listingSource.url} target="_blank" rel="noopener noreferrer">Official listing documentation <i className="bi bi-arrow-up-right"></i></a>}
            {server.registryUrl && <a href={server.registryUrl} target="_blank" rel="noopener noreferrer">Official MCP Registry record <i className="bi bi-arrow-up-right"></i></a>}
            <Link to="/docs/testing-guide">MCP testing guide <i className="bi bi-arrow-right"></i></Link>
          </div>
          {(server.requiredHeaders?.length || server.authorizationServers?.length) ? (
            <dl className="server-spec-list mt-4 mb-0">
              {server.requiredHeaders?.map((header) => (
                <div key={header.name}>
                  <dt>Required header</dt>
                  <dd>
                    <code className="technical-string technical-string-inline">{header.name}</code>
                    {header.description ? ` — ${header.description}` : ''}
                  </dd>
                </div>
              ))}
              {server.authorizationServers?.map((issuer) => (
                <div key={issuer}>
                  <dt>Authorization server</dt>
                  <dd><code className="technical-string technical-string-url">{issuer}</code></dd>
                </div>
              ))}
            </dl>
          ) : null}
          {server.caveats?.length ? (
            <div className="mt-4">
              <h3 className="h6">Provider guidance</h3>
              <ul className="mb-0">
                {server.caveats.map((caveat) => <li key={caveat}>{caveat}</li>)}
              </ul>
            </div>
          ) : null}
        </div>
      </section>
    </article>
  );
};

export default ServerProfileView;
