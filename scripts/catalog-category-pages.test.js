// @vitest-environment node
import { describe, expect, it } from 'vitest';
import seoGenerator from './generate-seo-pages.js';
import catalogSeeds from '../src/data/serverCatalog.json';
import catalogValidation from '../src/data/catalogValidation.json';
import catalogCapabilities from '../src/data/catalogCapabilities.json';
import pageMetadata from '../src/data/pageMetadata.json';
import {
  getCatalogCategoryIntro,
  getCatalogCategoryNeighbors,
  summarizeCatalogCategories,
} from '../src/utils/catalogCategories';
import { CATEGORY_GUIDES } from '../src/content/categoryGuides';

const { buildOgCards, loadArticles, mergeCatalogServers, renderCategoryHtml, renderServerHtml, renderSitemap } = seoGenerator;
const indexHtml = '<html><head><title>mcptest.io</title></head><body><div id="root"></div></body></html>';
const articles = loadArticles({ reservedPaths: Object.keys(pageMetadata.docs).map(slug => `/docs/${slug}`) });
const servers = mergeCatalogServers(catalogSeeds, catalogValidation, catalogCapabilities);
const summaries = summarizeCatalogCategories(servers);
const categories = summaries.map(summary => summary.category);

const structuredData = html => JSON.parse(
  html.match(/<script id="server-structured-data" type="application\/ld\+json">(.*?)<\/script>/)?.[1] || 'null'
);
const decode = value => value.replace(/&amp;/g, '&').replace(/&quot;/g, '"').replace(/&lt;/g, '<').replace(/&gt;/g, '>');

describe('prerendered catalog category pages', () => {
  it('cover every catalog category once, with unique slugs and the right server counts', () => {
    expect(new Set(catalogSeeds.map(seed => seed.category)).size).toBe(summaries.length);
    expect(new Set(summaries.map(summary => summary.slug)).size).toBe(summaries.length);
    expect(summaries.reduce((total, summary) => total + summary.count, 0)).toBe(catalogSeeds.length);
    for (const summary of summaries) {
      expect(summary.path).toMatch(/^\/catalog\/[a-z0-9]+(?:-[a-z0-9]+)*$/);
      expect(summary.count).toBe(catalogSeeds.filter(seed => seed.category === summary.category).length);
    }
    expect(summaries.find(summary => summary.category === 'Databases')?.path).toBe('/catalog/databases');
    expect(summaries.find(summary => summary.category === 'Developer Tools')?.path).toBe('/catalog/developer-tools');
  });

  it('renders each page with its own title, description, canonical URL, OG card and rows', () => {
    for (const summary of summaries) {
      const html = renderCategoryHtml(indexHtml, summary, { summaries, servers, articles });
      const canonical = `https://mcptest.io${summary.path}`;

      expect(html).toContain(`<title>${summary.category} MCP Servers | mcptest.io</title>`);
      expect(html).toContain(`<link rel="canonical" href="${canonical}" />`);
      expect(html).toContain(`property="og:image" content="https://mcptest.io/og/catalog/${summary.slug}.png"`);
      expect(decode(html.match(/<meta name="description" content="([^"]*)"/)?.[1] || '')).toMatch(
        new RegExp(`^${summary.count} remote ${summary.category} MCP servers?[,:] `)
      );
      expect(html).toContain(`<h1 class="mb-1">${summary.category.replace(/&/g, '&amp;')} MCP servers</h1>`);
      expect(decode(html)).toContain(getCatalogCategoryIntro(summary).join(' '));
      expect(html.match(/<li class="catalog-server-list-item">/g)).toHaveLength(summary.count);
      expect(html).toContain(`aria-current="page"><span>${summary.category}</span><span aria-label="${summary.count} servers">`);
      expect(html.match(/class="catalog-category-option"/g)).toHaveLength(summaries.length + 1);
    }
  });

  it('emits valid CollectionPage structured data listing the category servers', () => {
    const summary = summaries.find(item => item.category === 'Databases');
    const data = structuredData(renderCategoryHtml(indexHtml, summary, { summaries, servers, articles }));

    expect(data['@context']).toBe('https://schema.org');
    expect(data['@type']).toBe('CollectionPage');
    expect(data.url).toBe('https://mcptest.io/catalog/databases');
    expect(data.breadcrumb.itemListElement.map(item => item.item)).toEqual([
      'https://mcptest.io/catalog',
      'https://mcptest.io/catalog/databases',
    ]);
    expect(data.mainEntity['@type']).toBe('ItemList');
    expect(data.mainEntity.numberOfItems).toBe(summary.count);
    expect(data.mainEntity.itemListElement).toEqual(summary.serverIds.map((id, index) => ({
      '@type': 'ListItem',
      position: index + 1,
      name: summary.serverNames[index],
      url: `https://mcptest.io/servers/${id}/`,
    })));
  });

  it('links each page to its guides and its neighboring categories', () => {
    const summary = summaries.find(item => item.category === 'Databases');
    const html = renderCategoryHtml(indexHtml, summary, { summaries, servers, articles });
    const { previous, next } = getCatalogCategoryNeighbors(categories, 'Databases');

    for (const slug of CATEGORY_GUIDES.Databases) {
      const article = articles.find(item => item.slug === slug);
      expect(html).toContain(`<a href="${article.path}">`);
    }
    expect(html).toContain('<a href="/learn/convert-local-stdio-mcp-server-to-remote">');
    expect(html).toContain(`rel="prev"><i class="bi bi-arrow-left" aria-hidden="true"></i> ${previous}</a>`);
    expect(html).toContain(`rel="next">${next} <i class="bi bi-arrow-right" aria-hidden="true"></i></a>`);
  });

  it('lists every category page in the sitemap exactly once', () => {
    const sitemap = renderSitemap(servers, articles);
    for (const summary of summaries) {
      expect(sitemap.split(`<loc>https://mcptest.io${summary.path}</loc>`)).toHaveLength(2);
    }
    expect(sitemap).toContain('<loc>https://mcptest.io/catalog</loc>');
  });

  it('builds one Open Graph card per category', () => {
    const cards = buildOgCards({ servers, articles, pageMetadata });
    for (const summary of summaries) {
      const matching = cards.filter(card => card.pagePath === summary.path);
      expect(matching).toHaveLength(1);
      expect(matching[0].title).toBe(`${summary.category} MCP servers`);
      expect(matching[0].summary).toMatch(new RegExp(`^${summary.count} remote`));
    }
  });
});

describe('prerendered server tool inventory', () => {
  it('lists observed tools with schema summaries, the snapshot date and a featureList', () => {
    const server = servers.find(item => item.id === 'astro-docs');
    const html = renderServerHtml(indexHtml, server);
    const data = structuredData(html);
    const tool = server.capabilityInventory.tools.items[0];

    expect(html).toContain('<h2 id="server-tool-inventory-title">Tool inventory</h2>');
    expect(html).toContain('What the catalog validator observed on <time datetime="');
    expect(html).toContain(`<code class="server-tool-name">${tool.name}</code>`);
    expect(html).toContain('<details class="server-tool-schema"><summary><span class="server-tool-schema-label">Input</span> <code>query: string</code></summary>');
    expect(html).toMatch(/class="server-tool-output[^"]*">(outputSchema declared|No outputSchema|outputSchema not recorded)</);
    expect(html).toContain('<a href="/catalog/documentation">Documentation</a>');
    expect(data['@type']).toEqual(['WebAPI', 'SoftwareApplication']);
    expect(data.featureList.map(entry => entry.split(':')[0])).toEqual(
      server.capabilityInventory.tools.items.map(item => item.name)
    );
    expect(data.additionalProperty).toContainEqual({
      '@type': 'PropertyValue', name: 'Tool inventory observed at', value: server.capabilityInventory.observedAt,
    });
  });

  it('says authorization is required instead of rendering nothing when no snapshot exists', () => {
    const server = servers.find(item => item.id === 'github');
    expect(server.capabilityInventory).toBeUndefined();
    const html = renderServerHtml(indexHtml, server);
    const data = structuredData(html);

    expect(html).toContain('<strong>Requires authorization; inventory not observed</strong>');
    expect(html).not.toContain('class="server-tool-list"');
    expect(data).not.toHaveProperty('featureList');
    expect(data.additionalProperty).toContainEqual({
      '@type': 'PropertyValue', name: 'Tool inventory', value: 'Requires authorization; inventory not observed',
    });
  });

  it('gives every catalog server either an inventory or an explanation', () => {
    for (const server of servers) {
      const html = renderServerHtml(indexHtml, server);
      expect(html, server.id).toContain('id="server-tool-inventory-title"');
      expect(
        html.includes('class="server-tool-inventory-provenance"') || html.includes('class="server-tool-inventory-missing"'),
        server.id
      ).toBe(true);
      expect(() => structuredData(html), server.id).not.toThrow();
    }
  });
});
