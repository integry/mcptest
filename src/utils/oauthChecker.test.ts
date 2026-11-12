// @vitest-environment node
import { expect, it } from 'vitest';
import { checkOAuthReadiness, normalizeOAuthCheckEndpoint } from './oauthChecker';
import type { DiscoveryFetch } from './mcpDiscovery';
import githubResource from './fixtures/oauth-sweep/github-resource.json';
import githubIssuer from './fixtures/oauth-sweep/github-issuer.json';
import dropboxResource from './fixtures/oauth-sweep/dropbox-resource.json';
import dropboxIssuer from './fixtures/oauth-sweep/dropbox-issuer.json';
import harnessResource from './fixtures/oauth-sweep/harness-resource.json';
import harnessIssuer from './fixtures/oauth-sweep/harness-issuer.json';
import similarwebResource from './fixtures/oauth-sweep/similarweb-resource.json';

function fixture(resource: { resource: string; authorization_servers: string[] }, issuer: { issuer: string }, oidc = false) {
  const requests: string[] = [];
  const fetchDocument: DiscoveryFetch = async url => {
    requests.push(url);
    const isResource = url.includes('/.well-known/oauth-protected-resource');
    const isIssuer = oidc ? url === `${issuer.issuer}/.well-known/openid-configuration` : url.includes('/.well-known/oauth-authorization-server');
    return { url, route: 'direct', status: isResource || isIssuer ? 200 : 404, contentType: 'application/json', body: JSON.stringify(isResource ? resource : isIssuer ? issuer : {}) };
  };
  return { fetchDocument, requests };
}

it.each([
  [githubResource, githubIssuer, false, 'GitHub'],
  [dropboxResource, dropboxIssuer, false, 'Dropbox'],
  [harnessResource, harnessIssuer, true, 'Harness'],
] as const)('diagnoses recorded provider metadata without registration', async (resource, issuer, oidc, name) => {
  const { fetchDocument, requests } = fixture(resource, issuer, oidc);
  const result = await checkOAuthReadiness(resource.resource, { fetchDocument });
  expect(result.providerNote).toContain(name);
  expect(result.rows.find(row => row.id === 'issuer')?.status).toBe('pass');
  expect(result.rows.find(row => row.id === 'pkce')?.status).toBe('pass');
  expect(requests.every(url => url === resource.resource || url.includes('/.well-known/'))).toBe(true);
  expect(requests).not.toContain('registration_endpoint' in issuer ? issuer.registration_endpoint : '');
  expect(result.classification).toBe('unsupported client mode');
});

it('reports metadata readiness, preserves failed fallbacks, and enforces resource matching', async () => {
  const issuer = { ...githubIssuer, registration_endpoint: 'https://auth.example/register' };
  const { fetchDocument } = fixture(githubResource, issuer);
  const result = await checkOAuthReadiness(githubResource.resource, { fetchDocument });
  // Provider policy still forbids public clients even if metadata advertises DCR.
  expect(result.classification).toBe('unsupported client mode');
  const wrong = { ...githubResource, resource: 'https://unrelated.example/mcp' };
  const mismatch = await checkOAuthReadiness(githubResource.resource, fixture(wrong, githubIssuer));
  expect(mismatch.verdict).toContain('resource URL match');
});

it.each([429, 503])('classifies HTTP %s metadata failures as transient', async status => {
  const fetchDocument: DiscoveryFetch = async url => ({ url, route: 'proxy', status, body: '{}' });
  expect((await checkOAuthReadiness('https://example.com/mcp', { fetchDocument })).classification).toBe('transient');
});

const readyResource = { resource: 'https://example.com/mcp', authorization_servers: ['https://auth.example/tenant'] };
const readyIssuer = {
  issuer: readyResource.authorization_servers[0],
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
const healthyProbe: DiscoveryFetch = async url => ({ url, route: 'direct', status: 401, body: '' });

it.each([401, 403, 429])('supersedes HTTP %s resource candidates with successful root discovery', async status => {
  const { fetchDocument } = fixture(readyResource, readyIssuer);
  const blockedUrl = 'https://example.com/.well-known/oauth-protected-resource/mcp';
  const result = await checkOAuthReadiness(readyResource.resource, {
    probeEndpoint: healthyProbe,
    fetchDocument: async url => url === blockedUrl
      ? { url, route: 'direct', status, body: '{}' }
      : fetchDocument(url),
  });
  expect(result.classification).toBe('pre-login success');
  expect(result.verdict).toBe('Clients can start OAuth (metadata checks passed)');
  expect(result.rows.find(row => row.url === blockedUrl)?.status).toBe('unknown');
  expect(result.rows.find(row => row.id === 'resource')?.status).toBe('pass');
});

it.each([401, 403, 429, 502])('supersedes HTTP %s issuer candidates with successful OIDC discovery', async status => {
  const { fetchDocument } = fixture(readyResource, readyIssuer, true);
  const blockedUrl = 'https://auth.example/.well-known/oauth-authorization-server/tenant';
  const result = await checkOAuthReadiness(readyResource.resource, {
    probeEndpoint: healthyProbe,
    fetchDocument: async url => url === blockedUrl
      ? { url, route: 'direct', status, body: '{}' }
      : fetchDocument(url),
  });
  expect(result.classification).toBe('pre-login success');
  expect(result.rows.find(row => row.url === blockedUrl)?.status).toBe('unknown');
  expect(result.rows.find(row => row.id === 'issuer')).toMatchObject({
    status: 'pass', url: `${readyIssuer.issuer}/.well-known/openid-configuration`,
  });
});

it.each(['blocked', 'network failure'])('supersedes an earlier %s advertised issuer with a successful issuer', async failure => {
  const resource = { ...readyResource, authorization_servers: ['https://unavailable.example', readyIssuer.issuer] };
  const { fetchDocument } = fixture(resource, readyIssuer);
  const result = await checkOAuthReadiness(resource.resource, {
    probeEndpoint: healthyProbe,
    fetchDocument: async url => {
      if (new URL(url).hostname === 'unavailable.example') {
        if (failure === 'network failure') throw new Error('Network unavailable');
        return { url, route: 'direct', status: 403, body: '{}' };
      }
      return fetchDocument(url);
    },
  });
  expect(result.classification).toBe('pre-login success');
  expect(result.rows.find(row => row.id === 'issuer')?.status).toBe('pass');
});

it('does not carry superseded resource blocking into a missing issuer diagnosis', async () => {
  const { fetchDocument } = fixture(readyResource, readyIssuer);
  const result = await checkOAuthReadiness(readyResource.resource, {
    probeEndpoint: healthyProbe,
    fetchDocument: async url => {
      if (url.endsWith('oauth-protected-resource/mcp')) return { url, route: 'direct', status: 403, body: '{}' };
      if (new URL(url).hostname === 'auth.example') return { url, route: 'direct', status: 404, body: '{}' };
      return fetchDocument(url);
    },
  });
  expect(result.classification).toBe('server non-compliance');
  expect(result.rows.find(row => row.id === 'resource')?.status).toBe('pass');
  expect(result.rows.find(row => row.id === 'issuer')?.status).toBe('fail');
});

it.each(['resource', 'issuer'])('keeps failed %s discovery transient when blocked candidates are not superseded', async phase => {
  const { fetchDocument } = fixture(readyResource, readyIssuer);
  const result = await checkOAuthReadiness(readyResource.resource, {
    probeEndpoint: healthyProbe,
    fetchDocument: async url => (url.includes('oauth-protected-resource') ? phase === 'resource' : phase === 'issuer')
      ? { url, route: 'direct', status: 403, body: '{}' }
      : fetchDocument(url),
  });
  expect(result.classification).toBe('transient');
  expect(result.verdict).toBe('Discovery blocked: retry or check access policy');
  expect(result.rows.find(row => row.id === phase)?.status).toBe('unknown');
});

it.each([429, 503])('preserves MCP endpoint HTTP %s unavailability after successful metadata discovery', async status => {
  const result = await checkOAuthReadiness(readyResource.resource, {
    ...fixture(readyResource, readyIssuer),
    probeEndpoint: async url => ({ url, route: 'direct', status, body: '' }),
  });
  expect(result.classification).toBe('transient');
  expect(result.verdict).toBe('Metadata checks passed; MCP endpoint unavailable, retry');
  expect(result.rows.find(row => row.id === 'resource')?.status).toBe('pass');
  expect(result.rows.find(row => row.id === 'issuer')?.status).toBe('pass');
});

it('does not mistake access-blocked Similarweb metadata for absent client registration', async () => {
  const fetchDocument: DiscoveryFetch = async url => ({ url, route: 'direct', status: url.includes('oauth-protected-resource') ? 200 : 403, body: JSON.stringify(similarwebResource) });
  const result = await checkOAuthReadiness('https://mcp.similarweb.com/mcp', { fetchDocument });
  expect(result.providerNote).toContain('access-blocked');
  expect(result.classification).toBe('transient');
  expect(result.rows.find(row => row.id === 'registration')?.status).toBe('skipped');
});

it('uses an exposed challenge URL and never contacts authorization, token or registration endpoints', async () => {
  const endpoint = 'https://example.com/mcp';
  const issuer = { ...githubIssuer, issuer: 'https://auth.example', registration_endpoint: 'https://auth.example/register', token_endpoint_auth_methods_supported: ['none'] };
  const requests: string[] = [];
  const fetchDocument: DiscoveryFetch = async url => {
    requests.push(url);
    const resource = url.includes('oauth-protected-resource');
    return { url, route: 'direct', status: 200, body: JSON.stringify(resource ? { resource: endpoint, authorization_servers: [issuer.issuer] } : issuer) };
  };
  const result = await checkOAuthReadiness(endpoint, { fetchDocument, probeEndpoint: async url => ({ url, status: 401, route: 'direct', wwwAuthenticate: 'Bearer resource_metadata="https://example.com/.well-known/oauth-protected-resource/custom"', body: '' }) });
  expect(requests[0]).toBe('https://example.com/.well-known/oauth-protected-resource/custom');
  expect(result.classification).toBe('pre-login success');
  expect(requests).toHaveLength(2);
  expect(result.rows.find(row => row.id === 'redirects')?.status).toBe('unknown');
});

it.each(['https://user:secret@example.com/mcp', 'https://example.com/mcp?token=secret', 'https://example.com/mcp#token', 'http://example.com/mcp', 'file:///etc/passwd'])('rejects credential-bearing or unsafe endpoint %s', value => {
  expect(() => normalizeOAuthCheckEndpoint(value)).toThrow();
});


it('retains resource-root fallback evidence and rejects missing PKCE', async () => {
  const endpoint = 'https://example.com/mcp';
  const fetchDocument: DiscoveryFetch = async url => {
    let body: unknown = {};
    let status = 404;
    if (url === 'https://example.com/.well-known/oauth-protected-resource') {
      status = 200; body = { resource: endpoint, authorization_servers: ['https://auth.example'] };
    }
    if (url === 'https://auth.example/.well-known/oauth-authorization-server') {
      status = 200; body = { ...githubIssuer, issuer: 'https://auth.example', code_challenge_methods_supported: ['plain'], client_id_metadata_document_supported: true };
    }
    return { url, status, route: 'proxy', body: JSON.stringify(body) };
  };
  const result = await checkOAuthReadiness(endpoint, { fetchDocument });
  expect(result.rows.some(row => row.url.endsWith('oauth-protected-resource/mcp') && row.status === 'fail')).toBe(true);
  expect(result.rows.find(row => row.id === 'resource')?.status).toBe('pass');
  expect(result.verdict).toContain('PKCE S256');
});

it('rejects issuer mismatch even if endpoints and capabilities look valid', async () => {
  const resource = { resource: 'https://example.com/mcp', authorization_servers: ['https://auth.example'] };
  const result = await checkOAuthReadiness(resource.resource, fixture(resource, githubIssuer));
  expect(result.classification).toBe('server non-compliance');
  expect(result.rows.find(row => row.id === 'issuer')?.status).toBe('fail');
});
