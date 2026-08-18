import { describe, expect, it } from 'vitest';
import { parseServerUrl } from '../src/utils/urlUtils';
import seoGenerator from './generate-seo-pages.js';
import learnData from '../src/data/learnArticles.json';
import catalogSeeds from '../src/data/serverCatalog.json';
import catalogValidation from '../src/data/catalogValidation.json';
import catalogCapabilities from '../src/data/catalogCapabilities.json';

const {
  mergeCatalogServers, renderLearnArticleHtml, renderServerHtml, renderStaticPageHtml,
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
    const section = (items) => ({
      status: 'complete', observedCount: items.length, retainedCount: items.length,
      omittedCount: 0, paginationComplete: true, items,
    });
    server.capabilityInventory = {
      version: 1,
      observedAt: '2026-08-17T22:00:00.000Z',
      provenance: { testedEndpoint: 'https://example.com/mcp', route: 'direct' },
      authentication: 'unauthenticated',
      tools: section([{ name: '<script>alert(1)</script>', description: 'safe & useful' }]),
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
    expect(html).toContain('"name":"Tools observed","value":1');
    const structuredData = html.match(/<script id="server-structured-data"[^>]*>(.*?)<\/script>/)?.[1] || '';
    expect(structuredData).not.toContain('alert(1)');
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
