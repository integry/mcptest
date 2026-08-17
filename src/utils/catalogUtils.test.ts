import { describe, expect, it } from 'vitest';
import type { CatalogAuthType, CatalogServer } from '../types/catalog';
import {
  filterCatalogServers,
  getCatalogCategoryCounts,
  getCatalogServers,
  sortCatalogServers,
} from './catalogUtils';

const server = (
  id: string,
  authType: CatalogAuthType,
  overrides: Partial<CatalogServer> = {}
): CatalogServer => ({
  id,
  name: id,
  url: `https://${id}.example/mcp`,
  description: `${authType} test server`,
  category: 'Testing',
  tags: [authType],
  listingSource: { kind: 'community' },
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
  ...overrides,
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
    expect(catalog.every(({ listingSource }) => Boolean(listingSource?.kind))).toBe(true);
    expect(catalog.every(({ logoUrl }) => logoUrl.startsWith('/server-logos/'))).toBe(true);
    expect(JSON.stringify(catalog)).not.toMatch(/"logoUrl":"https?:/);
  });
});

describe('catalog sorting', () => {
  const servers = [
    server('zulu', 'none', { name: 'Zulu', checkedAt: 'invalid', browserAccess: 'unknown' }),
    server('beta', 'none', {
      name: 'Beta',
      checkedAt: '2026-08-01T00:00:00Z',
      browserAccess: 'proxy-required',
    }),
    server('alpha-new', 'none', {
      name: 'Alpha',
      checkedAt: '2026-08-15T00:00:00Z',
      browserAccess: 'direct',
    }),
    server('alpha-untested', 'none', { name: 'Alpha', browserAccess: 'unknown' }),
  ];

  it.each([
    ['catalog-order', ['zulu', 'beta', 'alpha-new', 'alpha-untested']],
    ['name', ['alpha-new', 'alpha-untested', 'beta', 'zulu']],
    ['recently-tested', ['alpha-new', 'beta', 'alpha-untested', 'zulu']],
    ['browser-ready', ['alpha-new', 'beta', 'alpha-untested', 'zulu']],
  ] as const)('sorts by %s without mutating source order', (order, expectedIds) => {
    const sourceIds = servers.map(({ id }) => id);
    const result = sortCatalogServers(servers, order);

    expect(result.map(({ id }) => id)).toEqual(expectedIds);
    expect(servers.map(({ id }) => id)).toEqual(sourceIds);
    expect(result).not.toBe(servers);
  });
});

describe('catalog category facets', () => {
  const servers = [
    server('finance-public', 'none', {
      category: 'Finance',
      name: 'Market match',
    }),
    server('finance-oauth', 'oauth', {
      category: 'Finance',
      name: 'Private match',
    }),
    server('docs-public', 'none', {
      category: 'Documentation',
      name: 'Docs match',
    }),
  ];

  it('applies search and auth while ignoring category and retaining zero counts', () => {
    expect(getCatalogCategoryCounts(
      servers,
      { query: 'match', oauthFilter: 'no-auth', category: 'Finance' },
      ['Documentation', 'Finance', 'Security']
    )).toEqual({
      all: 2,
      categories: [
        { category: 'Documentation', count: 1 },
        { category: 'Finance', count: 1 },
        { category: 'Security', count: 0 },
      ],
    });
  });
});
