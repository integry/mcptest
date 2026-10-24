// @vitest-environment node
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { afterAll, describe, expect, it } from 'vitest';
import { auditSite, isBlockedByRobots, parseRobots, parseSitemap } from './audit-site.mjs';
import { checkSite, loadSite } from './check-links.mjs';

const projectRoot = path.join(path.dirname(fileURLToPath(import.meta.url)), '..');
const readJson = relative => JSON.parse(fs.readFileSync(path.join(projectRoot, relative), 'utf8'));
const temporaryDirectories = [];
afterAll(() => {
  for (const directory of temporaryDirectories) fs.rmSync(directory, { recursive: true, force: true });
});

const head = (url, { ogUrl = url, robots } = {}) => [
  `<link rel="canonical" href="${url}" />`,
  `<meta property="og:url" content="${ogUrl}" />`,
  robots ? `<meta name="robots" content="${robots}" />` : '',
].join('');
const sitemapXml = locs => `<?xml version="1.0"?><urlset>${locs.map(loc => `<url><loc>${loc}</loc><lastmod>2026-10-20</lastmod></url>`).join('')}</urlset>`;

function writeSite(overrides = {}) {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'audit-site-'));
  temporaryDirectories.push(root);
  const files = {
    'index.html': `<head>${head('https://mcptest.io')}</head>`,
    'catalog.html': `<head>${head('https://mcptest.io/catalog')}</head>`,
    'servers/alpha/index.html': `<head>${head('https://mcptest.io/servers/alpha/')}</head>`,
    '404.html': '<head><meta name="robots" content="noindex"></head>',
    'routes.txt': '/\n/catalog\n',
    'sitemap.xml': sitemapXml(['https://mcptest.io', 'https://mcptest.io/catalog', 'https://mcptest.io/servers/alpha/']),
    'robots.txt': 'User-agent: *\nAllow: /\n\nSitemap: https://mcptest.io/sitemap.xml\n',
    ...overrides,
  };
  for (const [file, contents] of Object.entries(files)) {
    if (contents === null) continue;
    fs.mkdirSync(path.dirname(path.join(root, file)), { recursive: true });
    fs.writeFileSync(path.join(root, file), contents);
  }
  return root;
}

describe('robots.txt rules', () => {
  const robots = parseRobots([
    'User-agent: Googlebot',
    'User-agent: Bingbot',
    'Disallow: /private',
    'Allow: /private/public',
    '',
    'User-agent: *',
    'Disallow: /*.json$',
    'Disallow:',
    'Sitemap: https://mcptest.io/sitemap.xml',
  ].join('\n'));

  it('parses groups and sitemaps', () => {
    expect(robots.groups.map(group => group.agents)).toEqual([['googlebot', 'bingbot'], ['*']]);
    expect(robots.sitemaps).toEqual(['https://mcptest.io/sitemap.xml']);
  });

  it('applies the longest match, wildcards and end anchors', () => {
    expect(isBlockedByRobots(robots, '/private/x')).toBe(true);
    expect(isBlockedByRobots(robots, '/private/public/x')).toBe(false);
    expect(isBlockedByRobots(robots, '/learn/feed.json')).toBe(true);
    expect(isBlockedByRobots(robots, '/learn/feed.json.html')).toBe(false);
    expect(isBlockedByRobots(robots, '/catalog')).toBe(false);
  });
});

describe('auditSite on fixtures', () => {
  it('passes a consistent site', () => {
    expect(auditSite(writeSite()).problems).toEqual([]);
  });

  it.each([
    ['a page missing from the sitemap', { 'sitemap.xml': sitemapXml(['https://mcptest.io', 'https://mcptest.io/catalog']) },
      'servers/alpha/index.html (https://mcptest.io/servers/alpha/) is missing from the sitemap'],
    ['a duplicate sitemap entry', { 'sitemap.xml': sitemapXml(['https://mcptest.io', 'https://mcptest.io/catalog', 'https://mcptest.io/catalog', 'https://mcptest.io/servers/alpha/']) },
      'sitemap lists https://mcptest.io/catalog 2 times'],
    ['a sitemap URL with no page', { 'sitemap.xml': sitemapXml(['https://mcptest.io', 'https://mcptest.io/catalog', 'https://mcptest.io/servers/alpha/', 'https://mcptest.io/report']) },
      'sitemap lists https://mcptest.io/report, which is no prerendered page\'s canonical URL'],
    ['a sitemap URL in a non-canonical form', { 'sitemap.xml': sitemapXml(['https://mcptest.io', 'https://mcptest.io/catalog', 'https://mcptest.io/servers/alpha']) },
      'sitemap lists https://mcptest.io/servers/alpha, which is no prerendered page\'s canonical URL'],
    ['a noindex page in the sitemap', { 'catalog.html': `<head>${head('https://mcptest.io/catalog', { robots: 'noindex, follow' })}</head>` },
      'catalog.html is noindex but the sitemap lists https://mcptest.io/catalog'],
    ['og:url disagreeing with the canonical', { 'catalog.html': `<head>${head('https://mcptest.io/catalog', { ogUrl: 'https://mcptest.io/catalog/' })}</head>` },
      'catalog.html: og:url https://mcptest.io/catalog/ differs from canonical https://mcptest.io/catalog'],
    ['a canonical that is another page', { 'servers/alpha/index.html': `<head>${head('https://mcptest.io/catalog')}</head>` },
      'servers/alpha/index.html: canonical https://mcptest.io/catalog is served from catalog.html'],
    ['a canonical no file is served at', { 'servers/alpha/index.html': `<head>${head('https://mcptest.io/servers/beta/')}</head>` },
      'servers/alpha/index.html: canonical https://mcptest.io/servers/beta/ is served from no file'],
    ['a www canonical', { 'catalog.html': `<head>${head('https://www.mcptest.io/catalog')}</head>` },
      'catalog.html: canonical https://www.mcptest.io/catalog is not a bare https://mcptest.io URL'],
    ['robots.txt blocking an indexable page', { 'robots.txt': 'User-agent: *\nDisallow: /servers/\nSitemap: https://mcptest.io/sitemap.xml\n' },
      'robots.txt blocks https://mcptest.io/servers/alpha/'],
    ['robots.txt without the sitemap', { 'robots.txt': 'User-agent: *\nAllow: /\n' },
      'robots.txt does not reference https://mcptest.io/sitemap.xml'],
    ['an indexable 404 page', { '404.html': `<head>${head('https://mcptest.io/404')}</head>` },
      '404.html is not noindex'],
  ])('reports %s', (_label, overrides, problem) => {
    expect(auditSite(writeSite(overrides)).problems).toContain(problem);
  });
});

/**
 * The built site. Needs `npm run build` first, so it runs from
 * `npm run test:site-audit` (CI runs it after the build) rather than with the
 * unit tests.
 */
describe.skipIf(!process.env.SITE_AUDIT)('sitemap, robots and canonical audit of dist/', () => {
  const distDir = path.join(projectRoot, 'dist');

  it('has one canonical URL per page, matching og:url and the sitemap, and robots.txt blocks none of them', () => {
    const { problems } = auditSite(distDir);
    expect(problems).toEqual([]);
  });

  it('dates guides by lastReviewed and server pages by their latest catalog validation', () => {
    const { sitemap } = auditSite(distDir);
    const lastmod = new Map(sitemap.map(entry => [new URL(entry.loc).pathname, entry.lastmod]));
    // Every guide: the HTML and Markdown pages under learn/ and docs/ that show a review date.
    const guides = [...loadSite(distDir).pages.keys()].filter(file => /^(learn|docs)\/[^/]+\/index\.html$/.test(file));
    let dated = 0;
    for (const file of guides) {
      const reviewed = fs.readFileSync(path.join(distDir, file), 'utf8').match(/Last reviewed <time datetime="(\d{4}-\d{2}-\d{2})"/)?.[1];
      if (!reviewed) continue;
      dated += 1;
      const pagePath = `/${file.slice(0, -'/index.html'.length)}`;
      expect(lastmod.get(pagePath), pagePath).toBe(reviewed);
    }
    expect(dated).toBeGreaterThan(30);

    const checkedAt = new Map(readJson('src/data/catalogValidation.json').map(result => [result.serverId, result.checkedAt]));
    for (const { id } of readJson('src/data/serverCatalog.json')) {
      const pagePath = `/servers/${encodeURIComponent(id)}/`;
      expect(lastmod.has(pagePath), pagePath).toBe(true);
      expect(lastmod.get(pagePath), pagePath).toBe(checkedAt.get(id)?.slice(0, 10));
    }
    expect(lastmod.get('/catalog')).toBe([...checkedAt.values()].sort().at(-1).slice(0, 10));
  });

  it('serves a noindex 404 page and lists every prerendered page as a known route', () => {
    const site = loadSite(distDir);
    expect(site.pages.get('404.html').meta.robots).toEqual(['noindex']);
    for (const { loc } of parseSitemap(fs.readFileSync(path.join(distDir, 'sitemap.xml'), 'utf8'))) {
      expect(site.routes.exact.has(new URL(loc).pathname), loc).toBe(true);
    }
  });

  it('has no broken internal links', () => {
    expect(checkSite(loadSite(distDir)).errors).toEqual([]);
  });
});
