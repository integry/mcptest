import React, { useState } from 'react';
import type { CatalogServer, CatalogServerStatus, CatalogValidationTransport } from '../types/catalog';
import { checkServerLiveness, type LivenessResult } from '../utils/catalogLiveness';

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
  const transportBadges = getTransportBadges(server.transport);
  const isOffline = effectiveStatus === 'offline';

  const handleLivenessCheck = async () => {
    setIsCheckingLiveness(true);

    try {
      setLiveResult(await checkServerLiveness(server.url));
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
    <div className="card h-100">
      <div className="card-body d-flex flex-column">
        <div className="d-flex align-items-start gap-3 mb-3">
          {server.logoUrl && (
            <img
              src={server.logoUrl}
              alt={`${server.name} logo`}
              className="rounded flex-shrink-0"
              style={{ width: '48px', height: '48px', objectFit: 'contain' }}
            />
          )}
          <div className="flex-grow-1" style={{ minWidth: 0 }}>
            <div className="d-flex align-items-center justify-content-between gap-2 mb-1">
              <h5 className="mb-0 text-truncate flex-grow-1">{server.name}</h5>
              <div className="d-flex align-items-center gap-2 flex-shrink-0">
                <span
                  className={`rounded-circle flex-shrink-0 ${statusDetails.className}`}
                  style={{ width: '12px', height: '12px' }}
                  title={statusDetails.tooltip}
                  aria-label={statusDetails.tooltip}
                >
                  <span className="visually-hidden">{statusDetails.label}</span>
                </span>
                <button
                  type="button"
                  className="btn btn-sm btn-outline-secondary d-inline-flex align-items-center justify-content-center p-0"
                  style={{ width: '28px', height: '28px' }}
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

        <p className="card-text text-muted flex-grow-1">{server.description}</p>

        <div className="d-flex flex-wrap align-items-center gap-2 mb-3">
          <span className="badge bg-secondary">{server.category}</span>
          {server.requiresOAuth && (
            <span className="badge bg-secondary text-white d-inline-flex align-items-center gap-1">
              <i className="bi bi-shield-lock" aria-hidden="true"></i>
              OAuth
            </span>
          )}
          {transportBadges.map((badge) => (
            <span key={badge.label} className={`badge ${badge.className}`}>
              {badge.label}
            </span>
          ))}
        </div>

        <button
          type="button"
          className="btn btn-primary mt-auto"
          onClick={() => onTest(server)}
          disabled={isOffline}
        >
          Test in Playground
        </button>
      </div>
    </div>
  );
};

export default CatalogServerCard;
