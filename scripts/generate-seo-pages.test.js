import fs from 'fs';
import os from 'os';
import path from 'path';
import { describe, expect, it } from 'vitest';
import { parseServerUrl } from '../src/utils/urlUtils';
import seoGenerator from './generate-seo-pages.js';
import catalogPages from './content/catalogPages.js';
import catalogSeeds from '../src/data/serverCatalog.json';
import catalogValidation from '../src/data/catalogValidation.json';
import catalogCapabilities from '../src/data/catalogCapabilities.json';
import { createCapabilityInventory } from '../src/utils/capabilityInventory';
import { extractOutline } from '../src/content/outline';
import { buildTrackNavigation } from '../src/content/contentModel';
import { buildLearnTrackNavigation } from '../src/content/navigationLinks';

const {
  loadArticles, mergeCatalogServers, renderCatalogHtml, renderDiscoveryHtml, renderHomeHtml, renderLearnArticleHtml,
  renderLearnIndexHtml, renderServerHtml, renderMarkdown, renderSitemap, renderStaticPageHtml,
  stripLandingFallback, validateCapabilitySnapshots, addFontPreloads, findFirstFrameFontAssets,
  addAppPreloads, findAppPreloadHrefs,
} = seoGenerator;
const articles = loadArticles({ reservedPaths: ['/docs/privacy-policy', '/docs/terms-of-service', '/docs/contact'] });
const learnIndex = { title: 'Learn MCP', description: 'Learn description.', summary: 'Learn summary.' };
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

  it('uses definitive Streamable HTTP evidence for a validated /sse endpoint', () => {
    const server = catalogServer('https://example.com/sse', 'legacy-sse');
    server.validatedUrl = 'https://example.com/sse';
    server.transport = 'streamable-http';

    const html = renderServerHtml(indexHtml, server);

    expect(html).toContain('href="/server/https://example.com/sse/mcp"');
    expect(html).toContain('claude mcp add --transport http');
  });

  it('uses /mcp inference when validation reports both despite a legacy declaration', () => {
    const server = catalogServer('https://example.com/mcp', 'legacy-sse');
    server.validatedUrl = 'https://example.com/mcp';
    server.transport = 'both';

    const html = renderServerHtml(indexHtml, server);

    expect(html).toContain('href="/server/https://example.com/mcp/mcp"');
    expect(html).toContain('claude mcp add --transport http');
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

    for (const [client, heading] of [['claude-code', 'Claude Code setup'], ['codex-cli', 'Codex CLI setup'], ['cursor', 'Cursor setup'], ['vscode-copilot', 'VS Code setup']]) {
      expect(html).toContain(`<section class="server-connect-panel" data-client="${client}"><h3>${heading}</h3>`);
    }
    expect(html).toContain('claude mcp add');
    expect(html).toContain('codex mcp add');
    expect(html).toContain('&lt;unsafe&gt;');
    expect(html).not.toContain('<unsafe>');
    expect(html).toContain('Canonical catalog endpoint: <code');
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

  it('renders a documented ApiKey scheme exactly in the static setups', () => {
    const server = catalogServer('https://example.com/mcp', 'streamable-http');
    server.id = 'key-service';
    server.authType = 'api-key';
    server.declaredAuthType = 'api-key';
    server.requiredHeaders = [{
      name: 'Authorization', description: 'Service credential',
      valueTemplate: 'ApiKey <SERVICE_KEY>', required: true, secret: true,
    }];

    const html = renderServerHtml(indexHtml, server);

    expect(html).toContain(
      `claude mcp add --transport http --scope user --header 'Authorization: ApiKey '&quot;\${SERVICE_KEY}&quot; 'key-service' 'https://example.com/mcp'`
    );
    expect(html).toContain('ApiKey ${env:SERVICE_KEY}');
    expect(html).toContain('ApiKey ${input:service_key}');
    expect(html).toContain('including the required syntax ApiKey &lt;credential&gt;');
    expect(html).not.toContain('<strong>Setup unavailable</strong>');
  });

  it('renders prose-only credential metadata as unsupported static setups', () => {
    const server = catalogServer('https://example.com/mcp', 'streamable-http');
    server.authType = 'api-key';
    server.declaredAuthType = 'api-key';
    server.requiredHeaders = [{
      name: 'Authorization', description: 'Send the key as ApiKey <SERVICE_KEY>',
      required: true, secret: true,
    }];

    const html = renderServerHtml(indexHtml, server);

    expect(html.match(/<strong>Setup unavailable<\/strong>/g)).toHaveLength(4);
    expect(html).not.toContain('claude mcp add');
    expect(html).not.toContain('${env:SERVICE_KEY}');
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
    expect(html).toContain('Hosted mcptest operator setup required');
    expect(html).toContain('user-created Asana app and secret work with documented supported clients');
    expect(html).toContain('Retry remains unavailable until the mcptest operator configures a confidential binding server-side');
    expect(html).toContain('creating the app alone does not enable hosted mcptest');
    expect(html).not.toContain('no OAuth secret belongs in this configuration');
  });

  it('renders verified automatic Stripe registration guidance in static HTML', () => {
    const stripe = mergeCatalogServers(
      catalogSeeds, catalogValidation, catalogCapabilities
    ).find(({ id }) => id === 'stripe');
    expect(stripe).toBeDefined();

    const html = renderServerHtml(indexHtml, stripe);
    expect(html).toContain('No app registration needed');
    expect(html).toContain('No additional provider app setup is required');
    expect(html).toContain('https://access.stripe.com/.well-known/oauth-authorization-server/mcp');
    expect(html).not.toContain('Registration requirements not verified');
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
      codexMcpRemote: {
        resourceUrl: 'https://example.com',
        callbackUrl: 'http://localhost:3334/oauth/callback',
        callbackPort: 3334,
      },
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
    expect(html).toContain(`<code class="server-tool-name">${observedTool.name}</code>`);
    expect(html).toContain(`<p class="server-tool-description">${observedTool.description}</p>`);
  });

  it('renders escaped literal capabilities in the page and an escaped featureList in JSON-LD', () => {
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
    expect(html).toContain('id="server-tool-inventory-resources" class="server-tool-inventory-heading">Resources <span class="server-tool-inventory-count">1</span>');
    expect(html).toContain('id="server-tool-inventory-resource-templates" class="server-tool-inventory-heading">Resource templates <span class="server-tool-inventory-count">1</span>');
    expect(html).toContain('Record template');
    expect(html).toContain('id="server-tool-inventory-prompts" class="server-tool-inventory-heading">Prompts');
    expect(html).toContain('&lt;script&gt;alert(1)&lt;/script&gt;');
    expect(html).not.toContain('<script>alert(1)</script>');
    expect(html).toContain('Aug 18, 2026 at 12:32 AM');
    expect(html).not.toContain('<dd>2026-08-18T00:32:48</dd>');
    expect(html).toContain('server-spec-list server-connection-specs');
    expect(html).toContain('<code class="technical-string technical-string-url technical-string-inline">https://example.com/mcp</code>');
    expect(html).toContain('<summary><span class="server-tool-schema-label">Input</span> <code>libraryId: string</code></summary>');
    expect(html).toContain('server-profile-breadcrumb-parent');
    expect(html).toContain('server-profile-breadcrumb-current');
    expect(html).toContain('"name":"Tools observed","value":1');
    const structuredData = html.match(/<script id="server-structured-data"[^>]*>(.*?)<\/script>/)?.[1] || '';
    // featureList carries the tool names, escaped so the script element cannot be closed early.
    expect(structuredData).not.toContain('<script>');
    expect(JSON.parse(structuredData).featureList).toEqual(['<script>alert(1)</script>: safe & useful', 'Prompt summarize']);
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

    const section = (id) => html.slice(html.indexOf(`<section aria-labelledby="${id}">`)).split('</section>')[0];
    expect(section('server-tool-inventory-tools')).toContain('Some details were sanitized for public display.');
    expect(section('server-tool-inventory-resources')).toContain('1 of 2 shown; 1 omitted to keep the page bounded.');
    expect(section('server-tool-inventory-resource-templates')).toContain('Partial listing: 1 of 1 shown; more may exist.');
    expect(html.match(/Partial listing:/g)).toHaveLength(1);
    expect(html).not.toContain('id="server-tool-inventory-prompts"');
  });

  it('uses the server Open Graph card in social metadata and the local logo in static profile markup', () => {
    const server = catalogServer('https://example.com/mcp', 'streamable-http');
    const html = renderServerHtml(indexHtml, server);

    expect(html).toContain('property="og:image" content="https://mcptest.io/og/servers/example-server.png"');
    expect(html).toContain('name="twitter:image" content="https://mcptest.io/og/servers/example-server.png"');
    expect(html).toContain('name="twitter:card" content="summary_large_image"');
    expect(html).toContain('<img src="/server-logos/example-server.svg" alt=""');
    expect(html).not.toContain('server-profile-eyebrow');
  });

  it('never emits a remote logo and renders an accessible static fallback', () => {
    const server = catalogServer('https://example.com/mcp', 'streamable-http');
    server.logoUrl = 'https://remote.example/logo.svg';
    const html = renderServerHtml(indexHtml, server);

    expect(html).not.toContain('https://remote.example/logo.svg');
    expect(html).toContain('property="og:image" content="https://mcptest.io/og/servers/example-server.png"');
    expect(html).toContain('role="img" aria-label="Example Server logo"');
    expect(html).toContain('catalog-server-logo-initials');
  });

  it('leads search and social descriptions with the curated summary intact, then a setup phrase that fits', () => {
    const server = catalogServer('https://example.com/mcp', 'streamable-http');
    server.seoDescription = 'Inspect the Example Server MCP server. Explore example records and queries.';

    const html = renderServerHtml(indexHtml, server);

    const description = 'Inspect the Example Server MCP server. Explore example records and queries. '
      + 'Setup for Claude, ChatGPT, Cursor and more.';
    expect(html).toContain('<title>Example Server MCP Server Report | mcptest.io</title>');
    expect(html).toContain(`name="description" content="${description}"`);
    expect(html).toContain(`property="og:description" content="${description}"`);
    expect(html).toContain(`name="twitter:description" content="${description}"`);
  });

  it('drops client names rather than truncating a long curated summary', () => {
    const server = catalogServer('https://example.com/mcp', 'streamable-http');
    const summary = 'Inspect the Example Server MCP server. Explore example records, saved queries, audit logs, '
      + 'dashboards and workspace settings.';
    server.seoDescription = summary;

    const metaDescription = () => renderServerHtml(indexHtml, server).match(/<meta name="description" content="([^"]*)"/)?.[1];
    const description = metaDescription();

    expect(description.startsWith(`${summary} `)).toBe(true);
    expect(description).not.toContain('…');
    expect(description.length).toBeLessThanOrEqual(158);
    expect(description).toBe(`${summary} Setup for Claude and more.`);

    server.seoDescription = `${summary} Covers every endpoint too.`;
    expect(metaDescription()).toBe(`${summary} Covers every endpoint too.`);
  });

  it('renders the home page with its canonical URL, Open Graph card and crawler-visible landing copy', () => {
    const html = renderHomeHtml(indexHtml, { title: 'Home | mcptest.io', description: 'Home description.' }, 111);
    const document = new DOMParser().parseFromString(html, 'text/html');

    expect(html).toContain('rel="canonical" href="https://mcptest.io"');
    expect(html).toContain('property="og:url" content="https://mcptest.io"');
    expect(html).toContain('property="og:image" content="https://mcptest.io/og/home.png"');
    const root = document.getElementById('root');
    expect(root.querySelector('.landing-title').textContent).toBe('Inspect, debug and evaluate remote MCP servers in your browser');
    expect(root.querySelector('.landing-catalog a[href="/catalog"]').textContent).toContain('Browse 111 public remote MCP servers');
    // The whole first frame, not just the landing: header and sidebar too.
    expect(root.querySelector('.seo-shell-fallback .app-header .app-brand-title').textContent).toBe('mcptest.io');
    expect(root.querySelector('.seo-shell-fallback .desktop-sidebar .app-sidenav a.active').getAttribute('href')).toBe('/');
  });

  it('removes a previous landing fallback so rerunning never copies it into other pages', () => {
    const builtHome = renderHomeHtml(indexHtml, { title: 'Home', description: 'Home description.' }, 3);
    const shell = stripLandingFallback(builtHome);

    expect(shell).toContain('<div id="root"></div>');
    expect(shell).not.toContain('landing-title');
    expect(shell).not.toContain('seo-shell-fallback');
    expect(renderLearnIndexHtml(shell, learnIndex, articles)).not.toContain('seo-landing-fallback');
    // Output of earlier generator versions (landing only) is removed too.
    const landingOnly = indexHtml.replace('<div id="root"></div>', '<div id="root">\n<section class="landing seo-landing-fallback"><h1>x</h1></section>\n    </div>');
    expect(stripLandingFallback(landingOnly)).toBe(indexHtml);
    expect(() => stripLandingFallback('<html><body><div id="root"><p>x</p></div></body></html>')).toThrow('rebuild with Vite');
  });

  it('preloads the first frame fonts once, ahead of the scripts and stylesheets', () => {
    const builtHead = '<html><head><title>t</title>\n    <script type="module" crossorigin src="/assets/index.js"></script>\n    <link rel="stylesheet" crossorigin href="/assets/index.css">\n  </head><body><div id="root"></div></body></html>';
    const hrefs = ['/assets/inter-latin-wght-normal-Dx4kXJAl.woff2', '/assets/bootstrap-icons-mSm7cUeB.woff2'];
    const html = addFontPreloads(builtHead, hrefs);
    const tags = hrefs.map(href => `<link rel="preload" href="${href}" as="font" type="font/woff2" crossorigin />`);

    for (const tag of tags) {
      expect(html.split(tag)).toHaveLength(2);
      expect(html.indexOf(tag)).toBeLessThan(html.indexOf('type="module"'));
      expect(html.indexOf(tag)).toBeLessThan(html.indexOf('rel="stylesheet"'));
    }
    expect(addFontPreloads(html, hrefs)).toBe(html);
    // Every prerendered page is rendered from the same shell, so it inherits the preloads.
    expect(renderLearnIndexHtml(stripLandingFallback(html), learnIndex, articles)).toContain(tags[0]);
  });

  it('takes the font URLs the built stylesheets request, query string included', () => {
    const directory = fs.mkdtempSync(path.join(os.tmpdir(), 'seo-assets-'));
    try {
      expect(() => findFirstFrameFontAssets(directory)).toThrow('Expected one Inter latin woff2');
      fs.writeFileSync(path.join(directory, 'vendor-x.css'), [
        '@font-face{font-family:"Inter Variable";src:url(/assets/inter-cyrillic-wght-normal-DqGufNeO.woff2) format("woff2-variations")}',
        '@font-face{font-family:"Inter Variable";src:url(/assets/inter-latin-ext-wght-normal-DO1Apj_S.woff2) format("woff2-variations")}',
        '@font-face{font-family:"Inter Variable";src:url(/assets/inter-latin-wght-normal-Dx4kXJAl.woff2) format("woff2-variations")}',
        '@font-face{font-family:bootstrap-icons;src:url(/assets/bootstrap-icons-mSm7cUeB.woff2?e3485313) format("woff2"),url(/assets/bootstrap-icons-BeopsB42.woff?e3485313) format("woff")}',
      ].join('\n'));
      fs.writeFileSync(path.join(directory, 'index-x.css'), '.logo{background:url("/assets/inter-latin-wght-normal-Dx4kXJAl.woff2")}');
      expect(findFirstFrameFontAssets(directory)).toEqual([
        '/assets/inter-latin-wght-normal-Dx4kXJAl.woff2',
        '/assets/bootstrap-icons-mSm7cUeB.woff2?e3485313',
      ]);
    } finally {
      fs.rmSync(directory, { recursive: true, force: true });
    }
  });

  it('renders the catalog page with its own metadata and Open Graph card', () => {
    const html = renderCatalogHtml(indexHtml, { title: 'Catalog | mcptest.io', description: 'Catalog description.' });

    expect(html).toContain('<title>Catalog | mcptest.io</title>');
    expect(html).toContain('rel="canonical" href="https://mcptest.io/catalog"');
    expect(html).toContain('property="og:image" content="https://mcptest.io/og/catalog.png"');
    expect(html).toContain('<div id="root"></div>');
  });

  it('prerenders the discovery checker in the app shell, with the form React mounts over at load', () => {
    const metadata = { title: 'MCP Discovery Checker | mcptest.io', description: 'Discovery description.' };
    const html = renderDiscoveryHtml(indexHtml, metadata, { proxyConfigured: true });

    expect(html).toContain('<title>MCP Discovery Checker | mcptest.io</title>');
    expect(html).toContain('rel="canonical" href="https://mcptest.io/tools/discovery"');
    expect(html).toContain('property="og:image" content="https://mcptest.io/og/tools/discovery.png"');
    expect(html).toContain('"@type":"WebApplication"');
    expect(html).toContain('<h1>MCP discovery checker</h1>');
    expect(html).toContain('<label for="discovery-domain" class="form-label">Domain</label>');
    expect(html).toContain('<a href="/learn/make-mcp-server-discoverable">');
    expect(html).not.toContain('The proxy is not configured in this build');
    // An app route: React mounts at load rather than on the first input.
    expect(html).not.toContain('data-deferred-mount');
    expect(html).toContain('<a href="/tools/discovery" class="nav-link sidenav-link active" aria-current="page">');
    expect(renderDiscoveryHtml(indexHtml, metadata)).toContain('The proxy is not configured in this build');
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
    const article = articles.find(item => item.slug === 'mcp-clients-compared');
    const html = renderLearnArticleHtml(indexHtml, article, articles, learnIndex);

    expect(html).toContain(`<title>${article.title} | mcptest.io</title>`);
    expect(html).toContain(`property="og:type" content="article"`);
    expect(html).toContain(`rel="canonical" href="https://mcptest.io/learn/${article.slug}"`);
    expect(html).toContain('type="application/ld+json"');
    expect(html).toContain('"@type":"Article"');
    expect(html).toContain(`"dateModified":"${article.lastReviewed}"`);
    expect(html).toContain(`data-article-slug="${article.slug}"`);
    expect(html).toContain('<h2 id="coverage-and-how-to-read-this-comparison">Coverage and how to read this comparison</h2>');
    expect(html).toContain('<table><thead><tr>');
    expect(html).toContain('Sources</h2>');
    expect(html).toContain('rel="prev" href="/learn/connect-remote-mcp-server"');
    expect(html).toContain('rel="next" href="/learn/oauth-for-mcp-explained"');
  });

  it('sets parseable large-card Open Graph and Twitter image tags and the feed link on article pages', () => {
    const article = articles.find(item => item.slug === 'mcp-clients-compared');
    const shell = '<!DOCTYPE html><html><head><title>mcptest.io</title><meta property="og:image" content="https://mcptest.io/logo.png" /><meta name="twitter:card" content="summary" /></head><body><div id="root"></div></body></html>';
    const document = new DOMParser().parseFromString(renderLearnArticleHtml(shell, article, articles, learnIndex), 'text/html');
    const property = name => Array.from(document.head.querySelectorAll(`meta[property="${name}"]`), meta => meta.getAttribute('content'));
    const named = name => Array.from(document.head.querySelectorAll(`meta[name="${name}"]`), meta => meta.getAttribute('content'));
    const imageUrl = `https://mcptest.io/og${article.path}.png`;

    expect(property('og:image')).toEqual([imageUrl]);
    expect(property('og:image:width')).toEqual(['1200']);
    expect(property('og:image:height')).toEqual(['630']);
    expect(property('og:image:alt')).toEqual([`${article.title} | mcptest.io`]);
    expect(property('og:title')).toEqual([`${article.title} | mcptest.io`]);
    expect(property('og:url')).toEqual([`https://mcptest.io${article.path}`]);
    expect(named('twitter:card')).toEqual(['summary_large_image']);
    expect(named('twitter:image')).toEqual([imageUrl]);

    const feeds = document.head.querySelectorAll('link[rel="alternate"][type="application/rss+xml"]');
    expect(Array.from(feeds, link => link.getAttribute('href'))).toEqual(['https://mcptest.io/learn/feed.xml']);
    const structuredData = JSON.parse(document.getElementById('server-structured-data').textContent);
    expect(structuredData.image).toBe(imageUrl);
  });

  it('advertises the feed on the Learn index but not on server or documentation pages', () => {
    const feedLink = 'type="application/rss+xml"';
    expect(renderLearnIndexHtml(indexHtml, learnIndex, articles)).toContain(feedLink);
    expect(renderLearnIndexHtml(indexHtml, learnIndex, articles)).toContain('property="og:image" content="https://mcptest.io/og/learn.png"');
    expect(renderServerHtml(indexHtml, catalogServer('https://example.com/mcp', 'streamable-http'))).not.toContain(feedLink);
    expect(renderStaticPageHtml(indexHtml, '/docs/contact', { title: 'Contact', description: 'Contact us.' })).not.toContain(feedLink);
  });

  it('nests the prerendered article inside a single-column shell so the no-JS layout reads top to bottom', () => {
    const article = articles.find(item => item.slug === 'mcp-clients-compared');
    const html = renderLearnArticleHtml(indexHtml, article, articles, learnIndex);
    const root = new DOMParser().parseFromString(html, 'text/html').getElementById('root');

    const shell = root.querySelector('.reading-shell');
    expect(shell.classList.contains('reading-shell-single')).toBe(true);
    expect(shell.classList.contains('reading-article')).toBe(false);
    expect(Array.from(shell.children, child => child.className)).toEqual(['reading-article']);

    const content = shell.querySelector('.reading-article');
    expect(content.tagName).toBe('ARTICLE');
    expect(content.getAttribute('data-article-slug')).toBe(article.slug);
    expect(Array.from(content.children, child => child.className)).toEqual([
      'reading-breadcrumb', 'reading-header', 'reading-prose', 'reading-footer',
    ]);
    expect(root.querySelector('.reading-outline')).toBeNull();
  });

  it('renders Markdown documentation pages at their /docs canonical path with frontmatter metadata', () => {
    const article = articles.find(item => item.slug === 'testing-guide');
    const html = renderLearnArticleHtml(indexHtml, article, articles, learnIndex);

    expect(html).toContain('<title>Testing Guide for Remote MCP Servers | mcptest.io</title>');
    expect(html).toContain('rel="canonical" href="https://mcptest.io/docs/testing-guide"');
    expect(html).toContain('name="description" content="Learn how to test, inspect, and debug remote Model Context Protocol (MCP) servers.');
    expect(html).toContain('<blockquote><p><strong>Browser clients need CORS.</strong>');
    expect(html).toContain('<pre><code class="hljs language-bash">curl -i https://your-server.example.com/mcp');
    expect(html).toContain('<h3 id="capabilities">Capabilities</h3>');
  });

  it('prerenders the fragment ids published by the former React docs page', () => {
    const article = articles.find(item => item.path === '/docs/remote-vs-local');
    const html = renderLearnArticleHtml(indexHtml, article, articles, learnIndex);

    expect(html).toContain('<h2 id="local-servers">Local servers: stdio</h2>');
    expect(html).toContain('<h2 id="remote-servers">Remote servers: Streamable HTTP</h2>');
    expect(html).toContain('<h3 id="stateless-flow">2026 stateless flow</h3>');
    expect(html).toContain('<h3 id="stateful-flow">2025 stateful flow</h3>');
    expect(html).toContain('<h3 id="streaming">Streaming and compatibility</h3>');
    expect(html).toContain('<h2 id="authorization">Authorization</h2>');
    expect(html).toContain('<h2 id="cors-security">CORS and origin security</h2>');
    expect(html).toContain('<h2 id="choosing-deployment">Choosing and testing a deployment</h2>');
    expect(html).not.toContain('{#');
  });

  it('prerenders unique heading ids when literal headings collide with generated suffixes', () => {
    const html = renderMarkdown(['## Example', '', '## Example', '', '## Example-2', '', '## `code` {#pinned}'].join('\n'));
    expect(html).toContain('<h2 id="example">Example</h2>');
    expect(html).toContain('<h2 id="example-2">Example</h2>');
    expect(html).toContain('<h2 id="example-2-2">Example-2</h2>');
    expect(html).toContain('<h2 id="pinned"><code>code</code></h2>');
  });

  it('prerenders entity and link headings with the ids the outline links to', () => {
    const markdown = [
      '## Authentication &amp; permissions',
      '',
      '## [OAuth](https://example.com)',
      '',
      '### Tools &#38; resources',
      '',
      '## `&amp;` in code',
    ].join('\n');
    const html = renderMarkdown(markdown);
    expect(html).toContain('<h2 id="authentication-permissions">');
    expect(html).toContain('<h2 id="oauth"><a href="https://example.com">OAuth</a></h2>');
    expect(html).toContain('<h3 id="tools-resources">');
    expect(html).toContain('<h2 id="amp-in-code"><code>&amp;amp;</code> in code</h2>');

    const ids = Array.from(html.matchAll(/<h[23] id="([^"]+)">/g), match => match[1]);
    expect(ids).toEqual(extractOutline(markdown).map(heading => heading.id));
  });

  it('prerenders reference-link and quoted headings with the ids the outline links to', () => {
    const markdown = [
      '## [OAuth][auth]',
      '',
      'Body.',
      '',
      '> ### [Dynamic client registration][]',
      '> quoted body',
      '',
      '## [Tokens] {#token-handling}',
      '',
      '## [Undefined][missing]',
      '',
      '[auth]: https://example.com/oauth',
      '[dynamic client registration]: https://example.com/dcr',
      '[tokens]: https://example.com/tokens',
    ].join('\n');
    const html = renderMarkdown(markdown);
    expect(html).toContain('<h2 id="oauth">');
    expect(html).toContain('<blockquote><h3 id="dynamic-client-registration">');
    expect(html).toContain('<h2 id="token-handling">');
    expect(html).toContain('<h2 id="undefinedmissing">');
    expect(html).not.toContain('{#');

    const ids = Array.from(html.matchAll(/<h[23] id="([^"]+)">/g), match => match[1]);
    expect(ids).toEqual(extractOutline(markdown).map(heading => heading.id));
  });

  it('renders tilde-fenced code without allocating a heading id inside the fence', () => {
    const markdown = ['## Example', '', '~~~', '## Example', '~~~', '', '## Example'].join('\n');
    const html = renderMarkdown(markdown);
    expect(html).toContain('<pre><code>## Example</code></pre>');
    expect(html).toContain('<h2 id="example">Example</h2>');
    expect(html).toContain('<h2 id="example-2">Example</h2>');
    expect(html).not.toContain('example-3');

    const ids = Array.from(html.matchAll(/<h2 id="([^"]+)">/g), match => match[1]);
    expect(ids).toEqual(extractOutline(markdown).map(heading => heading.id));
  });

  it('highlights fenced code at build time with the languages the browser registers', () => {
    // The static HTML carries highlight.js markup so a guide paints colored code
    // before any script runs; unknown languages stay plain, as in the browser.
    const html = renderMarkdown('```typescript\nconst x: number = 1;\n```\n\n```nginx\nserver {}\n```\n\n```\nplain\n```');
    expect(html).toContain('<pre><code class="hljs language-typescript"><span class="hljs-keyword">const</span> <span class="hljs-attr">x</span>: <span class="hljs-built_in">number</span> = <span class="hljs-number">1</span>;</code></pre>');
    expect(html).toContain('<pre><code class="language-nginx">server {}</code></pre>');
    expect(html).toContain('<pre><code>plain</code></pre>');
  });

  it('closes a fence only with a matching delimiter of at least the opening length', () => {
    const markdown = ['~~~~ text', '```', '## not a heading', '~~~', '~~~~', '', '```js', 'const a = `~~~`;', '```'].join('\n');
    const html = renderMarkdown(markdown);
    expect(html).toContain('<pre><code class="language-text">```\n## not a heading\n~~~</code></pre>');
    expect(html).toContain('<pre><code class="hljs language-js"><span class="hljs-keyword">const</span> a = <span class="hljs-string">`~~~`</span>;</code></pre>');
    expect(html).not.toContain('<h2');
  });

  it('skips Markdown comment blocks without allocating heading ids for their contents', () => {
    const markdown = [
      '## Intro',
      '',
      '<!--',
      '## Draft notes',
      '-->',
      '',
      '## Intro',
      'Paragraph text',
      '<!-- ## interrupting comment -->',
      '',
      '> <!--',
      '> ## quoted draft',
      '> -->',
      '> ## Quoted',
      '',
      '<!-- unterminated',
      '## never rendered',
    ].join('\n');
    const html = renderMarkdown(markdown);
    expect(html).toContain('<h2 id="intro">Intro</h2>');
    expect(html).toContain('<h2 id="intro-2">Intro</h2>');
    expect(html).toContain('<p>Paragraph text</p>');
    expect(html).toContain('<blockquote><h2 id="quoted">Quoted</h2></blockquote>');
    expect(html).not.toContain('Draft notes');
    expect(html).not.toContain('interrupting');
    expect(html).not.toContain('quoted draft');
    expect(html).not.toContain('never rendered');
    expect(html).not.toContain('&lt;!--');

    const ids = Array.from(html.matchAll(/<h2 id="([^"]+)">/g), match => match[1]);
    expect(ids).toEqual(extractOutline(markdown).map(heading => heading.id));
  });

  it('renders the Learn index grouped by track', () => {
    const html = renderLearnIndexHtml(indexHtml, learnIndex, articles);

    expect(html).toContain('<title>Learn MCP | mcptest.io</title>');
    expect(html).toContain('rel="canonical" href="https://mcptest.io/learn"');
    expect(html).toContain('<section class="learn-track" id="track-understand">');
    expect(html).toContain('<section class="learn-track" id="track-reference">');
    expect(html).not.toContain('learn-card');
    for (const article of articles) {
      expect(html).toContain(`href="${article.path}">${article.title}</a>`);
    }
  });

  it('lists every article in the sitemap at its canonical path without .md alternates', () => {
    const sitemap = renderSitemap([{ id: 'example-server', checkedAt: '2026-10-20T15:30:37.843Z' }], articles, ['privacy-policy']);

    expect(sitemap).toContain('<loc>https://mcptest.io/learn</loc>');
    expect(sitemap).toContain('<loc>https://mcptest.io/docs/what-is-mcp</loc>');
    expect(sitemap).toContain('<loc>https://mcptest.io/servers/example-server/</loc>');
    for (const article of articles) {
      expect(sitemap).toContain(`<loc>https://mcptest.io${article.path}</loc>\n    <lastmod>${article.lastReviewed}</lastmod>`);
    }
    expect(sitemap).not.toContain('.md</loc>');
    // React-only documentation pages are prerendered and indexable, so they are listed too.
    expect(sitemap).toContain('<loc>https://mcptest.io/docs/privacy-policy</loc>');
  });
});

describe('generated server profile badge embed', () => {
  it('renders escaped catalog badge snippets that use the worker badge endpoint', () => {
    const [server] = mergeCatalogServers(
      catalogSeeds.filter((seed) => seed.id === 'context7'),
      catalogValidation,
      catalogCapabilities
    );
    const html = renderServerHtml(indexHtml, server);
    expect(html).toContain('<h2 id="server-badge-embed-title">Share and embed</h2>');
    // Sized like the badge SVG, so the preview reserves its box before it loads.
    expect(html).toContain('<img src="/badge/ready.svg" alt="mcptest.io: ready" width="110" height="20">');
    expect(html).toContain(
      '[![Tested on mcptest.io](https://mcptest.io/badge/server/context7.svg)](https://mcptest.io/servers/context7/)'
    );
    expect(html).toContain(
      '&lt;a href=&quot;https://mcptest.io/servers/context7/&quot;&gt;&lt;img src=&quot;https://mcptest.io/badge/server/context7.svg&quot;'
    );
    expect(html).toContain('.. image:: https://mcptest.io/badge/server/context7.svg\n   :alt: Tested on mcptest.io\n   :target: https://mcptest.io/servers/context7/');
  });

  it('previews the neutral badge for a server without a validation run', () => {
    const html = renderServerHtml(indexHtml, catalogServer('https://example.com/mcp', 'streamable-http'));
    expect(html).toContain('<img src="/badge/mcptest.svg" alt="tested on: mcptest.io" width="130" height="20">');
    expect(html).toContain('https://mcptest.io/badge/server/example-server.svg');
  });
});

describe('content pages in the app shell (issue #405)', () => {
  const learnTracks = buildLearnTrackNavigation(buildTrackNavigation(articles));
  const shell = { learnTracks, authEnabled: false };
  const rootOf = html => new DOMParser().parseFromString(html, 'text/html').getElementById('root');

  it('puts a guide in the header and sidebar, mounted on first input, with its track open', () => {
    const article = articles.find(item => item.slug === 'mcp-clients-compared');
    const root = rootOf(renderLearnArticleHtml(indexHtml, article, articles, learnIndex, { shell, pageHtml: '<div class="reading-shell">guide</div>' }));
    const app = root.querySelector(':scope > .app-shell.seo-shell-fallback');

    expect(app.hasAttribute('data-deferred-mount')).toBe(true);
    expect(app.dataset).toMatchObject({
      pageViewTitle: `Learn: ${article.title}`,
      guideSlug: article.slug,
      guideTrack: article.track,
    });
    expect(app.querySelector('.app-header .app-brand-title').textContent).toBe('mcptest.io');
    expect(app.querySelector('.main-content > .view-panel').getAttribute('style')).toBe('min-height: 100%;');
    expect(app.querySelector('.main-content > .view-panel').innerHTML.trim()).toBe('<div class="reading-shell">guide</div>');

    // ContentTrackNav: the owning track is expanded and the guide is the current link.
    const track = learnTracks.find(item => item.items.some(entry => entry.path === article.path));
    const toggle = app.querySelector(`.content-track[data-track="${track.id}"] > button`);
    expect(toggle.classList.contains('is-current')).toBe(true);
    expect(toggle.getAttribute('aria-expanded')).toBe('true');
    expect(app.querySelector(`#${toggle.getAttribute('aria-controls')}`).hasAttribute('hidden')).toBe(false);
    const current = app.querySelector('.sidenav-sublink[aria-current="page"]');
    expect(current.getAttribute('href')).toBe(article.path);
    expect(current.classList.contains('active')).toBe(true);
    expect(app.querySelectorAll('.content-track > button[aria-expanded="true"]')).toHaveLength(1);
    // No primary destination is active on a guide; the guide search takes `/`.
    expect(app.querySelectorAll('.sidenav-group:first-child a.nav-link.active')).toHaveLength(0);
    expect(app.querySelector('.guide-search-input').getAttribute('aria-keyshortcuts')).toBe('/');
    expect(app.querySelector('.guide-search-field kbd.guide-search-shortcut').textContent).toBe('/');
  });

  it('logs documentation articles under the docs page view title', () => {
    const article = articles.find(item => item.path === '/docs/testing-guide');
    const app = rootOf(renderLearnArticleHtml(indexHtml, article, articles, learnIndex, { shell })).firstElementChild;
    expect(app.dataset.pageViewTitle).toBe('Docs: testing guide');
  });

  it('marks the guide hub on the Learn index', () => {
    const app = rootOf(renderLearnIndexHtml(indexHtml, learnIndex, articles, { shell })).firstElementChild;
    expect(app.dataset.pageViewTitle).toBe('Learn MCP');
    expect(app.querySelector('.content-track-nav a.active[aria-current="page"]').getAttribute('href')).toBe('/learn');
    expect(app.querySelectorAll('.content-track > button[aria-expanded="true"]')).toHaveLength(0);
  });

  it('puts a server profile under the catalog link, with sized logo and badge images', () => {
    const server = catalogServer('https://example.com/mcp', 'streamable-http');
    const app = rootOf(renderServerHtml(indexHtml, server, { shell })).firstElementChild;

    expect(app.hasAttribute('data-deferred-mount')).toBe(true);
    expect(app.dataset.pageViewTitle).toBe('Example Server MCP Server Report');
    expect(app.querySelector('.main-content > .view-panel').getAttribute('style')).toBe('height: 100%;');
    expect(app.querySelector('.sidenav-group:first-child a.nav-link.active').getAttribute('href')).toBe('/catalog');
    expect(app.querySelector('.server-profile-logo img').getAttribute('width')).toBe('40');
    expect(app.querySelector('.server-profile-logo img').getAttribute('height')).toBe('40');
    expect(app.querySelector('.badge-embed-preview img').getAttribute('width')).toBe('130');
  });

  it('keeps the home page mounting at load', () => {
    const html = renderHomeHtml(indexHtml, { title: 'Home', description: 'Home.' }, 3, shell);
    expect(html).not.toContain('data-deferred-mount');
    expect(rootOf(html).querySelector('.sidenav-group:first-child a.nav-link.active').getAttribute('href')).toBe('/');
  });

  it('preloads the app on pages that mount at load only', () => {
    const head = '<html><head>\n    <script type="module" crossorigin src="/assets/index.js"></script>\n    <link rel="stylesheet" crossorigin href="/assets/style.css">\n  </head>';
    const hrefs = ['/assets/bootstrapApp.js', '/assets/react.js'];
    const appPage = addAppPreloads(`${head}<body><div id="root"></div></body></html>`, hrefs);

    expect(appPage).toContain('src="/assets/index.js"></script>\n    <link rel="modulepreload" crossorigin href="/assets/bootstrapApp.js" data-app-preload>\n    <link rel="modulepreload" crossorigin href="/assets/react.js" data-app-preload>');
    expect(addAppPreloads(appPage, hrefs)).toBe(appPage);
    expect(stripLandingFallback(appPage)).not.toContain('data-app-preload');

    const contentPage = `${head}<body><div id="root"><div class="app-shell" data-deferred-mount></div></div></body></html>`;
    expect(addAppPreloads(contentPage, hrefs)).toBe(contentPage);
  });

  it('finds the app chunk and its static imports in the build manifest', () => {
    const manifest = {
      'index.html': { file: 'assets/index.js', isEntry: true, imports: ['_runtime.js'], dynamicImports: ['_bootstrapApp.js'] },
      '_runtime.js': { file: 'assets/runtime.js' },
      '_bootstrapApp.js': { file: 'assets/bootstrapApp.js', name: 'bootstrapApp', isDynamicEntry: true, imports: ['_react.js', '_runtime.js', 'index.html'] },
      '_react.js': { file: 'assets/react.js', imports: ['_runtime.js'] },
    };
    expect(findAppPreloadHrefs(manifest)).toEqual(['/assets/bootstrapApp.js', '/assets/react.js']);
    expect(() => findAppPreloadHrefs({ 'index.html': { file: 'assets/index.js', dynamicImports: [] } })).toThrow('bootstrapApp');
  });
});

describe('server page "Connect it" section', () => {
  const { renderServerConnect } = catalogPages;
  const servers = mergeCatalogServers(catalogSeeds, catalogValidation, catalogCapabilities);
  const parse = (html) => new DOMParser().parseFromString(html, 'text/html');
  const context7 = () => servers.find(({ id }) => id === 'context7');

  it('renders setup for every client, the agent prompt and a compatibility row per client without JavaScript', () => {
    const server = context7();
    const document = parse(renderServerHtml(indexHtml, server));
    const section = document.querySelector('section.server-connect');
    expect(section?.querySelector('h2#server-connect-title')?.textContent).toBe('Connect it');

    const radios = Array.from(section.querySelectorAll('.server-connect-switch input[type="radio"]'));
    const clientIds = radios.map(({ id }) => id.replace(/^connect-/, ''));
    expect(clientIds).toHaveLength(10);
    expect(clientIds.slice(0, 4)).toEqual(['claude-code', 'codex-cli', 'cursor', 'vscode-copilot']);
    expect(radios.filter(({ checked }) => checked).map(({ id }) => id)).toEqual(['connect-claude-code']);
    expect(section.querySelector('fieldset.server-connect-switch')?.hasAttribute('data-carry-choice')).toBe(true);
    expect(Array.from(section.querySelectorAll('.server-connect-panel')).map(panel => panel.dataset.client)).toEqual(clientIds);

    // Every copy button names an element that holds its text.
    const buttons = Array.from(section.querySelectorAll('button[data-copy-from]'));
    expect(buttons.length).toBeGreaterThanOrEqual(5);
    for (const button of buttons) expect(document.getElementById(button.dataset.copyFrom), button.dataset.copyFrom).not.toBeNull();

    const prompt = section.querySelector('details.server-connect-agent-details pre#server-connect-agent-prompt')?.textContent || '';
    expect(section.querySelector('.server-connect-agent-copy')?.textContent).toBe('Copy as agent prompt');
    expect(prompt).toContain('Add the Context7 MCP server');
    expect(prompt).toContain('Server URL: https://mcp.context7.com/mcp');
    expect(prompt).toContain('Authentication: none');
    for (const tool of server.capabilityInventory.tools.items) expect(prompt).toContain(tool.name);
    expect(prompt).toContain('call tools/list');

    const claude = section.querySelector('.server-connect-panel[data-client="claude-ai"]');
    expect(claude.textContent).toContain('Add custom connector');

    const rows = Array.from(section.querySelectorAll('table.server-connect-compat tbody tr'));
    expect(rows.map(row => row.querySelector('th').textContent)).toEqual(radios.map(radio => section.querySelector(`label[for="${radio.id}"]`).textContent));
    for (const row of rows) {
      expect(row.querySelector('th a').getAttribute('href')).toMatch(/^(\/learn\/|https:\/\/)/);
      expect(row.querySelector('td[data-level]').textContent).toMatch(/^(Supported|Partial|Not supported)$/);
    }
    const cursor = rows.find(row => row.querySelector('th').textContent === 'Cursor');
    expect(cursor.textContent).toContain('Supported');
    expect(cursor.textContent).toContain('Cursor supports Streamable HTTP servers and servers without authentication.');
    const claudeRow = rows.find(row => row.querySelector('th').textContent === 'Claude');
    expect(claudeRow.querySelector('a').getAttribute('href')).toBe('/learn/add-remote-mcp-server-to-claude');
  });

  it('reports clients that cannot send an API key header as not supported and leaves them out of the meta description', () => {
    const server = catalogServer('https://example.com/mcp', 'streamable-http');
    server.authType = 'api-key';
    server.declaredAuthType = 'api-key';
    server.requiredHeaders = [{ name: 'X-API-Key', valueTemplate: '<EXAMPLE_API_KEY>', required: true, secret: true }];

    const html = renderServerHtml(indexHtml, server);
    const document = parse(html);
    const chatgpt = Array.from(document.querySelectorAll('table.server-connect-compat tbody tr'))
      .find(row => row.querySelector('th').textContent === 'ChatGPT');
    expect(chatgpt.querySelector('td[data-level="unsupported"]').textContent).toBe('Not supported');
    expect(chatgpt.textContent).toContain('ChatGPT does not support API key headers');

    const description = document.querySelector('meta[name="description"]').getAttribute('content');
    expect(description).toBe('An example MCP server. Setup for Claude, Cursor, VS Code and more.');
    expect(description).not.toContain('ChatGPT');
    expect(description).toContain('Cursor');
  });

  it('adds the setup location, requirements and client support to the JSON-LD', () => {
    const html = renderServerHtml(indexHtml, context7());
    const structuredData = JSON.parse(html.match(/<script id="server-structured-data"[^>]*>(.*?)<\/script>/)?.[1] || '{}');
    expect(structuredData.installUrl).toBe('https://mcptest.io/servers/context7/#server-connect-title');
    expect(structuredData.softwareRequirements).toMatch(/^An MCP client that connects to Streamable HTTP remote servers, such as Claude Code, /);
    const supported = structuredData.additionalProperty.find(({ name }) => name === 'Supported MCP clients');
    expect(supported.value).toContain('Claude Code');
    expect(supported.value).toContain('ChatGPT');
  });

  it('keeps the section small enough for every catalog server', () => {
    // Issue #444 lets a server page grow by about 15 KB. The section replaced
    // four stacked client setups of 2.8 KB (context7) to 12 KB (asana), and
    // measured 9-16 KB when it landed; a larger section needs a new budget.
    const sizes = servers.map(server => ({ id: server.id, bytes: Buffer.byteLength(renderServerConnect(server)) }));
    const largest = sizes.reduce((max, size) => (size.bytes > max.bytes ? size : max));
    expect(largest.bytes, largest.id).toBeLessThan(18_000);
  });
});
