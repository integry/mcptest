import { describe, expect, it } from 'vitest';
import type { CatalogServer } from '../types/catalog';
import {
  getCatalogServerTitle,
  getCatalogAuthAnswer,
  formatCatalogAuth,
  formatCatalogTimestamp,
  formatCatalogTransport,
  formatProtocolEra,
  getCatalogServerMetaDescription,
  getCatalogServerImageUrl,
  getCatalogServerIdFromPath,
  getCatalogServerPath,
  getCatalogServerSeo,
} from './catalogSeo';

const server: CatalogServer = {
  id: 'example-server',
  name: 'Example',
  url: 'https://example.com/mcp',
  description: 'An example remote MCP server.',
  category: 'Developer Tools',
  tags: ['example', 'tools'],
  listingSource: { kind: 'community' },
  declaredTransport: 'streamable-http',
  transport: 'unknown',
  requiresOAuth: true,
  declaredAuthType: 'oauth',
  authType: 'oauth',
  protocolEra: 'unknown',
  status: 'unknown',
  logoUrl: '/server-logos/example.svg',
  logoSourceKind: 'generated-fallback',
  logoRetrievedAt: '2026-08-17',
};

describe('catalog SEO helpers', () => {
  it('builds and parses canonical server paths', () => {
    expect(getCatalogServerPath(server.id)).toBe('/servers/example-server/');
    expect(getCatalogServerIdFromPath('/servers/example-server')).toBe(server.id);
    expect(getCatalogServerIdFromPath('/servers/example-server/')).toBe(server.id);
    expect(getCatalogServerIdFromPath('/catalog/example-server')).toBeNull();
  });

  it('uses server capabilities in metadata when validation is pending', () => {
    const seo = getCatalogServerSeo(server);

    expect(formatCatalogTransport(server.declaredTransport)).toBe('Streamable HTTP');
    expect(formatCatalogAuth(server.authType)).toBe('OAuth 2.1');
    expect(formatProtocolEra(server.protocolEra)).toBe('Not yet negotiated');
    expect(seo.description).toBe(
      'Connect to the Example MCP server at example.com with OAuth sign-in. An example remote MCP server.'
    );
    expect(seo.canonicalUrl).toBe('https://mcptest.io/servers/example-server/');
    expect(seo.structuredData.endpointUrl).toBe(server.url);
  });

  it('formats report timestamps without database-style seconds', () => {
    expect(formatCatalogTimestamp('2026-08-18T12:32:48')).toBe('Aug 18, 2026 at 12:32 PM');
    expect(formatCatalogTimestamp('not-a-date')).toBe('not-a-date');
  });

  it('uses a curated search summary when the catalog provides one', () => {
    const seoDescription = 'Inspect the Example MCP server. Explore example tools and resources.';

    expect(getCatalogServerMetaDescription({ ...server, seoDescription })).toBe(`Connect to the Example MCP server at example.com with OAuth sign-in. Inspect the Example MCP server.`);
    expect(getCatalogServerSeo({ ...server, seoDescription }).description).toBe(`Connect to the Example MCP server at example.com with OAuth sign-in. Inspect the Example MCP server.`);
  });

  it('uses setup titles, dropping setup before shortening a long name', () => {
    expect(getCatalogServerTitle('Docusign Developer')).toBe('Docusign Developer MCP Server: URL, Auth | mcptest.io');
    expect(getCatalogServerTitle('Canva')).toBe('Canva MCP Server: URL, Auth & Setup | mcptest.io');
    expect(getCatalogServerTitle('A moderately long name')).toBe('A moderately long name MCP Server: URL, Auth | mcptest.io');
    for (const name of ['DocuSign Developer', 'A'.repeat(100)]) {
      expect(getCatalogServerTitle(name).length).toBeLessThanOrEqual(60);
      expect(getCatalogServerTitle(name)).not.toContain('& Setup');
    }
  });

  it('keeps unknown authentication explicit rather than guessing from declarations', () => {
    expect(getCatalogAuthAnswer({ ...server, authType: 'unknown' }).label).toBe('Auth not yet verified');
    expect(getCatalogServerMetaDescription({ ...server, authType: 'none' })).toContain('without authentication');
    expect(getCatalogServerMetaDescription({ ...server, authType: 'api-key' })).toContain('an API key header');
  });

  it('drops summary sentences rather than clipping words or adding ellipses', () => {
    const firstSentence = 'Whole words remain readable when the summary is long.';
    const description = getCatalogServerMetaDescription({ ...server, seoDescription: `${firstSentence} `.repeat(8) });
    expect(description).toBe(`Connect to the Example MCP server at example.com with OAuth sign-in. ${firstSentence}`);
    expect(getCatalogServerMetaDescription({ ...server, seoDescription: 'A'.repeat(200) }))
      .toBe('Connect to the Example MCP server at example.com with OAuth sign-in.');
    expect(getCatalogServerMetaDescription({ ...server, seoDescription: 'Complete sentence. Now debug your…' }))
      .toBe('Connect to the Example MCP server at example.com with OAuth sign-in. Complete sentence.');
  });

  it('chooses the longest setup phrase that fits before adding a summary', () => {
    const answer = 'Connect to the Example MCP server at example.com with OAuth sign-in.';
    const phrases = [
      'Setup for Claude and more.',
      'Setup for Claude, ChatGPT, Cursor and VS Code.',
    ];
    expect(getCatalogServerMetaDescription(server, phrases))
      .toBe(`${answer} ${phrases[1]} ${server.description}`);
    const longName = { ...server, name: 'A much longer example server name' };
    expect(getCatalogServerMetaDescription(longName, phrases))
      .toBe('Connect to the A much longer example server name MCP server at example.com with OAuth sign-in. Setup for Claude, ChatGPT, Cursor and VS Code.');
    const longerName = { ...server, name: 'An even longer example server name with extra words' };
    expect(getCatalogServerMetaDescription(longerName, phrases))
      .toBe('Connect to the An even longer example server name with extra words MCP server at example.com with OAuth sign-in. Setup for Claude and more.');
  });

  it('makes local server logos absolute and rejects remote logo URLs', () => {
    expect(getCatalogServerImageUrl('/server-logos/example.svg')).toBe(
      'https://mcptest.io/server-logos/example.svg'
    );
    expect(getCatalogServerSeo(server).imageUrl).toBe(
      'https://mcptest.io/server-logos/example.svg'
    );
    expect(getCatalogServerImageUrl('https://remote.example/logo.svg')).toBe(
      'https://mcptest.io/logo.png'
    );
  });
});
