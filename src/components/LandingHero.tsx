import React, { useEffect, useRef, useState } from 'react';
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
  LANDING_TEST_SERVERS_LINK,
  LANDING_TEST_SERVERS_PATH,
  LANDING_TRUST_LABEL,
  LANDING_TRUST_POINTS,
} from '../content/landingCopy';
import {
  LANDING_ADVANCED_HINT,
  LANDING_ADVANCED_LABEL,
  LANDING_ALTERNATIVES_LABEL,
  LANDING_CONNECT_LABEL,
  LANDING_FIELD_HELP,
  LANDING_FIELD_LABEL,
  LANDING_FIELD_PLACEHOLDER,
  LANDING_SAMPLE_LABEL,
  LANDING_SAMPLE_NOTE_PREFIX,
  LANDING_SAMPLE_NOTE_SUFFIX,
  getEndpointInputError,
} from '../content/landingFirstRun';
import type { KeywordLandingPage } from '../content/keywordLandingPages';
import { selectLandingQuickPicks } from '../utils/landingQuickPicks';
import { LANDING_FIXTURE_SELECTION } from '../utils/landingFixture';
import { LANDING_FIXTURE } from '../data/publicFixtures';
import { CatalogServerLogo } from './CatalogServerLogo';
import { LandingPreview } from './LandingPreview';
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
    <p className="landing-catalog landing-test-servers">
      <Link to={LANDING_TEST_SERVERS_PATH}>
        {LANDING_TEST_SERVERS_LINK} <span aria-hidden="true">&rarr;</span>
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
  const [inputError, setInputError] = useState<string | null>(null);
  const inputRef = useRef<HTMLInputElement>(null);
  const recent = recentServers.slice(0, RECENT_SERVER_LIMIT);
  const showRecent = recent.length > 0 && Boolean(onConnectRecent);
  const advancedOpen = showAdvanced && Boolean(advancedOptions);
  // Ids stay unique when the playground's landing is mounted (hidden) beside a landing page.
  const idPrefix = page ? `${page.key}-landing` : 'landing';
  const inputId = page ? `${page.key}-server-url` : 'serverUrl';
  const pageProps = page ? { page: page.key } : {};
  // The first preset is the one-click sample: it connects through the same
  // path as clicking that preset.
  const sample = quickPicks[0];
  const sampleEndpoint = sample ? getPreferredCatalogEndpoint(sample) : undefined;

  // Once per landing shown; a returning user is one with recent endpoints.
  useEffect(() => trackEvent('landing_view', {
    variant: showRecent ? 'returning' : 'new',
    ...(page ? { page: page.key } : {}),
  }), []);

  const handleManualConnect = () => {
    if (isConnecting) return;
    const error = getEndpointInputError(serverUrl);
    setInputError(error);
    if (error) {
      inputRef.current?.focus();
      return;
    }
    trackEvent('landing_connect', { source: 'manual', host: getAnalyticsHost(serverUrl), ...pageProps });
    onConnect();
  };

  const connectPreset = (server: CatalogServer, source: 'quick_pick' | 'sample_test') => {
    const endpoint = getPreferredCatalogEndpoint(server);
    setInputError(null);
    trackEvent('landing_connect', { source, host: getAnalyticsHost(endpoint.url), ...pageProps });
    onConnect({ endpoint, protocolEra: server.protocolEra });
  };

  return (
    <section
      className={`landing${page ? ' keyword-landing' : ''}${showRecent ? ' landing--returning' : ''}`}
      aria-labelledby={`${idPrefix}-title`}
    >
      <div className="landing-hero">
        <div className="landing-intro">
          <h1 id={`${idPrefix}-title`} className="landing-title">
            {page ? page.h1 : LANDING_HEADLINE}
          </h1>
          <p className="landing-lede">
            {page ? <LandingText value={page.intro} /> : LANDING_LEDE}
          </p>

          {advancedOpen ? (
            <div className="landing-advanced" id={`${idPrefix}-advanced-panel`}>
              {advancedOptions}
            </div>
          ) : (
            <>
              <div className="landing-form">
                <label htmlFor={inputId} className="landing-field-label">{LANDING_FIELD_LABEL}</label>
                <div className="landing-connect">
                  <input
                    ref={inputRef}
                    id={inputId}
                    type="text"
                    inputMode="url"
                    autoComplete="off"
                    autoCapitalize="off"
                    spellCheck={false}
                    className="form-control landing-connect-input"
                    placeholder={LANDING_FIELD_PLACEHOLDER}
                    aria-describedby={inputError ? `${inputId}-error ${inputId}-help` : `${inputId}-help`}
                    aria-invalid={inputError ? true : undefined}
                    value={serverUrl}
                    onChange={(event) => {
                      setInputError(null);
                      onServerUrlChange(event.target.value);
                    }}
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
                    disabled={isConnecting}
                  >
                    {LANDING_CONNECT_LABEL}
                  </button>
                </div>
                {inputError && (
                  <p id={`${inputId}-error`} className="landing-field-error" role="alert">
                    <i className="bi bi-exclamation-circle" aria-hidden="true"></i>
                    {inputError}
                  </p>
                )}
                <p id={`${inputId}-help`} className="landing-field-help">{LANDING_FIELD_HELP}</p>
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
                            trackEvent('landing_connect', { source: 'recent_chip', host: getAnalyticsHost(url), ...pageProps });
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
              ) : (
                <div className="landing-quick-picks">
                  <span className="landing-quick-picks-label" id={`${idPrefix}-quick-picks-label`}>{LANDING_ALTERNATIVES_LABEL}</span>
                  {sample && sampleEndpoint && (
                    <div className="landing-sample">
                      <button
                        id={page ? undefined : 'landingSampleBtn'}
                        type="button"
                        className="btn landing-sample-button"
                        data-server-id={sample.id}
                        title={sampleEndpoint.url}
                        aria-describedby={`${idPrefix}-sample-note`}
                        disabled={isConnecting}
                        onClick={() => connectPreset(sample, 'sample_test')}
                      >
                        <i className="bi bi-play-fill" aria-hidden="true"></i>
                        {LANDING_SAMPLE_LABEL}
                      </button>
                      <span id={`${idPrefix}-sample-note`} className="landing-sample-note">
                        {LANDING_SAMPLE_NOTE_PREFIX} {sample.name}{LANDING_SAMPLE_NOTE_SUFFIX}
                      </span>
                    </div>
                  )}
                  <ul aria-labelledby={`${idPrefix}-quick-picks-label`}>
                    {/* mcptest's own public echo server first: no sign-in, always answers. */}
                    <li>
                      <button
                        type="button"
                        className="landing-quick-pick"
                        data-server-id={LANDING_FIXTURE.id}
                        title={LANDING_FIXTURE.url}
                        disabled={isConnecting}
                        onClick={() => {
                          setInputError(null);
                          trackEvent('landing_connect', { source: 'quick_pick', host: getAnalyticsHost(LANDING_FIXTURE.url), ...pageProps });
                          onConnect(LANDING_FIXTURE_SELECTION);
                        }}
                      >
                        <CatalogServerLogo
                          name={LANDING_FIXTURE.name}
                          logoUrl={LANDING_FIXTURE.logoUrl}
                          className="landing-quick-pick-logo"
                        />
                        {LANDING_FIXTURE.name}
                      </button>
                    </li>
                    {quickPicks.map((server) => (
                      <li key={server.id}>
                        <button
                          type="button"
                          className="landing-quick-pick"
                          data-server-id={server.id}
                          title={getPreferredCatalogEndpoint(server).url}
                          disabled={isConnecting}
                          onClick={() => connectPreset(server, 'quick_pick')}
                        >
                          <CatalogServerLogo
                            name={server.name}
                            logoUrl={server.logoUrl}
                            className="landing-quick-pick-logo"
                          />
                          {server.name}
                        </button>
                      </li>
                    ))}
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
              {LANDING_ADVANCED_LABEL}
              <span className="landing-advanced-hint">{LANDING_ADVANCED_HINT}</span>
            </button>
          )}

          {advancedOptions && (
            <button
              type="button"
              className="landing-advanced-toggle"
              aria-expanded={advancedOpen}
              aria-controls={advancedOpen ? `${idPrefix}-advanced-panel` : undefined}
              onClick={() => {
                if (!advancedOpen) trackEvent('advanced_options_open');
                setShowAdvanced((open) => !open);
              }}
            >
              <i className="bi bi-gear" aria-hidden="true"></i>
              {advancedOpen ? 'Simple connect' : LANDING_ADVANCED_LABEL}
              <span className="landing-advanced-hint">
                {advancedOpen ? '' : LANDING_ADVANCED_HINT}
              </span>
            </button>
          )}

          <ul className="landing-trust" aria-label={LANDING_TRUST_LABEL}>
            {LANDING_TRUST_POINTS.map((point) => (
              <li key={point}>{point}</li>
            ))}
          </ul>
        </div>

        <LandingPreview idPrefix={idPrefix} />
      </div>

      {page ? <KeywordLandingContent page={page} /> : <HomeLandingContent catalogCount={catalogCount} />}
    </section>
  );
};

export default LandingHero;
