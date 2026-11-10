import { describe, expect, it } from 'vitest';
import {
  DiscoveryFetchError,
  buildDiscoveryFixGuidance,
  checkMcpDiscovery,
  hasValidServerCard,
  isUrlOnDomain,
  normalizeDiscoveryTarget,
  registrySearchTerms,
  registrySearchUrl,
  type DiscoveryCatalogEntry,
  type DiscoveryFetch,
  type DiscoveryReport,
  type DiscoveryResponse,
  type DiscoveryRoute,
} from './mcpDiscovery';
import { SERVER_CARD_SCHEMA_URL, validateServerCard } from './serverCardValidation';

interface Fixture {
  status?: number;
  body?: unknown;
  contentType?: string;
  route?: DiscoveryRoute;
  /** Reject instead of answering. */
  fail?: 'cors' | 'timeout' | 'not-allowed';
}

/** A fetch that answers from a URL map; anything else is a 404. Records every request. */
const fixtureFetch = (fixtures: Record<string, Fixture>) => {
  const requests: Array<{ url: string; accept?: string }> = [];
  const fetchDocument: DiscoveryFetch = async (url, request) => {
    requests.push({ url, accept: request?.accept });
    const fixture = fixtures[url];
    if (fixture?.fail) throw new DiscoveryFetchError(`${fixture.fail} failure`, fixture.fail, 'direct');
    const body = fixture?.body === undefined ? 'Not found' : typeof fixture.body === 'string' ? fixture.body : JSON.stringify(fixture.body);
    const response: DiscoveryResponse = {
      url,
      status: fixture?.status ?? (fixture ? 200 : 404),
      contentType: fixture?.contentType ?? (fixture && typeof fixture.body !== 'string' ? 'application/json' : 'text/plain'),
      body,
      route: fixture?.route ?? 'direct',
    };
    return response;
  };
  return { fetchDocument, requests };
};

const card = (overrides: Record<string, unknown> = {}) => ({
  $schema: SERVER_CARD_SCHEMA_URL,
  name: 'com.example/weather',
  version: '1.4.0',
  description: 'Forecasts and severe weather alerts for any city.',
  title: 'Example Weather',
  remotes: [{ type: 'streamable-http', url: 'https://example.com/mcp' }],
  ...overrides,
});

const AUTHORIZATION_METADATA = {
  issuer: 'https://auth.example.com',
  authorization_endpoint: 'https://auth.example.com/authorize',
  token_endpoint: 'https://auth.example.com/token',
  registration_endpoint: 'https://auth.example.com/register',
  response_types_supported: ['code'],
  code_challenge_methods_supported: ['S256'],
};

const CATALOG: DiscoveryCatalogEntry[] = [
  { id: 'example-api', name: 'Example API', path: '/servers/example-api/', endpoints: [{ url: 'https://api.example.com/mcp', transport: 'streamable-http' }] },
  { id: 'unrelated', name: 'Unrelated', path: '/servers/unrelated/', endpoints: [{ url: 'https://notexample.com/mcp', transport: 'streamable-http' }] },
];

const rowById = (report: DiscoveryReport, id: string) => {
  const row = report.rows.find(candidate => candidate.id === id);
  if (!row) throw new Error(`No row ${id}: ${report.rows.map(candidate => candidate.id).join(', ')}`);
  return row;
};

describe('normalizeDiscoveryTarget', () => {
  it.each([
    ['example.com', 'example.com', 'https://example.com'],
    ['  Example.COM. ', 'example.com', 'https://example.com'],
    ['https://mcp.example.com/mcp?x=1', 'mcp.example.com', 'https://mcp.example.com'],
    ['http://example.com', 'example.com', 'https://example.com'],
    ['example.com:8443', 'example.com:8443', 'https://example.com:8443'],
    ['localhost:4181', 'localhost:4181', 'http://localhost:4181'],
    ['127.0.0.1:4181', '127.0.0.1:4181', 'http://127.0.0.1:4181'],
    ['https://localhost', 'localhost', 'https://localhost'],
  ])('reads %s as %s', (input, domain, origin) => {
    expect(normalizeDiscoveryTarget(input)).toMatchObject({ domain, origin });
  });

  it.each(['', 'intranet', 'ftp://example.com', 'https://user:pass@example.com', 'exa mple.com'])('rejects %j', input => {
    expect(normalizeDiscoveryTarget(input)).toHaveProperty('error');
  });
});

describe('domain matching and registry search', () => {
  it('matches the domain and its subdomains only', () => {
    expect(isUrlOnDomain('https://mcp.example.com/mcp', 'example.com')).toBe(true);
    expect(isUrlOnDomain('https://example.com/mcp', 'example.com')).toBe(true);
    expect(isUrlOnDomain('https://notexample.com/mcp', 'example.com')).toBe(false);
    expect(isUrlOnDomain('https://example.com.evil.test/mcp', 'example.com')).toBe(false);
  });

  it('searches the reverse-DNS namespace and the name label', () => {
    expect(registrySearchTerms('example.com')).toEqual(['com.example', 'example']);
    expect(registrySearchTerms('mcp.cloudflare.com')).toEqual(['com.cloudflare.mcp', 'cloudflare']);
    expect(registrySearchTerms('shop.example.co.uk')).toEqual(['uk.co.example.shop', 'example']);
    expect(registrySearchTerms('127.0.0.1')).toEqual([]);
    expect(registrySearchTerms('localhost')).toEqual([]);
    expect(registrySearchUrl('com.example')).toBe('https://registry.modelcontextprotocol.io/v0.1/servers?search=com.example&version=latest&limit=100');
  });
});

describe('checkMcpDiscovery', () => {
  const fullyAdvertised = (): Record<string, Fixture> => ({
    // A site-wide catch-all answers every unknown path with its home page.
    'https://example.com/.well-known/mcp-server-card': { body: '<!doctype html><title>Example</title>', contentType: 'text/html' },
    'https://example.com/.well-known/ai-catalog.json': {
      contentType: 'application/ai-catalog+json',
      body: {
        specVersion: '1.0',
        entries: [
          { identifier: 'urn:air:example.com:agent:helper', type: 'application/a2a-agent-card+json', url: 'https://example.com/agent.json' },
          { identifier: 'urn:air:example.com:mcp:weather', type: 'application/mcp-server-card+json', url: 'https://example.com/mcp/server-card' },
        ],
      },
    },
    'https://example.com/mcp/server-card': { body: card(), contentType: 'application/mcp-server-card+json', route: 'proxy' },
    'https://example.com/.well-known/oauth-protected-resource/mcp': {
      body: { resource: 'https://example.com/mcp', authorization_servers: ['https://auth.example.com'] },
    },
    'https://auth.example.com/.well-known/oauth-authorization-server': { body: AUTHORIZATION_METADATA },
    [registrySearchUrl('com.example')]: {
      body: {
        servers: [
          { server: { name: 'com.example/weather', version: '1.4.0', remotes: [{ type: 'streamable-http', url: 'https://example.com/mcp' }] }, _meta: { 'io.modelcontextprotocol.registry/official': { status: 'active' } } },
          { server: { name: 'com.example.other/thing', version: '1.0.0', remotes: [{ type: 'streamable-http', url: 'https://other.test/mcp' }] } },
        ],
        metadata: { count: 2 },
      },
    },
    [registrySearchUrl('example')]: { body: { servers: [], metadata: { count: 0 } } },
  });

  it('reports every location with its exact URL, validates each document and collects the endpoints', async () => {
    const { fetchDocument, requests } = fixtureFetch(fullyAdvertised());
    const report = await checkMcpDiscovery('Example.com', {
      fetch: fetchDocument,
      catalog: CATALOG,
      now: () => new Date('2026-10-24T12:00:00Z'),
    });

    expect(report).toMatchObject({ domain: 'example.com', origin: 'https://example.com', checkedAt: '2026-10-24T12:00:00.000Z' });
    expect(report.rows.map(row => [row.id, row.status, row.url])).toEqual([
      ['well-known-server-card', 'not-found', 'https://example.com/.well-known/mcp/server-card.json'],
      ['well-known-server-cards', 'not-found', 'https://example.com/.well-known/mcp/server-cards.json'],
      ['legacy-mcp-server-card', 'not-found', 'https://example.com/.well-known/mcp-server-card'],
      ['legacy-mcp-json', 'not-found', 'https://example.com/.well-known/mcp.json'],
      ['ai-catalog', 'found', 'https://example.com/.well-known/ai-catalog.json'],
      ['ai-catalog-entry-0', 'found', 'https://example.com/mcp/server-card'],
      ['endpoint-server-card-0', 'found', 'https://example.com/mcp/server-card'],
      ['endpoint-server-card-1', 'not-found', 'https://api.example.com/mcp/server-card'],
      ['oauth-0', 'found', 'https://example.com/.well-known/oauth-protected-resource/mcp'],
      ['oauth-1', 'not-found', 'https://api.example.com/.well-known/oauth-protected-resource/mcp'],
      ['registry', 'found', registrySearchUrl('com.example')],
      ['catalog', 'found', '/catalog'],
    ]);

    expect(rowById(report, 'legacy-mcp-server-card').summary).toMatch(/HTML page/);
    expect(rowById(report, 'ai-catalog').summary).toBe('An AI Catalog listing 1 MCP Server Card, 1 valid.');
    // Read through the proxy: the browser could not, and the row says so.
    expect(rowById(report, 'ai-catalog-entry-0').warnings.join(' ')).toMatch(/Access-Control-Allow-Origin/);
    expect(rowById(report, 'ai-catalog-entry-0').summary).toBe('A valid Server Card for Example Weather 1.4.0 with 1 remote endpoint.');

    const oauth = rowById(report, 'oauth-0');
    expect(oauth.summary).toBe('Names https://auth.example.com; its authorization server metadata is valid.');
    expect(oauth.warnings).toEqual([]);
    expect(oauth.attempts.map(attempt => [attempt.url, attempt.status])).toEqual([
      ['https://example.com/.well-known/oauth-protected-resource/mcp', 200],
      ['https://auth.example.com/.well-known/oauth-authorization-server', 200],
    ]);

    const registry = rowById(report, 'registry');
    expect(registry.links).toEqual([{
      label: 'com.example/weather',
      href: 'https://registry.modelcontextprotocol.io/v0.1/servers/com.example%2Fweather/versions/latest',
      external: true,
    }]);
    expect(registry.attempts.map(attempt => attempt.url)).toEqual([registrySearchUrl('com.example'), registrySearchUrl('example')]);
    expect(rowById(report, 'catalog').links).toEqual([{ label: 'Example API', href: '/servers/example-api/' }]);

    expect(report.endpoints).toEqual([
      {
        url: 'https://example.com/mcp',
        transport: 'streamable-http',
        sources: ['Server Card: urn:air:example.com:mcp:weather', 'Official MCP Registry', 'Server Card at https://example.com/mcp'],
        inspectorPath: '/server/example.com/mcp?transport=http',
      },
      {
        url: 'https://api.example.com/mcp',
        transport: 'streamable-http',
        sources: ['mcptest.io catalog'],
        inspectorPath: '/server/api.example.com/mcp?transport=http',
      },
    ]);
    expect(hasValidServerCard(report)).toBe(true);

    // The card both the catalog and the endpoint point to is fetched once, with the card media type.
    const cardRequests = requests.filter(request => request.url === 'https://example.com/mcp/server-card');
    expect(cardRequests).toEqual([{ url: 'https://example.com/mcp/server-card', accept: 'application/mcp-server-card+json' }]);
    expect(requests.every(request => !request.url.includes('notexample.com'))).toBe(true);
  });

  it('marks invalid cards with the schema errors and still lists endpoints a legacy document names', async () => {
    const { fetchDocument } = fixtureFetch({
      'https://example.com/.well-known/mcp/server-card.json': {
        body: card({ $schema: 'https://static.modelcontextprotocol.io/schemas/2025-11-25/server-card.schema.json', name: 'no-slash' }),
      },
      'https://example.com/.well-known/mcp.json': { body: { endpoint: 'https://mcp.example.com/mcp' } },
      'https://example.com/.well-known/mcp/server-cards.json': { body: [card(), { name: 'x' }] },
    });
    const report = await checkMcpDiscovery('example.com', { fetch: fetchDocument });

    const invalid = rowById(report, 'well-known-server-card');
    expect(invalid.status).toBe('invalid');
    expect(invalid.errors[0]).toBe(`$schema must be ${SERVER_CARD_SCHEMA_URL} (found https://static.modelcontextprotocol.io/schemas/2025-11-25/server-card.schema.json).`);
    expect(invalid.errors.some(error => error.startsWith('name:'))).toBe(true);
    // The endpoint of an invalid card is still a lead worth testing.
    expect(invalid.endpoints).toEqual(['https://example.com/mcp']);

    const legacy = rowById(report, 'legacy-mcp-json');
    expect(legacy.status).toBe('invalid');
    expect(legacy.summary).toBe('JSON that names 1 endpoint, but it is not a valid SEP-2127 Server Card.');
    expect(legacy.endpoints).toEqual(['https://mcp.example.com/mcp']);

    const list = rowById(report, 'well-known-server-cards');
    expect(list.status).toBe('invalid');
    expect(list.summary).toBe('2 cards, 1 valid.');
    expect(list.errors.every(error => error.startsWith('cards[1] '))).toBe(true);

    expect(report.endpoints.map(endpoint => endpoint.url)).toEqual(['https://example.com/mcp', 'https://mcp.example.com/mcp']);
    // A list with one bad card is not a valid publication, so the fix guidance shows.
    expect(hasValidServerCard(report)).toBe(false);
  });

  it('reports OAuth metadata that names an authorization server without metadata as invalid', async () => {
    const { fetchDocument } = fixtureFetch({
      'https://example.com/.well-known/mcp/server-card.json': { body: card() },
      'https://example.com/.well-known/oauth-protected-resource/mcp': {
        body: { resource: 'https://other.example/mcp', authorization_servers: ['https://auth.example.com'] },
      },
    });
    const report = await checkMcpDiscovery('example.com', { fetch: fetchDocument });
    const oauth = rowById(report, 'oauth-0');
    expect(oauth.status).toBe('invalid');
    expect(oauth.summary).toBe('Protected resource metadata names https://auth.example.com, but no authorization server metadata was found there.');
    expect(oauth.warnings).toEqual(['resource is https://other.example/mcp, which does not identify https://example.com/mcp; clients reject metadata for a different resource.']);
    expect(oauth.attempts.map(attempt => attempt.url)).toEqual([
      'https://example.com/.well-known/oauth-protected-resource/mcp',
      'https://auth.example.com/.well-known/oauth-authorization-server',
      'https://auth.example.com/.well-known/openid-configuration',
    ]);
  });

  it('warns about missing PKCE and client registration support', async () => {
    const { fetchDocument } = fixtureFetch({
      'https://example.com/.well-known/mcp/server-card.json': { body: card() },
      'https://example.com/.well-known/oauth-protected-resource': {
        body: { resource: 'https://example.com', authorization_servers: ['https://auth.example.com'] },
      },
      'https://auth.example.com/.well-known/oauth-authorization-server': {
        body: { ...AUTHORIZATION_METADATA, registration_endpoint: undefined, code_challenge_methods_supported: ['plain'] },
      },
    });
    const oauth = rowById(await checkMcpDiscovery('example.com', { fetch: fetchDocument }), 'oauth-0');
    expect(oauth.status).toBe('found');
    // The path-aware location 404s, so the root document is used.
    expect(oauth.url).toBe('https://example.com/.well-known/oauth-protected-resource');
    expect(oauth.warnings).toHaveLength(2);
    expect(oauth.warnings[0]).toMatch(/S256/);
    expect(oauth.warnings[1]).toMatch(/registration_endpoint/);
  });

  it('reports protected resource metadata that is not valid', async () => {
    const { fetchDocument } = fixtureFetch({
      'https://example.com/.well-known/mcp/server-card.json': { body: card() },
      'https://example.com/.well-known/oauth-protected-resource/mcp': { body: { authorization_servers: 'https://auth.example.com' } },
    });
    const oauth = rowById(await checkMcpDiscovery('example.com', { fetch: fetchDocument }), 'oauth-0');
    expect(oauth.status).toBe('invalid');
    expect(oauth.errors).toHaveLength(1);
  });

  it('explains unreadable documents instead of calling them missing', async () => {
    const { fetchDocument } = fixtureFetch({
      'https://example.com/.well-known/mcp/server-card.json': { fail: 'cors' },
      'https://example.com/.well-known/ai-catalog.json': { fail: 'not-allowed' },
      [registrySearchUrl('com.example')]: { fail: 'timeout' },
      [registrySearchUrl('example')]: { fail: 'timeout' },
    });
    const report = await checkMcpDiscovery('example.com', { fetch: fetchDocument });
    const card = rowById(report, 'well-known-server-card');
    expect(card.status).toBe('unreachable');
    expect(card.summary).toMatch(/CORS headers/);
    expect(card.attempts).toEqual([{ url: card.url, route: 'direct', failure: 'cors', message: 'cors failure' }]);
    expect(rowById(report, 'ai-catalog').summary).toMatch(/only fetches MCP discovery documents/);
    expect(rowById(report, 'registry')).toMatchObject({ status: 'unreachable', summary: 'No response arrived before the timeout.' });
    // Nothing to check per endpoint.
    expect(rowById(report, 'endpoint-server-card').status).toBe('skipped');
    expect(rowById(report, 'oauth').status).toBe('skipped');
  });

  it('flags a server error and a non-JSON body as invalid', async () => {
    const { fetchDocument } = fixtureFetch({
      'https://example.com/.well-known/mcp/server-card.json': { status: 500, body: 'oops' },
      'https://example.com/.well-known/ai-catalog.json': { body: 'specVersion: 1.0', contentType: 'text/yaml' },
    });
    const report = await checkMcpDiscovery('example.com', { fetch: fetchDocument });
    expect(rowById(report, 'well-known-server-card')).toMatchObject({ status: 'invalid', summary: 'The server answered HTTP 500.' });
    expect(rowById(report, 'ai-catalog')).toMatchObject({ status: 'invalid', errors: ['The body is not valid JSON.'] });
  });

  it('skips the registry for hosts without a namespace and checks at most the configured number of endpoints', async () => {
    const remotes = Array.from({ length: 4 }, (_value, index) => ({ type: 'streamable-http', url: `http://127.0.0.1:4180/${index}/mcp` }));
    const { fetchDocument, requests } = fixtureFetch({
      'http://127.0.0.1:4181/.well-known/mcp/server-card.json': { body: card({ remotes }) },
    });
    const report = await checkMcpDiscovery('127.0.0.1:4181', { fetch: fetchDocument, maxEndpoints: 2 });
    expect(rowById(report, 'registry').status).toBe('skipped');
    expect(requests.some(request => request.url.startsWith('https://registry.'))).toBe(false);
    expect(report.endpoints).toHaveLength(4);
    expect(report.rows.filter(row => row.kind === 'oauth')).toHaveLength(2);
    expect(rowById(report, 'oauth-1').warnings).toContain('2 more endpoints were found; only the first 2 are checked.');
  });
});

describe('buildDiscoveryFixGuidance', () => {
  it('suggests a valid card at <endpoint>/server-card and an AI Catalog that lists it', async () => {
    const { fetchDocument } = fixtureFetch({});
    const report = await checkMcpDiscovery('example.com', { fetch: fetchDocument });
    expect(hasValidServerCard(report)).toBe(false);

    const guidance = buildDiscoveryFixGuidance(report);
    expect(guidance).toMatchObject({
      endpoint: 'https://example.com/mcp',
      endpointKnown: false,
      cardUrl: 'https://example.com/mcp/server-card',
      cardContentType: 'application/mcp-server-card+json',
      catalogUrl: 'https://example.com/.well-known/ai-catalog.json',
      catalogContentType: 'application/ai-catalog+json',
    });
    expect(validateServerCard(JSON.parse(guidance.card))).toMatchObject({ valid: true, warnings: [] });
    expect(JSON.parse(guidance.catalog)).toEqual({
      specVersion: '1.0',
      entries: [{ identifier: 'urn:air:example.com:mcp:mcp', type: 'application/mcp-server-card+json', url: 'https://example.com/mcp/server-card' }],
    });
    expect(guidance.headers).toContain('Access-Control-Allow-Origin: *');
  });

  it('uses an endpoint found on the domain', async () => {
    const { fetchDocument } = fixtureFetch({});
    const report = await checkMcpDiscovery('example.com', {
      fetch: fetchDocument,
      catalog: [{ id: 'a', name: 'A', path: '/servers/a/', endpoints: [{ url: 'https://mcp.example.com/v1/mcp', transport: 'streamable-http' }] }],
    });
    const guidance = buildDiscoveryFixGuidance(report);
    expect(guidance).toMatchObject({ endpoint: 'https://mcp.example.com/v1/mcp', endpointKnown: true, cardUrl: 'https://mcp.example.com/v1/mcp/server-card' });
    expect(JSON.parse(guidance.card).remotes).toEqual([{ type: 'streamable-http', url: 'https://mcp.example.com/v1/mcp' }]);
  });
});

describe('discovery inspector transport evidence', () => {
  it('keeps an unverified catalog endpoint free of a forced HTTP hint', async () => {
    const { fetchDocument } = fixtureFetch({});
    const report = await checkMcpDiscovery('example.com', {
      fetch: fetchDocument,
      catalog: [{ id: 'unknown', name: 'Unknown', path: '/servers/unknown/', endpoints: [{ url: 'https://example.com/custom' }] }],
    });
    expect(report.endpoints[0]).toMatchObject({
      url: 'https://example.com/custom', inspectorPath: '/server/example.com/custom',
    });
    expect(report.endpoints[0].transport).toBeUndefined();
  });

  it('uses concrete evidence from a later source when an earlier lead has no transport', async () => {
    const { fetchDocument } = fixtureFetch({
      'https://example.com/.well-known/mcp.json': { body: { endpoint: 'https://example.com/custom' } },
    });
    const report = await checkMcpDiscovery('example.com', {
      fetch: fetchDocument,
      catalog: [{ id: 'sse', name: 'SSE', path: '/servers/sse/', endpoints: [{ url: 'https://example.com/custom', transport: 'sse' }] }],
    });
    expect(report.endpoints[0]).toMatchObject({
      transport: 'sse', inspectorPath: '/server/example.com/custom?transport=sse',
    });
  });
});
