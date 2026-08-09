import {
  auth,
  RegistrationRejectedError,
  type AuthOptions,
  type AuthResult,
  type OAuthClientInformationContext,
  type OAuthClientMetadata,
  type OAuthClientProvider,
  type OAuthDiscoveryState,
  type StoredOAuthClientInformation,
  type StoredOAuthTokens,
} from '@modelcontextprotocol/client';

const PRODUCTION_ORIGIN = 'https://mcptest.io';
export const OAUTH_CALLBACK_PATH = '/oauth/callback';
export const OAUTH_CLIENT_METADATA_URL = `${PRODUCTION_ORIGIN}/oauth/client-metadata.json`;

const OAUTH_SERVER_URL_KEY = 'oauth_server_url';
const OAUTH_STORE_PREFIX = 'mcp_oauth_v2:';

type OAuthStorage = Pick<Storage, 'getItem' | 'setItem' | 'removeItem'>;

interface PersistedOAuthState {
  clients?: Record<string, PersistedOAuthClientInformation>;
  tokens?: Record<string, StoredOAuthTokens>;
  latestIssuer?: string;
  codeVerifier?: string;
  expectedState?: string;
  discovery?: OAuthDiscoveryState;
}

interface LegacyOAuthClient {
  clientId?: string;
  clientSecret?: string;
  issuer?: string;
  registeredManually?: boolean;
}

type PersistedOAuthClientInformation = StoredOAuthClientInformation & {
  registeredManually?: boolean;
};

export interface ManualOAuthClient {
  clientId: string;
  clientSecret?: string;
  issuer: string;
}

export interface BrowserOAuthProviderOptions {
  storage?: OAuthStorage;
  redirectUrl?: string;
  clientMetadataUrl?: string;
  redirect?: (authorizationUrl: URL) => void | Promise<void>;
}

export interface OAuthFlowOptions extends BrowserOAuthProviderOptions {
  authenticate?: (provider: OAuthClientProvider, options: AuthOptions) => Promise<AuthResult>;
  forceReauthorization?: boolean;
  scope?: string;
}

export interface CompletedOAuthFlow {
  serverUrl: string;
  issuer?: string;
}

export class OAuthStateMismatchError extends Error {
  constructor() {
    super('OAuth state validation failed. Start authentication again from mcptest.io.');
    this.name = 'OAuthStateMismatchError';
  }
}

export class OAuthAuthorizationResponseError extends Error {
  constructor(readonly errorCode: string, description?: string | null) {
    super(description ? `Authorization failed: ${description}` : `Authorization failed: ${errorCode}`);
    this.name = 'OAuthAuthorizationResponseError';
  }
}

const getSessionStorage = (): OAuthStorage => {
  if (typeof sessionStorage === 'undefined') {
    throw new Error('OAuth requires browser session storage.');
  }
  return sessionStorage;
};

const withProtocol = (value: string): string => (
  /^https?:\/\//i.test(value) ? value : `https://${value}`
);

export const normalizeOAuthServerUrl = (value: string): string => (
  new URL(withProtocol(value)).toString()
);

const storageKeyForServer = (serverUrl: string): string => (
  `${OAUTH_STORE_PREFIX}${encodeURIComponent(normalizeOAuthServerUrl(serverUrl))}`
);

const legacyHostForServer = (serverUrl: string): string => (
  new URL(normalizeOAuthServerUrl(serverUrl)).host
);

const parseJson = <T,>(value: string | null): T | undefined => {
  if (!value) return undefined;
  try {
    return JSON.parse(value) as T;
  } catch {
    return undefined;
  }
};

const randomState = (): string => {
  const bytes = new Uint8Array(32);
  crypto.getRandomValues(bytes);
  return btoa(String.fromCharCode(...bytes))
    .replace(/\+/g, '-')
    .replace(/\//g, '_')
    .replace(/=+$/, '');
};

const defaultRedirectUrl = (): string => {
  if (typeof window === 'undefined') {
    return `${PRODUCTION_ORIGIN}${OAUTH_CALLBACK_PATH}`;
  }
  return `${window.location.origin}${OAUTH_CALLBACK_PATH}`;
};

const defaultRedirect = (authorizationUrl: URL): void => {
  window.location.assign(authorizationUrl.toString());
};

export class BrowserOAuthProvider implements OAuthClientProvider {
  readonly redirectUrl: string;
  readonly clientMetadataUrl?: string;

  private readonly storage: OAuthStorage;
  private readonly storeKey: string;
  private readonly redirect: (authorizationUrl: URL) => void | Promise<void>;

  constructor(
    readonly serverUrl: string,
    options: BrowserOAuthProviderOptions = {}
  ) {
    this.serverUrl = normalizeOAuthServerUrl(serverUrl);
    this.storage = options.storage || getSessionStorage();
    this.storeKey = storageKeyForServer(this.serverUrl);
    this.redirectUrl = options.redirectUrl || defaultRedirectUrl();
    this.redirect = options.redirect || defaultRedirect;

    const productionCallback = `${PRODUCTION_ORIGIN}${OAUTH_CALLBACK_PATH}`;
    this.clientMetadataUrl = options.clientMetadataUrl ?? (
      this.redirectUrl === productionCallback ? OAUTH_CLIENT_METADATA_URL : undefined
    );
  }

  get clientMetadata(): OAuthClientMetadata {
    const callbackUrl = new URL(this.redirectUrl);
    return {
      redirect_uris: [callbackUrl.toString()],
      client_name: 'mcptest.io MCP Inspector',
      client_uri: callbackUrl.origin,
      logo_uri: `${callbackUrl.origin}/logo.png`,
      grant_types: ['authorization_code', 'refresh_token'],
      response_types: ['code'],
      token_endpoint_auth_method: 'none',
      application_type: 'web',
    };
  }

  state(): string {
    const value = randomState();
    this.updateState({ expectedState: value });
    return value;
  }

  assertState(actualState: string | null): void {
    const expectedState = this.readState().expectedState;
    if (!expectedState || !actualState || expectedState !== actualState) {
      throw new OAuthStateMismatchError();
    }
  }

  clientInformation(
    ctx?: OAuthClientInformationContext
  ): StoredOAuthClientInformation | undefined {
    if (!ctx?.issuer) return undefined;

    const manualClient = this.readManualClient(ctx.issuer);
    if (manualClient) {
      return {
        client_id: manualClient.clientId,
        ...(manualClient.clientSecret ? { client_secret: manualClient.clientSecret } : {}),
        issuer: manualClient.issuer,
      };
    }

    const storedClient = this.readState().clients?.[ctx.issuer];
    return storedClient?.registeredManually ? undefined : storedClient;
  }

  manualClientInformation(): ManualOAuthClient | undefined {
    const discovery = this.discoveryState();
    const issuer = discovery?.authorizationServerMetadata?.issuer
      || discovery?.authorizationServerUrl;
    return issuer ? this.readManualClient(issuer) : undefined;
  }

  saveClientInformation(
    clientInformation: StoredOAuthClientInformation,
    ctx?: OAuthClientInformationContext
  ): void {
    const issuer = ctx?.issuer || clientInformation.issuer;
    if (!issuer) throw new Error('Cannot store OAuth client information without an issuer.');

    const state = this.readState();
    this.writeState({
      ...state,
      clients: { ...state.clients, [issuer]: clientInformation },
    });
  }

  tokens(ctx?: OAuthClientInformationContext): StoredOAuthTokens | undefined {
    const state = this.readState();
    if (ctx?.issuer) return state.tokens?.[ctx.issuer];
    if (state.latestIssuer) return state.tokens?.[state.latestIssuer];

    const storedTokens = Object.values(state.tokens || {});
    return storedTokens.length === 1 ? storedTokens[0] : undefined;
  }

  saveTokens(tokens: StoredOAuthTokens, ctx?: OAuthClientInformationContext): void {
    const issuer = ctx?.issuer || tokens.issuer;
    if (!issuer) throw new Error('Cannot store OAuth tokens without an issuer.');

    const state = this.readState();
    this.writeState({
      ...state,
      tokens: { ...state.tokens, [issuer]: tokens },
      latestIssuer: issuer,
    });

    this.writeLegacyTokens(tokens);
  }

  syncLegacyTokens(): StoredOAuthTokens | undefined {
    const tokens = this.tokens();
    if (tokens) this.writeLegacyTokens(tokens);
    return tokens;
  }

  redirectToAuthorization(authorizationUrl: URL): void | Promise<void> {
    return this.redirect(authorizationUrl);
  }

  saveCodeVerifier(codeVerifier: string): void {
    this.updateState({ codeVerifier });
  }

  codeVerifier(): string {
    const codeVerifier = this.readState().codeVerifier;
    if (!codeVerifier) throw new Error('OAuth PKCE verifier is missing. Start authentication again.');
    return codeVerifier;
  }

  saveDiscoveryState(discovery: OAuthDiscoveryState): void {
    this.updateState({ discovery });
  }

  discoveryState(): OAuthDiscoveryState | undefined {
    return this.readState().discovery;
  }

  invalidateCredentials(scope: 'all' | 'client' | 'tokens' | 'verifier' | 'discovery'): void {
    if (scope === 'all') {
      this.storage.removeItem(this.storeKey);
      this.clearLegacyTokens();
      this.storage.removeItem(`oauth_client_${legacyHostForServer(this.serverUrl)}`);
      return;
    }

    const state = this.readState();
    if (scope === 'client') {
      delete state.clients;
      this.storage.removeItem(`oauth_client_${legacyHostForServer(this.serverUrl)}`);
    }
    if (scope === 'tokens') {
      delete state.tokens;
      delete state.latestIssuer;
      this.clearLegacyTokens();
    }
    if (scope === 'verifier') {
      delete state.codeVerifier;
      delete state.expectedState;
    }
    if (scope === 'discovery') delete state.discovery;
    this.writeState(state);
  }

  private readState(): PersistedOAuthState {
    return parseJson<PersistedOAuthState>(this.storage.getItem(this.storeKey)) || {};
  }

  private writeState(state: PersistedOAuthState): void {
    this.storage.setItem(this.storeKey, JSON.stringify(state));
  }

  private updateState(update: Partial<PersistedOAuthState>): void {
    this.writeState({ ...this.readState(), ...update });
  }

  private readLegacyManualClient(issuer?: string): LegacyOAuthClient | undefined {
    const value = parseJson<LegacyOAuthClient>(
      this.storage.getItem(`oauth_client_${legacyHostForServer(this.serverUrl)}`)
    );
    return value?.registeredManually && issuer && value.issuer === issuer ? value : undefined;
  }

  private readManualClient(issuer: string): ManualOAuthClient | undefined {
    const storedClient = this.readState().clients?.[issuer];
    if (
      storedClient?.registeredManually
      && storedClient.issuer === issuer
      && storedClient.client_id
    ) {
      return {
        clientId: storedClient.client_id,
        ...(storedClient.client_secret ? { clientSecret: storedClient.client_secret } : {}),
        issuer,
      };
    }

    const legacyClient = this.readLegacyManualClient(issuer);
    if (!legacyClient?.clientId || legacyClient.issuer !== issuer) return undefined;
    return {
      clientId: legacyClient.clientId,
      ...(legacyClient.clientSecret ? { clientSecret: legacyClient.clientSecret } : {}),
      issuer,
    };
  }

  private writeLegacyTokens(tokens: StoredOAuthTokens): void {
    const host = legacyHostForServer(this.serverUrl);
    this.storage.setItem(`oauth_access_token_${host}`, tokens.access_token);
    if (tokens.refresh_token) {
      this.storage.setItem(`oauth_refresh_token_${host}`, tokens.refresh_token);
    } else {
      this.storage.removeItem(`oauth_refresh_token_${host}`);
    }
  }

  private clearLegacyTokens(): void {
    const host = legacyHostForServer(this.serverUrl);
    this.storage.removeItem(`oauth_access_token_${host}`);
    this.storage.removeItem(`oauth_refresh_token_${host}`);
  }
}

export const beginOAuthFlow = async (
  serverUrl: string,
  options: OAuthFlowOptions = {}
): Promise<AuthResult> => {
  const normalizedServerUrl = normalizeOAuthServerUrl(serverUrl);
  const storage = options.storage || getSessionStorage();
  storage.setItem(OAUTH_SERVER_URL_KEY, normalizedServerUrl);

  const provider = new BrowserOAuthProvider(normalizedServerUrl, options);
  provider.invalidateCredentials('verifier');
  const authenticate = options.authenticate || auth;
  const result = await authenticate(provider, {
    serverUrl: normalizedServerUrl,
    ...(options.scope ? { scope: options.scope } : {}),
    ...(options.forceReauthorization ? { forceReauthorization: true } : {}),
  });
  if (result === 'AUTHORIZED') provider.syncLegacyTokens();
  return result;
};

export const completeOAuthFlow = async (
  callbackUrl: string | URL,
  options: OAuthFlowOptions = {}
): Promise<CompletedOAuthFlow> => {
  const storage = options.storage || getSessionStorage();
  const serverUrl = storage.getItem(OAUTH_SERVER_URL_KEY);
  if (!serverUrl) throw new Error('OAuth server context is missing. Start authentication again.');

  const callback = callbackUrl instanceof URL ? callbackUrl : new URL(callbackUrl);
  const provider = new BrowserOAuthProvider(serverUrl, options);
  provider.assertState(callback.searchParams.get('state'));

  const responseError = callback.searchParams.get('error');
  if (responseError) {
    throw new OAuthAuthorizationResponseError(
      responseError,
      callback.searchParams.get('error_description')
    );
  }

  const authorizationCode = callback.searchParams.get('code');
  if (!authorizationCode) throw new Error('OAuth callback did not include an authorization code.');

  const issuer = callback.searchParams.get('iss') || undefined;
  const authenticate = options.authenticate || auth;
  const result = await authenticate(provider, {
    serverUrl,
    authorizationCode,
    ...(issuer ? { iss: issuer } : {}),
  });
  if (result !== 'AUTHORIZED') throw new Error('OAuth callback did not complete authorization.');

  provider.invalidateCredentials('verifier');
  storage.setItem('oauth_completed_time', Date.now().toString());
  return { serverUrl, issuer };
};

export const clearOAuthTokens = (
  serverUrl: string,
  storage: OAuthStorage = getSessionStorage()
): void => {
  new BrowserOAuthProvider(serverUrl, { storage }).invalidateCredentials('tokens');
};

export const saveManualOAuthClient = (
  serverUrl: string,
  clientId: string,
  clientSecret?: string,
  storage: OAuthStorage = getSessionStorage()
): void => {
  const provider = new BrowserOAuthProvider(serverUrl, { storage });
  const discovery = provider.discoveryState();
  const issuer = discovery?.authorizationServerMetadata?.issuer
    || discovery?.authorizationServerUrl;
  if (!issuer) {
    throw new Error('Authorization-server discovery is missing. Restart OAuth before configuring a client.');
  }

  provider.saveClientInformation({
    client_id: clientId,
    ...(clientSecret ? { client_secret: clientSecret } : {}),
    issuer,
    registeredManually: true,
  }, { issuer });
};

export const loadManualOAuthClient = (
  serverUrl: string,
  storage: OAuthStorage = getSessionStorage()
): ManualOAuthClient | undefined => (
  new BrowserOAuthProvider(serverUrl, { storage }).manualClientInformation()
);

export const isOAuthClientConfigurationRequired = (error: unknown): boolean => (
  error instanceof RegistrationRejectedError
  || (
    error instanceof Error
    && (
      error.message.includes('does not support dynamic client registration')
      || error.message.includes('OAuth client information must be saveable')
    )
  )
);
