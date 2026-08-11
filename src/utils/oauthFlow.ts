import {
  auth,
  discoverOAuthServerInfo,
  RegistrationRejectedError,
  type AuthOptions,
  type AuthResult,
  type FetchLike,
  type OAuthClientInformationContext,
  type OAuthClientMetadata,
  type OAuthClientProvider,
  type OAuthDiscoveryState,
  type StoredOAuthClientInformation,
  type StoredOAuthTokens,
} from '@modelcontextprotocol/client';
import {
  OAuthFlightRecorder,
  createOAuthFlightRecorder,
  createOAuthTraceFetch,
  resumeOAuthFlightRecorder,
  sanitizeOAuthTraceUrl,
} from './oauthTrace';

export {
  OAUTH_TRACE_VERSION,
  OAuthFlightRecorder,
  createOAuthFlightRecorder,
  getStoredOAuthTrace,
  recordOAuthAuthenticationChallenge,
  sanitizeOAuthTraceUrl,
  serializeOAuthTrace,
} from './oauthTrace';
export type {
  OAuthTraceEventV1,
  OAuthTraceEventType,
  OAuthTraceV1,
} from './oauthTrace';

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
  trace?: OAuthFlightRecorder;
}

export interface OAuthFlowOptions extends BrowserOAuthProviderOptions {
  authenticate?: (provider: OAuthClientProvider, options: AuthOptions) => Promise<AuthResult>;
  fetchFn?: FetchLike;
  forceReauthorization?: boolean;
  scope?: string;
  deferAuthorizedTraceOutcome?: boolean;
}

export interface CompletedOAuthFlow {
  serverUrl: string;
  issuer?: string;
}

export interface PrepareManualOAuthClientOptions extends BrowserOAuthProviderOptions {
  discover?: typeof discoverOAuthServerInfo;
  fetchFn?: FetchLike;
}

export interface OAuthAuthorization {
  accessToken: string;
  issuer: string;
  userInfoEndpoint?: string;
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

const issuerForDiscovery = (discovery?: OAuthDiscoveryState): string | undefined => (
  discovery?.authorizationServerMetadata?.issuer
  || discovery?.authorizationServerUrl
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
  private readonly trace?: OAuthFlightRecorder;

  constructor(
    readonly serverUrl: string,
    options: BrowserOAuthProviderOptions = {}
  ) {
    this.serverUrl = normalizeOAuthServerUrl(serverUrl);
    this.storage = options.storage || getSessionStorage();
    this.storeKey = storageKeyForServer(this.serverUrl);
    this.redirectUrl = options.redirectUrl || defaultRedirectUrl();
    this.redirect = options.redirect || defaultRedirect;
    this.trace = options.trace;

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
    // If a refresh response remains provisional when the SDK proceeds to
    // state generation, it was rejected in favor of a fresh authorization.
    this.trace?.settleLatestProvisionalOAuthResponse('failed', ['refresh']);
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
      this.trace?.registerSecret(manualClient.clientSecret);
      if (!this.trace?.hasEvent('pre_registered_client', 'succeeded')) {
        this.trace?.record({
          type: 'pre_registered_client',
          outcome: 'succeeded',
          provenance: 'oauth_client',
          route: 'client',
          explanation: 'Using the pre-registered OAuth client configured for this authorization server.',
          response: { metadata: { issuer: ctx.issuer, hasClientSecret: Boolean(manualClient.clientSecret) } },
        });
      }
      return {
        client_id: manualClient.clientId,
        ...(manualClient.clientSecret ? { client_secret: manualClient.clientSecret } : {}),
        issuer: manualClient.issuer,
      };
    }

    const storedClient = this.readState().clients?.[ctx.issuer];
    if (storedClient?.client_secret) this.trace?.registerSecret(storedClient.client_secret);
    return storedClient?.registeredManually ? undefined : storedClient;
  }

  manualClientInformation(): ManualOAuthClient | undefined {
    const discovery = this.discoveryState();
    const issuer = discovery?.authorizationServerMetadata?.issuer
      || discovery?.authorizationServerUrl;
    return issuer ? this.readManualClient(issuer) : undefined;
  }

  saveClientInformation(
    clientInformation: PersistedOAuthClientInformation,
    ctx?: OAuthClientInformationContext
  ): void {
    const issuer = ctx?.issuer || clientInformation.issuer;
    if (!issuer) throw new Error('Cannot store OAuth client information without an issuer.');
    this.trace?.registerSecret(clientInformation.client_secret);

    const state = this.readState();
    this.writeState({
      ...state,
      clients: { ...state.clients, [issuer]: clientInformation },
    });
    if (!clientInformation.registeredManually) {
      const response = {
        metadata: { issuer, clientIdAssigned: Boolean(clientInformation.client_id) },
      };
      if (!this.trace?.enrichLast('dynamic_client_registration', {
        outcome: 'succeeded',
        explanation: 'Dynamic client registration succeeded and the client information was stored.',
        response,
      })) {
        this.trace?.record({
          type: 'dynamic_client_registration',
          outcome: 'succeeded',
          provenance: 'authorization_server',
          route: 'direct',
          explanation: 'Dynamic client registration succeeded and the client information was stored.',
          response,
        });
      }
    }
  }

  tokens(ctx?: OAuthClientInformationContext): StoredOAuthTokens | undefined {
    const state = this.readState();
    const storedTokens = Object.values(state.tokens || {});
    const tokens = ctx?.issuer
      ? state.tokens?.[ctx.issuer]
      : state.latestIssuer
        ? state.tokens?.[state.latestIssuer]
        : storedTokens.length === 1
          ? storedTokens[0]
          : undefined;
    this.trace?.registerSecret(tokens?.access_token, tokens?.refresh_token);
    return tokens;
  }

  saveTokens(tokens: StoredOAuthTokens, ctx?: OAuthClientInformationContext): void {
    const issuer = ctx?.issuer || tokens.issuer;
    if (!issuer) throw new Error('Cannot store OAuth tokens without an issuer.');
    this.trace?.registerSecret(tokens.access_token, tokens.refresh_token);
    this.trace?.settleLatestProvisionalOAuthResponse('succeeded', [
      'token_exchange',
      'refresh',
    ]);

    const state = this.readState();
    this.writeState({
      ...state,
      tokens: { ...state.tokens, [issuer]: tokens },
      latestIssuer: issuer,
    });

    this.writeLegacyTokens(tokens);
  }

  syncLegacyTokens(): StoredOAuthTokens | undefined {
    const issuer = issuerForDiscovery(this.discoveryState());
    const tokens = issuer ? this.tokens({ issuer }) : undefined;
    if (tokens) this.writeLegacyTokens(tokens);
    return tokens;
  }

  redirectToAuthorization(authorizationUrl: URL): void | Promise<void> {
    const selectedClientId = authorizationUrl.searchParams.get('client_id');
    if (this.clientMetadataUrl && selectedClientId === this.clientMetadataUrl) {
      this.trace?.record({
        type: 'cimd',
        outcome: 'succeeded',
        provenance: 'oauth_client',
        route: 'client',
        explanation: 'The authorization server advertised Client ID Metadata Documents, so the published client metadata URL was selected.',
        request: { method: 'GET', url: sanitizeOAuthTraceUrl(this.clientMetadataUrl) },
      });
    }
    this.trace?.record({
      type: 'authorization_redirect',
      outcome: 'redirected',
      provenance: 'authorization_server',
      route: 'browser',
      explanation: 'Redirecting the browser to the authorization endpoint.',
      request: { method: 'GET', url: sanitizeOAuthTraceUrl(authorizationUrl) },
    });
    return this.redirect(authorizationUrl);
  }

  saveCodeVerifier(codeVerifier: string): void {
    this.trace?.registerSecret(codeVerifier);
    this.updateState({ codeVerifier });
    this.trace?.record({
      type: 'pkce',
      outcome: 'succeeded',
      provenance: 'oauth_client',
      route: 'client',
      explanation: 'Generated and stored a PKCE verifier for the authorization-code flow.',
      response: { metadata: { method: 'S256' } },
    });
  }

  codeVerifier(): string {
    const codeVerifier = this.readState().codeVerifier;
    if (!codeVerifier) throw new Error('OAuth PKCE verifier is missing. Start authentication again.');
    this.trace?.registerSecret(codeVerifier);
    return codeVerifier;
  }

  saveDiscoveryState(discovery: OAuthDiscoveryState): void {
    this.updateState({ discovery });
    const resourceResponse = {
      metadata: {
        resource: discovery.resourceMetadata?.resource,
        authorizationServers: discovery.resourceMetadata?.authorization_servers,
        resourceMetadataUrl: discovery.resourceMetadataUrl,
      },
    };
    if (discovery.resourceMetadata) {
      if (!this.trace?.enrichLast('protected_resource_metadata', {
        outcome: 'succeeded',
        explanation: 'Protected-resource metadata identified the authorization server for this MCP target.',
        response: resourceResponse,
      })) {
        this.trace?.record({
          type: 'protected_resource_metadata',
          outcome: 'succeeded',
          provenance: 'direct_target',
          route: 'direct',
          explanation: 'Protected-resource metadata identified the authorization server for this MCP target.',
          response: resourceResponse,
        });
      }
    } else if (!this.trace?.hasEvent('protected_resource_metadata')) {
      this.trace?.record({
        type: 'protected_resource_metadata',
        outcome: 'skipped',
        provenance: 'direct_target',
        route: 'direct',
        explanation: 'Protected-resource metadata was unavailable, so OAuth discovery used the target URL fallback.',
        response: resourceResponse,
      });
    }

    const metadata = discovery.authorizationServerMetadata;
    const serverResponse = {
      metadata: {
        issuer: metadata?.issuer || discovery.authorizationServerUrl,
        authorizationEndpoint: metadata?.authorization_endpoint,
        tokenEndpoint: metadata?.token_endpoint,
        registrationEndpoint: metadata?.registration_endpoint,
        codeChallengeMethodsSupported: metadata?.code_challenge_methods_supported,
        clientIdMetadataDocumentSupported: metadata?.client_id_metadata_document_supported,
      },
    };
    const outcome = metadata ? 'succeeded' : 'failed';
    const explanation = metadata
      ? 'Authorization-server metadata was discovered and validated.'
      : 'Authorization-server metadata was not available.';
    if (!this.trace?.enrichLast('authorization_server_metadata', {
      outcome,
      explanation,
      response: serverResponse,
    })) {
      this.trace?.record({
        type: 'authorization_server_metadata',
        outcome,
        provenance: 'authorization_server',
        route: 'direct',
        explanation,
        response: serverResponse,
      });
    }
  }

  discoveryState(): OAuthDiscoveryState | undefined {
    return this.readState().discovery;
  }

  invalidateCredentials(scope: 'all' | 'client' | 'tokens' | 'verifier' | 'discovery'): void {
    if (scope === 'all') {
      const tokens = this.readState().tokens;
      this.storage.removeItem(this.storeKey);
      this.clearLegacyTokens(tokens);
      this.storage.removeItem(`oauth_client_${legacyHostForServer(this.serverUrl)}`);
      return;
    }

    const state = this.readState();
    if (scope === 'client') {
      delete state.clients;
      this.storage.removeItem(`oauth_client_${legacyHostForServer(this.serverUrl)}`);
    }
    if (scope === 'tokens') {
      const tokens = state.tokens;
      delete state.tokens;
      delete state.latestIssuer;
      this.clearLegacyTokens(tokens);
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

  private clearLegacyTokens(tokens?: Record<string, StoredOAuthTokens>): void {
    const host = legacyHostForServer(this.serverUrl);
    const storedTokens = Object.values(tokens || {});
    const accessTokenKey = `oauth_access_token_${host}`;
    const refreshTokenKey = `oauth_refresh_token_${host}`;
    const legacyAccessToken = this.storage.getItem(accessTokenKey);
    const legacyRefreshToken = this.storage.getItem(refreshTokenKey);

    if (storedTokens.some((token) => token.access_token === legacyAccessToken)) {
      this.storage.removeItem(accessTokenKey);
    }
    if (storedTokens.some((token) => token.refresh_token === legacyRefreshToken)) {
      this.storage.removeItem(refreshTokenKey);
    }
  }
}

/**
 * Loads authorization only from the SDK state for this exact MCP resource and
 * its discovered authorization-server issuer. Host-only keys are intentionally
 * excluded because multiple resources and issuers can share a host.
 */
export const loadOAuthAuthorization = (
  serverUrl: string,
  storage: OAuthStorage = getSessionStorage()
): OAuthAuthorization | undefined => {
  const provider = new BrowserOAuthProvider(serverUrl, { storage });
  const discovery = provider.discoveryState();
  const issuer = issuerForDiscovery(discovery);
  if (!issuer) return undefined;

  const tokens = provider.tokens({ issuer });
  if (!tokens || (tokens.issuer && tokens.issuer !== issuer)) return undefined;

  const metadata = discovery?.authorizationServerMetadata as
    | (OAuthDiscoveryState['authorizationServerMetadata'] & { userinfo_endpoint?: unknown })
    | undefined;
  const userInfoEndpoint = typeof metadata?.userinfo_endpoint === 'string'
    ? metadata.userinfo_endpoint
    : undefined;

  return {
    accessToken: tokens.access_token,
    issuer,
    ...(userInfoEndpoint ? { userInfoEndpoint } : {}),
  };
};

export const beginOAuthFlow = async (
  serverUrl: string,
  options: OAuthFlowOptions = {}
): Promise<AuthResult> => {
  const normalizedServerUrl = normalizeOAuthServerUrl(serverUrl);
  const storage = options.storage || getSessionStorage();
  storage.setItem(OAUTH_SERVER_URL_KEY, normalizedServerUrl);
  const pendingTrace = options.trace || resumeOAuthFlightRecorder(normalizedServerUrl, storage);
  const pendingOutcome = pendingTrace?.snapshot().outcome?.status;
  const continuesAfterManualClient = pendingOutcome === 'manual_client_required';
  const carriesChallengeDrivenRetry = Boolean(
    pendingTrace?.hasAuthenticatedMcpRetryState()
    || (
      continuesAfterManualClient
      && pendingTrace.hasEvent('target_challenge')
    )
  );
  const trace = pendingTrace && (!pendingOutcome || continuesAfterManualClient)
    ? pendingTrace
    : createOAuthFlightRecorder({ targetUrl: normalizedServerUrl, storage });
  if (continuesAfterManualClient) {
    trace.continueAfterManualClientRequired();
  }
  if (carriesChallengeDrivenRetry) {
    trace.setAuthenticatedMcpRetryState('awaiting_callback');
  }
  const provider = new BrowserOAuthProvider(normalizedServerUrl, { ...options, trace });
  provider.invalidateCredentials('verifier');
  const authenticate = options.authenticate || auth;
  const fetchFn = createOAuthTraceFetch(trace, options.fetchFn || fetch);
  try {
    const result = await authenticate(provider, {
      serverUrl: normalizedServerUrl,
      fetchFn,
      ...(options.scope ? { scope: options.scope } : {}),
      ...(options.forceReauthorization ? { forceReauthorization: true } : {}),
    });
    if (result === 'AUTHORIZED') {
      provider.syncLegacyTokens();
      if (
        options.deferAuthorizedTraceOutcome
        && (trace.hasEvent('target_challenge') || trace.hasAuthenticatedMcpRetryState())
      ) {
        trace.setAuthenticatedMcpRetryState('pending');
      } else if (!options.deferAuthorizedTraceOutcome) {
        trace.terminal('authorized', 'OAuth authorization is available for the MCP target.');
      }
    } else {
      if (trace.hasEvent('target_challenge') || trace.hasAuthenticatedMcpRetryState()) {
        trace.setAuthenticatedMcpRetryState('awaiting_callback');
      } else {
        trace.terminal('redirected', 'OAuth authorization is awaiting the browser callback.');
      }
    }
    return result;
  } catch (error) {
    trace.settleLatestProvisionalOAuthResponse('failed');
    if (isOAuthClientConfigurationRequired(error)) {
      trace.record({
        type: 'pre_registered_client',
        outcome: 'required',
        provenance: 'oauth_client',
        route: 'client',
        explanation: 'CIMD and dynamic registration were unavailable; a pre-registered OAuth client is required.',
      });
      trace.terminal(
        'manual_client_required',
        'OAuth discovery completed, but the authorization server requires a pre-registered client.'
      );
    } else {
      trace.terminal(
        'failed',
        `OAuth authorization failed${error instanceof Error ? ` during ${error.name}` : ''}.`
      );
    }
    throw error;
  }
};

export const prepareManualOAuthClient = async (
  serverUrl: string,
  options: PrepareManualOAuthClientOptions = {}
): Promise<void> => {
  const normalizedServerUrl = normalizeOAuthServerUrl(serverUrl);
  const storage = options.storage || getSessionStorage();
  const trace = options.trace
    || resumeOAuthFlightRecorder(normalizedServerUrl, storage)
    || createOAuthFlightRecorder({ targetUrl: normalizedServerUrl, storage });
  const { discover, fetchFn, ...providerOptions } = options;
  const provider = new BrowserOAuthProvider(normalizedServerUrl, { ...providerOptions, storage, trace });
  try {
    const discovery = provider.discoveryState() || (discover
      ? await discover(normalizedServerUrl)
      : await discoverOAuthServerInfo(normalizedServerUrl, {
        fetchFn: createOAuthTraceFetch(trace, fetchFn || fetch),
      }));
    provider.saveDiscoveryState(discovery);
  } catch (error) {
    trace.settleLatestProvisionalOAuthResponse('failed');
    trace.terminal('failed', 'OAuth metadata discovery failed while preparing manual client registration.');
    throw error;
  }
};

export const completeOAuthFlow = async (
  callbackUrl: string | URL,
  options: OAuthFlowOptions = {}
): Promise<CompletedOAuthFlow> => {
  const storage = options.storage || getSessionStorage();
  const serverUrl = storage.getItem(OAUTH_SERVER_URL_KEY);
  if (!serverUrl) throw new Error('OAuth server context is missing. Start authentication again.');

  const callback = callbackUrl instanceof URL ? callbackUrl : new URL(callbackUrl);
  const trace = options.trace
    || resumeOAuthFlightRecorder(serverUrl, storage)
    || createOAuthFlightRecorder({ targetUrl: serverUrl, storage });
  const authorizationCode = callback.searchParams.get('code');
  const callbackState = callback.searchParams.get('state');
  trace.registerSecret(authorizationCode, callbackState);
  trace.record({
    type: 'callback',
    outcome: 'started',
    provenance: 'browser_callback',
    route: 'browser',
    explanation: 'Received the browser authorization callback and began validating it.',
    request: { method: 'GET', url: sanitizeOAuthTraceUrl(callback) },
  });

  const provider = new BrowserOAuthProvider(serverUrl, { ...options, trace });
  try {
    provider.assertState(callbackState);

    const responseError = callback.searchParams.get('error');
    if (responseError) {
      throw new OAuthAuthorizationResponseError(
        responseError,
        callback.searchParams.get('error_description')
      );
    }

    if (!authorizationCode) throw new Error('OAuth callback did not include an authorization code.');

    const issuer = callback.searchParams.get('iss') || undefined;
    const authenticate = options.authenticate || auth;
    const result = await authenticate(provider, {
      serverUrl,
      authorizationCode,
      fetchFn: createOAuthTraceFetch(trace, options.fetchFn || fetch),
      ...(issuer ? { iss: issuer } : {}),
    });
    if (result !== 'AUTHORIZED') throw new Error('OAuth callback did not complete authorization.');

    trace.enrichLast('callback', {
      outcome: 'succeeded',
      explanation: 'The browser callback was valid and the authorization code was exchanged successfully.',
    });
    provider.invalidateCredentials('verifier');
    storage.setItem('oauth_completed_time', Date.now().toString());
    if (trace.hasEvent('target_challenge') || trace.hasAuthenticatedMcpRetryState()) {
      trace.setAuthenticatedMcpRetryState('pending');
    } else {
      trace.terminal('authorized', 'OAuth authorization completed successfully.');
    }
    return { serverUrl, issuer };
  } catch (error) {
    trace.settleLatestProvisionalOAuthResponse('failed');
    trace.enrichLast('callback', {
      outcome: 'failed',
      explanation: error instanceof OAuthStateMismatchError
        ? 'The browser callback failed state validation before token exchange.'
        : error instanceof OAuthAuthorizationResponseError
          ? 'The authorization server returned an error in the browser callback.'
          : !authorizationCode
            ? 'The browser callback did not contain an authorization code.'
            : 'The browser callback could not complete OAuth authorization.',
    });
    trace.terminal('failed', 'OAuth authorization failed while processing the browser callback.');
    throw error;
  }
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
