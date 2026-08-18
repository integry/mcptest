import React from 'react';
import { Link } from 'react-router-dom';

import { getCatalogServers } from '../utils/catalogUtils';
import { getPreferredCatalogEndpoint } from '../utils/clientSetup';
import type { PreferredCatalogEndpoint } from '../utils/clientSetup';
import type { CatalogProtocolEra } from '../types/catalog';
import { CatalogServerLogo } from './CatalogServerLogo';

export interface SuggestedServerSelection {
  endpoint: PreferredCatalogEndpoint;
  protocolEra: CatalogProtocolEra;
}

export interface SuggestedServersPanelProps {
  onServerSelect: (selection: SuggestedServerSelection) => void;
  isConnected: boolean;
  isConnecting: boolean;
  showOnboardingIntro?: boolean;
}

const suggestedCatalogServers = getCatalogServers()
  .filter((server) => (
    server.tags.includes('suggested')
    && server.status !== 'offline'
    && server.authType === 'none'
    && server.browserAccess === 'direct'
    && server.browserUrl
  ))
  .slice(0, 4);

export const SuggestedServersPanel: React.FC<SuggestedServersPanelProps> = ({
  onServerSelect,
  isConnected,
  isConnecting,
  showOnboardingIntro = false,
}) => {
  const handleServerClick = (selection: SuggestedServerSelection) => {
    if (isConnecting) return;
    onServerSelect(selection);
  };

  return (
    <div className={`card mb-3 suggested-servers-panel${showOnboardingIntro ? ' suggested-servers-panel--onboarding' : ''}`}>
      {showOnboardingIntro && (
        <div className="suggested-servers-intro">
          <h2>See mcptest.io in action</h2>
          <p>Don&apos;t have a server yet? Try a public endpoint and start inspecting in one click.</p>
        </div>
      )}
      <div className="card-header">
        <div>
          <h6 className="mb-0">Suggested servers</h6>
        </div>
      </div>
      <div className="card-body p-3">
        <small className="text-muted d-block mb-3">Connect to a curated public endpoint and inspect the negotiated protocol.</small>
        <ul className="suggested-server-grid">
        {suggestedCatalogServers.map((server) => {
          const endpoint = getPreferredCatalogEndpoint(server);
          return (
          <li key={server.id} className="suggested-server-row">
            <button
              type="button"
              className="suggested-server-action"
              onClick={() => handleServerClick({ endpoint, protocolEra: server.protocolEra })}
              disabled={isConnected || isConnecting}
            >
              <CatalogServerLogo
                name={server.name}
                logoUrl={server.logoUrl}
                className="suggested-server-logo"
              />
              <div className="suggested-server-copy">
                <div className="suggested-server-title-row">
                  <strong>{server.name}</strong>
                  <span aria-hidden="true">↗</span>
                </div>
                <p>{server.description}</p>
                <small title={endpoint.url}>{endpoint.url}</small>
              </div>
            </button>
          </li>
          );
        })}
        </ul>
      </div>
      <div className="card-footer text-center p-2">
        <Link to="/catalog" className="btn btn-sm btn-link p-0" style={{ textDecoration: 'none' }}>
          Browse the full server catalog &rarr;
        </Link>
      </div>
    </div>
  );
};
