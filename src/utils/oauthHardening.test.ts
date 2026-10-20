import type { FetchLike } from '@modelcontextprotocol/client';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import {
  BrowserOAuthProvider,
  OAUTH_CLIENT_METADATA_URL,
  OAuthAuthorizationResponseError,
  OAuthStateMismatchError,
  beginOAuthFlow,
  completeOAuthFlow,
  getOAuthPrerequisite,
  loadManualOAuthEndpoints,
  loadOAuthAuthorization,
  planOAuthChallengeResponse,
  saveManualOAuthClient,
  saveManualOAuthEndpoints,
} from './oauthFlow';
import { getStoredOAuthTrace } from './oauthTrace';
import {
  classifyPrivateNetworkHost,
  getPrivateNetworkOAuthGuidance,
} from './authorizationGuidance';

const CALLBACK = 'https://mcptest.io/oauth/callback';
const ISSUER = 'https://auth.shared.example/';
const SERVER_ONE = 'https://mcp-one.example/mcp';
const SERVER_TWO = 'https://mcp-two.example/mcp';

const jsonResponse = (body: unknown, init: ResponseInit = {}): Response => (
  new Response(JSON.stringify(body), {
    ...init,
    headers: { 'Content-Type': 'application/json', ...init.headers },
  })
);

const authorizationMetadata = (issuer = ISSUER) => ({
  issuer,
  authorization_endpoint: `${issuer}authorize`,
  token_endpoint: `${issuer}token`,
  response_types_supported: ['code'],
  code_challenge_methods_supported: ['S256'],
  client_id_metadata_document_supported: true,
  scopes_supported: ['read', 'write'],
});

const s256 = async (verifier: string): Promise<string> => {
  const digest = await crypto.subtle.digest('SHA-256', new TextEncoder().encode(verifier));
  return btoa(String.fromCharCode(...new Uint8Array(digest)))
    .replace(/\+/g, '-')
    .replace(/\//g, '_')
    .replace(/=+$/, '');
};

interface TokenRequest {
  url: string;
  body: URLSearchParams;
}

/** Two MCP resources that share one authorization server. */
const sharedIssuerFetch = (tokenRequests: TokenRequest[]): FetchLike => async (input, init) => {
  const url = String(input);
  if (url.includes('/.well-known/oauth-protected-resource')) {
    const resource = url.includes('mcp-one') ? SERVER_ONE : SERVER_TWO;
    return jsonResponse({ resource, authorization_servers: [ISSUER] });
  }
  if (url.startsWith(`${ISSUER}.well-known/`)) return jsonResponse(authorizationMetadata());
  if (url === `${ISSUER}token` && init?.method === 'POST') {
    const body = new URLSearchParams(String(init.body));
    tokenRequests.push({ url, body });
    return jsonResponse({
      access_token: `token-for-${body.get('resource')}`,
      token_type: 'Bearer',
    });
  }
  return new Response('Not found', { status: 404 });
};

const startFlow = async (serverUrl: string, fetchFn: FetchLike): Promise<URL> => {
  let authorizationUrl: URL | undefined;
  await expect(beginOAuthFlow(serverUrl, {
    redirectUrl: CALLBACK,
    fetchFn,
    redirect: (url) => { authorizationUrl = url; },
  })).resolves.toBe('REDIRECT');
  return authorizationUrl!;
};

const callbackFor = (authorizationUrl: URL, code: string): string => (
  `${CALLBACK}?code=${code}&state=${authorizationUrl.searchParams.get('state')}`
);

beforeEach(() => {
  sessionStorage.clear();
  localStorage.clear();
});

describe('concurrent authorization flows (inspector#2726)', () => {
  it('isolates PKCE verifiers and state for two resources on the same authorization server', async () => {
    const tokenRequests: TokenRequest[] = [];
    const fetchFn = sharedIssuerFetch(tokenRequests);
    const firstUrl = await startFlow(SERVER_ONE, fetchFn);
    const secondUrl = await startFlow(SERVER_TWO, fetchFn);
    expect(firstUrl.searchParams.get('state')).not.toBe(secondUrl.searchParams.get('state'));

    // The earlier flow returns last-started-first-finished through /oauth/callback.
    await expect(completeOAuthFlow(callbackFor(firstUrl, 'code-one'), {
      redirectUrl: CALLBACK,
      fetchFn,
    })).resolves.toMatchObject({ serverUrl: SERVER_ONE });
    await expect(completeOAuthFlow(callbackFor(secondUrl, 'code-two'), {
      redirectUrl: CALLBACK,
      fetchFn,
    })).resolves.toMatchObject({ serverUrl: SERVER_TWO });

    expect(tokenRequests).toHaveLength(2);
    const [first, second] = tokenRequests;
    expect(first.body.get('resource')).toBe(SERVER_ONE);
    expect(await s256(first.body.get('code_verifier')!))
      .toBe(firstUrl.searchParams.get('code_challenge'));
    expect(second.body.get('resource')).toBe(SERVER_TWO);
    expect(await s256(second.body.get('code_verifier')!))
      .toBe(secondUrl.searchParams.get('code_challenge'));
    expect(loadOAuthAuthorization(SERVER_ONE)?.accessToken).toBe(`token-for-${SERVER_ONE}`);
    expect(loadOAuthAuthorization(SERVER_TWO)?.accessToken).toBe(`token-for-${SERVER_TWO}`);
  });

  it('isolates two flows for the same resource and never replays a consumed callback', async () => {
    const tokenRequests: TokenRequest[] = [];
    const fetchFn = sharedIssuerFetch(tokenRequests);
    const firstUrl = await startFlow(SERVER_ONE, fetchFn);
    const secondUrl = await startFlow(SERVER_ONE, fetchFn);

    await completeOAuthFlow(callbackFor(firstUrl, 'code-first'), { redirectUrl: CALLBACK, fetchFn });
    await completeOAuthFlow(callbackFor(secondUrl, 'code-second'), { redirectUrl: CALLBACK, fetchFn });

    expect(await s256(tokenRequests[0].body.get('code_verifier')!))
      .toBe(firstUrl.searchParams.get('code_challenge'));
    expect(await s256(tokenRequests[1].body.get('code_verifier')!))
      .toBe(secondUrl.searchParams.get('code_challenge'));
    await expect(completeOAuthFlow(callbackFor(firstUrl, 'code-replayed'), {
      redirectUrl: CALLBACK,
      fetchFn,
    })).rejects.toBeInstanceOf(OAuthStateMismatchError);
    expect(tokenRequests).toHaveLength(2);
  });

  it('keeps an expired callback unusable when it is submitted again', async () => {
    const tokenRequests: TokenRequest[] = [];
    const fetchFn = sharedIssuerFetch(tokenRequests);
    const authorizationUrl = await startFlow(SERVER_ONE, fetchFn);
    const now = Date.now();
    const clock = vi.spyOn(Date, 'now').mockReturnValue(now + 31 * 60 * 1000);
    try {
      for (const code of ['code-expired', 'code-expired-again']) {
        await expect(completeOAuthFlow(callbackFor(authorizationUrl, code), {
          redirectUrl: CALLBACK,
          fetchFn,
        })).rejects.toBeInstanceOf(OAuthStateMismatchError);
      }
    } finally {
      clock.mockRestore();
    }
    expect(tokenRequests).toHaveLength(0);
  });

  it('consumes a validated error callback so its state cannot be replayed', async () => {
    const tokenRequests: TokenRequest[] = [];
    const fetchFn = sharedIssuerFetch(tokenRequests);
    const otherUrl = await startFlow(SERVER_TWO, fetchFn);
    const authorizationUrl = await startFlow(SERVER_ONE, fetchFn);
    const state = authorizationUrl.searchParams.get('state');

    await expect(completeOAuthFlow(`${CALLBACK}?error=access_denied&state=${state}`, {
      redirectUrl: CALLBACK,
      fetchFn,
    })).rejects.toBeInstanceOf(OAuthAuthorizationResponseError);
    await expect(completeOAuthFlow(callbackFor(authorizationUrl, 'code-replayed'), {
      redirectUrl: CALLBACK,
      fetchFn,
    })).rejects.toBeInstanceOf(OAuthStateMismatchError);
    expect(tokenRequests).toHaveLength(0);

    // The other pending flow keeps its own state and verifier.
    await expect(completeOAuthFlow(callbackFor(otherUrl, 'code-other'), {
      redirectUrl: CALLBACK,
      fetchFn,
    })).resolves.toMatchObject({ serverUrl: SERVER_TWO });
    expect(await s256(tokenRequests[0].body.get('code_verifier')!))
      .toBe(otherUrl.searchParams.get('code_challenge'));
  });

  it('consumes a legacy single-flow state after a validated error callback', async () => {
    const tokenRequests: TokenRequest[] = [];
    const fetchFn = sharedIssuerFetch(tokenRequests);
    const authorizationUrl = await startFlow(SERVER_ONE, fetchFn);
    const state = authorizationUrl.searchParams.get('state')!;
    // Simulate storage written before per-flow records existed.
    for (const key of Object.keys(localStorage)) {
      const value = localStorage.getItem(key)!;
      if (!value.includes('"pendingFlows"')) continue;
      const { pendingFlows: _pendingFlows, ...legacy } = JSON.parse(value);
      expect(legacy.expectedState).toBe(state);
      localStorage.setItem(key, JSON.stringify(legacy));
    }

    await expect(completeOAuthFlow(`${CALLBACK}?error=access_denied&state=${state}`, {
      redirectUrl: CALLBACK,
      fetchFn,
    })).rejects.toBeInstanceOf(OAuthAuthorizationResponseError);
    await expect(completeOAuthFlow(callbackFor(authorizationUrl, 'code-replayed'), {
      redirectUrl: CALLBACK,
      fetchFn,
    })).rejects.toBeInstanceOf(OAuthStateMismatchError);
    expect(tokenRequests).toHaveLength(0);
  });
});

describe('browser public client (inspector#2725)', () => {
  it('keeps a manual public client ID bound to its exact resource and discovered issuer', () => {
    for (const serverUrl of [SERVER_ONE, SERVER_TWO]) {
      new BrowserOAuthProvider(serverUrl).saveDiscoveryState({
        authorizationServerUrl: ISSUER,
        authorizationServerMetadata: authorizationMetadata(),
      });
    }

    saveManualOAuthClient(SERVER_ONE, 'public-client-one');

    expect(new BrowserOAuthProvider(SERVER_ONE).clientInformation({ issuer: ISSUER }))
      .toEqual({ client_id: 'public-client-one', issuer: ISSUER });
    // Same authorization server, different MCP resource: not reused.
    expect(new BrowserOAuthProvider(SERVER_TWO).clientInformation({ issuer: ISSUER }))
      .toBeUndefined();
    // Same resource, different issuer: not reused.
    expect(new BrowserOAuthProvider(SERVER_ONE).clientInformation({
      issuer: 'https://other-issuer.example/',
    })).toBeUndefined();
    expect(() => saveManualOAuthClient(SERVER_ONE, 'public-client-one', 'secret'))
      .toThrow(/cannot be saved in browser storage/);
  });
});

describe('challenge handling (inspector#2724, #2722, #2721)', () => {
  it.each([
    [{ status: 403, wwwAuthenticate: 'Bearer error="insufficient_scope", scope="[REDACTED]"', sentAccessToken: true }, 'step_up'],
    [{ status: 403, wwwAuthenticate: 'Bearer error="insufficient_scope"', sentAccessToken: false }, 'authorize'],
    [{ status: 403, sentAccessToken: true }, 'forbidden'],
    [{ status: 403, wwwAuthenticate: 'Bearer error="invalid_token"', sentAccessToken: true }, 'forbidden'],
    [{ status: 403, sentAccessToken: false }, 'authorize'],
    [{ status: 401, wwwAuthenticate: 'Bearer error="invalid_token"', sentAccessToken: true, refreshable: true }, 'refresh'],
    [{ status: 401, sentAccessToken: true, refreshable: false }, 'authorize'],
    [{ status: 401, sentAccessToken: false }, 'authorize'],
  ] as const)('plans %j as %s', (facts, kind) => {
    expect(planOAuthChallengeResponse(facts).kind).toBe(kind);
  });

  it('steps up for the union of granted and challenged scopes without refreshing', async () => {
    const tokenRequests: TokenRequest[] = [];
    const fetchFn = sharedIssuerFetch(tokenRequests);
    const provider = new BrowserOAuthProvider(SERVER_ONE);
    provider.saveDiscoveryState({
      authorizationServerUrl: ISSUER,
      authorizationServerMetadata: authorizationMetadata(),
    });
    provider.saveTokens({
      access_token: 'read-only-token',
      refresh_token: 'refresh-token',
      token_type: 'Bearer',
      scope: 'read',
    }, { issuer: ISSUER });
    let authorizationUrl: URL | undefined;

    await expect(beginOAuthFlow(SERVER_ONE, {
      redirectUrl: CALLBACK,
      fetchFn,
      scope: 'write',
      stepUp: true,
      redirect: (url) => { authorizationUrl = url; },
    })).resolves.toBe('REDIRECT');

    expect(authorizationUrl?.searchParams.get('scope')).toBe('read write');
    expect(authorizationUrl?.searchParams.get('client_id')).toBe(OAUTH_CLIENT_METADATA_URL);
    expect(tokenRequests).toHaveLength(0);
  });
});

describe('token refresh', () => {
  const seedExpiredAuthorization = () => {
    const provider = new BrowserOAuthProvider(SERVER_ONE);
    provider.saveDiscoveryState({
      authorizationServerUrl: ISSUER,
      resourceMetadata: { resource: SERVER_ONE, authorization_servers: [ISSUER] },
      authorizationServerMetadata: authorizationMetadata(),
    });
    provider.saveClientInformation(
      { client_id: OAUTH_CLIENT_METADATA_URL, issuer: ISSUER },
      { issuer: ISSUER }
    );
    provider.saveTokens({
      access_token: 'expired-access-token',
      refresh_token: 'stored-refresh-token',
      token_type: 'Bearer',
    }, { issuer: ISSUER });
  };

  it('refreshes an expired access token once without redirecting', async () => {
    seedExpiredAuthorization();
    const requests: URLSearchParams[] = [];
    const redirect = vi.fn();
    const fetchFn: FetchLike = async (_input, init) => {
      const body = new URLSearchParams(String(init?.body));
      requests.push(body);
      return jsonResponse({ access_token: 'renewed-access-token', token_type: 'Bearer' });
    };

    await expect(beginOAuthFlow(SERVER_ONE, {
      redirectUrl: CALLBACK,
      fetchFn,
      redirect,
      refreshOnly: true,
    })).resolves.toBe('AUTHORIZED');

    expect(requests).toHaveLength(1);
    expect(requests[0].get('grant_type')).toBe('refresh_token');
    expect(requests[0].get('resource')).toBe(SERVER_ONE);
    expect(redirect).not.toHaveBeenCalled();
    expect(loadOAuthAuthorization(SERVER_ONE)?.accessToken).toBe('renewed-access-token');
  });

  it('prompts re-authorization with the reason when the refresh token is rejected', async () => {
    seedExpiredAuthorization();
    const redirect = vi.fn();
    let refreshRequests = 0;
    const fetchFn: FetchLike = async () => {
      refreshRequests += 1;
      return jsonResponse({ error: 'invalid_grant', error_description: 'expired' }, { status: 400 });
    };

    let caught: unknown;
    try {
      await beginOAuthFlow(SERVER_ONE, { redirectUrl: CALLBACK, fetchFn, redirect, refreshOnly: true });
    } catch (error) {
      caught = error;
    }

    expect(refreshRequests).toBe(1);
    expect(redirect).not.toHaveBeenCalled();
    expect(getOAuthPrerequisite(caught)).toMatchObject({
      kind: 'reauthorization_required',
      canConfigureClient: false,
      explanation: expect.stringContaining('HTTP 400 invalid_grant'),
    });
    expect(loadOAuthAuthorization(SERVER_ONE)).toBeUndefined();
    const trace = getStoredOAuthTrace(SERVER_ONE, sessionStorage);
    expect(trace?.outcome?.status).toBe('reauthorization_required');
    expect(JSON.stringify(trace)).not.toContain('stored-refresh-token');
  });
});

describe('resource indicators (inspector#566, #737)', () => {
  it('sends the MCP server as resource when no protected-resource metadata exists', async () => {
    const serverUrl = 'https://no-prm.example/mcp';
    const issuer = 'https://no-prm.example/';
    const fetchFn: FetchLike = async (input) => {
      const url = String(input);
      if (url.includes('oauth-protected-resource')) return new Response('Not found', { status: 404 });
      if (url.startsWith(`${issuer}.well-known/`)) return jsonResponse(authorizationMetadata(issuer));
      return new Response('Not found', { status: 404 });
    };
    let authorizationUrl: URL | undefined;

    await beginOAuthFlow(serverUrl, {
      redirectUrl: CALLBACK,
      fetchFn,
      redirect: (url) => { authorizationUrl = url; },
    });

    expect(authorizationUrl?.searchParams.get('resource')).toBe(serverUrl);
  });

  it('explains an invalid_target rejection instead of dropping the resource', async () => {
    const tokenRequests: TokenRequest[] = [];
    const fetchFn = sharedIssuerFetch(tokenRequests);
    const authorizationUrl = await startFlow(SERVER_ONE, fetchFn);

    await expect(completeOAuthFlow(
      `${CALLBACK}?error=invalid_target&state=${authorizationUrl.searchParams.get('state')}`,
      { redirectUrl: CALLBACK, fetchFn }
    )).rejects.toThrow(/RFC 8707 resource indicator \(invalid_target\).*does not silently drop it/);
    expect(tokenRequests).toHaveLength(0);
  });
});

describe('servers without authorization metadata (inspector#2562)', () => {
  const serverUrl = 'https://metadata-less.example/mcp';
  const authorizationEndpoint = 'https://login.metadata-less.example/oauth/authorize';
  const tokenEndpoint = 'https://login.metadata-less.example/oauth/token';

  it('asks for endpoint overrides only after discovery proves metadata is absent', async () => {
    const redirect = vi.fn();
    let caught: unknown;
    try {
      await beginOAuthFlow(serverUrl, {
        redirectUrl: CALLBACK,
        fetchFn: async () => new Response('Not found', { status: 404 }),
        redirect,
      });
    } catch (error) {
      caught = error;
    }

    expect(redirect).not.toHaveBeenCalled();
    expect(getOAuthPrerequisite(caught)).toMatchObject({
      kind: 'authorization_metadata_unavailable',
      canConfigureClient: true,
    });
  });

  it('honors user-supplied endpoints end to end with PKCE, resource and a direct token request', async () => {
    saveManualOAuthEndpoints(serverUrl, { authorizationEndpoint, tokenEndpoint }, 'public-client');
    expect(loadManualOAuthEndpoints(serverUrl)).toEqual({ authorizationEndpoint, tokenEndpoint });
    const fetchFn = vi.fn<FetchLike>(async (input, init) => {
      if (String(input) === tokenEndpoint && init?.method === 'POST') {
        return jsonResponse({ access_token: 'override-token', token_type: 'Bearer' });
      }
      return new Response('Not found', { status: 404 });
    });
    const proxyFetch = vi.fn<FetchLike>();
    const tokenProxy = { url: 'https://proxy.mcptest.test/', fetchFn: proxyFetch };
    let authorizationUrl: URL | undefined;

    await expect(beginOAuthFlow(serverUrl, {
      redirectUrl: CALLBACK,
      fetchFn,
      tokenProxy,
      // A challenge that names protected-resource metadata must not discard the overrides.
      resourceMetadataUrl: 'https://metadata-less.example/.well-known/oauth-protected-resource/mcp',
      redirect: (url) => { authorizationUrl = url; },
    })).resolves.toBe('REDIRECT');

    expect(`${authorizationUrl!.origin}${authorizationUrl!.pathname}`).toBe(authorizationEndpoint);
    expect(authorizationUrl!.searchParams.get('client_id')).toBe('public-client');
    expect(authorizationUrl!.searchParams.get('code_challenge_method')).toBe('S256');
    expect(authorizationUrl!.searchParams.get('resource')).toBe(serverUrl);

    await completeOAuthFlow(callbackFor(authorizationUrl!, 'override-code'), {
      redirectUrl: CALLBACK,
      fetchFn,
      tokenProxy,
    });

    const tokenCall = fetchFn.mock.calls.find(([input]) => String(input) === tokenEndpoint);
    const body = new URLSearchParams(String(tokenCall?.[1]?.body));
    expect(body.get('resource')).toBe(serverUrl);
    expect(body.get('client_id')).toBe('public-client');
    expect(body.get('client_secret')).toBeNull();
    expect(proxyFetch).not.toHaveBeenCalled();
    expect(loadOAuthAuthorization(serverUrl)?.accessToken).toBe('override-token');
  });

  it('rejects insecure or credential-bearing endpoint overrides', () => {
    expect(() => saveManualOAuthEndpoints(
      serverUrl,
      { authorizationEndpoint: 'http://login.example/authorize', tokenEndpoint },
      'public-client'
    )).toThrow(/https/);
    expect(() => saveManualOAuthEndpoints(
      serverUrl,
      { authorizationEndpoint, tokenEndpoint: 'https://user:pass@login.example/token' },
      'public-client'
    )).toThrow(/credentials/);
  });
});

describe('private and internal targets (MCPJam/inspector#4364)', () => {
  it.each([
    ['http://localhost:3000/mcp', 'loopback'],
    ['http://127.0.0.1:8080/mcp', 'loopback'],
    ['http://[::1]:8080/mcp', 'loopback'],
    ['https://10.0.0.5/mcp', 'private'],
    ['https://172.20.1.1/mcp', 'private'],
    ['https://192.168.1.20:8443/mcp', 'private'],
    ['https://100.100.1.1/mcp', 'private'],
    ['https://[fd12::1]/mcp', 'private'],
    ['https://169.254.10.1/mcp', 'link-local'],
    ['https://mcp.corp.internal/mcp', 'local-name'],
    ['https://intranet/mcp', 'local-name'],
    ['https://mcp.example.com/mcp', undefined],
    ['https://172.32.0.1/mcp', undefined],
  ])('classifies %s as %s', (url, kind) => {
    expect(classifyPrivateNetworkHost(url)).toBe(kind);
  });

  it('names the private authorization server even when the MCP server is public', () => {
    expect(getPrivateNetworkOAuthGuidance('https://mcp.example.com/mcp', 'https://sso.corp.internal/'))
      .toMatch(/^The authorization server sso\.corp\.internal is a local-only host name/);
    expect(getPrivateNetworkOAuthGuidance('https://mcp.example.com/mcp', ISSUER)).toBeUndefined();
  });

  it('attaches explicit browser-network guidance when discovery to a private target is unreadable', async () => {
    const serverUrl = 'https://192.168.1.20:8443/mcp';
    let caught: unknown;
    try {
      await beginOAuthFlow(serverUrl, {
        redirectUrl: CALLBACK,
        fetchFn: async () => { throw new TypeError('Failed to fetch'); },
        redirect: vi.fn(),
      });
    } catch (error) {
      caught = error;
    }

    const prerequisite = getOAuthPrerequisite(caught);
    expect(prerequisite?.kind).toBe('discovery_blocked_invalid');
    expect(prerequisite?.privateNetworkGuidance).toMatch(/192\.168\.1\.20:8443 is a private-network address/);
    expect(prerequisite?.privateNetworkGuidance).toMatch(/Private\/Local Network Access/);
    expect(prerequisite?.privateNetworkGuidance).toMatch(/does not bypass/);
  });
});
