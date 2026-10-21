import { describe, expect, it } from 'vitest';
import seoGenerator from './generate-seo-pages.js';
import { parseHtml, parseRoutes } from './check-links.mjs';
import { NOT_FOUND_LINKS, isKnownAppPath } from '../src/utils/appRoutes';

const {
  canonicalUrlFor, getSitemapEntries, loadArticles, render404Html, renderRobotsTxt, renderRoutesTxt,
  renderSitemap, renderStaticPageHtml,
} = seoGenerator;

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
    expect(entries).toHaveLength(3 + articles.length + 2 + servers.length);
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

describe('routes.txt', () => {
  const routes = parseRoutes(renderRoutesTxt(['/', '/catalog', '/learn/what-is-mcp', '/servers/alpha/']));

  it('lists prerendered pages and app routes exactly, and dynamic routes as prefixes', () => {
    for (const pathname of ['/', '/catalog', '/learn', '/report', '/submit', '/oauth/callback', '/learn/what-is-mcp', '/servers/alpha/']) {
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
