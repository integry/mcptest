import React, { act } from 'react';
import { createRoot, type Root } from 'react-dom/client';
import { MemoryRouter } from 'react-router-dom';
import { afterEach, beforeAll, beforeEach, describe, expect, it, vi } from 'vitest';
import type { ConnectionTab } from '../types';

const connectionMocks = vi.hoisted(() => ({ attempt: vi.fn() }));

vi.mock('../utils/transportDetection', async (importOriginal) => {
  const actual = await importOriginal<typeof import('../utils/transportDetection')>();
  return { ...actual, attemptParallelConnections: connectionMocks.attempt };
});

vi.mock('../context/AuthContext', () => ({
  useAuth: () => ({ currentUser: null, loading: false, loginWithGoogle: vi.fn() }),
}));

vi.mock('../utils/analytics', async (importOriginal) => ({
  ...await importOriginal<typeof import('../utils/analytics')>(),
  trackEvent: vi.fn(),
}));

import TabContent from './TabContent';
import { isLandingEligible } from '../utils/landingEligibility';
import { selectLandingQuickPicks } from './LandingHero';
import { getCatalogServers } from '../utils/catalogUtils';
import { getPreferredCatalogEndpoint } from '../utils/clientSetup';
import { TransportConnectionError } from '../utils/transportDetection';

beforeAll(() => {
  (
    globalThis as typeof globalThis & { IS_REACT_ACT_ENVIRONMENT: boolean }
  ).IS_REACT_ACT_ENVIRONMENT = true;
});

const newTab: ConnectionTab = {
  id: 'new-tab',
  title: 'New Connection',
  serverUrl: '',
  connectionStatus: 'Disconnected',
  useProxy: false,
};

let root: Root | undefined;

// Mirrors App: every tab mounts its own TabContent, with eligibility derived from all tabs.
const renderTabs = (tabs: ConnectionTab[], activeTabId: string) => {
  const container = document.createElement('div');
  const onUpdateTab = vi.fn();
  root = createRoot(container);
  act(() => root!.render(
    <MemoryRouter>
      {tabs.map(tab => (
        <div key={tab.id} data-tab-id={tab.id}>
          <TabContent
            tab={tab}
            isActive={tab.id === activeTabId}
            onUpdateTab={onUpdateTab}
            spaces={[]}
            onAddCardToSpace={vi.fn()}
            landingEligible={isLandingEligible(tabs, tab.id)}
          />
        </div>
      ))}
    </MemoryRouter>
  ));
  return { container, onUpdateTab };
};

const renderTab = (tab: ConnectionTab) => renderTabs([tab], tab.id);

const setInputValue = (input: HTMLInputElement, value: string) => {
  Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, 'value')?.set?.call(input, value);
  input.dispatchEvent(new Event('input', { bubbles: true }));
};

describe('playground landing', () => {
  beforeEach(() => {
    localStorage.clear();
    sessionStorage.clear();
    connectionMocks.attempt.mockReset();
    connectionMocks.attempt.mockRejectedValue(new TransportConnectionError([
      new TypeError('Failed to fetch'),
    ]));
  });

  afterEach(() => {
    act(() => root?.unmount());
    root = undefined;
  });

  it('renders the landing when there are no tabs with servers and no recent connections', () => {
    const { container } = renderTab(newTab);

    expect(container.querySelector('.landing')).not.toBeNull();
    expect(container.querySelector('.connection-console')).toBeNull();
    expect(container.querySelector('.playground-layout')).toBeNull();
    expect(container.querySelector('.suggested-servers-panel')).toBeNull();
  });

  it('keeps the landing while a first-time visitor types a URL', () => {
    const { container } = renderTab(newTab);

    act(() => setInputValue(container.querySelector<HTMLInputElement>('#serverUrl')!, 'https://example.com/mcp'));

    expect(container.querySelector('.landing')).not.toBeNull();
    expect(container.querySelector<HTMLInputElement>('#serverUrl')?.value).toBe('https://example.com/mcp');
  });

  it('renders the landing for returning users with their recent servers as chips', () => {
    localStorage.setItem('mcpRecentServers', JSON.stringify([
      'https://returning.example/mcp',
      'https://second.example:8443/sse',
    ]));
    const { container } = renderTab(newTab);

    expect(container.querySelector('.landing.landing--returning')).not.toBeNull();
    expect(container.querySelector('.connection-console')).toBeNull();
    expect(container.querySelector('.playground-layout')).toBeNull();
    expect(container.querySelector('.awaiting-connection-panel')).toBeNull();
    expect(container.querySelector('.suggested-servers-panel')).toBeNull();
    // Recent servers replace the catalog quick picks; the audience rows and coverage stay.
    expect(container.querySelector('[data-server-id]')).toBeNull();
    const chips = Array.from(container.querySelectorAll<HTMLButtonElement>('.landing-recent-connect'));
    expect(chips.map(chip => chip.textContent?.trim())).toEqual(['returning.example', 'second.example:8443']);
    expect(chips.map(chip => chip.title)).toEqual(['https://returning.example/mcp', 'https://second.example:8443/sse']);
    expect(container.querySelectorAll('.landing-path')).toHaveLength(3);
    expect(container.querySelector('.landing-coverage')).not.toBeNull();
    expect(container.querySelector<HTMLButtonElement>('.landing-advanced-toggle')?.getAttribute('aria-expanded')).toBe('false');
  });

  it('reconnects a recent server chip through the connection path and removes chips in place', async () => {
    localStorage.setItem('mcpRecentServers', JSON.stringify([
      'https://returning.example/mcp',
      'https://second.example/mcp',
    ]));
    const { container } = renderTab(newTab);

    await act(async () => {
      container.querySelector('[aria-label="Remove https://second.example/mcp from recent connections"]')
        ?.dispatchEvent(new MouseEvent('click', { bubbles: true }));
    });
    expect(Array.from(container.querySelectorAll('.landing-recent-connect'), chip => chip.getAttribute('data-recent-url')))
      .toEqual(['https://returning.example/mcp']);
    const stored: Array<string | { url: string }> = JSON.parse(localStorage.getItem('mcpRecentServers') ?? '[]');
    expect(stored.map(entry => (typeof entry === 'string' ? entry : entry.url))).toEqual(['https://returning.example/mcp']);
    expect(container.querySelector('.landing')).not.toBeNull();

    await act(async () => {
      container.querySelector('[data-recent-url="https://returning.example/mcp"]')
        ?.dispatchEvent(new MouseEvent('click', { bubbles: true }));
    });
    expect(connectionMocks.attempt).toHaveBeenCalledOnce();
    expect(connectionMocks.attempt.mock.calls[0][0]).toBe('https://returning.example/mcp');
    expect(container.querySelector('.landing')).toBeNull();
    expect(container.querySelector('.connection-console')).not.toBeNull();
    expect(container.querySelector<HTMLInputElement>('#serverUrl')?.value).toBe('https://returning.example/mcp');
  });

  it('opens the full connection panel in place from Advanced options without leaving the landing', () => {
    localStorage.setItem('mcpRecentServers', JSON.stringify(['https://returning.example/mcp']));
    const { container } = renderTab(newTab);
    const toggle = container.querySelector<HTMLButtonElement>('.landing-advanced-toggle')!;

    act(() => toggle.dispatchEvent(new MouseEvent('click', { bubbles: true })));

    expect(toggle.getAttribute('aria-expanded')).toBe('true');
    expect(container.querySelector('.landing .landing-advanced .connection-console')).not.toBeNull();
    expect(container.querySelector('.landing .connection-advanced')).not.toBeNull();
    expect(container.querySelector('.landing-connect')).toBeNull();
    expect(container.querySelectorAll('#serverUrl')).toHaveLength(1);
    expect(container.querySelector('.landing-paths')).not.toBeNull();

    act(() => setInputValue(container.querySelector<HTMLInputElement>('#serverUrl')!, 'https://typed.example/mcp'));
    act(() => toggle.dispatchEvent(new MouseEvent('click', { bubbles: true })));

    expect(toggle.getAttribute('aria-expanded')).toBe('false');
    expect(container.querySelector('.connection-console')).toBeNull();
    expect(container.querySelector<HTMLInputElement>('.landing-connect #serverUrl')?.value).toBe('https://typed.example/mcp');
  });

  it('renders the playground unchanged for a tab that already has a server', () => {
    const { container } = renderTab({ ...newTab, id: 'existing', serverUrl: 'https://existing.example/mcp' });

    expect(container.querySelector('.landing')).toBeNull();
    expect(container.querySelector('.connection-console')).not.toBeNull();
    expect(container.querySelector<HTMLInputElement>('#serverUrl')?.value).toBe('https://existing.example/mcp');
  });

  it('renders the playground unchanged for an empty tab restored beside a server-configured tab', () => {
    const serverTab: ConnectionTab = { ...newTab, id: 'existing', serverUrl: 'https://existing.example/mcp' };
    const { container } = renderTabs([serverTab, newTab], newTab.id);
    const emptyPanel = container.querySelector('[data-tab-id="new-tab"]')!;

    expect(container.querySelector('.landing')).toBeNull();
    expect(emptyPanel.querySelector('.connection-console')).not.toBeNull();
    expect(emptyPanel.querySelector('.playground-layout.playground-idle')).not.toBeNull();
    expect(emptyPanel.querySelector('.suggested-servers-panel')).not.toBeNull();
  });

  it('keeps the landing for a new empty tab beside another empty tab', () => {
    const { container } = renderTabs([{ ...newTab, id: 'first' }, newTab], newTab.id);

    expect(container.querySelector('[data-tab-id="new-tab"] .landing')).not.toBeNull();
  });

  it('connects quick picks and manual entry through the same connection path', async () => {
    const [pick] = selectLandingQuickPicks(getCatalogServers());
    const endpoint = getPreferredCatalogEndpoint(pick);

    const manual = renderTab(newTab);
    act(() => setInputValue(manual.container.querySelector<HTMLInputElement>('#serverUrl')!, endpoint.url));
    await act(async () => {
      manual.container.querySelector('#connectBtn')?.dispatchEvent(
        new MouseEvent('click', { bubbles: true })
      );
    });
    expect(connectionMocks.attempt).toHaveBeenCalledOnce();
    const manualCall = connectionMocks.attempt.mock.calls[0];
    expect(manualCall[0]).toBe(endpoint.url);
    expect(manual.container.querySelector('.landing')).toBeNull();
    act(() => root?.unmount());

    localStorage.clear();
    connectionMocks.attempt.mockClear();
    const quick = renderTab(newTab);
    await act(async () => {
      quick.container.querySelector(`[data-server-id="${pick.id}"]`)?.dispatchEvent(
        new MouseEvent('click', { bubbles: true })
      );
    });
    expect(connectionMocks.attempt).toHaveBeenCalledOnce();
    expect(connectionMocks.attempt.mock.calls[0][0]).toBe(manualCall[0]);
    expect(quick.onUpdateTab).toHaveBeenCalledWith('new-tab', expect.objectContaining({
      serverUrl: endpoint.url,
    }));
    expect(quick.container.querySelector('.landing')).toBeNull();
    expect(quick.container.querySelector<HTMLInputElement>('#serverUrl')?.value).toBe(endpoint.url);
  });
});
