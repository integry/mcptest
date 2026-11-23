/**
 * Site assistant audit of the built site (issue #675). The solv.chat widget is
 * configured in .env.production; the build writes its config meta tag into
 * index.html and extends the Content-Security-Policy there
 * (src/siteAssistant/config.mts), and every prerendered page is built from
 * that index.html. scripts/audit-site-assistant.test.mjs runs this against
 * dist/ after the build.
 *
 * Every HTML page in dist/ must:
 *   - carry the config meta tag exactly once, naming the configured endpoint
 *     and assistant key (missing = no assistant on that page; twice = two);
 *   - have exactly one policy, whose script-src and connect-src list the
 *     endpoint, and whose script-src allows no inline or eval'd script and no
 *     wildcard or scheme-wide host;
 *   - let the widget frame the chat service's visitor check: from solv.chat
 *     0.1.8 the widget runs Cloudflare Turnstile in a frame served by the
 *     endpoint (`<endpoint>/v1/check/frame`, issue #699), so frame-src (or the
 *     child-src or default-src it falls back to) must allow that origin. The
 *     layout's `frame-src https:` does; the build adds nothing for it;
 *   - not load the widget itself: no `<solv-chat>` element and no widget.js
 *     script in the static HTML. The launcher adds both, once, when a visitor
 *     opens the assistant, so nothing reaches solv.chat before that.
 */

import fs from 'node:fs';
import path from 'node:path';
import { loadSite } from './check-links.mjs';

const META_NAME = 'mcptest-site-assistant';
const META_TAG = new RegExp(`<meta name="${META_NAME}"[^>]*>`, 'g');
const CSP_TAG = /<meta http-equiv="Content-Security-Policy" content="([^"]*)"/g;
/** Script sources the assistant must never bring with it. */
const UNSAFE_SCRIPT_SOURCES = new Set(["'unsafe-inline'", "'unsafe-eval'", "'wasm-unsafe-eval'", '*', 'https:', 'http:']);

/** The page the widget frames to run the visitor check (solv.chat docs/architecture.md, "Visitor check"). */
export const CHECK_FRAME_PATH = '/v1/check/frame';

const attribute = (tag, name) => tag.match(new RegExp(`\\s${name}="([^"]*)"`))?.[1];

/** The sources of one directive in a policy string, or null when it is absent. */
export function cspDirective(policy, name) {
  const part = policy.split(';').map(value => value.trim()).find(value => value.split(/\s+/)[0] === name);
  return part ? part.split(/\s+/).slice(1) : null;
}

/**
 * Whether a CSP source list allows a resource at `url` (an https URL), per the
 * CSP source-matching rules for the forms a policy here can use: `*`, a
 * scheme (`https:`), and a host source with an optional `*.` subdomain
 * wildcard, scheme, port and path. Quoted keywords never match: 'self'
 * because the chat service is another origin, and 'none' because it only
 * blocks on its own (browsers ignore it beside other sources, so an empty or
 * 'none'-only list allows nothing).
 */
export function cspSourcesAllow(sources, url) {
  const target = new URL(url);
  return sources.some(source => {
    if (source === '*') return target.protocol === 'https:' || target.protocol === 'http:';
    if (/^[a-z][a-z0-9+.-]*:$/i.test(source)) return source.toLowerCase() === target.protocol || (source.toLowerCase() === 'http:' && target.protocol === 'https:');
    if (source.startsWith("'")) return false;
    const match = source.match(/^(?:([a-z][a-z0-9+.-]*):\/\/)?(\*\.)?([^:/]+)(?::(\d+|\*))?(\/.*)?$/i);
    if (!match) return false;
    const [, scheme, wildcard, host, port, sourcePath] = match;
    if (scheme && scheme.toLowerCase() !== 'https' && !(scheme.toLowerCase() === 'http' && target.protocol === 'https:')) return false;
    if (!scheme && target.protocol !== 'https:') return false;
    const hostname = target.hostname.toLowerCase();
    const sourceHost = host.toLowerCase();
    if (wildcard ? !hostname.endsWith(`.${sourceHost}`) : hostname !== sourceHost) return false;
    if (port && port !== '*' && Number(port) !== Number(target.port || 443)) return false;
    if (!port && target.port && target.port !== '443') return false;
    if (sourcePath && sourcePath !== '/') {
      return sourcePath.endsWith('/') ? target.pathname.startsWith(sourcePath) : target.pathname === sourcePath;
    }
    return true;
  });
}

/** Problems with one page's HTML (empty when it is clean). */
export function auditSiteAssistantPage(file, html, config) {
  const problems = [];
  const metas = html.match(META_TAG) ?? [];
  if (metas.length !== 1) {
    problems.push(`${file}: ${metas.length} site assistant config tags (expected 1)`);
  }
  for (const meta of metas) {
    const endpoint = attribute(meta, 'data-endpoint');
    const assistant = attribute(meta, 'data-assistant');
    if (endpoint !== config.endpoint) problems.push(`${file}: site assistant endpoint ${endpoint} is not ${config.endpoint}`);
    if (assistant !== config.assistantKey) problems.push(`${file}: site assistant key ${assistant} is not ${config.assistantKey}`);
  }

  const policies = [...html.matchAll(CSP_TAG)].map(match => match[1]);
  if (policies.length !== 1) {
    problems.push(`${file}: ${policies.length} Content-Security-Policy tags (expected 1)`);
  } else {
    const [policy] = policies;
    const scriptSrc = cspDirective(policy, 'script-src') ?? cspDirective(policy, 'default-src') ?? [];
    const connectSrc = cspDirective(policy, 'connect-src') ?? cspDirective(policy, 'default-src') ?? [];
    if (!scriptSrc.includes(config.endpoint)) problems.push(`${file}: script-src does not allow ${config.endpoint}`);
    if (!connectSrc.includes(config.endpoint)) problems.push(`${file}: connect-src does not allow ${config.endpoint}`);
    const checkFrame = `${config.endpoint}${CHECK_FRAME_PATH}`;
    const frameSrc = cspDirective(policy, 'frame-src') ?? cspDirective(policy, 'child-src') ?? cspDirective(policy, 'default-src') ?? ['*'];
    if (!cspSourcesAllow(frameSrc, checkFrame)) problems.push(`${file}: frame-src does not allow the visitor check frame ${checkFrame}`);
    for (const source of scriptSrc) {
      if (UNSAFE_SCRIPT_SOURCES.has(source) || source.includes('*')) problems.push(`${file}: script-src allows ${source}`);
    }
  }

  if (/<solv-chat[\s>]/.test(html)) problems.push(`${file}: the static HTML has a <solv-chat> element`);
  if (html.includes(`${config.endpoint}/widget.js`)) problems.push(`${file}: the static HTML loads ${config.endpoint}/widget.js`);
  return problems;
}

/**
 * Audits dist/ against the production config (`{ endpoint, assistantKey }`,
 * or null when .env.production no longer configures the assistant).
 */
export function auditSiteAssistant(distDir, config) {
  if (!config) {
    return { problems: ['the production build does not configure the site assistant (VITE_SOLV_ENDPOINT and VITE_SOLV_ASSISTANT_KEY in .env.production)'], pages: 0 };
  }
  const site = loadSite(distDir);
  const problems = [];
  let pages = 0;
  for (const file of site.pages.keys()) {
    pages += 1;
    problems.push(...auditSiteAssistantPage(file, fs.readFileSync(path.join(site.root, file), 'utf8'), config));
  }
  if (pages === 0) problems.push('dist/ has no HTML pages');
  return { problems, pages };
}
