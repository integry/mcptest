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
  declaredTransport: 'streamable-http',
  transport: 'streamable-http',
  requiresOAuth: false,
  declaredAuthType: 'none',
  authType: 'none',
  protocolEra: 'stateless',
  status: 'online',
  browserAccess: 'direct',
};

describe('CatalogServerCard presentation', () => {
  it('styles metadata semantically and keeps testing secondary to card details', () => {
    const markup = renderToStaticMarkup(
      <MemoryRouter>
        <CatalogServerCard server={server} onTest={vi.fn()} />
      </MemoryRouter>
    );
    const container = document.createElement('div');
    container.innerHTML = markup;

    const metadataBadges = Array.from(
      container.querySelectorAll<HTMLElement>('.catalog-metadata-badge')
    );
    const reportLink = container.querySelector<HTMLAnchorElement>('.catalog-report-link');
    const buttons = container.querySelectorAll<HTMLButtonElement>('button');

    expect(metadataBadges.map((badge) => badge.textContent)).toEqual([
      'Developer tools',
      'No authentication',
      'Stateless MCP',
      'HTTP',
    ]);
    expect(metadataBadges[0]?.classList).toContain('catalog-metadata-badge--category');
    expect(metadataBadges[1]?.classList).toContain('catalog-metadata-badge--auth');
    expect(metadataBadges[2]?.classList).toContain('catalog-metadata-badge--architecture');
    expect(metadataBadges[3]?.classList).toContain('catalog-metadata-badge--transport');
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
    expect(reportLink?.classList.contains('btn')).toBe(false);
    expect(container.querySelector('.catalog-server-title')?.classList).toContain('stretched-link');
    expect(container.querySelector('.catalog-server-description')?.classList).not.toContain(
      'text-muted'
    );
    expect(buttons).toHaveLength(1);
    expect(buttons[0]?.textContent).toContain('Test server');
    expect(buttons[0]?.classList).toContain('btn-sm');
    expect(buttons[0]?.classList).toContain('btn-outline-primary');
  });
});
