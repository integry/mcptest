/**
 * The mcptest CORS proxy is usable without signing in. It limits callers
 * instead: anonymous callers per IP, signed-in callers per account. When a
 * limit is hit it answers with its own HTTP 429 carrying this marker header,
 * which distinguishes "sign in to lift the limit" from a target's own 429.
 */
export const PROXY_LIMIT_HEADER = 'X-MCP-Proxy-Limit';

export type ProxyCallerTier = 'anonymous' | 'signed-in';

export interface ProxyCallerLimit {
  tier: ProxyCallerTier;
  retryAfterSeconds?: number;
}

export const readProxyCallerLimit = (
  response: Pick<Response, 'status' | 'headers'>
): ProxyCallerLimit | undefined => {
  if (response.status !== 429) return undefined;
  const tier = response.headers.get(PROXY_LIMIT_HEADER)?.trim().toLowerCase();
  if (tier !== 'anonymous' && tier !== 'signed-in') return undefined;
  const retryAfter = Number(response.headers.get('Retry-After'));
  return {
    tier,
    ...(Number.isFinite(retryAfter) && retryAfter > 0 ? { retryAfterSeconds: retryAfter } : {}),
  };
};

export const proxyCallerLimitMessage = (limit: ProxyCallerLimit): string => {
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
