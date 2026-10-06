/**
 * The mcptest CORS proxy is usable without signing in. It limits callers
 * instead: anonymous callers per IP, signed-in callers per account. When a
 * limit is hit it answers with its own HTTP 429 carrying this marker header,
 * which distinguishes "sign in to lift the limit" from a target's own 429.
 */
export const PROXY_LIMIT_HEADER = 'X-MCP-Proxy-Limit';
/** Which limit a proxy-owned 429 reports. */
export const PROXY_LIMIT_KIND_HEADER = 'X-MCP-Proxy-Limit-Kind';
/**
 * Anonymous proxied responses can be cut off mid-body at a byte or lifetime
 * cap. The proxy then appends `PROXY_LIMIT_TRAILER_PREFIX + token + "\n" +
 * JSON reason` (the token comes from this header) and closes the stream, since
 * an errored stream would reach the browser only as a network failure.
 */
export const PROXY_LIMIT_SIGNAL_HEADER = 'X-MCP-Proxy-Limit-Signal';
export const PROXY_LIMIT_TRAILER_PREFIX = '\u0000mcptest-proxy-limit:';
const MAX_PROXY_LIMIT_TRAILER_BYTES = 4096;

export type ProxyCallerTier = 'anonymous' | 'signed-in';

export type ProxyCallerLimitKind = 'requests' | 'request_bytes' | 'response_bytes' | 'stream_duration';

const PROXY_CALLER_LIMIT_KINDS: readonly ProxyCallerLimitKind[] = [
  'requests',
  'request_bytes',
  'response_bytes',
  'stream_duration',
];

export interface ProxyCallerLimit {
  tier: ProxyCallerTier;
  kind?: ProxyCallerLimitKind;
  retryAfterSeconds?: number;
}

const readLimitKind = (value: unknown): ProxyCallerLimitKind | undefined => {
  const kind = typeof value === 'string' ? value.trim().toLowerCase() : undefined;
  return PROXY_CALLER_LIMIT_KINDS.find((candidate) => candidate === kind);
};

export const readProxyCallerLimit = (
  response: Pick<Response, 'status' | 'headers'>
): ProxyCallerLimit | undefined => {
  if (response.status !== 429) return undefined;
  const tier = response.headers.get(PROXY_LIMIT_HEADER)?.trim().toLowerCase();
  if (tier !== 'anonymous' && tier !== 'signed-in') return undefined;
  const retryAfter = Number(response.headers.get('Retry-After'));
  const kind = readLimitKind(response.headers.get(PROXY_LIMIT_KIND_HEADER));
  return {
    tier,
    ...(kind ? { kind } : {}),
    ...(Number.isFinite(retryAfter) && retryAfter > 0 ? { retryAfterSeconds: retryAfter } : {}),
  };
};

const PROXY_SIZE_LIMIT_DESCRIPTIONS: Partial<Record<ProxyCallerLimitKind, string>> = {
  request_bytes: 'Anonymous mcptest proxy request bodies are size-limited.',
  response_bytes: 'Anonymous mcptest proxy responses are size-limited, so this response was cut off.',
  stream_duration: 'Anonymous mcptest proxy streams are time-limited, so this stream was ended.',
};

export const proxyCallerLimitMessage = (limit: ProxyCallerLimit): string => {
  const sizeLimit = limit.kind && PROXY_SIZE_LIMIT_DESCRIPTIONS[limit.kind];
  if (sizeLimit && limit.tier === 'anonymous') {
    return `${sizeLimit} Sign in with Google to lift the limit. This is an mcptest proxy limit, not an MCP server error.`;
  }
  const retry = limit.retryAfterSeconds
    ? ` Retry in about ${limit.retryAfterSeconds} seconds`
    : ' Retry shortly';
  return limit.tier === 'anonymous'
    ? `Anonymous mcptest proxy limit reached. Sign in with Google to lift the limit.${retry} to continue without signing in. This is an mcptest proxy limit, not an MCP server error.`
    : `mcptest proxy limit reached for your account.${retry}. This is an mcptest proxy limit, not an MCP server error.`;
};

export class ProxyCallerLimitError extends Error {
  constructor(readonly limit: ProxyCallerLimit) {
    super(proxyCallerLimitMessage(limit));
    this.name = 'ProxyCallerLimitError';
  }
}

/** Finds a proxy caller limit thrown anywhere in an error's cause chain. */
export const findProxyCallerLimitError = (
  error: unknown,
  seen = new Set<object>()
): ProxyCallerLimitError | undefined => {
  if (!error || typeof error !== 'object' || seen.has(error)) return undefined;
  seen.add(error);
  if (error instanceof ProxyCallerLimitError) return error;
  const value = error as { errors?: readonly unknown[]; cause?: unknown };
  for (const nested of Array.isArray(value.errors) ? value.errors : []) {
    const found = findProxyCallerLimitError(nested, seen);
    if (found) return found;
  }
  return findProxyCallerLimitError(value.cause, seen);
};

const indexOfBytes = (haystack: Uint8Array, needle: Uint8Array): number => {
  outer: for (let index = 0; index <= haystack.length - needle.length; index += 1) {
    for (let offset = 0; offset < needle.length; offset += 1) {
      if (haystack[index + offset] !== needle[offset]) continue outer;
    }
    return index;
  }
  return -1;
};

/** Length of the longest suffix of `data` that is a proper prefix of `marker`. */
const partialMarkerSuffixLength = (data: Uint8Array, marker: Uint8Array): number => {
  for (let length = Math.min(data.length, marker.length - 1); length > 0; length -= 1) {
    let matches = true;
    for (let offset = 0; offset < length; offset += 1) {
      if (data[data.length - length + offset] !== marker[offset]) {
        matches = false;
        break;
      }
    }
    if (matches) return length;
  }
  return 0;
};

const concatBytes = (left: Uint8Array, right: Uint8Array): Uint8Array => {
  if (left.length === 0) return right;
  const combined = new Uint8Array(left.length + right.length);
  combined.set(left);
  combined.set(right, left.length);
  return combined;
};

const parseTrailerLimit = (trailer: Uint8Array): ProxyCallerLimit => {
  try {
    const reason = JSON.parse(new TextDecoder().decode(trailer)) as { tier?: unknown; limit?: unknown };
    const kind = readLimitKind(reason.limit);
    return {
      tier: reason.tier === 'signed-in' ? 'signed-in' : 'anonymous',
      ...(kind ? { kind } : {}),
    };
  } catch {
    return { tier: 'anonymous' };
  }
};

/**
 * Translates the proxy's in-band limit trailer into a ProxyCallerLimitError.
 * Body bytes before the trailer are passed through as they arrive, so SSE
 * stays incremental; only a chunk tail that could begin the NUL-prefixed
 * marker is held back until the next chunk disambiguates it. Responses without
 * the signal header are returned unchanged.
 */
export const decodeProxyLimitSignal = (
  response: Response,
  onLimit?: (limit: ProxyCallerLimit) => void
): Response => {
  const token = response.headers.get(PROXY_LIMIT_SIGNAL_HEADER);
  if (!token || !response.body) return response;
  const marker = new TextEncoder().encode(`${PROXY_LIMIT_TRAILER_PREFIX}${token}\n`);
  const reader = response.body.getReader();
  let pending: Uint8Array = new Uint8Array(0);
  let trailer: Uint8Array | undefined;

  const body = new ReadableStream<Uint8Array>({
    async pull(controller) {
      for (;;) {
        const { done, value } = await reader.read();
        if (done) {
          if (trailer) {
            const limit = parseTrailerLimit(trailer);
            onLimit?.(limit);
            controller.error(new ProxyCallerLimitError(limit));
            return;
          }
          if (pending.length) controller.enqueue(pending);
          controller.close();
          return;
        }
        if (trailer) {
          if (trailer.length < MAX_PROXY_LIMIT_TRAILER_BYTES) trailer = concatBytes(trailer, value);
          continue;
        }
        const data = concatBytes(pending, value);
        const markerAt = indexOfBytes(data, marker);
        if (markerAt >= 0) {
          if (markerAt > 0) controller.enqueue(data.subarray(0, markerAt));
          pending = new Uint8Array(0);
          trailer = data.slice(markerAt + marker.length);
          continue;
        }
        const held = partialMarkerSuffixLength(data, marker);
        pending = data.slice(data.length - held);
        if (data.length > held) {
          controller.enqueue(data.subarray(0, data.length - held));
          return;
        }
      }
    },
    cancel(reason) {
      return reader.cancel(reason);
    },
  });

  const decoded = new Response(body, {
    status: response.status,
    statusText: response.statusText,
    headers: response.headers,
  });
  // Response construction drops the fetched URL; transports resolve relative
  // endpoints against it.
  Object.defineProperty(decoded, 'url', { value: response.url });
  Object.defineProperty(decoded, 'redirected', { value: response.redirected });
  return decoded;
};
