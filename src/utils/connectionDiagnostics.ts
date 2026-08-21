import { LATEST_PROTOCOL_VERSION } from '@modelcontextprotocol/client';
import type { TransportType } from '../types';
import {
  getObservedAuthenticationChallenge,
  TransportConnectionError,
  type ObservedTransportRequest,
  type TransportCandidateFailure,
} from './transportDetection';

export type ConnectionAttemptRoute = 'direct' | 'proxy';
export type DiagnosticTransportEvidence = TransportType | 'both' | 'unknown';
export type ConnectionFailureKind =
  | 'browser-unreadable'
  | 'http'
  | 'authentication'
  | 'timeout'
  | 'abort'
  | 'refused'
  | 'network'
  | 'unknown';

export interface ConnectionAttemptFact {
  route: ConnectionAttemptRoute;
  candidateUrl: string;
  transportType?: TransportType;
  method?: string;
  status?: number;
  authenticationSource?: 'proxy' | 'target';
  browserUnreadable: boolean;
  failureKind: ConnectionFailureKind;
  message: string;
}

export interface ConnectionFailureEvidence {
  route: ConnectionAttemptRoute;
  error: unknown;
}

export interface ConnectionErrorDetails {
  error: string;
  serverUrl: string;
  timestamp: Date;
  details?: string;
  suggestions?: string[];
  attempts?: readonly ConnectionAttemptFact[];
  transportEvidence?: DiagnosticTransportEvidence;
  expectedAuthentication?: 'oauth' | 'bearer-token' | 'api-key' | 'none' | 'unknown';
  supportsBearerToken?: boolean;
  serverReachable?: boolean;
}

const errorMessage = (error: unknown): string => (
  error instanceof Error ? error.message : String(error)
).replace(/^All connections failed:\s*/i, '');

const targetCandidateUrl = (candidateUrl: string, route: ConnectionAttemptRoute): string => {
  if (route !== 'proxy') return candidateUrl;
  try {
    return new URL(candidateUrl).searchParams.get('target') || candidateUrl;
  } catch {
    return candidateUrl;
  }
};

const classifyFailure = (
  error: unknown,
  status: number | undefined
): ConnectionFailureKind => {
  const message = errorMessage(error);
  if (/abort(?:ed)?(?: by user)?/i.test(message)) return 'abort';
  if (/timed?\s*out|timeout/i.test(message)) return 'timeout';
  if (/refused|econnrefused/i.test(message)) return 'refused';
  if (status === 401 || status === 403) return 'authentication';
  if (status !== undefined) return 'http';
  if (
    error instanceof TypeError
    || /failed to fetch|load failed|networkerror when attempting to fetch|network request failed/i.test(message)
  ) return 'browser-unreadable';
  if (/\b(?:dns|tls|socket|network|enotfound|ehostunreach)\b/i.test(message)) return 'network';
  return 'unknown';
};

const latestObservedRequest = (
  observedRequests: readonly ObservedTransportRequest[] | undefined
): ObservedTransportRequest | undefined => {
  if (!observedRequests?.length) return undefined;
  return [...observedRequests].reverse().find(({ status }) => status !== undefined)
    || observedRequests[observedRequests.length - 1];
};

const factFromCandidateFailure = (
  failure: TransportCandidateFailure,
  route: ConnectionAttemptRoute,
  fallbackTransport?: TransportType
): ConnectionAttemptFact => {
  const challenge = getObservedAuthenticationChallenge(failure.error);
  const request = latestObservedRequest(failure.observedRequests);
  const status = challenge?.status ?? request?.status
    ?? (typeof (failure.error as { status?: unknown })?.status === 'number'
      ? (failure.error as { status: number }).status
      : undefined);
  const failureKind = classifyFailure(failure.error, status);

  return {
    route,
    candidateUrl: targetCandidateUrl(failure.candidateUrl, route),
    ...(failure.transportType || request?.transportType || fallbackTransport
      ? { transportType: failure.transportType || request?.transportType || fallbackTransport }
      : {}),
    ...(challenge?.method || request?.method ? { method: challenge?.method || request?.method } : {}),
    ...(status !== undefined ? { status } : {}),
    ...(challenge?.source ? { authenticationSource: challenge.source } : {}),
    browserUnreadable: failureKind === 'browser-unreadable',
    failureKind,
    message: errorMessage(failure.error),
  };
};

const collectErrorFacts = (
  error: unknown,
  route: ConnectionAttemptRoute,
  fallbackUrl: string,
  fallbackTransport: TransportType | undefined,
  facts: ConnectionAttemptFact[],
  seen: Set<object>
): void => {
  if (error && typeof error === 'object') {
    if (seen.has(error)) return;
    seen.add(error);
  }

  if (error instanceof TransportConnectionError) {
    const representedErrors = new Set<unknown>();
    if (error.candidateFailures.length > 0) {
      for (const failure of error.candidateFailures) {
        representedErrors.add(failure.error);
        facts.push(factFromCandidateFailure(failure, route, fallbackTransport));
      }
    }
    for (const nested of error.errors) {
      if (representedErrors.has(nested)) continue;
      collectErrorFacts(nested, route, fallbackUrl, fallbackTransport, facts, seen);
    }
    return;
  }

  const challenge = getObservedAuthenticationChallenge(error);
  const status = challenge?.status
    ?? (typeof (error as { status?: unknown })?.status === 'number'
      ? (error as { status: number }).status
      : undefined);
  const failureKind = classifyFailure(error, status);
  facts.push({
    route,
    candidateUrl: targetCandidateUrl(challenge?.requestUrl || fallbackUrl, route),
    ...(fallbackTransport ? { transportType: fallbackTransport } : {}),
    ...(challenge?.method ? { method: challenge.method } : {}),
    ...(status !== undefined ? { status } : {}),
    ...(challenge?.source ? { authenticationSource: challenge.source } : {}),
    browserUnreadable: failureKind === 'browser-unreadable',
    failureKind,
    message: errorMessage(error),
  });
};

export const collectConnectionAttemptFacts = (
  failures: readonly ConnectionFailureEvidence[],
  fallbackUrl: string,
  fallbackTransport?: TransportType
): ConnectionAttemptFact[] => {
  const facts: ConnectionAttemptFact[] = [];
  const seen = new Set<object>();
  for (const failure of failures) {
    collectErrorFacts(
      failure.error,
      failure.route,
      fallbackUrl,
      fallbackTransport,
      facts,
      seen
    );
  }

  const unique = new Map<string, ConnectionAttemptFact>();
  for (const fact of facts) {
    const key = [
      fact.route,
      fact.candidateUrl,
      fact.transportType,
      fact.method,
      fact.status,
      fact.authenticationSource,
      fact.failureKind,
      fact.message,
    ].join('|');
    if (!unique.has(key)) unique.set(key, fact);
  }
  return [...unique.values()];
};

/** POSIX shell single-quoting; no endpoint or generated value is executable. */
export const shellQuote = (value: string): string => `'${value.replace(/'/g, `'\\''`)}'`;

export const normalizeDiagnosticEndpoint = (serverUrl: string): string => {
  // The connection hook has already supplied the normalized scheme. Preserve
  // every remaining path, slash, query, and fragment byte the user selected.
  return serverUrl.trim();
};

const initializePayload = JSON.stringify({
  jsonrpc: '2.0',
  id: 1,
  method: 'initialize',
  params: {
    protocolVersion: LATEST_PROTOCOL_VERSION,
    capabilities: {},
    clientInfo: { name: 'mcptest-diagnostic', version: '1.0.0' },
  },
});

const generateHttpCurlCommandWithHeaders = (
  serverUrl: string,
  additionalHeaders: readonly string[] = []
): string => {
  const endpoint = normalizeDiagnosticEndpoint(serverUrl);
  return [
    'curl --request POST',
    `  --url ${shellQuote(endpoint)}`,
    `  --header ${shellQuote('Content-Type: application/json')}`,
    `  --header ${shellQuote('Accept: application/json, text/event-stream')}`,
    ...additionalHeaders.map((header) => `  --header ${shellQuote(header)}`),
    `  --data-raw ${shellQuote(initializePayload)}`,
    '  --location',
    '  --verbose',
  ].join(' \\\n');
};

export const generateHttpCurlCommand = (serverUrl: string): string => (
  generateHttpCurlCommandWithHeaders(serverUrl)
);

export const generateBearerHttpCurlCommand = (serverUrl: string): string => (
  generateHttpCurlCommandWithHeaders(serverUrl, ['Authorization: Bearer <ACCESS_TOKEN>'])
);

export const generateSseCurlCommand = (serverUrl: string): string => {
  const endpoint = normalizeDiagnosticEndpoint(serverUrl);
  return [
    'curl --request GET',
    `  --url ${shellQuote(endpoint)}`,
    `  --header ${shellQuote('Accept: text/event-stream')}`,
    `  --header ${shellQuote('Cache-Control: no-cache')}`,
    '  --no-buffer',
    '  --location',
    '  --verbose',
  ].join(' \\\n');
};
