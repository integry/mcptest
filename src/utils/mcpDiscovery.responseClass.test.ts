// @vitest-environment node
import { describe, expect, it } from 'vitest';
import { checkMcpDiscovery, type DiscoveryFetch, type DiscoveryReport, type DiscoveryResponse } from './mcpDiscovery';
import { checkOAuthReadiness } from './oauthChecker';
import { createDiscoveryFetch } from './discoveryFetch';

type Answer = Omit<DiscoveryResponse, 'url' | 'route'> & { route?: DiscoveryResponse['route'] };

const CLOUDFLARE_CHALLENGE: Answer = {
  status: 403,
  contentType: 'text/html; charset=UTF-8',
  headers: { 'cf-mitigated': 'challenge', 'content-type': 'text/html; charset=UTF-8' },
  body: '<!DOCTYPE html><html><head><title>Just a moment...</title></head><body></body></html>',
  route: 'proxy',
};

const SERVER_CARD = {
  $schema: 'https://static.modelcontextprotocol.io/schemas/mcp-server-card/v1.json',
  name: 'com.example/weather',
  version: '1.0.0',
  description: 'Weather',
  remotes: [{ type: 'streamable-http', url: 'https://example.com/mcp' }],
};

const answering = (answers: Record<string, Answer>): DiscoveryFetch => async (url) => {
  const answer = answers[url] ?? { status: 404, contentType: 'text/plain', body: 'Not found' };
  return { url, route: 'direct', ...answer };
};

const rowById = (report: DiscoveryReport, id: string) => {
  const row = report.rows.find((candidate) => candidate.id === id);
  if (!row) throw new Error(`missing row ${id}`);
  return row;
};

describe('discovery checker response classes', () => {
  it('names bot protection on /.well-known/oauth-protected-resource instead of "no metadata"', async () => {
    const report = await checkMcpDiscovery('example.com', {
      fetch: answering({
        'https://example.com/.well-known/mcp/server-card.json': { status: 200, contentType: 'application/json', body: JSON.stringify(SERVER_CARD) },
        'https://example.com/.well-known/oauth-protected-resource/mcp': CLOUDFLARE_CHALLENGE,
        'https://example.com/.well-known/oauth-protected-resource': CLOUDFLARE_CHALLENGE,
      }),
    });
    const oauth = rowById(report, 'oauth-0');
    expect(oauth.status).toBe('unreachable');
    expect(oauth.summary).toBe('Bot protection is blocking MCP clients on /.well-known/oauth-protected-resource/mcp (Cloudflare). Observed HTTP 403, content-type: text/html; charset=UTF-8, cf-mitigated: challenge.');
    expect(oauth.errors.join(' ')).toContain('Exempt the MCP endpoint');
    expect(oauth.links).toContainEqual({ label: 'Deploying a remote MCP server', href: '/learn/deploy-remote-mcp-server' });
    expect(oauth.attempts[0].responseClass).toMatchObject({ kind: 'bot-protection', signature: 'cloudflare.cf-mitigated' });
  });

  it('names a 402 on a discovery document as payment required', async () => {
    const report = await checkMcpDiscovery('example.com', {
      fetch: answering({
        'https://example.com/.well-known/mcp/server-card.json': {
          status: 402,
          contentType: 'application/json',
          headers: { 'payment-required': 'eyJ4NDAyVmVyc2lvbiI6Mn0=' },
          body: '{}',
        },
      }),
    });
    const card = rowById(report, 'well-known-server-card');
    expect(card.status).toBe('unreachable');
    expect(card.summary).toMatch(/^Payment required on \/\.well-known\/mcp\/server-card\.json \(x402\)/);
  });

  it('keeps a real 404 and a plain HTTP 500 as before', async () => {
    const report = await checkMcpDiscovery('example.com', {
      fetch: answering({
        'https://example.com/.well-known/mcp/server-card.json': { status: 500, contentType: 'text/plain', body: 'oops' },
      }),
    });
    expect(rowById(report, 'well-known-server-card')).toMatchObject({ status: 'invalid', summary: 'The server answered HTTP 500.' });
    expect(rowById(report, 'ai-catalog').status).toBe('not-found');
  });
});

describe('OAuth checker response classes', () => {
  it('gives a bot-protection verdict that names the blocked path', async () => {
    const fetchDocument = answering({
      'https://example.com/.well-known/oauth-protected-resource/mcp': CLOUDFLARE_CHALLENGE,
      'https://example.com/.well-known/oauth-protected-resource': CLOUDFLARE_CHALLENGE,
    });
    const probeEndpoint = answering({ 'https://example.com/mcp': CLOUDFLARE_CHALLENGE });
    const report = await checkOAuthReadiness('https://example.com/mcp', { fetchDocument, probeEndpoint });

    expect(report.verdict).toBe('Bot protection is blocking MCP clients on /mcp');
    expect(report.classification).toBe('server non-compliance');
    expect(report.responseClass).toMatchObject({ kind: 'bot-protection', url: 'https://example.com/mcp' });
    const challenge = report.rows.find((row) => row.id === 'challenge');
    expect(challenge?.status).toBe('unknown');
    expect(challenge?.evidence).toContain('cf-mitigated: challenge');
    expect(challenge?.fix).toContain('Exempt the MCP endpoint');
  });

  it('treats a rate-limited metadata request as transient and says so', async () => {
    const limited: Answer = { status: 429, contentType: 'application/json', headers: { 'retry-after': '30' }, body: '{}' };
    const fetchDocument = answering({
      'https://example.com/.well-known/oauth-protected-resource/mcp': limited,
      'https://example.com/.well-known/oauth-protected-resource': limited,
    });
    const report = await checkOAuthReadiness('https://example.com/mcp', {
      fetchDocument,
      probeEndpoint: answering({ 'https://example.com/mcp': { status: 401, body: '' } }),
    });
    expect(report.classification).toBe('transient');
    expect(report.verdict).toBe('Rate limit reached on /.well-known/oauth-protected-resource/mcp');
  });

  it('leaves a legitimate 401 challenge alone', async () => {
    const report = await checkOAuthReadiness('https://example.com/mcp', {
      fetchDocument: answering({}),
      probeEndpoint: answering({
        'https://example.com/mcp': { status: 401, wwwAuthenticate: 'Bearer realm="x"', contentType: 'text/html', body: '<html>Login</html>' },
      }),
    });
    expect(report.responseClass).toBeUndefined();
    expect(report.verdict).toBe('Discovery broken: fix protected resource metadata');
  });
});

describe('discovery fetch keeps classification evidence', () => {
  it('captures the classification headers of a proxied target response', async () => {
    const fetchImpl = async (input: RequestInfo | URL) => {
      if (!String(input).includes('/discovery?')) throw new TypeError('Failed to fetch');
      return new Response('<html>Just a moment...</html>', {
        status: 403,
        headers: {
          'Content-Type': 'text/html',
          'cf-mitigated': 'challenge',
          'X-MCP-Proxy-Response-Source': 'target',
        },
      });
    };
    const fetchDocument = createDiscoveryFetch({ proxyUrl: 'https://proxy.example', fetchImpl });
    const response = await fetchDocument('https://example.com/.well-known/oauth-protected-resource');
    expect(response).toMatchObject({ status: 403, route: 'proxy', headers: { 'cf-mitigated': 'challenge', 'content-type': 'text/html' } });
  });
});
