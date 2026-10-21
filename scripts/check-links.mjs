#!/usr/bin/env node

/**
 * Internal link checker for the built site (issue #407).
 *
 * Crawls every HTML page, raw Markdown export and llms.txt in dist/, resolves
 * each internal href, src and social-image URL against the generated files,
 * the app routes in dist/routes.txt and the worker routes in wrangler.toml,
 * and fails on:
 *   - a link to nothing (no file, no app route, no worker route);
 *   - a missing anchor (`#id` that the target page does not contain);
 *   - a non-canonical variant of a page: a trailing-slash mismatch, a
 *     `.html` or `index.html` spelling, `http://` or `www.`.
 *
 * External links are collected and listed, not fetched. `--external` fetches
 * them (HEAD, then GET) with a concurrency limit and a per-request timeout.
 *
 *   node scripts/check-links.mjs [--dist dist] [--list-external]
 *   node scripts/check-links.mjs --external [--concurrency 8] [--timeout 10000]
 */

import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

export const SITE_ORIGIN = 'https://mcptest.io';
const SITE_HOST = new URL(SITE_ORIGIN).hostname;
const projectRoot = path.join(path.dirname(fileURLToPath(import.meta.url)), '..');

const SKIPPED_SCHEMES = /^(mailto|tel|javascript|data|blob|about):/i;
/** Hints that name an origin rather than a document. */
const SKIPPED_LINK_RELS = new Set(['preconnect', 'dns-prefetch']);
const LINK_ATTRIBUTES = { href: ['a', 'area', 'link'], src: ['img', 'script', 'iframe', 'source', 'audio', 'video', 'track', 'embed'] };
const SOCIAL_IMAGE_META = new Set(['og:image', 'twitter:image']);

const ENTITIES = { amp: '&', lt: '<', gt: '>', quot: '"', apos: "'", nbsp: ' ' };

export function decodeEntities(value) {
  return value.replace(/&(#x[0-9a-f]+|#\d+|[a-z]+);/gi, (entity, body) => {
    if (body[0] === '#') {
      const code = body[1] === 'x' || body[1] === 'X' ? parseInt(body.slice(2), 16) : parseInt(body.slice(1), 10);
      return Number.isFinite(code) ? String.fromCodePoint(code) : entity;
    }
    return ENTITIES[body.toLowerCase()] ?? entity;
  });
}

function parseAttributes(source = '') {
  const attributes = {};
  for (const match of source.matchAll(/([^\s"'=<>/]+)(?:\s*=\s*(?:"([^"]*)"|'([^']*)'|([^\s"'=<>`]+)))?/g)) {
    attributes[match[1].toLowerCase()] = decodeEntities(match[2] ?? match[3] ?? match[4] ?? '');
  }
  return attributes;
}

/**
 * Links, element ids and head metadata of one HTML document. Comments and
 * the bodies of <script>, <style>, <template> and <textarea> are skipped, so
 * escaped code samples and JSON-LD are never read as markup.
 */
export function parseHtml(html) {
  const stripped = html
    .replace(/<!--[\s\S]*?-->/g, '')
    .replace(/<(script|style|template|textarea)\b([^>]*)>[\s\S]*?<\/\1\s*>/gi, '<$1$2></$1>');
  const links = [];
  const ids = new Set();
  const meta = { canonical: [], ogUrl: [], robots: [] };
  for (const match of stripped.matchAll(/<([a-zA-Z][\w:-]*)(\s[^>]*)?>/g)) {
    const tag = match[1].toLowerCase();
    const attributes = parseAttributes(match[2]);
    if (attributes.id) ids.add(attributes.id);
    if (tag === 'a' && attributes.name) ids.add(attributes.name);

    const rel = (attributes.rel || '').toLowerCase().split(/\s+/).filter(Boolean);
    if (tag === 'link' && rel.includes('canonical')) meta.canonical.push(attributes.href ?? '');
    if (tag === 'meta' && attributes.property === 'og:url') meta.ogUrl.push(attributes.content ?? '');
    if (tag === 'meta' && attributes.name === 'robots') meta.robots.push(attributes.content ?? '');
    if (tag === 'meta' && SOCIAL_IMAGE_META.has(attributes.property || attributes.name) && attributes.content) {
      links.push({ value: attributes.content, tag, attribute: 'content' });
    }
    if (tag === 'link' && rel.some(value => SKIPPED_LINK_RELS.has(value))) continue;
    for (const [attribute, tags] of Object.entries(LINK_ATTRIBUTES)) {
      if (tags.includes(tag) && attributes[attribute] !== undefined) {
        links.push({ value: attributes[attribute], tag, attribute });
      }
    }
  }
  return { links, ids, meta };
}

/**
 * Link targets in Markdown: inline links and images, reference definitions,
 * autolinks and bare URLs. Fenced code blocks and code spans are skipped.
 */
export function parseMarkdown(markdown) {
  const lines = [];
  let fence = null;
  for (const line of markdown.split('\n')) {
    const opening = line.match(/^\s{0,3}(`{3,}|~{3,})/);
    if (fence) {
      if (opening && opening[1][0] === fence[0] && opening[1].length >= fence.length && !line.trim().slice(opening[1].length)) fence = null;
      continue;
    }
    if (opening) {
      fence = opening[1];
      continue;
    }
    lines.push(line.replace(/(`+)[\s\S]*?\1/g, ''));
  }
  const text = lines.join('\n');
  const values = new Set();
  for (const match of text.matchAll(/\]\(\s*<?([^)\s>]+)>?(?:\s+(?:"[^"]*"|'[^']*'))?\s*\)/g)) values.add(match[1]);
  for (const match of text.matchAll(/^\s{0,3}\[[^\]]+\]:\s*<?(\S+?)>?(?:\s|$)/gm)) values.add(match[1]);
  for (const match of text.matchAll(/<(https?:\/\/[^\s>]+)>/g)) values.add(match[1]);
  for (const match of text.matchAll(/https?:\/\/[^\s<>()[\]"'`]+/g)) values.add(match[0].replace(/[.,;:!?*_]+$/, ''));
  // A bare-URL match inside an inline link is a prefix of the link itself.
  return { links: [...values].map(value => ({ value, tag: 'markdown', attribute: 'link' })) };
}

/**
 * dist/routes.txt: one app route per line, `/path` for an exact path and
 * `/prefix/*` for every path below a prefix. `#` starts a comment.
 */
export function parseRoutes(text) {
  const exact = new Set();
  const prefixes = [];
  for (const raw of text.split('\n')) {
    const line = raw.replace(/#.*/, '').trim();
    if (!line) continue;
    if (line.endsWith('/*')) prefixes.push(line.slice(0, -1));
    else exact.add(line);
  }
  return { exact, prefixes };
}

/** Site paths the Cloudflare worker serves before the static origin (wrangler.toml routes). */
export function parseWorkerRoutes(wranglerToml, host = SITE_HOST) {
  const exact = new Set();
  const prefixes = [];
  for (const match of wranglerToml.matchAll(/pattern\s*=\s*"([^"]+)"/g)) {
    const pattern = match[1];
    if (!pattern.startsWith(`${host}/`)) continue;
    const pathname = pattern.slice(host.length);
    if (pathname.endsWith('*')) prefixes.push(pathname.slice(0, -1));
    else exact.add(pathname);
  }
  return { exact, prefixes };
}

function matchesRoutes(routes, pathname) {
  return routes.exact.has(pathname) || routes.prefixes.some(prefix => pathname.startsWith(prefix) && pathname.length > prefix.length);
}

function walk(directory, base = directory) {
  const files = [];
  for (const entry of fs.readdirSync(directory, { withFileTypes: true })) {
    const full = path.join(directory, entry.name);
    if (entry.isDirectory()) files.push(...walk(full, base));
    else files.push(path.relative(base, full).split(path.sep).join('/'));
  }
  return files;
}

/** The URL path a file in dist/ is served at, before canonicalisation. */
function servedPath(relativePath) {
  if (relativePath === 'index.html') return '/';
  if (relativePath.endsWith('/index.html')) return `/${relativePath.slice(0, -'index.html'.length)}`;
  return `/${relativePath}`;
}

function canonicalPathOf(document) {
  const href = document?.meta?.canonical?.[0];
  if (!href) return null;
  try {
    const url = new URL(href);
    return url.pathname;
  } catch {
    return null;
  }
}

/**
 * Loads dist/: every file's path, parsed HTML pages, Markdown sources, the
 * app routes and the worker routes.
 */
export function loadSite(distDir, { wranglerPath = path.join(projectRoot, 'wrangler.toml') } = {}) {
  const root = path.resolve(distDir);
  const files = new Set(walk(root));
  const pages = new Map();
  const markdown = new Map();
  for (const file of files) {
    if (file.endsWith('.html')) {
      pages.set(file, parseHtml(fs.readFileSync(path.join(root, file), 'utf8')));
    } else if (file.endsWith('.md') || file === 'llms.txt') {
      markdown.set(file, parseMarkdown(fs.readFileSync(path.join(root, file), 'utf8')));
    }
  }
  const routesPath = path.join(root, 'routes.txt');
  if (!fs.existsSync(routesPath)) {
    throw new Error(`${routesPath} is missing; run npm run build (generate-seo writes it).`);
  }
  const routes = parseRoutes(fs.readFileSync(routesPath, 'utf8'));
  const workerRoutes = fs.existsSync(wranglerPath)
    ? parseWorkerRoutes(fs.readFileSync(wranglerPath, 'utf8'))
    : { exact: new Set(), prefixes: [] };
  return { root, files, pages, markdown, routes, workerRoutes };
}

function decodePathname(pathname) {
  try {
    return decodeURI(pathname);
  } catch {
    return pathname;
  }
}

/** The dist file a host serves for `pathname`: the file, a directory index, or a `.html` sibling. */
export function resolveFile(site, pathname) {
  const relative = decodePathname(pathname).replace(/^\/+/, '');
  const candidates = [
    relative,
    relative === '' || relative.endsWith('/') ? `${relative}index.html` : `${relative}/index.html`,
    `${relative.replace(/\/$/, '')}.html`,
  ];
  return candidates.find(candidate => candidate && site.files.has(candidate)) ?? null;
}

const toggleTrailingSlash = pathname => (pathname.endsWith('/') ? pathname.slice(0, -1) : `${pathname}/`);

/**
 * Classifies one link. Returns `{ external: url }`, `{ skip: true }`, `{ ok: true }`
 * or `{ error: message }`.
 */
export function checkLink(site, value, basePath) {
  const trimmed = value.trim();
  if (!trimmed || SKIPPED_SCHEMES.test(trimmed)) return { skip: true };
  let url;
  try {
    url = new URL(trimmed, `${SITE_ORIGIN}${basePath}`);
  } catch {
    return { error: 'unparseable URL' };
  }
  if (url.protocol !== 'http:' && url.protocol !== 'https:') return { skip: true };

  const host = url.hostname.toLowerCase();
  if (host !== SITE_HOST && host !== `www.${SITE_HOST}`) return { external: url.href };
  if (url.protocol === 'http:') return { error: `non-canonical variant: http:// (use ${SITE_ORIGIN}${url.pathname})` };
  if (host !== SITE_HOST) return { error: `non-canonical variant: www (use ${SITE_ORIGIN}${url.pathname})` };

  const pathname = url.pathname;
  const anchor = url.hash ? decodeURIComponent(url.hash.slice(1)) : '';

  // Worker routes win: Cloudflare serves them before the origin is asked.
  if (matchesRoutes(site.workerRoutes, pathname)) return { ok: true };

  const file = resolveFile(site, pathname);
  if (file) {
    const page = site.pages.get(file);
    const canonical = canonicalPathOf(page);
    if (canonical && canonical !== pathname) {
      return { error: `non-canonical variant of ${canonical}` };
    }
    if (anchor && page && !page.ids.has(anchor)) {
      return { error: `missing anchor #${anchor} in ${file}` };
    }
    return { ok: true };
  }

  if (matchesRoutes(site.routes, pathname)) {
    if (anchor) return { error: `cannot verify anchor #${anchor}: ${pathname} is an app route with no prerendered page` };
    return { ok: true };
  }

  const variant = toggleTrailingSlash(pathname);
  if (pathname !== '/' && (resolveFile(site, variant) || site.routes.exact.has(variant))) {
    return { error: `non-canonical variant: trailing slash (use ${variant})` };
  }
  return { error: 'broken link: no file or app route' };
}

/**
 * Checks every internal link in the site. `errors` are failures; `external`
 * maps each external URL to the files that link to it. Throws when there is
 * nothing to check, so an empty or wrong dist/ cannot pass vacuously.
 */
export function checkSite(site) {
  if (site.pages.size === 0) {
    throw new Error(`No HTML documents under ${site.root}; run npm run build or pass the right --dist.`);
  }
  const errors = [];
  const external = new Map();
  let checked = 0;
  let internal = 0;
  const visit = (file, links, basePath) => {
    for (const link of links) {
      const result = checkLink(site, link.value, basePath);
      if (result.skip) continue;
      checked += 1;
      if (result.external) {
        const key = result.external.replace(/#.*$/, '');
        if (!external.has(key)) external.set(key, new Set());
        external.get(key).add(file);
      } else {
        internal += 1;
        if (result.error) errors.push({ file, link: link.value, reason: result.error });
      }
    }
  };
  for (const [file, page] of site.pages) {
    visit(file, page.links, canonicalPathOf(page) ?? servedPath(file));
  }
  for (const [file, document] of site.markdown) {
    // A Markdown export's relative links and bare anchors belong to the page it was rendered into.
    const basePath = file.endsWith('.md') ? `/${file.slice(0, -'.md'.length)}` : '/';
    visit(file, document.links, basePath);
  }
  if (internal === 0) {
    throw new Error(`No checkable internal links in ${site.pages.size + site.markdown.size} files under ${site.root}.`);
  }
  return { errors, external, checked, files: site.pages.size + site.markdown.size };
}

/**
 * Fetches external URLs with at most `concurrency` requests in flight. HEAD
 * first; servers that reject HEAD get a GET. 2xx and 3xx (after redirects)
 * pass; 401, 403 and 429 are reported as "unverified" rather than broken.
 */
export async function checkExternalLinks(urls, { concurrency = 8, timeoutMs = 10_000, fetchImpl = fetch } = {}) {
  const queue = [...urls];
  const results = [];
  const request = async (url, method) => fetchImpl(url, {
    method,
    redirect: 'follow',
    signal: AbortSignal.timeout(timeoutMs),
    headers: { 'User-Agent': 'mcptest.io link checker (+https://mcptest.io)' },
  });
  const worker = async () => {
    while (queue.length) {
      const url = queue.shift();
      let status;
      let error;
      try {
        let response = await request(url, 'HEAD');
        if (response.status >= 400) response = await request(url, 'GET');
        status = response.status;
        await response.body?.cancel?.();
      } catch (caught) {
        error = caught?.name === 'TimeoutError' ? `timed out after ${timeoutMs} ms` : String(caught?.cause?.code || caught?.message || caught);
      }
      const verdict = error ? 'broken'
        : status < 400 ? 'ok'
          : [401, 403, 429].includes(status) ? 'unverified'
            : 'broken';
      results.push({ url, status, error, verdict });
    }
  };
  await Promise.all(Array.from({ length: Math.max(1, Math.min(concurrency, queue.length)) }, worker));
  return results.sort((a, b) => a.url.localeCompare(b.url));
}

function parseArgs(argv) {
  const options = { dist: 'dist', external: false, listExternal: false, concurrency: 8, timeout: 10_000 };
  for (let index = 0; index < argv.length; index += 1) {
    const flag = argv[index];
    if (flag === '--dist') options.dist = argv[++index];
    else if (flag === '--external') options.external = true;
    else if (flag === '--list-external') options.listExternal = true;
    else if (flag === '--concurrency') options.concurrency = Number(argv[++index]);
    else if (flag === '--timeout') options.timeout = Number(argv[++index]);
    else throw new Error(`Unknown option ${flag}`);
  }
  return options;
}

async function main() {
  const options = parseArgs(process.argv.slice(2));
  const site = loadSite(options.dist);
  const { errors, external, checked, files } = checkSite(site);

  console.log(`Checked ${checked} links in ${files} files under ${options.dist}/.`);
  console.log(`${external.size} distinct external URLs (not fetched${options.external ? ' by the internal check' : '; run npm run check-links:external'}).`);
  if (options.listExternal) {
    for (const [url, sources] of [...external].sort(([a], [b]) => a.localeCompare(b))) {
      console.log(`  ${url}  (${sources.size} ${sources.size === 1 ? 'file' : 'files'})`);
    }
  }

  if (errors.length) {
    console.error(`\n${errors.length} internal link problem${errors.length === 1 ? '' : 's'}:`);
    for (const { file, link, reason } of errors) console.error(`  ${file}: ${link}\n      ${reason}`);
    process.exitCode = 1;
  } else {
    console.log('No broken internal links, missing anchors or non-canonical variants.');
  }

  if (options.external) {
    console.log(`\nFetching ${external.size} external URLs (concurrency ${options.concurrency}, timeout ${options.timeout} ms)...`);
    const results = await checkExternalLinks([...external.keys()], {
      concurrency: options.concurrency,
      timeoutMs: options.timeout,
    });
    const broken = results.filter(result => result.verdict === 'broken');
    const unverified = results.filter(result => result.verdict === 'unverified');
    for (const result of unverified) console.warn(`  unverified (${result.status}): ${result.url}`);
    for (const result of broken) {
      console.error(`  broken (${result.error || result.status}): ${result.url}\n      linked from ${[...external.get(result.url)].slice(0, 3).join(', ')}`);
    }
    console.log(`${results.length - broken.length - unverified.length} ok, ${unverified.length} unverified, ${broken.length} broken.`);
    if (broken.length) process.exitCode = 1;
  }
}

if (process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  main().catch(error => {
    console.error(error.message || error);
    process.exitCode = 1;
  });
}
