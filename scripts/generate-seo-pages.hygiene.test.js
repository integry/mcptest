import fs from 'node:fs';
import { describe, expect, it } from 'vitest';
import seoGenerator from './generate-seo-pages.js';
import criticalCss from './critical-css.js';
import { parseHtml, parseRoutes } from './check-links.mjs';
import { NOT_FOUND_LINKS, canonicalAliasPath, isKnownAppPath } from '../src/utils/appRoutes';

const {
  canonicalUrlFor, getSitemapEntries, loadArticles, render404Html, renderRobotsTxt, renderRoutesTxt,
  renderSitemap, renderStaticPageHtml, setIndexableRobots,
} = seoGenerator;
const { inlineCriticalCss } = criticalCss;

const articles = loadArticles({ reservedPaths: ['/docs/privacy-policy', '/docs/terms-of-service', '/docs/contact'] });
const indexHtml = [
  '<html><head><title>mcptest.io</title>',
  '<link rel="canonical" href="https://mcptest.io" />',
  '<meta property="og:url" content="https://mcptest.io" />',
  '</head><body><div id="root"></div></body></html>',
].join('\n');
const servers = [
  { id: 'alpha', checkedAt: '2026-10-19T23:59:00.000Z' },
  { id: 'beta', checkedAt: '2026-10-20T15:31:51.646Z' },
  { id: 'never-validated' },
];

describe('sitemap entries', () => {
  const entries = getSitemapEntries(servers, articles, ['privacy-policy', 'contact']);
  const byPath = new Map(entries.map(entry => [entry.pathname, entry]));

  it('lists each page once', () => {
    expect(byPath.size).toBe(entries.length);
    expect(entries).toHaveLength(4 + articles.length + 2 + servers.length);
  });

  it('lists the discovery checker without a content date', () => {
    expect(byPath.get('/tools/discovery')).toEqual({ pathname: '/tools/discovery' });
  });

  it('dates articles by lastReviewed and servers by their latest validation, never by the build', () => {
    for (const article of articles) expect(byPath.get(article.path).lastModified).toBe(article.lastReviewed);
    expect(byPath.get('/servers/alpha/').lastModified).toBe('2026-10-19');
    expect(byPath.get('/servers/beta/').lastModified).toBe('2026-10-20');
    expect(byPath.get('/servers/never-validated/').lastModified).toBeUndefined();
    expect(byPath.get('/catalog').lastModified).toBe('2026-10-20');
    const newestGuide = articles.map(article => article.lastReviewed).sort().at(-1);
    expect(byPath.get('/learn').lastModified).toBe(newestGuide);
    expect(byPath.get('/').lastModified).toBe([newestGuide, '2026-10-20'].sort().at(-1));
    expect(byPath.get('/docs/contact').lastModified).toBeUndefined();
  });

  it('leaves out /report, which has no prerendered page', () => {
    expect(byPath.has('/report')).toBe(false);
  });

  it('writes the same URL as the page canonical, and omits lastmod when there is no content date', () => {
    const sitemap = renderSitemap(servers, articles, ['contact']);
    expect(sitemap).toContain('<loc>https://mcptest.io</loc>');
    expect(sitemap).toContain('<loc>https://mcptest.io/docs/contact</loc>\n  </url>');
    expect(sitemap).toContain('<loc>https://mcptest.io/servers/never-validated/</loc>\n  </url>');
    for (const pathname of ['/', '/catalog', articles[0].path]) {
      const { meta } = parseHtml(renderStaticPageHtml(indexHtml, pathname, { title: 'T', description: 'D' }));
      expect(meta.canonical).toEqual([canonicalUrlFor(pathname)]);
      expect(meta.ogUrl).toEqual([canonicalUrlFor(pathname)]);
      expect(sitemap).toContain(`<loc>${canonicalUrlFor(pathname)}</loc>`);
    }
  });
});

describe('robots.txt', () => {
  it('allows everything and points at the sitemap', () => {
    expect(renderRobotsTxt()).toBe('User-agent: *\nAllow: /\n\nSitemap: https://mcptest.io/sitemap.xml\n');
  });
});

describe('404 page', () => {
  const html = render404Html(indexHtml);
  const { meta, links } = parseHtml(html);

  it('is noindex and has no canonical or og:url of its own', () => {
    expect(meta.robots).toEqual(['noindex']);
    expect(meta.canonical).toEqual([]);
    expect(meta.ogUrl).toEqual([]);
    expect(html).toContain('<title>Page Not Found | mcptest.io</title>');
  });

  it('links to the playground, catalog and guides like the NotFound view', () => {
    expect(html).toContain('<h1 id="not-found-title">Page not found</h1>');
    expect(links.map(link => link.value)).toEqual(NOT_FOUND_LINKS.map(link => link.path));
  });
});

describe('robots meta', () => {
  // The shell as the build reads it: the real template plus a stylesheet for the critical-CSS pass.
  const template = fs.readFileSync('index.html', 'utf8')
    .replace('</head>', '<link rel="stylesheet" href="/assets/style.css" />\n</head>');
  const shell = setIndexableRobots(template);
  const finalize = html => inlineCriticalCss(html, () => 'body{margin:0}');
  const robotsOf = html => parseHtml(finalize(html)).meta.robots;

  it('the template carries one indexable robots tag before the app mounts', () => {
    expect(parseHtml(template).meta.robots).toEqual(['index, follow']);
    expect(setIndexableRobots(shell)).toBe(shell);
    expect(parseHtml(setIndexableRobots(indexHtml)).meta.robots).toEqual(['index, follow']);
  });

  it('keeps one index, follow tag on known pages through critical-CSS finalization', () => {
    expect(finalize(shell)).toContain('<style');
    for (const pathname of ['/', '/catalog', '/learn', articles[0].path, '/docs/contact']) {
      expect(robotsOf(renderStaticPageHtml(shell, pathname, { title: 'T', description: 'D' })), pathname).toEqual(['index, follow']);
    }
  });

  it('replaces it with noindex on the 404 page instead of adding a second tag', () => {
    expect(robotsOf(render404Html(shell))).toEqual(['noindex']);
  });
});

describe('routes.txt', () => {
  const routes = parseRoutes(renderRoutesTxt(['/', '/catalog', '/learn/what-is-mcp', '/servers/alpha/']));

  it('lists prerendered pages and app routes exactly, and dynamic routes as prefixes', () => {
    for (const pathname of ['/', '/catalog', '/learn', '/report', '/submit', '/tools/discovery', '/oauth/callback', '/learn/what-is-mcp', '/servers/alpha/']) {
      expect(routes.exact.has(pathname), pathname).toBe(true);
    }
    expect(routes.prefixes).toEqual(['/server/', '/call/', '/space/', '/report/']);
  });

  it('agrees with the app: every listed route has a view', () => {
    for (const pathname of routes.exact) expect(isKnownAppPath(pathname), pathname).toBe(true);
    for (const prefix of routes.prefixes) expect(isKnownAppPath(`${prefix}x`), prefix).toBe(true);
  });
});

describe('isKnownAppPath', () => {
  it.each([
    '/', '/catalog', '/learn', '/learn/', '/learn/what-is-mcp', '/docs/privacy-policy', '/report',
    '/report/x', '/submit', '/servers/github/', '/servers/github', '/server/https://example.com/mcp/mcp',
    '/call/https://example.com/mcp/tool/echo', '/space/my-dashboard', '/oauth/callback', '/install-integration',
  ])('knows %s', pathname => {
    expect(isKnownAppPath(pathname)).toBe(true);
  });

  it.each([
    '/nope', '/catalog/', '/catalogue', '/reports', '/servers/', '/servers/a/b', '/server/', '/space/',
    '/index.html', '/wp-admin', '/docs/',
  ])('does not know %s', pathname => {
    expect(isKnownAppPath(pathname)).toBe(false);
  });
});

describe('canonicalAliasPath', () => {
  // Spellings the host serves as a file (or the shell): the app must show the page, not NotFound.
  it.each([
    ['/index.html', '/'],
    ['/catalog.html', '/catalog'],
    ['/catalog/', '/catalog'],
    ['/tools/discovery.html', '/tools/discovery'],
    ['/tools/discovery/', '/tools/discovery'],
    ['/learn/', '/learn'],
    ['/learn/index.html', '/learn'],
    ['/learn/what-is-mcp/', '/learn/what-is-mcp'],
    ['/learn/what-is-mcp/index.html', '/learn/what-is-mcp'],
    ['/learn/what-is-mcp.html', '/learn/what-is-mcp'],
    ['/docs/privacy-policy/index.html', '/docs/privacy-policy'],
    ['/servers/github/index.html', '/servers/github/'],
    ['/servers/github.html', '/servers/github/'],
    ['/servers/github', '/servers/github/'],
  ])('redirects %s to %s', (alias, canonical) => {
    expect(canonicalAliasPath(alias)).toBe(canonical);
    expect(isKnownAppPath(canonical)).toBe(true);
    expect(canonicalAliasPath(canonical)).toBeNull();
  });

  it.each([
    '/', '/catalog', '/learn/what-is-mcp', '/servers/github/', '/404.html', '/nope.html', '/docs/', '/report/',
    '/server/https://example.com/mcp.html', '/call/https://example.com/mcp/', '/space/x/index.html',
  ])('leaves %s alone', pathname => {
    expect(canonicalAliasPath(pathname)).toBeNull();
  });

  it('maps the .html spelling of every prerendered page in routes.txt back to it', () => {
    const pagePaths = ['/', '/catalog', '/learn', '/learn/what-is-mcp', '/docs/privacy-policy', '/servers/github/'];
    for (const route of [...parseRoutes(renderRoutesTxt(pagePaths)).exact].filter(route => pagePaths.includes(route))) {
      const file = route === '/' ? '/index.html' : route === '/catalog' ? '/catalog.html' : `${route.replace(/\/$/, '')}/index.html`;
      expect(canonicalAliasPath(file), file).toBe(route);
    }
  });
});
