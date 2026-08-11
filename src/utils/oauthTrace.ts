import type { FetchLike } from '@modelcontextprotocol/client';

export const OAUTH_TRACE_VERSION = 1 as const;
export const OAUTH_TRACE_STORAGE_PREFIX = 'mcp_oauth_trace_v1:';

export type OAuthTraceEventType =
  | 'target_challenge'
  | 'protected_resource_metadata'
  | 'authorization_server_metadata'
  | 'cimd'
  | 'dynamic_client_registration'
  | 'pre_registered_client'
  | 'pkce'
  | 'authorization_redirect'
  | 'callback'
  | 'token_exchange'
  | 'refresh'
  | 'mcp_retry'
  | 'terminal_outcome';

export type OAuthTraceProvenance =
  | 'direct_target'
  | 'authenticated_proxy'
  | 'authorization_server'
  | 'browser_callback'
  | 'oauth_client';

export type OAuthTraceRoute = 'direct' | 'proxy' | 'browser' | 'client';

export type OAuthTraceEventOutcome =
  | 'started'
  | 'challenged'
  | 'succeeded'
  | 'failed'
  | 'required'
  | 'redirected'
  | 'skipped';

export interface OAuthTraceRequest {
  method: string;
  url: string;
}

export interface OAuthTraceResponse {
  status?: number;
  headers?: Record<string, string>;
  metadata?: Record<string, unknown>;
}

export interface OAuthTraceTiming {
  startedAt: string;
  durationMs?: number;
}

export interface OAuthTraceEventV1 {
  sequence: number;
  type: OAuthTraceEventType;
  outcome: OAuthTraceEventOutcome;
  timestamp: string;
  provenance: OAuthTraceProvenance;
  route: OAuthTraceRoute;
  explanation: string;
  request?: OAuthTraceRequest;
  response?: OAuthTraceResponse;
  timing?: OAuthTraceTiming;
}

export type OAuthTraceTerminalStatus =
  | 'authorized'
  | 'redirected'
  | 'manual_client_required'
  | 'failed'
  | 'cancelled';

export interface OAuthTraceTerminalOutcome {
  status: OAuthTraceTerminalStatus;
  timestamp: string;
  explanation: string;
}

export interface OAuthTraceV1 {
  version: typeof OAUTH_TRACE_VERSION;
  traceId: string;
  targetUrl: string;
  startedAt: string;
  events: OAuthTraceEventV1[];
  outcome?: OAuthTraceTerminalOutcome;
}

type OAuthStorage = Pick<Storage, 'getItem' | 'setItem'>;

type OAuthTraceEventInput = Omit<OAuthTraceEventV1, 'sequence' | 'timestamp'> & {
  timestamp?: string;
};

const SENSITIVE_KEY = /^(?:authorization|proxy-authorization|x-mcp-authorization|dpop|cookie|set-cookie|x-api-key|x_api_key|api-key|api_key|apikey|key|code|authorization_code|access_token|refresh_token|id_token|registration_access_token|token|client_secret|code_verifier|verifier|state|nonce|csrf|session|session_id|sessionid|credential|assertion|client_assertion|request_uri|password|secret)$/i;
const SENSITIVE_TEXT_KEY = '(?:authorization|proxy-authorization|x-mcp-authorization|dpop|cookie|set-cookie|x-api-key|x_api_key|api-key|api_key|apikey|key|code|authorization_code|access_token|refresh_token|id_token|registration_access_token|token|client_secret|code_verifier|verifier|state|nonce|csrf|session|session_id|sessionid|credential|assertion|client_assertion|request|request_uri|password|secret)';
export const OAUTH_TRACE_REDACTED = '[REDACTED]';

const storageKeyForTarget = (targetUrl: string): string => (
  `${OAUTH_TRACE_STORAGE_PREFIX}${encodeURIComponent(sanitizeOAuthTraceUrl(new URL(targetUrl).toString()))}`
);

const makeTraceId = (): string => {
  if (typeof crypto !== 'undefined' && typeof crypto.randomUUID === 'function') {
    return crypto.randomUUID();
  }
  return `oauth-${Date.now()}-${Math.random().toString(36).slice(2)}`;
};

const redactTextPatterns = (value: string): string => value
  .replace(new RegExp(`([?&]${SENSITIVE_TEXT_KEY}=)[^&#\\s]*`, 'gi'), `$1${OAUTH_TRACE_REDACTED}`)
  .replace(new RegExp(`("${SENSITIVE_TEXT_KEY}"\\s*:\\s*")[^"]*`, 'gi'), `$1${OAUTH_TRACE_REDACTED}`)
  .replace(/\b(Bearer|Basic)\s+[^\s,;]+/gi, `$1 ${OAUTH_TRACE_REDACTED}`);

const sanitizeText = (value: string, secrets: ReadonlySet<string>): string => {
  let sanitized = redactTextPatterns(value);
  for (const secret of secrets) {
    if (secret) sanitized = sanitized.split(secret).join(OAUTH_TRACE_REDACTED);
  }
  return sanitized;
};

/** Removes credentials, fragments, and sensitive query values from a trace URL. */
export const sanitizeOAuthTraceUrl = (
  value: string | URL,
  secrets: ReadonlySet<string> = new Set()
): string => {
  try {
    const url = new URL(String(value));
    if (url.username) url.username = OAUTH_TRACE_REDACTED;
    if (url.password) url.password = OAUTH_TRACE_REDACTED;
    url.hash = '';

    for (const [key, queryValue] of [...url.searchParams.entries()]) {
      if (SENSITIVE_KEY.test(key)) {
        url.searchParams.set(key, OAUTH_TRACE_REDACTED);
      } else if (key === 'target' || key === 'redirect_uri' || key === 'resource') {
        try {
          url.searchParams.set(key, sanitizeOAuthTraceUrl(queryValue, secrets));
        } catch {
          url.searchParams.set(key, sanitizeText(queryValue, secrets));
        }
      } else {
        url.searchParams.set(key, sanitizeText(queryValue, secrets));
      }
    }
    return sanitizeText(url.toString(), secrets);
  } catch {
    return sanitizeText(String(value), secrets);
  }
};

const sanitizeValue = (
  value: unknown,
  secrets: ReadonlySet<string>,
  key?: string,
  seen = new WeakSet<object>()
): unknown => {
  if (key && SENSITIVE_KEY.test(key)) return OAUTH_TRACE_REDACTED;
  if (typeof value === 'string') {
    if (key && /url|uri|endpoint|issuer|resource/i.test(key)) {
      return sanitizeOAuthTraceUrl(value, secrets);
    }
    return sanitizeText(value, secrets);
  }
  if (value === null || typeof value !== 'object') return value;
  if (seen.has(value)) return '[Circular]';
  seen.add(value);
  if (Array.isArray(value)) {
    return value.map((item) => sanitizeValue(item, secrets, key, seen));
  }
  return Object.fromEntries(Object.entries(value as Record<string, unknown>).map(
    ([childKey, childValue]) => [childKey, sanitizeValue(childValue, secrets, childKey, seen)]
  ));
};

const safeResponseHeaders = (response: Response, secrets: ReadonlySet<string>): Record<string, string> => {
  const headers: Record<string, string> = {};
  const contentType = response.headers.get('content-type');
  const location = response.headers.get('location');
  const authenticate = response.headers.get('www-authenticate');
  if (contentType) headers['content-type'] = sanitizeText(contentType, secrets);
  if (location) headers.location = sanitizeOAuthTraceUrl(location, secrets);
  if (authenticate) headers['www-authenticate'] = sanitizeText(authenticate, secrets);
  return headers;
};

const requestDetails = async (
  input: Parameters<FetchLike>[0],
  init?: Parameters<FetchLike>[1]
): Promise<{
  method: string;
  url: string;
  grantType?: string;
  registrationRequest?: boolean;
}> => {
  const request = typeof Request !== 'undefined' && input instanceof Request ? input : undefined;
  const method = (init?.method || request?.method || 'GET').toUpperCase();
  let body: string | undefined;
  if (init?.body instanceof URLSearchParams) body = init.body.toString();
  else if (typeof init?.body === 'string') body = init.body;
  else if (!init?.body && request && method !== 'GET' && method !== 'HEAD') {
    try {
      body = await request.clone().text();
    } catch {
      // The body is deliberately optional; traces never retain it.
    }
  }
  let grantType: string | undefined;
  let registrationRequest = false;
  if (body) {
    try {
      grantType = new URLSearchParams(body).get('grant_type') || undefined;
    } catch {
      // Ignore non-form bodies.
    }
    try {
      const json = JSON.parse(body) as Record<string, unknown>;
      registrationRequest = Array.isArray(json.redirect_uris) && typeof json.client_name === 'string';
    } catch {
      // Ignore non-JSON bodies.
    }
  }
  return {
    method,
    url: request?.url || String(input),
    grantType,
    ...(registrationRequest ? { registrationRequest: true } : {}),
  };
};

const classifyOAuthRequest = (
  urlValue: string,
  method: string,
  grantType?: string,
  registrationRequest = false
): OAuthTraceEventType | undefined => {
  let pathname = '';
  try {
    pathname = new URL(urlValue).pathname;
  } catch {
    pathname = urlValue;
  }
  if (pathname.includes('/.well-known/oauth-protected-resource')) {
    return 'protected_resource_metadata';
  }
  if (
    pathname.includes('/.well-known/oauth-authorization-server')
    || pathname.includes('/.well-known/openid-configuration')
  ) {
    return 'authorization_server_metadata';
  }
  if (grantType === 'refresh_token') return 'refresh';
  if (grantType === 'authorization_code') return 'token_exchange';
  if (method === 'POST' && (registrationRequest || /register|registration/i.test(pathname))) {
    return 'dynamic_client_registration';
  }
  return undefined;
};

const explanationForRequest = (
  type: OAuthTraceEventType,
  ok: boolean,
  status?: number
): string => {
  const label: Partial<Record<OAuthTraceEventType, string>> = {
    protected_resource_metadata: 'Protected-resource metadata discovery',
    authorization_server_metadata: 'Authorization-server metadata discovery',
    dynamic_client_registration: 'Dynamic client registration',
    token_exchange: 'Authorization-code token exchange',
    refresh: 'Access-token refresh',
  };
  const operation = label[type] || 'OAuth request';
  if (ok) return `${operation} succeeded${status ? ` with HTTP ${status}` : ''}.`;
  return `${operation} failed${status ? ` with HTTP ${status}` : ''}.`;
};

export class OAuthFlightRecorder {
  private readonly secrets = new Set<string>();

  constructor(
    private trace: OAuthTraceV1,
    private readonly storage?: OAuthStorage,
    private readonly storageKey = storageKeyForTarget(trace.targetUrl)
  ) {
    this.persist();
  }

  registerSecret(...values: Array<string | null | undefined>): void {
    for (const value of values) {
      if (value) this.secrets.add(value);
    }
  }

  record(event: OAuthTraceEventInput): OAuthTraceEventV1 {
    const timestamp = event.timestamp || new Date().toISOString();
    const sanitized = sanitizeValue({ ...event, timestamp }, this.secrets) as Omit<
      OAuthTraceEventV1,
      'sequence'
    >;
    const recorded: OAuthTraceEventV1 = {
      ...sanitized,
      sequence: this.trace.events.length + 1,
    };
    this.trace.events.push(recorded);
    this.persist();
    return recorded;
  }

  enrichLast(
    type: OAuthTraceEventType,
    update: Partial<Pick<OAuthTraceEventV1, 'outcome' | 'explanation' | 'response'>>
  ): boolean {
    const event = [...this.trace.events].reverse().find((candidate) => candidate.type === type);
    if (!event) return false;
    const sanitized = sanitizeValue(update, this.secrets) as typeof update;
    if (sanitized.response) {
      event.response = {
        ...event.response,
        ...sanitized.response,
        headers: { ...event.response?.headers, ...sanitized.response.headers },
        metadata: { ...event.response?.metadata, ...sanitized.response.metadata },
      };
    }
    if (sanitized.outcome) event.outcome = sanitized.outcome;
    if (sanitized.explanation) event.explanation = sanitized.explanation;
    this.persist();
    return true;
  }

  hasEvent(type: OAuthTraceEventType, outcome?: OAuthTraceEventOutcome): boolean {
    return this.trace.events.some((event) => (
      event.type === type && (!outcome || event.outcome === outcome)
    ));
  }

  terminal(status: OAuthTraceTerminalStatus, explanation: string): void {
    const outcome: OAuthTraceTerminalOutcome = {
      status,
      timestamp: new Date().toISOString(),
      explanation: sanitizeText(explanation, this.secrets),
    };
    this.trace.outcome = outcome;
    this.record({
      type: 'terminal_outcome',
      outcome: status === 'authorized'
        ? 'succeeded'
        : status === 'redirected'
          ? 'redirected'
          : status === 'manual_client_required'
            ? 'required'
            : 'failed',
      provenance: 'oauth_client',
      route: 'client',
      explanation: outcome.explanation,
    });
  }

  snapshot(): OAuthTraceV1 {
    return JSON.parse(JSON.stringify(sanitizeValue(this.trace, this.secrets))) as OAuthTraceV1;
  }

  serialize(space?: number): string {
    return JSON.stringify(this.snapshot(), null, space);
  }

  toJSON(): OAuthTraceV1 {
    return this.snapshot();
  }

  private persist(): void {
    this.storage?.setItem(this.storageKey, JSON.stringify(this.snapshot()));
  }
}

export interface CreateOAuthFlightRecorderOptions {
  targetUrl: string;
  storage?: OAuthStorage;
  traceId?: string;
  startedAt?: string;
}

export interface RecordOAuthAuthenticationChallengeOptions {
  targetUrl: string;
  status: 401 | 403;
  source: 'target' | 'proxy';
  route: 'direct' | 'proxy';
  storage?: OAuthStorage;
  method?: string;
  requestUrl?: string;
  timing?: OAuthTraceTiming;
}

export const createOAuthFlightRecorder = ({
  targetUrl,
  storage,
  traceId = makeTraceId(),
  startedAt = new Date().toISOString(),
}: CreateOAuthFlightRecorderOptions): OAuthFlightRecorder => new OAuthFlightRecorder({
  version: OAUTH_TRACE_VERSION,
  traceId,
  targetUrl: sanitizeOAuthTraceUrl(new URL(targetUrl).toString()),
  startedAt,
  events: [],
}, storage);

/** Starts a trace at the point an HTTP authentication challenge is actually observed. */
export const recordOAuthAuthenticationChallenge = ({
  targetUrl,
  status,
  source,
  route,
  storage,
  method = 'POST',
  requestUrl = targetUrl,
  timing,
}: RecordOAuthAuthenticationChallengeOptions): OAuthFlightRecorder => {
  const recorder = createOAuthFlightRecorder({ targetUrl, storage });
  recorder.record({
    type: 'target_challenge',
    outcome: 'challenged',
    provenance: source === 'target' ? 'direct_target' : 'authenticated_proxy',
    route,
    explanation: source === 'target'
      ? `The MCP target returned the expected HTTP ${status} authentication challenge.`
      : `The authenticated proxy returned HTTP ${status}; this is not an OAuth challenge from the MCP target.`,
    request: { method, url: requestUrl },
    response: { status },
    ...(timing ? { timing } : {}),
  });
  return recorder;
};

export const getStoredOAuthTrace = (
  targetUrl: string,
  storage: OAuthStorage
): OAuthTraceV1 | undefined => {
  try {
    const value = storage.getItem(storageKeyForTarget(targetUrl));
    if (!value) return undefined;
    const trace = JSON.parse(value) as OAuthTraceV1;
    return trace.version === OAUTH_TRACE_VERSION && Array.isArray(trace.events)
      ? trace
      : undefined;
  } catch {
    return undefined;
  }
};

export const resumeOAuthFlightRecorder = (
  targetUrl: string,
  storage: OAuthStorage
): OAuthFlightRecorder | undefined => {
  const trace = getStoredOAuthTrace(targetUrl, storage);
  return trace ? new OAuthFlightRecorder(trace, storage) : undefined;
};

/** A fetch wrapper that records only sanitized request/response facts, never bodies. */
export const createOAuthTraceFetch = (
  recorder: OAuthFlightRecorder,
  fetchFn: FetchLike = fetch
): FetchLike => async (input, init) => {
  const details = await requestDetails(input, init);
  const type = classifyOAuthRequest(
    details.url,
    details.method,
    details.grantType,
    details.registrationRequest
  );
  if (!type) return fetchFn(input, init);

  const startedAtMs = Date.now();
  const startedAt = new Date(startedAtMs).toISOString();
  try {
    const response = await fetchFn(input, init);
    const durationMs = Math.max(0, Date.now() - startedAtMs);
    recorder.record({
      type,
      outcome: response.ok ? 'succeeded' : 'failed',
      provenance: type === 'protected_resource_metadata'
        ? 'direct_target'
        : 'authorization_server',
      route: 'direct',
      explanation: explanationForRequest(type, response.ok, response.status),
      request: {
        method: details.method,
        url: sanitizeOAuthTraceUrl(details.url),
      },
      response: {
        status: response.status,
        headers: safeResponseHeaders(response, new Set()),
      },
      timing: { startedAt, durationMs },
    });
    return response;
  } catch (error) {
    recorder.record({
      type,
      outcome: 'failed',
      provenance: type === 'protected_resource_metadata'
        ? 'direct_target'
        : 'authorization_server',
      route: 'direct',
      explanation: `${explanationForRequest(type, false)} The request did not receive an HTTP response.`,
      request: {
        method: details.method,
        url: sanitizeOAuthTraceUrl(details.url),
      },
      timing: {
        startedAt,
        durationMs: Math.max(0, Date.now() - startedAtMs),
      },
    });
    throw error;
  }
};

export const serializeOAuthTrace = (
  trace: OAuthTraceV1 | OAuthFlightRecorder,
  space?: number
): string => trace instanceof OAuthFlightRecorder
  ? trace.serialize(space)
  : JSON.stringify(sanitizeValue(trace, new Set()), null, space);
