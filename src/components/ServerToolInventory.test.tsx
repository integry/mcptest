import React from 'react';
import { renderToStaticMarkup } from 'react-dom/server';
import { MemoryRouter } from 'react-router-dom';
import { describe, expect, it, vi } from 'vitest';
import ServerProfileView from './ServerProfileView';
import ServerToolInventory from './ServerToolInventory';
import { createCapabilityInventory, validateCapabilityInventory } from '../utils/capabilityInventory';
import { getCatalogServerSeo } from '../utils/catalogSeo';
import { getCatalogServerById } from '../utils/catalogUtils';
import { PublicReportSchema } from '../utils/reportArtifact';
import type { CatalogServer } from '../types/catalog';

const inventory = createCapabilityInventory({
  observedAt: '2026-10-20T15:30:46.187Z',
  testedEndpoint: 'https://example.com/mcp',
  route: 'direct',
  authentication: 'unauthenticated',
  statuses: { tools: 'complete', resources: 'complete', resourceTemplates: 'complete', prompts: 'complete' },
  discovered: {
    tools: [
      {
        name: 'search_docs',
        description: 'Search the documentation. Returns ranked passages.',
        inputSchema: {
          type: 'object',
          properties: { query: { type: 'string', description: 'What to look for' }, limit: { type: 'integer' } },
          required: ['query'],
        },
        outputSchema: { type: 'object', properties: { results: { type: 'array' } } },
      },
      { name: 'ping', inputSchema: { type: 'object' } },
    ],
    resources: [{ name: 'Changelog', mimeType: 'text/markdown' }],
    resourceTemplates: [],
    prompts: [{ name: 'summarize', arguments: [{ name: 'topic', required: true }] }],
  },
});

const server = (overrides: Partial<CatalogServer> = {}): CatalogServer => ({
  id: 'example', name: 'Example', url: 'https://example.com/mcp', description: 'Example server',
  category: 'Documentation', tags: ['docs'], declaredTransport: 'streamable-http', transport: 'streamable-http',
  listingSource: { kind: 'community' }, requiresOAuth: false, declaredAuthType: 'none', authType: 'none',
  protocolEra: 'stateless', status: 'online', logoUrl: '/server-logos/example.svg',
  logoSourceKind: 'generated-fallback', logoRetrievedAt: '2026-08-17',
  ...overrides,
});

const render = (element: React.ReactElement) => {
  const container = document.createElement('div');
  container.innerHTML = renderToStaticMarkup(<MemoryRouter>{element}</MemoryRouter>);
  return container;
};

describe('capability inventory outputSchema presence', () => {
  it('records whether each tool declared an outputSchema, never the schema itself', () => {
    expect(inventory.tools.items.map(({ name, outputSchema }) => [name, outputSchema])).toEqual([
      ['ping', false],
      ['search_docs', true],
    ]);
    expect(JSON.stringify(inventory)).not.toContain('results');
    expect(validateCapabilityInventory(structuredClone(inventory))).toEqual(inventory);
  });

  it('keeps older snapshots without the flag valid and rejects a non-boolean flag', () => {
    const legacy = structuredClone(inventory);
    legacy.tools.items.forEach((tool) => delete tool.outputSchema);
    expect(validateCapabilityInventory(legacy).tools.items[0]).not.toHaveProperty('outputSchema');

    const tampered = structuredClone(inventory) as unknown as { tools: { items: Array<Record<string, unknown>> } };
    tampered.tools.items[0].outputSchema = 'yes';
    expect(() => validateCapabilityInventory(tampered)).toThrow();
  });

  it('accepts the flag in published report artifacts', () => {
    const schema = PublicReportSchema.shape.capabilityInventory;
    expect(schema.safeParse(inventory).success).toBe(true);
  });
});

describe('ServerToolInventory', () => {
  it('lists tools with a collapsed input summary, outputSchema presence and the snapshot date', () => {
    const container = render(<ServerToolInventory server={server({ capabilityInventory: inventory })} />);
    const rows = [...container.querySelectorAll('.server-tool-row')];

    expect(container.querySelector('h2')?.textContent).toBe('Tool inventory');
    expect(container.querySelector('.server-tool-inventory-provenance')?.textContent).toContain(
      'What the catalog validator observed on Oct 20, 2026 at https://example.com/mcp without credentials.'
    );
    expect(container.querySelector('time')?.getAttribute('datetime')).toBe('2026-10-20T15:30:46.187Z');
    expect(container.querySelector('#server-tool-inventory-tools')?.textContent).toBe('Tools provided by Example 2');

    const search = rows.find((row) => row.querySelector('.server-tool-name')?.textContent === 'search_docs')!;
    expect(search.querySelector('.server-tool-output')?.textContent).toBe('outputSchema declared');
    expect(search.querySelector('.server-tool-description')?.textContent).toBe('Search the documentation. Returns ranked passages.');
    const details = search.querySelector('details.server-tool-schema')!;
    expect(details.hasAttribute('open')).toBe(false);
    expect(details.querySelector('summary')?.textContent).toBe('Input limit?: integer, query: string');
    expect(details.querySelector('.server-tool-parameters')?.textContent).toContain('What to look for');

    const ping = rows.find((row) => row.querySelector('.server-tool-name')?.textContent === 'ping')!;
    expect(ping.querySelector('.server-tool-output')?.textContent).toBe('No outputSchema');
    expect(ping.querySelector('.server-tool-schema')?.textContent).toBe('Input No parameters');

    expect(container.querySelector('#server-tool-inventory-resources')?.textContent).toBe('Resources 1');
    expect(container.textContent).toContain('text/markdown');
    expect(container.querySelector('#server-tool-inventory-prompts')?.textContent).toBe('Prompts 1');
    expect(container.textContent).toContain('topic: any');
  });

  it('says an inventory needs authorization instead of showing nothing for credentialed servers', () => {
    const container = render(<ServerToolInventory server={server({ authType: 'oauth', name: 'Locked' })} />);
    const note = container.querySelector('.server-tool-inventory-missing');

    expect(note?.querySelector('strong')?.textContent).toBe('Requires authorization; inventory not observed');
    expect(note?.textContent).toContain('Locked asks for OAuth 2.1 sign-in first');
    expect(container.querySelector('.server-tool-list')).toBeNull();
  });

  it('marks a public server without a snapshot as not observed', () => {
    const container = render(<ServerToolInventory server={server()} />);
    expect(container.querySelector('.server-tool-inventory-missing strong')?.textContent).toBe('Inventory not observed');
  });

  it('renders on catalog server pages with and without a snapshot, linked to the category page', () => {
    const astro = getCatalogServerById('astro-docs')!;
    const github = getCatalogServerById('github')!;
    const withSnapshot = render(<ServerProfileView server={astro} onTestServer={vi.fn()} />);
    const withoutSnapshot = render(<ServerProfileView server={github} onTestServer={vi.fn()} />);

    expect(withSnapshot.querySelectorAll('.server-tool-row').length).toBe(astro.capabilityInventory!.tools.items.length);
    expect(withSnapshot.querySelector('.server-profile-breadcrumb a[href="/catalog/documentation"]')?.textContent).toBe('Documentation');
    expect(withoutSnapshot.querySelector('.server-tool-inventory-missing strong')?.textContent).toBe(
      'Requires authorization; inventory not observed'
    );
    expect(withoutSnapshot.querySelector('a[href="/catalog/developer-tools"]')).not.toBeNull();
  });
});

describe('server structured data', () => {
  it('describes the observed tools as a SoftwareApplication featureList', () => {
    const { structuredData } = getCatalogServerSeo(server({ capabilityInventory: inventory }));
    const parsed = JSON.parse(JSON.stringify(structuredData));

    expect(parsed['@context']).toBe('https://schema.org');
    expect(parsed['@type']).toEqual(['WebAPI', 'SoftwareApplication']);
    expect(parsed.applicationCategory).toBe('Documentation');
    expect(parsed.featureList).toEqual([
      'ping',
      'search_docs: Search the documentation.',
      'Prompt summarize',
    ]);
    expect(parsed.additionalProperty).toEqual(expect.arrayContaining([
      { '@type': 'PropertyValue', name: 'Tool inventory observed at', value: '2026-10-20T15:30:46.187Z' },
      { '@type': 'PropertyValue', name: 'Tools observed', value: 2 },
    ]));
  });

  it('states that a credentialed server inventory was not observed', () => {
    const { structuredData } = getCatalogServerSeo(server({ authType: 'oauth' }));
    expect(structuredData).not.toHaveProperty('featureList');
    expect(structuredData.additionalProperty).toContainEqual({
      '@type': 'PropertyValue', name: 'Tool inventory', value: 'Requires authorization; inventory not observed',
    });
  });
});
