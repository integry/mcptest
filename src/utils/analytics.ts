import { completeNextStep } from './nextStepsProgress';
import { getLoadedFirebase, isFirebaseLoading, onFirebaseLoaded, type FirebaseRuntime } from '../firebase';
import type { ProtocolEra } from '@modelcontextprotocol/client';
import type { TransportType } from '../types';
import type { BadgeSnippets } from './badges';
import { getOAuthProviderPolicy } from './oauthProviderPolicy';
import { isAnalyticsAllowed } from './privacySignals';
import type { ReleaseReadinessStatus } from './releaseReadiness';

/*
 * Typed analytics event catalog. docs/analytics-events.md lists every event,
 * when it fires, its params and the funnel order; keep the two in sync.
 *
 * Params never carry endpoint URLs, credentials, tokens, headers or
 * user-entered text: hosts are fine, full URLs are not. trackEvent passes every
 * value through redactAnalyticsParams before it leaves the browser, and drops
 * events entirely when the browser sends Do Not Track or Global Privacy Control.
 */

type NoParams = Record<string, never>;

/** How a connection was started. The landing only offers the first three. */
export type LandingConnectSource = 'manual' | 'quick_pick' | 'recent_chip';
export type ConnectSource = LandingConnectSource | 'catalog' | 'shared_link' | 'reconnect';
export type ConnectOutcome = 'connected' | 'auth_required' | 'failed';
/** Report grade, matching the grade shown next to the score, or `unscored`. */
export type ScoreBand = 'A' | 'B' | 'C' | 'D' | 'F' | 'unscored';
export type ReportSurface = 'playground' | 'report_page';
export type ReportShareMethod = 'link' | 'markdown' | 'json';
export type BadgeSurface = 'report' | 'server_profile';
export type OAuthFlowStage = 'start' | 'callback' | 'success' | 'error';
export type GuideCtaDestination =
  | 'playground'
  | 'catalog'
  | 'catalog_server'
  | 'report'
  | 'guide'
  | 'docs'
  | 'external'
  | 'other';

export interface AnalyticsEventCatalog {
  // Product funnel, in order: landing → connect → report → share/badge.
  landing_view: { variant: 'new' | 'returning' };
  landing_connect: { source: LandingConnectSource; host: string };
  catalog_open_server: { server_id: string; surface: 'list' | 'profile' };
  connect_attempt: { source: ConnectSource; transport_hint: TransportType | 'auto'; proxy: boolean };
  connect_result: {
    outcome: ConnectOutcome;
    protocol_era: ProtocolEra | 'unknown';
    transport: TransportType | 'unknown';
    /** Comma-separated transport diagnostic ids; empty when none applied. */
    diagnostic_ids: string;
    duration_ms: number;
  };
  report_generated: { result_status: ReleaseReadinessStatus; score_band: ScoreBand; surface: ReportSurface };
  report_shared: { method: ReportShareMethod };
  badge_copied: { format: keyof BadgeSnippets; surface: BadgeSurface };
  server_page_action: { action: 'test_live' | 'report' | 'similar_server' | 'guide' | 'watch' };
  guide_inline_test: { outcome: 'submitted' | 'invalid' };
  next_steps_click: { step: string };
  next_steps_dismiss: NoParams;
  scroll_depth: { depth: 25 | 50 | 75 | 100 };
  guide_view: { slug: string; track: string };
  guide_cta_click: { slug: string; destination: GuideCtaDestination };
  advanced_options_open: NoParams;
  sidebar_collapse: { collapsed: boolean };
  oauth_flow: { stage: OAuthFlowStage; provider_policy_id?: string };

  // Playground and dashboard interactions.
  theme_changed: { theme_name: string };
  server_setup_copied: { server_id: string; target: string };
  server_url_connection: { host: string; transport_method?: string };
  result_share_connection: { host: string; type: 'tool' | 'resource' };
  create_tab: NoParams;
  select_tab: NoParams;
  close_tab: { tab_count: number };
  disconnect: NoParams;
  connect_abort: NoParams;
  access_resource: NoParams;
  refresh_capabilities: NoParams;
  execute_tool: NoParams;
  execute_prompt: NoParams;
  select_capability: { capability_type: 'tool' | 'resource_template' | 'prompt' };
  create_dashboard: NoParams;
  create_space: NoParams;
  select_dashboard: NoParams;
  update_dashboard: { updated_keys: string };
  delete_dashboard: NoParams;
  reorder_dashboards: NoParams;
  health_check_all_dashboards: { dashboard_count: number };
  refresh_current_dashboard: NoParams;
  add_card_to_dashboard: { card_type: string };
  add_card_to_space: { card_type: string };
  update_card: NoParams;
  delete_card: NoParams;
  move_card: NoParams;
  execute_card: { card_type: string };

  // Catalog browsing.
  catalog_search: { query_length: number };
  catalog_filter_auth: { filter: string };
  catalog_filter_category: { category: string };
  catalog_sort: { sort: string };
}

export type AnalyticsEventName = keyof AnalyticsEventCatalog;
export type AnalyticsEventParams<K extends AnalyticsEventName> = AnalyticsEventCatalog[K];
type AnalyticsEventArgs<K extends AnalyticsEventName> = AnalyticsEventCatalog[K] extends NoParams
  ? []
  : [params: AnalyticsEventCatalog[K]];

export type AnalyticsValue = string | number | boolean;

const MAX_VALUE_LENGTH = 100;
export const REDACTED_VALUE = '[redacted]';

/** Keys whose string values are never sent, whatever they contain. */
const SENSITIVE_KEY = /(url|uri|token|secret|passw|authorization|header|cookie|credential|api_?key)/i;
const URL_WITH_SCHEME = /^[a-z][a-z0-9+.-]*:\/\//i;
const HOST_WITH_PATH = /^[a-z0-9-]+(\.[a-z0-9-]+)+(:\d+)?[/?#]/i;
const QUERY_STRING = /[?&][^\s=&]+=/;
const AUTH_SCHEME = /\b(bearer|basic|token)\s+\S/i;
const EMAIL = /[^\s@]+@[^\s@]+\.[^\s@]+/;
const JWT = /eyJ[\w-]{8,}\.[\w-]{8,}/;
const TOKEN_RUN = /[A-Za-z0-9_+/=]{32,}/;

/** The host of an endpoint, with credentials, path and query removed. */
export const getAnalyticsHost = (url: string): string => {
  const trimmed = url.trim();
  if (!trimmed) return 'unknown';
  try {
    const candidate = URL_WITH_SCHEME.test(trimmed)
      ? trimmed
      : trimmed.startsWith('//') ? `https:${trimmed}` : `https://${trimmed}`;
    return new URL(candidate).host.toLowerCase() || 'unknown';
  } catch {
    return 'unknown';
  }
};

/**
 * Makes one string safe to send: URLs collapse to their host; query strings,
 * credentials, emails and token-shaped values are replaced; long values are cut.
 */
export const redactAnalyticsValue = (value: string): string => {
  const trimmed = value.trim();
  if (URL_WITH_SCHEME.test(trimmed) || trimmed.startsWith('//') || HOST_WITH_PATH.test(trimmed)) {
    return getAnalyticsHost(trimmed);
  }
  if (
    QUERY_STRING.test(trimmed)
    || AUTH_SCHEME.test(trimmed)
    || EMAIL.test(trimmed)
    || JWT.test(trimmed)
    || TOKEN_RUN.test(trimmed)
  ) {
    return REDACTED_VALUE;
  }
  return trimmed.slice(0, MAX_VALUE_LENGTH);
};

/** Keeps scalar params only and redacts every string; unsafe keys are dropped. */
export const redactAnalyticsParams = (
  params: Readonly<Record<string, unknown>> | undefined
): Record<string, AnalyticsValue> => {
  const safe: Record<string, AnalyticsValue> = {};
  if (!params) return safe;
  for (const [key, value] of Object.entries(params)) {
    if (typeof value === 'boolean') {
      safe[key] = value;
    } else if (typeof value === 'number') {
      if (Number.isFinite(value)) safe[key] = value;
    } else if (typeof value === 'string' && !SENSITIVE_KEY.test(key)) {
      safe[key] = redactAnalyticsValue(value);
    }
  }
  return safe;
};

type QueuedEvent = { name: string; params: Record<string, AnalyticsValue> };

/** Events fired before the Firebase chunk arrives; replayed once, in order. */
const MAX_QUEUED_EVENTS = 50;
let queued: QueuedEvent[] = [];
let flushRegistered = false;

const deliver = (runtime: FirebaseRuntime, name: string, params: Record<string, AnalyticsValue>): void => {
  try {
    runtime.logEvent(runtime.analytics!, name, params);
  } catch (error) {
    console.warn('[Analytics] Event could not be sent:', error);
  }
};

const registerFlush = (): void => {
  if (flushRegistered) return;
  flushRegistered = true;
  onFirebaseLoaded((runtime) => {
    const events = queued;
    queued = [];
    if (!runtime.analytics) return;
    events.forEach(event => deliver(runtime, event.name, event.params));
  });
};

/**
 * Delivers an event through Firebase Analytics when it is loaded, queues it
 * while the SDK chunk is still loading, and otherwise calls `fallback`.
 */
const send = (name: string, params: Record<string, AnalyticsValue>, fallback: () => void): void => {
  const runtime = getLoadedFirebase();
  if (runtime) {
    if (runtime.analytics) deliver(runtime, name, params);
    else fallback();
    return;
  }
  if (isFirebaseLoading()) {
    registerFlush();
    if (queued.length < MAX_QUEUED_EVENTS) queued.push({ name, params });
    return;
  }
  fallback();
};

/**
 * Sends one catalog event. Dropped when the browser opts out of tracking;
 * never throws, so analytics cannot break the flow that reports it.
 */
export function trackEvent<K extends AnalyticsEventName>(name: K, ...args: AnalyticsEventArgs<K>): void {
  if (typeof window !== 'undefined') {
    const step = name === 'execute_tool' ? 'tool' : name === 'report_generated' ? 'report' : name === 'badge_copied' ? 'badge' : undefined;
    if (step) completeNextStep(step);
  }
  if (!isAnalyticsAllowed()) return;
  const params = redactAnalyticsParams(args[0] as Record<string, unknown> | undefined);
  // gtag otherwise attaches the full document URL, which on report, server and
  // OAuth callback routes carries the endpoint, query credentials or auth codes.
  send(name as string, { ...params, page_location: getSanitizedPageLocation() }, () => {
    // Fallback for local development or if Firebase fails to initialize
    console.log(`[Analytics Disabled] Event: ${name}`, params);
  });
}

/** `oauth_flow` with the provider policy id when the endpoint has a known policy. */
export const trackOAuthFlow = (stage: OAuthFlowStage, serverUrl?: string): void => {
  const providerPolicyId = serverUrl ? getOAuthProviderPolicy(serverUrl)?.id : undefined;
  trackEvent('oauth_flow', providerPolicyId ? { stage, provider_policy_id: providerPolicyId } : { stage });
};

/** The report grade for a scored percentage, matching the report's grade label. */
export const getScoreBand = (percentage: number | null): ScoreBand => {
  if (percentage === null || !Number.isFinite(percentage)) return 'unscored';
  if (percentage >= 90) return 'A';
  if (percentage >= 80) return 'B';
  if (percentage >= 70) return 'C';
  if (percentage >= 60) return 'D';
  return 'F';
};

/** Detected or suspected diagnostic ids, de-duplicated, within the value limit. */
export const formatDiagnosticIds = (
  diagnostics: readonly { id: string; status?: string }[] = []
): string => {
  const ids = [...new Set(
    diagnostics.filter((diagnostic) => diagnostic.status !== 'not-checked').map((diagnostic) => diagnostic.id)
  )];
  let joined = '';
  for (const id of ids) {
    const next = joined ? `${joined},${id}` : id;
    if (next.length > MAX_VALUE_LENGTH) break;
    joined = next;
  }
  return joined;
};

/** Where a link inside a guide leads; null for same-page anchors. */
export const getGuideCtaDestination = (
  href: string,
  origin: string = typeof window === 'undefined' ? 'https://mcptest.io' : window.location.origin
): GuideCtaDestination | null => {
  if (!href || href.startsWith('#')) return null;
  let url: URL;
  try {
    url = new URL(href, origin);
  } catch {
    return 'other';
  }
  if (url.origin !== new URL(origin).origin) return 'external';
  const path = url.pathname;
  if (path === '/' || path === '') return 'playground';
  if (path === '/catalog' || path.startsWith('/catalog/')) return 'catalog';
  if (path.startsWith('/servers/')) return 'catalog_server';
  if (path === '/report' || path.startsWith('/report/')) return 'report';
  if (path === '/learn' || path.startsWith('/learn/')) return 'guide';
  if (path === '/docs' || path.startsWith('/docs/')) return 'docs';
  return 'other';
};

/** Delegated click handler for a guide: one `guide_cta_click` per followed link. */
export const trackGuideLinkClick = (slug: string) => (event: { target: EventTarget | null }): void => {
  const target = event.target as Element | null;
  const anchor = typeof target?.closest === 'function' ? target.closest('a[href]') : null;
  const destination = anchor ? getGuideCtaDestination(anchor.getAttribute('href') || '') : null;
  if (destination) trackEvent('guide_cta_click', { slug, destination });
};

/**
 * Events a prerendered page sends before React mounts (src/staticPage), keyed
 * like `page_view:/learn/x`. The app's first render would send each of them
 * again, so it skips a recorded key once.
 */
const sentBeforeMount = new Set<string>();

export const recordStaticPageEvent = (key: string): void => {
  sentBeforeMount.add(key);
};

/** True (and forgets the key) when the static page already sent this event. */
export const consumeStaticPageEvent = (key: string): boolean => sentBeforeMount.delete(key);

/**
 * Sanitizes page path to remove user-specific slugs and endpoint URLs
 */
const sanitizePagePath = (path: string): string => {
  return path
    .replace(/^\/space\/[^/]+/, '/space/[space]')
    .replace(/^\/(server|report|call)\/.*$/, '/$1/[server]');
};

/** The current page URL as analytics may see it: sanitized path, no query or fragment. */
const getSanitizedPageLocation = (): string => {
  if (typeof window === 'undefined') return '';
  return window.location.origin + sanitizePagePath(window.location.pathname);
};

/**
 * Sanitizes page title to remove user-specific dashboard names and endpoint URLs
 */
const sanitizePageTitle = (title: string): string => {
  return title.replace(/^(Dashboard|Server|Result): .+$/, '$1');
};

/**
 * Logs a page_view event. Firebase's automatic page view is turned off, so this
 * is the only page view sent, for the initial load and every SPA route change.
 * @param path The path of the page being viewed.
 * @param title The title of the page.
 */
export const logPageView = (path: string, title: string) => {
    if (consumeStaticPageEvent(`page_view:${path}`)) return;
    if (!isAnalyticsAllowed()) return;
    const sanitizedPath = sanitizePagePath(path);
    const sanitizedTitle = sanitizePageTitle(title);

    send('page_view', {
        page_location: window.location.origin + sanitizedPath,
        page_path: sanitizedPath,
        page_title: sanitizedTitle,
    }, () => {
        console.log(`[Analytics Disabled] Page View: ${sanitizedTitle} (${sanitizedPath})`);
    });
};

// Export sanitization functions for use in other components
export { sanitizePagePath, sanitizePageTitle };
