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

describe('OAuth checker: superseded classified candidates', () => {
  const resource = { resource: 'https://example.com/mcp', authorization_servers: ['https://auth.example/tenant'] };
  const issuer = {
    issuer: 'https://auth.example/tenant',
    authorization_endpoint: 'https://auth.example/authorize',
    token_endpoint: 'https://auth.example/token',
    response_types_supported: ['code'],
    code_challenge_methods_supported: ['S256'],
    jwks_uri: 'https://auth.example/jwks',
    subject_types_supported: ['public'],
    id_token_signing_alg_values_supported: ['RS256'],
    token_endpoint_auth_methods_supported: ['none'],
    client_id_metadata_document_supported: true,
  };
  const ok = (body: unknown): Answer => ({ status: 200, contentType: 'application/json', body: JSON.stringify(body) });
  const probeEndpoint = answering({ 'https://example.com/mcp': { status: 401, wwwAuthenticate: 'Bearer', body: '' } });
  const PATH_RESOURCE = 'https://example.com/.well-known/oauth-protected-resource/mcp';
  const ROOT_RESOURCE = 'https://example.com/.well-known/oauth-protected-resource';
  const RFC8414_ISSUER = 'https://auth.example/.well-known/oauth-authorization-server/tenant';
  const OIDC_ISSUER = 'https://auth.example/tenant/.well-known/openid-configuration';

  it('drops a challenged path-specific resource candidate once root discovery succeeds', async () => {
    const report = await checkOAuthReadiness('https://example.com/mcp', {
      probeEndpoint,
      fetchDocument: answering({ [PATH_RESOURCE]: CLOUDFLARE_CHALLENGE, [ROOT_RESOURCE]: ok(resource), [RFC8414_ISSUER]: ok(issuer) }),
    });
    expect(report.classification).toBe('pre-login success');
    expect(report.verdict).toBe('Clients can start OAuth (metadata checks passed)');
    expect(report.responseClass).toBeUndefined();
    const candidate = report.rows.find((row) => row.url === PATH_RESOURCE);
    expect(candidate?.status).toBe('unknown');
    expect(candidate?.evidence).toContain('cf-mitigated: challenge');
  });

  it('drops a challenged RFC 8414 issuer candidate once OIDC discovery succeeds', async () => {
    const report = await checkOAuthReadiness('https://example.com/mcp', {
      probeEndpoint,
      fetchDocument: answering({ [PATH_RESOURCE]: ok(resource), [RFC8414_ISSUER]: CLOUDFLARE_CHALLENGE, [OIDC_ISSUER]: ok(issuer) }),
    });
    expect(report.classification).toBe('pre-login success');
    expect(report.responseClass).toBeUndefined();
    expect(report.rows.find((row) => row.url === RFC8414_ISSUER)?.evidence).toContain('cf-mitigated: challenge');
    expect(report.rows.find((row) => row.id === 'issuer')).toMatchObject({ status: 'pass', url: OIDC_ISSUER });
  });

  it('does not name a superseded resource challenge when the issuer step fails on its own', async () => {
    const report = await checkOAuthReadiness('https://example.com/mcp', {
      probeEndpoint,
      fetchDocument: answering({ [PATH_RESOURCE]: CLOUDFLARE_CHALLENGE, [ROOT_RESOURCE]: ok(resource) }),
    });
    expect(report.responseClass).toBeUndefined();
    expect(report.verdict).toBe('Discovery broken: fix authorization server metadata');
  });

  it('names a challenge on every issuer candidate when the issuer step fails', async () => {
    const report = await checkOAuthReadiness('https://example.com/mcp', {
      probeEndpoint,
      fetchDocument: answering({ [PATH_RESOURCE]: ok(resource), [RFC8414_ISSUER]: CLOUDFLARE_CHALLENGE, [OIDC_ISSUER]: CLOUDFLARE_CHALLENGE }),
    });
    expect(report.responseClass).toMatchObject({ kind: 'bot-protection', url: RFC8414_ISSUER });
    expect(report.verdict).toBe('Bot protection is blocking MCP clients on /.well-known/oauth-authorization-server/tenant');
  });

  it('still names a challenged MCP endpoint after metadata checks pass', async () => {
    const report = await checkOAuthReadiness('https://example.com/mcp', {
      probeEndpoint: answering({ 'https://example.com/mcp': CLOUDFLARE_CHALLENGE }),
      fetchDocument: answering({ [PATH_RESOURCE]: CLOUDFLARE_CHALLENGE, [ROOT_RESOURCE]: ok(resource), [RFC8414_ISSUER]: ok(issuer) }),
    });
    expect(report.responseClass).toMatchObject({ kind: 'bot-protection', url: 'https://example.com/mcp' });
    expect(report.verdict).toBe('Metadata checks passed, but bot protection is blocking MCP clients on /mcp');
  });

  it('keeps an unbranded HTML 403 on the MCP endpoint a suspicion after metadata checks pass', async () => {
    const report = await checkOAuthReadiness('https://example.com/mcp', {
      probeEndpoint: answering({
        'https://example.com/mcp': { status: 403, contentType: 'text/html', body: '<html><head><title>403 Forbidden</title></head><body><h1>Request blocked</h1></body></html>' },
      }),
      fetchDocument: answering({ [PATH_RESOURCE]: ok(resource), [RFC8414_ISSUER]: ok(issuer) }),
    });
    expect(['resource', 'issuer', 'audience', 'registration', 'pkce', 'code'].map((id) => report.rows.find((row) => row.id === id)?.status))
      .toEqual(['pass', 'pass', 'pass', 'pass', 'pass', 'pass']);
    expect(report.responseClass).toMatchObject({ kind: 'bot-protection', confidence: 'suspected', url: 'https://example.com/mcp' });
    expect(report.verdict).toBe('Metadata checks passed, but bot protection may be blocking MCP clients on /mcp');
    expect(report.verdict).not.toMatch(/ is blocking /);
  });
});

describe('a proxied HTML 403 with WWW-Authenticate stays an authentication challenge', () => {
  // What the /discovery route returns for such a target (see cors-proxy-worker discovery tests).
  const proxiedFetch = createDiscoveryFetch({
    proxyUrl: 'https://proxy.example',
    fetchImpl: async (input: RequestInfo | URL) => {
      if (!String(input).includes('/discovery?')) throw new TypeError('Failed to fetch');
      return new Response('<html><body>Sign in</body></html>', {
        status: 403,
        headers: {
          'Content-Type': 'text/html',
          'WWW-Authenticate': 'Bearer realm="example"',
          'X-MCP-Proxy-Response-Source': 'target',
        },
      });
    },
  });

  it('reaches both classifiers with the header present', async () => {
    const response = await proxiedFetch('https://example.com/.well-known/oauth-protected-resource');
    expect(response).toMatchObject({ status: 403, route: 'proxy', wwwAuthenticate: 'Bearer realm="example"' });

    const oauth = await checkOAuthReadiness('https://example.com/mcp', {
      fetchDocument: proxiedFetch,
      probeEndpoint: answering({ 'https://example.com/mcp': { status: 401, wwwAuthenticate: 'Bearer', body: '' } }),
    });
    expect(oauth.responseClass).toBeUndefined();
    expect(oauth.rows.map((row) => row.evidence).join(' ')).not.toMatch(/bot protection/i);

    const discovery = await checkMcpDiscovery('example.com', { fetch: proxiedFetch });
    expect(discovery.rows.flatMap((row) => row.attempts ?? []).some((attempt) => attempt.responseClass)).toBe(false);
    expect(discovery.rows.map((row) => row.summary).join(' ')).not.toMatch(/bot protection/i);
  });

  it('is classified as suspected bot protection only when the header is absent', async () => {
    const bare = createDiscoveryFetch({
      proxyUrl: 'https://proxy.example',
      fetchImpl: async (input: RequestInfo | URL) => {
        if (!String(input).includes('/discovery?')) throw new TypeError('Failed to fetch');
        return new Response('<html></html>', { status: 403, headers: { 'Content-Type': 'text/html', 'X-MCP-Proxy-Response-Source': 'target' } });
      },
    });
    const oauth = await checkOAuthReadiness('https://example.com/mcp', {
      fetchDocument: bare,
      probeEndpoint: answering({ 'https://example.com/mcp': { status: 401, wwwAuthenticate: 'Bearer', body: '' } }),
    });
    expect(oauth.responseClass).toMatchObject({ kind: 'bot-protection', confidence: 'suspected' });
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
