export const HOSTED_GRANT_HEADER = 'X-MCP-Hosted-Grant';
export const HOSTED_START_PATH = '/oauth/hosted/start';
export const HOSTED_AUTHORIZE_PATH = '/oauth/hosted/authorize';
export const HOSTED_CALLBACK_PATH = '/oauth/hosted/callback';
export const HOSTED_EXCHANGE_PATH = '/oauth/hosted/exchange';

export interface HostedOAuthEnv {
  HOSTED_OAUTH_BROKER?: DurableObjectNamespace;
  HOSTED_OAUTH_CALLBACK_URL?: string;
  HOSTED_OAUTH_ENCRYPTION_KEY?: string;
  PUBLIC_APP_ORIGIN?: string;
  SLACK_OAUTH_CLIENT_ID?: string;
  SLACK_OAUTH_CLIENT_SECRET?: string;
  GITHUB_OAUTH_CLIENT_ID?: string;
  GITHUB_OAUTH_CLIENT_SECRET?: string;
}

type ProviderId = 'slack' | 'github';

interface ProviderDefinition {
  id: ProviderId;
  name: string;
  targetOrigin: string;
  targetPath: string;
  resource: string;
  resourceMetadataUrl: string;
  authorizationMetadataUrl: string;
  issuer: string;
  authorizationEndpoint: string;
  tokenEndpoint: string;
  clientIdBinding: 'SLACK_OAUTH_CLIENT_ID' | 'GITHUB_OAUTH_CLIENT_ID';
  clientSecretBinding: 'SLACK_OAUTH_CLIENT_SECRET' | 'GITHUB_OAUTH_CLIENT_SECRET';
  documentationUrl: string;
}

const PROVIDERS: readonly ProviderDefinition[] = [{
  id: 'slack',
  name: 'Slack',
  targetOrigin: 'https://mcp.slack.com',
  targetPath: '/mcp',
  resource: 'https://mcp.slack.com',
  resourceMetadataUrl: 'https://mcp.slack.com/.well-known/oauth-protected-resource',
  authorizationMetadataUrl: 'https://mcp.slack.com/.well-known/oauth-authorization-server',
  issuer: 'https://mcp.slack.com',
  authorizationEndpoint: 'https://slack.com/oauth/v2_user/authorize',
  tokenEndpoint: 'https://slack.com/api/oauth.v2.user.access',
  clientIdBinding: 'SLACK_OAUTH_CLIENT_ID',
  clientSecretBinding: 'SLACK_OAUTH_CLIENT_SECRET',
  documentationUrl: 'https://docs.slack.dev/ai/slack-mcp-server/',
}, {
  id: 'github',
  name: 'GitHub',
  targetOrigin: 'https://api.githubcopilot.com',
  targetPath: '/mcp',
  resource: 'https://api.githubcopilot.com/mcp',
  resourceMetadataUrl: 'https://api.githubcopilot.com/.well-known/oauth-protected-resource/mcp',
  authorizationMetadataUrl: 'https://github.com/.well-known/oauth-authorization-server/login/oauth',
  issuer: 'https://github.com/login/oauth',
  authorizationEndpoint: 'https://github.com/login/oauth/authorize',
  tokenEndpoint: 'https://github.com/login/oauth/access_token',
  clientIdBinding: 'GITHUB_OAUTH_CLIENT_ID',
  clientSecretBinding: 'GITHUB_OAUTH_CLIENT_SECRET',
  documentationUrl: 'https://docs.github.com/en/copilot/how-tos/provide-context/use-mcp-in-your-ide/set-up-the-github-mcp-server',
}];

const TRANSACTION_TTL_MS = 10 * 60 * 1000;
const GRANT_TTL_MS = 30 * 24 * 60 * 60 * 1000;
const REFRESH_SKEW_MS = 60 * 1000;
const OPAQUE_VALUE = /^[A-Za-z0-9_-]{43}$/;

interface TransactionRecord {
  kind: 'transaction';
  status: 'awaiting_callback' | 'code_received' | 'exchanged' | 'denied';
  uid: string;
  provider: ProviderId;
  target: string;
  resource: string;
  resourceMetadataUrl: string;
  issuer: string;
  redirectUri: string;
  returnUri: string;
  verifier: string;
  state: string;
  scope: string;
  expiresAt: number;
  code?: string;
  completionHandle?: string;
  providerError?: string;
}

interface CompletionRecord {
  kind: 'completion';
  status: 'ready' | 'used';
  handle: string;
  transactionState: string;
  uid: string;
  expiresAt: number;
}

interface StoredGrant {
  kind: 'grant';
  uid: string;
  provider: ProviderId;
  target: string;
  resource: string;
  issuer: string;
  encryptedTokens: EncryptedValue;
  expiresAt: number;
}

interface ProviderTokens {
  accessToken: string;
  refreshToken?: string;
  expiresAt?: number;
  scope?: string;
}

interface EncryptedValue {
  iv: string;
  ciphertext: string;
}

const json = (body: unknown, status = 200): Response => new Response(JSON.stringify(body), {
  status,
  headers: {
    'Content-Type': 'application/json',
    'Cache-Control': 'no-store',
    'Referrer-Policy': 'no-referrer',
  },
});

const randomOpaque = (): string => {
  const bytes = crypto.getRandomValues(new Uint8Array(32));
  return base64Url(bytes);
};

const base64Url = (bytes: Uint8Array): string => {
  let binary = '';
  for (const byte of bytes) binary += String.fromCharCode(byte);
  return btoa(binary).replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '');
};

const decodeBase64Url = (value: string): Uint8Array => {
  const padded = value.replace(/-/g, '+').replace(/_/g, '/')
    .padEnd(Math.ceil(value.length / 4) * 4, '=');
  return Uint8Array.from(atob(padded), character => character.charCodeAt(0));
};

const normalizeTarget = (value: string): string => {
  const url = new URL(value);
  if (url.protocol !== 'https:' || url.username || url.password || url.search || url.hash) {
    throw new Error('The hosted OAuth target must be a clean HTTPS MCP resource URL.');
  }
  url.pathname = url.pathname.replace(/\/+$/, '') || '/';
  return url.toString().replace(/\/$/, url.pathname === '/' ? '/' : '');
};

const providerForPair = (target: string, issuer: string): ProviderDefinition | undefined => {
  let normalized: string;
  try { normalized = normalizeTarget(target); } catch { return undefined; }
  return PROVIDERS.find(provider => {
    const expected = `${provider.targetOrigin}${provider.targetPath}`;
    return normalized === expected && issuer === provider.issuer;
  });
};

const providerById = (id: ProviderId): ProviderDefinition => {
  const provider = PROVIDERS.find(candidate => candidate.id === id);
  if (!provider) throw new Error('Unsupported hosted OAuth provider.');
  return provider;
};

const callbackUrl = (env: HostedOAuthEnv): string => {
  if (!env.HOSTED_OAUTH_CALLBACK_URL) throw new Error('Hosted OAuth callback URL is not configured.');
  const value = new URL(env.HOSTED_OAUTH_CALLBACK_URL);
  if (value.protocol !== 'https:' || value.pathname !== HOSTED_CALLBACK_PATH || value.search || value.hash) {
    throw new Error('Hosted OAuth callback URL is invalid.');
  }
  return value.toString();
};

const returnUrl = (env: HostedOAuthEnv): string => {
  const origin = new URL(env.PUBLIC_APP_ORIGIN || 'https://mcptest.io').origin;
  return `${origin}/oauth/callback`;
};

const configuredClient = (provider: ProviderDefinition, env: HostedOAuthEnv): {
  clientId: string;
  clientSecret: string;
} => {
  const clientId = env[provider.clientIdBinding];
  const clientSecret = env[provider.clientSecretBinding];
  if (!clientId || !clientSecret) {
    const error = new Error(`${provider.name} hosted OAuth is not configured by the mcptest.io operator.`);
    error.name = 'ProviderNotConfiguredError';
    throw error;
  }
  return { clientId, clientSecret };
};

const encryptionKey = async (env: HostedOAuthEnv): Promise<CryptoKey> => {
  if (!env.HOSTED_OAUTH_ENCRYPTION_KEY) throw new Error('Hosted OAuth encryption is not configured.');
  const raw = decodeBase64Url(env.HOSTED_OAUTH_ENCRYPTION_KEY);
  if (raw.byteLength !== 32) throw new Error('Hosted OAuth encryption key must contain 32 bytes.');
  return crypto.subtle.importKey('raw', raw, 'AES-GCM', false, ['encrypt', 'decrypt']);
};

const encryptTokens = async (tokens: ProviderTokens, env: HostedOAuthEnv): Promise<EncryptedValue> => {
  const iv = crypto.getRandomValues(new Uint8Array(12));
  const ciphertext = await crypto.subtle.encrypt(
    { name: 'AES-GCM', iv },
    await encryptionKey(env),
    new TextEncoder().encode(JSON.stringify(tokens))
  );
  return { iv: base64Url(iv), ciphertext: base64Url(new Uint8Array(ciphertext)) };
};

const decryptTokens = async (value: EncryptedValue, env: HostedOAuthEnv): Promise<ProviderTokens> => {
  const plaintext = await crypto.subtle.decrypt(
    { name: 'AES-GCM', iv: decodeBase64Url(value.iv) },
    await encryptionKey(env),
    decodeBase64Url(value.ciphertext)
  );
  return JSON.parse(new TextDecoder().decode(plaintext)) as ProviderTokens;
};

const pkceChallenge = async (verifier: string): Promise<string> => base64Url(new Uint8Array(
  await crypto.subtle.digest('SHA-256', new TextEncoder().encode(verifier))
));

const parseTokenResponse = async (response: Response): Promise<ProviderTokens> => {
  const body = await response.json() as Record<string, unknown>;
  const nestedUser = body.authed_user && typeof body.authed_user === 'object'
    ? body.authed_user as Record<string, unknown>
    : undefined;
  const errorCode = typeof body.error === 'string' ? body.error : undefined;
  if (!response.ok || body.ok === false || errorCode) {
    throw new Error(`Provider token request was rejected${errorCode ? ` (${errorCode})` : ''}.`);
  }
  const accessToken = typeof body.access_token === 'string'
    ? body.access_token
    : typeof nestedUser?.access_token === 'string' ? nestedUser.access_token : undefined;
  if (!accessToken) throw new Error('Provider token response did not contain an access token.');
  const refreshToken = typeof body.refresh_token === 'string'
    ? body.refresh_token
    : typeof nestedUser?.refresh_token === 'string' ? nestedUser.refresh_token : undefined;
  const expiresIn = typeof body.expires_in === 'number'
    ? body.expires_in
    : typeof nestedUser?.expires_in === 'number' ? nestedUser.expires_in : undefined;
  return {
    accessToken,
    ...(refreshToken ? { refreshToken } : {}),
    ...(expiresIn ? { expiresAt: Date.now() + Math.max(0, expiresIn) * 1000 } : {}),
    ...(typeof body.scope === 'string' ? { scope: body.scope } : {}),
  };
};

const requestProviderTokens = async (
  provider: ProviderDefinition,
  env: HostedOAuthEnv,
  parameters: Record<string, string>
): Promise<ProviderTokens> => {
  const client = configuredClient(provider, env);
  const body = new URLSearchParams({
    ...parameters,
    client_id: client.clientId,
    client_secret: client.clientSecret,
  });
  const response = await fetch(provider.tokenEndpoint, {
    method: 'POST',
    headers: { 'Accept': 'application/json', 'Content-Type': 'application/x-www-form-urlencoded' },
    body,
    redirect: 'error',
  });
  return parseTokenResponse(response);
};

const verifyProviderMetadata = async (
  provider: ProviderDefinition,
  requestedResourceMetadataUrl?: string,
  requestedScope = ''
): Promise<void> => {
  if (requestedResourceMetadataUrl && new URL(requestedResourceMetadataUrl).toString() !== provider.resourceMetadataUrl) {
    throw new Error('The observed protected-resource metadata URL does not match the trusted provider target.');
  }
  const resourceResponse = await fetch(provider.resourceMetadataUrl, {
    headers: { Accept: 'application/json' }, redirect: 'error',
  });
  if (!resourceResponse.ok) throw new Error('Trusted provider resource metadata is unavailable.');
  const resource = await resourceResponse.json() as Record<string, unknown>;
  if (
    resource.resource !== provider.resource
    || !Array.isArray(resource.authorization_servers)
    || !resource.authorization_servers.includes(provider.issuer)
  ) throw new Error('Trusted provider resource metadata did not match the allowlist.');
  const supportedScopes = Array.isArray(resource.scopes_supported)
    ? resource.scopes_supported.filter((scope): scope is string => typeof scope === 'string')
    : [];
  if (requestedScope.split(/\s+/).filter(Boolean).some(scope => !supportedScopes.includes(scope))) {
    throw new Error('The requested scope was not advertised by the trusted MCP resource.');
  }

  const authorizationResponse = await fetch(provider.authorizationMetadataUrl, {
    headers: { Accept: 'application/json' }, redirect: 'error',
  });
  if (!authorizationResponse.ok) throw new Error('Trusted provider authorization metadata is unavailable.');
  const authorization = await authorizationResponse.json() as Record<string, unknown>;
  if (
    authorization.issuer !== provider.issuer
    || authorization.authorization_endpoint !== provider.authorizationEndpoint
    || authorization.token_endpoint !== provider.tokenEndpoint
    || !Array.isArray(authorization.code_challenge_methods_supported)
    || !authorization.code_challenge_methods_supported.includes('S256')
  ) throw new Error('Trusted provider authorization metadata did not match the allowlist.');
};

const transactionStub = (env: HostedOAuthEnv, opaque: string): DurableObjectStub => {
  if (!env.HOSTED_OAUTH_BROKER) throw new Error('Hosted OAuth state storage is not configured.');
  return env.HOSTED_OAUTH_BROKER.get(env.HOSTED_OAUTH_BROKER.idFromName(opaque));
};

const stubFetch = (
  env: HostedOAuthEnv,
  opaque: string,
  path: string,
  body?: unknown
): Promise<Response> => transactionStub(env, opaque).fetch(`https://hosted-oauth.internal${path}`, {
  method: body === undefined ? 'GET' : 'POST',
  headers: body === undefined ? undefined : { 'Content-Type': 'application/json' },
  body: body === undefined ? undefined : JSON.stringify(body),
});

export const handleHostedOAuthRequest = async (
  request: Request,
  env: HostedOAuthEnv,
  uid: string | null
): Promise<Response | undefined> => {
  const url = new URL(request.url);
  if (![HOSTED_START_PATH, HOSTED_AUTHORIZE_PATH, HOSTED_CALLBACK_PATH, HOSTED_EXCHANGE_PATH].includes(url.pathname)) {
    return undefined;
  }

  try {
    if (url.pathname === HOSTED_START_PATH) {
      if (request.method !== 'POST') return json({ error: 'method_not_allowed' }, 405);
      if (!uid) return json({ error: 'authentication_required' }, 401);
      const input = await request.json() as Record<string, unknown>;
      const target = typeof input.target === 'string' ? normalizeTarget(input.target) : '';
      const issuer = typeof input.issuer === 'string' ? input.issuer : '';
      const provider = providerForPair(target, issuer);
      if (!provider) return json({ error: 'unsupported_provider_target' }, 400);
      configuredClient(provider, env);
      callbackUrl(env);
      await encryptionKey(env);
      const requestedScope = typeof input.scope === 'string' ? input.scope.trim() : '';
      if (
        requestedScope.length > 2048
        || requestedScope.split(/\s+/).filter(Boolean).some(scope => !/^[A-Za-z0-9:._/-]{1,128}$/.test(scope))
      ) return json({ error: 'invalid_scope' }, 400);
      await verifyProviderMetadata(
        provider,
        typeof input.resourceMetadataUrl === 'string' ? input.resourceMetadataUrl : undefined,
        requestedScope
      );

      const state = randomOpaque();
      const verifier = randomOpaque();
      const record: TransactionRecord = {
        kind: 'transaction', status: 'awaiting_callback', uid,
        provider: provider.id, target, resource: provider.resource,
        resourceMetadataUrl: provider.resourceMetadataUrl, issuer: provider.issuer,
        redirectUri: callbackUrl(env), returnUri: returnUrl(env), verifier, state,
        scope: requestedScope,
        expiresAt: Date.now() + TRANSACTION_TTL_MS,
      };
      const response = await stubFetch(env, state, '/transaction/init', record);
      if (!response.ok) return response;
      return json({ transaction: state, expiresIn: TRANSACTION_TTL_MS / 1000 });
    }

    if (url.pathname === HOSTED_AUTHORIZE_PATH) {
      if (request.method !== 'GET') return json({ error: 'method_not_allowed' }, 405);
      const transaction = url.searchParams.get('transaction') || '';
      if (!OPAQUE_VALUE.test(transaction)) return json({ error: 'invalid_transaction' }, 400);
      const response = await stubFetch(env, transaction, '/transaction/read');
      if (!response.ok) return response;
      const record = await response.json() as TransactionRecord;
      const provider = providerById(record.provider);
      const client = configuredClient(provider, env);
      const authorizationUrl = new URL(provider.authorizationEndpoint);
      authorizationUrl.searchParams.set('response_type', 'code');
      authorizationUrl.searchParams.set('client_id', client.clientId);
      authorizationUrl.searchParams.set('redirect_uri', record.redirectUri);
      authorizationUrl.searchParams.set('state', record.state);
      authorizationUrl.searchParams.set('code_challenge', await pkceChallenge(record.verifier));
      authorizationUrl.searchParams.set('code_challenge_method', 'S256');
      if (record.scope) authorizationUrl.searchParams.set('scope', record.scope);
      return new Response(null, {
        status: 302,
        headers: {
          Location: authorizationUrl.toString(),
          'Cache-Control': 'no-store',
          'Referrer-Policy': 'no-referrer',
        },
      });
    }

    if (url.pathname === HOSTED_CALLBACK_PATH) {
      if (request.method !== 'GET') return json({ error: 'method_not_allowed' }, 405);
      const state = url.searchParams.get('state') || '';
      if (!OPAQUE_VALUE.test(state)) return json({ error: 'invalid_state' }, 400);
      const response = await stubFetch(env, state, '/transaction/callback', {
        state,
        code: url.searchParams.get('code'),
        error: url.searchParams.get('error'),
        iss: url.searchParams.get('iss'),
      });
      if (response.status === 404) return json({ error: 'state_mismatch' }, 400);
      if (!response.ok) return response;
      const result = await response.json() as { completionHandle: string; returnUri: string };
      const destination = new URL(result.returnUri);
      destination.searchParams.set('hosted_result', result.completionHandle);
      return new Response(null, {
        status: 303,
        headers: { Location: destination.toString(), 'Cache-Control': 'no-store', 'Referrer-Policy': 'no-referrer' },
      });
    }

    if (request.method !== 'POST') return json({ error: 'method_not_allowed' }, 405);
    if (!uid) return json({ error: 'authentication_required' }, 401);
    const input = await request.json() as Record<string, unknown>;
    const result = typeof input.result === 'string' ? input.result : '';
    if (!OPAQUE_VALUE.test(result)) return json({ error: 'invalid_result' }, 400);
    return stubFetch(env, result, '/completion/exchange', { uid, result });
  } catch (error) {
    const status = error instanceof Error && error.name === 'ProviderNotConfiguredError' ? 503 : 400;
    return json({
      error: status === 503 ? 'provider_not_configured' : 'hosted_oauth_error',
      message: error instanceof Error ? error.message : 'Hosted OAuth failed.',
    }, status);
  }
};

export const resolveHostedGrant = async (
  env: HostedOAuthEnv,
  grant: string,
  uid: string,
  target: string
): Promise<string> => {
  if (!OPAQUE_VALUE.test(grant)) throw new Error('Invalid hosted OAuth grant.');
  const response = await stubFetch(env, grant, '/grant/resolve', { uid, target: normalizeTarget(target) });
  if (!response.ok) throw new Error('Hosted OAuth grant is invalid, expired, or not valid for this target.');
  const body = await response.json() as { authorization: string };
  return body.authorization;
};

export class HostedOAuthBroker {
  constructor(private readonly state: DurableObjectState, private readonly env: HostedOAuthEnv) {}

  async fetch(request: Request): Promise<Response> {
    const path = new URL(request.url).pathname;
    if (path === '/transaction/init') {
      const existing = await this.state.storage.get<TransactionRecord | CompletionRecord | StoredGrant>('record');
      if (existing) return json({ error: 'replay' }, 409);
      const record = await request.json() as TransactionRecord;
      await this.state.storage.put('record', record);
      return json({ ok: true });
    }

    if (path === '/transaction/read') {
      const record = await this.state.storage.get<TransactionRecord>('record');
      if (!record || record.kind !== 'transaction') return json({ error: 'unknown_transaction' }, 404);
      if (record.expiresAt <= Date.now()) return json({ error: 'transaction_expired' }, 410);
      if (record.status !== 'awaiting_callback') return json({ error: 'transaction_replayed' }, 409);
      return json(record);
    }

    if (path === '/transaction/callback') {
      return this.state.blockConcurrencyWhile(async () => {
        const input = await request.json() as { state?: string; code?: string | null; error?: string | null; iss?: string | null };
        const record = await this.state.storage.get<TransactionRecord>('record');
        if (!record || record.kind !== 'transaction') return json({ error: 'unknown_transaction' }, 404);
        if (record.expiresAt <= Date.now()) return json({ error: 'transaction_expired' }, 410);
        if (record.status !== 'awaiting_callback') return json({ error: 'callback_replayed' }, 409);
        if (input.state !== record.state) return json({ error: 'state_mismatch' }, 400);
        if (input.iss && input.iss !== record.issuer) return json({ error: 'issuer_mismatch' }, 400);
        if (!input.error && !input.code) return json({ error: 'missing_code' }, 400);
        const completionHandle = randomOpaque();
        const completion: CompletionRecord = {
          kind: 'completion', status: 'ready', handle: completionHandle,
          transactionState: record.state, uid: record.uid, expiresAt: record.expiresAt,
        };
        const completionResponse = await stubFetch(this.env, completionHandle, '/completion/init', completion);
        if (!completionResponse.ok) return completionResponse;
        if (input.error) {
          const denied: TransactionRecord = {
            ...record, status: 'denied', completionHandle, providerError: input.error.slice(0, 100),
          };
          await this.state.storage.put('record', denied);
          return json({ completionHandle, returnUri: denied.returnUri });
        }
        const updated: TransactionRecord = {
          ...record, status: 'code_received', code: input.code!, completionHandle,
        };
        await this.state.storage.put('record', updated);
        return json({ completionHandle, returnUri: updated.returnUri });
      });
    }

    if (path === '/transaction/exchange') {
      return this.state.blockConcurrencyWhile(async () => {
        const input = await request.json() as { uid?: string; completionHandle?: string };
        const record = await this.state.storage.get<TransactionRecord>('record');
        if (!record || record.kind !== 'transaction') return json({ error: 'unknown_result' }, 404);
        if (record.expiresAt <= Date.now()) return json({ error: 'result_expired' }, 410);
        if (!record.completionHandle || record.completionHandle !== input.completionHandle) {
          return json({ error: 'unknown_result' }, 404);
        }
        if (record.uid !== input.uid) return json({ error: 'result_user_mismatch' }, 403);
        if (record.status === 'denied') return json({ error: 'authorization_denied' }, 400);
        if (record.status !== 'code_received' || !record.code) return json({ error: 'result_replayed' }, 409);
        const provider = providerById(record.provider);
        try {
          const tokens = await requestProviderTokens(provider, this.env, {
            grant_type: 'authorization_code', code: record.code,
            redirect_uri: record.redirectUri, code_verifier: record.verifier,
          });
          const grant = randomOpaque();
          const storedGrant: StoredGrant = {
            kind: 'grant', uid: record.uid, provider: record.provider,
            target: record.target, resource: record.resource, issuer: record.issuer,
            encryptedTokens: await encryptTokens(tokens, this.env),
            expiresAt: Date.now() + GRANT_TTL_MS,
          };
          const grantResponse = await stubFetch(this.env, grant, '/grant/store', storedGrant);
          if (!grantResponse.ok) throw new Error('Could not retain the hosted OAuth grant.');
          await this.state.storage.put('record', {
            ...record, status: 'exchanged', code: undefined, verifier: '',
          });
          return json({ grant, serverUrl: record.target, issuer: record.issuer });
        } catch (error) {
          return json({
            error: 'provider_token_error',
            message: error instanceof Error ? error.message : 'Provider token exchange failed.',
          }, 502);
        }
      });
    }

    if (path === '/completion/init') {
      const existing = await this.state.storage.get('record');
      if (existing) return json({ error: 'completion_collision' }, 409);
      await this.state.storage.put('record', await request.json<CompletionRecord>());
      return json({ ok: true });
    }

    if (path === '/completion/exchange') {
      return this.state.blockConcurrencyWhile(async () => {
        const input = await request.json() as { uid?: string; result?: string };
        const completion = await this.state.storage.get<CompletionRecord>('record');
        if (!completion || completion.kind !== 'completion' || completion.handle !== input.result) {
          return json({ error: 'unknown_result' }, 404);
        }
        if (completion.expiresAt <= Date.now()) return json({ error: 'result_expired' }, 410);
        if (completion.uid !== input.uid) return json({ error: 'result_user_mismatch' }, 403);
        if (completion.status !== 'ready') return json({ error: 'result_replayed' }, 409);
        const response = await stubFetch(this.env, completion.transactionState, '/transaction/exchange', {
          uid: input.uid,
          completionHandle: completion.handle,
        });
        if (response.status !== 502) {
          await this.state.storage.put('record', { ...completion, status: 'used' });
        }
        return response;
      });
    }

    if (path === '/grant/store') {
      const existing = await this.state.storage.get('record');
      if (existing) return json({ error: 'grant_collision' }, 409);
      await this.state.storage.put('record', await request.json<StoredGrant>());
      return json({ ok: true });
    }

    if (path === '/grant/resolve') {
      return this.state.blockConcurrencyWhile(async () => {
        const input = await request.json() as { uid?: string; target?: string };
        const grant = await this.state.storage.get<StoredGrant>('record');
        if (!grant || grant.kind !== 'grant') return json({ error: 'unknown_grant' }, 404);
        if (grant.expiresAt <= Date.now()) return json({ error: 'grant_expired' }, 410);
        if (grant.uid !== input.uid || grant.target !== input.target) return json({ error: 'grant_binding_mismatch' }, 403);
        let tokens = await decryptTokens(grant.encryptedTokens, this.env);
        if (tokens.expiresAt && tokens.expiresAt <= Date.now() + REFRESH_SKEW_MS) {
          if (!tokens.refreshToken) return json({ error: 'provider_token_expired' }, 401);
          const refreshed = await requestProviderTokens(providerById(grant.provider), this.env, {
            grant_type: 'refresh_token', refresh_token: tokens.refreshToken,
          });
          tokens = { ...refreshed, refreshToken: refreshed.refreshToken || tokens.refreshToken };
          await this.state.storage.put('record', {
            ...grant, encryptedTokens: await encryptTokens(tokens, this.env),
          });
        }
        return json({ authorization: `Bearer ${tokens.accessToken}` });
      });
    }

    return json({ error: 'not_found' }, 404);
  }
}
