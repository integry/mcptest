import { auth, type FetchLike, type OAuthClientProvider } from '@modelcontextprotocol/client';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import clientMetadataDocument from '../../public/oauth/client-metadata.json';
import {
  BrowserOAuthProvider,
  OAUTH_CLIENT_METADATA_URL,
  OAuthStateMismatchError,
  beginOAuthFlow,
  clearOAuthTokens,
  completeOAuthFlow,
  isOAuthClientConfigurationRequired,
  loadOAuthAuthorization,
  prepareManualOAuthClient,
  saveManualOAuthClient,
} from './oauthFlow';
import { getStoredOAuthTrace } from './oauthTrace';

const SERVER_URL = 'https://mcp.example/mcp';
const ISSUER_A = 'https://auth-a.example/';
const ISSUER_B = 'https://auth-b.example/';

const jsonResponse = (body: unknown, init: ResponseInit = {}): Response => (
  new Response(JSON.stringify(body), {
    ...init,
    headers: { 'Content-Type': 'application/json', ...init.headers },
  })
);

const oauthFetch = ({
  supportsCimd,
  supportsDcr,
  calls,
}: {
  supportsCimd: boolean;
  supportsDcr: boolean;
  calls: Array<{ url: string; init?: RequestInit }>;
}): FetchLike => async (input, init) => {
  const url = String(input);
  calls.push({ url, init });

  if (url.includes('/.well-known/oauth-protected-resource')) {
    return jsonResponse({
      resource: SERVER_URL,
      authorization_servers: [ISSUER_A],
    });
  }

  if (url.includes('/.well-known/oauth-authorization-server')) {
    return jsonResponse({
      issuer: ISSUER_A,
      authorization_endpoint: `${ISSUER_A}authorize`,
      token_endpoint: `${ISSUER_A}token`,
      response_types_supported: ['code'],
      code_challenge_methods_supported: ['S256'],
      client_id_metadata_document_supported: supportsCimd,
      ...(supportsDcr ? { registration_endpoint: `${ISSUER_A}register` } : {}),
    });
  }

  if (url === `${ISSUER_A}register` && init?.method === 'POST') {
    const submittedMetadata = JSON.parse(String(init.body));
    return jsonResponse({ ...submittedMetadata, client_id: 'dcr-client-id' });
  }

  return new Response('Not found', { status: 404 });
};

beforeEach(() => {
  sessionStorage.clear();
});

describe('BrowserOAuthProvider', () => {
  it('keeps clients and tokens bound to their authorization-server issuer', () => {
    const provider = new BrowserOAuthProvider(SERVER_URL, {
      redirect: vi.fn(),
    });

    provider.saveClientInformation(
      { client_id: 'client-a', issuer: ISSUER_A },
      { issuer: ISSUER_A }
    );
    provider.saveClientInformation(
      { client_id: 'client-b', issuer: ISSUER_B },
      { issuer: ISSUER_B }
    );
    provider.saveTokens(
      { access_token: 'token-a', token_type: 'Bearer', issuer: ISSUER_A },
      { issuer: ISSUER_A }
    );
    provider.saveTokens(
      { access_token: 'token-b', token_type: 'Bearer', issuer: ISSUER_B },
      { issuer: ISSUER_B }
    );

    expect(provider.clientInformation({ issuer: ISSUER_A })?.client_id).toBe('client-a');
    expect(provider.clientInformation({ issuer: ISSUER_B })?.client_id).toBe('client-b');
    expect(provider.tokens({ issuer: ISSUER_A })?.access_token).toBe('token-a');
    expect(provider.tokens({ issuer: ISSUER_B })?.access_token).toBe('token-b');
    expect(provider.tokens()?.access_token).toBe('token-b');
    expect(sessionStorage.getItem('oauth_access_token_mcp.example')).toBe('token-b');
  });

  it('loads and clears tokens by exact resource and discovered issuer', () => {
    const serverA = 'https://mcp.example/resource-a';
    const serverB = 'https://mcp.example/resource-b';
    const providerA = new BrowserOAuthProvider(serverA, { redirect: vi.fn() });
    const providerB = new BrowserOAuthProvider(serverB, { redirect: vi.fn() });

    providerA.saveDiscoveryState({
      authorizationServerUrl: ISSUER_A,
      authorizationServerMetadata: {
        issuer: ISSUER_A,
        authorization_endpoint: `${ISSUER_A}authorize`,
        token_endpoint: `${ISSUER_A}token`,
        userinfo_endpoint: `${ISSUER_A}userinfo`,
        response_types_supported: ['code'],
      },
    });
    providerB.saveDiscoveryState({
      authorizationServerUrl: ISSUER_B,
      authorizationServerMetadata: {
        issuer: ISSUER_B,
        authorization_endpoint: `${ISSUER_B}authorize`,
        token_endpoint: `${ISSUER_B}token`,
        response_types_supported: ['code'],
      },
    });
    providerA.saveTokens(
      {
        access_token: 'token-a',
        refresh_token: 'refresh-a',
        token_type: 'Bearer',
        issuer: ISSUER_A,
      },
      { issuer: ISSUER_A }
    );
    providerB.saveTokens(
      {
        access_token: 'token-b',
        refresh_token: 'refresh-b',
        token_type: 'Bearer',
        issuer: ISSUER_B,
      },
      { issuer: ISSUER_B }
    );

    expect(loadOAuthAuthorization(serverA)).toEqual({
      accessToken: 'token-a',
      issuer: ISSUER_A,
      userInfoEndpoint: `${ISSUER_A}userinfo`,
    });
    expect(loadOAuthAuthorization(serverB)).toEqual({
      accessToken: 'token-b',
      issuer: ISSUER_B,
    });
    expect(sessionStorage.getItem('oauth_access_token_mcp.example')).toBe('token-b');

    clearOAuthTokens(serverA);

    expect(loadOAuthAuthorization(serverA)).toBeUndefined();
    expect(loadOAuthAuthorization(serverB)?.accessToken).toBe('token-b');
    expect(sessionStorage.getItem('oauth_access_token_mcp.example')).toBe('token-b');
    expect(sessionStorage.getItem('oauth_refresh_token_mcp.example')).toBe('refresh-b');
  });

  it('does not treat a host-only compatibility token as network authorization', () => {
    sessionStorage.setItem('oauth_access_token_mcp.example', 'host-token');

    expect(loadOAuthAuthorization(SERVER_URL)).toBeUndefined();
  });

  it('prioritizes manually pre-registered client credentials', () => {
    const provider = new BrowserOAuthProvider(SERVER_URL, { redirect: vi.fn() });
    provider.saveClientInformation(
      { client_id: 'dcr-client', issuer: ISSUER_A },
      { issuer: ISSUER_A }
    );
    sessionStorage.setItem('oauth_client_mcp.example', JSON.stringify({
      clientId: 'manual-client',
      clientSecret: 'manual-secret',
      issuer: ISSUER_A,
      registeredManually: true,
    }));

    expect(provider.clientInformation({ issuer: ISSUER_A })).toMatchObject({
      client_id: 'manual-client',
      client_secret: 'manual-secret',
      issuer: ISSUER_A,
    });
    expect(provider.clientInformation({ issuer: ISSUER_B })).toBeUndefined();
  });

  it('binds a manually configured client to the discovered issuer', () => {
    const provider = new BrowserOAuthProvider(SERVER_URL, { redirect: vi.fn() });
    provider.saveDiscoveryState({
      authorizationServerUrl: ISSUER_A,
      authorizationServerMetadata: {
        issuer: ISSUER_A,
        authorization_endpoint: `${ISSUER_A}authorize`,
        token_endpoint: `${ISSUER_A}token`,
        response_types_supported: ['code'],
      },
    });

    saveManualOAuthClient(SERVER_URL, 'manual-client', 'manual-secret');

    expect(provider.clientInformation({ issuer: ISSUER_A })).toMatchObject({
      client_id: 'manual-client',
      client_secret: 'manual-secret',
      issuer: ISSUER_A,
    });
    expect(provider.clientInformation({ issuer: ISSUER_B })).toBeUndefined();
  });

  it('prepares provider discovery before showing manual client configuration', async () => {
    const discover = vi.fn().mockResolvedValue({
      authorizationServerUrl: ISSUER_A,
      authorizationServerMetadata: {
        issuer: ISSUER_A,
        authorization_endpoint: `${ISSUER_A}authorize`,
        token_endpoint: `${ISSUER_A}token`,
        response_types_supported: ['code'],
      },
    });

    await prepareManualOAuthClient(SERVER_URL, { discover, redirect: vi.fn() });
    saveManualOAuthClient(SERVER_URL, 'manual-client');

    const provider = new BrowserOAuthProvider(SERVER_URL, { redirect: vi.fn() });
    expect(discover).toHaveBeenCalledWith(SERVER_URL);
    expect(provider.clientInformation({ issuer: ISSUER_A })).toMatchObject({
      client_id: 'manual-client',
      issuer: ISSUER_A,
    });
  });

  it('rehydrates the UI token bridge when the SDK already has authorization', async () => {
    const provider = new BrowserOAuthProvider(SERVER_URL, { redirect: vi.fn() });
    provider.saveDiscoveryState({
      authorizationServerUrl: ISSUER_A,
      authorizationServerMetadata: {
        issuer: ISSUER_A,
        authorization_endpoint: `${ISSUER_A}authorize`,
        token_endpoint: `${ISSUER_A}token`,
        response_types_supported: ['code'],
      },
    });
    provider.saveTokens(
      { access_token: 'persisted-token', token_type: 'Bearer', issuer: ISSUER_A },
      { issuer: ISSUER_A }
    );
    sessionStorage.removeItem('oauth_access_token_mcp.example');

    const result = await beginOAuthFlow(SERVER_URL, {
      authenticate: vi.fn().mockResolvedValue('AUTHORIZED'),
      redirect: vi.fn(),
    });

    expect(result).toBe('AUTHORIZED');
    expect(sessionStorage.getItem('oauth_access_token_mcp.example')).toBe('persisted-token');
  });

  it('persists PKCE, discovery, and state through the redirect round trip', () => {
    const first = new BrowserOAuthProvider(SERVER_URL, { redirect: vi.fn() });
    const state = first.state();
    first.saveCodeVerifier('verifier');
    first.saveDiscoveryState({
      authorizationServerUrl: ISSUER_A,
      authorizationServerMetadata: {
        issuer: ISSUER_A,
        authorization_endpoint: `${ISSUER_A}authorize`,
        token_endpoint: `${ISSUER_A}token`,
        response_types_supported: ['code'],
      },
    });

    const restored = new BrowserOAuthProvider(SERVER_URL, { redirect: vi.fn() });
    expect(restored.codeVerifier()).toBe('verifier');
    expect(restored.discoveryState()?.authorizationServerUrl).toBe(ISSUER_A);
    expect(() => restored.assertState(state)).not.toThrow();
    expect(() => restored.assertState('wrong-state')).toThrow(OAuthStateMismatchError);
  });

  it('publishes CIMD only for the exact production callback', () => {
    const production = new BrowserOAuthProvider(SERVER_URL, {
      redirectUrl: 'https://mcptest.io/oauth/callback',
      redirect: vi.fn(),
    });
    const preview = new BrowserOAuthProvider(SERVER_URL, {
      redirectUrl: 'https://preview.mcptest.io/oauth/callback',
      redirect: vi.fn(),
    });

    expect(production.clientMetadataUrl).toBe(OAUTH_CLIENT_METADATA_URL);
    expect(preview.clientMetadataUrl).toBeUndefined();
    expect(clientMetadataDocument).toMatchObject({
      client_id: OAUTH_CLIENT_METADATA_URL,
      redirect_uris: ['https://mcptest.io/oauth/callback'],
      token_endpoint_auth_method: 'none',
    });
  });
});

describe('SDK OAuth registration order', () => {
  it('uses CIMD when advertised without attempting DCR', async () => {
    const calls: Array<{ url: string; init?: RequestInit }> = [];
    let redirectUrl: URL | undefined;
    const provider = new BrowserOAuthProvider(SERVER_URL, {
      redirectUrl: 'https://mcptest.io/oauth/callback',
      redirect: (url) => { redirectUrl = url; },
    });

    const result = await auth(provider, {
      serverUrl: SERVER_URL,
      fetchFn: oauthFetch({ supportsCimd: true, supportsDcr: true, calls }),
    });

    expect(result).toBe('REDIRECT');
    expect(redirectUrl?.searchParams.get('client_id')).toBe(OAUTH_CLIENT_METADATA_URL);
    expect(calls.some(({ url }) => url === `${ISSUER_A}register`)).toBe(false);
  });

  it('falls back to DCR when CIMD is not advertised', async () => {
    const calls: Array<{ url: string; init?: RequestInit }> = [];
    let redirectUrl: URL | undefined;
    const provider = new BrowserOAuthProvider(SERVER_URL, {
      redirectUrl: 'https://preview.mcptest.io/oauth/callback',
      redirect: (url) => { redirectUrl = url; },
    });

    const result = await auth(provider, {
      serverUrl: SERVER_URL,
      fetchFn: oauthFetch({ supportsCimd: false, supportsDcr: true, calls }),
    });

    expect(result).toBe('REDIRECT');
    expect(redirectUrl?.searchParams.get('client_id')).toBe('dcr-client-id');
    expect(calls).toContainEqual(expect.objectContaining({
      url: `${ISSUER_A}register`,
      init: expect.objectContaining({ method: 'POST' }),
    }));
  });

  it('requests a pre-registered client when neither CIMD nor DCR is available', async () => {
    const calls: Array<{ url: string; init?: RequestInit }> = [];
    let redirectUrl: URL | undefined;
    const provider = new BrowserOAuthProvider(SERVER_URL, {
      redirectUrl: 'https://preview.mcptest.io/oauth/callback',
      redirect: (url) => { redirectUrl = url; },
    });

    let registrationError: unknown;
    try {
      await auth(provider, {
        serverUrl: SERVER_URL,
        fetchFn: oauthFetch({ supportsCimd: false, supportsDcr: false, calls }),
      });
    } catch (error) {
      registrationError = error;
    }

    expect(isOAuthClientConfigurationRequired(registrationError)).toBe(true);

    saveManualOAuthClient(SERVER_URL, 'pre-registered-client');
    const result = await auth(provider, {
      serverUrl: SERVER_URL,
      fetchFn: oauthFetch({ supportsCimd: false, supportsDcr: false, calls }),
    });

    expect(result).toBe('REDIRECT');
    expect(redirectUrl?.searchParams.get('client_id')).toBe('pre-registered-client');
  });
});

describe('OAuth callback completion', () => {
  it('validates state, passes iss to the SDK, and writes legacy token keys', async () => {
    sessionStorage.setItem('oauth_server_url', SERVER_URL);
    const provider = new BrowserOAuthProvider(SERVER_URL, { redirect: vi.fn() });
    const state = provider.state();
    const authenticate = vi.fn(async (
      callbackProvider: OAuthClientProvider,
      options: Parameters<typeof auth>[1]
    ) => {
      await callbackProvider.saveTokens(
        { access_token: 'callback-token', token_type: 'Bearer', issuer: ISSUER_A },
        { issuer: ISSUER_A }
      );
      return 'AUTHORIZED' as const;
    });

    const result = await completeOAuthFlow(
      `https://mcptest.io/oauth/callback?code=auth-code&state=${state}&iss=${encodeURIComponent(ISSUER_A)}`,
      { authenticate, redirect: vi.fn() }
    );

    expect(authenticate).toHaveBeenCalledWith(expect.anything(), expect.objectContaining({
      serverUrl: `${SERVER_URL}`,
      authorizationCode: 'auth-code',
      iss: ISSUER_A,
    }));
    expect(result).toEqual({ serverUrl: SERVER_URL, issuer: ISSUER_A });
    expect(sessionStorage.getItem('oauth_access_token_mcp.example')).toBe('callback-token');
  });

  it('rejects a callback state mismatch before code exchange', async () => {
    sessionStorage.setItem('oauth_server_url', SERVER_URL);
    new BrowserOAuthProvider(SERVER_URL, { redirect: vi.fn() }).state();
    const authenticate = vi.fn();

    await expect(completeOAuthFlow(
      'https://mcptest.io/oauth/callback?code=auth-code&state=attacker-state',
      { authenticate, redirect: vi.fn() }
    )).rejects.toBeInstanceOf(OAuthStateMismatchError);
    expect(authenticate).not.toHaveBeenCalled();
  });
});

describe('OAuth flight recorder integration', () => {
  it('records successful CIMD selection and authorization redirect', async () => {
    const calls: Array<{ url: string; init?: RequestInit }> = [];

    await beginOAuthFlow(SERVER_URL, {
      redirectUrl: 'https://mcptest.io/oauth/callback',
      redirect: vi.fn(),
      fetchFn: oauthFetch({ supportsCimd: true, supportsDcr: true, calls }),
    });

    const trace = getStoredOAuthTrace(SERVER_URL, sessionStorage);
    expect(trace?.events).toEqual(expect.arrayContaining([
      expect.objectContaining({ type: 'cimd', outcome: 'succeeded' }),
      expect.objectContaining({ type: 'pkce', outcome: 'succeeded' }),
      expect.objectContaining({ type: 'authorization_redirect', outcome: 'redirected' }),
    ]));
    expect(trace?.outcome?.status).toBe('redirected');
  });

  it('records successful DCR with HTTP status and timing', async () => {
    const calls: Array<{ url: string; init?: RequestInit }> = [];

    await beginOAuthFlow(SERVER_URL, {
      redirectUrl: 'https://preview.mcptest.io/oauth/callback',
      redirect: vi.fn(),
      fetchFn: oauthFetch({ supportsCimd: false, supportsDcr: true, calls }),
    });

    const event = getStoredOAuthTrace(SERVER_URL, sessionStorage)?.events.find(
      ({ type }) => type === 'dynamic_client_registration'
    );
    expect(event).toMatchObject({
      outcome: 'succeeded',
      provenance: 'authorization_server',
      request: { method: 'POST', url: `${ISSUER_A}register` },
      response: expect.objectContaining({ status: 200 }),
      timing: expect.objectContaining({ durationMs: expect.any(Number) }),
    });
  });

  it('records when manual pre-registration is required and later selected', async () => {
    const calls: Array<{ url: string; init?: RequestInit }> = [];
    const flowOptions = {
      redirectUrl: 'https://preview.mcptest.io/oauth/callback',
      redirect: vi.fn(),
      fetchFn: oauthFetch({ supportsCimd: false, supportsDcr: false, calls }),
    };

    await expect(beginOAuthFlow(SERVER_URL, flowOptions)).rejects.toBeTruthy();
    expect(getStoredOAuthTrace(SERVER_URL, sessionStorage)).toMatchObject({
      outcome: { status: 'manual_client_required' },
      events: expect.arrayContaining([
        expect.objectContaining({ type: 'pre_registered_client', outcome: 'required' }),
      ]),
    });

    saveManualOAuthClient(SERVER_URL, 'manual-client', 'manual-client-secret');
    await beginOAuthFlow(SERVER_URL, flowOptions);

    const serialized = JSON.stringify(getStoredOAuthTrace(SERVER_URL, sessionStorage));
    expect(getStoredOAuthTrace(SERVER_URL, sessionStorage)?.events).toEqual(expect.arrayContaining([
      expect.objectContaining({ type: 'pre_registered_client', outcome: 'succeeded' }),
    ]));
    expect(serialized).not.toContain('manual-client-secret');
  });

  it('records refresh without serializing old or new tokens', async () => {
    const provider = new BrowserOAuthProvider(SERVER_URL, { redirect: vi.fn() });
    provider.saveDiscoveryState({
      authorizationServerUrl: ISSUER_A,
      authorizationServerMetadata: {
        issuer: ISSUER_A,
        authorization_endpoint: `${ISSUER_A}authorize`,
        token_endpoint: `${ISSUER_A}token`,
        response_types_supported: ['code'],
      },
    });
    provider.saveClientInformation(
      { client_id: 'refresh-client', issuer: ISSUER_A },
      { issuer: ISSUER_A }
    );
    provider.saveTokens({
      access_token: 'old-access-secret',
      refresh_token: 'old-refresh-secret',
      token_type: 'Bearer',
      issuer: ISSUER_A,
    }, { issuer: ISSUER_A });
    const fetchFn = vi.fn(async (_input: RequestInfo | URL, init?: RequestInit) => {
      expect(String(init?.body)).toContain('grant_type=refresh_token');
      return jsonResponse({
        access_token: 'new-access-secret',
        refresh_token: 'new-refresh-secret',
        token_type: 'Bearer',
      });
    });

    await expect(beginOAuthFlow(SERVER_URL, { fetchFn, redirect: vi.fn() })).resolves.toBe('AUTHORIZED');

    const trace = getStoredOAuthTrace(SERVER_URL, sessionStorage);
    expect(trace?.events).toEqual(expect.arrayContaining([
      expect.objectContaining({
        type: 'refresh',
        outcome: 'succeeded',
        request: { method: 'POST', url: `${ISSUER_A}token` },
      }),
    ]));
    const serialized = JSON.stringify(trace);
    expect(serialized).not.toContain('old-access-secret');
    expect(serialized).not.toContain('old-refresh-secret');
    expect(serialized).not.toContain('new-access-secret');
    expect(serialized).not.toContain('new-refresh-secret');
  });

  it('records callback validation failure without exposing code or state', async () => {
    sessionStorage.setItem('oauth_server_url', SERVER_URL);
    new BrowserOAuthProvider(SERVER_URL, { redirect: vi.fn() }).state();

    await expect(completeOAuthFlow(
      'https://mcptest.io/oauth/callback?code=callback-code-secret&state=attacker-state-secret',
      { redirect: vi.fn() }
    )).rejects.toBeInstanceOf(OAuthStateMismatchError);

    const trace = getStoredOAuthTrace(SERVER_URL, sessionStorage);
    expect(trace).toMatchObject({
      outcome: { status: 'failed' },
      events: expect.arrayContaining([
        expect.objectContaining({ type: 'callback', outcome: 'failed' }),
      ]),
    });
    expect(JSON.stringify(trace)).not.toContain('callback-code-secret');
    expect(JSON.stringify(trace)).not.toContain('attacker-state-secret');
  });

  it('records a successful authorization-code exchange without exposing grants or tokens', async () => {
    sessionStorage.setItem('oauth_server_url', SERVER_URL);
    const provider = new BrowserOAuthProvider(SERVER_URL, { redirect: vi.fn() });
    const state = provider.state();
    provider.saveCodeVerifier('callback-verifier-secret');
    provider.saveDiscoveryState({
      authorizationServerUrl: ISSUER_A,
      authorizationServerMetadata: {
        issuer: ISSUER_A,
        authorization_endpoint: `${ISSUER_A}authorize`,
        token_endpoint: `${ISSUER_A}token`,
        response_types_supported: ['code'],
      },
    });
    provider.saveClientInformation(
      { client_id: 'callback-client', issuer: ISSUER_A },
      { issuer: ISSUER_A }
    );
    const fetchFn = vi.fn(async () => jsonResponse({
      access_token: 'callback-access-secret',
      refresh_token: 'callback-refresh-secret',
      token_type: 'Bearer',
    }));

    await completeOAuthFlow(
      `https://mcptest.io/oauth/callback?code=callback-code-secret&state=${state}&iss=${encodeURIComponent(ISSUER_A)}`,
      { fetchFn, redirect: vi.fn() }
    );

    const trace = getStoredOAuthTrace(SERVER_URL, sessionStorage);
    expect(trace?.events).toEqual(expect.arrayContaining([
      expect.objectContaining({ type: 'callback', outcome: 'succeeded' }),
      expect.objectContaining({
        type: 'token_exchange',
        outcome: 'succeeded',
        response: expect.objectContaining({ status: 200 }),
      }),
    ]));
    const serialized = JSON.stringify(trace);
    expect(serialized).not.toContain('callback-code-secret');
    expect(serialized).not.toContain('callback-verifier-secret');
    expect(serialized).not.toContain('callback-access-secret');
    expect(serialized).not.toContain('callback-refresh-secret');
  });

  it('records authorization-server metadata failure as the failing stage', async () => {
    const fetchFn: FetchLike = async () => new Response('Unavailable', { status: 503 });

    await expect(beginOAuthFlow(SERVER_URL, {
      fetchFn,
      redirect: vi.fn(),
    })).rejects.toBeTruthy();

    const trace = getStoredOAuthTrace(SERVER_URL, sessionStorage);
    expect(trace?.outcome?.status).toBe('failed');
    expect(trace?.events).toEqual(expect.arrayContaining([
      expect.objectContaining({
        type: 'authorization_server_metadata',
        outcome: 'failed',
        response: expect.objectContaining({ status: 503 }),
      }),
    ]));
  });
});
