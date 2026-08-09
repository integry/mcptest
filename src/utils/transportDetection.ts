import type { Client, ProtocolEra } from '@modelcontextprotocol/client';
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

export class TransportConnectionError extends Error {
  constructor(readonly errors: readonly unknown[]) {
    super(`All connections failed: ${errors.map((error) => (
      (error instanceof Error ? error.message : String(error))
        .replace(/^All connections failed: /, '')
    )).join(', ')}`);
    this.name = 'TransportConnectionError';
  }
}

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
};

const firstSuccessful = <T,>(promises: Promise<T>[]): Promise<T> => {
  return new Promise((resolve, reject) => {
    const errors: unknown[] = [];
    let remaining = promises.length;

    for (const promise of promises) {
      promise.then(resolve).catch((error) => {
        errors.push(error);
        remaining -= 1;
        if (remaining === 0) {
          reject(new TransportConnectionError(errors));
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
  endpoint.pathname = endpoint.pathname.replace(/\/+$/, '') || '/';

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
  usesProxy = false
): Promise<ConnectedCandidate & { protocolEra: ProtocolEra; protocolVersion?: string }> {
  const candidates = getTransportCandidates(serverUrl, usesProxy);
  const clients: Client[] = [];
  const transportOptionsFor = (candidateUrl: string) => {
    const headers = getRequestHeadersForCandidate(candidateUrl, requestHeaders, usesProxy);

    return {
      ...(authToken ? { authProvider: { token: async () => authToken } } : {}),
      ...(Array.from(headers.keys()).length > 0 ? { headers } : {}),
    };
  };

  if (abortSignal?.aborted) {
    throw new Error('Connection aborted by user');
  }

  console.log('[Parallel Connection] Trying publisher endpoint candidates:', candidates);

  const attemptConnection = async (
    candidate: TransportCandidate
  ): Promise<ConnectedCandidate> => {
    const client = candidate.transportType === 'legacy-sse'
      ? createLegacyMcpClient('mcptest-web')
      : createNegotiatingMcpClient('mcptest-web');
    clients.push(client);
    const endpoint = new URL(candidate.url);
    const transportOpts = transportOptionsFor(candidate.url);
    const transport = candidate.transportType === 'legacy-sse'
      ? new CorsAwareSSETransport(endpoint, transportOpts)
      : new CorsAwareStreamableHTTPTransport(endpoint, transportOpts);

    await client.connect(transport);
    return { ...candidate, client, transport };
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
      let groupTimeoutId: ReturnType<typeof setTimeout> | undefined;
      const groupTimeout = new Promise<never>((_, reject) => {
        groupTimeoutId = setTimeout(() => {
          reject(new Error(
            `Connection candidates timed out after ${CANDIDATE_GROUP_TIMEOUT_MS / 1000} seconds`
          ));
        }, CANDIDATE_GROUP_TIMEOUT_MS);
      });
      try {
        successful = await Promise.race([
          firstSuccessful(candidateGroup.map(attemptConnection)),
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
