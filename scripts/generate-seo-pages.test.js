import { describe, expect, it } from 'vitest';
import { parseServerUrl } from '../src/utils/urlUtils';
import seoGenerator from './generate-seo-pages.js';
import learnData from '../src/data/learnArticles.json';
import catalogSeeds from '../src/data/serverCatalog.json';
import catalogValidation from '../src/data/catalogValidation.json';
import catalogCapabilities from '../src/data/catalogCapabilities.json';
import { createCapabilityInventory } from '../src/utils/capabilityInventory';

const {
  mergeCatalogServers, renderLearnArticleHtml, renderServerHtml, renderStaticPageHtml,
  validateCapabilitySnapshots,
} = seoGenerator;
const indexHtml = '<html><head><title>mcptest.io</title></head><body><div id="root"></div></body></html>';

function catalogServer(url, declaredTransport) {
  return {
    id: 'example-server',
    name: 'Example Server',
    url,
    description: 'An example MCP server.',
    category: 'Testing',
    tags: ['example'],
    declaredTransport,
    transport: declaredTransport,
    requiresOAuth: false,
    declaredAuthType: 'none',
    authType: 'none',
    protocolEra: 'unknown',
    status: 'online',
    logoUrl: '/server-logos/example-server.svg',
    logoSourceKind: 'generated-fallback',
    logoRetrievedAt: '2026-08-17',
  };
}

describe('generated server report Playground links', () => {
  it('preserves an endpoint ending in /mcp before the transport marker', () => {
    const html = renderServerHtml(
      indexHtml,
      catalogServer('https://mcp.linear.app/mcp', 'streamable-http')
    );

    expect(html).toContain('href="/server/https://mcp.linear.app/mcp/mcp"');
    expect(parseServerUrl('/server/https://mcp.linear.app/mcp/mcp')).toEqual({
      serverUrl: 'https://mcp.linear.app/mcp',
      transportMethod: 'mcp',
    });
  });

  it('preserves an endpoint ending in /sse before the transport marker', () => {
    const html = renderServerHtml(
      indexHtml,
      catalogServer('https://example.com/sse', 'legacy-sse')
    );

    expect(html).toContain('href="/server/https://example.com/sse/sse"');
    expect(parseServerUrl('/server/https://example.com/sse/sse')).toEqual({
      serverUrl: 'https://example.com/sse',
      transportMethod: 'sse',
    });
  });

  it('uses the validated transport when it differs from the declaration', () => {
    const server = catalogServer('https://example.com/endpoint', 'streamable-http');
    server.transport = 'legacy-sse';

    const html = renderServerHtml(indexHtml, server);

    expect(html).toContain('href="/server/https://example.com/endpoint/sse"');
    expect(parseServerUrl('/server/https://example.com/endpoint/sse')).toEqual({
      serverUrl: 'https://example.com/endpoint',
      transportMethod: 'sse',
    });
  });

  it('uses the browser-verified endpoint ahead of a server-only validation endpoint', () => {
    const server = catalogServer('https://example.com', 'streamable-http');
    server.validatedUrl = 'https://example.com/mcp';
    server.browserUrl = 'https://example.com/sse';
    server.browserAccess = 'direct';
    server.transport = 'both';

    const html = renderServerHtml(indexHtml, server);

    expect(html).toContain('Browser-verified endpoint');
    expect(html).toContain('href="/server/https://example.com/sse/sse"');
  });
});

describe('generated page metadata', () => {
  it('renders the same four literal, escaped client setup sections', () => {
    const server = catalogServer('https://example.com/mcp?label=<unsafe>', 'streamable-http');
    server.id = 'unsafe-id';
    server.name = 'Unsafe <Server>';
    server.authType = 'oauth';
    server.declaredAuthType = 'oauth';
    server.requiresOAuth = true;

    const html = renderServerHtml(indexHtml, server);

    for (const heading of ['Claude Code setup', 'Codex CLI setup', 'Cursor setup', 'VS Code setup']) {
      expect(html).toContain(`<h3>${heading}</h3>`);
    }
    expect(html).toContain('claude mcp add');
    expect(html).toContain('codex mcp add');
    expect(html).toContain('&lt;unsafe&gt;');
    expect(html).not.toContain('<unsafe>');
    expect(html).toContain('Canonical catalog endpoint'.toLowerCase());
    expect(html).toContain('client will request authorization');
    expect(html).toContain('After adding the server, open Claude Code, run /mcp, select the server, and follow the browser flow to authenticate.');
    expect(html).not.toContain('claude mcp login');
  });

  it('renders Claude authentication options before the server name and URL', () => {
    const server = catalogServer('https://example.com/mcp', 'streamable-http');
    server.id = 'private-data';
    server.authType = 'bearer-token';
    server.declaredAuthType = 'bearer-token';

    const html = renderServerHtml(indexHtml, server);

    expect(html).toContain(
      `claude mcp add --transport http --scope user --header 'Authorization: Bearer '&quot;\${PRIVATE_DATA_TOKEN}&quot; 'private-data' 'https://example.com/mcp'`
    );
  });

  it('renders unsupported static setups as non-executable guidance', () => {
    const server = catalogServer('https://example.com/mcp', 'streamable-http');
    server.authType = 'api-key';
    server.declaredAuthType = 'api-key';
    server.requiredHeaders = [{
      name: 'X-Region', description: 'Select the account region',
      required: true, secret: false,
    }];

    const html = renderServerHtml(indexHtml, server);

    expect(html.match(/<strong>Setup unavailable<\/strong>/g)).toHaveLength(4);
    expect(html).toContain('required header X-Region');
    expect(html).not.toContain('claude mcp add');
    expect(html).not.toContain('codex mcp add');
    expect(html).not.toContain('aria-label="Claude Code configuration"');
  });

  it('renders static Asana setup parity from typed registration evidence', () => {
    const asana = mergeCatalogServers(
      catalogSeeds, catalogValidation, catalogCapabilities
    ).find(({ id }) => id === 'asana');
    expect(asana).toBeDefined();

    const html = renderServerHtml(indexHtml, asana);
    expect(html).toContain('--client-id &quot;${ASANA_CLIENT_ID}&quot; --client-secret --callback-port 8080');
    expect(html.indexOf('--callback-port 8080')).toBeLessThan(html.indexOf("'asana'"));
    expect(html).toContain('mcp-remote@latest');
    expect(html).toContain('${env:ASANA_CLIENT_SECRET}');
    expect(html).toContain('http://127.0.0.1:33418/');
    expect(html).toContain('https://vscode.dev/redirect');
    expect(html).toContain('natively prompts first for the client ID');
    expect(html).not.toContain('no OAuth secret belongs in this configuration');
  });

  it('renders missing callback evidence as unsupported for all four static setups', () => {
    const server = catalogServer('https://example.com/mcp', 'streamable-http');
    server.authType = 'oauth';
    server.declaredAuthType = 'oauth';
    server.requiresOAuth = true;
    server.oauthRegistration = {
      mode: 'pre-registered-required',
      clientId: { required: true, environmentVariable: 'EXAMPLE_CLIENT_ID' },
      clientSecret: { required: true, environmentVariable: 'EXAMPLE_CLIENT_SECRET' },
      callback: { required: true, redirectUrls: {} },
      codexMcpRemote: { resourceUrl: 'https://example.com', callbackPort: 3334 },
      evidenceUrl: 'https://example.com/oauth-registration',
    };

    const html = renderServerHtml(indexHtml, server);
    expect(html.match(/<strong>Setup unavailable<\/strong>/g)).toHaveLength(4);
    expect(html).not.toContain('claude mcp add');
    expect(html).not.toContain('mcp-remote@latest');
    expect(html).not.toMatch(/redirect URL:\s*\./);
  });

  it('renders static PagerDuty API-token and EU endpoint parity', () => {
    const pagerduty = mergeCatalogServers(
      catalogSeeds, catalogValidation, catalogCapabilities
    ).find(({ id }) => id === 'pagerduty');
    expect(pagerduty).toBeDefined();
    expect(pagerduty.oauthRegistration).toMatchObject({
      clientId: { required: false },
      clientSecret: { required: false },
      callback: { required: false, redirectUrls: {} },
    });

    const html = renderServerHtml(indexHtml, pagerduty);
    expect(html).toContain('Token token=&lt;PAGERDUTY_API_TOKEN&gt;');
    expect(html).toContain('https://mcp.eu.pagerduty.com/mcp');
    expect(html).toContain('automatic OAuth client registration is unavailable');
    expect(html).not.toContain('no OAuth secret belongs in this configuration');
    expect(html).not.toContain('codex mcp login');
  });

  it('renders observed catalog capability names and descriptions as literal server HTML', () => {
    const server = mergeCatalogServers(
      catalogSeeds, catalogValidation, catalogCapabilities
    ).find(({ capabilityInventory }) => capabilityInventory?.tools.items.some(
      ({ description }) => description
    ));
    const observedTool = server?.capabilityInventory?.tools.items.find(({ description }) => description);

    expect(server).toBeDefined();
    expect(observedTool).toBeDefined();
    const html = renderServerHtml(indexHtml, server);
    expect(html).toContain(`<strong>${observedTool.name}</strong>`);
    expect(html).toContain(`<p>${observedTool.description}</p>`);
  });

  it('renders escaped literal capabilities and only aggregate inventory counts in JSON-LD', () => {
    const server = catalogServer('https://example.com/mcp', 'streamable-http');
    server.checkedAt = '2026-08-18T00:32:48';
    const section = (items) => ({
      status: 'complete', observedCount: items.length, retainedCount: items.length,
      omittedCount: 0, paginationComplete: true, items,
    });
    server.capabilityInventory = {
      version: 1,
      observedAt: '2026-08-17T22:00:00.000Z',
      provenance: { testedEndpoint: 'https://example.com/mcp', route: 'direct' },
      authentication: 'unauthenticated',
      tools: section([{
        name: '<script>alert(1)</script>',
        description: 'safe & useful',
        input: [{ name: 'libraryId', type: 'string', required: true }],
      }]),
      resources: section([{ name: 'Records' }]),
      resourceTemplates: section([{ name: 'Record template' }]),
      prompts: section([{ name: 'summarize' }]),
    };

    const html = renderServerHtml(indexHtml, server);

    expect(html).toContain('Tools provided by Example Server');
    expect(html).toContain('Resources provided by Example Server');
    expect(html).toContain('Resource templates provided by Example Server');
    expect(html).toContain('Prompts provided by Example Server');
    expect(html).toContain('&lt;script&gt;alert(1)&lt;/script&gt;');
    expect(html).not.toContain('<script>alert(1)</script>');
    expect(html).toContain('Aug 18, 2026 at 12:32 AM');
    expect(html).not.toContain('<dd>2026-08-18T00:32:48</dd>');
    expect(html).toContain('server-spec-list server-connection-specs');
    expect(html).toContain('<code class="technical-string technical-string-url technical-string-inline">https://example.com/mcp</code>');
    expect(html).toContain('<code class="technical-string technical-string-inline">libraryId</code>');
    expect(html).toContain('server-profile-breadcrumb-parent');
    expect(html).toContain('server-profile-breadcrumb-current');
    expect(html).toContain('"name":"Tools observed","value":1');
    const structuredData = html.match(/<script id="server-structured-data"[^>]*>(.*?)<\/script>/)?.[1] || '';
    expect(structuredData).not.toContain('alert(1)');
  });

  it('keeps standalone and quoted credentials out of generated static HTML', () => {
    const githubToken = `ghp_${'a'.repeat(36)}`;
    const stripeKey = `sk_live_${'b'.repeat(24)}`;
    const quotedSecret = 'quoted static secret';
    const server = catalogServer('https://example.com/mcp', 'streamable-http');
    server.capabilityInventory = createCapabilityInventory({
      observedAt: '2026-08-17T22:00:00.000Z',
      testedEndpoint: `https://example.com/mcp?sig=${stripeKey}`,
      route: 'direct',
      authentication: 'unauthenticated',
      statuses: { tools: 'complete', resources: 'complete', resourceTemplates: 'complete', prompts: 'complete' },
      discovered: {
        tools: [{
          name: 'safe_tool',
          description: `Use ${githubToken}; client_secret='${quotedSecret}'`,
        }],
        resources: [{ name: stripeKey }],
        resourceTemplates: [],
        prompts: [],
      },
    });

    const html = renderServerHtml(indexHtml, server);

    expect(html).toContain('[REDACTED]');
    for (const secret of [githubToken, stripeKey, quotedSecret]) {
      expect(html).not.toContain(secret);
    }

    const unsafeEndpointInventory = structuredClone(server.capabilityInventory);
    unsafeEndpointInventory.provenance.testedEndpoint = `https://example.com/mcp?label=${githubToken}`;
    expect(() => validateCapabilitySnapshots(
      { 'example-server': unsafeEndpointInventory },
      [server]
    )).toThrow('inventory endpoint does not match its catalog origin');
  });

  it('accepts canonical inventories created from case-distinct argument names', () => {
    const inventory = createCapabilityInventory({
      observedAt: '2026-08-17T22:00:00.000Z',
      testedEndpoint: 'https://example.com/mcp',
      route: 'direct',
      authentication: 'unauthenticated',
      statuses: { tools: 'complete', resources: 'complete', resourceTemplates: 'complete', prompts: 'complete' },
      discovered: {
        tools: [{
          name: 'case_distinct_arguments',
          inputSchema: {
            properties: {
              Foo: { type: 'string' },
              foo: { type: 'number' },
            },
          },
        }],
        resources: [],
        resourceTemplates: [],
        prompts: [],
      },
    });

    expect(inventory.tools.items[0].input).toHaveLength(1);
    expect(() => validateCapabilitySnapshots(
      { 'example-server': inventory },
      [catalogServer('https://example.com/mcp', 'streamable-http')]
    )).not.toThrow();
  });

  it('distinguishes incomplete discovery from completed sanitized and bounded inventories', () => {
    const server = catalogServer('https://example.com/mcp', 'streamable-http');
    server.capabilityInventory = {
      version: 1,
      observedAt: '2026-08-17T22:00:00.000Z',
      provenance: { testedEndpoint: 'https://example.com/mcp', route: 'direct' },
      authentication: 'unauthenticated',
      tools: {
        status: 'partial', observedCount: 1, retainedCount: 1,
        omittedCount: 0, paginationComplete: true, items: [{ name: 'search' }],
      },
      resources: {
        status: 'partial', observedCount: 2, retainedCount: 1,
        omittedCount: 1, paginationComplete: true, items: [{ name: 'Public records' }],
      },
      resourceTemplates: {
        status: 'partial', observedCount: 1, retainedCount: 1,
        omittedCount: 0, paginationComplete: false, items: [{ name: 'Record template' }],
      },
      prompts: {
        status: 'complete', observedCount: 0, retainedCount: 0,
        omittedCount: 0, paginationComplete: true, items: [],
      },
    };

    const html = renderServerHtml(indexHtml, server);

    expect(html).toContain(
      'Discovery completed; sanitized inventory: 1 retained of 1 observed. Capability details were sanitized for public display.'
    );
    expect(html).toContain(
      'Discovery completed; bounded inventory: 1 retained of 2 observed; 1 omitted.'
    );
    expect(html).toContain(
      'Partial discovery: 1 retained of 1 observed. More capabilities may exist.'
    );
    expect(html.match(/Partial discovery:/g)).toHaveLength(1);
  });

  it('uses the absolute local logo in social metadata and static profile markup', () => {
    const server = catalogServer('https://example.com/mcp', 'streamable-http');
    const html = renderServerHtml(indexHtml, server);

    expect(html).toContain('property="og:image" content="https://mcptest.io/server-logos/example-server.svg"');
    expect(html).toContain('name="twitter:image" content="https://mcptest.io/server-logos/example-server.svg"');
    expect(html).toContain('<img src="/server-logos/example-server.svg" alt=""');
    expect(html).not.toContain('server-profile-eyebrow');
  });

  it('never emits a remote logo and renders an accessible static fallback', () => {
    const server = catalogServer('https://example.com/mcp', 'streamable-http');
    server.logoUrl = 'https://remote.example/logo.svg';
    const html = renderServerHtml(indexHtml, server);

    expect(html).not.toContain('https://remote.example/logo.svg');
    expect(html).toContain('property="og:image" content="https://mcptest.io/logo.png"');
    expect(html).toContain('role="img" aria-label="Example Server logo"');
    expect(html).toContain('catalog-server-logo-initials');
  });

  it('uses the server capability summary across search and social tags', () => {
    const server = catalogServer('https://example.com/mcp', 'streamable-http');
    server.seoDescription = 'Inspect the Example Server MCP server. Explore example records and queries.';

    const html = renderServerHtml(indexHtml, server);

    expect(html).toContain('<title>Example Server MCP Server Report | mcptest.io</title>');
    expect(html).toContain(`name="description" content="${server.seoDescription}"`);
    expect(html).toContain(`property="og:description" content="${server.seoDescription}"`);
    expect(html).toContain(`name="twitter:description" content="${server.seoDescription}"`);
  });

  it('renders unique initial metadata for documentation routes', () => {
    const metadata = {
      title: 'Troubleshooting MCP Server Errors | mcptest.io',
      description: 'Fix common Model Context Protocol connection issues.',
    };

    const html = renderStaticPageHtml(indexHtml, '/docs/troubleshooting', metadata);

    expect(html).toContain(`<title>${metadata.title}</title>`);
    expect(html).toContain(`name="description" content="${metadata.description}"`);
    expect(html).toContain(`property="og:title" content="${metadata.title}"`);
    expect(html).toContain(`name="twitter:title" content="${metadata.title}"`);
    expect(html).toContain('rel="canonical" href="https://mcptest.io/docs/troubleshooting"');
  });

  it('renders indexable Learn article HTML, social metadata, and Article JSON-LD', () => {
    const article = learnData.articles[0];
    const html = renderLearnArticleHtml(indexHtml, article, learnData.articles);

    expect(html).toContain(`<title>${article.title} | mcptest.io</title>`);
    expect(html).toContain(`property="og:type" content="article"`);
    expect(html).toContain(`rel="canonical" href="https://mcptest.io/learn/${article.slug}"`);
    expect(html).toContain('type="application/ld+json"');
    expect(html).toContain('"@type":"Article"');
    expect(html).toContain(`"dateModified":"${article.lastReviewed}"`);
    expect(html).toContain(`data-article-slug="${article.slug}"`);
    expect(html).toContain('<h2>Coverage and how to read this comparison</h2>');
    expect(html).toContain('<table><thead><tr>');
    expect(html).toContain('Sources</h2>');
  });
});
