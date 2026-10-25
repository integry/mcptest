import { describe, expect, it } from 'vitest';
import type { CatalogServer } from '../types/catalog';
import {
  getCatalogServerTitle,
  getCatalogAuthAnswer,
  truncateCatalogDescription,
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
      'example.com. Sign in with OAuth. An example remote MCP server.'
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

    expect(getCatalogServerMetaDescription({ ...server, seoDescription })).toBe(`example.com. Sign in with OAuth. ${seoDescription}`);
    expect(getCatalogServerSeo({ ...server, seoDescription }).description).toBe(`example.com. Sign in with OAuth. ${seoDescription}`);
  });

  it('uses setup titles, dropping setup before shortening a long name', () => {
    expect(getCatalogServerTitle('Canva')).toBe('Canva MCP Server: URL, Auth & Setup | mcptest.io');
    expect(getCatalogServerTitle('A moderately long name')).toBe('A moderately long name MCP Server: URL, Auth | mcptest.io');
    for (const name of ['DocuSign Developer', 'A'.repeat(100)]) {
      expect(getCatalogServerTitle(name).length).toBeLessThanOrEqual(60);
      expect(getCatalogServerTitle(name)).not.toContain('& Setup');
    }
  });

  it('keeps unknown authentication explicit rather than guessing from declarations', () => {
    expect(getCatalogAuthAnswer({ ...server, authType: 'unknown' }).label).toBe('Auth not yet verified');
    expect(getCatalogServerMetaDescription({ ...server, authType: 'none' })).toContain('No auth');
    expect(getCatalogServerMetaDescription({ ...server, authType: 'api-key' })).toContain('API key header');
  });

  it('shortens descriptions only at word boundaries', () => {
    const summary = 'Whole words remain readable when the summary is long. '.repeat(8);
    const description = getCatalogServerMetaDescription({ ...server, seoDescription: summary });
    expect(description.length).toBeLessThanOrEqual(158);
    expect(description).toMatch(/(?:Whole|words|remain|readable|when|the|summary|is|long\.)…$/);
    expect(truncateCatalogDescription('Extraordinarilylongword', 10)).toBe('…');
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
