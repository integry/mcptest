import { describe, expect, it } from 'vitest';
import type { CatalogServer } from '../types/catalog';
import {
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
      'Inspect the Example MCP server. An example remote MCP server. Test and debug endpoints.'
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

    expect(getCatalogServerMetaDescription({ ...server, seoDescription })).toBe(seoDescription);
    expect(getCatalogServerSeo({ ...server, seoDescription }).description).toBe(seoDescription);
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
