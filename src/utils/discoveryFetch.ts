/**
 * The discovery checker's fetch in the browser: each document is read directly
 * first, so a missing CORS header shows up as one; when the browser cannot read
 * it, the request goes through the cors-proxy-worker's `/discovery` route,
 * which only GETs discovery documents (see cors-proxy-worker/src/discovery.ts).
 */
import {
  DiscoveryFetchError,
  type DiscoveryFetch,
  type DiscoveryResponse,
  type DiscoveryRoute,
} from './mcpDiscovery';

export const DISCOVERY_PROXY_PATH = '/discovery';
/** Mirrors the proxy route's cap; a discovery document is a few kilobytes. */
export const DISCOVERY_MAX_RESPONSE_BYTES = 256 * 1024;
export const DISCOVERY_TIMEOUT_MS = 8000;
const PROXY_RESPONSE_SOURCE_HEADER = 'X-MCP-Proxy-Response-Source';
const PROXY_FINAL_URL_HEADER = 'X-MCP-Discovery-Final-Url';

export interface DiscoveryFetchOptions {
  /** The cors-proxy-worker origin (VITE_PROXY_URL); without it only direct reads are made. */
  proxyUrl?: string;
  fetchImpl?: typeof fetch;
  timeoutMs?: number;
  maxBytes?: number;
}

const isLoopbackUrl = (url: string): boolean => {
  const { hostname } = new URL(url);
  return hostname === 'localhost' || hostname === '127.0.0.1' || hostname === '[::1]' || hostname.endsWith('.localhost');
};

const readBoundedText = async (response: Response, maxBytes: number, route: DiscoveryRoute): Promise<string> => {
  const declared = Number(response.headers.get('Content-Length'));
  if (Number.isFinite(declared) && declared > maxBytes) {
    await response.body?.cancel().catch(() => {});
    throw new DiscoveryFetchError('The response is too large.', 'too-large', route);
  }
  if (!response.body) return response.text();
  const reader = response.body.getReader();
  const chunks: Uint8Array[] = [];
  let length = 0;
  while (true) {
    const { done, value } = await reader.read();
    if (done) break;
    length += value.byteLength;
    if (length > maxBytes) {
      await reader.cancel().catch(() => {});
      throw new DiscoveryFetchError('The response is too large.', 'too-large', route);
    }
    chunks.push(value);
  }
  const bytes = new Uint8Array(length);
  let offset = 0;
  for (const chunk of chunks) {
    bytes.set(chunk, offset);
    offset += chunk.byteLength;
  }
  return new TextDecoder().decode(bytes);
};

const isAbort = (error: unknown): boolean => (
  error instanceof DOMException && (error.name === 'AbortError' || error.name === 'TimeoutError')
);

export const createDiscoveryFetch = ({
  proxyUrl,
  fetchImpl = (input, init) => fetch(input, init),
  timeoutMs = DISCOVERY_TIMEOUT_MS,
  maxBytes = DISCOVERY_MAX_RESPONSE_BYTES,
}: DiscoveryFetchOptions = {}): DiscoveryFetch => async (url, request = {}) => {
  const accept = request.accept ?? 'application/json';

  const attempt = async (route: DiscoveryRoute): Promise<DiscoveryResponse> => {
    const target = route === 'direct'
      ? url
      : `${proxyUrl!.replace(/\/+$/, '')}${DISCOVERY_PROXY_PATH}?target=${encodeURIComponent(url)}`;
    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), timeoutMs);
    try {
      const response = await fetchImpl(target, {
        method: 'GET',
        // Direct reads send only the CORS-safelisted Accept header, so a host
        // that answers simple requests is not reported as blocked because it
        // rejects a preflight for MCP-Protocol-Version.
        headers: route === 'direct' ? { Accept: accept } : { Accept: accept, ...request.headers },
        credentials: 'omit',
        cache: 'no-store',
        redirect: 'follow',
        signal: controller.signal,
      });
      if (route === 'proxy' && response.headers.get(PROXY_RESPONSE_SOURCE_HEADER) === 'proxy') {
        const reason = await response.json().catch(() => ({})) as { error?: string; message?: string };
        await response.body?.cancel().catch(() => {});
        const kind = response.status === 429
          ? 'proxy-limit'
          : response.status === 403 || response.status === 400 ? 'not-allowed'
            : response.status === 504 ? 'timeout'
              : reason.error === 'too_large' ? 'too-large' : 'network';
        throw new DiscoveryFetchError(reason.message ?? `The proxy answered HTTP ${response.status}.`, kind, 'proxy');
      }
      const body = await readBoundedText(response, maxBytes, route);
      return {
        url: (route === 'proxy' ? response.headers.get(PROXY_FINAL_URL_HEADER) : response.url) || url,
        status: response.status,
        wwwAuthenticate: response.headers.get('WWW-Authenticate') ?? undefined,
        contentType: response.headers.get('Content-Type') ?? undefined,
        body,
        route,
      };
    } catch (error) {
      if (error instanceof DiscoveryFetchError) throw error;
      if (isAbort(error)) throw new DiscoveryFetchError('Timed out.', 'timeout', route);
      throw new DiscoveryFetchError(error instanceof Error ? error.message : 'Failed to fetch', route === 'direct' ? 'cors' : 'network', route);
    } finally {
      clearTimeout(timer);
    }
  };

  try {
    return await attempt('direct');
  } catch (error) {
    // A loopback host is only reachable from this machine, never from the proxy.
    const canUseProxy = Boolean(proxyUrl) && !isLoopbackUrl(url);
    if (!(error instanceof DiscoveryFetchError) || error.kind !== 'cors' || !canUseProxy) throw error;
  }
  return attempt('proxy');
};

/** An unauthenticated MCP initialize request, bounded like metadata reads.
 * It stays direct: the discovery proxy only permits GETs of discovery documents.
 */
export const createOAuthChallengeProbe = (): DiscoveryFetch => createDiscoveryFetch({
  fetchImpl: (url, init) => fetch(url, {
    ...init,
    method: 'POST',
    headers: { Accept: 'application/json, text/event-stream', 'Content-Type': 'application/json' },
    body: JSON.stringify({ jsonrpc: '2.0', id: 1, method: 'initialize', params: {
      protocolVersion: '2026-07-28', capabilities: {},
      clientInfo: { name: 'mcptest-oauth-checker', version: '1.0.0' },
    } }),
  }),
});
