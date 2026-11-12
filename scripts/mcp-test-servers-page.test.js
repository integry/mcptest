import fs from 'node:fs';
import path from 'node:path';
import { describe, expect, it } from 'vitest';
import seoGenerator from './generate-seo-pages.js';
import { MCP_TEST_SERVERS_FAQ } from '../src/content/mcpTestServersCopy';
import { PUBLIC_FIXTURES } from '../src/data/publicFixtures';
import pageMetadata from '../src/data/pageMetadata.json';
import { EXACT_APP_ROUTES, MCP_TEST_SERVERS_PATH, canonicalAliasPath } from '../src/utils/appRoutes';

const { getMcpTestServersStructuredData, getSitemapEntries, loadArticles, renderLlmsTxt } = seoGenerator;

describe('/mcp-test-servers build outputs', () => {
  const data = getMcpTestServersStructuredData(pageMetadata.mcpTestServers);
  const byType = Object.fromEntries(data['@graph'].map(node => [node['@type'], node]));

  it('FAQPage JSON-LD carries exactly the questions and answers the page shows', () => {
    expect(byType.FAQPage.mainEntity).toEqual(MCP_TEST_SERVERS_FAQ.map(entry => ({
      '@type': 'Question',
      name: entry.question,
      acceptedAnswer: { '@type': 'Answer', text: entry.answer },
    })));
    expect(byType.WebPage.url).toBe('https://mcptest.io/mcp-test-servers');
    expect(byType.ItemList.itemListElement.map(item => item.url)).toEqual(PUBLIC_FIXTURES.map(fixture => fixture.url));
  });

  it('is an app route, in the sitemap and in llms.txt with every fixture endpoint', () => {
    expect(EXACT_APP_ROUTES).toContain(MCP_TEST_SERVERS_PATH);
    expect(canonicalAliasPath('/mcp-test-servers/')).toBe(MCP_TEST_SERVERS_PATH);
    const articles = loadArticles({ reservedPaths: [] });
    expect(getSitemapEntries([], articles).map(entry => entry.pathname)).toContain(MCP_TEST_SERVERS_PATH);
    const llms = renderLlmsTxt(articles);
    expect(llms).toContain('- [Public MCP test servers](https://mcptest.io/mcp-test-servers): ');
    for (const fixture of PUBLIC_FIXTURES) expect(llms).toContain(`(${fixture.url})`);
  });

  const built = path.join(__dirname, '..', 'dist', 'mcp-test-servers', 'index.html');
  it.runIf(fs.existsSync(built))('the built page has the copy, snippets and JSON-LD in its static HTML', () => {
    const html = fs.readFileSync(built, 'utf8');
    expect(html).toContain('<title>Free Public MCP Test Servers: Echo, Auth, Errors | mcptest.io</title>');
    expect(html).toMatch(/<h1 id="mcp-test-servers-title">Public MCP test servers<\/h1>/);
    expect(html).toContain('"@type":"FAQPage"');
    for (const fixture of PUBLIC_FIXTURES) {
      expect(html).toContain(fixture.url);
      expect(html).toContain(`href="/server/mcptest.io/fixtures/${fixture.id}/mcp"`);
    }
    expect(html).toContain('data-deferred-mount');
  });
});
