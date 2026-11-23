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
 * Content-Security-Policy and write the config meta tag and dock boot script.
 * Every prerendered page inherits them from the built index.html. The Worker's own
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
export const SITE_ASSISTANT_BOOT_HASH = 'rajJTGkmDqnHHZdRc/T5s30fwpgQyhbtd1KM/hiBEmI=';
export const SITE_ASSISTANT_BOOT_SOURCE = `'sha256-${SITE_ASSISTANT_BOOT_HASH}'`;
export const SITE_ASSISTANT_CANCEL_DOCK_EVENT = 'mcptest:cancel-site-assistant-dock';

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
 * Allows the boot script by hash and the configured widget origin for scripts
 * and connections.
 */
export const siteAssistantCspSources = (config: SiteAssistantConfig | null): Record<string, string[]> =>
  config ? { 'script-src': [config.endpoint, SITE_ASSISTANT_BOOT_SOURCE], 'connect-src': [config.endpoint] } : {};

/**
 * `policy` with `additions` (directive name to sources) merged in, without
 * duplicates; a directive the policy lacks starts from default-src's sources.
 * Unchanged when there is nothing to add. The one CSP helper: the service
 * page (src/servicePage/config.mts) extends the policy through it too.
 */
export const extendCsp = (policy: string, additions: Record<string, string[]>): string => {
  if (Object.values(additions).every(sources => sources.length === 0)) return policy;
  const directives = policy.split(';').map(part => part.trim()).filter(Boolean);
  const defaultSources = directives.find(part => part.split(/\s+/)[0] === 'default-src')?.split(/\s+/).slice(1) ?? [];
  for (const [name, sources] of Object.entries(additions)) {
    if (sources.length === 0) continue;
    const index = directives.findIndex(part => part.split(/\s+/)[0] === name);
    // A missing directive falls back to default-src, so start from its sources.
    const current = index === -1 ? [name, ...defaultSources] : directives[index].split(/\s+/);
    const merged = [...current, ...sources.filter(source => !current.includes(source))].join(' ');
    if (index === -1) directives.push(merged);
    else directives[index] = merged;
  }
  return directives.join('; ');
};

/** `policy` with the assistant's sources added; unchanged when the assistant is off. */
export const applySiteAssistantCsp = (policy: string, config: SiteAssistantConfig | null): string =>
  extendCsp(policy, siteAssistantCspSources(config));

const CSP_META = /(<meta http-equiv="Content-Security-Policy" content=")([^"]*)(" \/>)/;

/**
 * index.html with its policy passed through `transform` and `extraHead`
 * added after the policy tag. Throws when the page has no policy tag.
 */
export const transformCspMeta = (html: string, transform: (policy: string) => string, extraHead = '', feature = 'the site assistant'): string => {
  if (!CSP_META.test(html)) throw new Error(`index.html has no Content-Security-Policy meta tag to extend for ${feature}.`);
  return html.replace(CSP_META, (_match, start: string, policy: string, end: string) =>
    `${start}${transform(policy)}${end}${extraHead ? `\n    ${extraHead}` : ''}`);
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
 * - `/mcp-server-development`: the service page shows its own quote
 *   assistant instead (src/servicePage/).
 */
export const SITE_ASSISTANT_EXCLUDED_PATH = /^\/(?:(?:oauth\/callback|install-integration|space|report|r)(?:\/|$)|(?:server|call)\/|mcp-server-development\/*$)/;

export const isSiteAssistantPath = (pathname: string): boolean => !SITE_ASSISTANT_EXCLUDED_PATH.test(pathname);
