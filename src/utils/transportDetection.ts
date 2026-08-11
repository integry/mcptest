import type { Client, FetchLike, ProtocolEra } from '@modelcontextprotocol/client';
import { TransportType } from '../types';
import { CorsAwareStreamableHTTPTransport } from './corsAwareTransport';
import { CorsAwareSSETransport } from './corsAwareSseTransport';
import {
  createLegacyMcpClient,
  createNegotiatingMcpClient,
  getProtocolDetails,
} from './mcpClient';

export interface TransportCandidate {
  url: string;
  transportType: TransportType;
}

export interface TransportCandidateFailure {
  candidateUrl: string;
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

export interface ObservedAuthenticationChallenge {
  status: 401 | 403;
  source: ProxyAuthenticationSource;
  responseHeaders?: Record<string, string>;
  method?: string;
  requestUrl?: string;
  startedAt?: string;
  durationMs?: number;
}

export interface ObservedTransportRequest {
  method: string;
  url: string;
  candidateUrl?: string;
  transportType?: TransportType;
  startedAt?: string;
  durationMs?: number;
  status?: number;
  outcome?: 'started' | 'succeeded' | 'failed';
}

export class ProxiedAuthenticationError extends Error {
  readonly cause: unknown;

  constructor(
    readonly status: 401 | 403,
    readonly responseSource: ProxyAuthenticationSource,
    cause: unknown,
    request?: ObservedTransportRequest,
    readonly responseHeaders?: Record<string, string>
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
  }

  readonly method?: string;
  readonly requestUrl?: string;
  readonly startedAt?: string;
  readonly durationMs?: number;
}

export const getObservedAuthenticationChallenge = (
  error: unknown,
  seen = new Set<object>()
): ObservedAuthenticationChallenge | undefined => {
  if (!error || typeof error !== 'object' || seen.has(error)) return undefined;
  seen.add(error);

  if (error instanceof ProxiedAuthenticationError) {
    return {
      status: error.status,
      source: error.responseSource,
      ...(error.responseHeaders ? { responseHeaders: error.responseHeaders } : {}),
      ...(error.method ? { method: error.method } : {}),
      ...(error.requestUrl ? { requestUrl: error.requestUrl } : {}),
      ...(error.startedAt ? { startedAt: error.startedAt } : {}),
      ...(error.durationMs !== undefined ? { durationMs: error.durationMs } : {}),
    };
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

const PROXY_RESPONSE_SOURCE_HEADER = 'X-MCP-Proxy-Response-Source';

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

const observeAuthenticationResponses = (
  usesProxy: boolean,
  onChallenge: (challenge: ObservedAuthenticationChallenge) => void,
  observedRequests: ObservedTransportRequest[],
  candidate: TransportCandidate,
  onRequest?: (request: ObservedTransportRequest) => void
): FetchLike => async (input, init) => {
  const request = typeof Request !== 'undefined' && input instanceof Request ? input : undefined;
  const startedAtMs = Date.now();
  const attemptedRequest: ObservedTransportRequest = {
    method: (init?.method || request?.method || 'GET').toUpperCase(),
    url: request?.url || String(input),
    candidateUrl: candidate.url,
    transportType: candidate.transportType,
    startedAt: new Date(startedAtMs).toISOString(),
    outcome: 'started',
  };
  observedRequests.push(attemptedRequest);
  onRequest?.(attemptedRequest);
  let response: Response;
  try {
    response = await fetch(input, init);
    attemptedRequest.status = response.status;
    attemptedRequest.durationMs = Math.max(0, Date.now() - startedAtMs);
    attemptedRequest.outcome = response.ok ? 'succeeded' : 'failed';
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
    onChallenge({
      status: response.status,
      source: responseSource,
      ...(responseHeaders ? { responseHeaders } : {}),
      method: attemptedRequest.method,
      requestUrl: attemptedRequest.url,
      startedAt: attemptedRequest.startedAt,
      durationMs: attemptedRequest.durationMs,
    });
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

const directCandidates = (endpoint: URL): TransportCandidate[] => {
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
  const normalizedPath = endpoint.pathname.replace(/\/+$/, '');

  if (normalizedPath.endsWith('/sse')) {
    add(endpoint, 'legacy-sse');
    const httpSibling = siblingEndpoint(endpoint, 'sse', 'mcp');
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
  usesProxy = false
): TransportCandidate[] => {
  const outerUrl = new URL(serverUrl);
  if (!usesProxy) return directCandidates(outerUrl);

  const targetValue = outerUrl.searchParams.get('target');
  if (!targetValue) {
    throw new Error('Proxy connection URL is missing its target endpoint.');
  }

  const targetUrl = new URL(targetValue);
  return directCandidates(targetUrl).map((candidate) => {
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
    observedRequests: readonly ObservedTransportRequest[];
  }>,
  candidateFailures: TransportCandidateFailure[]
): Promise<T> => {
  return new Promise((resolve, reject) => {
    const errors: unknown[] = [];
    let remaining = attempts.length;

    for (const { promise, candidateUrl, observedRequests } of attempts) {
      promise.then(resolve).catch((error) => {
        errors.push(error);
        candidateFailures.push({ candidateUrl, error, observedRequests });
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
  onRequest?: (request: ObservedTransportRequest) => void
): Promise<ConnectedCandidate & { protocolEra: ProtocolEra; protocolVersion?: string }> {
  const candidates = getTransportCandidates(serverUrl, usesProxy);
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
        onRequest
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
    const transportOpts = transportOptionsFor(candidate, observedRequests, (challenge) => {
      authenticationChallenge = challenge;
    });
    const transport = candidate.transportType === 'legacy-sse'
      ? new CorsAwareSSETransport(endpoint, transportOpts)
      : new CorsAwareStreamableHTTPTransport(endpoint, transportOpts);

    try {
      await client.connect(
        transport,
        protocolEraHint === 'stateful' || protocolEraHint === 'legacy'
          ? { prior: { kind: 'legacy' } }
          : undefined
      );
    } catch (error) {
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
          authenticationChallenge.responseHeaders
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
              return { promise, candidateUrl: candidate.url, observedRequests };
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
