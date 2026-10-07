import React from 'react';
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
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
  checkedAt: '2026-08-17T12:00:00Z',
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
    const listingSourceIcon = container.querySelector<SVGElement>(
      '.catalog-listing-source-icon'
    );
    const catalogCss = readFileSync(resolve('src/index.css'), 'utf8');
    const listingSourceIconRule =
      catalogCss.match(/\.catalog-listing-source-icon\s*\{([^}]*)\}/)?.[1] ?? '';
    const onlineStatusRule =
      catalogCss.match(/\.catalog-runtime-status--online\s*\{([^}]*)\}/)?.[1] ?? '';
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
    expect(container.querySelector('.catalog-runtime-status--online')).not.toBeNull();
    expect(container.querySelector('.catalog-refresh')).toBeNull();
    expect(container.querySelector('.catalog-server-footer')?.classList.contains('mt-auto')).toBe(
      true
    );
    expect(container.querySelector('.catalog-server-footer .catalog-server-badges')).not.toBeNull();
    expect(container.querySelector('.catalog-server-footer .catalog-card-actions')).not.toBeNull();
    expect(reportLink?.classList.contains('btn')).toBe(false);
    expect(reportLink?.getAttribute('href')).toBe('/servers/example/');
    expect(badges?.tagName).toBe('DIV');
    expect(container.querySelector('.catalog-server-title')?.classList).not.toContain('stretched-link');
    expect(container.querySelector('.catalog-server-description')?.classList).not.toContain(
      'text-muted'
    );
    expect(container.querySelector('.catalog-listing-source')?.textContent).toContain('Publisher');
    expect(container.querySelector('.catalog-listing-source')?.textContent).not.toContain('Verified');
    expect(listingSourceIcon?.getAttribute('stroke-width')).toBe('1.5');
    expect(listingSourceIconRule).toMatch(/stroke-width:\s*1\.5;/);
    expect(onlineStatusRule).toMatch(/color:\s*var\(--success-color\);/);
    expect(container.querySelector('.catalog-runtime-status')?.textContent).toBe(
      'Online'
    );
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
    const catalogCss = readFileSync(resolve('src/index.css'), 'utf8');
    const endpointRule =
      catalogCss.match(/\.catalog-server-url\s*\{([^}]*)\}/)?.[1] ?? '';

    expect(endpoint?.textContent).toBe('api.enterprise-production-environment.company.com');
    expect(endpoint?.title).toBe(longUrl);
    expect(endpoint?.classList).toContain('text-truncate');
    expect(endpoint?.classList).not.toContain('text-muted');
    expect(endpointRule).toMatch(/color:\s*var\(--catalog-secondary-text\);/);
  });

  it('keeps a long title and runtime status within card bounds at 1024px', () => {
    const longName = 'ExampleEnterpriseProductionEnvironmentServer';
    const markup = renderToStaticMarkup(
      <MemoryRouter>
        <CatalogServerCard
          server={{ ...server, name: longName }}
          onTest={vi.fn()}
          onCategorySelect={vi.fn()}
        />
      </MemoryRouter>
    );
    const container = document.createElement('div');
    container.innerHTML = markup;

    const title = container.querySelector<HTMLElement>('.catalog-server-title');
    const runtimeStatus = container.querySelector<HTMLElement>('.catalog-runtime-status');
    const catalogCss = readFileSync(resolve('src/index.css'), 'utf8');
    const titleRule = catalogCss.match(/\.catalog-server-title\s*\{([^}]*)\}/)?.[1] ?? '';
    const statusRule = catalogCss.match(/\.catalog-runtime-status\s*\{([^}]*)\}/)?.[1] ?? '';
    const constrainedDesktopRule = catalogCss.match(
      /@media \(min-width: (\d+)px\) and \(max-width: ([\d.]+)px\) \{\s*\.catalog-server-title-row\s*\{([^}]*)\}\s*\.catalog-server-name-source,\s*\.catalog-runtime-status\s*\{([^}]*)\}/
    );
    const viewportWidth = 1024;

    expect(title?.textContent).toBe(longName);
    expect(titleRule).toMatch(/overflow-wrap:\s*anywhere;/);
    expect(runtimeStatus?.classList).not.toContain('flex-shrink-0');
    expect(statusRule).toMatch(/min-width:\s*0;/);
    expect(statusRule).toMatch(/max-width:\s*100%;/);
    expect(constrainedDesktopRule?.[3]).toMatch(/flex-wrap:\s*wrap;/);
    expect(constrainedDesktopRule?.[4]).toMatch(/flex-basis:\s*100%;/);
    expect(viewportWidth).toBeGreaterThanOrEqual(Number(constrainedDesktopRule?.[1]));
    expect(viewportWidth).toBeLessThanOrEqual(Number(constrainedDesktopRule?.[2]));
  });

  it('shows initials without a logo and keeps report access enabled offline', () => {
    const markup = renderToStaticMarkup(
      <MemoryRouter>
        <CatalogServerCard
          server={{
            ...server,
            name: 'Example Server',
            status: 'offline',
            logoUrl: '',
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

    const logo = container.querySelector<HTMLElement>('[data-catalog-server-logo]');
    const initials = logo?.querySelector<HTMLElement>('.catalog-server-logo-initials');
    const reportLink = container.querySelector<HTMLAnchorElement>('.catalog-report-link');
    const testButton = container.querySelector<HTMLButtonElement>('.catalog-test-button');

    expect(initials?.textContent).toBe('ES');
    expect(logo?.getAttribute('aria-hidden')).toBe('true');
    expect(logo?.querySelector('img')).toBeNull();
    expect(container.querySelector('.catalog-listing-source')?.textContent).toContain('MCP Registry');
    expect(reportLink?.getAttribute('aria-disabled')).toBeNull();
    expect(reportLink?.hasAttribute('disabled')).toBe(false);
    expect(testButton?.disabled).toBe(true);
  });

  it('qualifies recorded status and distinguishes inconclusive validation from pending', () => {
    const statuses = [
      {
        server: { ...server, status: 'offline' as const, checkedAt: '2026-08-17T12:00:00Z' },
        label: 'Offline when last tested',
      },
      {
        server: { ...server, status: 'unknown' as const, checkedAt: '2026-08-17T12:00:00Z' },
        label: 'Inconclusive when last tested',
      },
      {
        server: { ...server, status: 'unknown' as const, checkedAt: undefined },
        label: 'Validation pending',
      },
    ];

    statuses.forEach(({ server: statusServer, label }) => {
      const markup = renderToStaticMarkup(
        <MemoryRouter>
          <CatalogServerCard server={statusServer} onTest={vi.fn()} />
        </MemoryRouter>
      );
      const container = document.createElement('div');
      container.innerHTML = markup;

      expect(container.querySelector('.catalog-runtime-status')?.textContent).toBe(label);
    });
  });
});
