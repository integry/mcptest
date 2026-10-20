import { describe, expect, it, vi } from 'vitest';
import { probeSubmissionEndpoint, type SubmissionProbeDependencies } from './submissionProbe';
import { ProxiedAuthenticationError } from './transportDetection';

const ENDPOINT = 'https://mcp.acme.dev/mcp';
const PROXY = 'https://proxy.mcptest.dev/';

const connection = ({
  url = ENDPOINT,
  pages = [[{ name: 'a' }, { name: 'b' }], [{ name: 'c' }]],
  tools = true,
}: { url?: string; pages?: Array<Array<{ name: string }>>; tools?: boolean } = {}) => {
  const request = vi.fn(async ({ params }: { params?: { cursor?: string } }) => {
    const index = params?.cursor ? Number(params.cursor) : 0;
    return { tools: pages[index], ...(index + 1 < pages.length ? { nextCursor: String(index + 1) } : {}) };
  });
  return {
    client: {
      getServerCapabilities: () => (tools ? { tools: {} } : {}),
      request,
      close: vi.fn(async () => {}),
    },
    url,
    transportType: 'streamable-http' as const,
    protocolEra: 'modern' as const,
    protocolVersion: '2025-06-18',
  };
};

const probe = (deps: Partial<SubmissionProbeDependencies>) => probeSubmissionEndpoint(ENDPOINT, {
  dependencies: {
    proxyUrl: PROXY,
    discoverResourceMetadata: vi.fn(async () => { throw new Error('not found'); }),
    ...deps,
  },
});

const challenge = (status: 401 | 403, header?: string, resourceMetadataUrl?: string) => new ProxiedAuthenticationError(
  status,
  'target',
  new Error(`HTTP ${status}`),
  { method: 'POST', url: ENDPOINT, targetUrl: ENDPOINT },
  header ? { 'www-authenticate': header } : undefined,
  resourceMetadataUrl
);

describe('probeSubmissionEndpoint', () => {
  it('records a direct handshake with transport, protocol and a paginated tool count', async () => {
    const live = connection();
    const connect = vi.fn(async (_url: string) => live);
    const evidence = await probe({ connect: connect as unknown as SubmissionProbeDependencies['connect'] });

    expect(connect).toHaveBeenCalledTimes(1);
    expect(connect.mock.calls[0][0]).toBe(ENDPOINT);
    expect(evidence).toMatchObject({
      endpointUrl: ENDPOINT,
      outcome: 'mcp',
      validatedUrl: ENDPOINT,
      transport: 'streamable-http',
      protocolVersion: '2025-06-18',
      protocolEra: 'stateless',
      authChallenge: 'none',
      browserAccess: 'direct',
      toolCount: 3,
    });
    expect(live.client.close).toHaveBeenCalled();
  });

  it('reports zero tools when the server has no tools capability', async () => {
    const evidence = await probe({ connect: (async () => connection({ tools: false })) as unknown as SubmissionProbeDependencies['connect'] });
    expect(evidence.toolCount).toBe(0);
  });

  it.each([
    ['an OAuth resource_metadata challenge', challenge(401, 'Bearer resource_metadata="https://mcp.acme.dev/.well-known/oauth-protected-resource"'), 'oauth'],
    ['a resource metadata URL on the error', challenge(401, 'Bearer', 'https://mcp.acme.dev/.well-known/oauth-protected-resource'), 'oauth'],
    ['a bare bearer challenge', challenge(401, 'Bearer realm="acme"'), 'bearer'],
    ['a 401 without a scheme', challenge(401), 'unspecified'],
  ])('classifies %s', async (_label, error, kind) => {
    const evidence = await probe({ connect: vi.fn(async () => { throw error; }) as unknown as SubmissionProbeDependencies['connect'] });
    expect(evidence).toMatchObject({ outcome: 'auth-challenge', authChallenge: kind, authStatus: 401, browserAccess: 'direct' });
    expect(evidence).not.toHaveProperty('toolCount');
  });

  it('upgrades a bare bearer challenge to OAuth when protected-resource discovery succeeds', async () => {
    const evidence = await probe({
      connect: vi.fn(async () => { throw challenge(401, 'Bearer'); }) as unknown as SubmissionProbeDependencies['connect'],
      discoverResourceMetadata: vi.fn(async () => ({ resource: ENDPOINT, authorization_servers: ['https://auth.acme.dev'] })),
    });
    expect(evidence.authChallenge).toBe('oauth');
  });

  it('does not treat a 403 without WWW-Authenticate as an auth challenge', async () => {
    const evidence = await probe({ connect: vi.fn(async () => { throw challenge(403); }) as unknown as SubmissionProbeDependencies['connect'] });
    expect(evidence.outcome).toBe('unreachable');
  });

  it('retries through the CORS proxy when the browser cannot read the response', async () => {
    const proxiedUrl = `${PROXY}?target=${encodeURIComponent(ENDPOINT)}`;
    const connect = vi.fn()
      .mockRejectedValueOnce(new TypeError('Failed to fetch'))
      .mockResolvedValueOnce(connection({ url: proxiedUrl }));
    const evidence = await probe({ connect: connect as unknown as SubmissionProbeDependencies['connect'] });

    expect(connect).toHaveBeenCalledTimes(2);
    expect(connect.mock.calls[1][0]).toBe(proxiedUrl);
    expect(connect.mock.calls[1][4]).toBe(true);
    expect(evidence).toMatchObject({ outcome: 'mcp', browserAccess: 'proxy-required', validatedUrl: ENDPOINT });
  });

  it('reports an unreachable endpoint without a proxy retry for readable failures', async () => {
    const connect = vi.fn(async () => { throw new Error('All connections failed: HTTP 404'); });
    const evidence = await probe({ connect: connect as unknown as SubmissionProbeDependencies['connect'] });
    expect(connect).toHaveBeenCalledTimes(1);
    expect(evidence).toMatchObject({ outcome: 'unreachable', authChallenge: 'none', browserAccess: 'unknown' });
    expect(evidence.detail).toContain('HTTP 404');
  });

  it('reports CORS blocking when neither route reaches an MCP server', async () => {
    const connect = vi.fn(async () => { throw new TypeError('Failed to fetch'); });
    const evidence = await probe({ connect: connect as unknown as SubmissionProbeDependencies['connect'] });
    expect(connect).toHaveBeenCalledTimes(2);
    expect(evidence.outcome).toBe('unreachable');
    expect(evidence.detail).toContain('CORS');
  });
});
