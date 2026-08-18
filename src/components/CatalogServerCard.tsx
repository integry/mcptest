import React from 'react';
import { Link } from 'react-router-dom';
import type {
  CatalogListingSourceKind,
  CatalogServer,
  CatalogServerStatus,
  CatalogValidationTransport,
} from '../types/catalog';
import {
  formatCatalogAuth,
  formatProtocolEra,
  getCatalogServerPath,
  getEffectiveCatalogTransport,
} from '../utils/catalogSeo';
import { CatalogServerLogo } from './CatalogServerLogo';

export interface CatalogServerCardProps {
  server: CatalogServer;
  onTest: (server: CatalogServer) => void;
  onCategorySelect?: (category: string) => void;
}

const formatValidationTime = (checkedAt?: string): string => {
  if (!checkedAt) {
    return 'Last validated: never';
  }

  const checkedDate = new Date(checkedAt);
  if (Number.isNaN(checkedDate.getTime())) {
    return `Last validated: ${checkedAt}`;
  }

  return `Last validated: ${checkedDate.toLocaleString()}`;
};

const getStatusDetails = (
  status: CatalogServerStatus,
  checkedAt?: string
): { label: string; className: string; tooltip: string } => {
  const validationTime = formatValidationTime(checkedAt);

  switch (status) {
    case 'online':
      return {
        label: 'Online when last tested',
        className: 'catalog-status-dot--online',
        tooltip: `Online when last tested. ${validationTime}`,
      };
    case 'offline':
      return {
        label: 'Offline when last tested',
        className: 'catalog-status-dot--offline',
        tooltip: `Offline when last tested. ${validationTime}`,
      };
    case 'unknown':
    default:
      if (checkedAt) {
        return {
          label: 'Inconclusive when last tested',
          className: 'catalog-status-dot--unknown',
          tooltip: `Latest validation was inconclusive. ${validationTime}`,
        };
      }

      return {
        label: 'Validation pending',
        className: 'catalog-status-dot--unknown',
        tooltip: `Validation pending; live status not yet verified. ${validationTime}`,
      };
  }
};

const getTransportLabels = (transport: CatalogValidationTransport) => {
  switch (transport) {
    case 'streamable-http':
      return ['HTTP'];
    case 'legacy-sse':
      return ['SSE'];
    case 'both':
      return ['HTTP', 'SSE'];
    case 'unknown':
    default:
      return ['Unknown transport'];
  }
};

const getServerHostname = (url: string): string => {
  try {
    return new URL(url).hostname;
  } catch {
    return url;
  }
};

const getListingSourceDetails = (
  kind: CatalogListingSourceKind
): { label: string; description: string } => {
  switch (kind) {
    case 'publisher':
      return {
        label: 'Publisher',
        description: 'Listing sourced from provider-controlled documentation, site, or repository',
      };
    case 'mcp-registry':
      return {
        label: 'MCP Registry',
        description: 'Listing sourced from an official MCP Registry record; publisher identity is not proven',
      };
    case 'community':
    default:
      return {
        label: 'Community',
        description: 'Listing independently curated by the community',
      };
  }
};

export const CatalogServerCard: React.FC<CatalogServerCardProps> = ({
  server,
  onTest,
  onCategorySelect,
}) => {
  const statusDetails = getStatusDetails(server.status, server.checkedAt);
  const transportIsDeclaredOnly = server.transport === 'unknown';
  const transportLabels = getTransportLabels(getEffectiveCatalogTransport(server));
  const isOffline = server.status === 'offline';
  const hostname = getServerHostname(server.url);
  const listingSource = getListingSourceDetails(server.listingSource.kind);
  const provenanceContent = (
    <>
      {listingSource.label}
      {server.listingSource.url && (
        <i className="bi bi-box-arrow-up-right" aria-hidden="true" />
      )}
    </>
  );

  return (
    <div className="card h-100 catalog-server-card">
      <div className="card-body d-flex flex-column">
        <div className="catalog-server-main">
          <div className="d-flex align-items-start gap-3 mb-3">
            <CatalogServerLogo
              name={server.name}
              logoUrl={server.logoUrl}
              className="catalog-server-card-logo flex-shrink-0"
            />
            <div className="catalog-server-heading">
              <div className="catalog-server-title-row d-flex align-items-start justify-content-between gap-2 mb-1">
                <div className="catalog-server-name-source">
                  <h3 className="h5 mb-0">
                    <Link
                      className="catalog-server-title"
                      to={getCatalogServerPath(server.id)}
                    >
                      {server.name}
                    </Link>
                  </h3>
                  {server.listingSource.url ? (
                    <a
                      className="catalog-listing-source"
                      href={server.listingSource.url}
                      target="_blank"
                      rel="noopener noreferrer"
                      title={listingSource.description}
                      aria-label={`${listingSource.label} source for ${server.name}. ${listingSource.description}.`}
                    >
                      {provenanceContent}
                    </a>
                  ) : (
                    <span
                      className="catalog-listing-source"
                      title={listingSource.description}
                      aria-label={`${listingSource.label} source for ${server.name}. ${listingSource.description}.`}
                    >
                      {provenanceContent}
                    </span>
                  )}
                </div>
                <span
                  className="catalog-runtime-status flex-shrink-0"
                  title={statusDetails.tooltip}
                  aria-label={statusDetails.tooltip}
                >
                  <span
                    className={`catalog-status-dot rounded-circle ${statusDetails.className}`}
                    aria-hidden="true"
                  />
                  {statusDetails.label}
                </span>
              </div>
              <p
                className="catalog-server-url text-muted small text-truncate mb-0"
                title={server.url}
                aria-label={`Endpoint hostname ${hostname}. Full endpoint ${server.url}`}
              >
                {hostname}
              </p>
            </div>
          </div>

          <p className="card-text catalog-server-description">{server.description}</p>
        </div>

        <div className="catalog-server-footer mt-auto">
          <div
            className="catalog-server-badges d-flex flex-wrap align-items-center mb-2"
            role="group"
            aria-label="Server summary"
          >
            <button
              type="button"
              className="badge catalog-metadata-badge catalog-metadata-badge--category"
              onClick={() => onCategorySelect?.(server.category)}
              aria-label={`Show ${server.category} servers`}
            >
              {server.category}
            </button>
            <span className="badge catalog-metadata-badge catalog-metadata-badge--auth">
              {formatCatalogAuth(server.authType)}
            </span>
            {transportLabels.map((label) => (
              <span
                key={label}
                className="badge catalog-metadata-badge catalog-metadata-badge--transport"
                title={transportIsDeclaredOnly ? 'Catalog-declared transport; live validation pending' : undefined}
              >
                {label}
              </span>
            ))}
            {server.protocolEra !== 'unknown' && (
              <span
                className="badge catalog-metadata-badge catalog-metadata-badge--architecture"
                title={server.protocolVersion || undefined}
              >
                {formatProtocolEra(server.protocolEra)}
              </span>
            )}
          </div>

          {(server.browserAccess === 'direct' || server.browserAccess === 'proxy-required') && (
            <div
              className="catalog-browser-evidence mb-3"
              role="group"
              aria-label="Browser access evidence"
            >
              {server.browserAccess === 'direct' ? (
                <span className="badge catalog-status-badge catalog-status-badge--verified" title="Observed with an in-browser MCP connection and call">
                  Browser ready
                </span>
              ) : (
                <span className="badge catalog-status-badge catalog-status-badge--warning" title="The server was reachable but did not permit a direct browser connection">
                  Proxy required
                </span>
              )}
            </div>
          )}

          <div className="catalog-card-actions align-items-center">
            <Link className="btn btn-sm btn-primary catalog-report-link" to={getCatalogServerPath(server.id)}>
              View report
            </Link>
            <button
              type="button"
              className="btn btn-sm btn-outline-primary catalog-test-button"
              onClick={() => onTest(server)}
              disabled={isOffline}
              title={isOffline ? 'Testing is unavailable while this server is offline' : undefined}
            >
              Test in Playground
            </button>
          </div>
        </div>
      </div>
    </div>
  );
};

export default CatalogServerCard;
