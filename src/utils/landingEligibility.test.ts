import { afterEach, describe, expect, it } from 'vitest';
import type { ConnectionTab } from '../types';
import { isLandingEligible, isReturningWorkspace, needsTabStrip } from './landingEligibility';

const tab = (id: string, updates: Partial<ConnectionTab> = {}): ConnectionTab => ({
  id,
  title: 'New Connection',
  serverUrl: '',
  connectionStatus: 'Disconnected',
  ...updates,
});

describe('isLandingEligible', () => {
  it('allows the landing when no tab has a server', () => {
    expect(isLandingEligible([tab('a'), tab('b')], 'b')).toBe(true);
  });

  it('ignores the tab itself so typing does not dismiss its landing', () => {
    expect(isLandingEligible([tab('a', { serverUrl: 'https://typed.example/mcp' })], 'a')).toBe(true);
  });

  it.each([
    ['a server URL', { serverUrl: 'https://existing.example/mcp' }],
    ['a pending auto-connect', { autoConnect: true }],
    ['shared result data', { resultShareData: {} as ConnectionTab['resultShareData'] }],
    ['a live connection', { connectionStatus: 'Connected' as const }],
  ])('rejects the landing when a sibling tab has %s', (_label, updates) => {
    expect(isLandingEligible([tab('a', updates), tab('b')], 'b')).toBe(false);
  });
});

describe('playground tab strip', () => {
  afterEach(() => localStorage.clear());

  it('is deferred for a single empty tab, even while a URL is typed', () => {
    expect(needsTabStrip([tab('a')])).toBe(false);
    expect(needsTabStrip([tab('a', { serverUrl: 'https://typed.example/mcp' })])).toBe(false);
  });

  it.each([
    ['a connection starting', [tab('a', { connectionStatus: 'Connecting' })]],
    ['a live connection', [tab('a', { connectionStatus: 'Connected' })]],
    ['a pending auto-connect', [tab('a', { autoConnect: true })]],
    ['a second tab', [tab('a'), tab('b')]],
  ])('appears for %s', (_label, tabs) => {
    expect(needsTabStrip(tabs)).toBe(true);
  });

  it('treats saved servers or stored recent endpoints as a returning workspace, as theme-init does', () => {
    expect(isReturningWorkspace([tab('a')])).toBe(false);
    expect(isReturningWorkspace([tab('a', { serverUrl: 'https://saved.example/mcp' })])).toBe(true);
    localStorage.setItem('mcpRecentServers', JSON.stringify([{ url: 'https://recent.example/mcp' }]));
    expect(isReturningWorkspace([tab('a')])).toBe(true);
    localStorage.setItem('mcpRecentServers', '{corrupt');
    expect(isReturningWorkspace([tab('a')])).toBe(false);
  });
});
