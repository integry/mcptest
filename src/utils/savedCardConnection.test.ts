import { describe, expect, it } from 'vitest';
import { getSavedCardConnectionPlan } from './savedCardConnection';

describe('saved dashboard card connections', () => {
  it('preserves an exact custom endpoint for direct OAuth connections', () => {
    expect(getSavedCardConnectionPlan({
      serverUrl: 'https://mcp.example/custom/endpoint',
      useProxy: false,
      oauthToken: 'target-token',
      proxyUrl: 'https://proxy.mcptest.test/',
    })).toEqual({
      connectionUrl: 'https://mcp.example/custom/endpoint',
      authToken: 'target-token',
      usesProxy: false,
    });
  });

  it('separates proxy authentication from target OAuth authentication', () => {
    const plan = getSavedCardConnectionPlan({
      serverUrl: 'https://mcp.example/custom/endpoint?tenant=acme',
      useProxy: true,
      oauthToken: 'target-token',
      proxyUrl: 'https://proxy.mcptest.test/gateway?region=eu',
      proxyAuthToken: 'firebase-token',
    });

    expect(new URL(plan.connectionUrl).searchParams.get('target')).toBe(
      'https://mcp.example/custom/endpoint?tenant=acme'
    );
    expect(new URL(plan.connectionUrl).searchParams.get('region')).toBe('eu');
    expect(plan.authToken).toBe('firebase-token');
    expect(new Headers(plan.targetHeaders).get('authorization')).toBe('Bearer target-token');
    expect(plan.usesProxy).toBe(true);
  });

  it('keeps proxy-by-default behavior for legacy saved cards', () => {
    const plan = getSavedCardConnectionPlan({
      serverUrl: 'https://mcp.example/mcp',
      proxyUrl: 'https://proxy.mcptest.test/',
      proxyAuthToken: 'firebase-token',
    });

    expect(plan.usesProxy).toBe(true);
  });

  it('requires authentication only when the saved card selects the proxy', () => {
    expect(() => getSavedCardConnectionPlan({
      serverUrl: 'https://mcp.example/mcp',
      useProxy: true,
      proxyUrl: 'https://proxy.mcptest.test/',
    })).toThrow('Sign in is required');
  });
});
