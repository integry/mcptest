import { describe, expect, it } from 'vitest';
import { getRequestHeadersForCandidate, getTransportCandidates } from './transportDetection';

describe('transport candidate generation', () => {
  it('does not append paths to a custom publisher endpoint', () => {
    const candidates = getTransportCandidates('https://mcp.atlassian.com/v1/mcp/authv2');

    expect(candidates.map(({ url }) => url)).toEqual([
      'https://mcp.atlassian.com/v1/mcp/authv2',
      'https://mcp.atlassian.com/v1/mcp/authv2/',
      'https://mcp.atlassian.com/v1/mcp/authv2',
      'https://mcp.atlassian.com/v1/mcp/authv2/',
    ]);
    expect(candidates.some(({ url }) => url.includes('authv2/mcp'))).toBe(false);
  });

  it('preserves exact root endpoints and conventional transport paths', () => {
    const candidates = getTransportCandidates('https://mcp.deepwiki.com');

    expect(candidates).toContainEqual({
      url: 'https://mcp.deepwiki.com/',
      transportType: 'streamable-http',
    });
    expect(candidates).toContainEqual({
      url: 'https://mcp.deepwiki.com/mcp',
      transportType: 'streamable-http',
    });
    expect(candidates).toContainEqual({
      url: 'https://mcp.deepwiki.com/sse',
      transportType: 'legacy-sse',
    });
  });

  it('varies the target rather than the proxy endpoint', () => {
    const candidates = getTransportCandidates(
      'https://proxy.mcptest.io/?target=https%3A%2F%2Fexample.com%2Fcustom%2Fendpoint'
    );

    expect(candidates).toHaveLength(4);
    expect(candidates.every(({ url }) => url.startsWith('https://proxy.mcptest.io/'))).toBe(true);
    expect(candidates.every(({ url }) => (
      new URL(url).searchParams.get('target')?.startsWith('https://example.com/custom/endpoint')
    ))).toBe(true);
  });

  it('prefers a declared terminal SSE endpoint before its HTTP sibling', () => {
    expect(getTransportCandidates('https://example.com/sse')[0]).toEqual({
      url: 'https://example.com/sse',
      transportType: 'legacy-sse',
    });
  });

  it('keeps target Authorization separate from proxy authentication', () => {
    const proxyHeaders = getRequestHeadersForCandidate(
      'https://proxy.mcptest.io/?target=https%3A%2F%2Fexample.com%2Fmcp',
      { Authorization: 'Bearer target-secret', 'x-api-key': 'api-secret' }
    );
    const directHeaders = getRequestHeadersForCandidate(
      'https://example.com/mcp',
      { Authorization: 'Bearer target-secret' }
    );

    expect(proxyHeaders.get('authorization')).toBeNull();
    expect(proxyHeaders.get('x-mcp-authorization')).toBe('Bearer target-secret');
    expect(proxyHeaders.get('x-api-key')).toBe('api-secret');
    expect(directHeaders.get('authorization')).toBe('Bearer target-secret');
  });
});
