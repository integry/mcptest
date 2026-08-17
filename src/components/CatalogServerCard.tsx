import React from 'react';
import { Link } from 'react-router-dom';
import type { CatalogServer, CatalogServerStatus, CatalogValidationTransport } from '../types/catalog';
import {
  formatCatalogAuth,
  formatProtocolEra,
  getCatalogServerPath,
  getEffectiveCatalogTransport,
} from '../utils/catalogSeo';

export interface CatalogServerCardProps {
  server: CatalogServer;
  onTest: (server: CatalogServer) => void;
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
        label: 'Online',
        className: 'catalog-status-dot--online',
        tooltip: `Online. ${validationTime}`,
      };
    case 'offline':
      return {
        label: 'Offline',
        className: 'catalog-status-dot--offline',
        tooltip: `Offline. ${validationTime}`,
      };
    case 'unknown':
    default:
      return {
        label: 'Unknown',
        className: 'catalog-status-dot--unknown',
        tooltip: `Status unknown. ${validationTime}`,
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

export const CatalogServerCard: React.FC<CatalogServerCardProps> = ({ server, onTest }) => {
  const statusDetails = getStatusDetails(server.status, server.checkedAt);
  const transportIsDeclaredOnly = server.transport === 'unknown';
  const transportLabels = getTransportLabels(getEffectiveCatalogTransport(server));
  const isOffline = server.status === 'offline';

  return (
    <div className="card h-100 catalog-server-card">
      <div className="card-body d-flex flex-column">
        <div className="catalog-server-main">
          <div className="d-flex align-items-start gap-3 mb-3">
            {server.logoUrl && (
              <img
                src={server.logoUrl}
                alt={`${server.name} logo`}
                className="catalog-server-logo flex-shrink-0"
              />
            )}
            <div className="catalog-server-heading">
              <div className="catalog-server-title-row d-flex align-items-center justify-content-between gap-2 mb-1">
                <h5 className="mb-0 text-truncate flex-grow-1">
                  <Link
                    className="catalog-server-title stretched-link"
                    to={getCatalogServerPath(server.id)}
                  >
                    {server.name}
                  </Link>
                </h5>
                <span
                  className={`catalog-status-dot rounded-circle flex-shrink-0 ${statusDetails.className}`}
                  title={statusDetails.tooltip}
                  aria-label={statusDetails.tooltip}
                >
                  <span className="visually-hidden">{statusDetails.label}</span>
                </span>
              </div>
              <p className="catalog-server-url text-muted small text-truncate mb-0" title={server.url}>
                {server.url}
              </p>
            </div>
          </div>

          <p className="card-text catalog-server-description">{server.description}</p>
        </div>

        <div className="catalog-server-footer mt-auto">
          <Link
            className="catalog-server-badges d-flex flex-wrap align-items-center mb-3"
            to={getCatalogServerPath(server.id)}
            aria-label={`View ${server.name} report`}
          >
            <span className="badge catalog-metadata-badge catalog-metadata-badge--category">
              {server.category}
            </span>
            <span className="badge catalog-metadata-badge catalog-metadata-badge--auth">
              {formatCatalogAuth(server.authType)}
            </span>
            {server.protocolEra !== 'unknown' && (
              <span
                className="badge catalog-metadata-badge catalog-metadata-badge--architecture"
                title={server.protocolVersion || undefined}
              >
                {formatProtocolEra(server.protocolEra)}
              </span>
            )}
            {transportLabels.map((label) => (
              <span
                key={label}
                className="badge catalog-metadata-badge catalog-metadata-badge--transport"
                title={transportIsDeclaredOnly ? 'Catalog-declared transport; live validation pending' : undefined}
              >
                {label}
              </span>
            ))}
            {server.browserAccess === 'direct' && (
              <span className="badge catalog-status-badge catalog-status-badge--verified" title="Verified with an in-browser MCP connection and call">
                Browser ready
              </span>
            )}
            {server.browserAccess === 'proxy-required' && (
              <span className="badge catalog-status-badge catalog-status-badge--warning" title="The server is online but does not permit a direct browser connection">
                Proxy required
              </span>
            )}
          </Link>

          <div className="catalog-card-actions align-items-center">
            <Link className="catalog-report-link" to={getCatalogServerPath(server.id)}>
              View report
            </Link>
            <button
              type="button"
              className="btn btn-sm btn-outline-primary catalog-test-button"
              onClick={() => onTest(server)}
              disabled={isOffline}
            >
              Test server
            </button>
          </div>
        </div>
      </div>
    </div>
  );
};

export default CatalogServerCard;
