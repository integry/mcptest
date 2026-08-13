import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import {
  PROXY_RESPONSE_SOURCE_HEADER,
  forwardAuthenticatedProxyRequest,
} from './index';
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
const deployedProxyUrl = 'https://cors-proxy-worker.livecart.workers.dev/';

describe('hosted OAuth deployment configuration', () => {
  it('keeps the configured callback on the deployed proxy origin', () => {
    const wranglerConfig = readFileSync(resolve(import.meta.dirname, '../wrangler.toml'), 'utf8');
    const configuredCallback = wranglerConfig.match(
      /^HOSTED_OAUTH_CALLBACK_URL\s*=\s*"([^"]+)"$/m
    )?.[1];

    expect(configuredCallback).toBeDefined();
    const callbackUrl = new URL(configuredCallback!);
    expect(callbackUrl.origin).toBe(new URL(deployedProxyUrl).origin);
    expect(callbackUrl.pathname).toBe(HOSTED_CALLBACK_PATH);
  });
});

class MemoryStorage {
  readonly values = new Map<string, unknown>();
  alarmTime: number | null = null;
  get<T>(key: string): Promise<T | undefined> { return Promise.resolve(this.values.get(key) as T | undefined); }
  put(key: string, value: unknown): Promise<void> { this.values.set(key, value); return Promise.resolve(); }
  delete(key: string): Promise<boolean> { return Promise.resolve(this.values.delete(key)); }
  setAlarm(scheduledTime: number | Date): Promise<void> {
    this.alarmTime = scheduledTime instanceof Date ? scheduledTime.getTime() : scheduledTime;
    return Promise.resolve();
  }
  deleteAlarm(): Promise<void> { this.alarmTime = null; return Promise.resolve(); }
  transaction<T>(callback: (transaction: MemoryStorage) => Promise<T>): Promise<T> { return callback(this); }
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
    SLACK_OAUTH_SCOPES: 'channels:read chat:write',
    GITHUB_OAUTH_CLIENT_ID: 'github-client-id',
    GITHUB_OAUTH_CLIENT_SECRET: 'github-client-secret',
    GITHUB_OAUTH_SCOPES: 'repo read:user',
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

const readCompletion = (response: Response): string => {
  expect(response.status).toBe(303);
  const location = response.headers.get('location');
  expect(location).toBeTruthy();
  const callbackUrl = new URL(location!);
  expect(`${callbackUrl.origin}${callbackUrl.pathname}`).toBe('https://mcptest.io/oauth/callback');
  const result = callbackUrl.searchParams.get('hosted_result');
  expect(result).toMatch(/^[A-Za-z0-9_-]{43}$/);
  return result!;
};

const exchange = async (env: HostedOAuthEnv, result: string, uid = 'user-1') => (
  (await handleHostedOAuthRequest(new Request(`https://proxy.mcptest.io${HOSTED_EXCHANGE_PATH}`, {
    method: 'POST', body: JSON.stringify({ result }),
  }), env, uid))!
);

const rejectedGrantResponse = async (attempt: Promise<string>): Promise<Response> => {
  try {
    await attempt;
  } catch (error) {
    expect(error).toBeInstanceOf(Response);
    return error as Response;
  }
  throw new Error('Expected the hosted grant to be rejected.');
};

beforeEach(() => {
  vi.stubGlobal('fetch', vi.fn(async (input: RequestInfo | URL, init?: RequestInit) => {
    const url = String(input);
    if (url === 'https://mcp.slack.com/.well-known/oauth-protected-resource') {
      return Response.json({ resource: 'https://mcp.slack.com', authorization_servers: ['https://mcp.slack.com'], scopes_supported: ['channels:read', 'chat:write', 'files:read'] });
    }
    if (url === 'https://api.githubcopilot.com/.well-known/oauth-protected-resource/mcp') {
      return Response.json({ resource: 'https://api.githubcopilot.com/mcp', authorization_servers: ['https://github.com/login/oauth'], scopes_supported: ['repo', 'read:user', 'workflow'] });
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
    const expectedResource = provider === 'slack'
      ? 'https://mcp.slack.com'
      : 'https://api.githubcopilot.com/mcp';
    expect(location).not.toContain(provider === 'slack' ? 'slack-client-secret' : 'github-client-secret');
    expect(location).not.toContain('provider-code');
    expect(new URL(location).searchParams.get('scope'))
      .toBe(provider === 'slack' ? 'channels:read' : 'repo');
    expect(new URL(location).searchParams.get('resource')).toBe(expectedResource);

    const completion = readCompletion(await callback(env, transaction));
    expect(completion).not.toBe(transaction);
    const exchangeResponse = await exchange(env, completion);
    expect(exchangeResponse?.status).toBe(200);
    const result = await exchangeResponse!.json() as { grant: string; serverUrl: string };
    expect(JSON.stringify(result)).not.toContain('access');
    expect(JSON.stringify(result)).not.toContain('refresh');
    expect(await resolveHostedGrant(env, result.grant, 'user-1', result.serverUrl))
      .toBe(provider === 'slack' ? 'Bearer slack-refreshed' : 'Bearer github-access');
    const tokenEndpoint = provider === 'slack'
      ? 'https://slack.com/api/oauth.v2.user.access'
      : 'https://github.com/login/oauth/access_token';
    const tokenRequests = vi.mocked(fetch).mock.calls.filter(([input]) => String(input) === tokenEndpoint);
    expect(tokenRequests.length).toBeGreaterThan(0);
    for (const [, init] of tokenRequests) {
      expect(new URLSearchParams(String(init?.body)).get('resource')).toBe(expectedResource);
    }
  });

  it('honors expires_in zero as an immediately expired provider token', async () => {
    const env = makeEnv();
    const transaction = await readTransaction(await start(env));
    const completion = readCompletion(await callback(env, transaction));
    vi.mocked(fetch).mockResolvedValueOnce(Response.json({
      ok: true,
      authed_user: {
        access_token: 'immediately-expired',
        refresh_token: 'slack-refresh',
        expires_in: 0,
      },
    }));

    const result = await (await exchange(env, completion)).json() as { grant: string; serverUrl: string };

    await expect(resolveHostedGrant(env, result.grant, 'user-1', result.serverUrl))
      .resolves.toBe('Bearer slack-refreshed');
  });

  it('rejects a negative provider token expiry', async () => {
    const env = makeEnv();
    const transaction = await readTransaction(await start(env));
    const completion = readCompletion(await callback(env, transaction));
    vi.mocked(fetch).mockResolvedValueOnce(Response.json({
      ok: true,
      authed_user: { access_token: 'slack-access', expires_in: -1 },
    }));

    const response = await exchange(env, completion);

    expect(response.status).toBe(502);
    expect(await response.json()).toMatchObject({
      error: 'provider_token_error',
      message: 'Provider token response expires_in must be a finite non-negative number.',
    });
  });

  it('accepts the trailing-slash GitHub metadata URL observed by browser discovery', async () => {
    const browserResourceMetadataUrl = 'https://api.githubcopilot.com/.well-known/oauth-protected-resource/mcp/';
    const response = await start(makeEnv(), 'github', 'user-1', {
      resourceMetadataUrl: browserResourceMetadataUrl,
    });

    expect(response.status).toBe(200);
    const fetchedUrls = vi.mocked(fetch).mock.calls.map(([input]) => String(input));
    expect(fetchedUrls).toContain(
      'https://api.githubcopilot.com/.well-known/oauth-protected-resource/mcp'
    );
    expect(fetchedUrls).not.toContain(browserResourceMetadataUrl);
  });

  it.each([
    ['slack', 'channels:read,chat:write'],
    ['github', 'repo read:user'],
  ] as const)('uses the explicit operator %s scope policy when the challenge has no scope', async (
    provider,
    expectedScope
  ) => {
    const env = makeEnv();
    const transaction = await readTransaction(await start(env, provider, 'user-1', {
      scope: undefined,
    }));
    const authorization = await handleHostedOAuthRequest(new Request(
      `https://proxy.mcptest.io${HOSTED_AUTHORIZE_PATH}?transaction=${transaction}`
    ), env, null);

    expect(authorization?.status).toBe(302);
    expect(new URL(authorization!.headers.get('location')!).searchParams.get('scope'))
      .toBe(expectedScope);
  });

  it('rejects a challenge scope outside the operator provider policy', async () => {
    const response = await start(makeEnv(), 'slack', 'user-1', {
      scope: 'channels:read admin',
    });

    expect(response.status).toBe(400);
    expect(await response.json()).toEqual({ error: 'invalid_scope' });
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
    const completion = readCompletion(await callback(env, transaction));
    const result = await (await exchange(env, completion))!.json() as { grant: string };
    const response = await rejectedGrantResponse(
      resolveHostedGrant(env, result.grant, 'user-1', 'https://attacker.example/mcp')
    );
    expect(response.status).toBe(403);
    expect(await response.json()).toEqual({
      error: 'hosted_grant_rejected',
      reason: 'grant_binding_mismatch',
    });
    expect(response.headers.get('www-authenticate')).toBe('HostedGrant error="invalid_token"');
  });

  it('returns an identifiable rejection for an expired hosted grant', async () => {
    const env = makeEnv();
    const transaction = await readTransaction(await start(env));
    const completion = readCompletion(await callback(env, transaction));
    const result = await (await exchange(env, completion)).json() as { grant: string; serverUrl: string };
    const namespace = env.HOSTED_OAUTH_BROKER as unknown as MemoryNamespace;
    const store = namespace.stores.get(result.grant)!;
    const record = store.values.get('record') as Record<string, unknown>;
    store.values.set('record', { ...record, expiresAt: Date.now() - 1 });

    const response = await forwardAuthenticatedProxyRequest(
      new Request('https://proxy.mcptest.io/', {
        headers: { 'X-MCP-Hosted-Grant': result.grant },
      }),
      env,
      'user-1',
      new URL(result.serverUrl)
    );
    expect(response.status).toBe(401);
    expect(await response.json()).toEqual({
      error: 'hosted_grant_rejected',
      reason: 'grant_expired',
    });
    expect(response.headers.get('www-authenticate')).toBe('HostedGrant error="invalid_token"');
    expect(response.headers.get(PROXY_RESPONSE_SOURCE_HEADER)).toBe('proxy');
    expect(response.headers.get('access-control-allow-origin')).toBe('*');
    expect(response.headers.get('access-control-expose-headers')?.toLowerCase())
      .toContain('www-authenticate');
    expect(store.values.has('record')).toBe(false);
    expect(store.alarmTime).toBeNull();
  });

  it('returns an identifiable rejection when another Firebase user presents the grant', async () => {
    const env = makeEnv();
    const transaction = await readTransaction(await start(env));
    const completion = readCompletion(await callback(env, transaction));
    const result = await (await exchange(env, completion)).json() as { grant: string; serverUrl: string };

    const response = await forwardAuthenticatedProxyRequest(
      new Request('https://proxy.mcptest.io/', {
        headers: { 'X-MCP-Hosted-Grant': result.grant },
      }),
      env,
      'different-user',
      new URL(result.serverUrl)
    );
    expect(response.status).toBe(403);
    expect(await response.json()).toEqual({
      error: 'hosted_grant_rejected',
      reason: 'grant_binding_mismatch',
    });
    expect(response.headers.get('www-authenticate')).toBe('HostedGrant error="invalid_token"');
    expect(response.headers.get(PROXY_RESPONSE_SOURCE_HEADER)).toBe('proxy');
    expect(response.headers.get('access-control-allow-origin')).toBe('*');
    expect(response.headers.get('access-control-expose-headers')?.toLowerCase())
      .toContain('www-authenticate');
  });

  it('binds completion to the signed-in user and makes exchange one-time', async () => {
    const env = makeEnv();
    const transaction = await readTransaction(await start(env));
    const completion = readCompletion(await callback(env, transaction));
    expect((await exchange(env, completion, 'other-user'))?.status).toBe(403);
    expect((await exchange(env, completion, 'user-1'))?.status).toBe(200);
    expect((await exchange(env, completion, 'user-1'))?.status).toBe(404);
  });

  it('schedules expiry for every durable record and removes terminal sensitive records', async () => {
    const env = makeEnv();
    const namespace = env.HOSTED_OAUTH_BROKER as unknown as MemoryNamespace;
    const transaction = await readTransaction(await start(env));
    const transactionStore = namespace.stores.get(transaction)!;
    const transactionRecord = transactionStore.values.get('record') as { expiresAt: number };
    expect(transactionStore.alarmTime).toBe(transactionRecord.expiresAt);

    const completion = readCompletion(await callback(env, transaction));
    const completionStore = namespace.stores.get(completion)!;
    const completionRecord = completionStore.values.get('record') as { expiresAt: number };
    expect(completionStore.alarmTime).toBe(completionRecord.expiresAt);

    const result = await (await exchange(env, completion)).json() as { grant: string };
    const grantStore = namespace.stores.get(result.grant)!;
    const grantRecord = grantStore.values.get('record') as { expiresAt: number; encryptedTokens?: unknown };
    expect(grantRecord.encryptedTokens).toBeDefined();
    expect(grantStore.alarmTime).toBe(grantRecord.expiresAt);
    expect(transactionStore.values.has('record')).toBe(false);
    expect(transactionStore.alarmTime).toBeNull();
    expect(completionStore.values.has('record')).toBe(false);
    expect(completionStore.alarmTime).toBeNull();

    vi.spyOn(Date, 'now').mockReturnValue(grantRecord.expiresAt);
    await namespace.brokers.get(result.grant)!.alarm();
    expect(grantStore.values.has('record')).toBe(false);
    expect(grantStore.alarmTime).toBeNull();
  });

  it('deletes abandoned transactions and unused completions when their alarms fire', async () => {
    const env = makeEnv();
    const namespace = env.HOSTED_OAUTH_BROKER as unknown as MemoryNamespace;
    const abandonedTransaction = await readTransaction(await start(env));
    const abandonedStore = namespace.stores.get(abandonedTransaction)!;
    const abandonedRecord = abandonedStore.values.get('record') as { expiresAt: number };

    const transactionExpiry = vi.spyOn(Date, 'now').mockReturnValue(abandonedRecord.expiresAt);
    await namespace.brokers.get(abandonedTransaction)!.alarm();
    transactionExpiry.mockRestore();
    expect(abandonedStore.values.has('record')).toBe(false);
    expect(abandonedStore.alarmTime).toBeNull();

    const transaction = await readTransaction(await start(env, 'github'));
    const completion = readCompletion(await callback(env, transaction));
    const completionStore = namespace.stores.get(completion)!;
    const completionRecord = completionStore.values.get('record') as { expiresAt: number };

    const completionExpiry = vi.spyOn(Date, 'now').mockReturnValue(completionRecord.expiresAt);
    await namespace.brokers.get(completion)!.alarm();
    completionExpiry.mockRestore();
    expect(completionStore.values.has('record')).toBe(false);
    expect(completionStore.alarmTime).toBeNull();
  });

  it('prevents a transaction initiator from claiming authorization completed in another user browser', async () => {
    const env = makeEnv();
    const attackerTransaction = await readTransaction(await start(env, 'slack', 'attacker-user'));
    expect((await exchange(env, attackerTransaction, 'attacker-user')).status).toBe(404);

    const victimBrowserCallback = await callback(env, attackerTransaction, `code=victim-code&state=${attackerTransaction}`);
    const victimBrowserCompletion = readCompletion(victimBrowserCallback);
    expect(victimBrowserCompletion).not.toBe(attackerTransaction);

    expect((await exchange(env, attackerTransaction, 'attacker-user')).status).toBe(404);
    expect((await exchange(env, victimBrowserCompletion, 'victim-user')).status).toBe(403);
  });

  it('rejects callback replay, state mismatch, issuer mix-up, denial, and expiry', async () => {
    const env = makeEnv();
    const transaction = await readTransaction(await start(env));
    expect((await callback(env, transaction, `code=x&state=wrong`))?.status).toBe(400);
    expect((await callback(env, transaction, `code=x&state=${transaction}&iss=https://attacker.example`))?.status).toBe(400);
    const deniedCompletion = readCompletion(await callback(env, transaction, `error=access_denied&state=${transaction}`));
    expect((await exchange(env, deniedCompletion))?.status).toBe(400);

    const second = await readTransaction(await start(env, 'github'));
    expect((await callback(env, second))?.status).toBe(303);
    expect((await callback(env, second))?.status).toBe(409);

    const third = await readTransaction(await start(env));
    const namespace = env.HOSTED_OAUTH_BROKER as unknown as MemoryNamespace;
    const store = namespace.stores.get(third)!;
    const record = store.values.get('record') as Record<string, unknown>;
    store.values.set('record', { ...record, expiresAt: Date.now() - 1 });
    expect((await callback(env, third))?.status).toBe(410);
    expect(store.values.has('record')).toBe(false);
    expect(store.alarmTime).toBeNull();
  });

  it('keeps a retryable transaction when the provider token endpoint errors', async () => {
    const env = makeEnv();
    const transaction = await readTransaction(await start(env, 'github'));
    const completion = readCompletion(await callback(env, transaction));
    vi.mocked(fetch).mockResolvedValueOnce(new Response('provider unavailable', { status: 503 }));
    expect((await exchange(env, completion))?.status).toBe(502);
    expect((await exchange(env, completion))?.status).toBe(200);
  });

  it('reports an honest operator prerequisite when provider secrets are absent', async () => {
    const env = makeEnv();
    delete env.SLACK_OAUTH_CLIENT_SECRET;
    const response = await start(env);
    expect(response?.status).toBe(503);
    expect(await response?.json()).toMatchObject({ error: 'provider_not_configured' });
  });

  it('fails closed when the operator has not configured provider scopes', async () => {
    const env = makeEnv();
    delete env.SLACK_OAUTH_SCOPES;
    const response = await start(env, 'slack', 'user-1', { scope: undefined });

    expect(response.status).toBe(503);
    expect(await response.json()).toMatchObject({
      error: 'provider_not_configured',
      message: expect.stringContaining('SLACK_OAUTH_SCOPES'),
    });
  });

  it('fails closed when the operator policy includes an unadvertised scope', async () => {
    const env = makeEnv();
    env.GITHUB_OAUTH_SCOPES = 'repo delete_repo';
    const response = await start(env, 'github', 'user-1', { scope: undefined });

    expect(response.status).toBe(503);
    expect(await response.json()).toMatchObject({ error: 'provider_not_configured' });
  });
});
