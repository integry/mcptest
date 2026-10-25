import React from 'react';
import { renderToStaticMarkup } from 'react-dom/server';
import { MemoryRouter } from 'react-router-dom';
import { describe, expect, it, vi } from 'vitest';
import ServerProfileView from './ServerProfileView';
import generator from '../../scripts/generate-seo-pages.js';
import { getCatalogAuthAnswer } from '../utils/catalogSeo';
import { getServerPageSeo } from '../utils/serverConnect';
import { createCapabilityInventory } from '../utils/capabilityInventory';
import type { CatalogServer } from '../types/catalog';
import { getCatalogServerById } from '../utils/catalogUtils';

describe('ServerProfileView capability inventory', () => {
  it('distinguishes Asana desktop app setup from hosted mcptest operator setup', () => {
    const asana = getCatalogServerById('asana');
    expect(asana).toBeDefined();

    const markup = renderToStaticMarkup(
      <MemoryRouter><ServerProfileView server={asana!} onTestServer={vi.fn()} /></MemoryRouter>
    );

    expect(markup).toContain('Hosted mcptest operator setup required');
    expect(markup).toContain('user-created Asana app and secret work with documented supported clients');
    expect(markup).toContain('Retry remains unavailable until the mcptest operator configures a confidential binding server-side');
    expect(markup).toContain('creating the app alone does not enable hosted mcptest');
  });

  it('renders the catalog snapshot with semantic provider headings', () => {
    const server: CatalogServer = {
      id: 'example', name: 'Example', url: 'https://example.com/mcp', description: 'Example server',
      category: 'Testing', tags: [], declaredTransport: 'streamable-http', transport: 'streamable-http',
      listingSource: { kind: 'community' },
      requiresOAuth: false, declaredAuthType: 'none', authType: 'none', protocolEra: 'stateless', status: 'online',
      alternativeAuthTypes: ['bearer-token'],
      alternativeEndpoints: [{
        url: 'https://example.com/token-mcp',
        authType: 'bearer-token',
        description: 'Use when supplying a token directly',
      }],
      caveats: ['Confirm consequential actions before submission.'],
      checkedAt: '2026-08-18T00:32:48', homepageUrl: 'https://example.com',
      logoUrl: '/server-logos/example.svg', logoSourceKind: 'generated-fallback', logoRetrievedAt: '2026-08-17',
      capabilityInventory: createCapabilityInventory({
        observedAt: '2026-08-17T22:00:00.000Z', testedEndpoint: 'https://example.com/mcp',
        route: 'direct', authentication: 'unauthenticated',
        statuses: { tools: 'complete', resources: 'complete', resourceTemplates: 'complete', prompts: 'complete' },
        discovered: {
          tools: [{
            name: 'find_items',
            description: 'Find items',
            inputSchema: {
              properties: { libraryId: { type: 'string' } },
              required: ['libraryId'],
            },
          }],
          resources: [{ name: 'Public items' }],
          resourceTemplates: [{ name: 'Item template' }],
          prompts: [{ name: 'summarize_items' }],
        },
      }),
    };
    const markup = renderToStaticMarkup(
      <MemoryRouter><ServerProfileView server={server} onTestServer={vi.fn()} /></MemoryRouter>
    );

    expect(markup).toContain('Tool inventory');
    expect(markup).toContain('Tools provided by Example');
    expect(markup).toContain('find_items');
    expect(markup).toContain('Aug 18, 2026 at 12:32 AM');
    expect(markup).not.toContain('12:32:48');
    expect(markup).toContain('server-spec-list server-connection-specs');
    expect(markup).toContain('technical-string technical-string-url');
    expect(markup).toContain('technical-string technical-string-url technical-string-inline');
    expect(markup).toContain('<code>libraryId: string</code>');
    expect(markup).toContain('Also supports Bearer token');
    expect(markup).toContain('Alternative credential');
    expect(markup).toContain('https://example.com/token-mcp');
    expect(markup).toContain('Provider guidance');
    expect(markup).toContain('Confirm consequential actions before submission.');
    expect(markup.match(/server-profile-action"/g)).toHaveLength(2);
    expect(markup).toContain('server-profile-breadcrumb-parent');
    expect(markup).toContain('server-profile-breadcrumb-current');
    expect(markup).toContain('btn btn-sm btn-ghost server-endpoint-copy');
    expect(markup).not.toContain('btn btn-sm btn-outline-secondary');
    expect(markup).not.toContain('rounded-pill');
    expect(markup).not.toContain('dangerouslySetInnerHTML');
  });

  it('offers catalog badge snippets that use the worker badge endpoint', () => {
    const context7 = getCatalogServerById('context7');
    expect(context7).toBeDefined();
    const container = document.createElement('div');
    container.innerHTML = renderToStaticMarkup(
      <MemoryRouter><ServerProfileView server={context7!} onTestServer={vi.fn()} /></MemoryRouter>
    );

    const section = container.querySelector('section[aria-labelledby="server-badge-embed-title"]');
    expect(section?.querySelector('h2')?.textContent).toBe('Share and embed');
    expect(section?.querySelector('img')?.getAttribute('src')).toBe('/badge/ready.svg');
    expect(Array.from(section?.querySelectorAll('textarea') ?? []).map((field) => field.textContent)).toEqual([
      '[![Tested on mcptest.io](https://mcptest.io/badge/server/context7.svg)](https://mcptest.io/servers/context7/)',
      '<a href="https://mcptest.io/servers/context7/"><img src="https://mcptest.io/badge/server/context7.svg" alt="Tested on mcptest.io"></a>',
      '.. image:: https://mcptest.io/badge/server/context7.svg\n   :alt: Tested on mcptest.io\n   :target: https://mcptest.io/servers/context7/',
    ]);
  });

  it('previews the authorization-required badge for an OAuth catalog server', () => {
    const github = getCatalogServerById('github');
    const markup = renderToStaticMarkup(
      <MemoryRouter><ServerProfileView server={github!} onTestServer={vi.fn()} /></MemoryRouter>
    );
    expect(markup).toContain('src="/badge/authorization-required.svg"');
    expect(markup).toContain('https://mcptest.io/badge/server/github.svg');
  });
});


describe('server page SEO prerender parity', () => {
  it.each(['canva', 'context7', 'airtable', 'docusign-developer', 'neon', 'upwork'])(
    'matches visible endpoint/auth answers and metadata for %s', (id) => {
      const server = getCatalogServerById(id)!;
      expect(server).toBeDefined();
      const parse = (html: string) => new DOMParser().parseFromString(html, 'text/html');
      const prerendered = parse(generator.renderServerHtml('<html><head><title></title></head><body><div id="root"></div></body></html>', server));
      const react = parse(renderToStaticMarkup(
        <MemoryRouter><ServerProfileView server={server} onTestServer={vi.fn()} /></MemoryRouter>
      ));
      for (const selector of ['h1', '.server-profile-hero p', '[aria-labelledby="server-auth-title"]']) {
        const normalize = (doc: Document) => doc.querySelector(selector)?.textContent?.replace(/\s+/g, ' ').trim();
        expect(normalize(prerendered)).toBe(normalize(react));
      }
      expect(react.querySelector('h1')?.textContent).toBe(`${server.name} MCP server`);
      expect(react.querySelector('h1')?.nextElementSibling?.textContent).toBe(
        `Endpoint: ${server.url} · Authentication: ${getCatalogAuthAnswer(server).label}`
      );
      expect(prerendered.querySelector('h1')?.nextElementSibling?.textContent)
        .toBe(react.querySelector('h1')?.nextElementSibling?.textContent);
      expect(prerendered.querySelector('[aria-labelledby="server-auth-title"] a')?.getAttribute('href'))
        .toBe(react.querySelector('[aria-labelledby="server-auth-title"] a')?.getAttribute('href'));
      const seo = getServerPageSeo(server);
      expect(prerendered.title).toBe(seo.title);
      for (const selector of ['meta[name="description"]', 'meta[property="og:description"]', 'meta[name="twitter:description"]']) {
        expect(prerendered.querySelector(selector)?.getAttribute('content')).toBe(seo.description);
      }
      expect(seo.title.length).toBeLessThanOrEqual(60);
      expect(seo.description.length).toBeLessThanOrEqual(158);
    }
  );
});
