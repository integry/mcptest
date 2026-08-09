import { auth, type FetchLike, type OAuthClientProvider } from '@modelcontextprotocol/client';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import clientMetadataDocument from '../../public/oauth/client-metadata.json';
import {
  BrowserOAuthProvider,
  OAUTH_CLIENT_METADATA_URL,
  OAuthStateMismatchError,
  beginOAuthFlow,
  completeOAuthFlow,
  isOAuthClientConfigurationRequired,
  saveManualOAuthClient,
} from './oauthFlow';

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

  it('rehydrates the UI token bridge when the SDK already has authorization', async () => {
    const provider = new BrowserOAuthProvider(SERVER_URL, { redirect: vi.fn() });
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
