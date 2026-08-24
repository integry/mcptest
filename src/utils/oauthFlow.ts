import {
  auth,
  discoverOAuthServerInfo,
  RegistrationRejectedError,
  validateAuthorizationResponseIssuer,
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
import publishedClientMetadata from '../../public/oauth/client-metadata.json';
import {
  OAuthFlightRecorder,
  createOAuthFlightRecorder,
  createOAuthTraceFetch,
  markOAuthTraceErrorOrigin,
  markOAuthTraceResponseOrigin,
  resumeOAuthFlightRecorder,
  sanitizeOAuthTraceUrl,
} from './oauthTrace';
import {
  getOAuthClientEstablishmentStrategy,
  getOAuthProviderPolicy,
  isPolicyRegistrationApprovalRejection,
  providerForbidsDynamicRegistration,
  providerRequiresDynamicRegistration,
  type OAuthProviderPolicy,
} from './oauthProviderPolicy';

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
export const OAUTH_CLIENT_NAME = 'mcptest-io';

export const getHostedOAuthTokenProxyUrl = (
  proxyUrl: string | undefined,
  origin = window.location.origin
): string | undefined => origin === PRODUCTION_ORIGIN ? proxyUrl : undefined;

const OAUTH_SERVER_URL_KEY = 'oauth_server_url';
const OAUTH_STORE_PREFIX = 'mcp_oauth_v2:';

export interface OAuthStorage extends Pick<Storage, 'getItem' | 'setItem' | 'removeItem'> {
  /** Explicitly declares that a custom adapter is cleared with the browser session. */
  readonly sessionOnly?: true;
}

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
  issuer: string;
}

export interface BrowserOAuthProviderOptions {
  storage?: OAuthStorage;
  redirectUrl?: string;
  clientMetadataUrl?: string;
  redirect?: (authorizationUrl: URL) => void | Promise<void>;
  trace?: OAuthFlightRecorder;
  /** Enforce the MCP requirement before a new browser authorization redirect. */
  enforcePkceS256?: boolean;
  /** Internal capability: a dynamically issued secret can only be used via the hosted relay. */
  hostedTokenRelayAvailable?: boolean;
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
  /** Authenticated proxy used proactively for token exchange and refresh POSTs. */
  tokenProxy?: OAuthTokenProxyOptions;
  deferAuthorizedTraceOutcome?: boolean;
}

export interface OAuthDiscoveryProxyOptions {
  url: string;
  authorizationToken: string;
  fetchFn?: FetchLike;
}

export interface OAuthTokenProxyOptions {
  url: string;
  authorizationToken?: string;
  fetchFn?: FetchLike;
}

export type OAuthPrerequisiteKind =
  | 'pre_registered_client_required'
  | 'provider_approval_required'
  | 'provider_callback_incompatible'
  | 'operator_client_not_configured'
  | 'proxy_authentication_required'
  | 'transient_discovery_failure'
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
  configurationMode?: 'browser-public' | 'operator-confidential' | 'provider-approved';
  supportsBearerToken?: boolean;
  bearerTokenName?: string;
  authorizationHeaderTemplate?: string;
  failedStage?: string;
  httpStatus?: number;
  /** Bounded, normalized field errors; never an arbitrary provider response body. */
  registrationValidationErrors?: OAuthRegistrationValidationError[];
}

export interface OAuthRegistrationValidationError {
  field: 'client_name';
  message: string;
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

export class OAuthCimdInteroperabilityError extends Error {
  constructor(readonly providerName: string, readonly errorCode?: string) {
    super(
      `${providerName} advertised Client ID Metadata Document support but rejected the advertised HTTPS URL client ID. This is an authorization-server advertised-capability interoperability failure; mcptest did not retry with Dynamic Client Registration.`
    );
    this.name = 'OAuthCimdInteroperabilityError';
  }
}

export class OAuthProxyAuthenticationRequiredError extends Error {
  constructor() {
    super('Hosted OAuth registration and token exchange require a valid mcptest login. Sign in and start authentication again. This is a mcptest proxy prerequisite, not an MCP server failure.');
    this.name = 'OAuthProxyAuthenticationRequiredError';
  }
}

export class OAuthOperatorClientNotConfiguredError extends Error {
  constructor(readonly providerName: string) {
    super(`${providerName} OAuth cannot start because its operator client is not configured.`);
    this.name = 'OAuthOperatorClientNotConfiguredError';
  }
}

export class OAuthTrustedIssuerBindingError extends Error {
  constructor() {
    super('The discovered authorization-server issuer does not match the exact trusted provider binding.');
    this.name = 'OAuthTrustedIssuerBindingError';
  }
}

export class OAuthOperatorClientLookupError extends Error {
  constructor(readonly status: number) {
    super(`The issuer-bound operator client lookup failed with HTTP ${status}.`);
    this.name = 'OAuthOperatorClientLookupError';
  }
}

export class OAuthKnownProviderDiscoveryError extends Error {
  constructor(readonly providerId: 'intercom') {
    super('Known provider discovery prerequisites were not satisfied.');
    this.name = 'OAuthKnownProviderDiscoveryError';
  }
}

export class OAuthRegistrationCorsError extends Error {
  constructor() {
    super('Dynamic client registration did not receive a readable browser response. The registration endpoint may be blocking browser CORS; sign in and retry through the authenticated mcptest OAuth relay.');
    this.name = 'OAuthRegistrationCorsError';
  }
}

const getSessionStorage = (): OAuthStorage => {
  if (typeof sessionStorage === 'undefined') {
    throw new Error('OAuth requires browser session storage.');
  }
  return sessionStorage;
};

const isSessionOnlyOAuthStorage = (storage: OAuthStorage): boolean => {
  try {
    if (typeof localStorage !== 'undefined' && storage === localStorage) return false;
  } catch {
    // Privacy modes may expose the property but throw when it is acquired.
  }
  try {
    if (typeof sessionStorage !== 'undefined' && storage === sessionStorage) return true;
  } catch {
    // A custom adapter can still explicitly declare session-only behavior.
  }
  return storage.sessionOnly === true;
};

const withProtocol = (value: string): string => (
  /^https?:\/\//i.test(value) ? value : `https://${value}`
);

export const normalizeOAuthServerUrl = (value: string): string => (
  new URL(withProtocol(value)).toString()
);

export const renderOAuthAuthorizationHeader = (
  template: string | undefined,
  token: string
): string => (
  (template || 'Bearer <TOKEN>').replace('<TOKEN>', () => token)
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

const assertPkceS256Discovery = (discovery?: OAuthDiscoveryState): void => {
  if (!discovery?.authorizationServerMetadata?.code_challenge_methods_supported?.includes('S256')) {
    throw new Error(
      'Incompatible authorization server: validated metadata does not advertise PKCE S256 support.'
    );
  }
};

const providerGuidance = (serverUrl: string, issuer?: string): {
  name: string;
  documentationUrl?: string;
  registrationUrl?: string;
  policy?: OAuthProviderPolicy;
} => {
  // A target-only policy may explain a discovery defect, but privileged client
  // establishment separately requires the exact target+issuer match.
  const policy = getOAuthProviderPolicy(serverUrl, issuer)
    || getOAuthProviderPolicy(serverUrl);
  if (policy) {
    return {
      name: policy.name,
      documentationUrl: policy.documentationUrl,
      registrationUrl: policy.registrationUrl,
      policy,
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

const latestFailureIsDiscovery = (trace: OAuthFlightRecorder): boolean => {
  const events = trace.snapshot().events;
  const latest = events[events.length - 1];
  return latest?.outcome === 'failed'
    && (
      latest.type === 'protected_resource_metadata'
      || latest.type === 'authorization_server_metadata'
    );
};

const hasUnresolvedDiscoveryFailure = (trace: OAuthFlightRecorder): boolean => {
  const latestDiscoveryEvent = [...trace.snapshot().events].reverse().find((event) => (
    event.type === 'protected_resource_metadata'
    || event.type === 'authorization_server_metadata'
  ));
  return latestDiscoveryEvent?.outcome === 'failed';
};

const latestFailedEvent = (trace: OAuthFlightRecorder) => (
  [...trace.snapshot().events].reverse().find((event) => event.outcome === 'failed')
);

const latestFailureIsProxyAuthentication = (trace: OAuthFlightRecorder): boolean => {
  const event = latestFailedEvent(trace);
  const authenticationSource = event?.response?.metadata?.authenticationSource;
  const responseSource = event?.response?.headers?.['x-mcp-proxy-response-source'];
  const recordsProxyOwnedResponse = authenticationSource === 'proxy'
    || responseSource?.toLowerCase() === 'proxy'
    || event?.explanation.includes('response was proxy-owned');
  return event?.provenance === 'authenticated_proxy'
    && recordsProxyOwnedResponse
    && (event.response?.status === 401 || event.response?.status === 403);
};

const latestFailureIsTransientDiscovery = (trace: OAuthFlightRecorder): boolean => {
  const event = latestFailedEvent(trace);
  if (!event || ![
    'protected_resource_metadata',
    'authorization_server_metadata',
  ].includes(event.type)) return false;
  const status = event.response?.status;
  return status === 408 || status === 425 || status === 429
    || (typeof status === 'number' && status >= 500);
};

const INTERCOM_RESOURCE_METADATA_FALLBACK_URLS = [
  'https://mcp.intercom.com/.well-known/oauth-protected-resource/mcp',
  'https://mcp.intercom.com/.well-known/oauth-protected-resource',
] as const;

const hasIntercomHistoricalDiscoveryEvidence = (trace: OAuthFlightRecorder): boolean => {
  const events = trace.snapshot().events;
  const targetChallengeObserved = events.some((event) => {
    if (
      event.type !== 'target_challenge'
      || event.outcome !== 'challenged'
      || event.provenance !== 'direct_target'
      || event.response?.status !== 401
    ) return false;
    const authenticate = event.response.headers?.['www-authenticate'];
    return !authenticate || !/(?:^|[,\s])resource_metadata\s*=/i.test(authenticate);
  });
  if (!targetChallengeObserved) return false;

  return INTERCOM_RESOURCE_METADATA_FALLBACK_URLS.every((fallbackUrl) => (
    events.some((event) => (
      event.type === 'protected_resource_metadata'
      && event.outcome === 'failed'
      && event.provenance === 'direct_target'
      && event.request?.method === 'GET'
      && event.request.url === fallbackUrl
      && event.response?.status === 404
    ))
  ));
};

const hasIssuerMismatchDiscoveryEvidence = (
  trace: OAuthFlightRecorder,
  expectedResource: string,
  expectedIssuer: string,
  registrationEndpointAdvertised?: boolean
): boolean => {
  const events = trace.snapshot().events;
  const resourceEvidence = events.some((event) => {
    const authorizationServers = event.response?.metadata?.authorizationServers;
    return event.type === 'protected_resource_metadata'
      && event.outcome === 'succeeded'
      && event.response?.status === 200
      && typeof event.response.metadata?.resource === 'string'
      && exactUrlMatches(event.response.metadata.resource, expectedResource)
      && Array.isArray(authorizationServers)
      && authorizationServers.some((value) => (
        typeof value === 'string' && exactUrlMatches(value, expectedResource)
      ));
  });
  if (!resourceEvidence) return false;

  return events.some((event) => (
    event.type === 'authorization_server_metadata'
    && event.outcome === 'failed'
    && event.response?.status === 200
    && typeof event.response.metadata?.issuer === 'string'
    && exactUrlMatches(event.response.metadata.issuer, expectedIssuer)
    && (
      registrationEndpointAdvertised === undefined
      || event.response.metadata.registrationEndpointAdvertised
        === registrationEndpointAdvertised
    )
  ));
};

const hasDirectTargetChallengeWithoutBearer = (
  trace: OAuthFlightRecorder,
  status: 401 | 403
): boolean => trace.snapshot().events.some((event) => {
  if (
    event.type !== 'target_challenge'
    || event.outcome !== 'challenged'
    || event.provenance !== 'direct_target'
    || event.response?.status !== status
  ) return false;
  const authenticate = event.response.headers?.['www-authenticate'];
  return !authenticate || !/(?:^|[\s,])Bearer(?:[\s,]|$)/i.test(authenticate);
});

const CALENDLY_CLIENT_NAME_VALIDATION_MESSAGE =
  'Use only alphanumeric characters, hyphens, and spaces.';

const calendlyRegistrationValidationErrors = (
  value: unknown,
  policy?: OAuthProviderPolicy
): OAuthRegistrationValidationError[] => {
  if (policy?.id !== 'calendly' || !value || typeof value !== 'object') return [];
  const body = value as Record<string, unknown>;
  if (typeof body.error !== 'string' || body.error.toLowerCase() !== 'invalid_client_metadata') {
    return [];
  }

  // Calendly's observed response names the invalid field and its constraint.
  // Normalize that evidence to a fixed local message instead of forwarding an
  // arbitrary provider body or displaying provider-controlled prose.
  const evidence = JSON.stringify(value).slice(0, 16 * 1024);
  if (
    !/client[_\s-]*name/i.test(evidence)
    || !/(?:alpha[\s_-]*numeric|alphanumeric)/i.test(evidence)
    || !/hyphens?/i.test(evidence)
    || !/spaces?/i.test(evidence)
  ) return [];

  return [{ field: 'client_name', message: CALENDLY_CLIENT_NAME_VALIDATION_MESSAGE }];
};

const registrationFailureDetails = (
  error: RegistrationRejectedError,
  policy?: OAuthProviderPolicy
): Record<string, unknown> => {
  try {
    const parsed = JSON.parse(error.body) as Record<string, unknown>;
    const safeScalars = Object.fromEntries(Object.entries(parsed).filter(([key, value]) => (
      ['error', 'error_description', 'message', 'detail'].includes(key)
      && (typeof value === 'string' || typeof value === 'number' || typeof value === 'boolean')
      && String(value).length <= 2048
      && !/[\u0000-\u001f\u007f]/.test(String(value))
    )));
    const registrationValidationErrors = calendlyRegistrationValidationErrors(parsed, policy);
    return {
      ...safeScalars,
      ...(registrationValidationErrors.length ? { registrationValidationErrors } : {}),
    };
  } catch {
    return { responseFormat: 'non-json' };
  }
};

const validationErrorsFromDetails = (
  details: Record<string, unknown>
): OAuthRegistrationValidationError[] => {
  const errors = details.registrationValidationErrors;
  if (!Array.isArray(errors)) return [];
  return errors.filter((value): value is OAuthRegistrationValidationError => (
    Boolean(value)
    && typeof value === 'object'
    && (value as OAuthRegistrationValidationError).field === 'client_name'
    && (value as OAuthRegistrationValidationError).message
      === CALENDLY_CLIENT_NAME_VALIDATION_MESSAGE
  ));
};

type RegistrationFailureCategory =
  | 'approval_policy'
  | 'callback_incompatible'
  | 'rate_limited'
  | 'server_error'
  | 'invalid_metadata'
  | 'malformed_response'
  | 'rejected';

const registrationFailureCategory = (
  error: RegistrationRejectedError,
  details = registrationFailureDetails(error),
  policy?: OAuthProviderPolicy,
  registrationEndpoint?: string
): RegistrationFailureCategory => {
  if (error.status === 429) return 'rate_limited';
  if (error.status >= 500) return 'server_error';

  const errorCode = typeof details.error === 'string'
    ? details.error.toLowerCase()
    : '';
  if (policy?.id === 'upwork' && errorCode === 'invalid_redirect_uri') {
    return 'callback_incompatible';
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

  if (['invalid_client_metadata', 'invalid_redirect_uri', 'invalid_software_statement'].includes(errorCode)) {
    return 'invalid_metadata';
  }

  if (details.responseFormat === 'non-json' || errorCode === 'invalid_response') {
    return isPolicyRegistrationApprovalRejection(
      policy,
      registrationEndpoint,
      error.status,
      true
    ) ? 'approval_policy' : 'malformed_response';
  }
  return 'rejected';
};

const registrationFailureExplanation = (
  category: RegistrationFailureCategory,
  providerName: string,
  status: number,
  dcrOnly = false,
  validationErrors: OAuthRegistrationValidationError[] = []
): string => {
  if (dcrOnly) {
    const validationGuidance = validationErrors.length
      ? ` Correct ${validationErrors.map(({ field, message }) => `${field}: ${message}`).join(' ')}`
      : '';
    if (category === 'invalid_metadata') {
      return `${providerName} supports Dynamic Client Registration only and rejected the submitted client metadata with HTTP ${status}.${validationGuidance} Retry automatic registration after correcting the metadata; manual or static client IDs are not supported.`;
    }
    if (category === 'rate_limited') {
      return `${providerName} supports Dynamic Client Registration only and rate-limited registration with HTTP ${status}. Retry later; manual or static client IDs are not supported.`;
    }
    if (category === 'server_error') {
      return `${providerName} supports Dynamic Client Registration only, and its registration endpoint failed with HTTP ${status}. Retry after the provider service recovers; manual or static client IDs are not supported.`;
    }
    return `${providerName} supports Dynamic Client Registration only and rejected registration with HTTP ${status}. Retry automatic registration; manual or static client IDs are not supported.`;
  }
  if (category === 'approval_policy') {
    return `${providerName} advertises automatic client registration, but its HTTP ${status} response indicates that provider approval or allow-list access is required before mcptest.io can continue.`;
  }
  if (category === 'callback_incompatible') {
    return `${providerName} rejected mcptest.io's hosted callback with HTTP ${status} invalid_redirect_uri. The provider's advertised client-establishment routes are incompatible with this remote web client; installing localhost software is not required for mcptest.`;
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
  const policy = guidance.policy;
  const issuerBoundPolicy = issuer ? getOAuthProviderPolicy(serverUrl, issuer) : undefined;
  const resourceScopes = discovery?.resourceMetadata?.scopes_supported || [];
  const requiredScopes = Array.from(new Set([
    ...resourceScopes,
    ...(requestedScope?.split(/\s+/).filter(Boolean) || []),
  ]));
  const authMethods = metadata?.token_endpoint_auth_methods_supported;
  const publicClientSecretSupported: boolean | 'unknown' = authMethods?.includes('none')
    ? true
    : authMethods?.length
      ? false
      : 'unknown';
  const failedStage = discoveryStage(trace);

  if (kind === 'proxy_authentication_required') {
    return {
      kind,
      serverUrl,
      providerName: 'mcptest proxy',
      explanation: 'The authenticated mcptest proxy requires a valid mcptest login. This is proxy access, not target OAuth and not an MCP server failure. Sign in again, then retry discovery.',
      requiredScopes: [],
      pkceS256: false,
      publicClientSecretSupported: 'unknown',
      canConfigureClient: false,
      failedStage,
      ...(error instanceof RegistrationRejectedError ? { httpStatus: error.status } : {}),
    };
  }

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
    ...(policy ? {
      configurationMode: policy.registrationMode,
      supportsBearerToken: policy.supportsBearerToken,
      bearerTokenName: policy.bearerTokenName,
      authorizationHeaderTemplate: policy.authorizationHeaderTemplate,
    } : { configurationMode: 'browser-public' as const }),
    failedStage,
    ...(error instanceof RegistrationRejectedError ? { httpStatus: error.status } : {}),
  };

  if (kind === 'provider_approval_required') {
    return {
      ...base,
      canConfigureClient: false,
      explanation: policy?.id === 'figma'
        ? 'mcptest.io is not yet an approved Figma MCP client. Figma only permits clients accepted into its MCP Catalog; client developers must use Figma\'s published approval and waitlist process.'
        : `${guidance.name} advertises automatic client registration, but rejected this client. Provider approval or allow-list access is required before mcptest.io can continue.`,
    };
  }
  if (kind === 'operator_client_not_configured') {
    return {
      ...base,
      canConfigureClient: false,
      explanation: `${guidance.name} authorization could not be started because the mcptest Worker has no complete operator OAuth client binding. Configure both required Worker secrets, then retry; no client secret belongs in the browser.`,
    };
  }
  if (kind === 'provider_callback_incompatible') {
    return {
      ...base,
      canConfigureClient: false,
      explanation: error instanceof RegistrationRejectedError
        ? registrationFailureExplanation('callback_incompatible', guidance.name, error.status)
        : `${guidance.name}'s advertised OAuth client routes do not accept the hosted mcptest.io callback, so authorization could not be started.`,
    };
  }
  if (kind === 'pre_registered_client_required') {
    if (providerRequiresDynamicRegistration(serverUrl, issuer)) {
      return {
        ...base,
        canConfigureClient: false,
        explanation: `${guidance.name} supports Dynamic Client Registration only, but discovery did not yield a usable automatic registration path. Retry OAuth discovery and consult the provider documentation; manual or static client IDs are not supported.`,
      };
    }
    if (policy?.registrationMode === 'operator-confidential') {
      const credentialAlternative = policy.supportsBearerToken
        ? ` Alternatively, use a valid ${policy.bearerTokenName || 'bearer token'} as the target Authorization credential.`
        : '';
      const operatorRequirement = policy.id === 'slack'
        ? 'Slack MCP requires a fixed registered Slack app with a client ID and client secret. The app must be directory-published or internal, and its secret and token exchange must be configured by the mcptest operator rather than in the browser.'
        : policy.id === 'github'
          ? 'GitHub Remote MCP does not support Dynamic Client Registration. The host must configure a GitHub App or OAuth App; its confidential configuration and token exchange must remain in the mcptest operator service.'
          : `${guidance.name} does not support Dynamic Client Registration. Its OAuth path requires a fixed provider application and confidential client secret configured by the mcptest operator; that secret and token exchange cannot run in browser storage.`;
      return {
        ...base,
        canConfigureClient: false,
        explanation: `${operatorRequirement}${credentialAlternative}`,
      };
    }
    return {
      ...base,
      canConfigureClient: true,
      explanation: `${guidance.name} advertises neither Client ID Metadata Documents nor Dynamic Client Registration. Use an OAuth application registered with the provider.`,
    };
  }
  if (kind === 'transient_discovery_failure') {
    return {
      ...base,
      canConfigureClient: false,
      explanation: `OAuth discovery was temporarily unavailable at the ${failedStage} stage. Retry after the network or provider service recovers.`,
    };
  }
  if (error instanceof RegistrationRejectedError) {
    const details = registrationFailureDetails(error, issuerBoundPolicy);
    const category = registrationFailureCategory(
      error,
      details,
      issuerBoundPolicy,
      metadata?.registration_endpoint
    );
    const registrationValidationErrors = validationErrorsFromDetails(details);
    return {
      ...base,
      canConfigureClient: !providerRequiresDynamicRegistration(serverUrl, issuer),
      ...(registrationValidationErrors.length ? { registrationValidationErrors } : {}),
      explanation: registrationFailureExplanation(
        category,
        guidance.name,
        error.status,
        providerRequiresDynamicRegistration(serverUrl, issuer),
        registrationValidationErrors
      ),
    };
  }
  const failedEvent = latestFailedEvent(trace);
  if (
    policy?.id === 'intercom'
    && hasUnresolvedDiscoveryFailure(trace)
    && hasIntercomHistoricalDiscoveryEvidence(trace)
  ) {
    return {
      ...base,
      canConfigureClient: false,
      explanation: 'Intercom authorization could not be started: the MCP target returned HTTP 401 without a resource_metadata link, and both standard protected-resource metadata fallback URLs returned HTTP 404. This is provider-side discovery evidence; use the documented Intercom access-token alternative while the metadata is unavailable.',
    };
  }
  if (
    policy?.id === 'docusign-developer'
    && hasDirectTargetChallengeWithoutBearer(trace, 403)
    && hasIssuerMismatchDiscoveryEvidence(
      trace,
      'https://mcp-d.docusign.com',
      'https://account-d.docusign.com'
    )
  ) {
    return {
      ...base,
      canConfigureClient: false,
      explanation: 'Docusign Developer authorization could not be started: the MCP endpoint returned HTTP 403 without a Bearer challenge, protected-resource metadata names https://mcp-d.docusign.com, and that authorization-server document declares issuer https://account-d.docusign.com. Strict issuer equality blocked the mismatching issuer.',
    };
  }
  if (
    policy?.id === 'pagerduty'
    && hasIssuerMismatchDiscoveryEvidence(
      trace,
      'https://mcp.pagerduty.com/',
      'https://app.pagerduty.com/global/oauth/anonymous',
      false
    )
  ) {
    return {
      ...base,
      canConfigureClient: false,
      explanation: 'PagerDuty authorization could not be started: protected-resource metadata names https://mcp.pagerduty.com/, while the retrieved authorization-server document declares https://app.pagerduty.com/global/oauth/anonymous and advertises no registration endpoint. Strict issuer equality blocked the mismatch; use the documented PagerDuty API-token alternative.',
    };
  }
  if (
    failedEvent
    && latestFailureIsDiscovery(trace)
    && failedEvent.response?.status === undefined
  ) {
    const directDiscoveryAlsoFailed = trace.snapshot().events.some((event) => (
      event.type === failedEvent.type
      && event.outcome === 'failed'
      && event.route === 'direct'
      && event.response?.status === undefined
    ));
    return {
      ...base,
      canConfigureClient: false,
      explanation: failedEvent.route === 'direct'
        ? `The browser did not receive a readable HTTP response during ${failedStage}. Browser access or CORS may be blocking discovery; this does not establish a provider outage. Sign in and retry with the authenticated proxy fallback where available, then inspect the exact request in the OAuth flight recorder if it still fails.`
        : `${directDiscoveryAlsoFailed ? `Direct browser ${failedStage} did not receive a readable response, which may indicate a browser access or CORS limitation, and the authenticated proxy fallback also failed before receiving HTTP. ` : `The authenticated proxy did not receive an HTTP response during ${failedStage}. `}This does not establish a provider outage. Verify proxy authentication and connectivity, then inspect both routes in the OAuth flight recorder.`,
    };
  }
  return {
    ...base,
    canConfigureClient: false,
    explanation: `OAuth discovery could not be completed at the ${failedStage} stage. Check the exact discovery request in the OAuth flight recorder.`,
  };
};

const createProviderPolicyFetch = (
  serverUrl: string,
  provider: BrowserOAuthProvider,
  fetchFn: FetchLike
): FetchLike => async (input, init) => {
  const request = typeof Request !== 'undefined' && input instanceof Request ? input : undefined;
  const method = (init?.method || request?.method || 'GET').toUpperCase();
  const requestUrl = request?.url || String(input);
  const discovery = provider.discoveryState();
  const issuer = issuerForDiscovery(discovery);
  if (method === 'POST' && providerForbidsDynamicRegistration(serverUrl, issuer)) {
    let isRegistrationRequest = false;
    try {
      const parsed = new URL(requestUrl);
      const advertised = discovery?.authorizationServerMetadata?.registration_endpoint;
      isRegistrationRequest = /\/register\/?$/i.test(parsed.pathname)
        || (advertised ? parsed.toString() === new URL(advertised).toString() : false);
    } catch {
      isRegistrationRequest = false;
    }
    if (isRegistrationRequest) {
      throw new Error('Authorization server does not support dynamic client registration');
    }
  }
  return fetchFn(input, init);
};

const createKnownProviderDiscoveryEvidenceFetch = (
  serverUrl: string,
  trace: OAuthFlightRecorder,
  fetchFn: FetchLike
): FetchLike => async (input, init) => {
  const policyId = getOAuthProviderPolicy(serverUrl)?.id;
  if (policyId !== 'docusign-developer' && policyId !== 'pagerduty') {
    return fetchFn(input, init);
  }

  const response = await fetchFn(input, init);
  const { method, url } = requestMethodAndUrl(input, init);
  if (method !== 'GET' || !response.ok) return response;

  let body: Record<string, unknown>;
  try {
    const parsed = await response.clone().json() as unknown;
    if (!parsed || typeof parsed !== 'object' || Array.isArray(parsed)) return response;
    body = parsed as Record<string, unknown>;
  } catch {
    return response;
  }

  let parsedUrl: URL;
  try {
    parsedUrl = new URL(url);
  } catch {
    return response;
  }
  if (
    trace.isTrackedResourceMetadataUrl(parsedUrl)
    || parsedUrl.pathname.includes('/oauth-protected-resource')
  ) {
    trace.enrichLast('protected_resource_metadata', {
      response: {
        metadata: {
          ...(typeof body.resource === 'string' ? { resource: body.resource } : {}),
          ...(Array.isArray(body.authorization_servers)
            && body.authorization_servers.every((value) => typeof value === 'string')
            ? { authorizationServers: body.authorization_servers }
            : {}),
        },
      },
    });
  } else if (
    parsedUrl.pathname.includes('/oauth-authorization-server')
    || parsedUrl.pathname.includes('/openid-configuration')
  ) {
    trace.enrichLast('authorization_server_metadata', {
      response: {
        metadata: {
          ...(typeof body.issuer === 'string' ? { issuer: body.issuer } : {}),
          registrationEndpointAdvertised: typeof body.registration_endpoint === 'string',
        },
      },
    });
  }
  return response;
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

const requestMethodAndUrl = (
  input: Parameters<FetchLike>[0],
  init?: Parameters<FetchLike>[1]
): { method: string; request?: Request; url: string } => {
  const request = typeof Request !== 'undefined' && input instanceof Request ? input : undefined;
  return {
    method: (init?.method || request?.method || 'GET').toUpperCase(),
    request,
    url: request?.url || String(input),
  };
};

const exactUrlMatches = (left: string, right: string): boolean => {
  try {
    return new URL(left).toString() === new URL(right).toString();
  } catch {
    return false;
  }
};

const oauthRequestBody = async (
  request: Request | undefined,
  init?: RequestInit
): Promise<string> => {
  if (init?.body instanceof URLSearchParams) return init.body.toString();
  if (typeof init?.body === 'string') return init.body;
  if (init?.body !== undefined && init.body !== null) {
    throw new Error('Hosted OAuth token exchange supports form-urlencoded request bodies only.');
  }
  if (request) return request.clone().text();
  throw new Error('Hosted OAuth token exchange is missing its form body.');
};

const oauthJsonRequestBody = async (
  request: Request | undefined,
  init?: RequestInit
): Promise<string> => {
  if (typeof init?.body === 'string') return init.body;
  if (init?.body !== undefined && init.body !== null) {
    throw new Error('Hosted dynamic client registration supports JSON request bodies only.');
  }
  if (request) return request.clone().text();
  throw new Error('Hosted dynamic client registration is missing its JSON body.');
};

interface PendingRegistrationRequest {
  controller: AbortController;
  promise: Promise<Response>;
  activeCallers: number;
  settled: boolean;
}

const registrationAbortReason = (signal: AbortSignal): unknown => (
  signal.reason ?? new DOMException('This operation was aborted', 'AbortError')
);

const awaitRegistrationRequest = (
  pendingRequests: Map<string, PendingRegistrationRequest>,
  pending: PendingRegistrationRequest,
  requestKey: string,
  signal?: AbortSignal | null
): Promise<Response> => {
  if (signal?.aborted) return Promise.reject(registrationAbortReason(signal));

  pending.activeCallers += 1;
  return new Promise<Response>((resolve, reject) => {
    let waiting = true;
    const finishWaiting = (): boolean => {
      if (!waiting) return false;
      waiting = false;
      signal?.removeEventListener('abort', abort);
      pending.activeCallers -= 1;
      if (pending.activeCallers === 0 && !pending.settled) {
        // Make an orphaned relay non-joinable before aborting it. Some fetch
        // implementations do not reject promptly (or at all) after abort.
        if (pendingRequests.get(requestKey) === pending) {
          pendingRequests.delete(requestKey);
        }
        pending.controller.abort(signal?.reason);
      }
      return true;
    };
    const abort = (): void => {
      if (finishWaiting()) reject(registrationAbortReason(signal!));
    };

    signal?.addEventListener('abort', abort, { once: true });
    pending.promise.then(
      response => {
        if (finishWaiting()) resolve(response);
      },
      error => {
        if (finishWaiting()) reject(error);
      }
    );
  });
};

const cloneRegistrationResponse = (response: Response): Response => {
  const clone = response.clone();
  return markOAuthTraceResponseOrigin(clone, {
    route: 'proxy',
    source: response.headers.get('x-mcp-proxy-response-source') === 'target'
      ? 'target'
      : 'proxy',
  });
};

const createOAuthRegistrationFetchForPendingContext = (
  provider: BrowserOAuthProvider,
  proxy: OAuthTokenProxyOptions | undefined,
  directFetch: FetchLike,
  pendingRegistrationRequests: Map<string, PendingRegistrationRequest>
): FetchLike => async (input, init) => {
  const { method, request, url } = requestMethodAndUrl(input, init);
  const requestHeaders = new Headers(init?.headers || request?.headers);
  const isJsonPost = method === 'POST'
    && requestHeaders.get('content-type')?.split(';', 1)[0].trim().toLowerCase()
      === 'application/json';
  if (!isJsonPost) return directFetch(input, init);

  const discovery = provider.discoveryState();
  const metadata = discovery?.authorizationServerMetadata;
  const issuer = metadata?.issuer;
  const registrationEndpoint = metadata?.registration_endpoint;
  const isBoundRegistrationRequest = Boolean(
    issuer
    && discovery?.authorizationServerUrl
    && exactUrlMatches(discovery.authorizationServerUrl, issuer)
    && registrationEndpoint
    && exactUrlMatches(url, registrationEndpoint)
  );
  if (!isBoundRegistrationRequest) return directFetch(input, init);

  if (!proxy) {
    try {
      return await directFetch(input, init);
    } catch (error) {
      if (error instanceof TypeError) throw new OAuthRegistrationCorsError();
      throw error;
    }
  }
  if (!proxy.authorizationToken) throw new OAuthProxyAuthenticationRequiredError();

  let body = await oauthJsonRequestBody(request, init);
  try {
    const registrationMetadata = JSON.parse(body) as Record<string, unknown>;
    if (registrationMetadata && typeof registrationMetadata === 'object') {
      registrationMetadata.token_endpoint_auth_method =
        provider.clientMetadata.token_endpoint_auth_method;
      body = JSON.stringify(registrationMetadata);
    }
  } catch {
    // Preserve malformed input so the Worker remains the single validation boundary.
  }
  // The body is part of an in-memory de-duplication key only. It is never
  // persisted, traced, logged, placed in a URL, or exposed as an error.
  const requestKey = `${issuer}\n${new URL(registrationEndpoint!).toString()}\n${body}`;
  const callerSignal = init?.signal || request?.signal;
  if (callerSignal?.aborted) throw registrationAbortReason(callerSignal);
  const existing = pendingRegistrationRequests.get(requestKey);
  if (existing) {
    return cloneRegistrationResponse(await awaitRegistrationRequest(
      pendingRegistrationRequests,
      existing,
      requestKey,
      callerSignal
    ));
  }

  const relay = new URL(proxy.url);
  relay.pathname = '/oauth/register';
  relay.search = '';
  relay.hash = '';
  const headers = new Headers({
    accept: 'application/json',
    authorization: `Bearer ${proxy.authorizationToken}`,
    'content-type': 'application/json',
    'x-mcp-oauth-issuer': issuer!,
    // Equality assertion only: the Worker rediscovers and selects the target.
    'x-mcp-oauth-registration-endpoint': new URL(registrationEndpoint!).toString(),
  });
  const controller = new AbortController();
  const relayRequest = (async (): Promise<Response> => {
    try {
      const response = await (proxy.fetchFn || fetch)(relay, {
        method: 'POST',
        headers,
        body,
        signal: controller.signal,
        credentials: 'omit',
        redirect: 'error',
      });
      const source = response.headers.get('x-mcp-proxy-response-source') === 'target'
        ? 'target'
        : 'proxy';
      if (response.status === 401 && source === 'proxy') {
        throw new OAuthProxyAuthenticationRequiredError();
      }
      return markOAuthTraceResponseOrigin(response, { route: 'proxy', source });
    } catch (error) {
      const relayError = error instanceof TypeError
        ? new Error('The authenticated dynamic client registration relay did not receive an HTTP response. Verify mcptest proxy connectivity and retry.')
        : error;
      throw markOAuthTraceErrorOrigin(relayError, { route: 'proxy', source: 'proxy' });
    }
  })();
  const pending: PendingRegistrationRequest = {
    controller,
    promise: relayRequest,
    activeCallers: 0,
    settled: false,
  };
  pendingRegistrationRequests.set(requestKey, pending);
  void relayRequest.then(
    () => {
      pending.settled = true;
      if (pendingRegistrationRequests.get(requestKey) === pending) {
        pendingRegistrationRequests.delete(requestKey);
      }
    },
    () => {
      pending.settled = true;
      if (pendingRegistrationRequests.get(requestKey) === pending) {
        pendingRegistrationRequests.delete(requestKey);
      }
    }
  );
  return cloneRegistrationResponse(await awaitRegistrationRequest(
    pendingRegistrationRequests,
    pending,
    requestKey,
    callerSignal
  ));
};

const createOAuthRegistrationFetch = (
  provider: BrowserOAuthProvider,
  proxy: OAuthTokenProxyOptions | undefined,
  directFetch: FetchLike
): FetchLike => createOAuthRegistrationFetchForPendingContext(
  provider,
  proxy,
  directFetch,
  new Map()
);

const createOAuthTokenProxyFetch = (
  provider: BrowserOAuthProvider,
  proxy: OAuthTokenProxyOptions | undefined,
  directFetch: FetchLike
): FetchLike => async (input, init) => {
  const { method, request, url } = requestMethodAndUrl(input, init);
  const discovery = provider.discoveryState();
  const metadata = discovery?.authorizationServerMetadata;
  const issuer = issuerForDiscovery(discovery);
  const tokenEndpoint = metadata?.token_endpoint;
  const requestHeaders = new Headers(init?.headers || request?.headers);
  const isFormPost = method === 'POST'
    && requestHeaders.get('content-type')?.split(';', 1)[0].trim().toLowerCase()
      === 'application/x-www-form-urlencoded';
  if (!isFormPost || !proxy) return directFetch(input, init);
  if (!proxy.authorizationToken) throw new OAuthProxyAuthenticationRequiredError();
  if (
    !issuer
    || !metadata?.issuer
    || metadata.issuer !== issuer
    || !tokenEndpoint
    || !exactUrlMatches(url, tokenEndpoint)
  ) {
    throw new Error('Hosted OAuth token exchange requires validated issuer-bound authorization-server discovery state.');
  }

  const endpoint = new URL(proxy.url);
  endpoint.pathname = '/oauth/token';
  endpoint.search = '';
  endpoint.hash = '';
  const headers = new Headers();
  headers.set('accept', 'application/json');
  headers.set('content-type', 'application/x-www-form-urlencoded');
  headers.set('authorization', `Bearer ${proxy.authorizationToken}`);
  headers.set('x-mcp-oauth-issuer', issuer);
  // This value is an equality assertion only. The Worker independently selects
  // the target from issuer discovery and never uses this header as a fetch URL.
  headers.set('x-mcp-oauth-token-endpoint', new URL(tokenEndpoint).toString());

  const body = new URLSearchParams(await oauthRequestBody(request, init));
  const clientAuthorization = requestHeaders.get('authorization');
  if (clientAuthorization) {
    if (!clientAuthorization.startsWith('Basic ')) {
      throw new Error('Hosted OAuth token exchange received an unsupported client authorization method.');
    }
    const clientInformation = provider.clientInformation({ issuer });
    if (!clientInformation?.client_secret) {
      throw new Error('Hosted OAuth token exchange cannot validate client authentication without session-scoped dynamic client information.');
    }
    body.set('client_id', clientInformation.client_id);
    headers.set('x-mcp-oauth-client-authorization', clientAuthorization);
  }

  let response: Response;
  try {
    response = await (proxy.fetchFn || fetch)(endpoint, {
      method: 'POST',
      headers,
      body,
      signal: init?.signal || request?.signal,
      credentials: 'omit',
      redirect: 'error',
    });
  } catch (error) {
    throw markOAuthTraceErrorOrigin(error, { route: 'proxy', source: 'proxy' });
  }
  const source = response.headers.get('x-mcp-proxy-response-source') === 'target'
    ? 'target'
    : 'proxy';
  return markOAuthTraceResponseOrigin(response, { route: 'proxy', source });
};

const establishOperatorOAuthClient = async (
  serverUrl: string,
  provider: BrowserOAuthProvider,
  trace: OAuthFlightRecorder,
  discoveryFetch: FetchLike,
  proxy: OAuthTokenProxyOptions | undefined,
  resourceMetadataUrl?: string
): Promise<void> => {
  const targetPolicy = getOAuthProviderPolicy(serverUrl);
  if (targetPolicy?.clientEstablishmentStrategy !== 'operator-confidential' || !proxy) return;
  if (!proxy.authorizationToken) throw new OAuthProxyAuthenticationRequiredError();

  const discovery = provider.discoveryState() || await discoverOAuthServerInfo(serverUrl, {
    fetchFn: createOAuthTraceFetch(trace, discoveryFetch),
    ...(resourceMetadataUrl ? { resourceMetadataUrl: new URL(resourceMetadataUrl) } : {}),
  });
  provider.saveDiscoveryState({
    ...discovery,
    ...(resourceMetadataUrl ? { resourceMetadataUrl } : {}),
  });
  const issuer = issuerForDiscovery(provider.discoveryState());
  const trustedPolicy = issuer ? getOAuthProviderPolicy(serverUrl, issuer) : undefined;
  if (
    !issuer
    || trustedPolicy?.id !== targetPolicy.id
    || trustedPolicy.clientEstablishmentStrategy !== 'operator-confidential'
  ) {
    throw new OAuthTrustedIssuerBindingError();
  }

  const endpoint = new URL(proxy.url);
  endpoint.pathname = '/oauth/client';
  endpoint.search = '';
  endpoint.hash = '';
  let response: Response;
  try {
    response = await (proxy.fetchFn || fetch)(endpoint, {
      method: 'POST',
      headers: {
        accept: 'application/json',
        authorization: `Bearer ${proxy.authorizationToken}`,
        'x-mcp-oauth-issuer': issuer,
        'x-mcp-oauth-resource': serverUrl,
      },
      credentials: 'omit',
      redirect: 'error',
    });
  } catch (error) {
    throw markOAuthTraceErrorOrigin(error, { route: 'proxy', source: 'proxy' });
  }
  const source = response.headers.get('x-mcp-proxy-response-source') === 'proxy'
    ? 'proxy'
    : 'target';
  trace.record({
    type: 'client_establishment',
    outcome: response.ok ? 'succeeded' : 'failed',
    provenance: 'authenticated_proxy',
    route: 'proxy',
    explanation: response.ok
      ? 'The authenticated Worker returned the public client ID for the exact trusted resource and issuer binding.'
      : 'The authenticated Worker could not provide an operator client for the exact trusted resource and issuer binding.',
    request: { method: 'POST', url: sanitizeOAuthTraceUrl(endpoint) },
    response: {
      status: response.status,
      metadata: {
        strategy: 'operator-confidential',
        source,
        issuerBinding: issuer,
      },
    },
  });
  if (source !== 'proxy') throw new OAuthOperatorClientLookupError(response.status);
  if (response.status === 401 || response.status === 403) {
    throw new OAuthProxyAuthenticationRequiredError();
  }
  let responseBody: unknown;
  try {
    const responseText = await response.text();
    if (responseText.length > 16 * 1024) {
      throw new Error('Operator client response is too large');
    }
    responseBody = JSON.parse(responseText) as unknown;
  } catch {
    throw new OAuthOperatorClientLookupError(response.status);
  }
  if (
    response.status === 503
    && responseBody
    && typeof responseBody === 'object'
    && (responseBody as Record<string, unknown>).error === 'operator_client_not_configured'
  ) {
    throw new OAuthOperatorClientNotConfiguredError(trustedPolicy.name);
  }
  if (!response.ok || !responseBody || typeof responseBody !== 'object' || Array.isArray(responseBody)) {
    throw new OAuthOperatorClientLookupError(response.status);
  }
  const keys = Object.keys(responseBody as Record<string, unknown>);
  const clientId = (responseBody as Record<string, unknown>).client_id;
  if (
    keys.length !== 1
    || keys[0] !== 'client_id'
    || typeof clientId !== 'string'
    || clientId.length < 1
    || clientId.length > 2048
  ) {
    throw new OAuthOperatorClientLookupError(response.status);
  }
  provider.saveClientInformation({
    client_id: clientId,
    issuer,
    registeredManually: true,
  }, { issuer });
};

const preflightKnownProviderDiscovery = async (
  serverUrl: string,
  provider: BrowserOAuthProvider,
  trace: OAuthFlightRecorder,
  discoveryFetch: FetchLike,
  resourceMetadataUrl?: string
): Promise<void> => {
  if (getOAuthProviderPolicy(serverUrl)?.id !== 'intercom') return;
  try {
    const discovery = provider.discoveryState() || await discoverOAuthServerInfo(serverUrl, {
      fetchFn: createOAuthTraceFetch(trace, discoveryFetch),
      ...(resourceMetadataUrl ? { resourceMetadataUrl: new URL(resourceMetadataUrl) } : {}),
    });
    provider.saveDiscoveryState({
      ...discovery,
      ...(resourceMetadataUrl ? { resourceMetadataUrl } : {}),
    });
    if (!discovery.resourceMetadata || !discovery.authorizationServerMetadata) {
      throw new Error('Intercom OAuth discovery returned incomplete metadata.');
    }
  } catch (error) {
    if (error instanceof OAuthKnownProviderDiscoveryError) throw error;
    if (hasIntercomHistoricalDiscoveryEvidence(trace)) {
      throw new OAuthKnownProviderDiscoveryError('intercom');
    }
    throw error;
  }
};

const isCimdClientRejection = async (response: Response): Promise<string | undefined> => {
  if (response.ok) return undefined;
  try {
    const body = await response.clone().json() as { error?: unknown };
    const error = typeof body.error === 'string' ? body.error.toLowerCase() : undefined;
    return error && ['invalid_client', 'unauthorized_client'].includes(error)
      ? error
      : undefined;
  } catch {
    return undefined;
  }
};

const createCimdInteroperabilityFetch = (
  serverUrl: string,
  provider: BrowserOAuthProvider,
  fetchFn: FetchLike
): FetchLike => async (input, init) => {
  const response = await fetchFn(input, init);
  const { method, url } = requestMethodAndUrl(input, init);
  const discovery = provider.discoveryState();
  const issuer = issuerForDiscovery(discovery);
  if (
    method === 'POST'
    && discovery?.authorizationServerMetadata?.token_endpoint
    && exactUrlMatches(url, discovery.authorizationServerMetadata.token_endpoint)
    && provider.usesClientMetadataDocument(issuer)
  ) {
    const rejection = await isCimdClientRejection(response);
    if (rejection) {
      throw new OAuthCimdInteroperabilityError(
        providerGuidance(serverUrl, issuer).name,
        rejection
      );
    }
  }
  return response;
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
  clientMetadataUrl?: string;

  private readonly storage: OAuthStorage;
  private readonly storeKey: string;
  private readonly redirect: (authorizationUrl: URL) => void | Promise<void>;
  private readonly trace?: OAuthFlightRecorder;
  private readonly enforcePkceS256: boolean;
  private readonly hostedTokenRelayAvailable: boolean;
  private readonly sessionOnlyStorage: boolean;
  private resourceMetadataUrlOverride?: string;

  constructor(
    readonly serverUrl: string,
    options: BrowserOAuthProviderOptions = {}
  ) {
    this.serverUrl = normalizeOAuthServerUrl(serverUrl);
    this.storage = options.storage || getSessionStorage();
    this.sessionOnlyStorage = isSessionOnlyOAuthStorage(this.storage);
    this.storeKey = storageKeyForServer(this.serverUrl);
    this.redirectUrl = options.redirectUrl || getOAuthCallbackUrl();
    this.redirect = options.redirect || defaultRedirect;
    this.trace = options.trace;
    this.enforcePkceS256 = options.enforcePkceS256 === true;
    this.hostedTokenRelayAvailable = options.hostedTokenRelayAvailable === true;
    const persistedState = this.readState();
    // Older releases accepted confidential client secrets in a host-only key.
    // Remove that unsafe legacy record during migration rather than loading it.
    const legacyClientKey = `oauth_client_${legacyHostForServer(this.serverUrl)}`;
    const legacyClient = parseJson<LegacyOAuthClient>(this.storage.getItem(legacyClientKey));
    if (legacyClient?.clientSecret) this.storage.removeItem(legacyClientKey);
    this.trace?.trackResourceMetadataUrl(persistedState.discovery?.resourceMetadataUrl);
    if (persistedState.discovery?.resourceMetadataUrl) {
      this.writeState(persistedState);
    }

    const productionCallback = `${PRODUCTION_ORIGIN}${OAUTH_CALLBACK_PATH}`;
    const configuredMetadataUrl = options.clientMetadataUrl;
    this.clientMetadataUrl = configuredMetadataUrl === OAUTH_CLIENT_METADATA_URL
      && !publishedClientMetadata.redirect_uris.includes(this.redirectUrl)
      ? undefined
      : configuredMetadataUrl ?? (
          this.redirectUrl === productionCallback
            ? OAUTH_CLIENT_METADATA_URL
            : undefined
        );
  }

  get clientMetadata(): OAuthClientMetadata {
    const callbackUrl = new URL(this.redirectUrl);
    const supportedTokenAuthMethods = this.discoveryState()
      ?.authorizationServerMetadata?.token_endpoint_auth_methods_supported;
    // RFC 8414 defaults omitted metadata to client_secret_basic. Only select
    // that confidential default when the authenticated hosted relay can use it.
    const tokenEndpointAuthMethod = this.hostedTokenRelayAvailable
      ? supportedTokenAuthMethods === undefined
        ? 'client_secret_basic'
        : supportedTokenAuthMethods.includes('client_secret_post')
          ? 'client_secret_post'
          : supportedTokenAuthMethods.includes('client_secret_basic')
            ? 'client_secret_basic'
            : 'none'
      : 'none';
    if (callbackUrl.toString() === `${PRODUCTION_ORIGIN}${OAUTH_CALLBACK_PATH}`) {
      const { client_id: _clientId, ...metadata } = publishedClientMetadata;
      return { ...metadata, token_endpoint_auth_method: tokenEndpointAuthMethod } as OAuthClientMetadata;
    }
    return {
      redirect_uris: [callbackUrl.toString()],
      client_name: OAUTH_CLIENT_NAME,
      client_uri: callbackUrl.origin,
      logo_uri: `${callbackUrl.origin}/logo.png`,
      grant_types: ['authorization_code', 'refresh_token'],
      response_types: ['code'],
      token_endpoint_auth_method: tokenEndpointAuthMethod,
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

    const manualClient = providerRequiresDynamicRegistration(this.serverUrl, ctx.issuer)
      ? undefined
      : this.readManualClient(ctx.issuer);
    if (manualClient) {
      if (!this.trace?.hasEvent('pre_registered_client', 'succeeded')) {
        this.trace?.record({
          type: 'pre_registered_client',
          outcome: 'succeeded',
          provenance: 'oauth_client',
          route: 'client',
          explanation: 'Using the pre-registered OAuth client configured for this authorization server.',
          response: { metadata: { issuer: ctx.issuer, clientType: 'public' } },
        });
      }
      return {
        client_id: manualClient.clientId,
        issuer: manualClient.issuer,
      };
    }

    const storedClient = this.readState().clients?.[ctx.issuer];
    if (storedClient?.registeredManually) return undefined;
    if (!storedClient) return undefined;
    this.trace?.registerSecret(storedClient.client_secret);
    if (storedClient.client_secret && !this.hostedTokenRelayAvailable) {
      throw new OAuthProxyAuthenticationRequiredError();
    }
    return storedClient;
  }

  manualClientInformation(): ManualOAuthClient | undefined {
    const discovery = this.discoveryState();
    const issuer = discovery?.authorizationServerMetadata?.issuer
      || discovery?.authorizationServerUrl;
    return issuer && !providerRequiresDynamicRegistration(this.serverUrl, issuer)
      ? this.readManualClient(issuer)
      : undefined;
  }

  saveClientInformation(
    clientInformation: PersistedOAuthClientInformation,
    ctx?: OAuthClientInformationContext
  ): void {
    const issuer = ctx?.issuer || clientInformation.issuer;
    if (!issuer) throw new Error('Cannot store OAuth client information without an issuer.');
    if (ctx?.issuer && clientInformation.issuer && clientInformation.issuer !== ctx.issuer) {
      throw new Error('Dynamic OAuth client information issuer mismatch.');
    }
    if (
      typeof clientInformation.client_id !== 'string'
      || clientInformation.client_id.length === 0
      || clientInformation.client_id.length > 2048
    ) {
      throw new Error('Dynamic OAuth registration returned an invalid client_id.');
    }
    if (JSON.stringify(clientInformation).length > 16 * 1024) {
      throw new Error('Dynamic OAuth registration returned oversized client information.');
    }
    if (
      clientInformation.client_secret !== undefined
      && (
        typeof clientInformation.client_secret !== 'string'
        || clientInformation.client_secret.length === 0
        || clientInformation.client_secret.length > 4096
      )
    ) {
      throw new Error('Dynamic OAuth registration returned an invalid client_secret.');
    }
    if (clientInformation.client_secret && !this.sessionOnlyStorage) {
      this.trace?.registerSecret(clientInformation.client_secret);
      throw new Error(
        'Dynamically issued OAuth client secrets may only be kept in session-scoped storage.'
      );
    }
    if (clientInformation.client_secret && !this.hostedTokenRelayAvailable) {
      this.trace?.registerSecret(clientInformation.client_secret);
      throw new Error(
        'Dynamic registration issued a client secret, but no hosted token relay is available. An operator-confidential OAuth prerequisite is required.'
      );
    }
    if ('redirect_uris' in clientInformation && clientInformation.redirect_uris) {
      if (
        clientInformation.redirect_uris.length !== 1
        || clientInformation.redirect_uris[0] !== this.redirectUrl
      ) {
        throw new Error('Dynamic OAuth registration returned mismatched redirect_uris.');
      }
    }
    if (
      'token_endpoint_auth_method' in clientInformation
      && clientInformation.token_endpoint_auth_method
      && !['none', 'client_secret_basic', 'client_secret_post'].includes(
        clientInformation.token_endpoint_auth_method
      )
    ) {
      throw new Error(
        'Dynamic OAuth registration requires an unsupported operator-confidential token authentication method.'
      );
    }
    if ('grant_types' in clientInformation && clientInformation.grant_types) {
      if (
        clientInformation.grant_types.length > 2
        || clientInformation.grant_types.some(grant => ![
          'authorization_code',
          'refresh_token',
        ].includes(grant))
      ) throw new Error('Dynamic OAuth registration returned unsupported grant_types.');
    }
    if (
      'response_types' in clientInformation
      && clientInformation.response_types
      && (
        clientInformation.response_types.length !== 1
        || clientInformation.response_types[0] !== 'code'
      )
    ) throw new Error('Dynamic OAuth registration returned unsupported response_types.');
    if (
      'application_type' in clientInformation
      && clientInformation.application_type
      && clientInformation.application_type !== 'web'
    ) throw new Error('Dynamic OAuth registration returned an unsupported application_type.');
    const isDynamicRegistration = !clientInformation.registeredManually
      && clientInformation.client_id !== this.clientMetadataUrl
      && 'redirect_uris' in clientInformation;
    if (isDynamicRegistration) {
      const supportedMethods = this.discoveryState()
        ?.authorizationServerMetadata?.token_endpoint_auth_methods_supported || [];
      const effectiveTokenAuthMethod = clientInformation.token_endpoint_auth_method
        || this.clientMetadata.token_endpoint_auth_method
        || 'client_secret_basic';
      if (
        supportedMethods.length > 0
        && !supportedMethods.includes(effectiveTokenAuthMethod)
      ) {
        throw new Error(
          'Dynamic registration selected a token authentication method that the authorization server does not advertise.'
        );
      }
      if (
        effectiveTokenAuthMethod !== 'none'
        && !clientInformation.client_secret
      ) {
        throw new Error(
          'Dynamic registration did not issue the credential required by its selected token authentication method.'
        );
      }
      if (effectiveTokenAuthMethod === 'none' && clientInformation.client_secret) {
        throw new Error(
          'Dynamic registration returned a client secret for a public-client token authentication method.'
        );
      }
    }
    this.trace?.registerSecret(clientInformation.client_secret);

    const state = this.readState();
    this.writeState({
      ...state,
      clients: { ...state.clients, [issuer]: clientInformation },
    });
    if (
      !clientInformation.registeredManually
      && clientInformation.client_id !== this.clientMetadataUrl
    ) {
      const response = {
        metadata: { issuer, clientIdAssigned: Boolean(clientInformation.client_id) },
      };
      if (!this.trace?.enrichLast('dynamic_client_registration', {
        outcome: 'succeeded',
        explanation: 'Dynamic client registration succeeded and validated client information was kept for this browser session.',
        response,
      })) {
        this.trace?.record({
          type: 'dynamic_client_registration',
          outcome: 'succeeded',
          provenance: 'authorization_server',
          route: 'direct',
          explanation: 'Dynamic client registration succeeded and validated client information was kept for this browser session.',
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
    if (this.enforcePkceS256) {
      assertPkceS256Discovery(this.discoveryState());
    }
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
    if (this.enforcePkceS256) assertPkceS256Discovery(discovery);
    this.resourceMetadataUrlOverride = discovery.resourceMetadataUrl
      || this.resourceMetadataUrlOverride;
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
    const discoveredIssuer = metadata?.issuer || discovery.authorizationServerUrl;
    const strategy = getOAuthClientEstablishmentStrategy(this.serverUrl, discoveredIssuer);
    if (
      strategy === 'dynamic-client-registration'
      || strategy === 'dynamic-client-registration-only'
    ) {
      // Exact provider policy may select DCR either as a verified compatibility
      // route (Canva) or as the provider's only supported establishment path
      // (Calendly). This is never a generic fallback after a rejection.
      this.clientMetadataUrl = undefined;
    }
    if (!this.trace?.hasEvent('client_establishment')) {
      this.trace?.record({
        type: 'client_establishment',
        outcome: 'succeeded',
        provenance: 'oauth_client',
        route: 'client',
        explanation: strategy === 'dynamic-client-registration'
          ? 'Trusted provider policy selected Dynamic Client Registration before authorization even though CIMD was advertised.'
          : strategy === 'dynamic-client-registration-only'
            ? 'Trusted provider policy requires Dynamic Client Registration and excludes static client configuration for this exact target and issuer.'
          : strategy === 'operator-confidential'
            ? 'Trusted provider policy selected an issuer-bound operator-confidential client before authorization.'
            : 'Standards-advertised client-establishment preference was selected.',
        response: {
          metadata: {
            strategy,
            source: strategy === 'standards-advertised'
              ? 'authorization-server-metadata'
              : 'trusted-provider-policy',
            issuerBinding: discoveredIssuer,
          },
        },
      });
    }
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
    this.updateState({ discovery });
  }

  discoveryState(): OAuthDiscoveryState | undefined {
    const discovery = this.readState().discovery;
    if (!discovery || !this.resourceMetadataUrlOverride) return discovery;
    return {
      ...discovery,
      resourceMetadataUrl: this.resourceMetadataUrlOverride,
    };
  }

  validatePersistedDiscoveryState(): void {
    const discovery = this.readState().discovery;
    if (this.enforcePkceS256 && discovery) assertPkceS256Discovery(discovery);
  }

  usesClientMetadataDocument(issuer?: string): boolean {
    if (!issuer || !this.clientMetadataUrl) return false;
    const discovery = this.discoveryState();
    return discovery?.authorizationServerMetadata?.client_id_metadata_document_supported === true
      && this.clientInformation({ issuer })?.client_id === this.clientMetadataUrl;
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
    const state = parseJson<PersistedOAuthState>(this.storage.getItem(this.storeKey)) || {};
    if (this.sessionOnlyStorage || !state.clients) return state;

    const safeClients = Object.fromEntries(Object.entries(state.clients).filter(
      ([, clientInformation]) => clientInformation.client_secret === undefined
    ));
    if (Object.keys(safeClients).length === Object.keys(state.clients).length) return state;

    const sanitizedState = { ...state };
    if (Object.keys(safeClients).length > 0) sanitizedState.clients = safeClients;
    else delete sanitizedState.clients;
    this.writeState(sanitizedState);
    return sanitizedState;
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
    if (value?.clientSecret) {
      this.storage.removeItem(`oauth_client_${legacyHostForServer(this.serverUrl)}`);
      return undefined;
    }
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
        issuer,
      };
    }

    const legacyClient = this.readLegacyManualClient(issuer);
    if (!legacyClient?.clientId || legacyClient.issuer !== issuer) return undefined;
    return {
      clientId: legacyClient.clientId,
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
  const provider = new BrowserOAuthProvider(normalizedServerUrl, {
    ...options,
    trace,
    enforcePkceS256: true,
    hostedTokenRelayAvailable: Boolean(options.tokenProxy?.authorizationToken),
  });
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
  const tracedFetch = createOAuthTraceFetch(
    trace,
    createProviderPolicyFetch(
      normalizedServerUrl,
      provider,
      createOAuthTokenProxyFetch(
        provider,
        options.tokenProxy,
        createOAuthRegistrationFetch(provider, options.tokenProxy, discoveryFetch)
      )
    )
  );
  const fetchFn = createCimdInteroperabilityFetch(
    normalizedServerUrl,
    provider,
    createKnownProviderDiscoveryEvidenceFetch(normalizedServerUrl, trace, tracedFetch)
  );
  try {
    if (options.tokenProxy && !options.tokenProxy.authorizationToken) {
      throw new OAuthProxyAuthenticationRequiredError();
    }
    if (
      getOAuthProviderPolicy(normalizedServerUrl)?.clientEstablishmentStrategy
        === 'operator-confidential'
      && options.tokenProxy
      && !isSessionOnlyOAuthStorage(storage)
    ) {
      throw new Error('Operator OAuth client IDs may only be stored for the current browser session.');
    }
    await preflightKnownProviderDiscovery(
      normalizedServerUrl,
      provider,
      trace,
      discoveryFetch,
      resourceMetadataUrl
    );
    await establishOperatorOAuthClient(
      normalizedServerUrl,
      provider,
      trace,
      discoveryFetch,
      options.tokenProxy,
      resourceMetadataUrl
    );
    provider.validatePersistedDiscoveryState();
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
    if (
      error instanceof Error
      && error.message.includes('does not advertise PKCE S256 support')
      && !(
        getOAuthProviderPolicy(normalizedServerUrl)?.id === 'intercom'
        && hasUnresolvedDiscoveryFailure(trace)
      )
    ) {
      trace.terminal('failed', error.message);
      throw error;
    }
    let prerequisite: OAuthPrerequisite | undefined;
    if (error instanceof RegistrationRejectedError) {
      const discoveredIssuer = issuerForDiscovery(provider.discoveryState());
      const guidance = providerGuidance(normalizedServerUrl, discoveredIssuer);
      const issuerBoundPolicy = discoveredIssuer
        ? getOAuthProviderPolicy(normalizedServerUrl, discoveredIssuer)
        : undefined;
      const details = registrationFailureDetails(error, issuerBoundPolicy);
      const category = registrationFailureCategory(
        error,
        details,
        issuerBoundPolicy,
        provider.discoveryState()?.authorizationServerMetadata?.registration_endpoint
      );
      const validationErrors = validationErrorsFromDetails(details);
      const explanation = registrationFailureExplanation(
        category,
        guidance.name,
        error.status,
        providerRequiresDynamicRegistration(
          normalizedServerUrl,
          discoveredIssuer
        ),
        validationErrors
      );
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
          : category === 'callback_incompatible'
            ? 'provider_callback_incompatible'
          : 'discovery_blocked_invalid',
        normalizedServerUrl,
        provider,
        trace,
        error,
        options.scope
      );
      trace.terminal(prerequisite.kind, prerequisite.explanation);
    } else if (error instanceof OAuthKnownProviderDiscoveryError) {
      prerequisite = buildOAuthPrerequisite(
        'discovery_blocked_invalid',
        normalizedServerUrl,
        provider,
        trace,
        error,
        options.scope
      );
      trace.terminal(prerequisite.kind, prerequisite.explanation);
    } else if (error instanceof OAuthOperatorClientNotConfiguredError) {
      prerequisite = buildOAuthPrerequisite(
        'operator_client_not_configured',
        normalizedServerUrl,
        provider,
        trace,
        error,
        options.scope
      );
      trace.terminal(prerequisite.kind, prerequisite.explanation);
    } else if (error instanceof OAuthTrustedIssuerBindingError) {
      prerequisite = buildOAuthPrerequisite(
        'discovery_blocked_invalid',
        normalizedServerUrl,
        provider,
        trace,
        error,
        options.scope
      );
      prerequisite = {
        ...prerequisite,
        canConfigureClient: false,
        explanation: error.message,
      };
      trace.terminal(prerequisite.kind, prerequisite.explanation);
    } else if (error instanceof OAuthOperatorClientLookupError) {
      prerequisite = buildOAuthPrerequisite(
        error.status === 429 || error.status >= 500
          ? 'transient_discovery_failure'
          : 'discovery_blocked_invalid',
        normalizedServerUrl,
        provider,
        trace,
        error,
        options.scope
      );
      prerequisite = {
        ...prerequisite,
        canConfigureClient: false,
        httpStatus: error.status,
        explanation: `The issuer-bound operator client lookup failed safely with proxy-owned HTTP ${error.status}; authorization was not started.`,
      };
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
    } else if (
      error instanceof OAuthProxyAuthenticationRequiredError
      || latestFailureIsProxyAuthentication(trace)
    ) {
      prerequisite = buildOAuthPrerequisite(
        'proxy_authentication_required',
        normalizedServerUrl,
        provider,
        trace,
        error,
        options.scope
      );
      trace.terminal('proxy_authentication_required', prerequisite.explanation);
    } else if (error instanceof OAuthRegistrationCorsError) {
      prerequisite = {
        ...buildOAuthPrerequisite(
          'discovery_blocked_invalid',
          normalizedServerUrl,
          provider,
          trace,
          error,
          options.scope
        ),
        explanation: error.message,
      };
      trace.terminal(prerequisite.kind, prerequisite.explanation);
    } else if (
      latestFailureIsDiscovery(trace)
      || (
        getOAuthProviderPolicy(normalizedServerUrl)?.id === 'intercom'
        && hasUnresolvedDiscoveryFailure(trace)
      )
    ) {
      prerequisite = buildOAuthPrerequisite(
        latestFailureIsTransientDiscovery(trace)
          ? 'transient_discovery_failure'
          : 'discovery_blocked_invalid',
        normalizedServerUrl,
        provider,
        trace,
        error,
        options.scope
      );
      trace.terminal(prerequisite.kind, prerequisite.explanation);
    } else {
      trace.terminal(
        'failed',
        `OAuth authorization failed${error instanceof Error ? ` during ${error.name}` : ''}.`
      );
      throw error;
    }
    const safeCause = error instanceof RegistrationRejectedError
      ? new Error(prerequisite.explanation)
      : error;
    throw new OAuthPrerequisiteError(prerequisite, { cause: safeCause });
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
  const provider = new BrowserOAuthProvider(normalizedServerUrl, {
    ...providerOptions,
    storage,
    trace,
  });
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
  const discoveryFetch = createKnownProviderDiscoveryEvidenceFetch(
    normalizedServerUrl,
    trace,
    createOAuthTraceFetch(
      trace,
      createCorsFallbackDiscoveryFetch(trace, fetchFn || fetch, discoveryProxy)
    )
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
    const issuer = issuerForDiscovery(provider.discoveryState());
    if (providerRequiresDynamicRegistration(normalizedServerUrl, issuer)) {
      const prerequisite = buildOAuthPrerequisite(
        'pre_registered_client_required',
        normalizedServerUrl,
        provider,
        trace,
        new Error('Provider requires dynamic client registration')
      );
      trace.terminal(prerequisite.kind, prerequisite.explanation);
      throw new OAuthPrerequisiteError(prerequisite);
    }
    if (providerForbidsDynamicRegistration(normalizedServerUrl, issuer)) {
      trace.record({
        type: 'pre_registered_client',
        outcome: 'required',
        provenance: 'oauth_client',
        route: 'client',
        explanation: 'Provider policy requires an operator-owned confidential OAuth application.',
      });
      const prerequisite = buildOAuthPrerequisite(
        'pre_registered_client_required',
        normalizedServerUrl,
        provider,
        trace,
        new Error('Authorization server does not support dynamic client registration')
      );
      trace.terminal(prerequisite.kind, prerequisite.explanation);
      throw new OAuthPrerequisiteError(prerequisite);
    }
  } catch (error) {
    if (error instanceof OAuthPrerequisiteError) throw error;
    trace.settleLatestProvisionalOAuthResponse('failed');
    const prerequisiteKind: OAuthPrerequisiteKind | undefined = latestFailureIsProxyAuthentication(trace)
      ? 'proxy_authentication_required'
      : latestFailureIsDiscovery(trace)
        ? latestFailureIsTransientDiscovery(trace)
          ? 'transient_discovery_failure'
          : 'discovery_blocked_invalid'
        : undefined;
    if (prerequisiteKind) {
      const prerequisite = buildOAuthPrerequisite(
        prerequisiteKind,
        normalizedServerUrl,
        provider,
        trace,
        error
      );
      trace.terminal(prerequisite.kind, prerequisite.explanation);
      throw new OAuthPrerequisiteError(prerequisite, { cause: error });
    }
    trace.terminal('failed', 'OAuth metadata discovery failed while preparing public client registration.');
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

  const provider = new BrowserOAuthProvider(serverUrl, {
    ...options,
    trace,
    hostedTokenRelayAvailable: Boolean(options.tokenProxy?.authorizationToken),
  });
  try {
    provider.assertState(callbackState);

    const discovery = provider.discoveryState();
    const metadata = discovery?.authorizationServerMetadata;
    const recordedIssuer = issuerForDiscovery(discovery);
    if (!metadata?.issuer || !recordedIssuer || metadata.issuer !== recordedIssuer) {
      throw new Error(
        'Validated issuer-bound authorization-server discovery state is missing. Start authentication again.'
      );
    }
    const issuer = callback.searchParams.get('iss') || undefined;
    validateAuthorizationResponseIssuer({
      iss: issuer,
      expectedIssuer: metadata.issuer,
      issParameterSupported: metadata.authorization_response_iss_parameter_supported === true,
    });

    const responseError = callback.searchParams.get('error');
    if (responseError) {
      if (
        ['invalid_client', 'unauthorized_client'].includes(responseError.toLowerCase())
        && provider.usesClientMetadataDocument(recordedIssuer)
      ) {
        throw new OAuthCimdInteroperabilityError(
          providerGuidance(serverUrl, recordedIssuer).name,
          responseError
        );
      }
      throw new OAuthAuthorizationResponseError(
        responseError,
        callback.searchParams.get('error_description')
      );
    }

    if (!authorizationCode) throw new Error('OAuth callback did not include an authorization code.');

    const authenticate = options.authenticate || auth;
    const tokenFetch = createOAuthTokenProxyFetch(
      provider,
      options.tokenProxy,
      options.fetchFn || fetch
    );
    const result = await authenticate(provider, {
      serverUrl,
      authorizationCode,
      fetchFn: createCimdInteroperabilityFetch(
        serverUrl,
        provider,
        createOAuthTraceFetch(trace, tokenFetch)
      ),
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
  if (clientSecret) {
    throw new Error(
      'Confidential OAuth client secrets must be configured by the mcptest operator and cannot be saved in browser storage.'
    );
  }
  const provider = new BrowserOAuthProvider(serverUrl, { storage });
  const discovery = provider.discoveryState();
  const issuer = discovery?.authorizationServerMetadata?.issuer
    || discovery?.authorizationServerUrl;
  if (!issuer) {
    throw new Error('Authorization-server discovery is missing. Restart OAuth before configuring a client.');
  }
  if (providerRequiresDynamicRegistration(serverUrl, issuer)) {
    throw new Error(
      'This provider supports Dynamic Client Registration only; manual or static client IDs cannot be configured.'
    );
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

export const getProxyAuthenticationPrerequisite = (serverUrl: string): OAuthPrerequisite => ({
  kind: 'proxy_authentication_required',
  serverUrl: normalizeOAuthServerUrl(serverUrl),
  providerName: 'mcptest proxy',
  explanation: 'The authenticated mcptest proxy requires a valid mcptest login. This is proxy access, not target OAuth and not an MCP server failure. Sign in again, then retry.',
  requiredScopes: [],
  pkceS256: false,
  publicClientSecretSupported: 'unknown',
  canConfigureClient: false,
});

export const isOAuthClientConfigurationRequired = (error: unknown): boolean => {
  const prerequisite = getOAuthPrerequisite(error);
  return prerequisite
    ? prerequisite.kind === 'pre_registered_client_required' && prerequisite.canConfigureClient
    : isPreRegisteredClientRequired(error);
};
