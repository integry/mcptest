import type { FetchLike, ProtocolEra } from '@modelcontextprotocol/client';
import {
  getObservedAuthenticationChallenge,
  isOAuthSensitiveKey,
  sanitizeAuthenticationChallenge,
  sanitizeOAuthUrlQueryValues,
  type ObservedTransportRequest,
} from './transportDetection';
import type { TransportType } from '../types';

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
  targetFingerprint: string;
  targetUrl: string;
  startedAt: string;
  events: OAuthTraceEventV1[];
  authenticatedMcpRetry?: {
    phase: 'awaiting_callback' | 'pending';
    updatedAt: string;
  };
  outcome?: OAuthTraceTerminalOutcome;
}

type OAuthStorage = Pick<Storage, 'getItem' | 'setItem'>;

type OAuthTraceEventInput = Omit<OAuthTraceEventV1, 'sequence' | 'timestamp'> & {
  timestamp?: string;
};

const KEY_SEPARATOR = '[-_]?';
const SENSITIVE_TEXT_KEY = `(?:authorization|proxy${KEY_SEPARATOR}authorization|x${KEY_SEPARATOR}mcp${KEY_SEPARATOR}authorization|dpop|cookie|set${KEY_SEPARATOR}cookie|x${KEY_SEPARATOR}api${KEY_SEPARATOR}key|api${KEY_SEPARATOR}key|key|code|authorization${KEY_SEPARATOR}code|device${KEY_SEPARATOR}code|user${KEY_SEPARATOR}code|access${KEY_SEPARATOR}token|refresh${KEY_SEPARATOR}token|id${KEY_SEPARATOR}token(?:${KEY_SEPARATOR}hint)?|registration${KEY_SEPARATOR}access${KEY_SEPARATOR}token|token|client${KEY_SEPARATOR}secret|code${KEY_SEPARATOR}verifier|verifier|state|nonce|csrf|session(?:${KEY_SEPARATOR}id)?|credential|assertion|client${KEY_SEPARATOR}assertion|request(?:${KEY_SEPARATOR}uri)?|password|secret)`;
export const OAUTH_TRACE_REDACTED = '[REDACTED]';

const normalizeOAuthTraceTarget = (targetUrl: string): string => new URL(targetUrl).toString();

// A synchronous SHA-256 implementation keeps trace lookup synchronous for
// sessionStorage while ensuring the full target never appears in the key.
const sha256 = (value: string): string => {
  const bytes = new TextEncoder().encode(value);
  const paddedLength = Math.ceil((bytes.length + 9) / 64) * 64;
  const padded = new Uint8Array(paddedLength);
  padded.set(bytes);
  padded[bytes.length] = 0x80;
  const view = new DataView(padded.buffer);
  const bitLength = bytes.length * 8;
  view.setUint32(paddedLength - 8, Math.floor(bitLength / 0x100000000));
  view.setUint32(paddedLength - 4, bitLength >>> 0);

  const constants = new Uint32Array([
    0x428a2f98, 0x71374491, 0xb5c0fbcf, 0xe9b5dba5, 0x3956c25b, 0x59f111f1,
    0x923f82a4, 0xab1c5ed5, 0xd807aa98, 0x12835b01, 0x243185be, 0x550c7dc3,
    0x72be5d74, 0x80deb1fe, 0x9bdc06a7, 0xc19bf174, 0xe49b69c1, 0xefbe4786,
    0x0fc19dc6, 0x240ca1cc, 0x2de92c6f, 0x4a7484aa, 0x5cb0a9dc, 0x76f988da,
    0x983e5152, 0xa831c66d, 0xb00327c8, 0xbf597fc7, 0xc6e00bf3, 0xd5a79147,
    0x06ca6351, 0x14292967, 0x27b70a85, 0x2e1b2138, 0x4d2c6dfc, 0x53380d13,
    0x650a7354, 0x766a0abb, 0x81c2c92e, 0x92722c85, 0xa2bfe8a1, 0xa81a664b,
    0xc24b8b70, 0xc76c51a3, 0xd192e819, 0xd6990624, 0xf40e3585, 0x106aa070,
    0x19a4c116, 0x1e376c08, 0x2748774c, 0x34b0bcb5, 0x391c0cb3, 0x4ed8aa4a,
    0x5b9cca4f, 0x682e6ff3, 0x748f82ee, 0x78a5636f, 0x84c87814, 0x8cc70208,
    0x90befffa, 0xa4506ceb, 0xbef9a3f7, 0xc67178f2,
  ]);
  const hash = new Uint32Array([
    0x6a09e667, 0xbb67ae85, 0x3c6ef372, 0xa54ff53a,
    0x510e527f, 0x9b05688c, 0x1f83d9ab, 0x5be0cd19,
  ]);
  const words = new Uint32Array(64);
  const rotateRight = (word: number, bits: number): number => (
    (word >>> bits) | (word << (32 - bits))
  );

  for (let offset = 0; offset < paddedLength; offset += 64) {
    for (let index = 0; index < 16; index += 1) {
      words[index] = view.getUint32(offset + index * 4);
    }
    for (let index = 16; index < 64; index += 1) {
      const left = words[index - 15];
      const right = words[index - 2];
      const sigma0 = rotateRight(left, 7) ^ rotateRight(left, 18) ^ (left >>> 3);
      const sigma1 = rotateRight(right, 17) ^ rotateRight(right, 19) ^ (right >>> 10);
      words[index] = (words[index - 16] + sigma0 + words[index - 7] + sigma1) >>> 0;
    }

    let [a, b, c, d, e, f, g, h] = hash;
    for (let index = 0; index < 64; index += 1) {
      const sum1 = rotateRight(e, 6) ^ rotateRight(e, 11) ^ rotateRight(e, 25);
      const choice = (e & f) ^ (~e & g);
      const temp1 = (h + sum1 + choice + constants[index] + words[index]) >>> 0;
      const sum0 = rotateRight(a, 2) ^ rotateRight(a, 13) ^ rotateRight(a, 22);
      const majority = (a & b) ^ (a & c) ^ (b & c);
      const temp2 = (sum0 + majority) >>> 0;
      h = g;
      g = f;
      f = e;
      e = (d + temp1) >>> 0;
      d = c;
      c = b;
      b = a;
      a = (temp1 + temp2) >>> 0;
    }
    hash[0] = (hash[0] + a) >>> 0;
    hash[1] = (hash[1] + b) >>> 0;
    hash[2] = (hash[2] + c) >>> 0;
    hash[3] = (hash[3] + d) >>> 0;
    hash[4] = (hash[4] + e) >>> 0;
    hash[5] = (hash[5] + f) >>> 0;
    hash[6] = (hash[6] + g) >>> 0;
    hash[7] = (hash[7] + h) >>> 0;
  }

  return [...hash].map((word) => word.toString(16).padStart(8, '0')).join('');
};

const fingerprintTarget = (targetUrl: string): string => sha256(normalizeOAuthTraceTarget(targetUrl));

const storageKeyForTarget = (targetUrl: string): string => (
  `${OAUTH_TRACE_STORAGE_PREFIX}${fingerprintTarget(targetUrl)}`
);

const makeTraceId = (): string => {
  if (typeof crypto !== 'undefined' && typeof crypto.randomUUID === 'function') {
    return crypto.randomUUID();
  }
  return `oauth-${Date.now()}-${Math.random().toString(36).slice(2)}`;
};

const redactTextPatterns = (value: string): string => {
  let redacted = value;
  const boundary = `(^|[?&;,\\s=:'"\\[\\]{}()])`;
  const decodedAssignment = new RegExp(
    `${boundary}(${SENSITIVE_TEXT_KEY})(\\s*=\\s*)(?:"[^"]*"|'[^']*'|[^&#;,\\r\\n\\s"'\\]\\}]*)`,
    'gi'
  );
  const colonAssignment = new RegExp(
    `${boundary}(${SENSITIVE_TEXT_KEY})(\\s*:\\s*)(?:"[^"]*"|'[^']*'|[^;,\\r\\n\\]\\}]*)`,
    'gi'
  );
  const encodedAssignment = new RegExp(
    `${boundary}(${SENSITIVE_TEXT_KEY})(%3d|%253d)(.*?)(?=%2526|%26|[&#;,\\s"'\\]\\}]|$)`,
    'gi'
  );
  const redactAssignment = (
    match: string,
    prefix: string,
    key: string,
    separator: string
  ): string => (
    match.includes(OAUTH_TRACE_REDACTED) || /%5bREDACTED%5d/i.test(match)
      ? match
      : `${prefix}${key}${separator}${OAUTH_TRACE_REDACTED}`
  );

  // Nested OAuth errors can contain several assignment layers. Re-run a
  // bounded, idempotent pass so delimiters exposed by one replacement cannot
  // shield a credential deeper in the same explanation or metadata value.
  for (let pass = 0; pass < 4; pass += 1) {
    const next = redacted
      .replace(decodedAssignment, redactAssignment)
      .replace(colonAssignment, redactAssignment)
      .replace(encodedAssignment, redactAssignment)
      .replace(
        /\b(Bearer|Basic)\s+(?![a-z][a-z0-9_-]*\s*=)[^\s,;]+/gi,
        `$1 ${OAUTH_TRACE_REDACTED}`
      );
    if (next === redacted) break;
    redacted = next;
  }
  return redacted;
};

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
  const sanitized = sanitizeOAuthUrlQueryValues(value, OAUTH_TRACE_REDACTED);
  return sanitizeText(sanitized, secrets);
};

const sanitizeValue = (
  value: unknown,
  secrets: ReadonlySet<string>,
  key?: string,
  seen = new WeakSet<object>()
): unknown => {
  if (key && isOAuthSensitiveKey(key)) return OAUTH_TRACE_REDACTED;
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
  if (authenticate) {
    headers['www-authenticate'] = sanitizeText(
      sanitizeAuthenticationChallenge(authenticate),
      secrets
    );
  }
  return headers;
};

const safeChallengeResponseHeaders = (
  headers: Record<string, string>,
  secrets: ReadonlySet<string>
): Record<string, string> => {
  const authenticate = Object.entries(headers).find(
    ([key]) => key.toLowerCase() === 'www-authenticate'
  )?.[1];
  return authenticate
    ? {
      'www-authenticate': sanitizeText(
        sanitizeAuthenticationChallenge(authenticate),
        secrets
      ),
    }
    : {};
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

const OAUTH_REQUEST_LABELS: Partial<Record<OAuthTraceEventType, string>> = {
  protected_resource_metadata: 'Protected-resource metadata discovery',
  authorization_server_metadata: 'Authorization-server metadata discovery',
  dynamic_client_registration: 'Dynamic client registration',
  token_exchange: 'Authorization-code token exchange',
  refresh: 'Access-token refresh',
};

const oauthRequestLabel = (type: OAuthTraceEventType): string => (
  OAUTH_REQUEST_LABELS[type] || 'OAuth request'
);

const explanationForRequest = (
  type: OAuthTraceEventType,
  ok: boolean,
  status?: number
): string => {
  const operation = oauthRequestLabel(type);
  if (ok) return `${operation} succeeded${status ? ` with HTTP ${status}` : ''}.`;
  return `${operation} failed${status ? ` with HTTP ${status}` : ''}.`;
};

const PROVISIONAL_OAUTH_HTTP_EVENT_TYPES = new Set<OAuthTraceEventType>([
  'protected_resource_metadata',
  'authorization_server_metadata',
  'dynamic_client_registration',
  'token_exchange',
  'refresh',
]);

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
    update: Partial<Pick<OAuthTraceEventV1, 'outcome' | 'explanation' | 'response' | 'timing'>>
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
    if (sanitized.timing) event.timing = sanitized.timing;
    this.persist();
    return true;
  }

  settleLatestProvisionalOAuthResponse(
    outcome: 'succeeded' | 'failed',
    types: readonly OAuthTraceEventType[] = [...PROVISIONAL_OAUTH_HTTP_EVENT_TYPES]
  ): boolean {
    const allowedTypes = new Set(types);
    const event = [...this.trace.events].reverse().find((candidate) => (
      candidate.outcome === 'started'
      && allowedTypes.has(candidate.type)
      && PROVISIONAL_OAUTH_HTTP_EVENT_TYPES.has(candidate.type)
    ));
    if (!event) return false;

    event.outcome = outcome;
    event.explanation = sanitizeText(
      outcome === 'succeeded'
        ? `${explanationForRequest(event.type, true, event.response?.status)} The SDK parsed and validated the response.`
        : `${explanationForRequest(event.type, false, event.response?.status)} The SDK rejected the response during parsing or validation.`,
      this.secrets
    );
    this.persist();
    return true;
  }

  hasEvent(type: OAuthTraceEventType, outcome?: OAuthTraceEventOutcome): boolean {
    return this.trace.events.some((event) => (
      event.type === type && (!outcome || event.outcome === outcome)
    ));
  }

  setAuthenticatedMcpRetryState(state: 'awaiting_callback' | 'pending'): void {
    this.trace.authenticatedMcpRetry = {
      phase: state,
      updatedAt: new Date().toISOString(),
    };
    // A redirect is an intermediate browser handoff for challenge-driven
    // authorization, not the final result of the authorization flight.
    if (this.trace.outcome?.status === 'redirected') {
      delete this.trace.outcome;
    }
    this.persist();
  }

  hasPendingAuthenticatedMcpRetry(): boolean {
    return this.trace.authenticatedMcpRetry?.phase === 'pending';
  }

  hasAuthenticatedMcpRetryState(): boolean {
    return Boolean(this.trace.authenticatedMcpRetry);
  }

  continueAfterRedirect(): boolean {
    if (this.trace.outcome?.status !== 'redirected') return false;

    delete this.trace.outcome;
    const provisionalTerminal = [...this.trace.events].reverse().find((event) => (
      event.type === 'terminal_outcome' && event.outcome === 'redirected'
    ));
    if (provisionalTerminal) {
      provisionalTerminal.outcome = 'skipped';
      provisionalTerminal.explanation = sanitizeText(
        'The provisional redirected outcome was superseded when OAuth authorization resumed at the browser callback.',
        this.secrets
      );
    }
    this.persist();
    return true;
  }

  continueAfterManualClientRequired(): boolean {
    if (this.trace.outcome?.status !== 'manual_client_required') return false;

    delete this.trace.outcome;
    const provisionalTerminal = [...this.trace.events].reverse().find((event) => (
      event.type === 'terminal_outcome' && event.outcome === 'required'
    ));
    if (provisionalTerminal) {
      provisionalTerminal.outcome = 'skipped';
      provisionalTerminal.explanation = sanitizeText(
        'The provisional manual-client-required outcome was superseded when OAuth authorization resumed for manual-client continuation.',
        this.secrets
      );
    }
    this.persist();
    return true;
  }

  terminal(status: OAuthTraceTerminalStatus, explanation: string): void {
    const outcome: OAuthTraceTerminalOutcome = {
      status,
      timestamp: new Date().toISOString(),
      explanation: sanitizeText(explanation, this.secrets),
    };
    delete this.trace.authenticatedMcpRetry;
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
    try {
      this.storage?.setItem(this.storageKey, JSON.stringify(this.snapshot()));
    } catch {
      // Diagnostics are best-effort. Storage can be unavailable or full, but
      // recording must continue in memory without changing the primary flow.
    }
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
  responseHeaders?: Record<string, string>;
  timing?: OAuthTraceTiming;
}

export const createOAuthFlightRecorder = ({
  targetUrl,
  storage,
  traceId = makeTraceId(),
  startedAt = new Date().toISOString(),
}: CreateOAuthFlightRecorderOptions): OAuthFlightRecorder => {
  const normalizedTarget = normalizeOAuthTraceTarget(targetUrl);
  return new OAuthFlightRecorder({
    version: OAUTH_TRACE_VERSION,
    traceId,
    targetFingerprint: fingerprintTarget(normalizedTarget),
    targetUrl: sanitizeOAuthTraceUrl(normalizedTarget),
    startedAt,
    events: [],
  }, storage, storageKeyForTarget(normalizedTarget));
};

/** Starts a trace at the point an HTTP authentication challenge is actually observed. */
export const recordOAuthAuthenticationChallenge = ({
  targetUrl,
  status,
  source,
  route,
  storage,
  method,
  requestUrl,
  responseHeaders,
  timing,
}: RecordOAuthAuthenticationChallengeOptions): OAuthFlightRecorder => {
  const existing = storage
    ? resumeOAuthFlightRecorder(targetUrl, storage)
    : undefined;
  // Preserve an in-flight redirect/retry record. A concurrent challenge may
  // still be traced in memory by its caller, but must not replace or mutate
  // the stored flight that owns the pending marker.
  const recorder = createOAuthFlightRecorder({
    targetUrl,
    ...(existing?.hasAuthenticatedMcpRetryState() ? {} : { storage }),
  });
  recorder.record({
    type: 'target_challenge',
    outcome: 'challenged',
    provenance: source === 'target' ? 'direct_target' : 'authenticated_proxy',
    route,
    explanation: source === 'target'
      ? `The MCP target returned the expected HTTP ${status} authentication challenge.`
      : `The authenticated proxy returned HTTP ${status}; this is not an OAuth challenge from the MCP target.`,
    ...(method && requestUrl ? { request: { method, url: requestUrl } } : {}),
    response: {
      status,
      ...(responseHeaders ? { headers: safeChallengeResponseHeaders(responseHeaders, new Set()) } : {}),
    },
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
    return trace.version === OAUTH_TRACE_VERSION
      && trace.targetFingerprint === fingerprintTarget(targetUrl)
      && Array.isArray(trace.events)
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
  return trace
    ? new OAuthFlightRecorder(trace, storage, storageKeyForTarget(targetUrl))
    : undefined;
};

export interface AuthenticatedMcpRetryResult {
  url: string;
  transportType: TransportType;
  protocolEra: ProtocolEra;
  protocolVersion?: string;
  observedRequests?: readonly ObservedTransportRequest[];
}

export interface PendingAuthenticatedMcpRetryOptions {
  targetUrl: string;
  storage: OAuthStorage;
  protocolEraHint?: string;
  operation: string;
  startedAt?: number;
}

interface FinalizeAuthenticatedMcpRetryOptions {
  route: 'direct' | 'proxy';
  error?: unknown;
  result?: AuthenticatedMcpRetryResult;
  observedRequest?: ObservedTransportRequest;
}

export class PendingAuthenticatedMcpRetry {
  private readonly observedRequests: Array<{
    route: 'direct' | 'proxy';
    request: ObservedTransportRequest;
  }> = [];
  private finalized = false;

  constructor(
    private recorder: OAuthFlightRecorder,
    private readonly targetUrl: string,
    private readonly storage: OAuthStorage,
    private readonly operation: string,
    private readonly protocolEraHint?: string,
    private readonly startedAt = Date.now()
  ) {}

  observeRequest(route: 'direct' | 'proxy'): (request: ObservedTransportRequest) => void {
    return (request) => {
      if (!this.finalized) this.observedRequests.push({ route, request });
    };
  }

  succeed(options: Omit<FinalizeAuthenticatedMcpRetryOptions, 'error'>): boolean {
    return this.finalize('succeeded', options);
  }

  fail(options: FinalizeAuthenticatedMcpRetryOptions): boolean {
    return this.finalize('failed', options);
  }

  private latestRecorder(): OAuthFlightRecorder | undefined {
    const stored = resumeOAuthFlightRecorder(this.targetUrl, this.storage);
    if (!stored?.hasPendingAuthenticatedMcpRetry()) return undefined;
    if (stored.snapshot().traceId !== this.recorder.snapshot().traceId) return undefined;
    this.recorder = stored;
    return stored;
  }

  private selectRequest({
    route,
    error,
    result,
    observedRequest,
  }: FinalizeAuthenticatedMcpRetryOptions): ObservedTransportRequest | undefined {
    if (observedRequest) return observedRequest;
    const challenge = error ? getObservedAuthenticationChallenge(error) : undefined;
    const requests = result?.observedRequests?.length
      ? [...result.observedRequests]
      : this.observedRequests
        .filter((entry) => entry.route === route)
        .map(({ request }) => request);
    if (challenge?.method && challenge.requestUrl) {
      const matchingChallenge = [...requests].reverse().find((request) => (
        request.method === challenge.method && request.url === challenge.requestUrl
      ));
      if (matchingChallenge) return matchingChallenge;
    }
    return [...requests].reverse().find((request) => request.outcome !== 'started')
      || [...requests].reverse()[0];
  }

  private finalize(
    outcome: 'succeeded' | 'failed',
    options: FinalizeAuthenticatedMcpRetryOptions
  ): boolean {
    if (this.finalized) return false;
    const recorder = this.latestRecorder();
    if (!recorder) return false;

    const challenge = options.error
      ? getObservedAuthenticationChallenge(options.error)
      : undefined;
    const request = this.selectRequest(options);
    const method = request?.method || challenge?.method;
    const requestUrl = request?.url || challenge?.requestUrl;
    const status = request?.status ?? challenge?.status;
    const startedAt = request?.startedAt || challenge?.startedAt
      || new Date(this.startedAt).toISOString();
    const durationMs = request?.durationMs ?? challenge?.durationMs
      ?? Math.max(0, Date.now() - this.startedAt);
    const errorType = options.error instanceof Error
      ? options.error.name
      : options.error === undefined
        ? undefined
        : 'UnknownError';

    recorder.record({
      type: 'mcp_retry',
      outcome,
      provenance: options.route === 'direct' ? 'direct_target' : 'authenticated_proxy',
      route: options.route,
      explanation: outcome === 'succeeded'
        ? `The authenticated MCP retry for ${this.operation} succeeded on the ${options.route} route${status !== undefined ? ` with HTTP ${status}` : ''}.`
        : `The authenticated MCP retry failed for ${this.operation} on the ${options.route} route${status !== undefined ? ` with HTTP ${status}` : ''}${errorType ? ` during ${errorType}` : ''}.`,
      ...(method && requestUrl ? { request: { method, url: requestUrl } } : {}),
      response: {
        ...(status !== undefined ? { status } : {}),
        metadata: {
          protocolEraHint: this.protocolEraHint || 'automatic',
          ...(options.result ? {
            transportType: options.result.transportType,
            protocolEra: options.result.protocolEra,
            protocolVersion: options.result.protocolVersion,
          } : {}),
          ...(request?.transportType ? { candidateTransportType: request.transportType } : {}),
          ...(errorType ? { errorType } : {}),
        },
      },
      timing: { startedAt, durationMs },
    });
    recorder.terminal(
      outcome === 'succeeded' ? 'authorized' : 'failed',
      outcome === 'succeeded'
        ? `OAuth authorization and the authenticated MCP retry for ${this.operation} completed successfully.`
        : `OAuth authorization completed, but the authenticated MCP retry failed for ${this.operation}${status !== undefined ? ` with HTTP ${status}` : ''}${errorType ? ` during ${errorType}` : ''}.`
    );
    this.finalized = true;
    return true;
  }
}

/** Resumes only the pending retry stored under this exact target fingerprint. */
export const resumePendingAuthenticatedMcpRetry = ({
  targetUrl,
  storage,
  protocolEraHint,
  operation,
  startedAt,
}: PendingAuthenticatedMcpRetryOptions): PendingAuthenticatedMcpRetry | undefined => {
  const recorder = resumeOAuthFlightRecorder(targetUrl, storage);
  if (!recorder?.hasPendingAuthenticatedMcpRetry()) return undefined;
  if (recorder.snapshot().targetFingerprint !== fingerprintTarget(targetUrl)) {
    return undefined;
  }
  return new PendingAuthenticatedMcpRetry(
    recorder,
    targetUrl,
    storage,
    operation,
    protocolEraHint,
    startedAt
  );
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

  // Reaching the next OAuth request proves the preceding provisional HTTP
  // response was parsed and accepted by the SDK.
  recorder.settleLatestProvisionalOAuthResponse('succeeded');

  const startedAtMs = Date.now();
  const startedAt = new Date(startedAtMs).toISOString();
  try {
    const response = await fetchFn(input, init);
    const durationMs = Math.max(0, Date.now() - startedAtMs);
    recorder.record({
      type,
      outcome: response.ok ? 'started' : 'failed',
      provenance: type === 'protected_resource_metadata'
        ? 'direct_target'
        : 'authorization_server',
      route: 'direct',
      explanation: response.ok
        ? `${oauthRequestLabel(type)} received HTTP ${response.status}; awaiting SDK parsing and validation.`
        : explanationForRequest(type, false, response.status),
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
