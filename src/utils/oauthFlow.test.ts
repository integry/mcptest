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
  getOAuthPrerequisite,
  isOAuthClientConfigurationRequired,
  loadOAuthAuthorization,
  prepareManualOAuthClient,
  saveManualOAuthClient,
} from './oauthFlow';
import {
  OAUTH_TRACE_REDACTED,
  getStoredOAuthTrace,
  recordOAuthAuthenticationChallenge,
  resumePendingAuthenticatedMcpRetry,
} from './oauthTrace';

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
      issuer: ISSUER_A,
      registeredManually: true,
    }));

    expect(provider.clientInformation({ issuer: ISSUER_A })).toMatchObject({
      client_id: 'manual-client',
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

    saveManualOAuthClient(SERVER_URL, 'manual-client');

    expect(provider.clientInformation({ issuer: ISSUER_A })).toMatchObject({
      client_id: 'manual-client',
      issuer: ISSUER_A,
    });
    expect(provider.clientInformation({ issuer: ISSUER_B })).toBeUndefined();
  });

  it('rejects confidential client secrets without writing them to browser storage', () => {
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

    expect(() => saveManualOAuthClient(
      SERVER_URL,
      'confidential-client',
      'operator-secret'
    )).toThrow(/operator/);
    expect(Array.from({ length: sessionStorage.length }, (_, index) => (
      sessionStorage.getItem(sessionStorage.key(index) || '') || ''
    )).join('\n')).not.toContain('operator-secret');
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
    expect(discover).toHaveBeenCalledWith(
      SERVER_URL,
      expect.objectContaining({ fetchFn: expect.any(Function) })
    );
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

  it('keeps an exact challenge metadata URL only on the current provider instance', () => {
    const challengeSecret = 'challenge-secret';
    const resourceMetadataUrl = `https://mcp.example/.well-known/oauth-protected-resource?token=${challengeSecret}`;
    const provider = new BrowserOAuthProvider(SERVER_URL, { redirect: vi.fn() });

    provider.saveDiscoveryState({
      authorizationServerUrl: ISSUER_A,
      resourceMetadataUrl,
      resourceMetadata: {
        resource: SERVER_URL,
        authorization_servers: [ISSUER_A],
      },
    });

    expect(provider.discoveryState()?.resourceMetadataUrl).toBe(resourceMetadataUrl);
    expect(new BrowserOAuthProvider(SERVER_URL, { redirect: vi.fn() })
      .discoveryState()?.resourceMetadataUrl).toBeUndefined();
    const allSessionStorage = Array.from({ length: sessionStorage.length }, (_, index) => {
      const key = sessionStorage.key(index) || '';
      return `${key}:${sessionStorage.getItem(key) || ''}`;
    }).join('\n');
    expect(allSessionStorage).not.toContain(challengeSecret);
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
  it('retains pending retry ownership whenever an authorized outcome is deferred', async () => {
    await expect(beginOAuthFlow(SERVER_URL, {
      authenticate: vi.fn().mockResolvedValue('AUTHORIZED'),
      redirect: vi.fn(),
      deferAuthorizedTraceOutcome: true,
    })).resolves.toBe('AUTHORIZED');

    expect(getStoredOAuthTrace(SERVER_URL, sessionStorage)).toMatchObject({
      authenticatedMcpRetry: { phase: 'pending' },
    });
    expect(getStoredOAuthTrace(SERVER_URL, sessionStorage)?.outcome).toBeUndefined();
  });

  it('defers challenge-driven synchronous authorization until the MCP retry completes', async () => {
    recordOAuthAuthenticationChallenge({
      targetUrl: SERVER_URL,
      status: 401,
      source: 'target',
      route: 'direct',
      storage: sessionStorage,
    });

    await expect(beginOAuthFlow(SERVER_URL, {
      authenticate: vi.fn().mockResolvedValue('AUTHORIZED'),
      redirect: vi.fn(),
      deferAuthorizedTraceOutcome: true,
    })).resolves.toBe('AUTHORIZED');

    const trace = getStoredOAuthTrace(SERVER_URL, sessionStorage);
    expect(trace).toMatchObject({
      authenticatedMcpRetry: { phase: 'pending' },
    });
    expect(trace?.outcome).toBeUndefined();
  });

  it('keeps a fresh deferred redirect open through callback until the MCP retry completes', async () => {
    let state = '';
    await expect(beginOAuthFlow(SERVER_URL, {
      authenticate: vi.fn(async (provider: OAuthClientProvider) => {
        state = await provider.state();
        await provider.redirectToAuthorization(
          new URL(`${ISSUER_A}authorize?state=${state}`)
        );
        return 'REDIRECT' as const;
      }),
      redirect: vi.fn(),
      deferAuthorizedTraceOutcome: true,
    })).resolves.toBe('REDIRECT');

    const redirectedTrace = getStoredOAuthTrace(SERVER_URL, sessionStorage);
    expect(redirectedTrace).toMatchObject({
      authenticatedMcpRetry: { phase: 'awaiting_callback' },
    });
    expect(redirectedTrace?.outcome).toBeUndefined();
    expect(redirectedTrace?.events.some(({ type }) => type === 'terminal_outcome')).toBe(false);

    await completeOAuthFlow(
      `https://mcptest.io/oauth/callback?code=callback-code&state=${state}`,
      { authenticate: vi.fn().mockResolvedValue('AUTHORIZED') }
    );

    const callbackTrace = getStoredOAuthTrace(SERVER_URL, sessionStorage);
    expect(callbackTrace).toMatchObject({
      authenticatedMcpRetry: { phase: 'pending' },
    });
    expect(callbackTrace?.outcome).toBeUndefined();
    expect(callbackTrace?.events.some(({ type }) => type === 'terminal_outcome')).toBe(false);

    const retry = resumePendingAuthenticatedMcpRetry({
      targetUrl: SERVER_URL,
      storage: sessionStorage,
      operation: 'fresh deferred redirect',
    });
    expect(retry?.succeed({
      route: 'direct',
      result: {
        url: SERVER_URL,
        transportType: 'streamable-http',
        protocolEra: 'modern',
      },
    })).toBe(true);

    const completedTrace = getStoredOAuthTrace(SERVER_URL, sessionStorage);
    expect(completedTrace?.outcome?.status).toBe('authorized');
    expect(completedTrace?.events.filter(({ type }) => type === 'terminal_outcome')).toHaveLength(1);
  });

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

  it('preserves a redirect callback failure after successful discovery', async () => {
    const calls: Array<{ url: string; init?: RequestInit }> = [];
    const redirectError = new Error('Redirect callback failed');
    let caught: unknown;

    try {
      await beginOAuthFlow(SERVER_URL, {
        redirectUrl: 'https://mcptest.io/oauth/callback',
        redirect: vi.fn(() => { throw redirectError; }),
        fetchFn: oauthFetch({ supportsCimd: true, supportsDcr: true, calls }),
      });
    } catch (error) {
      caught = error;
    }

    expect(caught).toBe(redirectError);
    expect(getOAuthPrerequisite(caught)).toBeUndefined();
    expect(getStoredOAuthTrace(SERVER_URL, sessionStorage)).toMatchObject({
      outcome: { status: 'failed' },
      events: expect.arrayContaining([
        expect.objectContaining({
          type: 'authorization_server_metadata',
          outcome: 'succeeded',
        }),
        expect.objectContaining({
          type: 'authorization_redirect',
          outcome: 'redirected',
        }),
      ]),
    });
  });

  it('preserves a storage failure after successful discovery', async () => {
    const calls: Array<{ url: string; init?: RequestInit }> = [];
    const storageError = new Error('Discovery storage failed');
    const storage = {
      getItem: (key: string) => sessionStorage.getItem(key),
      setItem: (key: string, value: string) => {
        if (key.startsWith('mcp_oauth_v2:') && value.includes('"discovery"')) {
          throw storageError;
        }
        sessionStorage.setItem(key, value);
      },
      removeItem: (key: string) => sessionStorage.removeItem(key),
    };
    let caught: unknown;

    try {
      await beginOAuthFlow(SERVER_URL, {
        storage,
        redirectUrl: 'https://mcptest.io/oauth/callback',
        redirect: vi.fn(),
        fetchFn: oauthFetch({ supportsCimd: true, supportsDcr: true, calls }),
      });
    } catch (error) {
      caught = error;
    }

    expect(caught).toBe(storageError);
    expect(getOAuthPrerequisite(caught)).toBeUndefined();
    expect(getStoredOAuthTrace(SERVER_URL, sessionStorage)).toMatchObject({
      outcome: { status: 'failed' },
      events: expect.arrayContaining([
        expect.objectContaining({
          type: 'authorization_server_metadata',
          outcome: 'succeeded',
        }),
      ]),
    });
  });

  it('supersedes a redirected terminal outcome when the callback resumes the trace', async () => {
    let state = '';
    await beginOAuthFlow(SERVER_URL, {
      authenticate: vi.fn(async (provider: OAuthClientProvider) => {
        state = await provider.state();
        await provider.redirectToAuthorization(
          new URL(`${ISSUER_A}authorize?state=${state}`)
        );
        return 'REDIRECT' as const;
      }),
      redirect: vi.fn(),
    });

    expect(getStoredOAuthTrace(SERVER_URL, sessionStorage)?.outcome?.status).toBe('redirected');

    await completeOAuthFlow(
      `https://mcptest.io/oauth/callback?code=callback-code&state=${state}`,
      { authenticate: vi.fn().mockResolvedValue('AUTHORIZED') }
    );

    const completedTrace = getStoredOAuthTrace(SERVER_URL, sessionStorage);
    expect(completedTrace?.outcome?.status).toBe('authorized');
    expect(completedTrace?.events.filter(({ type }) => type === 'terminal_outcome').map(
      ({ outcome }) => outcome
    )).toEqual(['skipped', 'succeeded']);
    expect(completedTrace?.events[completedTrace.events.length - 1]).toMatchObject({
      type: 'terminal_outcome',
      outcome: 'succeeded',
    });
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
      outcome: { status: 'pre_registered_client_required' },
      events: expect.arrayContaining([
        expect.objectContaining({ type: 'pre_registered_client', outcome: 'required' }),
      ]),
    });

    saveManualOAuthClient(SERVER_URL, 'manual-client');
    await beginOAuthFlow(SERVER_URL, flowOptions);

    const serialized = JSON.stringify(getStoredOAuthTrace(SERVER_URL, sessionStorage));
    expect(getStoredOAuthTrace(SERVER_URL, sessionStorage)?.events).toEqual(expect.arrayContaining([
      expect.objectContaining({ type: 'pre_registered_client', outcome: 'succeeded' }),
    ]));
    expect(serialized).not.toContain('client_secret');
  });

  it('carries challenge retry ownership through manual client continuation and callback', async () => {
    const initialTrace = recordOAuthAuthenticationChallenge({
      targetUrl: SERVER_URL,
      status: 401,
      source: 'target',
      route: 'direct',
      storage: sessionStorage,
    });
    const traceId = initialTrace.snapshot().traceId;
    initialTrace.record({
      type: 'dynamic_client_registration',
      outcome: 'failed',
      provenance: 'authorization_server',
      route: 'direct',
      explanation: 'Dynamic client registration was rejected.',
      request: { method: 'POST', url: `${ISSUER_A}register` },
      response: { status: 400 },
    });
    await expect(beginOAuthFlow(SERVER_URL, {
      authenticate: vi.fn().mockRejectedValue(
        new Error('Authorization server does not support dynamic client registration')
      ),
      deferAuthorizedTraceOutcome: true,
    })).rejects.toThrow();

    const manualRequiredTrace = getStoredOAuthTrace(SERVER_URL, sessionStorage);
    expect(manualRequiredTrace).toMatchObject({
      traceId,
      outcome: { status: 'pre_registered_client_required' },
      events: expect.arrayContaining([
        expect.objectContaining({ type: 'target_challenge', outcome: 'challenged' }),
        expect.objectContaining({ type: 'dynamic_client_registration', outcome: 'failed' }),
        expect.objectContaining({ type: 'pre_registered_client', outcome: 'required' }),
      ]),
    });
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
    saveManualOAuthClient(SERVER_URL, 'manual-client');

    let state = '';
    await expect(beginOAuthFlow(SERVER_URL, {
      authenticate: vi.fn(async (provider: OAuthClientProvider) => {
        expect(provider.clientInformation?.({ issuer: ISSUER_A })).toMatchObject({
          client_id: 'manual-client',
        });
        state = await provider.state();
        await provider.redirectToAuthorization(
          new URL(`${ISSUER_A}authorize?client_id=manual-client&state=${state}`)
        );
        return 'REDIRECT' as const;
      }),
      redirect: vi.fn(),
      deferAuthorizedTraceOutcome: true,
    })).resolves.toBe('REDIRECT');
    expect(getStoredOAuthTrace(SERVER_URL, sessionStorage)).toMatchObject({
      traceId,
      authenticatedMcpRetry: { phase: 'awaiting_callback' },
    });

    await completeOAuthFlow(
      `https://mcptest.io/oauth/callback?code=manual-code&state=${state}`,
      {
        authenticate: vi.fn(async (provider: OAuthClientProvider) => {
          await provider.saveTokens({
            access_token: 'manual-access-token',
            token_type: 'Bearer',
            issuer: ISSUER_A,
          }, { issuer: ISSUER_A });
          return 'AUTHORIZED' as const;
        }),
      }
    );
    expect(getStoredOAuthTrace(SERVER_URL, sessionStorage)).toMatchObject({
      traceId,
      authenticatedMcpRetry: { phase: 'pending' },
    });

    const retry = resumePendingAuthenticatedMcpRetry({
      targetUrl: SERVER_URL,
      storage: sessionStorage,
      operation: 'manual client continuation',
    });
    expect(retry?.succeed({
      route: 'direct',
      result: {
        url: SERVER_URL,
        transportType: 'streamable-http',
        protocolEra: 'modern',
      },
    })).toBe(true);
    const completedTrace = getStoredOAuthTrace(SERVER_URL, sessionStorage);
    expect(completedTrace).toMatchObject({
      traceId,
      outcome: { status: 'authorized' },
      events: expect.arrayContaining([
        expect.objectContaining({ type: 'target_challenge', outcome: 'challenged' }),
        expect.objectContaining({ type: 'dynamic_client_registration', outcome: 'failed' }),
        expect.objectContaining({ type: 'pre_registered_client', outcome: 'required' }),
        expect.objectContaining({ type: 'pre_registered_client', outcome: 'succeeded' }),
        expect.objectContaining({ type: 'authorization_redirect', outcome: 'redirected' }),
        expect.objectContaining({ type: 'callback', outcome: 'succeeded' }),
        expect.objectContaining({ type: 'mcp_retry', outcome: 'succeeded' }),
      ]),
    });
    expect(completedTrace?.events.filter(({ type }) => type === 'terminal_outcome').map(
      ({ outcome }) => outcome
    )).toEqual(['skipped', 'succeeded']);
    const orderedStages = completedTrace?.events.map(({ type, outcome }) => `${type}:${outcome}`) || [];
    const expectedOrder = [
      'target_challenge:challenged',
      'dynamic_client_registration:failed',
      'pre_registered_client:required',
      'pre_registered_client:succeeded',
      'authorization_redirect:redirected',
      'callback:succeeded',
      'mcp_retry:succeeded',
      'terminal_outcome:succeeded',
    ];
    const stageIndexes = expectedOrder.map((stage) => orderedStages.indexOf(stage));
    expect(stageIndexes).not.toContain(-1);
    for (let index = 1; index < expectedOrder.length; index += 1) {
      expect(stageIndexes[index]).toBeGreaterThan(stageIndexes[index - 1]);
    }
    expect(JSON.stringify(completedTrace)).not.toContain('client_secret');
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
      }, {
        headers: {
          'WWW-Authenticate': 'Bearer realm="The previous credential was old-access-secret"',
        },
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
    expect(trace?.events.find(({ type }) => type === 'refresh')?.response?.headers).toMatchObject({
      'www-authenticate': expect.stringContaining(OAUTH_TRACE_REDACTED),
    });
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

  it('records a malformed HTTP 200 token response as a failed token exchange', async () => {
    sessionStorage.setItem('oauth_server_url', SERVER_URL);
    const provider = new BrowserOAuthProvider(SERVER_URL, { redirect: vi.fn() });
    const state = provider.state();
    provider.saveCodeVerifier('malformed-token-verifier');
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

    await expect(completeOAuthFlow(
      `https://mcptest.io/oauth/callback?code=malformed-token-code&state=${state}&iss=${encodeURIComponent(ISSUER_A)}`,
      {
        fetchFn: vi.fn(async () => jsonResponse({ token_type: 'Bearer' })),
        redirect: vi.fn(),
      }
    )).rejects.toBeTruthy();

    const trace = getStoredOAuthTrace(SERVER_URL, sessionStorage);
    expect(trace?.events).toEqual(expect.arrayContaining([
      expect.objectContaining({
        type: 'token_exchange',
        outcome: 'failed',
        response: expect.objectContaining({ status: 200 }),
        explanation: expect.stringContaining('rejected the response'),
      }),
    ]));
    expect(trace?.outcome?.status).toBe('failed');
  });

  it('records authorization-server metadata failure as the failing stage', async () => {
    const fetchFn: FetchLike = async () => new Response('Unavailable', { status: 503 });

    await expect(beginOAuthFlow(SERVER_URL, {
      fetchFn,
      redirect: vi.fn(),
    })).rejects.toBeTruthy();

    const trace = getStoredOAuthTrace(SERVER_URL, sessionStorage);
    expect(trace?.outcome?.status).toBe('transient_discovery_failure');
    expect(trace?.events).toEqual(expect.arrayContaining([
      expect.objectContaining({
        type: 'authorization_server_metadata',
        outcome: 'failed',
        response: expect.objectContaining({ status: 503 }),
      }),
    ]));
  });

  it('records malformed HTTP 200 metadata as a failed discovery stage', async () => {
    const fetchFn: FetchLike = async (input) => {
      const url = String(input);
      if (url.includes('/.well-known/oauth-protected-resource')) {
        return jsonResponse({
          resource: SERVER_URL,
          authorization_servers: [ISSUER_A],
        });
      }
      return jsonResponse({ issuer: 42 });
    };

    await expect(beginOAuthFlow(SERVER_URL, {
      fetchFn,
      redirect: vi.fn(),
    })).rejects.toBeTruthy();

    const trace = getStoredOAuthTrace(SERVER_URL, sessionStorage);
    expect(trace?.events).toEqual(expect.arrayContaining([
      expect.objectContaining({
        type: 'protected_resource_metadata',
        outcome: 'succeeded',
      }),
      expect.objectContaining({
        type: 'authorization_server_metadata',
        outcome: 'failed',
        response: expect.objectContaining({ status: 200 }),
        explanation: expect.stringContaining('rejected the response'),
      }),
    ]));
    expect(trace?.outcome?.status).toBe('discovery_blocked_invalid');
  });
});

describe('OAuth provider interoperability matrix', () => {
  const authorizationMetadata = (
    issuer: string,
    capabilities: {
      cimd?: boolean;
      registrationEndpoint?: string;
      tokenEndpointAuthMethods?: string[];
    } = {}
  ) => ({
    issuer,
    authorization_endpoint: `${issuer.replace(/\/$/, '')}/authorize`,
    token_endpoint: `${issuer.replace(/\/$/, '')}/token`,
    response_types_supported: ['code'],
    code_challenge_methods_supported: ['S256'],
    client_id_metadata_document_supported: capabilities.cimd || false,
    ...(capabilities.tokenEndpointAuthMethods
      ? { token_endpoint_auth_methods_supported: capabilities.tokenEndpointAuthMethods }
      : {}),
    ...(capabilities.registrationEndpoint
      ? { registration_endpoint: capabilities.registrationEndpoint }
      : {}),
  });

  it('classifies explicit Figma approval evidence ahead of an invalid-client-metadata code', async () => {
    const target = 'https://mcp.figma.com/mcp';
    const resourceMetadataUrl = 'https://mcp.figma.com/.well-known/oauth-protected-resource';
    const issuer = 'https://api.figma.com';
    const registrationEndpoint = 'https://api.figma.com/v1/oauth/mcp/register';
    const calls: string[] = [];
    const fetchFn: FetchLike = async (input, init) => {
      const url = String(input);
      calls.push(`${init?.method || 'GET'} ${url}`);
      if (url === resourceMetadataUrl) {
        return jsonResponse({
          resource: target,
          authorization_servers: [issuer],
          scopes_supported: ['file_content:read'],
        });
      }
      if (url === 'https://api.figma.com/.well-known/oauth-authorization-server') {
        return jsonResponse(authorizationMetadata(issuer, { registrationEndpoint }));
      }
      if (url === registrationEndpoint && init?.method === 'POST') {
        return jsonResponse({
          error: 'invalid_client_metadata',
          error_description: 'This software requires provider approval',
        }, { status: 403 });
      }
      return new Response('Not found', { status: 404 });
    };

    let caught: unknown;
    try {
      await beginOAuthFlow(target, {
        resourceMetadataUrl,
        redirectUrl: 'https://mcptest.io/oauth/callback',
        fetchFn,
        redirect: vi.fn(),
      });
    } catch (error) {
      caught = error;
    }

    expect(calls).toContain(`GET ${resourceMetadataUrl}`);
    expect(calls).toContain(`POST ${registrationEndpoint}`);
    expect(getOAuthPrerequisite(caught)).toMatchObject({
      kind: 'provider_approval_required',
      providerName: 'Figma',
      canConfigureClient: false,
      documentationUrl: 'https://developers.figma.com/docs/figma-mcp-server/remote-server-installation/',
      httpStatus: 403,
    });
    expect(isOAuthClientConfigurationRequired(caught)).toBe(false);
    const trace = getStoredOAuthTrace(target, sessionStorage);
    expect(trace?.outcome?.status).toBe('provider_approval_required');
    expect(trace?.events).toEqual(expect.arrayContaining([
      expect.objectContaining({
        type: 'dynamic_client_registration',
        outcome: 'failed',
        response: expect.objectContaining({
          status: 403,
          metadata: expect.objectContaining({ error: 'invalid_client_metadata' }),
        }),
      }),
    ]));
  });

  it('classifies Figma bare HTTP 403 registration rejection using provider policy', async () => {
    const target = 'https://mcp.figma.com/mcp';
    const issuer = 'https://api.figma.com';
    const resourceMetadataUrl = 'https://mcp.figma.com/.well-known/oauth-protected-resource';
    const registrationEndpoint = 'https://api.figma.com/v1/oauth/mcp/register';
    const fetchFn: FetchLike = async (input, init) => {
      const url = String(input);
      if (url === resourceMetadataUrl) {
        return jsonResponse({
          resource: target,
          authorization_servers: [issuer],
          scopes_supported: ['mcp:connect'],
        });
      }
      if (url === 'https://api.figma.com/.well-known/oauth-authorization-server') {
        return jsonResponse(authorizationMetadata(issuer, { registrationEndpoint }));
      }
      if (url === registrationEndpoint && init?.method === 'POST') {
        return new Response('Forbidden', {
          status: 403,
          headers: { 'Content-Type': 'application/json' },
        });
      }
      return new Response('Not found', { status: 404 });
    };

    let caught: unknown;
    try {
      await beginOAuthFlow(target, { resourceMetadataUrl, fetchFn, redirect: vi.fn() });
    } catch (error) {
      caught = error;
    }

    expect(getOAuthPrerequisite(caught)).toMatchObject({
      kind: 'provider_approval_required',
      providerName: 'Figma',
      canConfigureClient: false,
      httpStatus: 403,
      explanation: expect.stringContaining('not yet an approved Figma MCP client'),
    });
    expect(getStoredOAuthTrace(target, sessionStorage)?.outcome?.status)
      .toBe('provider_approval_required');
  });

  it.each([
    [
      'rate-limited',
      429,
      { error: 'temporarily_unavailable', error_description: 'Too many registration requests' },
      'rate-limited dynamic client registration',
    ],
    [
      'server-error',
      503,
      { error: 'temporarily_unavailable', error_description: 'Registration service unavailable' },
      'server error HTTP 503',
    ],
    [
      'invalid-metadata',
      400,
      { error: 'invalid_client_metadata', error_description: 'redirect_uris must contain one entry' },
      'rejected the submitted dynamic client metadata',
    ],
    [
      'ambiguous-invalid-client-metadata',
      400,
      { error: 'invalid_client_metadata', error_description: 'client_uri is not approved' },
      'rejected the submitted dynamic client metadata',
    ],
    [
      'ambiguous-redirect-rejection',
      400,
      { error: 'invalid_redirect_uri', error_description: 'redirect URI is not approved' },
      'rejected the submitted dynamic client metadata',
    ],
    [
      'malformed-response',
      400,
      'not-json',
      'malformed error response',
    ],
    [
      'generic-rejection',
      401,
      { error: 'access_denied', error_description: 'Registration request rejected' },
      'did not indicate a provider approval or allow-list policy',
    ],
  ])('does not classify a %s DCR failure as provider approval', async (
    slug,
    status,
    registrationBody,
    expectedExplanation
  ) => {
    const target = `https://mcp-${slug}.example/mcp`;
    const resourceMetadataUrl = `https://mcp-${slug}.example/.well-known/oauth-protected-resource`;
    const issuer = `https://issuer-${slug}.example`;
    const registrationEndpoint = `${issuer}/register`;
    const fetchFn: FetchLike = async (input, init) => {
      const url = String(input);
      if (url === resourceMetadataUrl) {
        return jsonResponse({ resource: target, authorization_servers: [issuer] });
      }
      if (url === `${issuer}/.well-known/oauth-authorization-server`) {
        return jsonResponse(authorizationMetadata(issuer, { registrationEndpoint }));
      }
      if (url === registrationEndpoint && init?.method === 'POST') {
        return typeof registrationBody === 'string'
          ? new Response(registrationBody, { status })
          : jsonResponse(registrationBody, { status });
      }
      return new Response('Not found', { status: 404 });
    };

    let caught: unknown;
    try {
      await beginOAuthFlow(target, {
        resourceMetadataUrl,
        fetchFn,
        redirect: vi.fn(),
      });
    } catch (error) {
      caught = error;
    }

    expect(getOAuthPrerequisite(caught)).toMatchObject({
      kind: 'discovery_blocked_invalid',
      canConfigureClient: true,
      configurationMode: 'browser-public',
      httpStatus: status,
      explanation: expect.stringContaining(expectedExplanation),
    });
    expect(getStoredOAuthTrace(target, sessionStorage)).toMatchObject({
      outcome: { status: 'discovery_blocked_invalid' },
      events: expect.arrayContaining([
        expect.objectContaining({
          type: 'dynamic_client_registration',
          outcome: 'failed',
          response: expect.objectContaining({ status }),
        }),
      ]),
    });
  });

  it('falls Slack protected-resource discovery back from the MCP path to root', async () => {
    const target = 'https://mcp.slack.com/mcp';
    const issuer = 'https://slack.com';
    const calls: string[] = [];
    const fetchFn: FetchLike = async (input) => {
      const url = String(input);
      calls.push(url);
      if (url === 'https://mcp.slack.com/.well-known/oauth-protected-resource/mcp') {
        return new Response('Not found', { status: 404 });
      }
      if (url === 'https://mcp.slack.com/.well-known/oauth-protected-resource') {
        return jsonResponse({
          resource: target,
          authorization_servers: [issuer],
          scopes_supported: ['channels:read', 'chat:write'],
        });
      }
      if (url === 'https://slack.com/.well-known/oauth-authorization-server') {
        return jsonResponse(authorizationMetadata(issuer));
      }
      return new Response('Not found', { status: 404 });
    };

    let caught: unknown;
    try {
      await beginOAuthFlow(target, { fetchFn, redirect: vi.fn() });
    } catch (error) {
      caught = error;
    }

    expect(calls.slice(0, 2)).toEqual([
      'https://mcp.slack.com/.well-known/oauth-protected-resource/mcp',
      'https://mcp.slack.com/.well-known/oauth-protected-resource',
    ]);
    expect(getOAuthPrerequisite(caught)).toMatchObject({
      kind: 'pre_registered_client_required',
      providerName: 'Slack',
      canConfigureClient: false,
      configurationMode: 'operator-confidential',
      requiredScopes: ['channels:read', 'chat:write'],
      publicClientSecretSupported: 'unknown',
    });
    expect(getStoredOAuthTrace(target, sessionStorage)?.outcome?.status)
      .toBe('pre_registered_client_required');
  });

  it.each([
    [
      'Slack',
      'https://mcp.slack.com/mcp',
      'https://slack.com',
      ['none'],
      true,
    ],
    [
      'Figma',
      'https://mcp.figma.com/mcp',
      'https://api.figma.com',
      ['client_secret_post'],
      false,
    ],
  ])('uses %s token endpoint auth metadata instead of conflicting host guidance', async (
    providerName,
    target,
    issuer,
    tokenEndpointAuthMethods,
    expectedSupport
  ) => {
    const fetchFn: FetchLike = async (input) => {
      const url = String(input);
      if (url.includes('/.well-known/oauth-protected-resource')) {
        return jsonResponse({ resource: target, authorization_servers: [issuer] });
      }
      if (url.includes('/.well-known/oauth-authorization-server')) {
        return jsonResponse(authorizationMetadata(issuer, { tokenEndpointAuthMethods }));
      }
      return new Response('Not found', { status: 404 });
    };

    let caught: unknown;
    try {
      await beginOAuthFlow(target, { fetchFn, redirect: vi.fn() });
    } catch (error) {
      caught = error;
    }

    expect(getOAuthPrerequisite(caught)).toMatchObject({
      providerName,
      kind: 'pre_registered_client_required',
      publicClientSecretSupported: expectedSupport,
    });
  });

  it('preserves GitHub /mcp/ identity and proxies only non-CORS metadata discovery', async () => {
    const target = 'https://api.githubcopilot.com/mcp/';
    const resourceMetadataUrl = 'https://api.githubcopilot.com/.well-known/oauth-protected-resource/mcp/';
    const issuer = 'https://github.com/login/oauth';
    const authorizationMetadataUrl = 'https://github.com/.well-known/oauth-authorization-server/login/oauth';
    const directCalls: string[] = [];
    const proxyCalls: string[] = [];
    const directFetch: FetchLike = async (input) => {
      const url = String(input);
      directCalls.push(url);
      if (url === resourceMetadataUrl) {
        return jsonResponse({ resource: target, authorization_servers: [issuer] });
      }
      if (url === authorizationMetadataUrl) throw new TypeError('Failed to fetch');
      return new Response('Not found', { status: 404 });
    };
    const proxyFetch: FetchLike = async (input, init) => {
      const proxyUrl = new URL(String(input));
      proxyCalls.push(proxyUrl.searchParams.get('target') || '');
      expect(new Headers(init?.headers).get('authorization')).toBe('Bearer firebase-token');
      return jsonResponse(authorizationMetadata(issuer), {
        headers: { 'X-MCP-Proxy-Response-Source': 'target' },
      });
    };

    let caught: unknown;
    try {
      await beginOAuthFlow(target, {
        resourceMetadataUrl,
        fetchFn: directFetch,
        discoveryProxy: {
          url: 'https://proxy.mcptest.test/',
          authorizationToken: 'firebase-token',
          fetchFn: proxyFetch,
        },
        redirect: vi.fn(),
      });
    } catch (error) {
      caught = error;
    }

    expect(directCalls).toContain(resourceMetadataUrl);
    expect(proxyCalls).toEqual([authorizationMetadataUrl]);
    expect(getOAuthPrerequisite(caught)).toMatchObject({
      kind: 'pre_registered_client_required',
      providerName: 'GitHub',
      canConfigureClient: false,
      hostedProvider: 'github',
      supportsBearerToken: true,
    });
    const trace = getStoredOAuthTrace(target, sessionStorage);
    expect(trace?.targetUrl).toBe(target);
    expect(trace?.events).toEqual(expect.arrayContaining([
      expect.objectContaining({
        type: 'authorization_server_metadata',
        outcome: 'failed',
        route: 'direct',
        request: { method: 'GET', url: authorizationMetadataUrl },
      }),
      expect.objectContaining({
        type: 'authorization_server_metadata',
        route: 'proxy',
        request: { method: 'GET', url: authorizationMetadataUrl },
      }),
    ]));
  });

  it('never sends a GitHub registration request even when metadata advertises a bogus endpoint', async () => {
    const target = 'https://api.githubcopilot.com/mcp/';
    const issuer = 'https://github.com/login/oauth';
    const calls: string[] = [];
    const fetchFn: FetchLike = async (input, init) => {
      const url = String(input);
      calls.push(`${init?.method || 'GET'} ${url}`);
      if (url.includes('/.well-known/oauth-protected-resource')) {
        return jsonResponse({ resource: target, authorization_servers: [issuer] });
      }
      if (url.includes('/.well-known/oauth-authorization-server')) {
        return jsonResponse(authorizationMetadata(issuer, {
          registrationEndpoint: 'https://github.com/register',
        }));
      }
      throw new Error(`Unexpected network request: ${url}`);
    };

    let caught: unknown;
    try {
      await beginOAuthFlow(target, { fetchFn, redirect: vi.fn() });
    } catch (error) {
      caught = error;
    }

    expect(calls).not.toContain('POST https://github.com/register');
    expect(getOAuthPrerequisite(caught)).toMatchObject({
      kind: 'pre_registered_client_required',
      providerName: 'GitHub',
      supportsBearerToken: true,
      canConfigureClient: false,
    });
  });

  it('does not enable GitHub PAT guidance from an unknown target that advertises GitHub', async () => {
    const target = 'https://attacker.example/mcp';
    const issuer = 'https://github.com/login/oauth';
    const registrationEndpoint = 'https://github.com/register';
    const calls: string[] = [];
    const fetchFn: FetchLike = async (input, init) => {
      const url = String(input);
      calls.push(`${init?.method || 'GET'} ${url}`);
      if (url.includes('/.well-known/oauth-protected-resource')) {
        return jsonResponse({ resource: target, authorization_servers: [issuer] });
      }
      if (url.includes('/.well-known/oauth-authorization-server')) {
        return jsonResponse(authorizationMetadata(issuer, { registrationEndpoint }));
      }
      if (url === registrationEndpoint && init?.method === 'POST') {
        return new Response(JSON.stringify({ error: 'access_denied' }), {
          status: 403,
          headers: { 'Content-Type': 'application/json' },
        });
      }
      throw new Error(`Unexpected network request: ${url}`);
    };

    let caught: unknown;
    try {
      await beginOAuthFlow(target, { fetchFn, redirect: vi.fn() });
    } catch (error) {
      caught = error;
    }

    expect(calls).toContain(`POST ${registrationEndpoint}`);
    const prerequisite = getOAuthPrerequisite(caught);
    expect(prerequisite?.providerName).toBe('github.com');
    expect(prerequisite).not.toHaveProperty('supportsBearerToken');
    expect(prerequisite).not.toHaveProperty('bearerTokenName');
    expect(prerequisite?.providerName).not.toBe('GitHub');
  });

  it('sanitizes a query-bearing challenge URL after the direct CORS failure', async () => {
    const target = 'https://challenge-query.example/mcp';
    const challengeSecret = 'challenge-secret';
    const resourceMetadataUrl = `https://challenge-query.example/.well-known/oauth-protected-resource?token=${challengeSecret}&tenant=acme`;
    const issuer = 'https://issuer.challenge-query.example';
    const proxyTargets: string[] = [];
    recordOAuthAuthenticationChallenge({
      targetUrl: target,
      status: 401,
      source: 'target',
      route: 'direct',
      storage: sessionStorage,
      method: 'POST',
      requestUrl: target,
      responseHeaders: {
        'www-authenticate': `Bearer resource_metadata="${resourceMetadataUrl}"`,
      },
    });
    const directFetch: FetchLike = async (input) => {
      const url = String(input);
      if (url === resourceMetadataUrl) throw new TypeError('Failed to fetch');
      if (url === `${issuer}/.well-known/oauth-authorization-server`) {
        return jsonResponse(authorizationMetadata(issuer));
      }
      return new Response('Not found', { status: 404 });
    };
    const proxyFetch: FetchLike = async (input) => {
      const proxyUrl = new URL(String(input));
      proxyTargets.push(proxyUrl.searchParams.get('target') || '');
      return jsonResponse({ resource: target, authorization_servers: [issuer] }, {
        headers: { 'X-MCP-Proxy-Response-Source': 'target' },
      });
    };

    await expect(beginOAuthFlow(target, {
      resourceMetadataUrl,
      fetchFn: directFetch,
      discoveryProxy: {
        url: 'https://proxy.mcptest.test/',
        authorizationToken: 'firebase-token',
        fetchFn: proxyFetch,
      },
      redirect: vi.fn(),
    })).rejects.toBeTruthy();

    expect(proxyTargets).toEqual([resourceMetadataUrl]);
    const trace = getStoredOAuthTrace(target, sessionStorage);
    const directFailure = trace?.events.find((event) => (
      event.type === 'protected_resource_metadata'
      && event.outcome === 'failed'
      && event.route === 'direct'
    ));
    expect(new URL(directFailure?.request?.url || '').searchParams.get('token'))
      .toBe(OAUTH_TRACE_REDACTED);
    expect(new URL(directFailure?.request?.url || '').searchParams.get('tenant')).toBe('acme');
    expect(JSON.stringify(trace)).not.toContain(challengeSecret);
    const allSessionStorage = Array.from({ length: sessionStorage.length }, (_, index) => {
      const key = sessionStorage.key(index) || '';
      return `${key}:${sessionStorage.getItem(key) || ''}`;
    }).join('\n');
    expect(allSessionStorage).not.toContain(challengeSecret);
  });

  it('records a rejected proxy fetch with proxy provenance and no duplicate direct failure', async () => {
    const target = 'https://proxy-transport.example/mcp';
    const resourceMetadataUrl = 'https://proxy-transport.example/.well-known/oauth-protected-resource';
    const issuer = 'https://issuer.proxy-transport.example';
    const authorizationMetadataUrl = `${issuer}/.well-known/oauth-authorization-server`;
    const directFetch: FetchLike = async (input) => {
      const url = String(input);
      if (url === resourceMetadataUrl) {
        return jsonResponse({ resource: target, authorization_servers: [issuer] });
      }
      if (url === authorizationMetadataUrl) throw new TypeError('Direct CORS failure');
      return new Response('Not found', { status: 404 });
    };
    const proxyFetch: FetchLike = async () => {
      throw new TypeError('Proxy transport failure');
    };

    await expect(beginOAuthFlow(target, {
      resourceMetadataUrl,
      fetchFn: directFetch,
      discoveryProxy: {
        url: 'https://proxy.mcptest.test/',
        authorizationToken: 'firebase-token',
        fetchFn: proxyFetch,
      },
      redirect: vi.fn(),
    })).rejects.toBeTruthy();

    const failures = getStoredOAuthTrace(target, sessionStorage)?.events.filter((event) => (
      event.type === 'authorization_server_metadata' && event.outcome === 'failed'
    ));
    expect(failures).toHaveLength(2);
    expect(failures).toEqual([
      expect.objectContaining({
        provenance: 'authorization_server',
        route: 'direct',
        request: { method: 'GET', url: authorizationMetadataUrl },
      }),
      expect.objectContaining({
        provenance: 'authenticated_proxy',
        route: 'proxy',
        request: { method: 'GET', url: authorizationMetadataUrl },
      }),
    ]);
  });

  it('stops at a proxy-owned discovery response instead of treating it as provider metadata', async () => {
    const target = 'https://noncors.example/mcp';
    const resourceMetadataUrl = 'https://noncors.example/.well-known/oauth-protected-resource';
    const issuer = 'https://issuer.noncors.example';
    const directFetch: FetchLike = async (input) => {
      const url = String(input);
      if (url === resourceMetadataUrl) {
        return jsonResponse({ resource: target, authorization_servers: [issuer] });
      }
      throw new TypeError('Failed to fetch');
    };
    const proxyFetch: FetchLike = async () => new Response('Proxy session expired', {
      status: 401,
      headers: { 'X-MCP-Proxy-Response-Source': 'proxy' },
    });

    let caught: unknown;
    try {
      await beginOAuthFlow(target, {
        resourceMetadataUrl,
        fetchFn: directFetch,
        discoveryProxy: {
          url: 'https://proxy.mcptest.test/',
          authorizationToken: 'expired-firebase-token',
          fetchFn: proxyFetch,
        },
        redirect: vi.fn(),
      });
    } catch (error) {
      caught = error;
    }

    expect(getOAuthPrerequisite(caught)).toMatchObject({
      kind: 'proxy_authentication_required',
      providerName: 'mcptest proxy',
      failedStage: 'authorization server metadata',
    });
    expect(getOAuthPrerequisite(caught)).not.toMatchObject({
      issuer: expect.anything(),
      registrationEndpoint: expect.anything(),
      documentationUrl: expect.anything(),
      registrationUrl: expect.anything(),
      configurationMode: expect.anything(),
      supportsBearerToken: expect.anything(),
      bearerTokenName: expect.anything(),
    });
    expect(getStoredOAuthTrace(target, sessionStorage)?.events).toEqual(expect.arrayContaining([
      expect.objectContaining({
        type: 'authorization_server_metadata',
        outcome: 'failed',
        provenance: 'authenticated_proxy',
        route: 'proxy',
        response: expect.objectContaining({ status: 401 }),
      }),
    ]));
  });

  it.each([
    ['Linear', 'https://mcp.linear.app/mcp', 'https://linear.app'],
    ['Notion', 'https://mcp.notion.com/mcp', 'https://mcp.notion.com'],
    ['Atlassian', 'https://mcp.atlassian.com/v1/mcp/authv2', 'https://auth.atlassian.com'],
  ])('keeps %s on automatic CIMD authorization', async (_name, target, issuer) => {
    const fetchFn: FetchLike = async (input) => {
      const url = String(input);
      if (url.includes('/.well-known/oauth-protected-resource')) {
        return jsonResponse({ resource: target, authorization_servers: [issuer] });
      }
      if (url.includes('/.well-known/oauth-authorization-server')) {
        return jsonResponse(authorizationMetadata(issuer, { cimd: true }));
      }
      return new Response('Not found', { status: 404 });
    };
    const redirect = vi.fn();

    await expect(beginOAuthFlow(target, {
      redirectUrl: 'https://mcptest.io/oauth/callback',
      fetchFn,
      redirect,
    })).resolves.toBe('REDIRECT');

    expect(redirect).toHaveBeenCalledOnce();
    expect(getStoredOAuthTrace(target, sessionStorage)?.events).toEqual(expect.arrayContaining([
      expect.objectContaining({ type: 'cimd', outcome: 'succeeded' }),
      expect.objectContaining({ type: 'authorization_redirect', outcome: 'redirected' }),
    ]));
  });
});
