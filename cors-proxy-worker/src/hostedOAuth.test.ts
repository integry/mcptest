import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import {
  HOSTED_AUTHORIZE_PATH,
  HOSTED_CALLBACK_PATH,
  HOSTED_EXCHANGE_PATH,
  HOSTED_START_PATH,
  HostedOAuthBroker,
  handleHostedOAuthRequest,
  resolveHostedGrant,
  type HostedOAuthEnv,
} from './hostedOAuth';

const encryptionKey = 'AAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAA';

class MemoryStorage {
  readonly values = new Map<string, unknown>();
  get<T>(key: string): Promise<T | undefined> { return Promise.resolve(this.values.get(key) as T | undefined); }
  put(key: string, value: unknown): Promise<void> { this.values.set(key, value); return Promise.resolve(); }
}

class MemoryNamespace {
  readonly stores = new Map<string, MemoryStorage>();
  readonly brokers = new Map<string, HostedOAuthBroker>();
  readonly env: HostedOAuthEnv;

  constructor(env: HostedOAuthEnv) { this.env = env; }
  idFromName(name: string) { return name; }
  get(id: string) {
    if (!this.brokers.has(id)) {
      const storage = new MemoryStorage();
      this.stores.set(id, storage);
      const state = {
        storage,
        blockConcurrencyWhile: <T>(callback: () => Promise<T>) => callback(),
      } as unknown as DurableObjectState;
      this.brokers.set(id, new HostedOAuthBroker(state, this.env));
    }
    return { fetch: (input: RequestInfo | URL, init?: RequestInit) => (
      this.brokers.get(id)!.fetch(new Request(input, init))
    ) };
  }
}

const makeEnv = (): HostedOAuthEnv => {
  const env: HostedOAuthEnv = {
    PUBLIC_APP_ORIGIN: 'https://mcptest.io',
    HOSTED_OAUTH_CALLBACK_URL: `https://proxy.mcptest.io${HOSTED_CALLBACK_PATH}`,
    HOSTED_OAUTH_ENCRYPTION_KEY: encryptionKey,
    SLACK_OAUTH_CLIENT_ID: 'slack-client-id',
    SLACK_OAUTH_CLIENT_SECRET: 'slack-client-secret',
    GITHUB_OAUTH_CLIENT_ID: 'github-client-id',
    GITHUB_OAUTH_CLIENT_SECRET: 'github-client-secret',
  };
  env.HOSTED_OAUTH_BROKER = new MemoryNamespace(env) as unknown as DurableObjectNamespace;
  return env;
};

const start = async (
  env: HostedOAuthEnv,
  provider: 'slack' | 'github' = 'slack',
  uid = 'user-1',
  overrides: Record<string, unknown> = {}
) => (await handleHostedOAuthRequest(new Request(`https://proxy.mcptest.io${HOSTED_START_PATH}`, {
  method: 'POST',
  body: JSON.stringify({
    target: provider === 'slack'
      ? 'https://mcp.slack.com/mcp/'
      : 'https://api.githubcopilot.com/mcp/',
    issuer: provider === 'slack'
      ? 'https://mcp.slack.com'
      : 'https://github.com/login/oauth',
    resourceMetadataUrl: provider === 'slack'
      ? 'https://mcp.slack.com/.well-known/oauth-protected-resource'
      : 'https://api.githubcopilot.com/.well-known/oauth-protected-resource/mcp',
    scope: provider === 'slack' ? 'channels:read' : 'repo',
    ...overrides,
  }),
}), env, uid))!;

const readTransaction = async (response: Response): Promise<string> => {
  expect(response.status).toBe(200);
  const body = await response.json() as { transaction: string };
  return body.transaction;
};

const callback = async (
  env: HostedOAuthEnv,
  transaction: string,
  parameters = `code=provider-code&state=${transaction}`
) => (await handleHostedOAuthRequest(new Request(
  `https://proxy.mcptest.io${HOSTED_CALLBACK_PATH}?${parameters}`
), env, null))!;

const exchange = async (env: HostedOAuthEnv, result: string, uid = 'user-1') => (
  (await handleHostedOAuthRequest(new Request(`https://proxy.mcptest.io${HOSTED_EXCHANGE_PATH}`, {
    method: 'POST', body: JSON.stringify({ result }),
  }), env, uid))!
);

beforeEach(() => {
  vi.stubGlobal('fetch', vi.fn(async (input: RequestInfo | URL, init?: RequestInit) => {
    const url = String(input);
    if (url === 'https://mcp.slack.com/.well-known/oauth-protected-resource') {
      return Response.json({ resource: 'https://mcp.slack.com', authorization_servers: ['https://mcp.slack.com'], scopes_supported: ['channels:read'] });
    }
    if (url === 'https://api.githubcopilot.com/.well-known/oauth-protected-resource/mcp') {
      return Response.json({ resource: 'https://api.githubcopilot.com/mcp', authorization_servers: ['https://github.com/login/oauth'], scopes_supported: ['repo'] });
    }
    if (url === 'https://mcp.slack.com/.well-known/oauth-authorization-server') {
      return Response.json({ issuer: 'https://mcp.slack.com', authorization_endpoint: 'https://slack.com/oauth/v2_user/authorize', token_endpoint: 'https://slack.com/api/oauth.v2.user.access', code_challenge_methods_supported: ['S256'] });
    }
    if (url === 'https://github.com/.well-known/oauth-authorization-server/login/oauth') {
      return Response.json({ issuer: 'https://github.com/login/oauth', authorization_endpoint: 'https://github.com/login/oauth/authorize', token_endpoint: 'https://github.com/login/oauth/access_token', code_challenge_methods_supported: ['S256'] });
    }
    if (url.includes('oauth.v2.user.access')) {
      const form = new URLSearchParams(String(init?.body));
      if (form.get('grant_type') === 'refresh_token') {
        return Response.json({ ok: true, authed_user: { access_token: 'slack-refreshed', expires_in: 3600 } });
      }
      return Response.json({
        ok: true,
        authed_user: { access_token: 'slack-access', refresh_token: 'slack-refresh', expires_in: 1 },
      });
    }
    if (url.includes('github.com/login/oauth/access_token')) {
      return Response.json({ access_token: 'github-access', token_type: 'bearer' });
    }
    return new Response('not found', { status: 404 });
  }));
});

afterEach(() => vi.unstubAllGlobals());

describe('hosted provider authorization transactions', () => {
  it.each(['slack', 'github'] as const)('completes an allowlisted %s flow without exposing secrets or tokens', async provider => {
    const env = makeEnv();
    const transaction = await readTransaction(await start(env, provider));
    const authorization = await handleHostedOAuthRequest(new Request(
      `https://proxy.mcptest.io${HOSTED_AUTHORIZE_PATH}?transaction=${transaction}`
    ), env, null);
    expect(authorization?.status).toBe(302);
    const location = authorization?.headers.get('location') || '';
    expect(location).not.toContain(provider === 'slack' ? 'slack-client-secret' : 'github-client-secret');
    expect(location).not.toContain('provider-code');

    const callbackResponse = await callback(env, transaction);
    expect(callbackResponse?.status).toBe(303);
    expect(callbackResponse?.headers.get('location')).toBe(
      `https://mcptest.io/oauth/callback?hosted_result=${transaction}`
    );
    const exchangeResponse = await exchange(env, transaction);
    expect(exchangeResponse?.status).toBe(200);
    const result = await exchangeResponse!.json() as { grant: string; serverUrl: string };
    expect(JSON.stringify(result)).not.toContain('access');
    expect(JSON.stringify(result)).not.toContain('refresh');
    expect(await resolveHostedGrant(env, result.grant, 'user-1', result.serverUrl))
      .toBe(provider === 'slack' ? 'Bearer slack-refreshed' : 'Bearer github-access');
  });

  it('rejects unknown targets even when they advertise a trusted issuer', async () => {
    const response = await start(makeEnv(), 'slack', 'user-1', {
      target: 'https://attacker.example/mcp',
      issuer: 'https://mcp.slack.com',
    });
    expect(response?.status).toBe(400);
    expect(await response?.json()).toMatchObject({ error: 'unsupported_provider_target' });
  });

  it('rejects target substitution when resolving a grant', async () => {
    const env = makeEnv();
    const transaction = await readTransaction(await start(env));
    await callback(env, transaction);
    const result = await (await exchange(env, transaction))!.json() as { grant: string };
    await expect(resolveHostedGrant(env, result.grant, 'user-1', 'https://attacker.example/mcp'))
      .rejects.toThrow('invalid, expired, or not valid');
  });

  it('binds completion to the signed-in user and makes exchange one-time', async () => {
    const env = makeEnv();
    const transaction = await readTransaction(await start(env));
    await callback(env, transaction);
    expect((await exchange(env, transaction, 'other-user'))?.status).toBe(403);
    expect((await exchange(env, transaction, 'user-1'))?.status).toBe(200);
    expect((await exchange(env, transaction, 'user-1'))?.status).toBe(409);
  });

  it('rejects callback replay, state mismatch, issuer mix-up, denial, and expiry', async () => {
    const env = makeEnv();
    const transaction = await readTransaction(await start(env));
    expect((await callback(env, transaction, `code=x&state=wrong`))?.status).toBe(400);
    expect((await callback(env, transaction, `code=x&state=${transaction}&iss=https://attacker.example`))?.status).toBe(400);
    expect((await callback(env, transaction, `error=access_denied&state=${transaction}`))?.status).toBe(303);
    expect((await exchange(env, transaction))?.status).toBe(400);

    const second = await readTransaction(await start(env, 'github'));
    expect((await callback(env, second))?.status).toBe(303);
    expect((await callback(env, second))?.status).toBe(409);

    const third = await readTransaction(await start(env));
    const namespace = env.HOSTED_OAUTH_BROKER as unknown as MemoryNamespace;
    const store = namespace.stores.get(third)!;
    const record = store.values.get('record') as Record<string, unknown>;
    store.values.set('record', { ...record, expiresAt: Date.now() - 1 });
    expect((await callback(env, third))?.status).toBe(410);
  });

  it('keeps a retryable transaction when the provider token endpoint errors', async () => {
    const env = makeEnv();
    const transaction = await readTransaction(await start(env, 'github'));
    await callback(env, transaction);
    vi.mocked(fetch).mockResolvedValueOnce(new Response('provider unavailable', { status: 503 }));
    expect((await exchange(env, transaction))?.status).toBe(502);
    expect((await exchange(env, transaction))?.status).toBe(200);
  });

  it('reports an honest operator prerequisite when provider secrets are absent', async () => {
    const env = makeEnv();
    delete env.SLACK_OAUTH_CLIENT_SECRET;
    const response = await start(env);
    expect(response?.status).toBe(503);
    expect(await response?.json()).toMatchObject({ error: 'provider_not_configured' });
  });
});
