import React from 'react';
import { renderToStaticMarkup } from 'react-dom/server';
import { MemoryRouter } from 'react-router-dom';
import { describe, expect, it, vi } from 'vitest';
import type { CatalogServer } from '../types/catalog';
import { CatalogServerCard } from './CatalogServerCard';

const server: CatalogServer = {
  id: 'example',
  name: 'Example server',
  url: 'https://example.com/mcp',
  description: 'A server used to verify the catalog card presentation.',
  category: 'Developer tools',
  tags: [],
  listingSource: {
    kind: 'publisher',
    url: 'https://example.com/docs/mcp',
  },
  declaredTransport: 'streamable-http',
  transport: 'streamable-http',
  requiresOAuth: false,
  declaredAuthType: 'none',
  authType: 'none',
  protocolEra: 'stateless',
  status: 'online',
  browserAccess: 'direct',
  logoUrl: '/server-logos/example.svg',
  logoSourceKind: 'generated-fallback',
  logoRetrievedAt: '2026-08-17',
};

describe('CatalogServerCard presentation', () => {
  it('styles metadata semantically and keeps testing secondary to card details', () => {
    const markup = renderToStaticMarkup(
      <MemoryRouter>
        <CatalogServerCard server={server} onTest={vi.fn()} onCategorySelect={vi.fn()} />
      </MemoryRouter>
    );
    const container = document.createElement('div');
    container.innerHTML = markup;

    const metadataBadges = Array.from(
      container.querySelectorAll<HTMLElement>('.catalog-metadata-badge')
    );
    const reportLink = container.querySelector<HTMLAnchorElement>('.catalog-report-link');
    const badges = container.querySelector<HTMLElement>('.catalog-server-badges');
    const buttons = container.querySelectorAll<HTMLButtonElement>('button');

    expect(metadataBadges.map((badge) => badge.textContent)).toEqual([
      'Developer tools',
      'No authentication',
      'HTTP',
      'Stateless MCP',
    ]);
    expect(metadataBadges[0]?.classList).toContain('catalog-metadata-badge--category');
    expect(metadataBadges[1]?.classList).toContain('catalog-metadata-badge--auth');
    expect(metadataBadges[2]?.classList).toContain('catalog-metadata-badge--transport');
    expect(metadataBadges[3]?.classList).toContain('catalog-metadata-badge--architecture');
    expect(container.querySelector('.catalog-status-badge--verified')?.textContent).toBe(
      'Browser ready'
    );
    expect(container.querySelector('.catalog-status-dot--online')).not.toBeNull();
    expect(container.querySelector('.catalog-refresh')).toBeNull();
    expect(container.querySelector('.catalog-server-footer')?.classList.contains('mt-auto')).toBe(
      true
    );
    expect(container.querySelector('.catalog-server-footer .catalog-server-badges')).not.toBeNull();
    expect(container.querySelector('.catalog-server-footer .catalog-card-actions')).not.toBeNull();
    expect(reportLink?.classList.contains('btn-primary')).toBe(true);
    expect(reportLink?.getAttribute('href')).toBe('/servers/example/');
    expect(badges?.tagName).toBe('DIV');
    expect(container.querySelector('.catalog-server-title')?.classList).not.toContain('stretched-link');
    expect(container.querySelector('.catalog-server-description')?.classList).not.toContain(
      'text-muted'
    );
    expect(container.querySelector('.catalog-listing-source')?.textContent).toContain('Publisher');
    expect(container.querySelector('.catalog-listing-source')?.textContent).not.toContain('Verified');
    expect(container.querySelector('.catalog-runtime-status')?.textContent).toContain('Online');
    expect(container.querySelector('a a, a button, button a')).toBeNull();
    expect(buttons).toHaveLength(2);
    expect(buttons[0]?.textContent).toContain('Developer tools');
    expect(buttons[0]?.getAttribute('aria-label')).toBe('Show Developer tools servers');
    expect(buttons[1]?.textContent).toContain('Test in Playground');
    expect(buttons[1]?.classList).toContain('btn-sm');
    expect(buttons[1]?.classList).toContain('btn-outline-primary');
  });

  it('keeps long endpoint URLs on a truncated line while preserving the full value', () => {
    const longUrl =
      'https://api.enterprise-production-environment.company.com/v1/mcp/tenant/example';
    const markup = renderToStaticMarkup(
      <MemoryRouter>
        <CatalogServerCard
          server={{ ...server, url: longUrl }}
          onTest={vi.fn()}
          onCategorySelect={vi.fn()}
        />
      </MemoryRouter>
    );
    const container = document.createElement('div');
    container.innerHTML = markup;
    const endpoint = container.querySelector<HTMLElement>('.catalog-server-url');

    expect(endpoint?.textContent).toBe('api.enterprise-production-environment.company.com');
    expect(endpoint?.title).toBe(longUrl);
    expect(endpoint?.classList).toContain('text-truncate');
  });

  it('shows accessible initials without a logo and keeps report access enabled offline', () => {
    const markup = renderToStaticMarkup(
      <MemoryRouter>
        <CatalogServerCard
          server={{
            ...server,
            name: 'Example Server',
            status: 'offline',
            listingSource: {
              kind: 'mcp-registry',
              url: 'https://registry.modelcontextprotocol.io/v0.1/servers/example',
            },
          }}
          onTest={vi.fn()}
          onCategorySelect={vi.fn()}
        />
      </MemoryRouter>
    );
    const container = document.createElement('div');
    container.innerHTML = markup;

    const initials = container.querySelector<HTMLElement>('.catalog-server-initials');
    const reportLink = container.querySelector<HTMLAnchorElement>('.catalog-report-link');
    const testButton = container.querySelector<HTMLButtonElement>('.catalog-test-button');

    expect(initials?.textContent).toBe('ES');
    expect(initials?.getAttribute('aria-label')).toBe('Example Server initials logo');
    expect(container.querySelector('.catalog-listing-source')?.textContent).toContain('MCP Registry');
    expect(reportLink?.getAttribute('aria-disabled')).toBeNull();
    expect(reportLink?.hasAttribute('disabled')).toBe(false);
    expect(testButton?.disabled).toBe(true);
  });
});
