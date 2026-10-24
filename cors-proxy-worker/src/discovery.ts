// Discovery route for mcptest.io/tools/discovery.
//
// Browsers cannot read most discovery documents cross-origin, so the checker
// falls back to this route. It is deliberately not a proxy: it only GETs the
// MCP and OAuth discovery documents and the official registry's search API,
// over public HTTPS on the default port, forwards no credentials or cookies,
// re-checks every redirect hop against the same policy, and caps the response
// size and the time spent upstream.

export const DISCOVERY_PATH = '/discovery';
export const DISCOVERY_MAX_RESPONSE_BYTES = 256 * 1024;
export const DISCOVERY_TIMEOUT_MS = 8000;
export const DISCOVERY_MAX_REDIRECTS = 3;
export const DISCOVERY_FINAL_URL_HEADER = 'X-MCP-Discovery-Final-Url';
const PROXY_RESPONSE_SOURCE_HEADER = 'X-MCP-Proxy-Response-Source';

export const MCP_REGISTRY_ORIGIN = 'https://registry.modelcontextprotocol.io';
const REGISTRY_PATHS = new Set(['/v0/servers', '/v0.1/servers']);
const REGISTRY_QUERY_KEYS = new Set(['search', 'version', 'limit', 'cursor', 'updated_since']);

/** Domain-root documents, matched exactly. */
const WELL_KNOWN_DOCUMENTS = new Set([
  '/.well-known/mcp/server-card.json',
  '/.well-known/mcp/server-cards.json',
  '/.well-known/mcp-server-card',
  '/.well-known/mcp.json',
  '/.well-known/ai-catalog.json',
]);
/** OAuth metadata, at the root or with the RFC 9728 / RFC 8414 path suffix. */
const WELL_KNOWN_METADATA_PREFIXES = [
  '/.well-known/oauth-protected-resource',
  '/.well-known/oauth-authorization-server',
  '/.well-known/openid-configuration',
];
/** OpenID Connect issuers with a path publish below it (OIDC Discovery 1.0 §4). */
const OIDC_SUFFIX = '/.well-known/openid-configuration';
/** SEP-2127 reserves `GET <streamable-http-url>/server-card`. */
const SERVER_CARD_SUFFIX = '/server-card';

const ACCEPT_PATTERN = /^[\w.+\-/*]+(?:\s*;\s*q=[0-9.]+)?(?:\s*,\s*[\w.+\-/*]+(?:\s*;\s*q=[0-9.]+)?)*$/;
const PROTOCOL_VERSION_PATTERN = /^[A-Za-z0-9.-]{1,32}$/;
const CONTENT_TYPE_PATTERN = /^[\w.+-]+\/[\w.+-]+(?:\s*;\s*[\w-]+=[\w."-]+)*$/;
const MAX_PATH_LENGTH = 512;

export interface DiscoveryRouteDependencies {
  /** The worker's private-network hostname check. */
  isForbiddenHostname: (hostname: string) => boolean;
  /** Identifies the caller and applies its request allowance; a refusal carries the response to send. */
  admitCaller: (request: Request) => Promise<{ admitted: true } | { admitted: false; response: Response }>;
  fetchImpl?: typeof fetch;
  timeoutMs?: number;
}

const matchesPrefix = (pathname: string, prefix: string): boolean => (
  pathname === prefix || pathname.startsWith(`${prefix}/`)
);

/** Whether the route may fetch `target`. Exported for tests. */
export const isAllowedDiscoveryTarget = (
  target: URL,
  isForbiddenHostname: (hostname: string) => boolean
): boolean => {
  if (target.protocol !== 'https:' || target.port || target.username || target.password || target.hash) return false;
  if (isForbiddenHostname(target.hostname)) return false;
  const { pathname } = target;
  if (pathname.length > MAX_PATH_LENGTH || pathname.includes('//') || /%2f|%5c|\\/i.test(pathname)) return false;
  const segments = pathname.split('/');
  if (segments.some(segment => segment === '..' || segment === '.')) return false;

  if (target.origin === MCP_REGISTRY_ORIGIN) {
    return REGISTRY_PATHS.has(pathname)
      && [...target.searchParams.keys()].every(key => REGISTRY_QUERY_KEYS.has(key));
  }
  if (target.search) return false;
  if (WELL_KNOWN_DOCUMENTS.has(pathname)) return true;
  if (WELL_KNOWN_METADATA_PREFIXES.some(prefix => matchesPrefix(pathname, prefix))) return true;
  if (pathname.endsWith(OIDC_SUFFIX)) return true;
  return pathname.endsWith(SERVER_CARD_SUFFIX) && pathname.length > SERVER_CARD_SUFFIX.length;
};

const corsHeaders = (source: 'proxy' | 'target'): Record<string, string> => ({
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Methods': 'GET, OPTIONS',
  'Access-Control-Allow-Headers': 'Accept, Authorization, MCP-Protocol-Version',
  'Access-Control-Expose-Headers': [
    PROXY_RESPONSE_SOURCE_HEADER,
    DISCOVERY_FINAL_URL_HEADER,
    'X-MCP-Proxy-Limit',
    'X-MCP-Proxy-Limit-Kind',
    'Retry-After',
  ].join(', '),
  [PROXY_RESPONSE_SOURCE_HEADER]: source,
  'Cache-Control': 'no-store',
});

const refusal = (status: number, error: string, message: string): Response => new Response(
  JSON.stringify({ error, message }),
  { status, headers: { ...corsHeaders('proxy'), 'Content-Type': 'application/json' } }
);

const readBounded = async (response: Response, maximumBytes: number): Promise<Uint8Array<ArrayBuffer> | undefined> => {
  const declared = Number(response.headers.get('Content-Length'));
  if (Number.isFinite(declared) && declared > maximumBytes) {
    await response.body?.cancel().catch(() => {});
    return undefined;
  }
  if (!response.body) return new Uint8Array();
  const reader = response.body.getReader();
  const chunks: Uint8Array[] = [];
  let length = 0;
  while (true) {
    const { done, value } = await reader.read();
    if (done) break;
    length += value.byteLength;
    if (length > maximumBytes) {
      await reader.cancel().catch(() => {});
      return undefined;
    }
    chunks.push(value);
  }
  const bytes = new Uint8Array(length);
  let offset = 0;
  for (const chunk of chunks) {
    bytes.set(chunk, offset);
    offset += chunk.byteLength;
  }
  return bytes;
};

const REDIRECT_STATUSES = new Set([301, 302, 303, 307, 308]);
const NULL_BODY_STATUSES = new Set([101, 204, 205, 304]);

export async function handleDiscoveryRequest(
  request: Request,
  dependencies: DiscoveryRouteDependencies
): Promise<Response> {
  if (request.method === 'OPTIONS') {
    return new Response(null, {
      status: 204,
      headers: { ...corsHeaders('proxy'), 'Access-Control-Max-Age': '86400' },
    });
  }
  if (request.method !== 'GET') {
    return refusal(405, 'method_not_allowed', 'The discovery route only answers GET.');
  }

  const targetValue = new URL(request.url).searchParams.get('target');
  let target: URL;
  try {
    target = new URL(targetValue ?? '');
  } catch {
    return refusal(400, 'invalid_target', 'The "target" query parameter must be an absolute URL.');
  }
  if (!isAllowedDiscoveryTarget(target, dependencies.isForbiddenHostname)) {
    return refusal(403, 'target_not_allowed', 'The discovery route only fetches MCP discovery documents (.well-known paths, <endpoint>/server-card and the MCP Registry API) over public HTTPS.');
  }

  const admission = await dependencies.admitCaller(request);
  if ('response' in admission) return admission.response;

  const accept = request.headers.get('Accept') ?? '';
  const protocolVersion = request.headers.get('MCP-Protocol-Version') ?? '';
  const upstreamHeaders = new Headers({
    Accept: accept && accept.length <= 256 && ACCEPT_PATTERN.test(accept) ? accept : 'application/json',
    'User-Agent': 'mcptest.io discovery checker (+https://mcptest.io/tools/discovery)',
  });
  if (PROTOCOL_VERSION_PATTERN.test(protocolVersion)) upstreamHeaders.set('MCP-Protocol-Version', protocolVersion);

  const fetchImpl = dependencies.fetchImpl ?? fetch;
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), dependencies.timeoutMs ?? DISCOVERY_TIMEOUT_MS);
  try {
    let current = target;
    let response: Response;
    for (let hop = 0; ; hop++) {
      response = await fetchImpl(current.toString(), {
        method: 'GET',
        headers: upstreamHeaders,
        redirect: 'manual',
        signal: controller.signal,
      });
      const location = response.headers.get('Location');
      if (!REDIRECT_STATUSES.has(response.status) || !location) break;
      await response.body?.cancel().catch(() => {});
      let next: URL;
      try {
        next = new URL(location, current);
      } catch {
        return refusal(502, 'invalid_redirect', 'The target redirected to an invalid URL.');
      }
      if (hop >= DISCOVERY_MAX_REDIRECTS) {
        return refusal(502, 'too_many_redirects', `The target redirected more than ${DISCOVERY_MAX_REDIRECTS} times.`);
      }
      if (!isAllowedDiscoveryTarget(next, dependencies.isForbiddenHostname)) {
        return refusal(403, 'target_not_allowed', `The target redirected to ${next.origin}${next.pathname}, which is not a discovery document location.`);
      }
      current = next;
    }

    const body = NULL_BODY_STATUSES.has(response.status) ? new Uint8Array() : await readBounded(response, DISCOVERY_MAX_RESPONSE_BYTES);
    if (!body) {
      return refusal(502, 'too_large', `The document is larger than ${DISCOVERY_MAX_RESPONSE_BYTES} bytes.`);
    }
    const headers: Record<string, string> = {
      ...corsHeaders('target'),
      [DISCOVERY_FINAL_URL_HEADER]: current.toString(),
    };
    const contentType = response.headers.get('Content-Type');
    if (contentType && contentType.length <= 128 && CONTENT_TYPE_PATTERN.test(contentType.trim())) {
      headers['Content-Type'] = contentType.trim();
    }
    return new Response(NULL_BODY_STATUSES.has(response.status) ? null : body, {
      status: response.status,
      headers,
    });
  } catch (error) {
    if (controller.signal.aborted) {
      return refusal(504, 'timeout', 'The target did not answer in time.');
    }
    console.error('[Discovery] Upstream fetch failed.', error instanceof Error ? error.name : 'error');
    return refusal(502, 'upstream_unreachable', 'The target could not be reached.');
  } finally {
    clearTimeout(timer);
  }
}
