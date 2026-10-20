import { describe, expect, it } from 'vitest';
import type { ConnectionTab } from '../types';
import { isLandingEligible } from './landingEligibility';

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
