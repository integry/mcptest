import { describe, expect, it } from 'vitest';
import type { CatalogServer } from '../types/catalog';
import {
  formatCatalogTransport,
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
  status: 'unknown',
};

describe('catalog SEO helpers', () => {
  it('builds and parses canonical server paths', () => {
    expect(getCatalogServerPath(server.id)).toBe('/servers/example-server/');
    expect(getCatalogServerIdFromPath('/servers/example-server')).toBe(server.id);
    expect(getCatalogServerIdFromPath('/servers/example-server/')).toBe(server.id);
    expect(getCatalogServerIdFromPath('/catalog/example-server')).toBeNull();
  });

  it('uses the declared transport when validation is pending', () => {
    const seo = getCatalogServerSeo(server);

    expect(formatCatalogTransport(server.declaredTransport)).toBe('Streamable HTTP');
    expect(seo.description).toContain('Streamable HTTP');
    expect(seo.description).toContain('OAuth 2.1');
    expect(seo.canonicalUrl).toBe('https://mcptest.io/servers/example-server/');
    expect(seo.structuredData.endpointUrl).toBe(server.url);
  });
});
