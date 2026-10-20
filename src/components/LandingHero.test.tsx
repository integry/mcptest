import React, { act } from 'react';
import { createRoot, type Root } from 'react-dom/client';
import { MemoryRouter } from 'react-router-dom';
import { afterEach, beforeAll, describe, expect, it, vi } from 'vitest';

import { getCatalogServers } from '../utils/catalogUtils';
import type { CatalogServer } from '../types/catalog';
import { LandingHero, selectLandingQuickPicks } from './LandingHero';

beforeAll(() => {
  (
    globalThis as typeof globalThis & { IS_REACT_ACT_ENVIRONMENT: boolean }
  ).IS_REACT_ACT_ENVIRONMENT = true;
});

let root: Root | undefined;

afterEach(() => {
  act(() => root?.unmount());
  root = undefined;
});

const renderLanding = (props: Partial<React.ComponentProps<typeof LandingHero>> = {}) => {
  const container = document.createElement('div');
  const onConnect = vi.fn();
  const onServerUrlChange = vi.fn();
  root = createRoot(container);
  act(() => root!.render(
    <MemoryRouter>
      <LandingHero
        serverUrl=""
        onServerUrlChange={onServerUrlChange}
        onConnect={onConnect}
        isConnecting={false}
        {...props}
      />
    </MemoryRouter>
  ));
  return { container, onConnect, onServerUrlChange };
};

const isPublicNoAuth = (server: CatalogServer) => (
  server.status !== 'offline'
  && server.authType === 'none'
  && !server.requiresOAuth
  && server.browserAccess === 'direct'
  && Boolean(server.browserUrl)
  && Boolean(server.logoUrl)
  && server.logoSourceKind !== 'generated-fallback'
);

describe('landing quick picks', () => {
  it('only offers three public, no-auth catalog servers with real logos', () => {
    const picks = selectLandingQuickPicks(getCatalogServers());

    expect(picks).toHaveLength(3);
    picks.forEach((server) => {
      expect(isPublicNoAuth(server), server.id).toBe(true);
    });
  });

  it('excludes offline, credentialed, proxy-only and logo-less servers', () => {
    const base = getCatalogServers().find(isPublicNoAuth)!;
    const candidates: CatalogServer[] = [
      { ...base, id: 'offline', status: 'offline' },
      { ...base, id: 'oauth', authType: 'oauth', requiresOAuth: true },
      { ...base, id: 'api-key', authType: 'api-key' },
      { ...base, id: 'required-header', requiredHeaders: [{ name: 'x-api-key', required: true }] },
      { ...base, id: 'proxy', browserAccess: 'proxy-required' },
      { ...base, id: 'no-browser-url', browserUrl: undefined },
      { ...base, id: 'fallback-logo', logoSourceKind: 'generated-fallback' },
      { ...base, id: 'eligible-unsuggested', tags: [] },
      { ...base, id: 'eligible-suggested', tags: ['suggested'] },
    ];

    expect(selectLandingQuickPicks(candidates).map(({ id }) => id)).toEqual([
      'eligible-suggested',
      'eligible-unsuggested',
    ]);
  });
});

describe('landing hero', () => {
  it('explains the tool, links each audience path and the live catalog count', () => {
    const { container } = renderLanding();

    expect(container.querySelector('h1')?.textContent).toBe(
      'Inspect, debug and evaluate remote MCP servers in your browser'
    );
    expect(container.querySelector<HTMLInputElement>('#serverUrl')).not.toBeNull();

    const paths = Array.from(container.querySelectorAll('.landing-path'), (link) => [
      link.querySelector('.landing-path-title')?.textContent,
      link.getAttribute('href'),
    ]);
    expect(paths).toEqual([
      ['New to MCP', '/docs/what-is-mcp'],
      ['Connecting a server to Claude, ChatGPT or Cursor', '/learn/connect-remote-mcp-server'],
      ['Building a server', '/docs/testing-guide'],
    ]);

    const coverage = container.querySelector('.landing-coverage')?.textContent || '';
    ['2026 stateless', '2025 stateful', 'legacy HTTP+SSE', 'OAuth 2.1 with PKCE', 'CORS evidence from a real browser',
      'Tool, resource and prompt contracts', 'Shareable reports'].forEach((item) => {
      expect(coverage).toContain(item);
    });

    const catalogLink = container.querySelector<HTMLAnchorElement>('.landing-catalog a');
    expect(catalogLink?.getAttribute('href')).toBe('/catalog');
    expect(catalogLink?.textContent).toContain(`Browse ${getCatalogServers().length} public remote MCP servers`);
  });

  it('connects the entered URL without a selection on click or Enter, like the connection panel', () => {
    const { container, onConnect } = renderLanding({ serverUrl: 'https://example.com/mcp' });

    act(() => container.querySelector('#connectBtn')?.dispatchEvent(new MouseEvent('click', { bubbles: true })));
    act(() => container.querySelector('#serverUrl')?.dispatchEvent(
      new KeyboardEvent('keydown', { key: 'Enter', bubbles: true })
    ));

    expect(onConnect).toHaveBeenCalledTimes(2);
    expect(onConnect.mock.calls).toEqual([[], []]);
  });

  it('does not connect an empty URL', () => {
    const { container, onConnect } = renderLanding();

    expect(container.querySelector<HTMLButtonElement>('#connectBtn')?.disabled).toBe(true);
    act(() => container.querySelector('#serverUrl')?.dispatchEvent(
      new KeyboardEvent('keydown', { key: 'Enter', bubbles: true })
    ));
    expect(onConnect).not.toHaveBeenCalled();
  });

  it('connects a quick pick through the same connect callback with its catalog endpoint', () => {
    const { container, onConnect } = renderLanding();
    const [firstPick] = selectLandingQuickPicks(getCatalogServers());
    const button = container.querySelector<HTMLButtonElement>(`[data-server-id="${firstPick.id}"]`);

    act(() => button?.dispatchEvent(new MouseEvent('click', { bubbles: true })));

    expect(onConnect).toHaveBeenCalledOnce();
    expect(onConnect.mock.calls[0][0]).toMatchObject({
      endpoint: { url: firstPick.browserUrl },
      protocolEra: firstPick.protocolEra,
    });
  });
});
