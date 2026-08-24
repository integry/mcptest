import {
  extractWWWAuthenticateParams,
  type Client,
  type FetchLike,
  type ProtocolEra,
} from '@modelcontextprotocol/client';
import { TransportType } from '../types';
import { CorsAwareStreamableHTTPTransport } from './corsAwareTransport';
import { CorsAwareSSETransport } from './corsAwareSseTransport';
import {
  createLegacyMcpClient,
  createNegotiatingMcpClient,
  getProtocolDetails,
} from './mcpClient';
import { redactReportString } from './reportArtifact';

export interface TransportCandidate {
  url: string;
  transportType: TransportType;
}

export interface TransportCandidateFailure {
  candidateUrl: string;
  transportType?: TransportType;
  error: unknown;
  observedRequests?: readonly ObservedTransportRequest[];
}

export class TransportConnectionError extends Error {
  constructor(
    readonly errors: readonly unknown[],
    readonly candidateFailures: readonly TransportCandidateFailure[] = []
  ) {
    super(`All connections failed: ${errors.map((error) => (
      (error instanceof Error ? error.message : String(error))
        .replace(/^All connections failed: /, '')
    )).join(', ')}`);
    this.name = 'TransportConnectionError';
  }
}

export type ProxyAuthenticationSource = 'proxy' | 'target';

export interface SafeTargetErrorDetail {
  code?: number | string;
  message: string;
}

export interface ObservedAuthenticationChallenge {
  status: 401 | 403;
  source: ProxyAuthenticationSource;
  responseHeaders?: Record<string, string>;
  /** Exact, ephemeral RFC 9728 location used by discovery; never persisted in raw form. */
  resourceMetadataUrl?: string;
  scope?: string;
  method?: string;
  requestUrl?: string;
  startedAt?: string;
  durationMs?: number;
  targetError?: SafeTargetErrorDetail;
}

export interface ObservedTransportRequest {
  method: string;
  /** JSON-RPC method when it can be read safely from the outgoing body. */
  mcpMethod?: string;
  url: string;
  candidateUrl?: string;
  transportType?: TransportType;
  startedAt?: string;
  durationMs?: number;
  status?: number;
  /** Who produced a proxied HTTP response, when the proxy exposes provenance. */
  responseSource?: ProxyAuthenticationSource;
  /** Bounded and credential-redacted target response detail. */
  targetError?: SafeTargetErrorDetail;
  /** Header names only. Values are deliberately never retained. */
  requestHeaders?: readonly string[];
  outcome?: 'started' | 'succeeded' | 'failed';
}

export class ProxiedAuthenticationError extends Error {
  readonly cause: unknown;
  readonly resourceMetadataUrl?: string;
  readonly scope?: string;

  constructor(
    readonly status: 401 | 403,
    readonly responseSource: ProxyAuthenticationSource,
    cause: unknown,
    request?: ObservedTransportRequest,
    readonly responseHeaders?: Record<string, string>,
    resourceMetadataUrl?: string,
    scope?: string,
    readonly targetError?: SafeTargetErrorDetail
  ) {
    super(
      responseSource === 'target'
        ? `MCP target returned HTTP ${status}`
        : `Authenticated proxy returned HTTP ${status}`
    );
    this.name = 'ProxiedAuthenticationError';
    this.cause = cause;
    this.method = request?.method;
    this.requestUrl = request?.url;
    this.startedAt = request?.startedAt;
    this.durationMs = request?.durationMs;
    if (resourceMetadataUrl) {
      Object.defineProperty(this, 'resourceMetadataUrl', { value: resourceMetadataUrl });
    }
    if (scope) Object.defineProperty(this, 'scope', { value: scope });
  }

  readonly method?: string;
  readonly requestUrl?: string;
  readonly startedAt?: string;
  readonly durationMs?: number;
}

const attachEphemeralChallengeParameters = <T extends ObservedAuthenticationChallenge>(
  challenge: T,
  parameters: Pick<ObservedAuthenticationChallenge, 'resourceMetadataUrl' | 'scope'>
): T => {
  if (parameters.resourceMetadataUrl) {
    Object.defineProperty(challenge, 'resourceMetadataUrl', {
      value: parameters.resourceMetadataUrl,
      enumerable: false,
    });
  }
  if (parameters.scope) {
    Object.defineProperty(challenge, 'scope', { value: parameters.scope, enumerable: false });
  }
  return challenge;
};

export const getObservedAuthenticationChallenge = (
  error: unknown,
  seen = new Set<object>()
): ObservedAuthenticationChallenge | undefined => {
  if (!error || typeof error !== 'object' || seen.has(error)) return undefined;
  seen.add(error);

  if (error instanceof ProxiedAuthenticationError) {
    return attachEphemeralChallengeParameters({
      status: error.status,
      source: error.responseSource,
      ...(error.responseHeaders ? { responseHeaders: error.responseHeaders } : {}),
      ...(error.method ? { method: error.method } : {}),
      ...(error.requestUrl ? { requestUrl: error.requestUrl } : {}),
      ...(error.startedAt ? { startedAt: error.startedAt } : {}),
      ...(error.durationMs !== undefined ? { durationMs: error.durationMs } : {}),
      ...(error.targetError ? { targetError: error.targetError } : {}),
    }, error);
  }

  const nestedErrors = error instanceof TransportConnectionError
    ? error.errors
    : (error as { errors?: readonly unknown[] }).errors;
  let proxyChallenge: ObservedAuthenticationChallenge | undefined;

  if (Array.isArray(nestedErrors)) {
    for (const nestedError of nestedErrors) {
      const challenge = getObservedAuthenticationChallenge(nestedError, seen);
      if (challenge?.source === 'target') return challenge;
      if (challenge?.source === 'proxy') proxyChallenge = challenge;
    }
  }

  const causeChallenge = getObservedAuthenticationChallenge(
    (error as { cause?: unknown }).cause,
    seen
  );
  if (causeChallenge?.source === 'target') return causeChallenge;
  return causeChallenge || proxyChallenge;
};

const browserUnreadableMessage = (error: unknown): boolean => {
  const message = error instanceof Error ? error.message : String(error);
  return error instanceof TypeError
    || /failed to fetch|load failed|networkerror when attempting to fetch|network request failed|\bcors\b/i.test(message);
};

const connectionWasAborted = (error: unknown, seen = new Set<object>()): boolean => {
  if (!error || typeof error !== 'object' || seen.has(error)) return false;
  seen.add(error);
  if ((error instanceof Error ? error.message : String(error)) === 'Connection aborted by user') {
    return true;
  }
  const value = error as { errors?: readonly unknown[]; cause?: unknown };
  return Boolean(
    value.errors?.some((nested) => connectionWasAborted(nested, seen))
    || connectionWasAborted(value.cause, seen)
  );
};

const hasTerminalBrowserUnreadableRequest = (
  error: unknown,
  seen = new Set<object>()
): boolean => {
  if (!error || typeof error !== 'object' || seen.has(error)) return false;
  seen.add(error);
  const value = error as {
    candidateFailures?: readonly TransportCandidateFailure[];
    errors?: readonly unknown[];
    cause?: unknown;
  };
  const representedErrors = new Set<unknown>();

  for (const failure of value.candidateFailures || []) {
    representedErrors.add(failure.error);
    const terminalRequest = failure.observedRequests?.[failure.observedRequests.length - 1];
    if (terminalRequest) {
      if (
        terminalRequest.outcome === 'failed'
        && terminalRequest.status === undefined
        && browserUnreadableMessage(failure.error)
      ) return true;
      // Request evidence is authoritative for this candidate. In particular,
      // do not reinterpret an earlier readable response as the terminal cause.
      continue;
    }
    if (hasTerminalBrowserUnreadableRequest(failure.error, seen)) return true;
  }

  for (const nested of value.errors || []) {
    if (!representedErrors.has(nested) && hasTerminalBrowserUnreadableRequest(nested, seen)) {
      return true;
    }
  }
  if (hasTerminalBrowserUnreadableRequest(value.cause, seen)) return true;
  return !value.candidateFailures?.length && !value.errors?.length && browserUnreadableMessage(error);
};

/**
 * True only when an MCP negotiation ended on a browser-unreadable required
 * request. Readable target errors and target OAuth challenges stay on their
 * original route and user cancellation never causes an authenticated retry.
 */
export const shouldRetryMcpConnectionThroughProxy = (error: unknown): boolean => (
  !connectionWasAborted(error)
  && getObservedAuthenticationChallenge(error)?.source !== 'target'
  && hasTerminalBrowserUnreadableRequest(error)
);

const PROXY_RESPONSE_SOURCE_HEADER = 'X-MCP-Proxy-Response-Source';
const MAX_TARGET_ERROR_BODY_BYTES = 8 * 1024;
const MAX_TARGET_ERROR_MESSAGE_LENGTH = 320;
const MAX_TARGET_ERROR_CODE_LENGTH = 64;
const TARGET_ERROR_READ_TIMEOUT_MS = 250;

const isRecord = (value: unknown): value is Record<string, unknown> => (
  Boolean(value) && typeof value === 'object' && !Array.isArray(value)
);

const boundDiagnosticValue = (
  value: string,
  limit: number,
  knownCredentials: readonly string[] = []
): string => {
  const normalized = value.replace(/[\u0000-\u001f\u007f]+/g, ' ').replace(/\s+/g, ' ').trim();
  if (!normalized) return '';

  // Use the same credential-redaction boundary as reports, downloads, and
  // stored artifacts. Supplement it with conservative opaque/provider token
  // shapes because target prose may omit a credential field name.
  const withoutKnownCredentials = knownCredentials.reduce((redacted, credential) => (
    credential ? redacted.split(credential).join('[REDACTED]') : redacted
  ), normalized);
  const redacted = redactReportString(withoutKnownCredentials)
    .replace(/\b(?:sk|pk)_(?:live|test)_[A-Za-z0-9_-]{8,}\b/gi, '[REDACTED]')
    .replace(/\bgh[pousr]_[A-Za-z0-9_-]{8,}\b/gi, '[REDACTED]')
    .replace(/\bxox[baprs]-[A-Za-z0-9-]{8,}\b/gi, '[REDACTED]')
    .replace(/\bAKIA[A-Z0-9]{12,}\b/g, '[REDACTED]')
    .replace(/\b[A-Za-z0-9_-]{48,}\b/g, '[REDACTED]');
  return redacted.length > limit
    ? `${redacted.slice(0, Math.max(0, limit - 1)).trimEnd()}…`
    : redacted;
};

const readBoundedResponseText = async (response: Response): Promise<string | undefined> => {
  const declaredLength = response.headers.get('content-length');
  if (declaredLength && /^\d+$/.test(declaredLength)) {
    if (Number(declaredLength) > MAX_TARGET_ERROR_BODY_BYTES) return undefined;
  }

  let body: ReadableStream<Uint8Array> | null;
  try {
    body = response.clone().body;
  } catch {
    return undefined;
  }
  if (!body) return undefined;
  const reader = body.getReader();
  let timedOut = false;
  const timeout = setTimeout(() => {
    timedOut = true;
    void reader.cancel().catch(() => {});
  }, TARGET_ERROR_READ_TIMEOUT_MS);

  try {
    const chunks: Uint8Array[] = [];
    let size = 0;
    while (true) {
      const { done, value } = await reader.read();
      if (timedOut) return undefined;
      if (done) break;
      size += value.byteLength;
      if (size > MAX_TARGET_ERROR_BODY_BYTES) {
        void reader.cancel().catch(() => {});
        return undefined;
      }
      chunks.push(value);
    }
    const bytes = new Uint8Array(size);
    let offset = 0;
    for (const chunk of chunks) {
      bytes.set(chunk, offset);
      offset += chunk.byteLength;
    }
    return new TextDecoder('utf-8', { fatal: true }).decode(bytes);
  } catch {
    return undefined;
  } finally {
    clearTimeout(timeout);
    reader.releaseLock();
  }
};

const targetErrorFromJson = (
  value: unknown,
  knownCredentials: readonly string[]
): SafeTargetErrorDetail | undefined => {
  if (!isRecord(value)) return undefined;
  if (isRecord(value.error) && typeof value.error.message === 'string') {
    const rawCode = value.error.code;
    const code = typeof rawCode === 'number' && Number.isFinite(rawCode)
      ? rawCode
      : typeof rawCode === 'string'
        ? boundDiagnosticValue(rawCode, MAX_TARGET_ERROR_CODE_LENGTH, knownCredentials)
        : undefined;
    const message = boundDiagnosticValue(
      value.error.message,
      MAX_TARGET_ERROR_MESSAGE_LENGTH,
      knownCredentials
    );
    return message ? { ...(code !== undefined && code !== '' ? { code } : {}), message } : undefined;
  }

  if (typeof value.error === 'string') {
    const code = boundDiagnosticValue(value.error, MAX_TARGET_ERROR_CODE_LENGTH, knownCredentials);
    const description = typeof value.error_description === 'string'
      ? boundDiagnosticValue(
          value.error_description,
          MAX_TARGET_ERROR_MESSAGE_LENGTH,
          knownCredentials
        )
      : '';
    return description
      ? { ...(code ? { code } : {}), message: description }
      : code ? { message: code } : undefined;
  }

  if (typeof value.message === 'string') {
    const message = boundDiagnosticValue(value.message, MAX_TARGET_ERROR_MESSAGE_LENGTH, knownCredentials);
    return message ? { message } : undefined;
  }
  return undefined;
};

/**
 * Reads only small JSON or plain-text error responses from a clone. The
 * original response remains untouched for MCP parsing and OAuth discovery.
 */
export const inspectSafeTargetError = async (
  response: Response,
  knownCredentials: readonly string[] = []
): Promise<SafeTargetErrorDetail | undefined> => {
  if (response.status < 400) return undefined;
  const contentType = response.headers.get('content-type')
    ?.split(';', 1)[0]
    .trim()
    .toLowerCase();
  const isJson = contentType === 'application/json' || Boolean(contentType?.endsWith('+json'));
  const isPlainText = contentType === 'text/plain';
  if (!isJson && !isPlainText) return undefined;

  const text = await readBoundedResponseText(response);
  if (text === undefined) return undefined;
  if (isJson) {
    try {
      return targetErrorFromJson(JSON.parse(text), knownCredentials);
    } catch {
      return undefined;
    }
  }

  const trimmed = text.trim();
  if (!trimmed || /^\s*(?:<!doctype\s+html|<html|<head|<body|<script|<)/i.test(trimmed)) {
    return undefined;
  }
  const message = boundDiagnosticValue(trimmed, MAX_TARGET_ERROR_MESSAGE_LENGTH, knownCredentials);
  return message ? { message } : undefined;
};

const OAUTH_SENSITIVE_CANONICAL_KEYS = new Set([
  'authorization',
  'proxyauthorization',
  'xmcpauthorization',
  'dpop',
  'cookie',
  'setcookie',
  'xapikey',
  'apikey',
  'key',
  'code',
  'authorizationcode',
  'devicecode',
  'usercode',
  'accesstoken',
  'refreshtoken',
  'idtoken',
  'idtokenhint',
  'registrationaccesstoken',
  'token',
  'clientsecret',
  'codeverifier',
  'verifier',
  'state',
  'nonce',
  'csrf',
  'session',
  'sessionid',
  'credential',
  'assertion',
  'clientassertion',
  'requesturi',
  'password',
  'secret',
]);

export const isOAuthSensitiveKey = (key: string): boolean => (
  OAUTH_SENSITIVE_CANONICAL_KEYS.has(key.replace(/[^a-z0-9]/gi, '').toLowerCase())
);

type OAuthQueryValuePolicy = 'nested_url' | 'safe_context' | 'redact';

const OAUTH_SAFE_CONTEXT_QUERY_KEYS = new Set([
  'operation',
  'tenant',
]);

const OAUTH_NESTED_URL_QUERY_KEYS = new Set([
  'redirecturi',
  'resource',
  'target',
]);

const OAUTH_QUERY_ENCODING_LAYER_LIMIT = 8;
const OAUTH_RELATIVE_URL_BASE = 'https://oauth-trace.invalid';
const OAUTH_SENSITIVE_NESTED_ASSIGNMENT_PATTERN = new RegExp(
  `(?:^|[^a-z0-9_.-])(?:${[...OAUTH_SENSITIVE_CANONICAL_KEYS]
    .map((key) => [...key].join('[^a-z0-9]*'))
    .join('|')})\\s*=`,
  'i'
);

const canonicalizeOAuthKey = (key: string): string => (
  key.replace(/[^a-z0-9]/gi, '').toLowerCase()
);

const decodeAsciiQueryEncodingOnce = (value: string): string => (
  value.replace(/%([0-7][0-9a-f])/gi, (_match, hex: string) => (
    String.fromCharCode(Number.parseInt(hex, 16))
  ))
);

const containsSensitiveNestedAssignment = (value: string): boolean => {
  return OAUTH_SENSITIVE_NESTED_ASSIGNMENT_PATTERN.test(value);
};

/**
 * Allowlisted context is still untrusted. Inspect each supported percent-
 * encoding layer before retaining it; inputs nested beyond the limit are
 * redacted instead of being copied without inspection.
 */
const sanitizeOAuthContextValue = (value: string, redacted: string): string => {
  let decoded = value;
  for (let depth = 0; depth <= OAUTH_QUERY_ENCODING_LAYER_LIMIT; depth += 1) {
    if (containsSensitiveNestedAssignment(decoded)) return redacted;
    const next = decodeAsciiQueryEncodingOnce(decoded);
    if (next === decoded) return value;
    decoded = next;
  }
  return redacted;
};

/**
 * Trace URLs use an allowlist: only routing context and recursively sanitized
 * nested URLs retain values. Every extension parameter is redacted by default.
 */
const getOAuthQueryValuePolicy = (key: string): OAuthQueryValuePolicy => {
  const canonicalKey = canonicalizeOAuthKey(key);
  if (OAUTH_NESTED_URL_QUERY_KEYS.has(canonicalKey)) return 'nested_url';
  if (OAUTH_SAFE_CONTEXT_QUERY_KEYS.has(canonicalKey)) return 'safe_context';
  return 'redact';
};

const sanitizeOAuthUrlQueryValuesAtDepth = (
  value: string | URL,
  redacted: string,
  depth: number,
  allowRelative: boolean
): string => {
  const rawValue = String(value);
  let url: URL;
  let relativePath: string | undefined;

  try {
    url = new URL(rawValue);
  } catch {
    if (!allowRelative || rawValue.startsWith('//')) return redacted;
    try {
      url = new URL(rawValue, OAUTH_RELATIVE_URL_BASE);
      if (url.origin !== OAUTH_RELATIVE_URL_BASE) return redacted;
      relativePath = rawValue.split(/[?#]/, 1)[0];
      if (!relativePath && !rawValue.startsWith('?')) return redacted;
      if (sanitizeOAuthContextValue(relativePath, redacted) === redacted) return redacted;
    } catch {
      return redacted;
    }
  }

  if (url.username) url.username = redacted;
  if (url.password) url.password = redacted;
  url.hash = '';

  for (const [key, queryValue] of [...url.searchParams.entries()]) {
    const policy = getOAuthQueryValuePolicy(key);
    if (policy === 'safe_context') {
      url.searchParams.set(key, sanitizeOAuthContextValue(queryValue, redacted));
    } else if (policy === 'nested_url') {
      const canonicalKey = canonicalizeOAuthKey(key);
      url.searchParams.set(
        key,
        depth >= OAUTH_QUERY_ENCODING_LAYER_LIMIT
          ? redacted
          : sanitizeOAuthUrlQueryValuesAtDepth(
            queryValue,
            redacted,
            depth + 1,
            canonicalKey === 'redirecturi'
          )
      );
    } else {
      url.searchParams.set(key, redacted);
    }
  }

  if (relativePath !== undefined) return `${relativePath}${url.search}`;
  return url.toString();
};

export const sanitizeOAuthUrlQueryValues = (
  value: string | URL,
  redacted = '[REDACTED]'
): string => sanitizeOAuthUrlQueryValuesAtDepth(value, redacted, 0, false);

const sanitizeChallengeMetadataUrl = (value: string): string => (
  sanitizeOAuthUrlQueryValues(value)
);

export const sanitizeAuthenticationChallenge = (value: string): string => {
  const withoutControls = value.replace(/[\r\n\0]/g, ' ');
  const scheme = withoutControls.match(/^\s*([a-z][a-z0-9_-]*)/i)?.[1];
  if (!scheme) return '[REDACTED]';

  const parameters: string[] = [];
  const parameterPattern = /([a-z][a-z0-9_-]*)\s*=\s*("(?:[^"\\]|\\.)*"|[^,\s]+)/gi;
  for (const match of withoutControls.matchAll(parameterPattern)) {
    const [, rawKey, rawValue] = match;
    const key = rawKey.toLowerCase();
    const unquoted = rawValue.startsWith('"')
      ? rawValue.slice(1, -1).replace(/\\"/g, '"')
      : rawValue;
    if (['resource_metadata', 'authorization_uri', 'issuer'].includes(key)) {
      parameters.push(`${rawKey}="${sanitizeChallengeMetadataUrl(unquoted)}"`);
    } else if (key === 'error' && [
      'invalid_request',
      'invalid_token',
      'insufficient_scope',
      'use_dpop_nonce',
    ].includes(unquoted)) {
      parameters.push(`${rawKey}="${unquoted}"`);
    } else {
      // Preserve the shape and parameter name, but not arbitrary values such
      // as realms, scopes, token68 credentials, or extension parameters.
      parameters.push(`${rawKey}="[REDACTED]"`);
    }
  }

  return parameters.length > 0
    ? `${scheme} ${parameters.join(', ')}`
    : `${scheme} [REDACTED]`;
};

const authenticationChallengeHeaders = (response: Response): Record<string, string> | undefined => {
  const authenticate = response.headers.get('www-authenticate');
  return authenticate
    ? { 'www-authenticate': sanitizeAuthenticationChallenge(authenticate) }
    : undefined;
};

const authenticationChallengeParameters = (response: Response): {
  resourceMetadataUrl?: string;
  scope?: string;
} => {
  try {
    const parameters = extractWWWAuthenticateParams(response);
    return {
      ...(parameters.resourceMetadataUrl
        ? { resourceMetadataUrl: parameters.resourceMetadataUrl.toString() }
        : {}),
      ...(parameters.scope ? { scope: parameters.scope } : {}),
    };
  } catch {
    // An invalid challenge is still recorded, but cannot steer discovery.
    return {};
  }
};

const jsonRpcMethodFromBody = (body: BodyInit | null | undefined): string | undefined => {
  if (typeof body !== 'string') return undefined;
  try {
    const payload = JSON.parse(body) as { method?: unknown } | Array<{ method?: unknown }>;
    const message = Array.isArray(payload) ? payload[0] : payload;
    return typeof message?.method === 'string' ? message.method : undefined;
  } catch {
    return undefined;
  }
};

const observeAuthenticationResponses = (
  usesProxy: boolean,
  onChallenge: (challenge: ObservedAuthenticationChallenge) => void,
  observedRequests: ObservedTransportRequest[],
  candidate: TransportCandidate,
  onRequest?: (request: ObservedTransportRequest) => void,
  knownCredentials: readonly string[] = []
): FetchLike => async (input, init) => {
  const request = typeof Request !== 'undefined' && input instanceof Request ? input : undefined;
  const startedAtMs = Date.now();
  const outgoingHeaders = new Headers(init?.headers || request?.headers);
  let mcpMethod = jsonRpcMethodFromBody(init?.body);
  if (!mcpMethod && request && request.method.toUpperCase() === 'POST') {
    try {
      mcpMethod = jsonRpcMethodFromBody(await request.clone().text());
    } catch {
      // Request stage is best-effort evidence; never interfere with transport.
    }
  }
  const attemptedRequest: ObservedTransportRequest = {
    method: (init?.method || request?.method || 'GET').toUpperCase(),
    ...(mcpMethod ? { mcpMethod } : {}),
    url: request?.url || String(input),
    candidateUrl: candidate.url,
    transportType: candidate.transportType,
    startedAt: new Date(startedAtMs).toISOString(),
    ...(Array.from(outgoingHeaders.keys()).length > 0
      ? { requestHeaders: Array.from(outgoingHeaders.keys()) }
      : {}),
    outcome: 'started',
  };
  observedRequests.push(attemptedRequest);
  onRequest?.(attemptedRequest);
  let response: Response;
  try {
    response = await fetch(input, init);
    attemptedRequest.status = response.status;
    if (!usesProxy) {
      attemptedRequest.responseSource = 'target';
    } else {
      const source = response.headers.get(PROXY_RESPONSE_SOURCE_HEADER)?.toLowerCase();
      if (source === 'target' || source === 'proxy') attemptedRequest.responseSource = source;
    }
    attemptedRequest.durationMs = Math.max(0, Date.now() - startedAtMs);
    attemptedRequest.outcome = response.ok ? 'succeeded' : 'failed';
    if (attemptedRequest.responseSource === 'target' && !response.ok) {
      // Diagnostics are best-effort and must never replace the target's actual
      // response with an inspection failure.
      const targetError = await inspectSafeTargetError(response, knownCredentials)
        .catch(() => undefined);
      if (targetError) attemptedRequest.targetError = targetError;
    }
  } catch (error) {
    attemptedRequest.durationMs = Math.max(0, Date.now() - startedAtMs);
    attemptedRequest.outcome = 'failed';
    throw error;
  }
  if (response.status === 401 || response.status === 403) {
    const responseSource = !usesProxy
      ? 'target'
      : response.headers.get(PROXY_RESPONSE_SOURCE_HEADER) === 'target'
        ? 'target'
        : 'proxy';
    const responseHeaders = authenticationChallengeHeaders(response);
    const challengeParameters = authenticationChallengeParameters(response);
    onChallenge(attachEphemeralChallengeParameters({
      status: response.status,
      source: responseSource,
      ...(responseHeaders ? { responseHeaders } : {}),
      method: attemptedRequest.method,
      requestUrl: attemptedRequest.url,
      startedAt: attemptedRequest.startedAt,
      durationMs: attemptedRequest.durationMs,
      ...(attemptedRequest.targetError ? { targetError: attemptedRequest.targetError } : {}),
    }, challengeParameters));
  }
  return response;
};

export const CANDIDATE_GROUP_TIMEOUT_MS = 5_000;

const slashVariants = (value: URL): URL[] => {
  const withoutSlash = new URL(value);
  withoutSlash.pathname = withoutSlash.pathname.replace(/\/+$/, '') || '/';
  const withSlash = new URL(withoutSlash);
  withSlash.pathname = `${withoutSlash.pathname.replace(/\/+$/, '')}/`;

  return Array.from(
    new Map([withoutSlash, withSlash].map((url) => [url.toString(), url])).values()
  );
};

const siblingEndpoint = (value: URL, fromSegment: string, toSegment: string): URL | null => {
  const pathWithoutSlash = value.pathname.replace(/\/+$/, '');
  if (!pathWithoutSlash.endsWith(`/${fromSegment}`)) return null;

  const sibling = new URL(value);
  sibling.pathname = `${pathWithoutSlash.slice(0, -(fromSegment.length + 1))}/${toSegment}`;
  return sibling;
};

const directCandidates = (
  endpoint: URL,
  preferredTransport?: TransportType
): TransportCandidate[] => {
  const candidates: TransportCandidate[] = [];
  const seen = new Set<string>();
  const add = (url: URL, transportType: TransportType) => {
    for (const variant of slashVariants(url)) {
      const candidate = { url: variant.toString(), transportType };
      const key = `${candidate.transportType}:${candidate.url}`;
      if (seen.has(key)) continue;
      seen.add(key);
      candidates.push(candidate);
    }
  };
  const addExact = (url: URL, transportType: TransportType) => {
    const candidate = { url: url.toString(), transportType };
    const key = `${candidate.transportType}:${candidate.url}`;
    if (seen.has(key)) return;
    seen.add(key);
    candidates.push(candidate);
  };
  const normalizedPath = endpoint.pathname.replace(/\/+$/, '');

  // A catalog-selected endpoint is authoritative transport evidence. Keep its
  // exact path and do not invent a sibling transport endpoint.
  if (preferredTransport) {
    addExact(endpoint, preferredTransport);
    return candidates;
  }

  if (normalizedPath.endsWith('/sse')) {
    const httpSibling = siblingEndpoint(endpoint, 'sse', 'mcp');
    add(endpoint, 'legacy-sse');
    if (httpSibling) add(httpSibling, 'streamable-http');
  } else if (normalizedPath.endsWith('/mcp')) {
    add(endpoint, 'streamable-http');
    const sseSibling = siblingEndpoint(endpoint, 'mcp', 'sse');
    if (sseSibling) add(sseSibling, 'legacy-sse');
  } else if (!normalizedPath) {
    // Some publishers serve MCP directly at the origin, while others use the
    // conventional /mcp or /sse paths. Preserve both possibilities.
    add(endpoint, 'streamable-http');
    const httpEndpoint = new URL(endpoint);
    httpEndpoint.pathname = '/mcp';
    add(httpEndpoint, 'streamable-http');
    add(endpoint, 'legacy-sse');
    const sseEndpoint = new URL(endpoint);
    sseEndpoint.pathname = '/sse';
    add(sseEndpoint, 'legacy-sse');
  } else {
    // A non-standard path is an endpoint, not a base URL. Never append a
    // transport path to it; try both transports at the exact location.
    add(endpoint, 'streamable-http');
    add(endpoint, 'legacy-sse');
  }

  return candidates;
};

/**
 * Builds connection candidates while preserving exact custom endpoints. A URL
 * is interpreted using the proxy `target` convention only when its caller has
 * explicitly selected the configured proxy route.
 */
export const getTransportCandidates = (
  serverUrl: string,
  usesProxy = false,
  preferredTransport?: TransportType
): TransportCandidate[] => {
  const outerUrl = new URL(serverUrl);
  if (!usesProxy) return directCandidates(outerUrl, preferredTransport);

  const targetValue = outerUrl.searchParams.get('target');
  if (!targetValue) {
    throw new Error('Proxy connection URL is missing its target endpoint.');
  }

  const targetUrl = new URL(targetValue);
  return directCandidates(targetUrl, preferredTransport).map((candidate) => {
    const proxyUrl = new URL(outerUrl);
    proxyUrl.searchParams.set('target', candidate.url);
    return { ...candidate, url: proxyUrl.toString() };
  });
};

export const getRequestHeadersForCandidate = (
  _candidateUrl: string,
  requestHeaders?: HeadersInit,
  usesProxy = false
): Headers => {
  const headers = new Headers(requestHeaders);

  if (usesProxy && headers.has('Authorization')) {
    headers.set('X-MCP-Authorization', headers.get('Authorization') || '');
    headers.delete('Authorization');
  }

  return headers;
};

type ConnectedCandidate = {
  transport: CorsAwareStreamableHTTPTransport | CorsAwareSSETransport;
  transportType: TransportType;
  client: Client;
  url: string;
  observedRequests: readonly ObservedTransportRequest[];
  takeAuthenticationChallenge: () => ObservedAuthenticationChallenge | undefined;
};

const firstSuccessful = <T,>(
  attempts: Array<{
    promise: Promise<T>;
    candidateUrl: string;
    transportType: TransportType;
    observedRequests: readonly ObservedTransportRequest[];
  }>,
  candidateFailures: TransportCandidateFailure[]
): Promise<T> => {
  return new Promise((resolve, reject) => {
    const errors: unknown[] = [];
    let remaining = attempts.length;

    for (const { promise, candidateUrl, transportType, observedRequests } of attempts) {
      promise.then(resolve).catch((error) => {
        errors.push(error);
        candidateFailures.push({ candidateUrl, transportType, error, observedRequests });
        remaining -= 1;
        if (remaining === 0) {
          reject(new TransportConnectionError(errors, [...candidateFailures]));
        }
      });
    }
  });
};

const candidateGroupKey = (
  candidate: TransportCandidate,
  usesProxy: boolean
): string => {
  const outerUrl = new URL(candidate.url);
  const targetValue = usesProxy ? outerUrl.searchParams.get('target') : null;
  const endpoint = targetValue ? new URL(targetValue) : outerUrl;

  return `${candidate.transportType}:${endpoint.toString()}`;
};

const groupCandidatesByPriority = (
  candidates: TransportCandidate[],
  usesProxy: boolean
): TransportCandidate[][] => {
  const groups: TransportCandidate[][] = [];

  for (const candidate of candidates) {
    const currentGroup = groups[groups.length - 1];
    if (
      !currentGroup
      || candidateGroupKey(currentGroup[0], usesProxy) !== candidateGroupKey(candidate, usesProxy)
    ) {
      groups.push([candidate]);
    } else {
      currentGroup.push(candidate);
    }
  }

  return groups;
};

export async function attemptParallelConnections(
  serverUrl: string,
  abortSignal?: AbortSignal,
  authToken?: string,
  requestHeaders?: HeadersInit,
  usesProxy = false,
  protocolEraHint?: 'stateless' | 'stateful' | 'legacy',
  onRequest?: (request: ObservedTransportRequest) => void,
  preferredTransport?: TransportType
): Promise<ConnectedCandidate & { protocolEra: ProtocolEra; protocolVersion?: string }> {
  const candidates = getTransportCandidates(serverUrl, usesProxy, preferredTransport);
  const clients: Client[] = [];
  const transportOptionsFor = (
    candidate: TransportCandidate,
    observedRequests: ObservedTransportRequest[],
    onAuthenticationChallenge: (challenge: ObservedAuthenticationChallenge) => void
  ) => {
    const headers = getRequestHeadersForCandidate(candidate.url, requestHeaders, usesProxy);

    return {
      ...(authToken ? { authProvider: { token: async () => authToken } } : {}),
      ...(Array.from(headers.keys()).length > 0 ? { headers } : {}),
      fetch: observeAuthenticationResponses(
        usesProxy,
        onAuthenticationChallenge,
        observedRequests,
        candidate,
        onRequest,
        [
          ...(authToken ? [authToken] : []),
          ...Array.from(headers.values()).filter(Boolean),
        ]
      ),
    };
  };

  if (abortSignal?.aborted) {
    throw new Error('Connection aborted by user');
  }

  console.log('[Parallel Connection] Trying publisher endpoint candidates:', candidates);

  const attemptConnection = async (
    candidate: TransportCandidate,
    observedRequests: ObservedTransportRequest[]
  ): Promise<ConnectedCandidate> => {
    const client = candidate.transportType === 'legacy-sse'
      ? createLegacyMcpClient('mcptest-web')
      : createNegotiatingMcpClient('mcptest-web');
    clients.push(client);
    const endpoint = new URL(candidate.url);
    let authenticationChallenge: ObservedAuthenticationChallenge | undefined;
    let rejectAuthenticationChallenge: (error: ProxiedAuthenticationError) => void = () => {};
    const authenticationChallengeFailure = new Promise<never>((_resolve, reject) => {
      rejectAuthenticationChallenge = reject;
    });
    const transportOpts = transportOptionsFor(candidate, observedRequests, (challenge) => {
      authenticationChallenge = challenge;
      rejectAuthenticationChallenge(new ProxiedAuthenticationError(
        challenge.status,
        challenge.source,
        new Error(`MCP transport received HTTP ${challenge.status}`),
        challenge.method && challenge.requestUrl
          ? {
              method: challenge.method,
              url: challenge.requestUrl,
              startedAt: challenge.startedAt,
              durationMs: challenge.durationMs,
            }
          : undefined,
        challenge.responseHeaders,
        challenge.resourceMetadataUrl,
        challenge.scope,
        challenge.targetError
      ));
    });
    const transport = candidate.transportType === 'legacy-sse'
      ? new CorsAwareSSETransport(endpoint, transportOpts)
      : new CorsAwareStreamableHTTPTransport(endpoint, transportOpts);

    try {
      await Promise.race([
        client.connect(
          transport,
          protocolEraHint === 'stateful' || protocolEraHint === 'legacy'
            ? { prior: { kind: 'legacy' } }
            : undefined
        ),
        authenticationChallengeFailure,
      ]);
    } catch (error) {
      if (error instanceof ProxiedAuthenticationError) throw error;
      if (authenticationChallenge) {
        throw new ProxiedAuthenticationError(
          authenticationChallenge.status,
          authenticationChallenge.source,
          error,
          authenticationChallenge.method && authenticationChallenge.requestUrl
            ? {
                method: authenticationChallenge.method,
                url: authenticationChallenge.requestUrl,
                startedAt: authenticationChallenge.startedAt,
                durationMs: authenticationChallenge.durationMs,
              }
            : undefined,
          authenticationChallenge.responseHeaders,
          authenticationChallenge.resourceMetadataUrl,
          authenticationChallenge.scope,
          authenticationChallenge.targetError
        );
      }
      throw error;
    }
    authenticationChallenge = undefined;
    return {
      ...candidate,
      client,
      transport,
      observedRequests,
      takeAuthenticationChallenge: () => {
        const challenge = authenticationChallenge;
        authenticationChallenge = undefined;
        return challenge;
      },
    };
  };

  let removeAbortListener = () => {};
  const abortPromise = new Promise<never>((_, reject) => {
    if (!abortSignal) return;
    const abort = () => reject(new Error('Connection aborted by user'));
    abortSignal.addEventListener('abort', abort, { once: true });
    removeAbortListener = () => abortSignal.removeEventListener('abort', abort);
  });

  try {
    const failures: Error[] = [];

    for (const candidateGroup of groupCandidatesByPriority(candidates, usesProxy)) {
      if (abortSignal?.aborted) {
        throw new Error('Connection aborted by user');
      }

      let successful: ConnectedCandidate;
      const firstGroupClientIndex = clients.length;
      const candidateFailures: TransportCandidateFailure[] = [];
      let groupTimeoutId: ReturnType<typeof setTimeout> | undefined;
      const groupTimeout = new Promise<never>((_, reject) => {
        groupTimeoutId = setTimeout(() => {
          const timeoutError = new Error(
            `Connection candidates timed out after ${CANDIDATE_GROUP_TIMEOUT_MS / 1000} seconds`
          );
          reject(new TransportConnectionError(
            [...candidateFailures.map(({ error }) => error), timeoutError],
            [...candidateFailures]
          ));
        }, CANDIDATE_GROUP_TIMEOUT_MS);
      });
      try {
        successful = await Promise.race([
          firstSuccessful(
            candidateGroup.map((candidate) => {
              const observedRequests: ObservedTransportRequest[] = [];
              const promise = attemptConnection(candidate, observedRequests);
              return {
                promise,
                candidateUrl: candidate.url,
                transportType: candidate.transportType,
                observedRequests,
              };
            }),
            candidateFailures
          ),
          abortPromise,
          groupTimeout,
        ]);
      } catch (error) {
        if (abortSignal?.aborted) {
          throw new Error('Connection aborted by user');
        }
        failures.push(error instanceof Error ? error : new Error(String(error)));
        await Promise.allSettled(
          clients.slice(firstGroupClientIndex).map((client) => client.close())
        );
        continue;
      } finally {
        if (groupTimeoutId) clearTimeout(groupTimeoutId);
      }

      await Promise.allSettled(
        clients.filter((client) => client !== successful.client).map((client) => client.close())
      );
      const protocol = getProtocolDetails(successful.client);

      console.log(
        `[Parallel Connection] ${successful.transportType} connected to ${successful.url}`
      );
      return {
        ...successful,
        protocolEra: protocol.era,
        protocolVersion: protocol.version,
      };
    }

    throw new TransportConnectionError(failures);
  } catch (error) {
    await Promise.allSettled(clients.map((client) => client.close()));
    throw error;
  } finally {
    removeAbortListener();
  }
}

// Kept for callers that still use transport detection only for presentation.
export async function detectTransport(serverUrl: string): Promise<TransportType> {
  return getTransportCandidates(serverUrl)[0]?.transportType || 'legacy-sse';
}
