import { getPreferredCatalogEndpoint, resolveCatalogEndpointTransport } from './clientSetup';
import { getCatalogServerFacts } from './serverConnect';
import { createAuthorizationGuidance } from './authorizationGuidance';
import { describe, expect, it } from 'vitest';
import type { CatalogAuthType, CatalogServer } from '../types/catalog';
import {
  filterCatalogServers,
  getCatalogEndpointDiagnosticEvidence,
  getCatalogServerByEndpoint,
  getCatalogServerById,
  getCatalogCategoryCounts,
  getCatalogServers,
  sortCatalogServers,
} from './catalogUtils';
import catalogValidation from '../data/catalogValidation.json';
import catalogSeeds from '../data/serverCatalog.json';
import catalogCapabilities from '../data/catalogCapabilities.json';

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
  it('keeps Port OS device OAuth consistent through catalog metadata and endpoint hints', () => {
    const seed = catalogSeeds.find(({ id }) => id === 'portoperatingsystem');
    const validation = catalogValidation.find(({ serverId }) => serverId === 'portoperatingsystem');
    const entry = getCatalogServers().find(({ id }) => id === 'portoperatingsystem');

    expect(seed).toMatchObject({ authType: 'oauth', requiresOAuth: true });
    expect(seed?.description).toContain('device operations require user OAuth');
    expect(seed?.tags).toContain('oauth');
    expect(seed?.tags).not.toContain('no-auth');
    expect(validation).toMatchObject({
      authType: 'oauth',
      requiresOAuth: true,
    });
    expect(validation?.message).toContain('authentication oauth');
    expect(entry).toMatchObject({
      declaredAuthType: 'oauth', authType: 'oauth', requiresOAuth: true,
    });
    expect(entry?.authorizationServers).toEqual(validation?.authorizationServers);
    expect(entry?.validationMessage).toBe(validation?.message);
    expect(entry?.checkedAt).toBe(validation?.checkedAt);
    expect(filterCatalogServers([entry!], { oauthFilter: 'oauth' })).toEqual([entry]);
    expect(filterCatalogServers([entry!], { oauthFilter: 'no-auth' })).toEqual([]);
    expect(getCatalogEndpointDiagnosticEvidence('https://api.portoperatingsystem.com/mcp'))
      .toMatchObject({ authType: 'oauth', serverReachable: true });
  });

  it('keeps Menlo OAuth consistent in the listing, filters and connection hints', () => {
    const seed = catalogSeeds.find(({ id }) => id === 'menloinsurance');
    const validation = catalogValidation.find(({ serverId }) => serverId === 'menloinsurance');
    const entry = getCatalogServers().find(({ id }) => id === 'menloinsurance');

    expect(seed).toMatchObject({
      authType: 'oauth', requiresOAuth: true,
      listingSource: { kind: 'publisher', url: 'https://www.menloinsurance.com/ai-assistants' },
    });
    expect(seed?.tags).toContain('oauth');
    expect(seed?.tags).not.toContain('no-auth');
    expect(validation).toMatchObject({ authType: 'oauth', requiresOAuth: true });
    expect(validation?.message).toContain('authentication oauth');
    expect(entry).toMatchObject({ declaredAuthType: 'oauth', authType: 'oauth', requiresOAuth: true });
    expect(filterCatalogServers([entry!], { oauthFilter: 'oauth' })).toEqual([entry]);
    expect(filterCatalogServers([entry!], { oauthFilter: 'no-auth' })).toEqual([]);
    expect(getCatalogEndpointDiagnosticEvidence('https://www.menloinsurance.com/mcp'))
      .toMatchObject({ authType: 'oauth', serverReachable: true });
  });

  it('keeps Vapi OAuth consistent between the seed, validation snapshot and connection facts', () => {
    const seed = catalogSeeds.find(({ id }) => id === 'vapi');
    const validation = catalogValidation.find(({ serverId }) => serverId === 'vapi');
    const entry = getCatalogServerById('vapi');

    expect(seed).toMatchObject({ authType: 'oauth', requiresOAuth: true });
    expect(seed).not.toHaveProperty('requiredHeaders');
    expect(seed?.tags).toContain('oauth');
    expect(seed?.tags).not.toContain('bearer-token');
    // A stale bearer snapshot would win the merge, because only key/token seeds bypass validation.
    expect(validation).toMatchObject({ authType: 'oauth', requiresOAuth: true });
    expect(validation?.message).toContain('authentication oauth');
    expect(entry).toMatchObject({ declaredAuthType: 'oauth', authType: 'oauth', requiresOAuth: true });
    expect(entry?.authorizationServers).toEqual(['https://auth.mcp.vapi.ai']);
    expect(filterCatalogServers([entry!], { oauthFilter: 'oauth' })).toEqual([entry]);
    expect(filterCatalogServers([entry!], { oauthFilter: 'bearer-token' })).toEqual([]);
    expect(getCatalogServerFacts(entry!, getPreferredCatalogEndpoint(entry!)).authorization.schemes)
      .toMatchObject({ value: ['oauth'] });
    expect(getCatalogEndpointDiagnosticEvidence('https://mcp.vapi.ai/mcp'))
      .toMatchObject({ authType: 'oauth', serverReachable: true });
  });

  it.each([
    ['close', 'https://help.close.com/docs/mcp-server'],
    ['mercury', 'https://docs.mercury.com/docs/connecting-mercury-mcp'],
  ])('records the published dynamic client registration for %s as automatic', (id, evidenceUrl) => {
    const seed = catalogSeeds.find((candidate) => candidate.id === id);
    const entry = getCatalogServerById(id);

    // Both descriptions promise Dynamic Client Registration; the metadata must agree.
    expect(seed?.description).toContain('Dynamic Client Registration');
    expect(entry?.oauthRegistration).toMatchObject({
      mode: 'automatic',
      responsibleParty: 'automatic',
      clientId: { required: false },
      clientSecret: { required: false },
      browserPublicClientSupported: true,
      availability: 'ready',
      evidenceUrl,
    });
    expect(entry).toMatchObject({ authType: 'oauth', requiresOAuth: true });
    expect(createAuthorizationGuidance(entry!)).toMatchObject({
      status: 'no-registration-needed',
      canAttemptHostedAuthorization: true,
    });
  });

  const servers = [
    server('public', 'none'),
    server('oauth', 'oauth'),
    server('bearer', 'bearer-token'),
    server('api-token', 'api-token'),
    server('api-key', 'api-key'),
  ];

  it.each([
    ['no-auth', 'public'],
    ['oauth', 'oauth'],
    ['bearer-token', 'bearer'],
    ['api-token', 'api-token'],
    ['api-key', 'api-key'],
  ] as const)('filters %s servers', (authFilter, expectedId) => {
    expect(filterCatalogServers(servers, { oauthFilter: authFilter }).map(({ id }) => id))
      .toEqual([expectedId]);
  });

  it('guards against accidental catalog truncation without capping growth', () => {
    // Lower bound only, so ordinary submissions never trip it. The baseline is independent of
    // the seed so a truncated serverCatalog.json is caught; a few removals stay within tolerance.
    // To bump: set reviewedCatalogSize to the current entry count after a reviewed bulk change.
    const reviewedCatalogSize = 297;
    const allowedShrink = 0.1;
    expect(catalogSeeds.length).toBeGreaterThanOrEqual(reviewedCatalogSize * (1 - allowedShrink));
  });

  it('merges every expanded seed into the UI-facing catalog', () => {
    const catalog = getCatalogServers();

    expect(catalog).toHaveLength(catalogSeeds.length);
    expect(new Set(catalog.map(({ id }) => id)).size).toBe(catalogSeeds.length);
    expect(new Set(catalog.map(({ id }) => id)))
      .toEqual(new Set(catalogSeeds.map(({ id }) => id)));
    expect(catalogValidation).toHaveLength(catalogSeeds.length);
    expect(new Set(catalogValidation.map(({ serverId }) => serverId)).size).toBe(catalogSeeds.length);
    expect(new Set(catalogValidation.map(({ serverId }) => serverId)))
      .toEqual(new Set(catalog.map(({ id }) => id)));
    expect(catalog.find(({ id }) => id === 'asana')).toBeDefined();
    expect(catalog.find(({ id }) => id === 'canva')).toBeDefined();
    expect(catalog.find(({ id }) => id === 'gitlab')).toBeDefined();
    expect(catalog.find(({ id }) => id === 'miro')).toBeDefined();
    expect(catalog.find(({ id }) => id === 'circleci')).toBeDefined();
    expect(catalog.find(({ id }) => id === 'pagerduty')).toBeDefined();
    expect(catalog.find(({ id }) => id === 'airtable')).toBeDefined();
    expect(catalog.find(({ id }) => id === 'clickup')).toBeDefined();
    expect(catalog.find(({ id }) => id === 'intercom')).toBeDefined();
    expect(catalog.find(({ id }) => id === 'docusign-developer')).toBeDefined();
    expect(catalog.find(({ id }) => id === 'calendly')).toBeDefined();
    expect(catalog.find(({ id }) => id === 'hugging-face')).toBeDefined();
    expect(catalog.find(({ id }) => id === 'upwork')).toBeDefined();
    expect(catalog.find(({ id }) => id === 'inference-sh')).toBeUndefined();
    expect(catalog.find(({ id }) => id === 'tandem-docs')).toBeUndefined();
    expect(catalog.find(({ id }) => id === 'agentdm')).toBeUndefined();
    expect(catalog.find(({ id }) => id === 'adadvisor')).toBeUndefined();
    expect(catalog.find(({ id }) => id === 'inferventis')).toBeUndefined();
    expect(catalog.find(({ id }) => id === 'agentra')).toBeUndefined();
    expect(catalogValidation.find(({ serverId }) => serverId === 'inference-sh')).toBeUndefined();
    expect(catalogValidation.find(({ serverId }) => serverId === 'tandem-docs')).toBeUndefined();
    expect(catalogValidation.find(({ serverId }) => serverId === 'agentdm')).toBeUndefined();
    expect(catalogValidation.find(({ serverId }) => serverId === 'adadvisor')).toBeUndefined();
    expect(catalogValidation.find(({ serverId }) => serverId === 'inferventis')).toBeUndefined();
    expect(catalogValidation.find(({ serverId }) => serverId === 'agentra')).toBeUndefined();
    expect(catalogCapabilities).not.toHaveProperty('inference-sh');
    expect(catalogCapabilities).not.toHaveProperty('tandem-docs');
    expect(catalogCapabilities).not.toHaveProperty('agentdm');
    expect(catalogCapabilities).not.toHaveProperty('adadvisor');
    expect(catalogCapabilities).not.toHaveProperty('inferventis');
    expect(catalogCapabilities).not.toHaveProperty('agentra');
    expect(catalog.every(({ listingSource }) => Boolean(listingSource?.kind))).toBe(true);
    expect(catalog.every(({ logoUrl }) => logoUrl.startsWith('/server-logos/'))).toBe(true);
    expect(JSON.stringify(catalog)).not.toMatch(/"logoUrl":"https?:/);
  });

  it('shows Hookr as online at its submitted endpoint with anonymous discovery and a partial tool inventory', () => {
    const endpoint = 'https://hookr.fun/api/mcp';
    const entry = getCatalogServerById('hookr');

    expect(entry).toMatchObject({
      url: endpoint,
      validatedUrl: endpoint,
      status: 'online',
      declaredAuthType: 'none',
      authType: 'none',
      transport: 'streamable-http',
      protocolEra: 'stateless',
    });
    expect(entry?.capabilityInventory).toMatchObject({
      provenance: { testedEndpoint: endpoint, route: 'direct' },
      authentication: 'unauthenticated',
      tools: { status: 'partial' },
    });
    expect(entry?.capabilityInventory?.tools.omittedCount).toBeGreaterThan(0);
  });

  it('attributes endpoints that only a client directory documents to that directory', () => {
    // A caveat that says the publisher's page omits the endpoint (or shows only a placeholder)
    // means the URL is directory-derived, so the structured provenance must say so too.
    const directoryDerived = /publisher does not document this endpoint|does not state the endpoint URL|URL comes from the (Claude|ChatGPT) directory|placeholder domain/i;
    const flagged = catalogSeeds.filter(({ caveats }) => (caveats ?? []).some(caveat => directoryDerived.test(caveat)));
    expect(flagged.map(({ id }) => id)).toEqual(expect.arrayContaining([
      'malwarebytes', 'snomed-ct', 'snagajob', 'descrybe', 'constant-contact', 'cash-app-ordering',
      'athenahq', 'taskrabbit', 'pophive', 'civitatis', 'all-accor', 'aiwyn-tax',
    ]));
    for (const { id, listingSource, directoryListings } of flagged) {
      expect(listingSource.kind, id).toBe('client-directory');
      expect((directoryListings ?? []).map(({ url }) => url), id).toContain(listingSource.url);
    }
  });

  it('resolves exact Upwork catalog transport and OAuth evidence without a provider rule', () => {
    expect(getCatalogEndpointDiagnosticEvidence('https://mcp.upwork.com/mcp')).toEqual({
      preferredTransport: 'streamable-http',
      transport: 'streamable-http',
      authType: 'oauth',
      supportsBearerToken: false,
      serverReachable: true,
    });
    expect(getCatalogEndpointDiagnosticEvidence('https://mcp.upwork.com/mcp/')).toBeUndefined();
    expect(getCatalogEndpointDiagnosticEvidence('https://mcp.upwork.com/custom')).toBeUndefined();
  });

  it('keeps the round-three additions reachable and distinct from existing endpoints', () => {
    const addedIds = [
      'basedash', 'beehiiv', 'dart', 'dashthis', 'elfsight', 'gameanalytics',
      'getabstract', 'happyscribe', 'hasdata', 'icons8', 'ifttt', 'jitsu',
      'kajabi', 'keywordseverywhere', 'lessmeeting', 'mabl', 'maileroo', 'mailfloss',
      'mailtester', 'octolens', 'octoparse', 'padlet', 'pandadoc', 'pandavideo',
      'parsely', 'qrcodekit', 'salesql', 'scandit', 'tallyfy', 'tapcart',
      'teamhood', 'telerivet', 'ulule', 'unlayer', 'unstoppabledomains', 'upcoach',
      'uptimerobot', 'valossa', 'versium', 'vestd', 'wachete', 'warmerly',
      'webeyez', 'whalesync', 'xposedornot', 'xranks', 'xverum', 'youth4work',
      'zabihah', 'zarla', 'zeroheight', 'zip-codes', 'zippendo', 'zylalabs',
      'ffmpeg-api', 'feedhive', 'geckoboard', 'g2x', 'datocapital', 'kindwise',
      'legitfit', 'leadboxer', 'qencode',
    ];
    const publisherSources = new Map([
      ['basedash', 'https://www.basedash.com/features/mcp-server'],
      ['dart', 'https://help.dartai.com/en/articles/10733406-dart-mcp'],
      ['datocapital', 'https://api.datocapital.com/docs/mcp'],
      ['elfsight', 'https://github.com/elfsight/ai-chatbot-mcp'],
      ['ffmpeg-api', 'https://mcp.ffmpeg-api.com/'],
      ['gameanalytics', 'https://docs.gameanalytics.com/ai-tools/documentation-mcp/'],
      ['leadboxer', 'https://developers.leadboxer.com/docs/mcp'],
      ['legitfit', 'https://support.legitfit.com/business/how-do-i-connect-legitfit-to-claude'],
      ['lessmeeting', 'https://lessmeeting.com/features/mcp-server/'],
      ['maileroo', 'https://maileroo.com/help/connect-maileroo-to-ai'],
      ['mailtester', 'https://mailtester.com/llms.txt'],
      ['pandavideo', 'https://docs.pandavideo.com/reference/mcp'],
      ['parsely', 'https://docs.parse.ly/mcp-server/'],
      ['tallyfy', 'https://tallyfy.com/products/pro/integrations/mcp-server/openai-chatgpt/'],
      ['unstoppabledomains', 'https://docs.unstoppabledomains.com/user-api/mcp-server'],
      ['upcoach', 'https://upcoach.com/help/settings-and-account/connect-ai-tools-with-mcp'],
      ['uptimerobot', 'https://help.uptimerobot.com/en/articles/12928342-uptimerobot-mcp-integration-guide'],
      ['valossa', 'https://mcp-assistant.valossa.com/documentation'],
      ['versium', 'https://reach-help.versium.com/docs/mcp-overview'],
      ['vestd', 'https://www.vestd.com/help/connect-vestd-to-chatgpt-or-claude'],
      ['wachete', 'https://www.wachete.com/faq'],
      ['xverum', 'https://www.xverum.com/llms.txt'],
      ['youth4work', 'https://mcp.youth4work.com/'],
      ['zabihah', 'https://www.zabihah.com/developers/docs/mcp'],
      ['zarla', 'https://www.zarla.com/features/mcp-website-builder'],
      ['zeroheight', 'https://help.zeroheight.com/hc/en-us/articles/48004395674011-zeroheight-MCP-overview'],
      ['zip-codes', 'https://www.zip-codes.com/search.asp'],
      ['zylalabs', 'https://mcp.zylalabs.com/'],
    ]);
    const catalog = getCatalogServers();
    expect(addedIds.length).toBeGreaterThanOrEqual(60);
    for (const id of addedIds) {
      const entry = catalog.find(server => server.id === id);
      expect(entry, id).toBeDefined();
      expect(entry?.status, id).toBe('online');
      expect(entry?.homepageUrl, id).toMatch(/^https:\/\//);
      expect(entry?.registryUrl, id).toMatch(/^https:\/\//);
      const publisherUrl = publisherSources.get(id);
      expect(entry?.listingSource, id).toEqual(publisherUrl
        ? { kind: 'publisher', url: publisherUrl }
        : { kind: 'mcp-registry', url: entry?.registryUrl });
      expect(catalogValidation.find(result => result.serverId === id)?.validatedUrl, id)
        .toMatch(/^https:\/\//);
    }
    // Query parameters and trailing slashes must not inflate the server count.
    const endpoints = catalog.map(({ url }) => {
      const endpoint = new URL(url);
      return `${endpoint.host}${endpoint.pathname.replace(/\/+$/, '')}`;
    });
    expect(new Set(endpoints).size).toBe(catalog.length);
  });

  it.each([
    'https://mcp.figma.com/mcp/',
    'https://mcp.figma.com/mcp?issuer=https://api.figma.com',
    'https://mcp.figma.com/mcp#trusted-looking-fragment',
    'https://mcp.figma.com.evil.example/mcp',
    'https://user:pass@mcp.figma.com/mcp',
  ])('does not resolve trusted catalog data for %s', (endpoint) => {
    expect(getCatalogServerByEndpoint(endpoint)).toBeUndefined();
  });

  it('searches and filters alternative authentication methods', () => {
    const oauthWithToken = server('hybrid', 'oauth', {
      alternativeAuthTypes: ['bearer-token'],
    });

    expect(filterCatalogServers([oauthWithToken], { query: 'bearer token' })).toEqual([
      oauthWithToken,
    ]);
    expect(filterCatalogServers([oauthWithToken], { oauthFilter: 'bearer-token' })).toEqual([
      oauthWithToken,
    ]);
    expect(filterCatalogServers([oauthWithToken], { oauthFilter: 'oauth' })).toEqual([
      oauthWithToken,
    ]);

    const pagerDuty = getCatalogServers().find(({ id }) => id === 'pagerduty');
    expect(pagerDuty).toBeDefined();
    expect(filterCatalogServers([pagerDuty!], { query: 'api token' })).toEqual([pagerDuty]);
    expect(filterCatalogServers([pagerDuty!], { oauthFilter: 'api-token' })).toEqual([pagerDuty]);
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

  it('lists higher relevance first in catalog order and keeps seed order for ties', () => {
    const scored = [
      server('unscored', 'none'),
      server('low', 'none', { relevance: 20 }),
      server('high-first', 'none', { relevance: 90 }),
      server('high-second', 'none', { relevance: 90 }),
      server('zero', 'none', { relevance: 0 }),
    ];

    expect(sortCatalogServers(scored, 'catalog-order').map(({ id }) => id))
      .toEqual(['high-first', 'high-second', 'low', 'unscored', 'zero']);
    expect(sortCatalogServers(scored, 'name').map(({ id }) => id))
      .toEqual(['high-first', 'high-second', 'low', 'unscored', 'zero']);
  });

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


it.each(getCatalogServers())(
  'keeps diagnostic transport observations separate from concrete connection hints for $id',
  (server) => {
    const endpoints = new Set([
      server.url,
      server.browserUrl,
      server.validatedUrl,
      ...(server.alternativeEndpoints ?? []).map(({ url }) => url),
    ]);

    for (const endpoint of endpoints) {
      if (!endpoint) continue;
      const evidence = getCatalogEndpointDiagnosticEvidence(endpoint);
      if (!evidence) continue;
      expect(evidence.preferredTransport, endpoint).toBe(resolveCatalogEndpointTransport(server, endpoint));
      expect([undefined, 'streamable-http', 'legacy-sse'], endpoint).toContain(evidence.preferredTransport);
    }
  }
);
