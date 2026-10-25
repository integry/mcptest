import { describe, expect, it } from 'vitest';
import { getConnectionShareUrl, getLegacyServerFallback, getResultShareUrl, getServerUrl, parseResultShareUrl, parseServerUrl } from './urlUtils';

const parse = (path: string) => {
  const url = new URL(path, 'https://mcptest.io');
  return parseServerUrl(url.pathname, url.search, url.hash);
};

describe('connection share URLs', () => {
  it.each([
    ['https://mcp.context7.com/mcp', '/server/mcp.context7.com/mcp'],
    ['https://api.example.com/v1/mcp/', '/server/api.example.com/v1/mcp'],
    ['http://localhost:3000/mcp', '/server/http:localhost:3000/mcp'],
    ['http://[::1]:3000/v1/mcp', '/server/http:[::1]:3000/v1/mcp'],
    ['https://[2001:db8::1]/mcp', '/server/[2001:db8::1]/mcp'],
    ['https://example.com/a%2Fb/%2520', '/server/example.com/a%2Fb/%2520'],
    ['https://example.com/', '/server/example.com'],
  ])('round-trips %s', (endpoint, expected) => {
    expect(getServerUrl(endpoint)).toBe(expected);
    expect(expected).not.toContain('//');
    expect(parse(expected)).toEqual({ serverUrl: endpoint.replace(/\/+$/, '') });
  });

  it.each(['?region=us&mode=a%20b', '?transport=server-value', '#section', '?region=us#section'])(
    'preserves safe endpoint context %s separately from inspector transport', context => {
      const endpoint = `https://example.com/mcp${context}`;
      const share = getServerUrl(endpoint, 'legacy-sse');
      expect(parse(share)).toEqual({ serverUrl: endpoint, transportMethod: 'sse' });
    });

  it.each(['?token=private', '?api_key_value=private', '?nested=https%3A%2F%2Fexample.com%2F%3Faccess_token%3Dprivate', '#access_token=private'])(
    'omits credentials in %s', context => {
      const share = getConnectionShareUrl(`https://user:pass@example.com/mcp${context}`);
      expect(share).toEqual({ url: '/server/example.com/mcp', queryOmitted: true });
    });

  it('always removes userinfo', () => {
    expect(getServerUrl('https://user:pass@example.com/mcp')).toBe('/server/example.com/mcp');
  });

  it('uses a query only for forced transport, never a path suffix', () => {
    expect(getServerUrl('https://example.com/mcp', 'streamable-http')).toBe('/server/example.com/mcp?transport=http');
    expect(parse('/server/example.com/mcp')).toEqual({ serverUrl: 'https://example.com/mcp' });
    expect(parse('/server/https://example.com/sse/sse')).toEqual({ serverUrl: 'https://example.com/sse/sse' });
  });

  it.each([404, 405])('allows the legacy interpretation after literal HTTP %s', status => {
    const endpoint = 'https://example.com/nested/mcp';
    expect(getLegacyServerFallback(endpoint, { candidateFailures: [{ observedRequests: [{ url: endpoint, status }] }] }))
      .toEqual({ serverUrl: 'https://example.com/nested', transport: 'streamable-http' });
  });

  it.each([undefined, 401, 403, 500])('does not fall back for status %s', status => {
    const endpoint = 'https://example.com/sse';
    expect(getLegacyServerFallback(endpoint, { candidateFailures: [{ observedRequests: [{ url: endpoint, status }] }] })).toBeNull();
  });

  it('keeps result links reconstructable and accepts old literal schemes', () => {
    const endpoint = 'http://[::1]:3000/a%2Fb/mcp?region=us';
    const url = new URL(getResultShareUrl(endpoint, 'tool', 'a/b', { city: 'Oslo' }), 'https://mcptest.io');
    expect(url.pathname).not.toContain('//');
    expect(parseResultShareUrl(url.pathname, url.search)).toEqual({ serverUrl: endpoint, type: 'tool', name: 'a/b', params: { city: 'Oslo' } });
    expect(parseResultShareUrl('/call/https://example.com/mcp/tool/test')).toMatchObject({ serverUrl: 'https://example.com/mcp', name: 'test' });
  });
});
