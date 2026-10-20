import React from 'react';
import { Link } from 'react-router-dom';

import { getCatalogServers } from '../utils/catalogUtils';
import { getPreferredCatalogEndpoint } from '../utils/clientSetup';
import type { CatalogServer } from '../types/catalog';
import { CatalogServerLogo } from './CatalogServerLogo';
import type { SuggestedServerSelection } from './SuggestedServersPanel';
import './LandingHero.css';

const QUICK_PICK_LIMIT = 3;

/**
 * Catalog servers a first-time visitor can connect to with one click: online
 * or unproven (never offline), no credentials of any kind, reachable directly
 * from the browser, and carrying a real publisher logo. Servers tagged as
 * suggested keep their catalog order ahead of the rest.
 */
export const selectLandingQuickPicks = (
  servers: CatalogServer[],
  limit = QUICK_PICK_LIMIT
): CatalogServer[] => {
  const eligible = servers.filter((server) => (
    server.status !== 'offline'
    && server.authType === 'none'
    && !server.requiresOAuth
    && !server.requiredHeaders?.some(({ required }) => required !== false)
    && server.browserAccess === 'direct'
    && Boolean(server.browserUrl)
    && Boolean(server.logoUrl)
    && server.logoSourceKind !== 'generated-fallback'
  ));
  const suggested = eligible.filter((server) => server.tags.includes('suggested'));
  const others = eligible.filter((server) => !server.tags.includes('suggested'));
  return [...suggested, ...others].slice(0, limit);
};

const AUDIENCE_PATHS = [
  {
    title: 'New to MCP',
    description: 'What the Model Context Protocol is, and how remote servers differ from local ones.',
    to: '/docs/what-is-mcp',
  },
  {
    title: 'Connecting a server to Claude, ChatGPT or Cursor',
    description: 'Check that an endpoint responds and authorizes before you add it to a client.',
    to: '/learn/connect-remote-mcp-server',
  },
  {
    title: 'Building a server',
    description: 'Run the checks a client will run, and find protocol, auth and CORS problems before release.',
    to: '/docs/testing-guide',
  },
] as const;

const REPORT_COVERAGE = [
  'Protocol negotiation across MCP 2026 stateless, 2025 stateful and legacy HTTP+SSE',
  'OAuth 2.1 with PKCE, bearer tokens and API keys',
  'CORS evidence from a real browser',
  'Tool, resource and prompt contracts',
  'Shareable reports',
] as const;

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
          Inspect, debug and evaluate remote MCP servers in your browser
        </h1>
        <p className="landing-lede">
          Paste an endpoint URL to test a remote MCP server. mcptest.io negotiates the protocol,
          handles authorization, and lists its tools, resources and prompts next to the raw
          JSON-RPC traffic.
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

      <nav className="landing-paths" aria-label="Where to start">
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
        <h2 className="landing-coverage-title">What a report covers</h2>
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
          Browse {catalogCount} public remote MCP servers in the catalog <span aria-hidden="true">&rarr;</span>
        </Link>
      </p>
    </section>
  );
};

export default LandingHero;
