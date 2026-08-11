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
  markOAuthTraceErrorOrigin,
  markOAuthTraceResponseOrigin,
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
  /** Exact RFC 9728 location observed in the target's WWW-Authenticate challenge. */
  resourceMetadataUrl?: string | URL;
  /** Authenticated proxy used only after a browser CORS failure on safe discovery GETs. */
  discoveryProxy?: OAuthDiscoveryProxyOptions;
  deferAuthorizedTraceOutcome?: boolean;
}

export interface OAuthDiscoveryProxyOptions {
  url: string;
  authorizationToken: string;
  fetchFn?: FetchLike;
}

export type OAuthPrerequisiteKind =
  | 'pre_registered_client_required'
  | 'provider_approval_required'
  | 'discovery_blocked_invalid';

export interface OAuthPrerequisite {
  kind: OAuthPrerequisiteKind;
  serverUrl: string;
  providerName: string;
  explanation: string;
  issuer?: string;
  registrationEndpoint?: string;
  documentationUrl?: string;
  registrationUrl?: string;
  requiredScopes: string[];
  pkceS256: boolean;
  publicClientSecretSupported: boolean | 'unknown';
  canConfigureClient: boolean;
  failedStage?: string;
  httpStatus?: number;
}

export class OAuthPrerequisiteError extends Error {
  readonly cause?: unknown;

  constructor(readonly prerequisite: OAuthPrerequisite, options?: { cause?: unknown }) {
    super(prerequisite.explanation);
    this.name = 'OAuthPrerequisiteError';
    this.cause = options?.cause;
  }
}

export interface CompletedOAuthFlow {
  serverUrl: string;
  issuer?: string;
}

export interface PrepareManualOAuthClientOptions extends BrowserOAuthProviderOptions {
  discover?: typeof discoverOAuthServerInfo;
  fetchFn?: FetchLike;
  /** Exact RFC 9728 location observed in the target's WWW-Authenticate challenge. */
  resourceMetadataUrl?: string | URL;
  /** Authenticated proxy used only after a browser CORS failure on safe discovery GETs. */
  discoveryProxy?: OAuthDiscoveryProxyOptions;
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

const providerGuidance = (serverUrl: string, issuer?: string): {
  name: string;
  documentationUrl?: string;
  registrationUrl?: string;
  publicClientSecretSupported?: boolean;
} => {
  // These entries affect explanatory copy and outbound documentation links
  // only. Discovery, capability ordering, and outcome classification remain
  // entirely challenge/metadata driven.
  const hosts = [serverUrl, issuer].flatMap((value) => {
    if (!value) return [];
    try { return [new URL(value).hostname.toLowerCase()]; } catch { return []; }
  });
  if (hosts.some((host) => host === 'mcp.figma.com' || host === 'api.figma.com')) {
    return {
      name: 'Figma',
      documentationUrl: 'https://developers.figma.com/docs/figma-mcp-server/',
      publicClientSecretSupported: true,
    };
  }
  if (hosts.some((host) => host === 'mcp.slack.com' || host.endsWith('.slack.com'))) {
    return {
      name: 'Slack',
      documentationUrl: 'https://api.slack.com/authentication/oauth-v2',
      registrationUrl: 'https://api.slack.com/apps',
      publicClientSecretSupported: false,
    };
  }
  if (hosts.some((host) => host === 'github.com' || host.endsWith('.github.com'))) {
    return {
      name: 'GitHub',
      documentationUrl: 'https://docs.github.com/en/apps/oauth-apps/building-oauth-apps/creating-an-oauth-app',
      registrationUrl: 'https://github.com/settings/applications/new',
      publicClientSecretSupported: false,
    };
  }
  return {
    name: (() => {
      try { return new URL(issuer || serverUrl).hostname; } catch { return 'This provider'; }
    })(),
  };
};

const discoveryStage = (trace: OAuthFlightRecorder): string => {
  const lastFailed = [...trace.snapshot().events].reverse().find((event) => (
    event.outcome === 'failed'
  ));
  return lastFailed?.type.replace(/_/g, ' ') || 'OAuth discovery';
};

const registrationFailureDetails = (error: RegistrationRejectedError): Record<string, unknown> => {
  try {
    const parsed = JSON.parse(error.body) as Record<string, unknown>;
    return Object.fromEntries(Object.entries(parsed).filter(([key, value]) => (
      ['error', 'error_description', 'message', 'detail'].includes(key)
      && (typeof value === 'string' || typeof value === 'number' || typeof value === 'boolean')
    )));
  } catch {
    return { responseFormat: 'non-json' };
  }
};

type RegistrationFailureCategory =
  | 'approval_policy'
  | 'rate_limited'
  | 'server_error'
  | 'invalid_metadata'
  | 'malformed_response'
  | 'rejected';

const registrationFailureCategory = (
  error: RegistrationRejectedError,
  details = registrationFailureDetails(error)
): RegistrationFailureCategory => {
  if (error.status === 429) return 'rate_limited';
  if (error.status >= 500) return 'server_error';

  const errorCode = typeof details.error === 'string'
    ? details.error.toLowerCase()
    : '';
  if (['invalid_client_metadata', 'invalid_redirect_uri', 'invalid_software_statement'].includes(errorCode)) {
    return 'invalid_metadata';
  }

  const responseText = ['error_description', 'message', 'detail']
    .map((field) => details[field])
    .filter((value): value is string => typeof value === 'string')
    .join(' ')
    .replace(/[-_]+/g, ' ');
  if (
    /\bredirect\s+uris?\b/i.test(responseText)
    && /\b(?:invalid|not\s+approved|not\s+registered|not\s+(?:on|in)\s+(?:the\s+)?(?:allow|white)\s*list)\b/i.test(responseText)
  ) {
    return 'invalid_metadata';
  }

  const approvalCode = errorCode.replace(/[-_]+/g, ' ');
  const hasExplicitApprovalEvidence = /(?:\b(?:the\s+|this\s+)?(?:client|software)(?:\s+(?:application|statement))?\s+(?:approval\s+(?:is\s+)?required|requires?\s+(?:provider\s+)?approval|(?:is\s+)?not\s+approved)\b|\b(?:provider\s+)?approval\s+(?:is\s+)?required\s+for\s+(?:the\s+|this\s+)?(?:client|software)\b|\bunapproved\s+(?:client|software(?:\s+statement)?)\b|\bnot\s+(?:on|in)\s+(?:the\s+)?(?:allow|white)\s*list\b|\b(?:allow|white)\s*list\s+access\s+(?:is\s+)?required\b)/i;
  if (hasExplicitApprovalEvidence.test(responseText) || hasExplicitApprovalEvidence.test(approvalCode)) {
    return 'approval_policy';
  }

  if (details.responseFormat === 'non-json') return 'malformed_response';
  return 'rejected';
};

const registrationFailureExplanation = (
  category: RegistrationFailureCategory,
  providerName: string,
  status: number
): string => {
  if (category === 'approval_policy') {
    return `${providerName} advertises automatic client registration, but its HTTP ${status} response indicates that provider approval or allow-list access is required before mcptest.io can continue.`;
  }
  if (category === 'rate_limited') {
    return `${providerName} rate-limited dynamic client registration with HTTP ${status}. Retry automatic registration later or configure an existing OAuth client.`;
  }
  if (category === 'server_error') {
    return `${providerName}'s dynamic client registration endpoint failed with server error HTTP ${status}. Retry later or configure an existing OAuth client.`;
  }
  if (category === 'invalid_metadata') {
    return `${providerName} rejected the submitted dynamic client metadata with HTTP ${status}. Automatic registration may succeed with corrected metadata; an existing OAuth client can also be configured.`;
  }
  if (category === 'malformed_response') {
    return `${providerName}'s dynamic client registration endpoint returned a malformed error response with HTTP ${status}. Retry automatic registration or configure an existing OAuth client.`;
  }
  return `${providerName} rejected dynamic client registration with HTTP ${status}, but the response did not indicate a provider approval or allow-list policy. Retry registration or configure an existing OAuth client.`;
};

const buildOAuthPrerequisite = (
  kind: OAuthPrerequisiteKind,
  serverUrl: string,
  provider: BrowserOAuthProvider,
  trace: OAuthFlightRecorder,
  error: unknown,
  requestedScope?: string
): OAuthPrerequisite => {
  const discovery = provider.discoveryState();
  const metadata = discovery?.authorizationServerMetadata;
  const issuer = issuerForDiscovery(discovery);
  const guidance = providerGuidance(serverUrl, issuer);
  const resourceScopes = discovery?.resourceMetadata?.scopes_supported || [];
  const requiredScopes = Array.from(new Set([
    ...resourceScopes,
    ...(requestedScope?.split(/\s+/).filter(Boolean) || []),
  ]));
  const authMethods = metadata?.token_endpoint_auth_methods_supported;
  const publicClientSecretSupported: boolean | 'unknown' = guidance.publicClientSecretSupported
    ?? (authMethods?.includes('none') ? true : authMethods?.length ? false : 'unknown');
  const failedStage = discoveryStage(trace);
  const base = {
    kind,
    serverUrl,
    providerName: guidance.name,
    issuer,
    registrationEndpoint: metadata?.registration_endpoint,
    documentationUrl: guidance.documentationUrl,
    registrationUrl: guidance.registrationUrl,
    requiredScopes,
    pkceS256: Boolean(metadata?.code_challenge_methods_supported?.includes('S256')),
    publicClientSecretSupported,
    failedStage,
    ...(error instanceof RegistrationRejectedError ? { httpStatus: error.status } : {}),
  };

  if (kind === 'provider_approval_required') {
    return {
      ...base,
      canConfigureClient: false,
      explanation: `${guidance.name} advertises automatic client registration, but rejected this client. Provider approval or allow-list access is required before mcptest.io can continue.`,
    };
  }
  if (kind === 'pre_registered_client_required') {
    return {
      ...base,
      canConfigureClient: true,
      explanation: `${guidance.name} advertises neither Client ID Metadata Documents nor Dynamic Client Registration. Use an OAuth application registered with the provider.`,
    };
  }
  if (error instanceof RegistrationRejectedError) {
    const category = registrationFailureCategory(error);
    return {
      ...base,
      canConfigureClient: true,
      explanation: registrationFailureExplanation(category, guidance.name, error.status),
    };
  }
  return {
    ...base,
    canConfigureClient: false,
    explanation: `OAuth discovery could not be completed at the ${failedStage} stage. Check the exact discovery request in the OAuth flight recorder.`,
  };
};

const isSafeDiscoveryGet = (
  input: Parameters<FetchLike>[0],
  init: Parameters<FetchLike>[1] | undefined,
  trace: OAuthFlightRecorder
): boolean => {
  const request = typeof Request !== 'undefined' && input instanceof Request ? input : undefined;
  const method = (init?.method || request?.method || 'GET').toUpperCase();
  if (method !== 'GET') return false;
  const url = request?.url || String(input);
  try {
    const parsed = new URL(url);
    return parsed.pathname.includes('/.well-known/') || trace.isTrackedResourceMetadataUrl(parsed);
  } catch {
    return false;
  }
};

const createCorsFallbackDiscoveryFetch = (
  trace: OAuthFlightRecorder,
  directFetch: FetchLike,
  proxy?: OAuthDiscoveryProxyOptions
): FetchLike => async (input, init) => {
  const directStartedAtMs = Date.now();
  try {
    return await directFetch(input, init);
  } catch (error) {
    if (!(error instanceof TypeError) || !proxy || !isSafeDiscoveryGet(input, init, trace)) {
      throw error;
    }
    const request = typeof Request !== 'undefined' && input instanceof Request ? input : undefined;
    const exactUrl = request?.url || String(input);
    let eventType: 'protected_resource_metadata' | 'authorization_server_metadata';
    try {
      const parsed = new URL(exactUrl);
      eventType = trace.isTrackedResourceMetadataUrl(parsed)
        || parsed.pathname.includes('/oauth-protected-resource')
        ? 'protected_resource_metadata'
        : 'authorization_server_metadata';
    } catch {
      eventType = 'authorization_server_metadata';
    }
    trace.record({
      type: eventType,
      outcome: 'failed',
      provenance: eventType === 'protected_resource_metadata'
        ? 'direct_target'
        : 'authorization_server',
      route: 'direct',
      explanation: 'Direct browser discovery did not receive a readable response; retrying this metadata GET through the authenticated proxy.',
      request: { method: 'GET', url: sanitizeOAuthTraceUrl(exactUrl) },
      timing: {
        startedAt: new Date(directStartedAtMs).toISOString(),
        durationMs: Math.max(0, Date.now() - directStartedAtMs),
      },
    });
  }

  const request = typeof Request !== 'undefined' && input instanceof Request ? input : undefined;
  const exactTargetUrl = request?.url || String(input);
  const proxyRequestUrl = new URL(proxy.url);
  proxyRequestUrl.searchParams.set('target', exactTargetUrl);
  const headers = new Headers(init?.headers || request?.headers);
  // Discovery is deliberately credential-free toward the target. The only
  // authorization value is consumed by the authenticated mcptest proxy.
  headers.delete('authorization');
  headers.delete('proxy-authorization');
  headers.delete('x-mcp-authorization');
  headers.delete('cookie');
  headers.set('authorization', `Bearer ${proxy.authorizationToken}`);
  let response: Response;
  try {
    response = await (proxy.fetchFn || fetch)(proxyRequestUrl, {
      method: 'GET',
      headers,
      signal: init?.signal || request?.signal,
      credentials: 'omit',
    });
  } catch (error) {
    throw markOAuthTraceErrorOrigin(error, { route: 'proxy', source: 'proxy' });
  }
  const source = response.headers.get('x-mcp-proxy-response-source') === 'target'
    ? 'target'
    : 'proxy';
  return markOAuthTraceResponseOrigin(response, { route: 'proxy', source });
};

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

export const getOAuthCallbackUrl = (): string => {
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
  private resourceMetadataUrlOverride?: string;

  constructor(
    readonly serverUrl: string,
    options: BrowserOAuthProviderOptions = {}
  ) {
    this.serverUrl = normalizeOAuthServerUrl(serverUrl);
    this.storage = options.storage || getSessionStorage();
    this.storeKey = storageKeyForServer(this.serverUrl);
    this.redirectUrl = options.redirectUrl || getOAuthCallbackUrl();
    this.redirect = options.redirect || defaultRedirect;
    this.trace = options.trace;
    const persistedState = this.readState();
    this.trace?.trackResourceMetadataUrl(persistedState.discovery?.resourceMetadataUrl);
    if (persistedState.discovery?.resourceMetadataUrl) {
      this.writeState(persistedState);
    }

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
    this.resourceMetadataUrlOverride = discovery.resourceMetadataUrl
      || this.resourceMetadataUrlOverride;
    this.updateState({ discovery });
    this.trace?.trackResourceMetadataUrl(discovery.resourceMetadataUrl);
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
    const discovery = this.readState().discovery;
    if (!discovery || !this.resourceMetadataUrlOverride) return discovery;
    return {
      ...discovery,
      resourceMetadataUrl: this.resourceMetadataUrlOverride,
    };
  }

  setResourceMetadataUrlOverride(resourceMetadataUrl?: string): void {
    this.resourceMetadataUrlOverride = resourceMetadataUrl;
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
    const discovery = state.discovery && { ...state.discovery };
    if (discovery) delete discovery.resourceMetadataUrl;
    this.storage.setItem(this.storeKey, JSON.stringify({
      ...state,
      ...(discovery ? { discovery } : {}),
    }));
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
  const continuesAfterManualClient = pendingOutcome === 'manual_client_required'
    || pendingOutcome === 'pre_registered_client_required';
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
  const resourceMetadataUrl = options.resourceMetadataUrl
    ? new URL(options.resourceMetadataUrl).toString()
    : undefined;
  if (
    resourceMetadataUrl
    && provider.discoveryState()?.resourceMetadataUrl !== resourceMetadataUrl
  ) {
    provider.invalidateCredentials('discovery');
  }
  provider.setResourceMetadataUrlOverride(resourceMetadataUrl);
  const authenticate = options.authenticate || auth;
  if (resourceMetadataUrl) trace.trackResourceMetadataUrl(resourceMetadataUrl);
  const discoveryFetch = createCorsFallbackDiscoveryFetch(
    trace,
    options.fetchFn || fetch,
    options.discoveryProxy
  );
  const fetchFn = createOAuthTraceFetch(trace, discoveryFetch);
  try {
    const result = await authenticate(provider, {
      serverUrl: normalizedServerUrl,
      fetchFn,
      ...(resourceMetadataUrl
        ? { resourceMetadataUrl: new URL(resourceMetadataUrl) }
        : {}),
      ...(options.scope ? { scope: options.scope } : {}),
      ...(options.forceReauthorization ? { forceReauthorization: true } : {}),
    });
    if (result === 'AUTHORIZED') {
      provider.syncLegacyTokens();
      if (options.deferAuthorizedTraceOutcome) {
        trace.setAuthenticatedMcpRetryState('pending');
      } else {
        trace.terminal('authorized', 'OAuth authorization is available for the MCP target.');
      }
    } else {
      if (
        options.deferAuthorizedTraceOutcome
        || trace.hasEvent('target_challenge')
        || trace.hasAuthenticatedMcpRetryState()
      ) {
        trace.setAuthenticatedMcpRetryState('awaiting_callback');
      } else {
        trace.terminal('redirected', 'OAuth authorization is awaiting the browser callback.');
      }
    }
    return result;
  } catch (error) {
    trace.settleLatestProvisionalOAuthResponse('failed');
    let prerequisite: OAuthPrerequisite | undefined;
    if (error instanceof RegistrationRejectedError) {
      const details = registrationFailureDetails(error);
      const category = registrationFailureCategory(error, details);
      const guidance = providerGuidance(normalizedServerUrl, issuerForDiscovery(provider.discoveryState()));
      const explanation = registrationFailureExplanation(category, guidance.name, error.status);
      trace.enrichLast('dynamic_client_registration', {
        outcome: 'failed',
        explanation,
        response: {
          status: error.status,
          metadata: details,
        },
      });
      prerequisite = buildOAuthPrerequisite(
        category === 'approval_policy'
          ? 'provider_approval_required'
          : 'discovery_blocked_invalid',
        normalizedServerUrl,
        provider,
        trace,
        error,
        options.scope
      );
      trace.terminal(prerequisite.kind, prerequisite.explanation);
    } else if (isPreRegisteredClientRequired(error)) {
      trace.record({
        type: 'pre_registered_client',
        outcome: 'required',
        provenance: 'oauth_client',
        route: 'client',
        explanation: 'CIMD and dynamic registration were unavailable; a pre-registered OAuth client is required.',
      });
      prerequisite = buildOAuthPrerequisite(
        'pre_registered_client_required',
        normalizedServerUrl,
        provider,
        trace,
        error,
        options.scope
      );
      trace.terminal('pre_registered_client_required', prerequisite.explanation);
    } else {
      prerequisite = buildOAuthPrerequisite(
        'discovery_blocked_invalid',
        normalizedServerUrl,
        provider,
        trace,
        error,
        options.scope
      );
      trace.terminal('discovery_blocked_invalid', prerequisite.explanation);
    }
    throw new OAuthPrerequisiteError(prerequisite, { cause: error });
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
  const {
    discover,
    fetchFn,
    resourceMetadataUrl: resourceMetadataUrlOption,
    discoveryProxy,
    ...providerOptions
  } = options;
  const provider = new BrowserOAuthProvider(normalizedServerUrl, { ...providerOptions, storage, trace });
  const resourceMetadataUrl = resourceMetadataUrlOption
    ? new URL(resourceMetadataUrlOption).toString()
    : undefined;
  if (
    resourceMetadataUrl
    && provider.discoveryState()?.resourceMetadataUrl !== resourceMetadataUrl
  ) {
    provider.invalidateCredentials('discovery');
  }
  provider.setResourceMetadataUrlOverride(resourceMetadataUrl);
  if (resourceMetadataUrl) trace.trackResourceMetadataUrl(resourceMetadataUrl);
  const discoveryFetch = createOAuthTraceFetch(
    trace,
    createCorsFallbackDiscoveryFetch(trace, fetchFn || fetch, discoveryProxy)
  );
  try {
    const discovery = provider.discoveryState() || (discover
      ? await discover(normalizedServerUrl, {
        fetchFn: discoveryFetch,
        ...(resourceMetadataUrl
          ? { resourceMetadataUrl: new URL(resourceMetadataUrl) }
          : {}),
      })
      : await discoverOAuthServerInfo(normalizedServerUrl, {
        fetchFn: discoveryFetch,
        ...(resourceMetadataUrl
          ? { resourceMetadataUrl: new URL(resourceMetadataUrl) }
          : {}),
      }));
    provider.saveDiscoveryState({
      ...discovery,
      ...(resourceMetadataUrl ? { resourceMetadataUrl } : {}),
    });
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
  trace.continueAfterRedirect();
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

const isPreRegisteredClientRequired = (error: unknown): boolean => (
  (
    error instanceof Error
    && (
      error.message.includes('does not support dynamic client registration')
      || error.message.includes('OAuth client information must be saveable')
    )
  )
);

export const getOAuthPrerequisite = (error: unknown): OAuthPrerequisite | undefined => (
  error instanceof OAuthPrerequisiteError ? error.prerequisite : undefined
);

export const isOAuthClientConfigurationRequired = (error: unknown): boolean => {
  const prerequisite = getOAuthPrerequisite(error);
  return prerequisite
    ? prerequisite.kind === 'pre_registered_client_required' && prerequisite.canConfigureClient
    : isPreRegisteredClientRequired(error);
};
