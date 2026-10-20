import { afterEach, beforeEach, describe, expect, expectTypeOf, it, vi } from 'vitest';

const firebase = vi.hoisted(() => ({ analytics: { app: 'test' } as object | null, logEvent: vi.fn() }));

// Firebase is loaded on demand; the tests stand in for an already-loaded runtime.
vi.mock('../firebase', () => ({
  getLoadedFirebase: () => ({ analytics: firebase.analytics, logEvent: firebase.logEvent }),
  isFirebaseLoading: () => false,
  onFirebaseLoaded: vi.fn(),
}));

import {
  REDACTED_VALUE,
  formatDiagnosticIds,
  getAnalyticsHost,
  getGuideCtaDestination,
  getScoreBand,
  logPageView,
  redactAnalyticsParams,
  redactAnalyticsValue,
  sanitizePagePath,
  sanitizePageTitle,
  trackEvent,
  trackGuideLinkClick,
  trackOAuthFlow,
  type AnalyticsEventCatalog,
  type AnalyticsEventName,
  type AnalyticsEventParams,
} from './analytics';
import { hasPrivacyOptOut } from './privacySignals';

/**
 * One representative payload per catalog event. The mapped type makes this
 * fail to compile when an event is added without a sample here.
 */
const SAMPLE_EVENTS: { [K in AnalyticsEventName]: AnalyticsEventParams<K> } = {
  landing_view: { variant: 'returning' },
  landing_connect: { source: 'quick_pick', host: getAnalyticsHost('https://user:secret@mcp.example.com:8443/mcp?api_key=abc') },
  catalog_open_server: { server_id: 'github', surface: 'list' },
  connect_attempt: { source: 'recent_chip', transport_hint: 'streamable-http', proxy: true },
  connect_result: {
    outcome: 'failed',
    protocol_era: 'unknown',
    transport: 'unknown',
    diagnostic_ids: formatDiagnosticIds([
      { id: 'transport.accept-header-406', status: 'detected' },
      { id: 'transport.cors-expose-headers-missing', status: 'suspected' },
    ]),
    duration_ms: 1234,
  },
  report_generated: { result_status: 'authorization-required', score_band: getScoreBand(84.5), surface: 'report_page' },
  report_shared: { method: 'markdown' },
  badge_copied: { format: 'restructuredText', surface: 'server_profile' },
  guide_view: { slug: 'designing-production-mcp-server', track: 'build' },
  guide_cta_click: { slug: 'oauth-for-mcp-explained', destination: 'catalog_server' },
  advanced_options_open: {},
  sidebar_collapse: { collapsed: false },
  oauth_flow: { stage: 'callback', provider_policy_id: 'docusign-developer' },
  theme_changed: { theme_name: 'dark' },
  server_url_connection: { host: 'localhost:3000', transport_method: 'sse' },
  result_share_connection: { host: 'api.example.co.uk', type: 'tool' },
  create_tab: {},
  select_tab: {},
  close_tab: { tab_count: 2 },
  disconnect: {},
  connect_abort: {},
  access_resource: {},
  refresh_capabilities: {},
  execute_tool: {},
  execute_prompt: {},
  select_capability: { capability_type: 'resource_template' },
  create_dashboard: {},
  create_space: {},
  select_dashboard: {},
  update_dashboard: { updated_keys: 'name,cards' },
  delete_dashboard: {},
  reorder_dashboards: {},
  health_check_all_dashboards: { dashboard_count: 3 },
  refresh_current_dashboard: {},
  add_card_to_dashboard: { card_type: 'tool' },
  add_card_to_space: { card_type: 'resource' },
  update_card: {},
  delete_card: {},
  move_card: {},
  execute_card: { card_type: 'prompt' },
  catalog_search: { query_length: 7 },
  catalog_filter_auth: { filter: 'oauth' },
  catalog_filter_category: { category: 'Developer Tools' },
  catalog_sort: { sort: 'recently-tested' },
};

const setPrivacySignals = (signals: { doNotTrack?: string | null; globalPrivacyControl?: boolean }) => {
  Object.defineProperty(navigator, 'doNotTrack', { configurable: true, get: () => signals.doNotTrack ?? null });
  Object.defineProperty(navigator, 'globalPrivacyControl', { configurable: true, get: () => signals.globalPrivacyControl });
};

beforeEach(() => {
  firebase.analytics = { app: 'test' };
  firebase.logEvent.mockClear();
  setPrivacySignals({});
});

afterEach(() => {
  delete (navigator as { doNotTrack?: unknown }).doNotTrack;
  delete (navigator as { globalPrivacyControl?: unknown }).globalPrivacyControl;
});

describe('event catalog typing', () => {
  it('types each event name with its own params', () => {
    expectTypeOf<AnalyticsEventParams<'connect_result'>['outcome']>()
      .toEqualTypeOf<'connected' | 'auth_required' | 'failed'>();
    expectTypeOf<AnalyticsEventParams<'report_shared'>['method']>().toEqualTypeOf<'link' | 'markdown' | 'json'>();
    expectTypeOf<AnalyticsEventParams<'oauth_flow'>['stage']>()
      .toEqualTypeOf<'start' | 'callback' | 'success' | 'error'>();
    expectTypeOf<AnalyticsEventParams<'sidebar_collapse'>>().toEqualTypeOf<{ collapsed: boolean }>();
    expectTypeOf<'landing_view'>().toMatchTypeOf<AnalyticsEventName>();
  });

  it('rejects unknown names, wrong params and missing params at compile time', () => {
    const typeOnly = () => {
      // @ts-expect-error not a catalog event
      trackEvent('connect_success');
      // @ts-expect-error variant must be new | returning
      trackEvent('landing_view', { variant: 'first' });
      // @ts-expect-error landing_connect requires its params
      trackEvent('landing_connect');
      // @ts-expect-error events without params take none
      trackEvent('advanced_options_open', { open: true });
      // @ts-expect-error report_shared has no url param
      trackEvent('report_shared', { method: 'link', url: 'https://example.com' });
      trackEvent('advanced_options_open');
      trackEvent('sidebar_collapse', { collapsed: true });
    };
    expect(typeOnly).toBeTypeOf('function');
  });

  it('lists the funnel events the dashboard is built from', () => {
    const funnel: (keyof AnalyticsEventCatalog)[] = [
      'landing_view', 'landing_connect', 'guide_view', 'guide_cta_click', 'catalog_open_server',
      'advanced_options_open', 'connect_attempt', 'oauth_flow', 'connect_result', 'report_generated',
      'report_shared', 'badge_copied', 'sidebar_collapse',
    ];
    expect(funnel.every((name) => name in SAMPLE_EVENTS)).toBe(true);
  });
});

describe('redaction', () => {
  it.each(Object.entries(SAMPLE_EVENTS))('%s params pass redaction unchanged', (_name, params) => {
    expect(redactAnalyticsParams(params as Record<string, unknown>)).toEqual(params);
  });

  it('reduces endpoint URLs to their host, without credentials, path or query', () => {
    expect(getAnalyticsHost('https://user:pa55@Mcp.Example.com:8443/mcp?token=abc#x')).toBe('mcp.example.com:8443');
    expect(getAnalyticsHost('mcp.example.com/sse')).toBe('mcp.example.com');
    expect(getAnalyticsHost('not a url')).toBe('unknown');
    expect(redactAnalyticsValue('https://api.example.com/mcp?key=secret')).toBe('api.example.com');
    expect(redactAnalyticsValue('api.example.com/v1/mcp')).toBe('api.example.com');
    expect(redactAnalyticsValue('//cdn.example.com/a')).toBe('cdn.example.com');
  });

  it('replaces query strings, credentials, emails and token-shaped values', () => {
    for (const value of [
      'tools?limit=10&cursor=abc',
      'Bearer abc.def',
      'Basic dXNlcjpwYXNz',
      'person@example.com',
      'eyJhbGciOiJIUzI1NiJ9.eyJzdWIiOiIxMjM0NTY3ODkwIn0.signature',
      'ghp_0123456789abcdefghijklmnopqrstuvwxyzAB',
      'sk-ant-api03-AbCdEfGhIjKlMnOpQrStUvWxYz0123456789abcd',
    ]) {
      expect(redactAnalyticsValue(value)).toBe(REDACTED_VALUE);
    }
  });

  it('drops sensitive keys and non-scalar values, and caps value length', () => {
    expect(redactAnalyticsParams({
      serverUrl: 'example.com',
      access_token: 'short',
      Authorization: 'x',
      request_headers: 'accept',
      nested: { host: 'example.com' },
      list: ['a'],
      missing: undefined,
      infinite: Number.POSITIVE_INFINITY,
      long: 'a-'.repeat(80),
      ok: 'fine',
    })).toEqual({ long: 'a-'.repeat(50), ok: 'fine' });
  });

  it('redacts params at send time even if a call site passes an unsafe value', () => {
    trackEvent('landing_connect', { source: 'manual', host: 'https://user:pw@example.com/mcp?api_key=1' });
    expect(firebase.logEvent).toHaveBeenCalledWith(firebase.analytics, 'landing_connect', {
      source: 'manual',
      host: 'example.com',
      page_location: `${window.location.origin}/`,
    });
  });

  it('keeps endpoint URLs and dashboard names out of page views', () => {
    expect(sanitizePagePath('/report/https%3A%2F%2Fexample.com%2Fmcp')).toBe('/report/[server]');
    expect(sanitizePagePath('/server/example.com/mcp/sse')).toBe('/server/[server]');
    expect(sanitizePagePath('/call/example.com/tool/search')).toBe('/call/[server]');
    expect(sanitizePagePath('/space/my-team')).toBe('/space/[space]');
    expect(sanitizePagePath('/servers/github/')).toBe('/servers/github/');
    expect(sanitizePageTitle('Server: https://example.com/mcp')).toBe('Server');
    expect(sanitizePageTitle('Result: search')).toBe('Result');
    expect(sanitizePageTitle('Dashboard: Team')).toBe('Dashboard');
  });

  it('caps diagnostic ids to one parameter value and skips unchecked diagnostics', () => {
    expect(formatDiagnosticIds([
      { id: 'transport.get-stream-405', status: 'detected' },
      { id: 'transport.get-stream-405', status: 'detected' },
      { id: 'transport.sse-content-type-mismatch', status: 'not-checked' },
    ])).toBe('transport.get-stream-405');
    const many = Array.from({ length: 10 }, (_, index) => ({ id: `transport.diagnostic-${index}`, status: 'detected' }));
    expect(formatDiagnosticIds(many).length).toBeLessThanOrEqual(100);
    expect(formatDiagnosticIds()).toBe('');
  });
});

describe('do-not-track gate', () => {
  it('reads Do Not Track and Global Privacy Control', () => {
    expect(hasPrivacyOptOut({}, {})).toBe(false);
    expect(hasPrivacyOptOut({ doNotTrack: '0' }, {})).toBe(false);
    expect(hasPrivacyOptOut({ doNotTrack: 'unspecified' }, {})).toBe(false);
    expect(hasPrivacyOptOut({ doNotTrack: '1' }, {})).toBe(true);
    expect(hasPrivacyOptOut({ doNotTrack: 'yes' }, {})).toBe(true);
    expect(hasPrivacyOptOut({ msDoNotTrack: '1' }, {})).toBe(true);
    expect(hasPrivacyOptOut({}, { doNotTrack: '1' })).toBe(true);
    expect(hasPrivacyOptOut({ globalPrivacyControl: true }, {})).toBe(true);
    expect(hasPrivacyOptOut({ globalPrivacyControl: false }, {})).toBe(false);
  });

  it('sends events and page views when no signal is set', () => {
    trackEvent('sidebar_collapse', { collapsed: true });
    logPageView('/learn', 'Learn');
    expect(firebase.logEvent).toHaveBeenCalledTimes(2);
  });

  it.each([
    ['Do Not Track', { doNotTrack: '1' }],
    ['Global Privacy Control', { globalPrivacyControl: true }],
  ])('drops events and page views under %s', (_label, signals) => {
    setPrivacySignals(signals);
    const consoleLog = vi.spyOn(console, 'log').mockImplementation(() => {});
    trackEvent('sidebar_collapse', { collapsed: true });
    trackOAuthFlow('start', 'https://mcp.example.com/mcp');
    logPageView('/learn', 'Learn');
    firebase.analytics = null;
    trackEvent('advanced_options_open');
    expect(firebase.logEvent).not.toHaveBeenCalled();
    expect(consoleLog).not.toHaveBeenCalled();
    consoleLog.mockRestore();
  });

  it('never throws when the analytics backend fails', () => {
    firebase.logEvent.mockImplementationOnce(() => { throw new Error('blocked'); });
    const consoleWarn = vi.spyOn(console, 'warn').mockImplementation(() => {});
    expect(() => trackEvent('report_shared', { method: 'json' })).not.toThrow();
    consoleWarn.mockRestore();
  });
});

describe('funnel helpers', () => {
  it('bands scores by the grade the report shows', () => {
    expect([95, 85, 75, 65, 10].map(getScoreBand)).toEqual(['A', 'B', 'C', 'D', 'F']);
    expect(getScoreBand(null)).toBe('unscored');
    expect(getScoreBand(Number.NaN)).toBe('unscored');
  });

  it('classifies guide link destinations', () => {
    const origin = 'https://mcptest.io';
    expect(getGuideCtaDestination('#outline', origin)).toBeNull();
    expect(getGuideCtaDestination('/', origin)).toBe('playground');
    expect(getGuideCtaDestination('/catalog?q=git', origin)).toBe('catalog');
    expect(getGuideCtaDestination('/servers/github/', origin)).toBe('catalog_server');
    expect(getGuideCtaDestination('/report/https%3A%2F%2Fx.dev', origin)).toBe('report');
    expect(getGuideCtaDestination('/learn/mcp-glossary', origin)).toBe('guide');
    expect(getGuideCtaDestination('/docs/testing-guide', origin)).toBe('docs');
    expect(getGuideCtaDestination('https://modelcontextprotocol.io/spec', origin)).toBe('external');
    expect(getGuideCtaDestination('/pricing', origin)).toBe('other');
  });

  it('tracks one guide_cta_click per followed link inside a guide', () => {
    const article = document.createElement('article');
    article.innerHTML = '<p><a href="/catalog"><span>Browse</span></a> <a href="#top">Top</a> plain</p>';
    const [catalogLink, anchorLink] = article.querySelectorAll('a');
    const onClick = trackGuideLinkClick('mcp-glossary');

    onClick({ target: catalogLink.querySelector('span') });
    onClick({ target: anchorLink });
    onClick({ target: article.querySelector('p') });

    expect(firebase.logEvent).toHaveBeenCalledTimes(1);
    expect(firebase.logEvent).toHaveBeenCalledWith(firebase.analytics, 'guide_cta_click', {
      slug: 'mcp-glossary',
      destination: 'catalog',
      page_location: `${window.location.origin}/`,
    });
  });

  it('adds the provider policy id to oauth_flow only for known providers', () => {
    trackOAuthFlow('start', 'https://unknown.example.com/mcp');
    trackOAuthFlow('success', 'https://mcp.canva.com/mcp');
    trackOAuthFlow('error');
    const page_location = `${window.location.origin}/`;
    expect(firebase.logEvent.mock.calls.map((call) => call[2])).toEqual([
      { stage: 'start', page_location },
      { stage: 'success', provider_policy_id: 'canva', page_location },
      { stage: 'error', page_location },
    ]);
  });
});

describe('implicit page location', () => {
  const visit = (url: string) => window.history.pushState({}, '', url);

  afterEach(() => visit('/'));

  it('overrides the document URL with the sanitized route on an endpoint-bearing report', () => {
    const endpoint = encodeURIComponent('https://user:secret@mcp.example.com/private/mcp?api_key=abc123');
    visit(`/report/${endpoint}?token=xyz#frag`);
    trackEvent('report_generated', { result_status: 'ready', score_band: 'A', surface: 'report_page' });

    const [, , params] = firebase.logEvent.mock.calls[0];
    expect(params.page_location).toBe(`${window.location.origin}/report/[server]`);
    expect(JSON.stringify(firebase.logEvent.mock.calls)).not.toMatch(/mcp\.example|secret|api_key|token=|frag/);
  });

  it('drops the authorization code and state on the OAuth callback route', () => {
    visit('/oauth/callback?code=auth-code-123&state=opaque-state#x');
    trackOAuthFlow('callback', 'https://mcp.canva.com/mcp');

    expect(firebase.logEvent).toHaveBeenCalledWith(firebase.analytics, 'oauth_flow', {
      stage: 'callback',
      provider_policy_id: 'canva',
      page_location: `${window.location.origin}/oauth/callback`,
    });
    expect(JSON.stringify(firebase.logEvent.mock.calls)).not.toMatch(/auth-code|opaque-state|code=/);
  });

  it('cannot be overridden by an event param', () => {
    visit('/server/https%3A%2F%2Fmcp.example.com%2Fmcp');
    trackEvent('theme_changed', { theme_name: 'dark', page_location: 'https://evil.example/?q=1' } as never);
    expect(firebase.logEvent.mock.calls[0][2].page_location).toBe(`${window.location.origin}/server/[server]`);
  });
});
