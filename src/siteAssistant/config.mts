/**
 * The site assistant (issue #637): the solv.chat widget, configured at build
 * time by two variables and off when either is missing.
 *
 * - `VITE_SOLV_ENDPOINT`: the solv.chat Worker origin that serves
 *   `GET /widget.js` and the `/v1/*` chat API.
 * - `VITE_SOLV_ASSISTANT_KEY`: the assistant's public key (`public_key`). The
 *   assistant's `allowed_origins` on the solv.chat side must list this site.
 *
 * This module is pure (no DOM) and is the one place the build and the browser
 * derive anything from those variables: vite.config.mjs uses it to extend the
 * Content-Security-Policy in index.html and to write the config meta tag, and
 * every prerendered page (scripts/generate-seo-pages.js, scripts/critical-css.js)
 * is built from that index.html, so they inherit both. The Worker's own
 * policies (badges) are for SVGs that never show the widget, and published
 * report permalinks (/r/*) are JSON served by the Worker, so neither changes.
 */

export interface SiteAssistantConfig {
  /** The solv.chat Worker origin, e.g. `https://chat.example.com`. Never a path. */
  endpoint: string;
  /** The assistant's public key. */
  assistantKey: string;
}

export type SiteAssistantEnv = Partial<Record<'VITE_SOLV_ENDPOINT' | 'VITE_SOLV_ASSISTANT_KEY', string | undefined>>;

/** `name` of the meta tag that carries the config into the page. */
export const SITE_ASSISTANT_META_NAME = 'mcptest-site-assistant';

/** Public keys are opaque ids; anything else is a misconfiguration, not markup to inject. */
const ASSISTANT_KEY = /^[A-Za-z0-9_-]{1,128}$/;
const LOOPBACK_HOSTS = new Set(['localhost', '127.0.0.1', '[::1]']);

/**
 * The endpoint's origin, or null when it is not a usable widget origin:
 * `https:` only, except plain `http:` on loopback for a local `wrangler dev`.
 */
export const normalizeSolvEndpoint = (value: string | undefined): string | null => {
  const raw = value?.trim();
  if (!raw) return null;
  let url: URL;
  try {
    url = new URL(raw);
  } catch {
    return null;
  }
  if (url.username || url.password) return null;
  const secure = url.protocol === 'https:';
  const localDev = url.protocol === 'http:' && LOOPBACK_HOSTS.has(url.hostname);
  if (!secure && !localDev) return null;
  return url.origin;
};

export const normalizeAssistantKey = (value: string | undefined): string | null => {
  const key = value?.trim();
  return key && ASSISTANT_KEY.test(key) ? key : null;
};

/** Both values, validated; null (assistant off) when either is missing or unusable. */
export const resolveSiteAssistantConfig = (
  endpointValue: string | undefined,
  keyValue: string | undefined,
): SiteAssistantConfig | null => {
  const endpoint = normalizeSolvEndpoint(endpointValue);
  const assistantKey = normalizeAssistantKey(keyValue);
  return endpoint && assistantKey ? { endpoint, assistantKey } : null;
};

export const readSiteAssistantEnv = (env: SiteAssistantEnv): SiteAssistantConfig | null =>
  resolveSiteAssistantConfig(env.VITE_SOLV_ENDPOINT, env.VITE_SOLV_ASSISTANT_KEY);

/** Where the widget bundle is served (solv.chat `GET /widget.js`). */
export const widgetScriptUrl = (config: SiteAssistantConfig): string => `${config.endpoint}/widget.js`;

/**
 * The CSP additions: the widget script, and its config, chat (server-sent
 * events over fetch) and feedback requests. Exactly the configured origin.
 */
export const siteAssistantCspSources = (config: SiteAssistantConfig | null): Record<string, string[]> =>
  config ? { 'script-src': [config.endpoint], 'connect-src': [config.endpoint] } : {};

/** `policy` with the assistant's sources added; unchanged when the assistant is off. */
export const applySiteAssistantCsp = (policy: string, config: SiteAssistantConfig | null): string => {
  const additions = siteAssistantCspSources(config);
  if (Object.keys(additions).length === 0) return policy;
  const directives = policy.split(';').map(part => part.trim()).filter(Boolean);
  const defaultSources = directives.find(part => part.split(/\s+/)[0] === 'default-src')?.split(/\s+/).slice(1) ?? [];
  for (const [name, sources] of Object.entries(additions)) {
    const index = directives.findIndex(part => part.split(/\s+/)[0] === name);
    // A missing directive falls back to default-src, so start from its sources.
    const current = index === -1 ? [name, ...defaultSources] : directives[index].split(/\s+/);
    const merged = [...current, ...sources.filter(source => !current.includes(source))].join(' ');
    if (index === -1) directives.push(merged);
    else directives[index] = merged;
  }
  return directives.join('; ');
};

const CSP_META = /(<meta http-equiv="Content-Security-Policy" content=")([^"]*)(" \/>)/;

/**
 * index.html for this build: the policy extended and the config meta tag
 * added after it. With the assistant off the HTML is returned unchanged.
 */
export const applySiteAssistantToHtml = (html: string, config: SiteAssistantConfig | null): string => {
  if (!config) return html;
  if (!CSP_META.test(html)) throw new Error('index.html has no Content-Security-Policy meta tag to extend for the site assistant.');
  const meta = `<meta name="${SITE_ASSISTANT_META_NAME}" data-endpoint="${config.endpoint}" data-assistant="${config.assistantKey}" />`;
  return html.replace(CSP_META, (_match, start: string, policy: string, end: string) =>
    `${start}${applySiteAssistantCsp(policy, config)}${end}\n    ${meta}`);
};

/**
 * Paths that never load the widget: auth flows, pages that show a visitor's
 * own data, and pages whose URL carries an endpoint (the widget sends the page
 * URL with every question):
 *
 * - `/oauth/callback`, `/install-integration`: OAuth redirects carrying codes.
 * - `/space`, `/space/*`: signed-in dashboards.
 * - `/report`, `/report/*`: reports with unpublished results.
 * - `/server/*`, `/call/*`: connection and result-share links naming an endpoint.
 * - `/r`, `/r/*`: published report permalinks served by the Worker.
 */
const EXCLUDED_EXACT = new Set(['/oauth/callback', '/install-integration', '/space', '/report', '/r']);
const EXCLUDED_PREFIXES = ['/oauth/callback/', '/install-integration/', '/space/', '/report/', '/server/', '/call/', '/r/'];

export const isSiteAssistantPath = (pathname: string): boolean => {
  const path = pathname.length > 1 ? pathname.replace(/\/+$/, '') || '/' : pathname;
  if (EXCLUDED_EXACT.has(path)) return false;
  return !EXCLUDED_PREFIXES.some(prefix => pathname.startsWith(prefix));
};
