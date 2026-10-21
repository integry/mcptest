import React, { act } from 'react';
import { createRoot, type Root } from 'react-dom/client';
import { MemoryRouter } from 'react-router-dom';
import { afterEach, beforeAll, describe, expect, it, vi } from 'vitest';

import { getCatalogServers } from '../utils/catalogUtils';
import type { CatalogServer } from '../types/catalog';
import { LandingHero, getRecentServerLabel, selectLandingQuickPicks } from './LandingHero';

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

describe('landing hero for returning users', () => {
  const recentServers = ['https://mcp.example.com/mcp', 'http://localhost:3001/sse', 'not a url'];

  it('labels recent chips by host and keeps the full URL as the tooltip', () => {
    expect(getRecentServerLabel('https://mcp.example.com/mcp')).toBe('mcp.example.com');
    expect(getRecentServerLabel('http://localhost:3001/sse')).toBe('localhost:3001');
    expect(getRecentServerLabel('mcp.example.com/mcp')).toBe('mcp.example.com');
    expect(getRecentServerLabel('not a url')).toBe('not a url');
  });

  it('replaces the quick picks with recent chips that connect and remove through their callbacks', () => {
    const onConnectRecent = vi.fn();
    const onRemoveRecentServer = vi.fn();
    const { container, onConnect } = renderLanding({ recentServers, onConnectRecent, onRemoveRecentServer });

    expect(container.querySelector('[data-server-id]')).toBeNull();
    expect(container.querySelector('#landing-recent-label')?.textContent).toBe('Recent');
    const chips = container.querySelectorAll<HTMLButtonElement>('.landing-recent-connect');
    expect(Array.from(chips, chip => chip.textContent?.trim())).toEqual(['mcp.example.com', 'localhost:3001', 'not a url']);
    expect(chips[0].title).toBe('https://mcp.example.com/mcp');

    act(() => chips[1].dispatchEvent(new MouseEvent('click', { bubbles: true })));
    expect(onConnectRecent).toHaveBeenCalledWith('http://localhost:3001/sse');
    expect(onConnect).not.toHaveBeenCalled();

    const remove = container.querySelector<HTMLButtonElement>(
      '[aria-label="Remove https://mcp.example.com/mcp from recent connections"]'
    );
    act(() => remove?.dispatchEvent(new MouseEvent('click', { bubbles: true })));
    expect(onRemoveRecentServer).toHaveBeenCalledWith('https://mcp.example.com/mcp');

    // The audience rows and coverage strip stay for returning users.
    expect(container.querySelectorAll('.landing-path')).toHaveLength(3);
    expect(container.querySelector('.landing-coverage')).not.toBeNull();
  });

  it('keeps the quick picks when there is no recent-connect handler and caps recent chips at six', () => {
    const noHandler = renderLanding({ recentServers });
    expect(noHandler.container.querySelector('.landing-recent-connect')).toBeNull();
    expect(noHandler.container.querySelectorAll('[data-server-id]')).toHaveLength(3);
    act(() => root?.unmount());

    const many = Array.from({ length: 9 }, (_, index) => `https://server-${index}.example/mcp`);
    const capped = renderLanding({ recentServers: many, onConnectRecent: vi.fn() });
    expect(capped.container.querySelectorAll('.landing-recent-connect')).toHaveLength(6);
  });

  it('swaps the connect row for the advanced options panel in place', () => {
    const { container } = renderLanding({
      serverUrl: 'https://example.com/mcp',
      advancedOptions: <div className="connection-console" data-testid="advanced">panel</div>,
    });
    const toggle = container.querySelector<HTMLButtonElement>('.landing-advanced-toggle')!;

    expect(toggle.getAttribute('aria-expanded')).toBe('false');
    expect(toggle.textContent).toContain('Advanced options');
    expect(container.querySelector('[data-testid="advanced"]')).toBeNull();

    act(() => toggle.dispatchEvent(new MouseEvent('click', { bubbles: true })));

    expect(toggle.getAttribute('aria-expanded')).toBe('true');
    expect(toggle.getAttribute('aria-controls')).toBe('landing-advanced-panel');
    expect(container.querySelector('#landing-advanced-panel [data-testid="advanced"]')).not.toBeNull();
    expect(container.querySelector('.landing-connect')).toBeNull();
    expect(container.querySelector('#landing-title')).not.toBeNull();
    expect(container.querySelector('.landing-paths')).not.toBeNull();
  });

  it('offers no advanced toggle without a panel to show', () => {
    const { container } = renderLanding();
    expect(container.querySelector('.landing-advanced-toggle')).toBeNull();
  });
});
