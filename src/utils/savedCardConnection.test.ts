import { describe, expect, it } from 'vitest';
import {
  getSavedCardConnectionPlan,
  getSavedResourceUri,
} from './savedCardConnection';

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

  it('expands a parameterized saved resource card into a resources/read URI', () => {
    const uri = getSavedResourceUri(
      'mcp://documents/{tenant}/{documentId}{?format,locale}',
      {
        tenant: 'Acme Corp',
        documentId: 'policies/2026',
        format: 'application/json',
        locale: 'en-US',
      }
    );

    expect(uri).toBe(
      'mcp://documents/Acme%20Corp/policies%2F2026?format=application%2Fjson&locale=en-US'
    );
  });

  it('keeps legacy cards whose saved URI was already expanded', () => {
    expect(getSavedResourceUri(
      'mcp://documents/policies/2026',
      { tenant: 'Acme Corp' }
    )).toBe('mcp://documents/policies/2026');
  });

  it('surfaces a migration error for parameters absent from a saved URI template', () => {
    expect(() => getSavedResourceUri(
      'mcp://documents/{documentId}',
      { documentId: 'policies/2026', tenant: 'Acme Corp' }
    )).toThrow(/saved resource card migration required.*"tenant".*not present/i);
  });

  it('uses the SDK URI-template implementation for list values', () => {
    expect(getSavedResourceUri(
      'mcp://search{?tags}',
      { tags: ['stateful', 'stateless'] }
    )).toBe('mcp://search?tags=stateful,stateless');
  });
});
