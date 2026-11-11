import React, { useEffect, useState } from 'react';
import { Link } from 'react-router-dom';

import { getAnalyticsHost, trackEvent } from '../utils/analytics';
import { getCatalogServers } from '../utils/catalogUtils';
import { getPreferredCatalogEndpoint } from '../utils/clientSetup';
import type { CatalogServer } from '../types/catalog';
import {
  LANDING_AUDIENCE_PATHS as AUDIENCE_PATHS,
  LANDING_CATALOG_LINK_PREFIX,
  LANDING_CATALOG_LINK_SUFFIX,
  LANDING_COVERAGE_TITLE,
  LANDING_FAQ,
  LANDING_FAQ_TITLE,
  LANDING_HEADLINE,
  LANDING_LEDE,
  LANDING_PATHS_LABEL,
  LANDING_REPORT_COVERAGE as REPORT_COVERAGE,
  LANDING_STEPS,
  LANDING_STEPS_TITLE,
  LANDING_TRUST_LABEL,
  LANDING_TRUST_POINTS,
} from '../content/landingCopy';
import type { KeywordLandingPage } from '../content/keywordLandingPages';
import { selectLandingQuickPicks } from '../utils/landingQuickPicks';
import { CatalogServerLogo } from './CatalogServerLogo';
import type { SuggestedServerSelection } from './SuggestedServersPanel';
import { LandingText } from './LandingText';
import { KeywordLandingContent } from './KeywordLandingContent';
import './LandingHero.css';

const RECENT_SERVER_LIMIT = 6;

export { selectLandingQuickPicks };

/** The host a returning user recognises a recent endpoint by; the full URL stays in the tooltip. */
export const getRecentServerLabel = (url: string): string => {
  try {
    const parsed = new URL(/^https?:\/\//i.test(url) ? url : `https://${url}`);
    return parsed.host || url;
  } catch {
    return url;
  }
};

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
  /** A returning user's recent endpoints; when present they replace the catalog quick picks. */
  recentServers?: readonly string[];
  /** One-click reconnect for a recent endpoint, through the same connection path. */
  onConnectRecent?: (serverUrl: string) => void;
  onRemoveRecentServer?: (serverUrl: string) => void;
  /**
   * The full connection panel (headers, auth, proxy). When provided, an
   * "Advanced options" disclosure swaps it in for the simple connect row.
   */
  advancedOptions?: React.ReactNode;
  /**
   * Opens the full connection panel elsewhere (the playground) instead of in
   * place; shows the same "Advanced options" control when `advancedOptions`
   * is not given.
   */
  onOpenAdvancedOptions?: () => void;
  /** Starts with `advancedOptions` shown. */
  defaultShowAdvanced?: boolean;
  /**
   * A keyword landing page (src/content/keywordLandingPages.ts): its H1 and
   * intro replace the home page's, and its own sections, FAQ and related
   * links replace the home page's below the form.
   */
  page?: KeywordLandingPage;
}

/** The home page's sections below the connect form. */
const HomeLandingContent: React.FC<{ catalogCount: number }> = ({ catalogCount }) => (
  <>
    <section className="landing-steps" aria-labelledby="landing-steps-title">
      <h2 id="landing-steps-title" className="landing-section-title">{LANDING_STEPS_TITLE}</h2>
      <ol>
        {LANDING_STEPS.map((step) => (
          <li key={step.title}>
            <h3 className="landing-step-title">{step.title}</h3>
            <p className="landing-step-description"><LandingText value={step.description} /></p>
          </li>
        ))}
      </ol>
    </section>

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

    <section className="landing-faq" aria-labelledby="landing-faq-title">
      <h2 id="landing-faq-title" className="landing-section-title">{LANDING_FAQ_TITLE}</h2>
      {LANDING_FAQ.map((item) => (
        <div key={item.question} className="landing-faq-item">
          <h3 className="landing-faq-question">{item.question}</h3>
          <p className="landing-faq-answer"><LandingText value={item.answer} /></p>
        </div>
      ))}
    </section>
  </>
);

export const LandingHero: React.FC<LandingHeroProps> = ({
  serverUrl,
  onServerUrlChange,
  onConnect,
  isConnecting,
  quickPicks = selectLandingQuickPicks(getCatalogServers()),
  catalogCount = getCatalogServers().length,
  recentServers = [],
  onConnectRecent,
  onRemoveRecentServer,
  advancedOptions,
  onOpenAdvancedOptions,
  defaultShowAdvanced = false,
  page,
}) => {
  const [showAdvanced, setShowAdvanced] = useState(defaultShowAdvanced);
  const canConnect = Boolean(serverUrl.trim()) && !isConnecting;
  const recent = recentServers.slice(0, RECENT_SERVER_LIMIT);
  const showRecent = recent.length > 0 && Boolean(onConnectRecent);
  const advancedOpen = showAdvanced && Boolean(advancedOptions);
  // Ids stay unique when the playground's landing is mounted (hidden) beside a landing page.
  const idPrefix = page ? `${page.key}-landing` : 'landing';
  const inputId = page ? `${page.key}-server-url` : 'serverUrl';

  // Once per landing shown; a returning user is one with recent endpoints.
  useEffect(() => trackEvent('landing_view', {
    variant: showRecent ? 'returning' : 'new',
    ...(page ? { page: page.key } : {}),
  }), []);

  const handleManualConnect = () => {
    if (!canConnect) return;
    trackEvent('landing_connect', { source: 'manual', host: getAnalyticsHost(serverUrl), ...(page ? { page: page.key } : {}) });
    onConnect();
  };

  return (
    <section
      className={`landing${page ? ' keyword-landing' : ''}${showRecent ? ' landing--returning' : ''}`}
      aria-labelledby={`${idPrefix}-title`}
    >
      <div className="landing-hero">
        <h1 id={`${idPrefix}-title`} className="landing-title">
          {page ? page.h1 : LANDING_HEADLINE}
        </h1>
        <p className="landing-lede">
          {page ? <LandingText value={page.intro} /> : LANDING_LEDE}
        </p>

        {advancedOpen ? (
          <div className="landing-advanced" id="landing-advanced-panel">
            {advancedOptions}
          </div>
        ) : (
          <>
            <div className="landing-connect">
              <label htmlFor={inputId} className="visually-hidden">MCP endpoint URL</label>
              <input
                id={inputId}
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
                id={page ? undefined : 'connectBtn'}
                type="button"
                className="btn btn-primary landing-connect-button"
                onClick={handleManualConnect}
                disabled={!canConnect}
              >
                Connect
              </button>
            </div>

            {showRecent ? (
              <div className="landing-quick-picks landing-recent">
                <span className="landing-quick-picks-label" id={`${idPrefix}-recent-label`}>Recent</span>
                <ul aria-labelledby={`${idPrefix}-recent-label`}>
                  {recent.map((url) => (
                    <li key={url} className="landing-recent-item">
                      <button
                        type="button"
                        className="landing-quick-pick landing-recent-connect"
                        data-recent-url={url}
                        title={url}
                        disabled={isConnecting}
                        onClick={() => {
                          trackEvent('landing_connect', { source: 'recent_chip', host: getAnalyticsHost(url), ...(page ? { page: page.key } : {}) });
                          onConnectRecent?.(url);
                        }}
                      >
                        <i className="bi bi-clock-history landing-recent-icon" aria-hidden="true"></i>
                        <span className="landing-recent-host">{getRecentServerLabel(url)}</span>
                      </button>
                      {onRemoveRecentServer && (
                        <button
                          type="button"
                          className="landing-recent-remove"
                          onClick={() => onRemoveRecentServer(url)}
                          disabled={isConnecting}
                          title={`Remove ${url} from recent connections`}
                          aria-label={`Remove ${url} from recent connections`}
                        >
                          <i className="bi bi-x-lg" aria-hidden="true"></i>
                        </button>
                      )}
                    </li>
                  ))}
                </ul>
              </div>
            ) : quickPicks.length > 0 && (
              <div className="landing-quick-picks">
                <span className="landing-quick-picks-label" id={`${idPrefix}-quick-picks-label`}>Try with</span>
                <ul aria-labelledby={`${idPrefix}-quick-picks-label`}>
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
                          onClick={() => {
                            trackEvent('landing_connect', { source: 'quick_pick', host: getAnalyticsHost(endpoint.url), ...(page ? { page: page.key } : {}) });
                            onConnect({ endpoint, protocolEra: server.protocolEra });
                          }}
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
          </>
        )}

        {!advancedOptions && onOpenAdvancedOptions && (
          <button
            type="button"
            className="landing-advanced-toggle"
            aria-expanded={false}
            onClick={() => {
              trackEvent('advanced_options_open');
              onOpenAdvancedOptions();
            }}
          >
            <i className="bi bi-gear" aria-hidden="true"></i>
            Advanced options
            <span className="landing-advanced-hint">headers, auth, proxy</span>
          </button>
        )}

        {advancedOptions && (
          <button
            type="button"
            className="landing-advanced-toggle"
            aria-expanded={advancedOpen}
            aria-controls={advancedOpen ? 'landing-advanced-panel' : undefined}
            onClick={() => {
              if (!advancedOpen) trackEvent('advanced_options_open');
              setShowAdvanced((open) => !open);
            }}
          >
            <i className="bi bi-gear" aria-hidden="true"></i>
            {advancedOpen ? 'Simple connect' : 'Advanced options'}
            <span className="landing-advanced-hint">
              {advancedOpen ? '' : 'headers, auth, proxy'}
            </span>
          </button>
        )}

        <ul className="landing-trust" aria-label={LANDING_TRUST_LABEL}>
          {LANDING_TRUST_POINTS.map((point) => (
            <li key={point}>{point}</li>
          ))}
        </ul>
      </div>

      {page ? <KeywordLandingContent page={page} /> : <HomeLandingContent catalogCount={catalogCount} />}
    </section>
  );
};

export default LandingHero;
