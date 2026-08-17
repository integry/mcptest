import { describe, expect, it } from 'vitest';
import type { CatalogServer } from '../types/catalog';
import {
  formatCatalogAuth,
  formatCatalogTransport,
  formatProtocolEra,
  getCatalogServerMetaDescription,
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
  declaredTransport: 'streamable-http',
  transport: 'unknown',
  requiresOAuth: true,
  declaredAuthType: 'oauth',
  authType: 'oauth',
  protocolEra: 'unknown',
  status: 'unknown',
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

  it('uses a curated search summary when the catalog provides one', () => {
    const seoDescription = 'Inspect the Example MCP server. Explore example tools and resources.';

    expect(getCatalogServerMetaDescription({ ...server, seoDescription })).toBe(seoDescription);
    expect(getCatalogServerSeo({ ...server, seoDescription }).description).toBe(seoDescription);
  });
});
