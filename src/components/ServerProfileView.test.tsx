import React from 'react';
import { renderToStaticMarkup } from 'react-dom/server';
import { MemoryRouter } from 'react-router-dom';
import { describe, expect, it, vi } from 'vitest';
import ServerProfileView from './ServerProfileView';
import { createCapabilityInventory } from '../utils/capabilityInventory';
import type { CatalogServer } from '../types/catalog';

describe('ServerProfileView capability inventory', () => {
  it('renders the catalog snapshot with semantic provider headings', () => {
    const server: CatalogServer = {
      id: 'example', name: 'Example', url: 'https://example.com/mcp', description: 'Example server',
      category: 'Testing', tags: [], declaredTransport: 'streamable-http', transport: 'streamable-http',
      listingSource: { kind: 'community' },
      requiresOAuth: false, declaredAuthType: 'none', authType: 'none', protocolEra: 'stateless', status: 'online',
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

    expect(markup).toContain('Capabilities provided');
    expect(markup).toContain('Tools provided by Example');
    expect(markup).toContain('find_items');
    expect(markup).toContain('Aug 18, 2026 at 12:32 AM');
    expect(markup).not.toContain('12:32:48');
    expect(markup).toContain('server-spec-list server-connection-specs');
    expect(markup).toContain('technical-string technical-string-url');
    expect(markup).toContain('technical-string technical-string-url technical-string-inline');
    expect(markup).toContain('technical-string technical-string-inline');
    expect(markup.match(/server-profile-action"/g)).toHaveLength(2);
    expect(markup).toContain('server-profile-breadcrumb-parent');
    expect(markup).toContain('server-profile-breadcrumb-current');
    expect(markup).toContain('btn btn-sm btn-ghost server-endpoint-copy');
    expect(markup).not.toContain('btn btn-sm btn-outline-secondary');
    expect(markup).not.toContain('rounded-pill');
    expect(markup).not.toContain('dangerouslySetInnerHTML');
  });
});
