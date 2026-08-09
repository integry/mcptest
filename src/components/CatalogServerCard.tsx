import React, { useState } from 'react';
import { Link } from 'react-router-dom';
import type { CatalogServer, CatalogServerStatus, CatalogValidationTransport } from '../types/catalog';
import { checkServerLiveness, type LivenessResult } from '../utils/catalogLiveness';
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
        className: 'bg-success',
        tooltip: `Online. ${validationTime}`,
      };
    case 'offline':
      return {
        label: 'Offline',
        className: 'bg-danger',
        tooltip: `Offline. ${validationTime}`,
      };
    case 'unknown':
    default:
      return {
        label: 'Unknown',
        className: 'bg-secondary',
        tooltip: `Status unknown. ${validationTime}`,
      };
  }
};

const getTransportBadges = (transport: CatalogValidationTransport) => {
  switch (transport) {
    case 'streamable-http':
      return [{ label: 'HTTP', className: 'bg-success' }];
    case 'legacy-sse':
      return [{ label: 'SSE', className: 'bg-primary' }];
    case 'both':
      return [
        { label: 'HTTP', className: 'bg-success' },
        { label: 'SSE', className: 'bg-primary' },
      ];
    case 'unknown':
    default:
      return [{ label: 'Unknown transport', className: 'bg-secondary' }];
  }
};

const getAuthBadgeClass = (authType: CatalogServer['authType']) => {
  return authType === 'none' ? 'bg-secondary' : 'bg-dark';
};

export const CatalogServerCard: React.FC<CatalogServerCardProps> = ({ server, onTest }) => {
  const [isCheckingLiveness, setIsCheckingLiveness] = useState(false);
  const [liveResult, setLiveResult] = useState<LivenessResult | null>(null);
  const effectiveStatus = liveResult?.status ?? server.status;
  const statusDetails = liveResult
    ? {
        ...getStatusDetails(liveResult.status),
        tooltip: liveResult.authChallenge
          ? `${liveResult.detail} Auth challenge detected.`
          : liveResult.detail,
      }
    : getStatusDetails(server.status, server.checkedAt);
  const transportIsDeclaredOnly = server.transport === 'unknown';
  const transportBadges = getTransportBadges(getEffectiveCatalogTransport(server));
  const isOffline = effectiveStatus === 'offline';

  const handleLivenessCheck = async () => {
    setIsCheckingLiveness(true);

    try {
      setLiveResult(await checkServerLiveness(server.validatedUrl || server.url));
    } catch (error) {
      const message = error instanceof Error ? error.message : 'Unexpected liveness check failure';
      setLiveResult({
        status: 'unknown',
        authChallenge: false,
        detail: `Live browser probe failed unexpectedly: ${message}.`,
      });
    } finally {
      setIsCheckingLiveness(false);
    }
  };

  return (
    <div className="card h-100 catalog-server-card">
      <div className="card-body d-flex flex-column">
        <div className="d-flex align-items-start gap-3 mb-3">
          {server.logoUrl && (
            <img
              src={server.logoUrl}
              alt={`${server.name} logo`}
              className="catalog-server-logo flex-shrink-0"
            />
          )}
          <div className="flex-grow-1" style={{ minWidth: 0 }}>
            <div className="d-flex align-items-center justify-content-between gap-2 mb-1">
              <h5 className="mb-0 text-truncate flex-grow-1">
                <Link className="catalog-server-title" to={getCatalogServerPath(server.id)}>
                  {server.name}
                </Link>
              </h5>
              <div className="d-flex align-items-center gap-2 flex-shrink-0">
                <span
                  className={`catalog-status-dot rounded-circle flex-shrink-0 ${statusDetails.className}`}
                  title={statusDetails.tooltip}
                  aria-label={statusDetails.tooltip}
                >
                  <span className="visually-hidden">{statusDetails.label}</span>
                </span>
                <button
                  type="button"
                  className="catalog-refresh btn btn-sm btn-outline-secondary d-inline-flex align-items-center justify-content-center p-0"
                  onClick={handleLivenessCheck}
                  disabled={isCheckingLiveness}
                  title="Check server status now"
                  aria-label={`Check live status for ${server.name}`}
                >
                  {isCheckingLiveness ? (
                    <span className="spinner-border spinner-border-sm" role="status" aria-hidden="true"></span>
                  ) : (
                    <i className="bi bi-arrow-clockwise" aria-hidden="true"></i>
                  )}
                </button>
              </div>
            </div>
            <div className="text-muted small text-truncate" title={server.url}>
              {server.url}
            </div>
          </div>
        </div>

        <p className="card-text catalog-server-description text-muted flex-grow-1">{server.description}</p>

        <div className="d-flex flex-wrap align-items-center gap-2 mb-3">
          <span className="badge bg-secondary">{server.category}</span>
          <span className={`badge ${getAuthBadgeClass(server.authType)} text-white d-inline-flex align-items-center gap-1`}>
            {server.authType !== 'none' && (
              <i className="bi bi-shield-lock" aria-hidden="true"></i>
            )}
            {formatCatalogAuth(server.authType)}
          </span>
          {server.protocolEra !== 'unknown' && (
            <span
              className={`badge ${server.protocolEra === 'stateful' ? 'text-bg-primary' : 'text-bg-info'}`}
              title={server.protocolVersion || undefined}
            >
              {formatProtocolEra(server.protocolEra)}
            </span>
          )}
          {transportBadges.map((badge) => (
            <span
              key={badge.label}
              className={`badge ${transportIsDeclaredOnly ? 'bg-secondary' : badge.className}`}
              title={transportIsDeclaredOnly ? 'Catalog-declared transport; live validation pending' : undefined}
            >
              {badge.label}{transportIsDeclaredOnly ? ' listed' : ''}
            </span>
          ))}
          {server.browserAccess === 'direct' && (
            <span className="badge text-bg-success" title="Verified with an in-browser MCP connection and call">
              Browser ready
            </span>
          )}
          {server.browserAccess === 'proxy-required' && (
            <span className="badge text-bg-warning" title="The server is online but does not permit a direct browser connection">
              Proxy required
            </span>
          )}
        </div>

        <div className="d-flex gap-2 mt-auto">
          <Link className="btn btn-outline-secondary flex-grow-1" to={getCatalogServerPath(server.id)}>
            View report
          </Link>
          <button
            type="button"
            className="btn btn-primary flex-grow-1"
            onClick={() => onTest(server)}
            disabled={isOffline}
          >
            Test server
          </button>
        </div>
      </div>
    </div>
  );
};

export default CatalogServerCard;
