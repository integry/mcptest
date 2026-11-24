/**
 * The MCP server development page (issue #638), configured at build time and
 * off unless `VITE_SERVICE_PAGE_ENABLED=true`:
 *
 * - `VITE_SERVICE_PAGE_ENABLED`: `true` adds the page, its route, footer link,
 *   sitemap and routes.txt entries and the report link. Anything else: none of them.
 * - `VITE_SERVICE_API`: the private admin service's https base URL. The page
 *   reads `${VITE_SERVICE_API}/public/offer` (docs/service-offer-contract.md)
 *   and quote pages live at `${VITE_SERVICE_API}/q/<id>`. Unset: neutral copy.
 * - `VITE_SOLV_QUOTE_ASSISTANT_KEY`: a second solv.chat assistant, on the
 *   same `VITE_SOLV_ENDPOINT` as the site assistant, shown only on this page.
 *
 * Pure (no DOM, no import.meta.env): vite.config.mjs and
 * scripts/generate-seo-pages.js pass their env in, and the browser reads the
 * build's values through ./buildFlag.ts.
 */
import { extendCsp, resolveSiteAssistantConfig, transformCspMeta, type SiteAssistantConfig } from '../siteAssistant/config.mts';

export const SERVICE_PAGE_PATH = '/mcp-server-development';

export type ServicePageEnv = Partial<Record<
  'VITE_SERVICE_PAGE_ENABLED' | 'VITE_SERVICE_API' | 'VITE_SOLV_ENDPOINT' | 'VITE_SOLV_QUOTE_ASSISTANT_KEY',
  string | undefined
>>;

export interface ServicePageConfig {
  enabled: boolean;
  /** The admin service base URL (origin plus an optional path, no trailing slash), or null. */
  serviceApi: string | null;
  /** The quote assistant (solv.chat endpoint and its public key), or null. */
  quoteAssistant: SiteAssistantConfig | null;
}

export const SERVICE_PAGE_OFF: ServicePageConfig = { enabled: false, serviceApi: null, quoteAssistant: null };

export const isServicePageFlagOn = (value: string | undefined): boolean => value?.trim() === 'true';

/**
 * The service API base URL, or null when it is not a usable one: https only,
 * no credentials, query or fragment. A trailing slash is dropped so
 * `${base}/public/offer` never doubles it.
 */
export const normalizeServiceApi = (value: string | undefined): string | null => {
  const raw = value?.trim();
  if (!raw) return null;
  let url: URL;
  try {
    url = new URL(raw);
  } catch {
    return null;
  }
  if (url.protocol !== 'https:' || url.username || url.password || url.search || url.hash) return null;
  return `${url.origin}${url.pathname.replace(/\/+$/, '')}`;
};

export const resolveServicePageConfig = (env: ServicePageEnv): ServicePageConfig => {
  if (!isServicePageFlagOn(env.VITE_SERVICE_PAGE_ENABLED)) return SERVICE_PAGE_OFF;
  return {
    enabled: true,
    serviceApi: normalizeServiceApi(env.VITE_SERVICE_API),
    quoteAssistant: resolveSiteAssistantConfig(env.VITE_SOLV_ENDPOINT, env.VITE_SOLV_QUOTE_ASSISTANT_KEY),
  };
};

/**
 * The CSP additions: the offer request to the service API, and the quote
 * assistant's widget script and chat requests. Nothing when the page is off
 * or a variable is unset.
 */
export const servicePageCspSources = (config: ServicePageConfig): Record<string, string[]> => {
  if (!config.enabled) return {};
  const connect = [
    ...(config.serviceApi ? [new URL(config.serviceApi).origin] : []),
    ...(config.quoteAssistant ? [config.quoteAssistant.endpoint] : []),
  ];
  return {
    'script-src': config.quoteAssistant ? [config.quoteAssistant.endpoint] : [],
    'connect-src': [...new Set(connect)],
  };
};

/** index.html with the service page's sources in its policy; unchanged when there are none. */
export const applyServicePageToHtml = (html: string, config: ServicePageConfig): string => {
  const additions = servicePageCspSources(config);
  if (Object.values(additions).every(sources => sources.length === 0)) return html;
  return transformCspMeta(html, policy => extendCsp(policy, additions), '', 'the service page');
};

/**
 * Whether `value` is a quote page `open_quote` may open: an https URL on the
 * service API's origin, under `${serviceApi}/q/`. Everything else is refused.
 */
export const isQuoteUrl = (value: unknown, serviceApi: string | null): value is string => {
  if (!serviceApi || typeof value !== 'string') return false;
  let url: URL;
  let base: URL;
  try {
    url = new URL(value);
    base = new URL(serviceApi);
  } catch {
    return false;
  }
  if (url.protocol !== 'https:' || url.username || url.password) return false;
  if (url.origin !== base.origin) return false;
  const prefix = `${base.pathname.replace(/\/+$/, '')}/q/`;
  return url.pathname.startsWith(prefix) && url.pathname.length > prefix.length;
};
