import fs from 'node:fs';
import path from 'node:path';
import { describe, expect, it } from 'vitest';
import seoGenerator from './generate-seo-pages.js';
import pageMetadata from '../src/data/pageMetadata.json';
import { SERVICE_PAGE_PATH, isKnownAppPath } from '../src/utils/appRoutes';
import { ESTIMATE_NOTE, taxNote } from '../src/content/servicePageCopy';

const {
  buildOgCards,
  getServicePageStructuredData,
  getSitemapEntries,
  loadArticles,
  renderAppShell,
  renderRoutesTxt,
  renderSiteFooter,
  renderSitemap,
} = seoGenerator;

const parseRoutes = text => text.split('\n').filter(line => line && !line.startsWith('#'));

describe('/mcp-server-development build outputs', () => {
  const articles = loadArticles({ reservedPaths: [] });

  it.each([false, true])('is in the sitemap, routes.txt, footer and OG cards only with the flag (flag %s)', servicePage => {
    const options = { servicePage };
    const entries = getSitemapEntries([], articles, [], options).map(entry => entry.pathname);
    expect(entries.filter(pathname => pathname === SERVICE_PAGE_PATH)).toHaveLength(servicePage ? 1 : 0);
    expect(renderSitemap([], articles, [], options).includes(`<loc>https://mcptest.io${SERVICE_PAGE_PATH}</loc>`)).toBe(servicePage);

    const routes = parseRoutes(renderRoutesTxt(entries, options));
    expect(routes.filter(route => route === SERVICE_PAGE_PATH)).toHaveLength(servicePage ? 1 : 0);
    // routes.txt and the app agree either way.
    expect(isKnownAppPath(SERVICE_PAGE_PATH, options)).toBe(servicePage);

    expect(renderSiteFooter(options).includes(`href="${SERVICE_PAGE_PATH}"`)).toBe(servicePage);
    expect(renderAppShell({ content: '', view: 'catalog', pathname: '/catalog', servicePage }).includes(`href="${SERVICE_PAGE_PATH}"`)).toBe(servicePage);

    const cards = buildOgCards({ servers: [], articles, pageMetadata, servicePage }).map(card => card.pagePath);
    expect(cards.includes(SERVICE_PAGE_PATH)).toBe(servicePage);
  });

  it('has page metadata and JSON-LD without prices', () => {
    expect(pageMetadata.serviceDevelopment.title).toMatch(/\| mcptest\.io$/);
    expect(pageMetadata.serviceDevelopment.description.length).toBeLessThanOrEqual(160);
    const data = getServicePageStructuredData(pageMetadata.serviceDevelopment);
    expect(data['@graph'].map(node => node['@type'])).toEqual(['WebPage', 'Service']);
    expect(data['@graph'][0].url).toBe('https://mcptest.io/mcp-server-development');
    expect(JSON.stringify(data)).not.toMatch(/price/i);
  });

  const distRoot = path.join(__dirname, '..', 'dist');
  const built = path.join(distRoot, 'mcp-server-development', 'index.html');
  const routesPath = path.join(distRoot, 'routes.txt');
  const hasBuild = fs.existsSync(routesPath);
  const builtWithPage = hasBuild && fs.readFileSync(routesPath, 'utf8').split('\n').includes(SERVICE_PAGE_PATH);

  it.runIf(hasBuild && !builtWithPage)('a build without the flag has no page file, sitemap entry or footer link', () => {
    expect(fs.existsSync(built)).toBe(false);
    expect(fs.readFileSync(path.join(distRoot, 'sitemap.xml'), 'utf8')).not.toContain(SERVICE_PAGE_PATH);
    expect(fs.readFileSync(path.join(distRoot, 'catalog.html'), 'utf8')).not.toContain(`href="${SERVICE_PAGE_PATH}"`);
  });

  it.runIf(builtWithPage)('a build with the flag prerenders the page with its metadata and neutral prices', () => {
    const html = fs.readFileSync(built, 'utf8');
    expect(new DOMParser().parseFromString(html, 'text/html').title).toBe(pageMetadata.serviceDevelopment.title);
    expect(html).toContain('<link rel="canonical" href="https://mcptest.io/mcp-server-development" />');
    expect(html).toContain('<h1 id="service-page-title">MCP server development</h1>');
    expect(html).toContain('"@type":"Service"');
    expect(html).not.toContain('data-deferred-mount');
    // The neutral prices carry the tax and estimate notes in the static HTML too.
    expect(html).toContain(`<p class="service-offer-note" data-note="tax">${taxNote(null)}</p>`);
    expect(html).toContain(`<p class="service-offer-note" data-note="estimate">${ESTIMATE_NOTE}</p>`);
    expect(fs.readFileSync(path.join(distRoot, 'sitemap.xml'), 'utf8')).toContain('<loc>https://mcptest.io/mcp-server-development</loc>');
    expect(fs.readFileSync(path.join(distRoot, 'catalog.html'), 'utf8')).toContain(`href="${SERVICE_PAGE_PATH}"`);
  });
});
