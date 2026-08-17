import { describe, expect, it } from 'vitest';
import type { CatalogAuthType, CatalogServer } from '../types/catalog';
import { filterCatalogServers, getCatalogServers } from './catalogUtils';

const server = (id: string, authType: CatalogAuthType): CatalogServer => ({
  id,
  name: id,
  url: `https://${id}.example/mcp`,
  description: `${authType} test server`,
  category: 'Testing',
  tags: [authType],
  declaredTransport: 'streamable-http',
  transport: 'streamable-http',
  requiresOAuth: authType === 'oauth',
  declaredAuthType: authType,
  authType,
  protocolEra: 'unknown',
  status: 'online',
  logoUrl: `/server-logos/${id}.svg`,
  logoSourceKind: 'generated-fallback',
  logoRetrievedAt: '2026-08-17',
});

describe('catalog authentication metadata', () => {
  const servers = [
    server('public', 'none'),
    server('oauth', 'oauth'),
    server('bearer', 'bearer-token'),
    server('api-key', 'api-key'),
  ];

  it.each([
    ['no-auth', 'public'],
    ['oauth', 'oauth'],
    ['bearer-token', 'bearer'],
    ['api-key', 'api-key'],
  ] as const)('filters %s servers', (authFilter, expectedId) => {
    expect(filterCatalogServers(servers, { oauthFilter: authFilter }).map(({ id }) => id))
      .toEqual([expectedId]);
  });

  it('merges every expanded seed into the UI-facing catalog', () => {
    const catalog = getCatalogServers();

    expect(catalog).toHaveLength(26);
    expect(catalog.find(({ id }) => id === 'adadvisor')).toMatchObject({
      authType: 'bearer-token',
      declaredAuthType: 'bearer-token',
    });
    expect(catalog.find(({ id }) => id === 'inferventis')).toMatchObject({
      authType: 'api-key',
      declaredAuthType: 'api-key',
    });
    expect(catalog.find(({ id }) => id === 'agentra')).toMatchObject({
      declaredTransport: 'legacy-sse',
    });
    expect(catalog.every(({ logoUrl }) => logoUrl.startsWith('/server-logos/'))).toBe(true);
    expect(JSON.stringify(catalog)).not.toMatch(/"logoUrl":"https?:/);
  });
});
