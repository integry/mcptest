import {
  discoverAuthorizationServerMetadata,
  discoverOAuthProtectedResourceMetadata,
  type Client,
  type FetchLike,
  type OAuthProtectedResourceMetadata,
  type ProtocolEra,
} from '@modelcontextprotocol/client';
import {
  ProxiedAuthenticationError,
  attemptParallelConnections,
  type ObservedAuthenticationChallenge,
  type ProxyAuthenticationSource,
  type TransportCandidateFailure,
} from './transportDetection';
import type { TransportType } from '../types';

const getProxyUrl = (): string | undefined => import.meta.env.VITE_PROXY_URL;

const isConfiguredProxyTarget = (value: string, proxyUrl: string): boolean => {
  const candidate = new URL(value);
  const configuredProxy = new URL(proxyUrl);

  return candidate.origin === configuredProxy.origin
    && candidate.pathname === configuredProxy.pathname
    && candidate.searchParams.has('target');
};

const normalizeServerUrl = (value: string): string => {
  const withProtocol = /^https?:\/\//i.test(value) ? value : `https://${value}`;
  return new URL(withProtocol).toString();
};

export const getEvaluationTargetUrl = (
  connectionUrl: string,
  usesProxy = false
): string => {
  const outerUrl = new URL(connectionUrl);
  const proxyUrl = getProxyUrl();
  if (!usesProxy || !proxyUrl || !isConfiguredProxyTarget(connectionUrl, proxyUrl)) {
    return outerUrl.toString();
  }

  return new URL(outerUrl.searchParams.get('target') as string).toString();
};

/**
 * Retained for callers that need to compare a negotiated HTTP/SSE sibling.
 * Custom paths remain exact; only a terminal conventional transport segment is
 * replaced.
 */
export function getEvaluationTransportProbeUrl(
  connectionUrl: string,
  targetTransport: 'mcp' | 'sse',
  usesProxy = false
): string {
  const outerUrl = new URL(connectionUrl);
  const proxyUrl = getProxyUrl();
  const proxyTarget = outerUrl.searchParams.get('target');
  const isProxied = Boolean(
    usesProxy
    && proxyUrl
    && proxyTarget
    && isConfiguredProxyTarget(connectionUrl, proxyUrl)
  );
  const targetUrl = isProxied ? new URL(proxyTarget as string) : outerUrl;

  targetUrl.pathname = targetUrl.pathname.replace(/\/(?:mcp|sse)\/?$/, `/${targetTransport}`);

  if (!isProxied) return targetUrl.toString();
  outerUrl.searchParams.set('target', targetUrl.toString());
  return outerUrl.toString();
}

export interface DetailItem {
  text: string;
  context?: string;
  metadata?: unknown;
}

export interface EvaluationSection {
  name: string;
  description: string;
  score: number;
  maxScore: number;
  details: DetailItem[];
  /** Optional export hint for reports that could not evaluate every section. */
  status?: 'evaluated' | 'partial' | 'failed' | 'skipped';
}

export interface EvaluationReport {
  serverUrl: string;
  authenticationUrl?: string;
  outcome?: 'scored' | 'authorization-required' | 'partial' | 'failed';
  finalScore: number;
  sections: Record<string, EvaluationSection>;
}

export const isAuthenticationRequired = (report: EvaluationReport): boolean => (
  report.outcome === 'authorization-required' || Boolean(report.sections.auth)
);

const isLegacyIncompleteEvaluationDetail = (detail: DetailItem): boolean => {
  const evidence = `${detail.text}. ${detail.context || ''}`;
  const scoredChecksCompleted = (
    /(?:^|[.;]\s*)(?:all\s+)?scored checks (?:were\s+)?completed(?:[.!]|$)/i.test(evidence)
  );

  return /^⚠/.test(detail.text)
    && !scoredChecksCompleted
    && /skipped|not scored|no standard MCP transport|could not be isolated|negotiation failed/i.test(
      evidence
    );
};

export const hasLegacyIncompleteEvaluationEvidence = (section: EvaluationSection): boolean => (
  section.details.some(isLegacyIncompleteEvaluationDetail)
);

export const isLegacySkippedEvaluationSection = (section: EvaluationSection): boolean => (
  section.details.length > 0
  && section.details.every((detail) => /^⚠/.test(detail.text))
  && hasLegacyIncompleteEvaluationEvidence(section)
);

/** Resolves explicit and legacy reports to one outcome for artifacts and presentation. */
export const resolveEvaluationOutcome = (
  report: EvaluationReport
): NonNullable<EvaluationReport['outcome']> => {
  if (isAuthenticationRequired(report)) return 'authorization-required';
  if (report.outcome === 'failed' || report.outcome === 'partial') return report.outcome;

  const sections = Object.values(report.sections);
  const inferLegacyOutcome = report.outcome === undefined;
  const incomplete = sections.some((section) => (
    section.status === 'partial'
    || section.status === 'failed'
    || section.status === 'skipped'
    || (inferLegacyOutcome && !section.status && hasLegacyIncompleteEvaluationEvidence(section))
  ));
  const protocolSection = report.sections.protocol;
  const protocolIncomplete = protocolSection && (
    protocolSection.status === 'failed'
    || protocolSection.status === 'skipped'
    || (inferLegacyOutcome
      && !protocolSection.status
      && isLegacySkippedEvaluationSection(protocolSection))
  );
  const negotiationFailed = protocolIncomplete && protocolSection.details.some((detail) => (
    /negotiation failed|no MCP connection/i.test(`${detail.text} ${detail.context || ''}`)
  ));

  if (negotiationFailed) return 'failed';
  if (incomplete) return 'partial';
  return 'scored';
};

export const isScoredEvaluation = (report: EvaluationReport): boolean => (
  resolveEvaluationOutcome(report) === 'scored'
);

export const getEvaluationMaxScore = (report: EvaluationReport): number => (
  Object.entries(report.sections)
    .filter(([key]) => key !== 'auth')
    .reduce((total, [, section]) => total + section.maxScore, 0)
);

export const getEvaluationPercentage = (report: EvaluationReport): number => {
  const maxScore = getEvaluationMaxScore(report);
  return maxScore > 0 ? report.finalScore / maxScore * 100 : 0;
};

export function getEvaluationProxyHeaders(
  requestHeaders: HeadersInit | undefined,
  firebaseToken: string,
  oauthToken?: string | null
): Headers {
  const headers = new Headers(requestHeaders);
  headers.set('Authorization', `Bearer ${firebaseToken}`);

  if (oauthToken) {
    headers.set('X-MCP-Authorization', `Bearer ${oauthToken}`);
  }

  return headers;
}

/**
 * Fetches the target directly first so evaluation does not silently measure the
 * proxy. When direct browser access fails, the configured proxy is authenticated
 * with Firebase and the MCP credential is kept on the isolated target channel.
 */
export async function fetchForEvaluation(
  url: string,
  firebaseToken: string,
  options: RequestInit = {},
  oauthToken?: string | null,
  usesProxy = false
): Promise<Response> {
  const proxyUrl = getProxyUrl();
  if (usesProxy && proxyUrl && isConfiguredProxyTarget(url, proxyUrl)) {
    return fetch(url, {
      ...options,
      headers: getEvaluationProxyHeaders(options.headers, firebaseToken, oauthToken),
    });
  }

  const directHeaders = new Headers(options.headers);
  if (oauthToken) {
    directHeaders.set('Authorization', `Bearer ${oauthToken}`);
  }

  try {
    return await fetch(url, { ...options, headers: directHeaders });
  } catch (error) {
    if (!proxyUrl) throw error;
    console.log('[Evaluation] Direct fetch failed, falling back to proxy');
  }

  const target = new URL(proxyUrl);
  target.searchParams.set('target', url);
  return fetch(target, {
    ...options,
    headers: getEvaluationProxyHeaders(options.headers, firebaseToken, oauthToken),
  });
}

export const getEvaluationCorsHeaders = (
  protocolEra: ProtocolEra,
  authenticated: boolean
): string[] => {
  const headers = ['content-type', 'accept', 'mcp-protocol-version'];

  if (protocolEra === 'modern') {
    headers.push('mcp-method', 'mcp-name');
  } else {
    headers.push('mcp-session-id', 'last-event-id');
  }

  if (authenticated) headers.push('authorization');
  return headers;
};

const errorMessage = (error: unknown): string => (
  error instanceof Error ? error.message : String(error)
);

const getAuthenticationHttpStatus = (
  error: unknown,
  seen = new Set<object>()
): 401 | 403 | undefined => {
  if (!error || typeof error !== 'object' || seen.has(error)) return undefined;
  seen.add(error);

  const value = error as {
    status?: unknown;
    statusCode?: unknown;
    response?: { status?: unknown };
    cause?: unknown;
    errors?: readonly unknown[];
  };
  const directStatuses = [
    value.status,
    value.statusCode,
    value.response?.status,
  ];
  const directStatus = directStatuses.find((status) => status === 401 || status === 403);
  if (directStatus === 401 || directStatus === 403) return directStatus;

  if (Array.isArray(value.errors)) {
    for (const nestedError of value.errors) {
      const nestedStatus = getAuthenticationHttpStatus(nestedError, seen);
      if (nestedStatus !== undefined) return nestedStatus;
    }
  }

  return getAuthenticationHttpStatus(value.cause, seen);
};

interface ProxyAuthenticationChallenge {
  status: 401 | 403;
  source: ProxyAuthenticationSource;
}

const getProxyAuthenticationChallenge = (
  error: unknown,
  seen = new Set<object>()
): ProxyAuthenticationChallenge | undefined => {
  if (!error || typeof error !== 'object' || seen.has(error)) return undefined;
  seen.add(error);

  if (error instanceof ProxiedAuthenticationError) {
    return { status: error.status, source: error.responseSource };
  }

  const value = error as { cause?: unknown; errors?: readonly unknown[] };
  let proxyChallenge: ProxyAuthenticationChallenge | undefined;
  if (Array.isArray(value.errors)) {
    for (const nestedError of value.errors) {
      const nestedChallenge = getProxyAuthenticationChallenge(nestedError, seen);
      if (nestedChallenge?.source === 'target') return nestedChallenge;
      if (nestedChallenge?.source === 'proxy') proxyChallenge = nestedChallenge;
    }
  }

  const causeChallenge = getProxyAuthenticationChallenge(value.cause, seen);
  if (causeChallenge?.source === 'target') return causeChallenge;
  return causeChallenge || proxyChallenge;
};

const isMethodNotFound = (error: unknown): boolean => {
  const value = error as { code?: number; message?: string };
  return value?.code === -32601 || /method not found/i.test(value?.message || '');
};

const makeSkippedSection = (
  name: string,
  description: string,
  maxScore: number,
  reason: string,
  metadata?: Record<string, unknown>,
  status: EvaluationSection['status'] = 'skipped'
): EvaluationSection => ({
  name,
  description,
  score: 0,
  maxScore,
  details: [{ text: `⚠ ${reason}`, ...(metadata ? { metadata } : {}) }],
  status,
});

interface ConnectedEvaluation {
  client: Client;
  url: string;
  transportType: TransportType;
  protocolEra: ProtocolEra;
  protocolVersion?: string;
  usedProxy: boolean;
  directError?: string;
  takeAuthenticationChallenge?: () => ObservedAuthenticationChallenge | undefined;
}

interface EvaluationRouteFailure {
  route: 'direct' | 'proxy';
  error: unknown;
  message: string;
  httpStatus?: number;
  authenticationSource?: ProxyAuthenticationSource;
  candidateUrl?: string;
}

const getAuthenticationCandidateUrl = (
  error: unknown,
  authenticationSource: ProxyAuthenticationSource,
  seen = new Set<object>()
): string | undefined => {
  if (!error || typeof error !== 'object' || seen.has(error)) return undefined;
  seen.add(error);

  const value = error as {
    candidateFailures?: readonly TransportCandidateFailure[];
    cause?: unknown;
    errors?: readonly unknown[];
  };
  if (Array.isArray(value.candidateFailures)) {
    for (const failure of value.candidateFailures) {
      const challenge = getProxyAuthenticationChallenge(failure.error);
      const status = challenge?.status || getAuthenticationHttpStatus(failure.error);
      const source = challenge?.source || 'target';
      if ((status === 401 || status === 403) && source === authenticationSource) {
        return failure.candidateUrl;
      }
    }
  }

  if (Array.isArray(value.errors)) {
    for (const nestedError of value.errors) {
      const candidateUrl = getAuthenticationCandidateUrl(
        nestedError,
        authenticationSource,
        seen
      );
      if (candidateUrl) return candidateUrl;
    }
  }

  return getAuthenticationCandidateUrl(value.cause, authenticationSource, seen);
};

const makeRouteFailure = (
  route: EvaluationRouteFailure['route'],
  error: unknown,
  observedChallenge?: ObservedAuthenticationChallenge,
  connectedCandidateUrl?: string
): EvaluationRouteFailure => {
  const authenticationChallenge = observedChallenge || getProxyAuthenticationChallenge(error);
  const httpStatus = authenticationChallenge?.status || getAuthenticationHttpStatus(error);
  const authenticationSource = authenticationChallenge?.source || (
    route === 'direct' && httpStatus ? 'target' : undefined
  );
  const failedCandidateUrl = connectedCandidateUrl || (
    authenticationSource
      ? getAuthenticationCandidateUrl(error, authenticationSource)
      : undefined
  );
  return {
    route,
    error,
    message: errorMessage(error),
    httpStatus,
    authenticationSource,
    candidateUrl: failedCandidateUrl
      ? getEvaluationTargetUrl(failedCandidateUrl, route === 'proxy')
      : undefined,
  };
};

class EvaluationConnectionError extends Error {
  constructor(readonly failures: readonly EvaluationRouteFailure[]) {
    super(failures.map((failure) => (
      `${failure.route === 'direct' ? 'Direct target' : 'Authenticated proxy'}: ${failure.message}`
    )).join('; '));
    this.name = 'EvaluationConnectionError';
  }
}

const connectForEvaluation = async (
  serverUrl: string,
  firebaseToken: string,
  oauthToken: string | null,
  onProgress: (message: string) => void
): Promise<ConnectedEvaluation> => {
  const abortController = new AbortController();

  try {
    onProgress('Attempting direct MCP negotiation...');
    const direct = await attemptParallelConnections(
      serverUrl,
      abortController.signal,
      oauthToken || undefined,
      undefined,
      false
    );
    return { ...direct, usedProxy: false };
  } catch (directError) {
    const directFailure = makeRouteFailure('direct', directError);
    const proxyUrl = getProxyUrl();
    if (!proxyUrl) throw new EvaluationConnectionError([directFailure]);

    try {
      onProgress('Direct negotiation failed; retrying through the authenticated CORS proxy...');
      const proxyConnectionUrl = new URL(proxyUrl);
      proxyConnectionUrl.searchParams.set('target', serverUrl);
      const targetHeaders = oauthToken
        ? { Authorization: `Bearer ${oauthToken}` }
        : undefined;
      const proxied = await attemptParallelConnections(
        proxyConnectionUrl.toString(),
        abortController.signal,
        firebaseToken,
        targetHeaders,
        true
      );
      return { ...proxied, usedProxy: true, directError: directFailure.message };
    } catch (proxyError) {
      throw new EvaluationConnectionError([
        directFailure,
        makeRouteFailure('proxy', proxyError),
      ]);
    }
  }
};

interface CapabilityEvaluation {
  section: EvaluationSection;
  targetAuthenticationFailures: Array<EvaluationRouteFailure & { method: string }>;
}

const evaluateCapabilities = async (
  connection: ConnectedEvaluation
): Promise<CapabilityEvaluation> => {
  const section: EvaluationSection = {
    name: 'MCP Capabilities',
    description: 'Exercises standardized tools, resources, and prompts discovery methods',
    score: 0,
    maxScore: 10,
    details: [],
  };
  const targetAuthenticationFailures: CapabilityEvaluation['targetAuthenticationFailures'] = [];
  const checks: Array<{
    name: string;
    method: string;
    points: number;
    run: () => Promise<unknown>;
    count: (result: any) => number;
  }> = [
    {
      name: 'tools',
      method: 'tools/list',
      points: 4,
      run: () => connection.client.listTools(),
      count: (result) => Array.isArray(result?.tools) ? result.tools.length : 0,
    },
    {
      name: 'resources',
      method: 'resources/list',
      points: 3,
      run: () => connection.client.listResources(),
      count: (result) => Array.isArray(result?.resources) ? result.resources.length : 0,
    },
    {
      name: 'prompts',
      method: 'prompts/list',
      points: 3,
      run: () => connection.client.listPrompts(),
      count: (result) => Array.isArray(result?.prompts) ? result.prompts.length : 0,
    },
  ];

  for (const check of checks) {
    // Discard any challenge already handled while negotiating the connection.
    connection.takeAuthenticationChallenge?.();
    try {
      const startedAt = Date.now();
      const result = await check.run();
      const durationMs = Date.now() - startedAt;
      const itemCount = check.count(result);
      section.score += check.points;
      section.details.push({
        text: `✓ ${check.method} succeeded (${itemCount} ${check.name})`,
        context: `The server implements the standard ${check.name} discovery method, including valid empty lists.`,
        metadata: { method: check.method, itemCount, durationMs },
      });
      connection.takeAuthenticationChallenge?.();
    } catch (error) {
      const failure = makeRouteFailure(
        connection.usedProxy ? 'proxy' : 'direct',
        error,
        connection.takeAuthenticationChallenge?.(),
        connection.url
      );
      if (
        (failure.httpStatus === 401 || failure.httpStatus === 403)
        && failure.authenticationSource === 'target'
      ) {
        targetAuthenticationFailures.push({ ...failure, method: check.method });
      }
      const methodNotFound = isMethodNotFound(error);
      section.details.push({
        text: `${methodNotFound ? '⚠' : '✗'} ${check.method} ${methodNotFound ? 'is not supported' : 'failed'}`,
        context: methodNotFound
          ? `${check.name} are optional; the server correctly returned method-not-found.`
          : failure.message,
        metadata: {
          method: check.method,
          error: failure.message,
          ...(failure.httpStatus ? { status: failure.httpStatus } : {}),
          ...(failure.authenticationSource
            ? { authenticationSource: failure.authenticationSource, route: failure.route }
            : {}),
        },
      });
    }
  }

  return { section, targetAuthenticationFailures };
};

type AuthorizationServerMetadata = NonNullable<
  Awaited<ReturnType<typeof discoverAuthorizationServerMetadata>>
>;

const metadataFetchForEvaluation = (firebaseToken: string): FetchLike => (
  input,
  init
) => {
  const request = input instanceof Request ? input : new Request(input, init);
  return fetchForEvaluation(request.url, firebaseToken, {
    method: request.method,
    headers: request.headers,
    signal: request.signal,
  });
};

const evaluateSecurityPosture = async (
  connection: ConnectedEvaluation,
  firebaseToken: string
): Promise<EvaluationSection | undefined> => {
  const endpoint = getEvaluationTargetUrl(connection.url, connection.usedProxy);
  const metadataFetch = metadataFetchForEvaluation(firebaseToken);
  let resourceMetadata: OAuthProtectedResourceMetadata | undefined;

  try {
    resourceMetadata = await discoverOAuthProtectedResourceMetadata(
      endpoint,
      { protocolVersion: connection.protocolVersion },
      metadataFetch
    );
  } catch {
    // Protected-resource metadata is optional for older OAuth-enabled servers.
  }

  const endpointUrl = new URL(endpoint);
  const authorizationServers = resourceMetadata?.authorization_servers?.length
    ? resourceMetadata.authorization_servers
    : [endpointUrl.origin];
  let authorizationServer: string | undefined;
  let authorizationMetadata: AuthorizationServerMetadata | undefined;

  for (const candidate of authorizationServers) {
    try {
      const metadata = await discoverAuthorizationServerMetadata(candidate, {
        fetchFn: metadataFetch,
        protocolVersion: connection.protocolVersion,
      });
      if (metadata) {
        authorizationServer = candidate;
        authorizationMetadata = metadata;
        break;
      }
    } catch {
      // Continue when one advertised authorization server has unavailable metadata.
    }
  }

  if (!resourceMetadata && !authorizationMetadata) return undefined;

  const section: EvaluationSection = {
    name: 'Security Posture',
    description: 'Evaluates OAuth protected-resource and authorization-server metadata',
    score: 0,
    maxScore: 40,
    details: [],
  };

  if (resourceMetadata) {
    section.details.push({
      text: '✓ OAuth protected-resource metadata available',
      context: 'The MCP endpoint publishes standardized metadata identifying its authorization servers and protected resource.',
      metadata: {
        endpoint,
        resource: resourceMetadata.resource,
        authorizationServers: resourceMetadata.authorization_servers || [],
        scopesSupported: resourceMetadata.scopes_supported || [],
      },
    });
  } else {
    section.details.push({
      text: '⚠ OAuth protected-resource metadata not available',
      context: 'Authorization-server metadata was discovered through the legacy origin fallback.',
      metadata: { endpoint },
    });
  }

  if (authorizationMetadata) {
    section.score += 20;
    section.details.push({
      text: '✓ OAuth authorization-server metadata available',
      context: 'Standard metadata allows clients to configure authorization endpoints without hard-coded assumptions.',
      metadata: {
        authorizationServer,
        issuer: authorizationMetadata.issuer,
        authorizationEndpoint: authorizationMetadata.authorization_endpoint,
      },
    });
  } else {
    section.details.push({
      text: '✗ Authorization-server metadata not available',
      context: 'The protected resource advertises OAuth, but none of its authorization servers returned valid standardized metadata.',
      metadata: { authorizationServers },
    });
  }

  if (authorizationMetadata?.token_endpoint) {
    section.score += 10;
    section.details.push({
      text: '✓ Token endpoint properly configured',
      context: 'A published token endpoint enables the secure exchange of authorization grants for access tokens.',
      metadata: {
        tokenEndpoint: authorizationMetadata.token_endpoint,
        supportedGrantTypes: authorizationMetadata.grant_types_supported || [],
      },
    });
  } else {
    section.details.push({
      text: '✗ Token endpoint not configured',
      context: 'The authorization-server metadata does not publish a token endpoint.',
    });
  }

  if (authorizationMetadata?.code_challenge_methods_supported?.includes('S256')) {
    section.score += 10;
    section.details.push({
      text: '✓ PKCE support enabled',
      context: 'S256 PKCE protects authorization codes used by public clients.',
      metadata: {
        supportedMethods: authorizationMetadata.code_challenge_methods_supported,
        requiredMethod: 'S256',
      },
    });
  } else {
    section.details.push({
      text: '✗ PKCE S256 support not advertised',
      context: 'OAuth public clients require S256 PKCE support for authorization-code protection.',
    });
  }

  return section;
};

const evaluateBrowserAccessibility = (
  connection: ConnectedEvaluation,
  authenticated: boolean
): EvaluationSection => {
  const endpointUrl = getEvaluationTargetUrl(connection.url, connection.usedProxy);
  const requiredHeaders = getEvaluationCorsHeaders(connection.protocolEra, authenticated);
  const section: EvaluationSection = {
    name: 'Web Client Accessibility',
    description: 'Validates direct-browser MCP access at the negotiated endpoint',
    score: connection.usedProxy ? 0 : 15,
    maxScore: 15,
    details: [],
  };

  if (connection.usedProxy) {
    section.details.push({
      text: '✗ Direct browser negotiation failed; the authenticated proxy was required',
      context: connection.directError
        || 'The direct route did not complete MCP negotiation in this browser.',
      metadata: { endpoint: endpointUrl, requiredHeaders },
    });
    return section;
  }

  section.details.push(
    {
      text: '✓ Direct browser MCP negotiation succeeded',
      context: 'The browser enforced CORS while the official SDK completed protocol negotiation without the proxy.',
      metadata: { endpoint: endpointUrl, origin: window.location.origin },
    },
    {
      text: `✓ ${connection.protocolEra === 'modern' ? 'Stateless' : 'Stateful'} MCP request headers passed browser enforcement`,
      metadata: { requiredHeaders },
    },
    {
      text: '✓ MCP responses were readable and passed SDK schema validation',
      metadata: { transportType: connection.transportType },
    }
  );

  return section;
};

const performanceSection = (durationMs: number): EvaluationSection => {
  let score = 4;
  let category = 'slow';
  if (durationMs < 500) {
    score = 15;
    category = 'excellent';
  } else if (durationMs < 1_000) {
    score = 12;
    category = 'good';
  } else if (durationMs < 2_500) {
    score = 8;
    category = 'fair';
  }

  return {
    name: 'Performance Baseline',
    description: 'Measures end-to-end endpoint selection and protocol negotiation',
    score,
    maxScore: 15,
    details: [{
      text: `${score >= 12 ? '✓' : score >= 8 ? '⚠' : '✗'} ${category} negotiation time: ${durationMs}ms`,
      metadata: { durationMs, category, measurement: 'Endpoint selection, MCP connect, and era negotiation' },
    }],
  };
};

export async function evaluateServer(
  inputUrl: string,
  firebaseToken: string,
  onProgress: (message: string) => void,
  oauthAccessToken?: string | null
): Promise<EvaluationReport> {
  const serverUrl = normalizeServerUrl(inputUrl);
  const oauthToken = oauthAccessToken || null;
  const report: EvaluationReport = {
    serverUrl,
    outcome: 'scored',
    finalScore: 0,
    sections: {},
  };
  let connection: ConnectedEvaluation | null = null;
  const connectionStartedAt = Date.now();

  onProgress('Establishing MCP connection with automatic 2026/2025 negotiation...');
  try {
    connection = await connectForEvaluation(
      serverUrl,
      firebaseToken,
      oauthToken,
      onProgress
    );
  } catch (error) {
    const message = errorMessage(error);
    const failures = error instanceof EvaluationConnectionError ? error.failures : [];
    const targetAuthFailure = failures.find((failure) => (
      (failure.httpStatus === 401 || failure.httpStatus === 403)
      && failure.authenticationSource === 'target'
    ));
    if (targetAuthFailure) {
      report.outcome = 'authorization-required';
      report.authenticationUrl = targetAuthFailure.candidateUrl || serverUrl;
      report.sections.auth = {
        name: 'Authorization Required',
        description: 'OAuth authorization is required before this server can be evaluated',
        score: 0,
        maxScore: 0,
        details: [{
          text: '⚠ Authorize with the server before running its report.',
          context: `The MCP endpoint returned HTTP ${targetAuthFailure.httpStatus || 401} during unauthenticated negotiation.`,
          metadata: {
            route: targetAuthFailure.route,
            status: targetAuthFailure.httpStatus,
            endpoint: report.authenticationUrl,
          },
        }],
      };
      onProgress('OAuth authorization is required before evaluation can continue.');
      return report;
    }

    report.outcome = 'failed';
    const lastFailure = failures[failures.length - 1];
    const failedRouteMetadata = lastFailure ? {
      route: lastFailure.route === 'proxy' ? 'authenticated proxy' : 'direct',
      routeFailures: failures.map((failure) => ({
        route: failure.route === 'proxy' ? 'authenticated proxy' : 'direct',
        message: failure.message,
        ...(failure.httpStatus !== undefined ? { status: failure.httpStatus } : {}),
        ...(failure.authenticationSource
          ? { authenticationSource: failure.authenticationSource }
          : {}),
        ...(failure.candidateUrl ? { endpoint: failure.candidateUrl } : {}),
      })),
    } : undefined;

    report.sections.protocol = makeSkippedSection(
      'Core Protocol Adherence',
      'Validates MCP lifecycle and JSON-RPC negotiation',
      15,
      `MCP negotiation failed: ${message}`,
      failedRouteMetadata,
      'failed'
    );
    report.sections.capabilities = makeSkippedSection(
      'MCP Capabilities',
      'Exercises standardized tools, resources, and prompts discovery methods',
      10,
      'Capability checks were skipped because no MCP connection was established.'
    );
    report.sections.transport = makeSkippedSection(
      'Transport Layer Modernity',
      'Identifies Streamable HTTP or deprecated HTTP+SSE',
      15,
      'No standard MCP transport completed negotiation.'
    );
    report.sections.cors = makeSkippedSection(
      'Web Client Accessibility',
      'Validates direct-browser MCP access at the negotiated endpoint',
      15,
      'Browser accessibility could not be isolated because neither direct nor proxied MCP negotiation succeeded.'
    );
    report.sections.performance = makeSkippedSection(
      'Performance Baseline',
      'Measures end-to-end endpoint selection and protocol negotiation',
      15,
      'Performance was not scored because negotiation failed.'
    );
    report.finalScore = report.sections.cors.score;
    onProgress('Evaluation finished without an MCP connection.');
    return report;
  }

  try {
    const durationMs = Date.now() - connectionStartedAt;
    const protocolLabel = connection.protocolEra === 'modern'
      ? 'stateless server/discover lifecycle'
      : 'stateful initialize lifecycle';
    report.sections.protocol = {
      name: 'Core Protocol Adherence',
      description: 'Validates MCP lifecycle and JSON-RPC negotiation',
      score: 15,
      maxScore: 15,
      details: [
        {
          text: `✓ Negotiated the ${protocolLabel}`,
          context: connection.protocolEra === 'modern'
            ? 'The server accepted MCP 2026 self-describing requests without a transport session.'
            : 'The server completed the 2025-compatible initialize and initialized exchange.',
          metadata: {
            protocolEra: connection.protocolEra,
            protocolVersion: connection.protocolVersion,
            endpoint: getEvaluationTargetUrl(connection.url, connection.usedProxy),
            route: connection.usedProxy ? 'authenticated proxy' : 'direct',
          },
        },
        {
          text: '✓ JSON-RPC messages passed official SDK validation',
          context: 'Successful SDK negotiation verifies the JSON-RPC envelope and lifecycle response schemas.',
        },
      ],
    };
    onProgress(`Negotiated ${connection.protocolEra} MCP${connection.protocolVersion ? ` ${connection.protocolVersion}` : ''}.`);

    onProgress('Exercising tools, resources, and prompts discovery...');
    const capabilityEvaluation = await evaluateCapabilities(connection);
    report.sections.capabilities = capabilityEvaluation.section;
    if (capabilityEvaluation.targetAuthenticationFailures.length > 0) {
      report.outcome = 'authorization-required';
      report.authenticationUrl = capabilityEvaluation.targetAuthenticationFailures[0].candidateUrl
        || getEvaluationTargetUrl(connection.url, connection.usedProxy);
      report.sections = { auth: {
        name: 'Authorization Required',
        description: 'OAuth authorization is required before this server can be evaluated',
        score: 0,
        maxScore: 0,
        details: capabilityEvaluation.targetAuthenticationFailures.map((failure) => ({
          text: `⚠ Authorize with the server before calling ${failure.method}.`,
          context: `The MCP endpoint returned HTTP ${failure.httpStatus || 401} for ${failure.method}.`,
          metadata: {
            method: failure.method,
            route: failure.route,
            status: failure.httpStatus,
            authenticationSource: failure.authenticationSource,
            endpoint: failure.candidateUrl || report.authenticationUrl,
          },
        })),
      } };
      report.finalScore = 0;
      onProgress('OAuth authorization is required before evaluation can continue.');
      return report;
    }

    const modernTransport = connection.transportType === 'streamable-http';
    report.sections.transport = {
      name: 'Transport Layer Modernity',
      description: 'Identifies Streamable HTTP or deprecated HTTP+SSE',
      score: modernTransport ? 15 : 6,
      maxScore: 15,
      details: [{
        text: modernTransport
          ? '✓ Streamable HTTP negotiated successfully'
          : '⚠ Deprecated HTTP+SSE negotiated successfully',
        context: modernTransport
          ? 'Streamable HTTP uses POST with JSON or per-request SSE responses and supports both MCP lifecycle eras.'
          : 'The two-endpoint HTTP+SSE transport remains compatible but is deprecated in MCP 2026.',
        metadata: {
          transportType: connection.transportType,
          endpoint: getEvaluationTargetUrl(connection.url, connection.usedProxy),
          protocolEra: connection.protocolEra,
        },
      }],
    };

    onProgress('Checking OAuth security metadata...');
    const securitySection = await evaluateSecurityPosture(connection, firebaseToken);
    if (securitySection) {
      report.sections.security = securitySection;
    } else {
      onProgress('OAuth security metadata is unavailable; excluding it from scoring.');
    }

    onProgress('Confirming direct-browser MCP accessibility at the negotiated endpoint...');
    report.sections.cors = evaluateBrowserAccessibility(connection, Boolean(oauthToken));

    report.sections.performance = performanceSection(durationMs);
    report.finalScore = Object.entries(report.sections)
      .filter(([key]) => key !== 'auth')
      .reduce((total, [, section]) => total + section.score, 0);

    onProgress('Evaluation complete.');
    return report;
  } finally {
    try {
      await connection.client.close();
    } catch (error) {
      console.error('[Evaluation] Failed to close MCP client:', error);
    }
  }
}
