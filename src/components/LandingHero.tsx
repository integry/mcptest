import React from 'react';
import { Link } from 'react-router-dom';

import { getCatalogServers } from '../utils/catalogUtils';
import { getPreferredCatalogEndpoint } from '../utils/clientSetup';
import type { CatalogServer } from '../types/catalog';
import {
  LANDING_AUDIENCE_PATHS as AUDIENCE_PATHS,
  LANDING_CATALOG_LINK_PREFIX,
  LANDING_CATALOG_LINK_SUFFIX,
  LANDING_COVERAGE_TITLE,
  LANDING_HEADLINE,
  LANDING_LEDE,
  LANDING_PATHS_LABEL,
  LANDING_REPORT_COVERAGE as REPORT_COVERAGE,
} from '../content/landingCopy';
import { selectLandingQuickPicks } from '../utils/landingQuickPicks';
import { CatalogServerLogo } from './CatalogServerLogo';
import type { SuggestedServerSelection } from './SuggestedServersPanel';
import './LandingHero.css';

export { selectLandingQuickPicks };

export interface LandingHeroProps {
  serverUrl: string;
  onServerUrlChange: (serverUrl: string) => void;
  /**
   * Starts a connection. Manual entry calls it without a selection so the
   * entered URL is used; quick picks pass the catalog endpoint they chose.
   */
  onConnect: (selection?: SuggestedServerSelection) => void;
  isConnecting: boolean;
  quickPicks?: CatalogServer[];
  catalogCount?: number;
}

export const LandingHero: React.FC<LandingHeroProps> = ({
  serverUrl,
  onServerUrlChange,
  onConnect,
  isConnecting,
  quickPicks = selectLandingQuickPicks(getCatalogServers()),
  catalogCount = getCatalogServers().length,
}) => {
  const canConnect = Boolean(serverUrl.trim()) && !isConnecting;

  const handleManualConnect = () => {
    if (!canConnect) return;
    onConnect();
  };

  return (
    <section className="landing" aria-labelledby="landing-title">
      <div className="landing-hero">
        <h1 id="landing-title" className="landing-title">
          {LANDING_HEADLINE}
        </h1>
        <p className="landing-lede">
          {LANDING_LEDE}
        </p>

        <div className="landing-connect">
          <label htmlFor="serverUrl" className="visually-hidden">MCP endpoint URL</label>
          <input
            id="serverUrl"
            type="text"
            inputMode="url"
            autoComplete="off"
            autoCapitalize="off"
            spellCheck={false}
            className="form-control landing-connect-input"
            placeholder="https://example.com/mcp"
            value={serverUrl}
            onChange={(event) => onServerUrlChange(event.target.value)}
            onKeyDown={(event) => {
              if (event.key === 'Enter') {
                event.preventDefault();
                handleManualConnect();
              }
            }}
            disabled={isConnecting}
          />
          <button
            id="connectBtn"
            type="button"
            className="btn btn-primary landing-connect-button"
            onClick={handleManualConnect}
            disabled={!canConnect}
          >
            Connect
          </button>
        </div>

        {quickPicks.length > 0 && (
          <div className="landing-quick-picks">
            <span className="landing-quick-picks-label" id="landing-quick-picks-label">Try with</span>
            <ul aria-labelledby="landing-quick-picks-label">
              {quickPicks.map((server) => {
                const endpoint = getPreferredCatalogEndpoint(server);
                return (
                  <li key={server.id}>
                    <button
                      type="button"
                      className="landing-quick-pick"
                      data-server-id={server.id}
                      title={endpoint.url}
                      disabled={isConnecting}
                      onClick={() => onConnect({ endpoint, protocolEra: server.protocolEra })}
                    >
                      <CatalogServerLogo
                        name={server.name}
                        logoUrl={server.logoUrl}
                        className="landing-quick-pick-logo"
                      />
                      {server.name}
                    </button>
                  </li>
                );
              })}
            </ul>
          </div>
        )}
      </div>

      <nav className="landing-paths" aria-label={LANDING_PATHS_LABEL}>
        <ul>
          {AUDIENCE_PATHS.map((path) => (
            <li key={path.to}>
              <Link to={path.to} className="landing-path">
                <span className="landing-path-title">{path.title}</span>
                <span className="landing-path-description">{path.description}</span>
                <span className="landing-path-arrow" aria-hidden="true">&rarr;</span>
              </Link>
            </li>
          ))}
        </ul>
      </nav>

      <div className="landing-coverage">
        <h2 className="landing-coverage-title">{LANDING_COVERAGE_TITLE}</h2>
        <ul>
          {REPORT_COVERAGE.map((item) => (
            <li key={item}>
              <i className="bi bi-check2" aria-hidden="true"></i>
              {item}
            </li>
          ))}
        </ul>
      </div>

      <p className="landing-catalog">
        <Link to="/catalog">
          {LANDING_CATALOG_LINK_PREFIX} {catalogCount} {LANDING_CATALOG_LINK_SUFFIX} <span aria-hidden="true">&rarr;</span>
        </Link>
      </p>
    </section>
  );
};

export default LandingHero;
