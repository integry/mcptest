import fs from 'node:fs';
import path from 'node:path';
import { describe, expect, it } from 'vitest';
import seoGenerator from './generate-seo-pages.js';
import { CLIENT_CHECKLISTS } from '../src/content/mcpTestClientChecklist';
import { MCP_TEST_CLIENT_FAQ } from '../src/content/mcpTestClientCopy';
import { FOOTER_NAVIGATION } from '../src/content/navigationLinks';
import pageMetadata from '../src/data/pageMetadata.json';
import { EXACT_APP_ROUTES, MCP_TEST_CLIENT_PATH, canonicalAliasPath } from '../src/utils/appRoutes';

const { getMcpTestClientStructuredData, getSitemapEntries, loadArticles, renderLlmsTxt } = seoGenerator;

describe('/mcp-test-client build outputs', () => {
  const data = getMcpTestClientStructuredData(pageMetadata.mcpTestClient);
  const byType = Object.fromEntries(data['@graph'].map(node => [node['@type'], node]));

  it('FAQPage JSON-LD carries exactly the questions and answers the page shows', () => {
    expect(byType.FAQPage.mainEntity).toEqual(MCP_TEST_CLIENT_FAQ.map(entry => ({
      '@type': 'Question',
      name: entry.question,
      acceptedAnswer: { '@type': 'Answer', text: entry.answer },
    })));
    expect(byType.WebPage.url).toBe('https://mcptest.io/mcp-test-client');
    const checks = CLIENT_CHECKLISTS.flatMap(checklist => checklist.items);
    expect(byType.HowTo.step.map(step => step.name)).toEqual(checks.map(item => item.check));
    expect(byType.HowTo.step[0].url).toBe(`https://mcptest.io/mcp-test-client#check-${checks[0].id}`);
  });

  it('is an app route, in the sitemap, llms.txt and the footer', () => {
    expect(EXACT_APP_ROUTES).toContain(MCP_TEST_CLIENT_PATH);
    expect(canonicalAliasPath('/mcp-test-client/')).toBe(MCP_TEST_CLIENT_PATH);
    const articles = loadArticles({ reservedPaths: [] });
    expect(getSitemapEntries([], articles).map(entry => entry.pathname)).toContain(MCP_TEST_CLIENT_PATH);
    expect(renderLlmsTxt(articles)).toContain('- [Test your MCP client](https://mcptest.io/mcp-test-client): ');
    expect(FOOTER_NAVIGATION.map(link => link.href)).toContain(MCP_TEST_CLIENT_PATH);
  });

  const distRoot = path.join(__dirname, '..', 'dist');
  const built = path.join(distRoot, 'mcp-test-client', 'index.html');
  it.runIf(fs.existsSync(built))('the built page has the checklist, examples and JSON-LD in its static HTML', () => {
    const html = fs.readFileSync(built, 'utf8');
    expect(html).toContain(`<title>${pageMetadata.mcpTestClient.title}</title>`);
    expect(html).toContain('<link rel="canonical" href="https://mcptest.io/mcp-test-client" />');
    expect(html).toMatch(/<meta property="og:url" content="https:\/\/mcptest.io\/mcp-test-client"/);
    expect(html).toMatch(/<h1 id="mcp-test-client-title">Test your MCP client<\/h1>/);
    expect(html).toContain('"@type":"FAQPage"');
    expect(html).toContain('"@type":"HowTo"');
    for (const item of CLIENT_CHECKLISTS.flatMap(checklist => checklist.items)) expect(html).toContain(`id="check-${item.id}"`);
    expect(html).toContain('notifications/initialized');
    expect(html).toContain('data-deferred-mount');
    expect(fs.readFileSync(path.join(distRoot, 'sitemap.xml'), 'utf8')).toContain('<loc>https://mcptest.io/mcp-test-client</loc>');
    expect(fs.readFileSync(path.join(distRoot, 'routes.txt'), 'utf8').split('\n')).toContain('/mcp-test-client');
    expect(fs.readFileSync(path.join(distRoot, 'llms.txt'), 'utf8')).toContain('https://mcptest.io/mcp-test-client');
  });
});
