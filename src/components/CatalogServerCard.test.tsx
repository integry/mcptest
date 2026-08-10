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
  it('keeps metadata neutral and presents only the test action as a button', () => {
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
    expect(metadataBadges.every((badge) => badge.classList.length === 2)).toBe(true);
    expect(container.querySelector('.catalog-status-badge--verified')?.textContent).toBe(
      'Browser ready'
    );
    expect(container.querySelector('.catalog-status-dot--online')).not.toBeNull();
    expect(container.querySelector('.catalog-refresh')).toBeNull();
    expect(reportLink?.classList.contains('btn')).toBe(false);
    expect(buttons).toHaveLength(1);
    expect(buttons[0]?.textContent).toContain('Test server');
  });
});
