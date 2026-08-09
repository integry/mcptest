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
 * Builds connection candidates while preserving exact custom endpoints. For
 * proxy URLs, only the encoded target is varied; the proxy URL itself remains
 * untouched.
 */
export const getTransportCandidates = (serverUrl: string): TransportCandidate[] => {
  const outerUrl = new URL(serverUrl);
  const targetValue = outerUrl.searchParams.get('target');
  if (!targetValue) return directCandidates(outerUrl);

  const targetUrl = new URL(targetValue);
  return directCandidates(targetUrl).map((candidate) => {
    const proxyUrl = new URL(outerUrl);
    proxyUrl.searchParams.set('target', candidate.url);
    return { ...candidate, url: proxyUrl.toString() };
  });
};

export const getRequestHeadersForCandidate = (
  candidateUrl: string,
  requestHeaders?: HeadersInit
): Headers => {
  const headers = new Headers(requestHeaders);
  const candidate = new URL(candidateUrl);

  if (candidate.searchParams.has('target') && headers.has('Authorization')) {
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
    const errors: Error[] = [];
    let remaining = promises.length;

    for (const promise of promises) {
      promise.then(resolve).catch((error) => {
        errors.push(error instanceof Error ? error : new Error(String(error)));
        remaining -= 1;
        if (remaining === 0) {
          reject(new Error(
            `All connections failed: ${errors.map(({ message }) => message).join(', ')}`
          ));
        }
      });
    }
  });
};

const candidateGroupKey = (candidate: TransportCandidate): string => {
  const outerUrl = new URL(candidate.url);
  const targetValue = outerUrl.searchParams.get('target');
  const endpoint = targetValue ? new URL(targetValue) : outerUrl;
  endpoint.pathname = endpoint.pathname.replace(/\/+$/, '') || '/';

  return `${candidate.transportType}:${endpoint.toString()}`;
};

const groupCandidatesByPriority = (
  candidates: TransportCandidate[]
): TransportCandidate[][] => {
  const groups: TransportCandidate[][] = [];

  for (const candidate of candidates) {
    const currentGroup = groups[groups.length - 1];
    if (
      !currentGroup
      || candidateGroupKey(currentGroup[0]) !== candidateGroupKey(candidate)
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
  requestHeaders?: HeadersInit
): Promise<ConnectedCandidate & { protocolEra: ProtocolEra; protocolVersion?: string }> {
  const candidates = getTransportCandidates(serverUrl);
  const clients: Client[] = [];
  const transportOptionsFor = (candidateUrl: string) => {
    const headers = getRequestHeadersForCandidate(candidateUrl, requestHeaders);

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

    for (const candidateGroup of groupCandidatesByPriority(candidates)) {
      if (abortSignal?.aborted) {
        throw new Error('Connection aborted by user');
      }

      let successful: ConnectedCandidate;
      try {
        successful = await Promise.race([
          firstSuccessful(candidateGroup.map(attemptConnection)),
          abortPromise,
        ]);
      } catch (error) {
        if (abortSignal?.aborted) {
          throw new Error('Connection aborted by user');
        }
        failures.push(error instanceof Error ? error : new Error(String(error)));
        continue;
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

    throw new Error(
      `All connections failed: ${failures.map(({ message }) => (
        message.replace(/^All connections failed: /, '')
      )).join(', ')}`
    );
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
