// CORS Proxy Worker with caller-based limits
// This worker provides a CORS proxy that anyone can use without signing in.
// It never judges the target; instead it governs the caller. Anonymous callers
// are rate limited by client IP and have their streamed responses capped, while
// a valid Firebase login lifts those limits to a generous per-user allowance.

export interface Env {
  FIREBASE_PROJECT_ID: string;
  /** Server-only operator OAuth configuration. Set these with `wrangler secret put`. */
  FIGMA_OAUTH_CLIENT_ID?: string;
  FIGMA_OAUTH_CLIENT_SECRET?: string;
  SLACK_OAUTH_CLIENT_ID?: string;
  SLACK_OAUTH_CLIENT_SECRET?: string;
  GITHUB_OAUTH_CLIENT_ID?: string;
  GITHUB_OAUTH_CLIENT_SECRET?: string;
  /**
   * Cloudflare Rate Limiting bindings (see wrangler.toml). Optional so local
   * development and tests without the bindings still work; the Worker fails
   * open with a log line when a binding is absent.
   */
  ANON_RATE_LIMITER?: RateLimiter;
  USER_RATE_LIMITER?: RateLimiter;
}

/** Shape of Cloudflare's native Rate Limiting binding. */
export interface RateLimiter {
  limit(options: { key: string }): Promise<{ success: boolean }>;
}

/**
 * Keep this export while Cloudflare has Durable Objects registered under this
 * script name. Removing an exported Durable Object class without an explicit
 * migration causes every subsequent version upload to fail. This compatibility
 * implementation intentionally leaves existing object storage untouched and
 * fails closed if an old binding routes a request to it.
 */
export class HostedOAuthBroker {
  async fetch(): Promise<Response> {
    return new Response('Hosted OAuth broker is unavailable in this Worker version.', {
      status: 503,
      headers: { 'Cache-Control': 'no-store' },
    });
  }
}

export type OperatorOAuthProvider = 'figma' | 'slack' | 'github';

export interface OperatorOAuthClient {
  clientId: string;
  clientSecret: string;
}

/**
 * Server-only configuration seam for approved/fixed provider applications.
 * Callers must keep the returned object inside the Worker and perform any
 * confidential token exchange there. It must never be serialized to a browser
 * response, URL, report, artifact, or log.
 */
export function getOperatorOAuthClient(
  env: Env,
  provider: OperatorOAuthProvider
): OperatorOAuthClient | undefined {
  const prefix = provider.toUpperCase() as Uppercase<OperatorOAuthProvider>;
  const clientId = env[`${prefix}_OAUTH_CLIENT_ID` as keyof Env];
  const clientSecret = env[`${prefix}_OAUTH_CLIENT_SECRET` as keyof Env];
  return typeof clientId === 'string' && clientId && typeof clientSecret === 'string' && clientSecret
    ? { clientId, clientSecret }
    : undefined;
}

const REDIRECT_STATUSES = new Set([301, 302, 303, 307, 308]);
const MAX_TARGET_REDIRECTS = 20;
export const PROXY_RESPONSE_SOURCE_HEADER = 'X-MCP-Proxy-Response-Source';
export const OAUTH_RELAY_FAILURE_HEADER = 'X-MCP-OAuth-Relay-Failure';
/** Marks a proxy-owned caller-limit 429; the value is the caller tier. */
export const PROXY_LIMIT_HEADER = 'X-MCP-Proxy-Limit';
/**
 * Present on anonymous proxied target responses. Its value is a per-response
 * token; when the proxy cuts the body off at a caller limit it appends
 * `PROXY_LIMIT_TRAILER_PREFIX + token + "\n" + JSON reason` and closes the
 * stream, so the browser can tell a proxy limit from a dropped connection.
 */
/** On a proxy-owned caller-limit 429: which limit was hit. */
export const PROXY_LIMIT_KIND_HEADER = 'X-MCP-Proxy-Limit-Kind';
export const PROXY_LIMIT_SIGNAL_HEADER = 'X-MCP-Proxy-Limit-Signal';
export const PROXY_LIMIT_TRAILER_PREFIX = '\u0000mcptest-proxy-limit:';
const REQUIRED_CORS_REQUEST_HEADERS = [
  'Accept',
  'Authorization',
  'Content-Type',
  'Last-Event-ID',
  'MCP-Protocol-Version',
  'Mcp-Method',
  'Mcp-Name',
  'Mcp-Session-Id',
  'X-MCP-Authorization',
  'X-MCP-OAuth-Issuer',
  'X-MCP-OAuth-Resource',
  'X-MCP-OAuth-Client-Authorization',
  'X-MCP-OAuth-Registration-Endpoint',
  'X-MCP-OAuth-Token-Endpoint',
  'x-api-key',
];
const HTTP_HEADER_NAME_PATTERN = /^[!#$%&'*+\-.^_`|~0-9A-Za-z]+$/;

/**
 * Caller-based limits. These values are the proxy's spend cap on the ~$5/month
 * Workers Paid plan, so the proxy can stay open without a login wall while
 * remaining useless as a generic bulk tunnel:
 *
 * - Request rate (enforced by the Rate Limiting bindings in wrangler.toml, which
 *   must stay in sync with these documented values) bounds request count and
 *   CPU per caller. A full MCP handshake plus a few tool calls is ~10 requests,
 *   so 60/min is ample for interactive anonymous testing.
 * - Request rate alone does not bound bandwidth: one request can stream for
 *   hours. Anonymous responses are therefore cut off after a byte budget and a
 *   wall-clock lifetime, which bounds sustained bandwidth per request.
 *   Anonymous request bodies have their own byte budget so uploads are bounded
 *   before they reach the target, not only the (possibly tiny) response.
 *
 * Signing in lifts the limits: signed-in callers get a 10x request allowance
 * keyed by Firebase uid and no response size or duration cap.
 */
export const RATE_LIMIT_PERIOD_SECONDS = 60;
export const ANONYMOUS_REQUESTS_PER_PERIOD = 60;
export const SIGNED_IN_REQUESTS_PER_PERIOD = 600;
export const ANONYMOUS_MAX_RESPONSE_BYTES = 5 * 1024 * 1024;
export const ANONYMOUS_MAX_STREAM_DURATION_MS = 5 * 60 * 1000;
export const ANONYMOUS_MAX_REQUEST_BYTES = 1024 * 1024;

export type CallerTier = 'anonymous' | 'signed-in';

export interface ProxyCaller {
  tier: CallerTier;
  /** Rate-limit key: client IP for anonymous callers, Firebase uid when signed in. */
  key: string;
}

export interface ResponseBodyLimits {
  maxBytes?: number;
  maxDurationMs?: number;
  /** When set, a limit cut-off appends the signal trailer and closes cleanly. */
  signalToken?: string;
}

type CallerLimitKind = 'requests' | 'request_bytes' | 'response_bytes' | 'stream_duration';

/**
 * Identifies the caller from an optional Firebase bearer token. A missing token
 * is the anonymous tier; a present but invalid token returns null so the route
 * can answer 401 and the app can refresh the login instead of silently
 * downgrading to anonymous limits.
 */
export async function identifyCaller(
  request: Request,
  env: Env,
  verifyToken: (token: string, projectId: string) => Promise<string | null> = verifyFirebaseToken
): Promise<ProxyCaller | null> {
  const authorization = request.headers.get('Authorization');
  const firebaseToken = authorization?.startsWith('Bearer ')
    ? authorization.slice('Bearer '.length)
    : undefined;
  if (!firebaseToken) {
    return {
      tier: 'anonymous',
      key: `ip:${request.headers.get('CF-Connecting-IP') || 'unknown'}`,
    };
  }
  const uid = await verifyToken(firebaseToken, env.FIREBASE_PROJECT_ID);
  return uid ? { tier: 'signed-in', key: `uid:${uid}` } : null;
}

const missingRateLimiterWarnings = new Set<string>();

/** Returns true when the caller is within its request-rate allowance. */
export async function consumeCallerRateLimit(caller: ProxyCaller, env: Env): Promise<boolean> {
  const bindingName = caller.tier === 'anonymous' ? 'ANON_RATE_LIMITER' : 'USER_RATE_LIMITER';
  const limiter = env[bindingName];
  if (!limiter) {
    if (!missingRateLimiterWarnings.has(bindingName)) {
      missingRateLimiterWarnings.add(bindingName);
      console.warn(`[RateLimit] ${bindingName} binding is not configured; failing open.`);
    }
    return true;
  }
  try {
    return (await limiter.limit({ key: caller.key })).success;
  } catch (error) {
    console.error(`[RateLimit] ${bindingName} failed; failing open.`, error);
    return true;
  }
}

/**
 * Proxy-owned 429 that the app can tell apart from a target 429 through the
 * `X-MCP-Proxy-Limit` header and the JSON marker body.
 */
export function callerLimitResponse(
  caller: ProxyCaller,
  corsHeaders: Record<string, string>,
  limit: CallerLimitKind = 'requests'
): Response {
  const signInLiftsLimit = caller.tier === 'anonymous';
  const message = limit === 'requests'
    ? signInLiftsLimit
      ? `Anonymous mcptest proxy limit reached (${ANONYMOUS_REQUESTS_PER_PERIOD} requests per ${RATE_LIMIT_PERIOD_SECONDS}s). Sign in to lift the limit.`
      : `mcptest proxy limit reached (${SIGNED_IN_REQUESTS_PER_PERIOD} requests per ${RATE_LIMIT_PERIOD_SECONDS}s). Retry shortly.`
    : limit === 'request_bytes'
      ? `Anonymous mcptest proxy request bodies are limited to ${ANONYMOUS_MAX_REQUEST_BYTES} bytes. Sign in to lift the limit.`
      : `Anonymous mcptest proxy responses are limited to ${ANONYMOUS_MAX_RESPONSE_BYTES} bytes. Sign in to lift the limit.`;
  return new Response(JSON.stringify({
    error: 'rate_limited',
    tier: caller.tier,
    limit,
    signInLiftsLimit,
    message,
  }), {
    status: 429,
    headers: {
      ...corsHeaders,
      ...(limit === 'requests' ? { 'Retry-After': String(RATE_LIMIT_PERIOD_SECONDS) } : {}),
      'Cache-Control': 'no-store',
      'Content-Type': 'application/json',
      [PROXY_LIMIT_HEADER]: caller.tier,
      [PROXY_LIMIT_KIND_HEADER]: limit,
      [PROXY_RESPONSE_SOURCE_HEADER]: 'proxy',
    },
  });
}

/** Bytes the proxy appends to a body it cut off at an anonymous caller limit. */
export function proxyLimitTrailer(
  signalToken: string,
  limit: Extract<CallerLimitKind, 'response_bytes' | 'stream_duration'>,
  message: string
): Uint8Array {
  return new TextEncoder().encode(`${PROXY_LIMIT_TRAILER_PREFIX}${signalToken}\n${JSON.stringify({
    error: 'rate_limited',
    tier: 'anonymous',
    limit,
    signInLiftsLimit: true,
    message,
  })}`);
}

/**
 * Wraps a streamed body in a counting TransformStream that ends the stream
 * once the byte budget or lifetime is exceeded, which also cancels the
 * upstream fetch. With a signal token the cut-off is announced in-band through
 * the limit trailer (an errored stream reaches the browser only as an
 * anonymous network failure); without one the stream is errored.
 */
export function limitResponseBody(
  body: ReadableStream<Uint8Array>,
  { maxBytes, maxDurationMs, signalToken }: ResponseBodyLimits
): ReadableStream<Uint8Array> {
  let transferredBytes = 0;
  let timer: ReturnType<typeof setTimeout> | undefined;
  const stopTimer = () => {
    if (timer !== undefined) clearTimeout(timer);
    timer = undefined;
  };
  const cutOff = (
    controller: TransformStreamDefaultController<Uint8Array>,
    limit: 'response_bytes' | 'stream_duration',
    message: string
  ) => {
    stopTimer();
    if (signalToken === undefined) {
      controller.error(new Error(message));
      return;
    }
    controller.enqueue(proxyLimitTrailer(signalToken, limit, message));
    controller.terminate();
  };
  const { readable, writable } = new TransformStream<Uint8Array, Uint8Array>({
    start(controller) {
      if (maxDurationMs === undefined) return;
      timer = setTimeout(() => {
        timer = undefined;
        cutOff(
          controller,
          'stream_duration',
          `Anonymous mcptest proxy stream lifetime of ${maxDurationMs}ms exceeded. Sign in to lift the limit.`
        );
      }, maxDurationMs);
    },
    transform(chunk, controller) {
      transferredBytes += chunk.byteLength;
      if (maxBytes !== undefined && transferredBytes > maxBytes) {
        cutOff(
          controller,
          'response_bytes',
          `Anonymous mcptest proxy response limit of ${maxBytes} bytes exceeded. Sign in to lift the limit.`
        );
        return;
      }
      controller.enqueue(chunk);
    },
    flush() {
      stopTimer();
    },
  });
  body.pipeTo(writable).catch(() => {}).finally(stopTimer);
  return readable;
}

/** Thrown into an anonymous upload stream when it exceeds the request budget. */
class RequestBodyLimitExceeded extends Error {}

/**
 * Counts an anonymous request body as it is forwarded and errors it before
 * the chunk that would exceed the budget is sent, which aborts the upstream
 * fetch. `exceeded()` lets the route answer with a marked proxy limit.
 */
export function limitRequestBody(
  body: ReadableStream<Uint8Array>,
  maxBytes: number
): { body: ReadableStream<Uint8Array>; exceeded: () => boolean } {
  let forwardedBytes = 0;
  let exceeded = false;
  const { readable, writable } = new TransformStream<Uint8Array, Uint8Array>({
    transform(chunk, controller) {
      forwardedBytes += chunk.byteLength;
      if (forwardedBytes > maxBytes) {
        exceeded = true;
        controller.error(new RequestBodyLimitExceeded(
          `Anonymous mcptest proxy request body limit of ${maxBytes} bytes exceeded.`
        ));
        return;
      }
      controller.enqueue(chunk);
    },
  });
  body.pipeTo(writable).catch(() => {});
  return { body: readable, exceeded: () => exceeded };
}

type ProxyResponseSource = 'proxy' | 'target';

const HOSTED_ORIGIN = 'https://mcptest.io';
const HOSTED_OAUTH_CALLBACK = `${HOSTED_ORIGIN}/oauth/callback`;
const HOSTED_OAUTH_CLIENT_METADATA_URL = `${HOSTED_ORIGIN}/oauth/client-metadata.json`;
const OAUTH_TOKEN_PATH = '/oauth/token';
const OAUTH_REGISTER_PATH = '/oauth/register';
const OAUTH_OPERATOR_CLIENT_PATH = '/oauth/client';
const OAUTH_FORM_CONTENT_TYPE = 'application/x-www-form-urlencoded';
const OAUTH_JSON_CONTENT_TYPE = 'application/json';
const MAX_OAUTH_REGISTRATION_BYTES = 16 * 1024;
const MAX_OAUTH_RESPONSE_BYTES = 64 * 1024;
const MAX_OAUTH_METADATA_BYTES = 64 * 1024;
const MAX_DYNAMIC_CLIENT_ID_LENGTH = 2048;
const MAX_DYNAMIC_CLIENT_SECRET_LENGTH = 4096;
const CALENDLY_OAUTH_RESOURCE = 'https://mcp.calendly.com/';
const CALENDLY_OAUTH_ISSUER = 'https://calendly.com/';
const CALENDLY_OAUTH_REGISTRATION_ENDPOINT = 'https://calendly.com/oauth/register';
const MAX_CALENDLY_REGISTRATION_FIELD_ERRORS = 5;
const MAX_CALENDLY_REGISTRATION_FIELD_ERROR_LENGTH = 256;
// URLSearchParams can encode one UTF-16 code unit as three UTF-8 bytes, each
// represented by a three-character percent escape. Keep every credential that
// passes registration validation usable with either supported secret method.
const MAX_FORM_ENCODED_CHARS_PER_CODE_UNIT = 9;
const MAX_OAUTH_FORM_BYTES = 32 * 1024
  + (MAX_DYNAMIC_CLIENT_ID_LENGTH + MAX_DYNAMIC_CLIENT_SECRET_LENGTH)
    * MAX_FORM_ENCODED_CHARS_PER_CODE_UNIT
  + 'client_id=&client_secret='.length;
const MAX_DYNAMIC_CLIENT_BASIC_AUTHORIZATION_LENGTH = 'Basic '.length + 4 * Math.ceil((
  MAX_DYNAMIC_CLIENT_ID_LENGTH * MAX_FORM_ENCODED_CHARS_PER_CODE_UNIT
  + 1
  + MAX_DYNAMIC_CLIENT_SECRET_LENGTH * MAX_FORM_ENCODED_CHARS_PER_CODE_UNIT
) / 3);

type OAuthRouteDependencies = {
  /** Test seam for the runtime's global, strictly-public fetch primitive. */
  fetchImpl?: (request: Request) => Promise<Response>;
  verifyToken?: (token: string, projectId: string) => Promise<string | null>;
  /** Test seam; production also preflights DNS and rejects every non-public answer. */
  resolveHostname?: (hostname: string) => Promise<string[]>;
};

const oauthCorsHeaders = (
  request: Request,
  source: ProxyResponseSource = 'proxy'
): Record<string, string> => {
  const origin = request.headers.get('Origin');
  return {
    ...(origin === HOSTED_ORIGIN ? { 'Access-Control-Allow-Origin': HOSTED_ORIGIN } : {}),
    'Access-Control-Allow-Methods': 'POST, OPTIONS',
    'Access-Control-Allow-Headers': [
      'Accept',
      'Authorization',
      'Content-Type',
      'X-MCP-OAuth-Client-Authorization',
      'X-MCP-OAuth-Issuer',
      'X-MCP-OAuth-Resource',
      'X-MCP-OAuth-Registration-Endpoint',
      'X-MCP-OAuth-Token-Endpoint',
    ].join(', '),
    'Access-Control-Expose-Headers': [
      PROXY_RESPONSE_SOURCE_HEADER,
      OAUTH_RELAY_FAILURE_HEADER,
      PROXY_LIMIT_HEADER,
      PROXY_LIMIT_KIND_HEADER,
      'Retry-After',
    ].join(', '),
    'Cache-Control': 'no-store',
    'Vary': 'Origin',
    [PROXY_RESPONSE_SOURCE_HEADER]: source,
  };
};

const oauthRouteError = (
  request: Request,
  message: string,
  status: number
): Response => new Response(message, {
  status,
  headers: {
    ...oauthCorsHeaders(request, 'proxy'),
    'Content-Type': 'text/plain; charset=utf-8',
  },
});

const oauthRouteJsonError = (
  request: Request,
  error: string,
  description: string,
  status: number,
  source: ProxyResponseSource = 'proxy'
): Response => new Response(JSON.stringify({ error, error_description: description }), {
  status,
  headers: {
    ...oauthCorsHeaders(request, source),
    'Content-Type': OAUTH_JSON_CONTENT_TYPE,
  },
});

const OAUTH_REGISTRATION_FAILURES = {
  authorization_metadata_discovery: {
    logMessage: 'Authorization-server metadata discovery failed.',
    responseMessage: 'Error: OAuth registration issuer discovery failed. Verify that the issuer publishes reachable OAuth metadata and retry.',
  },
  destination_validation: {
    logMessage: 'The advertised registration destination failed validation.',
    responseMessage: 'Error: OAuth registration destination validation failed. The advertised endpoint did not pass public HTTPS and issuer-binding checks.',
  },
  dns_safety_validation: {
    logMessage: 'Optional destination DNS safety validation failed.',
    responseMessage: 'Error: OAuth registration DNS safety validation failed. The issuer or advertised endpoint did not resolve exclusively to public addresses.',
  },
  outbound_fetch: {
    logMessage: 'The outbound registration request failed before an HTTP response.',
    responseMessage: 'Error: OAuth registration could not reach the provider registration endpoint. Retry the provider request.',
  },
  response_validation: {
    logMessage: 'The registration endpoint returned an invalid response.',
    responseMessage: 'Error: OAuth registration provider response validation failed. The provider returned an unsupported or malformed response.',
  },
} as const;

type OAuthRegistrationFailureStage = keyof typeof OAUTH_REGISTRATION_FAILURES;

class OAuthDnsSafetyValidationError extends Error {
  constructor() {
    super('OAuth destination DNS safety validation failed');
    this.name = 'OAuthDnsSafetyValidationError';
  }
}

const safeErrorClass = (error: unknown): string => {
  if (error instanceof OAuthDnsSafetyValidationError) return 'DnsSafetyValidationError';
  if (error instanceof RangeError) return 'RangeError';
  if (error instanceof TypeError) return 'TypeError';
  if (error instanceof SyntaxError) return 'SyntaxError';
  if (error instanceof Error) return 'Error';
  return 'UnknownError';
};

const oauthRegistrationFailure = (
  request: Request,
  stage: OAuthRegistrationFailureStage,
  error: unknown
): Response => {
  const diagnostic = OAUTH_REGISTRATION_FAILURES[stage];
  // Keep every logged field selected from a closed set. In particular, never
  // serialize the caught exception: fetch implementations and providers may put
  // endpoint details or credential-bearing response fragments in its message.
  console.error('[OAuth registration relay failure]', {
    stage,
    errorClass: safeErrorClass(error),
    message: diagnostic.logMessage,
  });
  return oauthRouteError(request, diagnostic.responseMessage, 502);
};

const parseIpv4 = (hostname: string): number[] | undefined => {
  const parts = hostname.split('.');
  if (parts.length !== 4 || parts.some(part => !/^\d+$/.test(part))) return undefined;
  const octets = parts.map(Number);
  return octets.every(part => part >= 0 && part <= 255) ? octets : undefined;
};

const ipv4ToNumber = (octets: number[]): number => (
  (((octets[0] * 256 + octets[1]) * 256 + octets[2]) * 256) + octets[3]
);

const ipv4IsInCidr = (octets: number[], network: number[], prefixLength: number): boolean => {
  const divisor = 2 ** (32 - prefixLength);
  return Math.floor(ipv4ToNumber(octets) / divisor) === Math.floor(ipv4ToNumber(network) / divisor);
};

const isForbiddenIpv4 = (octets: number[]): boolean => [
  [[0, 0, 0, 0], 8],
  [[10, 0, 0, 0], 8],
  [[100, 64, 0, 0], 10],
  [[127, 0, 0, 0], 8],
  [[169, 254, 0, 0], 16],
  [[172, 16, 0, 0], 12],
  [[192, 0, 0, 0], 24],
  [[192, 0, 2, 0], 24],
  [[192, 88, 99, 0], 24],
  [[192, 168, 0, 0], 16],
  [[198, 18, 0, 0], 15],
  [[198, 51, 100, 0], 24],
  [[203, 0, 113, 0], 24],
  [[224, 0, 0, 0], 4],
  [[240, 0, 0, 0], 4],
].some(([network, prefixLength]) => {
  // These two anycast services are the globally reachable exceptions in 192.0.0.0/24.
  if (octets[0] === 192 && octets[1] === 0 && octets[2] === 0 && (octets[3] === 9 || octets[3] === 10)) {
    return false;
  }
  return ipv4IsInCidr(octets, network as number[], prefixLength as number);
});

const parseIpv6 = (hostname: string): number[] | undefined => {
  const address = hostname.replace(/^\[|\]$/g, '');
  if (!address.includes(':')) return undefined;
  const halves = address.split('::');
  if (halves.length > 2) return undefined;
  const leading = halves[0] ? halves[0].split(':') : [];
  const trailing = halves.length === 2 && halves[1] ? halves[1].split(':') : [];
  const omittedCount = 8 - leading.length - trailing.length;
  if ((halves.length === 1 && omittedCount !== 0) || omittedCount < (halves.length === 2 ? 1 : 0)) {
    return undefined;
  }
  const groups = [
    ...leading,
    ...Array.from({ length: omittedCount }, () => '0'),
    ...trailing,
  ];
  if (groups.length !== 8 || groups.some(group => !/^[0-9a-f]{1,4}$/i.test(group))) {
    return undefined;
  }
  return groups.map(group => parseInt(group, 16));
};

const ipv6IsInCidr = (groups: number[], network: number[], prefixLength: number): boolean => {
  const completeGroups = Math.floor(prefixLength / 16);
  for (let index = 0; index < completeGroups; index += 1) {
    if (groups[index] !== network[index]) return false;
  }
  const remainingBits = prefixLength % 16;
  if (remainingBits === 0) return true;
  const mask = (0xffff << (16 - remainingBits)) & 0xffff;
  return (groups[completeGroups] & mask) === (network[completeGroups] & mask);
};

const isForbiddenIpv6 = (groups: number[]): boolean => {
  // IPv4-mapped IPv6 literals are normalized by URL to hexadecimal groups.
  // Classify their embedded address exactly as an IPv4 literal.
  if (ipv6IsInCidr(groups, [0, 0, 0, 0, 0, 0xffff, 0, 0], 96)) {
    return isForbiddenIpv4([
      groups[6] >> 8,
      groups[6] & 0xff,
      groups[7] >> 8,
      groups[7] & 0xff,
    ]);
  }
  if (ipv6IsInCidr(groups, [0x64, 0xff9b, 0, 0, 0, 0, 0, 0], 96)) {
    return isForbiddenIpv4([
      groups[6] >> 8,
      groups[6] & 0xff,
      groups[7] >> 8,
      groups[7] & 0xff,
    ]);
  }

  // IPv6 global unicast space is currently allocated from 2000::/3. Default
  // every other native IPv6 literal to forbidden instead of relying on an
  // inevitably incomplete list of reserved and special-purpose ranges.
  if (!ipv6IsInCidr(groups, [0x2000, 0, 0, 0, 0, 0, 0, 0], 3)) return true;

  // IANA reserves 2001::/23 for protocol assignments and marks the parent
  // range non-global unless a more-specific allocation says otherwise.
  if (ipv6IsInCidr(groups, [0x2001, 0, 0, 0, 0, 0, 0, 0], 23)) {
    const globallyReachableExceptions = [
      [[0x2001, 1, 0, 0, 0, 0, 0, 1], 128], // PCP anycast.
      [[0x2001, 1, 0, 0, 0, 0, 0, 2], 128], // TURN anycast.
      [[0x2001, 1, 0, 0, 0, 0, 0, 3], 128], // DNS-SD registration anycast.
      [[0x2001, 3, 0, 0, 0, 0, 0, 0], 32], // AMT.
      [[0x2001, 4, 0x112, 0, 0, 0, 0, 0], 48], // AS112-v6.
      [[0x2001, 0x30, 0, 0, 0, 0, 0, 0], 28], // Drone Remote ID DETs.
    ].some(([network, prefixLength]) => ipv6IsInCidr(
      groups,
      network as number[],
      prefixLength as number
    ));
    if (!globallyReachableExceptions) return true;
  }

  return [
    [[0x2001, 0, 0, 0, 0, 0, 0, 0], 32], // Teredo.
    [[0x2001, 0xdb8, 0, 0, 0, 0, 0, 0], 32], // Documentation.
    [[0x2002, 0, 0, 0, 0, 0, 0, 0], 16], // Deprecated 6to4.
    [[0x3fff, 0, 0, 0, 0, 0, 0, 0], 20], // Documentation.
  ].some(([network, prefixLength]) => ipv6IsInCidr(
    groups,
    network as number[],
    prefixLength as number
  ));
};

const isForbiddenOAuthHostname = (hostnameValue: string): boolean => {
  const hostname = hostnameValue.toLowerCase().replace(/^\[|\]$/g, '').replace(/\.$/, '');
  if (
    hostname === 'localhost'
    || hostname.endsWith('.localhost')
    || hostname.endsWith('.local')
    || hostname.endsWith('.internal')
  ) return true;

  const ipv4 = parseIpv4(hostname);
  if (ipv4) return isForbiddenIpv4(ipv4);
  const ipv6 = parseIpv6(hostname);
  return ipv6 ? isForbiddenIpv6(ipv6) : false;
};

const parsePublicHttpsUrl = (value: string, label: string): URL => {
  const url = new URL(value);
  if (
    url.protocol !== 'https:'
    || url.username
    || url.password
    || url.hash
    || isForbiddenOAuthHostname(url.hostname)
  ) {
    throw new Error(`${label} must be a public HTTPS URL`);
  }
  return url;
};

const isIpLiteral = (hostname: string): boolean => Boolean(
  parseIpv4(hostname.replace(/^\[|\]$/g, ''))
  || parseIpv6(hostname.replace(/^\[|\]$/g, ''))
);

const assertPublicResolvedUrl = async (
  url: URL,
  dependencies: OAuthRouteDependencies
): Promise<void> => {
  if (isIpLiteral(url.hostname)) return;
  // Production does not perform a second, application-level DNS lookup. A DoH
  // answer cannot bind Cloudflare's later fetch connection to the same address,
  // and the DoH request itself has proved unreliable inside the Worker runtime.
  // `global_fetch_strictly_public` is therefore the authoritative DNS-rebinding
  // and private-network control at connection time. The injected resolver keeps
  // deterministic defense-in-depth coverage available to tests and local hosts.
  const resolver = dependencies.resolveHostname;
  if (!resolver) return;
  let addresses: string[];
  try {
    addresses = await resolver(url.hostname);
  } catch {
    throw new OAuthDnsSafetyValidationError();
  }
  if (
    addresses.length === 0
    || addresses.some(address => !isIpLiteral(address) || isForbiddenOAuthHostname(address))
  ) {
    throw new OAuthDnsSafetyValidationError();
  }
  // Production global fetches are additionally forced through Cloudflare's
  // public-Internet path by the mandatory global_fetch_strictly_public flag in
  // wrangler.toml. That connection-time enforcement remains authoritative if
  // DNS changes after this optional defense-in-depth preflight.
};

const readBoundedBody = async (
  source: Request | Response,
  maximumBytes: number,
  oversizedMessage: string
): Promise<Uint8Array<ArrayBuffer>> => {
  const declaredLength = Number(source.headers.get('Content-Length'));
  if (Number.isFinite(declaredLength) && declaredLength > maximumBytes) {
    throw new RangeError(oversizedMessage);
  }
  if (!source.body) return new Uint8Array();

  const reader = source.body.getReader();
  const chunks: Uint8Array[] = [];
  let length = 0;
  while (true) {
    const { done, value } = await reader.read();
    if (done) break;
    length += value.byteLength;
    if (length > maximumBytes) {
      await reader.cancel().catch(() => {});
      throw new RangeError(oversizedMessage);
    }
    chunks.push(value);
  }
  const result = new Uint8Array(length);
  let offset = 0;
  for (const chunk of chunks) {
    result.set(chunk, offset);
    offset += chunk.byteLength;
  }
  return result;
};

const decodeBoundedText = async (
  source: Request | Response,
  maximumBytes: number,
  oversizedMessage: string
): Promise<string> => new TextDecoder('utf-8', { fatal: true, ignoreBOM: false }).decode(
  await readBoundedBody(source, maximumBytes, oversizedMessage)
);

const parseBoundedJson = async <T,>(
  response: Response,
  maximumBytes: number,
  oversizedMessage: string
): Promise<T> => JSON.parse(
  await decodeBoundedText(response, maximumBytes, oversizedMessage)
) as T;

const buildAuthorizationServerDiscoveryUrls = (issuer: URL): URL[] => {
  if (issuer.pathname === '/') {
    return [
      new URL('/.well-known/oauth-authorization-server', issuer.origin),
      new URL('/.well-known/openid-configuration', issuer.origin),
    ];
  }
  const path = issuer.pathname.endsWith('/')
    ? issuer.pathname.slice(0, -1)
    : issuer.pathname;
  return [
    new URL(`/.well-known/oauth-authorization-server${path}`, issuer.origin),
    new URL(`/.well-known/openid-configuration${path}`, issuer.origin),
    new URL(`${path}/.well-known/openid-configuration`, issuer.origin),
  ];
};

interface WorkerAuthorizationMetadata {
  issuer: string;
  token_endpoint: string;
  registration_endpoint?: string;
  token_endpoint_auth_methods_supported?: string[];
  client_id_metadata_document_supported?: boolean;
}

const effectiveTokenEndpointAuthMethods = (
  metadata: WorkerAuthorizationMetadata
): string[] => metadata.token_endpoint_auth_methods_supported ?? ['client_secret_basic'];

type PublicClientTokenInteropPolicy = {
  id: 'hugging-face-cimd';
  issuer: string;
  tokenEndpoint: string;
  clientId: string;
  resource: string;
  redirectUri: string;
  requiresClientIdMetadataDocumentSupport: true;
};

/**
 * Provider interoperability exceptions must be exact, evidence-backed tuples.
 * In particular, CIMD support alone never implies public token authentication.
 */
const PUBLIC_CLIENT_TOKEN_INTEROP_POLICIES: readonly PublicClientTokenInteropPolicy[] = [{
  id: 'hugging-face-cimd',
  issuer: 'https://huggingface.co',
  tokenEndpoint: 'https://huggingface.co/oauth/token',
  clientId: HOSTED_OAUTH_CLIENT_METADATA_URL,
  resource: 'https://huggingface.co/mcp?login',
  redirectUri: HOSTED_OAUTH_CALLBACK,
  requiresClientIdMetadataDocumentSupport: true,
}] as const;

const publicClientTokenInteropPolicy = (
  metadata: WorkerAuthorizationMetadata,
  params: URLSearchParams
): PublicClientTokenInteropPolicy | undefined => PUBLIC_CLIENT_TOKEN_INTEROP_POLICIES.find(
  policy => metadata.issuer === policy.issuer
    && metadata.token_endpoint === policy.tokenEndpoint
    && params.get('client_id') === policy.clientId
    && params.get('resource') === policy.resource
    && (
      !policy.requiresClientIdMetadataDocumentSupport
      || metadata.client_id_metadata_document_supported === true
    )
    && (
      (
        params.get('grant_type') === 'refresh_token'
        && (
          !params.has('redirect_uri')
          || params.get('redirect_uri') === policy.redirectUri
        )
      )
      || params.get('redirect_uri') === policy.redirectUri
    )
);

const usesReservedPublicClientIdentity = (
  metadata: WorkerAuthorizationMetadata,
  params: URLSearchParams
): boolean => PUBLIC_CLIENT_TOKEN_INTEROP_POLICIES.some(
  policy => metadata.issuer === policy.issuer && params.get('client_id') === policy.clientId
);

class UnsupportedOAuthClientAuthenticationError extends Error {
  constructor() {
    super('Unsupported OAuth client authentication');
    this.name = 'UnsupportedOAuthClientAuthenticationError';
  }
}

const discoverWorkerAuthorizationMetadata = async (
  issuer: URL,
  expectedIssuer: string,
  fetchImpl: (request: Request) => Promise<Response>,
  dependencies: OAuthRouteDependencies
): Promise<WorkerAuthorizationMetadata> => {
  for (const discoveryUrl of buildAuthorizationServerDiscoveryUrls(issuer)) {
    await assertPublicResolvedUrl(discoveryUrl, dependencies);
    const response = await fetchTargetRequest(new Request(discoveryUrl, {
      method: 'GET',
      headers: { Accept: 'application/json' },
      redirect: 'manual',
    }), fetchImpl);
    if (!response.ok) {
      await response.body?.cancel().catch(() => {});
      if (response.status >= 400 && response.status < 500) continue;
      throw new Error('Authorization-server discovery failed');
    }
    const contentType = response.headers.get('Content-Type')?.split(';', 1)[0].trim().toLowerCase();
    if (contentType !== 'application/json') {
      await response.body?.cancel().catch(() => {});
      throw new Error('Authorization-server discovery returned an unsupported content type');
    }
    const metadata = await parseBoundedJson<Partial<WorkerAuthorizationMetadata>>(
      response,
      MAX_OAUTH_METADATA_BYTES,
      'Authorization-server metadata response is too large'
    );
    if (metadata.issuer !== expectedIssuer || typeof metadata.token_endpoint !== 'string') {
      throw new Error('Authorization-server discovery issuer mismatch');
    }
    return metadata as WorkerAuthorizationMetadata;
  }
  throw new Error('Authorization-server metadata is unavailable');
};

interface OperatorOAuthBinding {
  provider: OperatorOAuthProvider;
  resource: string;
  issuer: string;
  browserClientIdAvailable: boolean;
}

const OPERATOR_OAUTH_BINDINGS: readonly OperatorOAuthBinding[] = [
  {
    provider: 'figma',
    resource: 'https://mcp.figma.com/mcp',
    issuer: 'https://api.figma.com/',
    browserClientIdAvailable: false,
  },
  {
    provider: 'slack',
    resource: 'https://mcp.slack.com/mcp',
    issuer: 'https://mcp.slack.com/',
    browserClientIdAvailable: true,
  },
  {
    provider: 'slack',
    resource: 'https://mcp.slack.com/mcp',
    issuer: 'https://slack.com/',
    browserClientIdAvailable: true,
  },
  {
    provider: 'github',
    resource: 'https://api.githubcopilot.com/mcp/',
    issuer: 'https://github.com/login/oauth',
    browserClientIdAvailable: true,
  },
] as const;

const operatorBinding = (
  resource: string,
  issuer: URL
): OperatorOAuthBinding | undefined => {
  let normalizedResource: string;
  try {
    normalizedResource = new URL(resource).toString();
  } catch {
    return undefined;
  }
  return OPERATOR_OAUTH_BINDINGS.find((binding) => (
    normalizedResource === new URL(binding.resource).toString()
    && issuer.toString() === new URL(binding.issuer).toString()
  ));
};

const validateTokenForm = (params: URLSearchParams): 'authorization_code' | 'refresh_token' => {
  const securitySensitiveParameters = [
    'grant_type',
    'client_id',
    'client_secret',
    'resource',
    'code',
    'code_verifier',
    'redirect_uri',
    'refresh_token',
  ];
  if (securitySensitiveParameters.some(name => params.getAll(name).length > 1)) {
    throw new Error('OAuth token form contains duplicate security-sensitive parameters');
  }
  const grantType = params.get('grant_type');
  const commonRequired = ['client_id', 'resource'];
  const grantRequired = grantType === 'authorization_code'
    ? ['code', 'code_verifier', 'redirect_uri']
    : grantType === 'refresh_token'
      ? ['refresh_token']
      : undefined;
  if (!grantRequired || [...commonRequired, ...grantRequired].some(name => !params.get(name))) {
    throw new Error('OAuth token form is missing required parameters or uses an unsupported grant');
  }
  if (
    params.get('client_id')!.length > MAX_DYNAMIC_CLIENT_ID_LENGTH
    || (params.get('client_secret')?.length || 0) > MAX_DYNAMIC_CLIENT_SECRET_LENGTH
  ) {
    throw new Error('OAuth client credentials are too large');
  }
  parsePublicHttpsUrl(params.get('resource')!, 'OAuth resource');
  if (grantType === 'authorization_code') {
    const redirectValue = params.get('redirect_uri')!;
    const redirect = new URL(redirectValue);
    const redirectHasUserinfo = Boolean(redirect.username || redirect.password)
      || /^[a-z][a-z\d+.-]*:[\\/]*[^\\/?#]*@/i.test(redirectValue.trim());
    const redirectHasFragment = redirectValue.includes('#');
    const redirectHostname = redirect.hostname.toLowerCase().replace(/^\[|\]$/g, '');
    const redirectIpv4 = parseIpv4(redirectHostname);
    const redirectIpv6 = parseIpv6(redirectHostname);
    const isLoopbackHost = redirectHostname === 'localhost'
      || redirectIpv4?.[0] === 127
      || Boolean(redirectIpv6 && ipv6IsInCidr(
        redirectIpv6,
        [0, 0, 0, 0, 0, 0, 0, 1],
        128
      ));
    const isHttpLoopback = redirect.protocol === 'http:' && isLoopbackHost;
    if (
      (redirect.protocol !== 'https:' && !isHttpLoopback)
      || redirectHasUserinfo
      || redirectHasFragment
    ) {
      throw new Error('OAuth redirect_uri must use HTTPS or localhost');
    }
    if (
      params.get('client_id') === HOSTED_OAUTH_CLIENT_METADATA_URL
      && redirectValue !== HOSTED_OAUTH_CALLBACK
    ) {
      throw new Error('OAuth redirect_uri does not match the published client metadata');
    }
  }
  return grantType as 'authorization_code' | 'refresh_token';
};

const encodeFormComponent = (value: string): string => {
  const encoded = new URLSearchParams({ value }).toString();
  return encoded.slice('value='.length);
};

const decodeFormComponent = (value: string): string => (
  decodeURIComponent(value.replace(/\+/g, ' '))
);

const applyOperatorClientAuthentication = (
  env: Env,
  issuer: URL,
  metadata: WorkerAuthorizationMetadata,
  params: URLSearchParams,
  targetHeaders: Headers,
  originalBody: string,
  dynamicClientAuthorization?: string | null
): string => {
  const binding = operatorBinding(params.get('resource') || '', issuer);
  const operatorClient = binding ? getOperatorOAuthClient(env, binding.provider) : undefined;
  const methods = effectiveTokenEndpointAuthMethods(metadata);
  if (!operatorClient || params.get('client_id') !== operatorClient.clientId) {
    const browserSecret = params.get('client_secret');
    const interopPolicy = publicClientTokenInteropPolicy(metadata, params);
    if (
      usesReservedPublicClientIdentity(metadata, params)
      && (browserSecret !== null || dynamicClientAuthorization)
    ) {
      throw new UnsupportedOAuthClientAuthenticationError();
    }
    if (dynamicClientAuthorization) {
      if (
        !methods.includes('client_secret_basic')
        || !dynamicClientAuthorization.startsWith('Basic ')
        || dynamicClientAuthorization.length > MAX_DYNAMIC_CLIENT_BASIC_AUTHORIZATION_LENGTH
      ) {
        throw new UnsupportedOAuthClientAuthenticationError();
      }
      let decoded: string;
      try {
        decoded = atob(dynamicClientAuthorization.slice('Basic '.length));
      } catch {
        throw new UnsupportedOAuthClientAuthenticationError();
      }
      const delimiter = decoded.indexOf(':');
      const decodedClientSecret = delimiter >= 0
        ? decodeFormComponent(decoded.slice(delimiter + 1))
        : '';
      if (
        delimiter < 0
        || decodeFormComponent(decoded.slice(0, delimiter)) !== params.get('client_id')
        || decodedClientSecret.length < 1
        || decodedClientSecret.length > MAX_DYNAMIC_CLIENT_SECRET_LENGTH
      ) {
        throw new UnsupportedOAuthClientAuthenticationError();
      }
      targetHeaders.set('Authorization', dynamicClientAuthorization);
      params.delete('client_id');
      params.delete('client_secret');
    } else if (browserSecret) {
      if (!methods.includes('client_secret_post')) {
        throw new UnsupportedOAuthClientAuthenticationError();
      }
    }
    if (!methods.includes('none')) {
      if (!browserSecret && !dynamicClientAuthorization && !interopPolicy) {
        throw new UnsupportedOAuthClientAuthenticationError();
      }
    }
    return dynamicClientAuthorization ? params.toString() : originalBody;
  }

  params.delete('client_secret');
  if (methods.includes('client_secret_basic')) {
    const basic = btoa(`${encodeFormComponent(operatorClient.clientId)}:${encodeFormComponent(operatorClient.clientSecret)}`);
    targetHeaders.set('Authorization', `Basic ${basic}`);
  } else if (methods.includes('client_secret_post')) {
    params.set('client_secret', operatorClient.clientSecret);
  } else {
    throw new UnsupportedOAuthClientAuthenticationError();
  }
  return params.toString();
};

export async function handleOAuthTokenRequest(
  request: Request,
  env: Env,
  dependencies: OAuthRouteDependencies = {}
): Promise<Response> {
  if (request.headers.get('Origin') !== HOSTED_ORIGIN) {
    return oauthRouteError(request, 'Error: OAuth token proxy origin is not allowed.', 403);
  }
  if (request.method === 'OPTIONS') {
    return new Response(null, { status: 204, headers: oauthCorsHeaders(request) });
  }
  if (request.method !== 'POST') {
    return oauthRouteError(request, 'Error: OAuth token proxy requires POST.', 405);
  }
  const mediaType = request.headers.get('Content-Type')?.split(';', 1)[0].trim().toLowerCase();
  if (mediaType !== OAUTH_FORM_CONTENT_TYPE) {
    return oauthRouteError(request, 'Error: OAuth token proxy requires form-urlencoded content.', 415);
  }
  // The Firebase login is optional: it only lifts the caller's limits. A
  // present but invalid token still fails so the app can refresh it.
  const caller = await identifyCaller(request, env, dependencies.verifyToken);
  if (!caller) {
    return oauthRouteError(request, 'Error: Invalid authentication token. Sign in again.', 401);
  }
  if (!await consumeCallerRateLimit(caller, env)) {
    return callerLimitResponse(caller, oauthCorsHeaders(request));
  }

  try {
    const issuerHeader = request.headers.get('X-MCP-OAuth-Issuer');
    const expectedEndpointHeader = request.headers.get('X-MCP-OAuth-Token-Endpoint');
    if (!issuerHeader || !expectedEndpointHeader) {
      return oauthRouteError(request, 'Error: Validated OAuth issuer binding is required.', 400);
    }
    const issuer = parsePublicHttpsUrl(issuerHeader, 'OAuth issuer');
    if (issuer.search) {
      return oauthRouteError(request, 'Error: OAuth issuer must not contain a query.', 400);
    }
    let body: string;
    try {
      body = await decodeBoundedText(request, MAX_OAUTH_FORM_BYTES, 'OAuth token form is too large');
    } catch (error) {
      if (error instanceof RangeError) {
        return oauthRouteError(request, 'Error: OAuth token form is too large.', 413);
      }
      throw error;
    }
    const params = new URLSearchParams(body);
    validateTokenForm(params);
    const dynamicClientAuthorization = request.headers.get(
      'X-MCP-OAuth-Client-Authorization'
    );
    if (dynamicClientAuthorization && params.has('client_secret')) {
      throw new UnsupportedOAuthClientAuthenticationError();
    }
    const fetchImpl = dependencies.fetchImpl || fetch;
    const metadata = await discoverWorkerAuthorizationMetadata(
      issuer,
      issuerHeader,
      fetchImpl,
      dependencies
    );
    const tokenEndpoint = parsePublicHttpsUrl(metadata.token_endpoint, 'OAuth token endpoint');
    let expectedEndpoint: URL;
    try {
      expectedEndpoint = parsePublicHttpsUrl(expectedEndpointHeader, 'Expected OAuth token endpoint');
    } catch {
      return oauthRouteError(request, 'Error: OAuth issuer/token-endpoint binding mismatch.', 400);
    }
    if (tokenEndpoint.toString() !== expectedEndpoint.toString()) {
      return oauthRouteError(request, 'Error: OAuth issuer/token-endpoint binding mismatch.', 400);
    }
    await assertPublicResolvedUrl(tokenEndpoint, dependencies);

    const targetHeaders = new Headers({
      Accept: 'application/json',
      'Content-Type': OAUTH_FORM_CONTENT_TYPE,
    });
    const targetBody = applyOperatorClientAuthentication(
      env,
      issuer,
      metadata,
      params,
      targetHeaders,
      body,
      dynamicClientAuthorization
    );
    const targetResponse = await fetchImpl(new Request(tokenEndpoint, {
      method: 'POST',
      headers: targetHeaders,
      body: targetBody,
      redirect: 'manual',
    }));
    if (targetResponse.status >= 300 && targetResponse.status < 400) {
      await targetResponse.body?.cancel().catch(() => {});
      throw new Error('OAuth token endpoint redirects are not allowed');
    }
    const responseType = targetResponse.headers.get('Content-Type') || 'application/json';
    if (responseType.split(';', 1)[0].trim().toLowerCase() !== 'application/json') {
      await targetResponse.body?.cancel().catch(() => {});
      return oauthRouteError(request, 'Error: OAuth token endpoint returned an unsupported content type.', 502);
    }
    const responseBody = await readBoundedBody(
      targetResponse,
      MAX_OAUTH_RESPONSE_BYTES,
      'OAuth token response is too large'
    );
    return new Response(responseBody, {
      status: targetResponse.status,
      statusText: targetResponse.statusText,
      headers: {
        ...oauthCorsHeaders(request, 'target'),
        'Content-Type': responseType,
      },
    });
  } catch (error) {
    if (error instanceof UnsupportedOAuthClientAuthenticationError) {
      // Log only values from a closed set. Never serialize the exception or any
      // request/provider body, which can contain every OAuth credential class.
      console.error('[OAuth token relay failure]', {
        stage: 'client_authentication',
        failure: 'unsupported_client_authentication',
      });
      const response = oauthRouteError(
        request,
        'Error: OAuth token relay rejected unsupported client authentication before contacting the target token endpoint.',
        502
      );
      response.headers.set(OAUTH_RELAY_FAILURE_HEADER, 'unsupported_client_authentication');
      return response;
    }
    return oauthRouteError(request, 'Error: Could not complete the bound OAuth token request.', 502);
  }
}

/**
 * Returns only the public client ID for an exact operator-approved
 * resource/issuer pair. The optional Firebase credential and user identity are
 * used solely to select the caller's limits and are never logged or serialized.
 */
export async function handleOAuthOperatorClientRequest(
  request: Request,
  env: Env,
  dependencies: Pick<OAuthRouteDependencies, 'verifyToken'> = {}
): Promise<Response> {
  if (request.headers.get('Origin') !== HOSTED_ORIGIN) {
    return oauthRouteJsonError(
      request,
      'access_denied',
      'OAuth operator client origin is not allowed.',
      403
    );
  }
  if (request.method === 'OPTIONS') {
    return new Response(null, { status: 204, headers: oauthCorsHeaders(request) });
  }
  if (request.method !== 'POST') {
    return oauthRouteJsonError(
      request,
      'invalid_request',
      'OAuth operator client lookup requires POST.',
      405
    );
  }
  const caller = await identifyCaller(request, env, dependencies.verifyToken);
  if (!caller) {
    return oauthRouteJsonError(
      request,
      'authentication_required',
      'The mcptest login is invalid or expired.',
      401
    );
  }
  if (!await consumeCallerRateLimit(caller, env)) {
    return callerLimitResponse(caller, oauthCorsHeaders(request));
  }

  const resourceHeader = request.headers.get('X-MCP-OAuth-Resource');
  const issuerHeader = request.headers.get('X-MCP-OAuth-Issuer');
  if (!resourceHeader || !issuerHeader) {
    return oauthRouteJsonError(
      request,
      'invalid_request',
      'An exact OAuth resource and issuer binding is required.',
      400
    );
  }

  let issuer: URL;
  try {
    issuer = parsePublicHttpsUrl(issuerHeader, 'OAuth issuer');
  } catch {
    return oauthRouteJsonError(
      request,
      'invalid_request',
      'The OAuth resource and issuer binding is not approved.',
      400
    );
  }
  const binding = operatorBinding(resourceHeader, issuer);
  if (!binding?.browserClientIdAvailable) {
    return oauthRouteJsonError(
      request,
      'invalid_target',
      'The OAuth resource and issuer binding is not approved.',
      400
    );
  }
  const operatorClient = getOperatorOAuthClient(env, binding.provider);
  if (
    !operatorClient
    || typeof operatorClient.clientId !== 'string'
    || operatorClient.clientId.length < 1
    || operatorClient.clientId.length > MAX_DYNAMIC_CLIENT_ID_LENGTH
  ) {
    return oauthRouteJsonError(
      request,
      'operator_client_not_configured',
      'The operator OAuth client is not configured for this provider.',
      503
    );
  }

  return new Response(JSON.stringify({ client_id: operatorClient.clientId }), {
    status: 200,
    headers: {
      ...oauthCorsHeaders(request, 'proxy'),
      'Content-Type': OAUTH_JSON_CONTENT_TYPE,
    },
  });
}

const REGISTRATION_REQUEST_KEYS = new Set([
  'redirect_uris',
  'token_endpoint_auth_method',
  'grant_types',
  'response_types',
  'application_type',
  'client_name',
  'client_uri',
  'logo_uri',
  'scope',
  'contacts',
  'tos_uri',
  'policy_uri',
  'software_id',
  'software_version',
]);

type RegistrationRequestBody = Record<string, unknown> & {
  redirect_uris: string[];
};

const isBoundedString = (value: unknown, maximumLength: number): value is string => (
  typeof value === 'string' && value.length > 0 && value.length <= maximumLength
);

const isValidRegistrationScope = (value: unknown): value is string => (
  isBoundedString(value, 2048) && !/[\u0000-\u001f\u007f]/.test(value)
);

const validateExactStringArray = (
  value: unknown,
  allowed: readonly string[],
  maximumItems: number
): value is string[] => Array.isArray(value)
  && value.length > 0
  && value.length <= maximumItems
  && new Set(value).size === value.length
  && value.every(item => typeof item === 'string' && allowed.includes(item));

const validateRegistrationRequest = (value: unknown): RegistrationRequestBody => {
  if (!value || typeof value !== 'object' || Array.isArray(value)) {
    throw new Error('OAuth registration body must be a JSON object');
  }
  const body = value as Record<string, unknown>;
  if (Object.keys(body).some(key => !REGISTRATION_REQUEST_KEYS.has(key))) {
    throw new Error('OAuth registration body contains unsupported metadata');
  }
  if (
    !Array.isArray(body.redirect_uris)
    || body.redirect_uris.length !== 1
    || body.redirect_uris[0] !== HOSTED_OAUTH_CALLBACK
  ) {
    throw new Error('OAuth registration redirect_uris must contain the hosted callback exactly');
  }
  if (
    body.token_endpoint_auth_method !== undefined
    && !['none', 'client_secret_basic', 'client_secret_post'].includes(
      String(body.token_endpoint_auth_method)
    )
  ) {
    throw new Error('OAuth registration requests an unsupported token authentication method');
  }
  if (
    body.grant_types !== undefined
    && !validateExactStringArray(
      body.grant_types,
      ['authorization_code', 'refresh_token'],
      2
    )
  ) throw new Error('OAuth registration grant_types are unsupported');
  if (
    body.response_types !== undefined
    && !validateExactStringArray(body.response_types, ['code'], 1)
  ) throw new Error('OAuth registration response_types are unsupported');
  if (body.application_type !== undefined && body.application_type !== 'web') {
    throw new Error('OAuth registration application_type is unsupported');
  }

  for (const field of ['client_name', 'software_id', 'software_version'] as const) {
    if (body[field] !== undefined && !isBoundedString(body[field], 256)) {
      throw new Error(`OAuth registration ${field} is invalid`);
    }
  }
  for (const field of ['client_uri', 'logo_uri', 'tos_uri', 'policy_uri'] as const) {
    if (body[field] === undefined) continue;
    if (!isBoundedString(body[field], 2048)) {
      throw new Error(`OAuth registration ${field} is invalid`);
    }
    const url = parsePublicHttpsUrl(body[field], `OAuth registration ${field}`);
    if (url.origin !== HOSTED_ORIGIN) {
      throw new Error(`OAuth registration ${field} must be hosted by mcptest.io`);
    }
  }
  if (
    body.scope !== undefined
    && !isValidRegistrationScope(body.scope)
  ) throw new Error('OAuth registration scope is invalid');
  if (
    body.contacts !== undefined
    && (
      !Array.isArray(body.contacts)
      || body.contacts.length > 5
      || body.contacts.some(contact => (
        !isBoundedString(contact, 320)
        || !/^[^\s@]+@[^\s@]+$/.test(contact)
      ))
    )
  ) throw new Error('OAuth registration contacts are invalid');
  return body as RegistrationRequestBody;
};

const normalizedRegistrationFieldErrors = (
  value: Record<string, unknown>,
  resource: string | null,
  issuer: URL,
  registrationEndpoint: URL
): Array<{ field: 'client_name'; message: string }> => {
  if (
    value.error !== 'invalid_client_metadata'
    || resource !== CALENDLY_OAUTH_RESOURCE
    || issuer.toString() !== CALENDLY_OAUTH_ISSUER
    || registrationEndpoint.toString() !== CALENDLY_OAUTH_REGISTRATION_ENDPOINT
  ) return [];

  const errors = value.errors;
  if (!errors || typeof errors !== 'object' || Array.isArray(errors)) return [];
  const nameErrors = (errors as Record<string, unknown>).name;
  if (
    !Array.isArray(nameErrors)
    || nameErrors.length === 0
    || nameErrors.length > MAX_CALENDLY_REGISTRATION_FIELD_ERRORS
    || nameErrors.some(message => (
      typeof message !== 'string'
      || message.length === 0
      || message.length > MAX_CALENDLY_REGISTRATION_FIELD_ERROR_LENGTH
      || /[\u0000-\u001f\u007f]/.test(message)
    ))
  ) return [];
  const evidence = nameErrors.join(' ');
  if (
    !/(?:alpha[\s_-]*numeric|alphanumeric)/i.test(evidence)
    || !/hyphens?/i.test(evidence)
    || !/spaces?/i.test(evidence)
  ) return [];
  return [{
    field: 'client_name',
    message: 'Use only alphanumeric characters, hyphens, and spaces.',
  }];
};

const sanitizeRegistrationError = (
  value: unknown,
  resource: string | null,
  issuer: URL,
  registrationEndpoint: URL
): Record<string, unknown> => {
  if (!value || typeof value !== 'object' || Array.isArray(value)) {
    return { error: 'server_error', error_description: 'Registration endpoint returned an invalid JSON error.' };
  }
  const input = value as Record<string, unknown>;
  const result: Record<string, string> = {};
  for (const key of ['error', 'error_description', 'message', 'detail']) {
    if (
      typeof input[key] === 'string'
      && input[key].length <= 2048
      && !/[\u0000-\u001f\u007f]/.test(input[key])
    ) result[key] = input[key];
  }
  const registrationValidationErrors = normalizedRegistrationFieldErrors(
    input,
    resource,
    issuer,
    registrationEndpoint
  );
  return result.error || result.message || result.detail
    ? {
        ...result,
        ...(registrationValidationErrors.length ? { registrationValidationErrors } : {}),
      }
    : { error: 'server_error', error_description: 'Registration endpoint returned an invalid OAuth error.' };
};

const opaqueRegistrationError = (): Record<string, string> => ({
  error: 'invalid_response',
  error_description: 'The provider rejected OAuth client registration with a non-JSON or malformed-JSON response.',
});

const sanitizeRegistrationSuccess = (
  value: unknown,
  requestBody: RegistrationRequestBody,
  metadata: WorkerAuthorizationMetadata
): Record<string, unknown> => {
  if (!value || typeof value !== 'object' || Array.isArray(value)) {
    throw new Error('OAuth registration response must be a JSON object');
  }
  const input = value as Record<string, unknown>;
  if (!isBoundedString(input.client_id, MAX_DYNAMIC_CLIENT_ID_LENGTH)) {
    throw new Error('OAuth registration response has an invalid client_id');
  }
  for (const [field, returnedValue] of Object.entries(input)) {
    if (
      !REGISTRATION_REQUEST_KEYS.has(field)
      || !Object.prototype.hasOwnProperty.call(requestBody, field)
    ) continue;
    const requestedValue = requestBody[field];
    const matchesRequest = Array.isArray(requestedValue)
      ? Array.isArray(returnedValue)
        && returnedValue.length === requestedValue.length
        && [...returnedValue].sort().every((item, index) => (
          item === [...requestedValue].sort()[index]
        ))
      : returnedValue === requestedValue;
    if (!matchesRequest) {
      throw new Error(`OAuth registration response conflicts with requested ${field}`);
    }
  }
  const output: Record<string, unknown> = {
    ...requestBody,
    client_id: input.client_id,
  };
  // RFC 7591 permits an authorization server to return metadata it assigned
  // or defaulted even when the client omitted that field. Retain only the
  // provider-assigned field needed by the browser SDK; all other unrequested
  // metadata remains outside this bounded response reconstruction.
  if (input.scope !== undefined) {
    if (!isValidRegistrationScope(input.scope)) {
      throw new Error('OAuth registration response has an invalid scope');
    }
    output.scope = input.scope;
  }
  if (input.client_secret !== undefined) {
    if (!isBoundedString(input.client_secret, MAX_DYNAMIC_CLIENT_SECRET_LENGTH)) {
      throw new Error('OAuth registration response has an invalid client_secret');
    }
    output.client_secret = input.client_secret;
  }
  for (const field of ['client_id_issued_at', 'client_secret_expires_at'] as const) {
    if (input[field] === undefined) continue;
    if (!Number.isSafeInteger(input[field]) || (input[field] as number) < 0) {
      throw new Error(`OAuth registration response has an invalid ${field}`);
    }
    output[field] = input[field];
  }
  const effectiveTokenAuthMethod = input.token_endpoint_auth_method
    ?? requestBody.token_endpoint_auth_method
    ?? 'client_secret_basic';
  if (
    typeof effectiveTokenAuthMethod !== 'string'
    || !['none', 'client_secret_basic', 'client_secret_post'].includes(effectiveTokenAuthMethod)
  ) {
    throw new Error('OAuth registration response selected an unsupported token authentication method');
  }
  const supportedMethods = effectiveTokenEndpointAuthMethods(metadata);
  if (!supportedMethods.includes(effectiveTokenAuthMethod)) {
    throw new Error('OAuth registration response selected an unadvertised token authentication method');
  }
  if (effectiveTokenAuthMethod !== 'none' && !output.client_secret) {
    throw new Error('OAuth registration response requires a missing client_secret');
  }
  if (effectiveTokenAuthMethod === 'none' && output.client_secret) {
    throw new Error('OAuth registration response returned a client_secret for a public client');
  }
  output.token_endpoint_auth_method = effectiveTokenAuthMethod;
  return output;
};

export async function handleOAuthRegistrationRequest(
  request: Request,
  env: Env,
  dependencies: OAuthRouteDependencies = {}
): Promise<Response> {
  if (request.headers.get('Origin') !== HOSTED_ORIGIN) {
    return oauthRouteError(request, 'Error: OAuth registration proxy origin is not allowed.', 403);
  }
  if (request.method === 'OPTIONS') {
    return new Response(null, { status: 204, headers: oauthCorsHeaders(request) });
  }
  if (request.method !== 'POST') {
    return oauthRouteError(request, 'Error: OAuth registration proxy requires POST.', 405);
  }
  const mediaType = request.headers.get('Content-Type')?.split(';', 1)[0].trim().toLowerCase();
  if (mediaType !== OAUTH_JSON_CONTENT_TYPE) {
    return oauthRouteError(request, 'Error: OAuth registration proxy requires JSON content.', 415);
  }
  // The Firebase login is optional: it only lifts the caller's limits. A
  // present but invalid token still fails so the app can refresh it.
  const caller = await identifyCaller(request, env, dependencies.verifyToken);
  if (!caller) {
    return oauthRouteError(request, 'Error: Invalid authentication token. Sign in again.', 401);
  }
  if (!await consumeCallerRateLimit(caller, env)) {
    return callerLimitResponse(caller, oauthCorsHeaders(request));
  }

  try {
    const issuerHeader = request.headers.get('X-MCP-OAuth-Issuer');
    const resourceHeader = request.headers.get('X-MCP-OAuth-Resource');
    const expectedEndpointHeader = request.headers.get('X-MCP-OAuth-Registration-Endpoint');
    if (!issuerHeader || !expectedEndpointHeader) {
      return oauthRouteError(request, 'Error: Validated OAuth registration binding is required.', 400);
    }
    const issuer = parsePublicHttpsUrl(issuerHeader, 'OAuth issuer');
    if (issuer.search) {
      return oauthRouteError(request, 'Error: OAuth issuer must not contain a query.', 400);
    }
    let expectedEndpoint: URL;
    try {
      expectedEndpoint = parsePublicHttpsUrl(
        expectedEndpointHeader,
        'Expected OAuth registration endpoint'
      );
    } catch {
      return oauthRouteError(request, 'Error: OAuth issuer/registration-endpoint binding mismatch.', 400);
    }

    let rawBody: string;
    try {
      rawBody = await decodeBoundedText(
        request,
        MAX_OAUTH_REGISTRATION_BYTES,
        'OAuth registration request is too large'
      );
    } catch (error) {
      if (error instanceof RangeError) {
        return oauthRouteError(request, 'Error: OAuth registration request is too large.', 413);
      }
      return oauthRouteError(request, 'Error: OAuth registration body is invalid.', 400);
    }
    let registrationBody: RegistrationRequestBody;
    try {
      registrationBody = validateRegistrationRequest(JSON.parse(rawBody));
    } catch {
      return oauthRouteError(request, 'Error: OAuth registration body is invalid.', 400);
    }
    const fetchImpl = dependencies.fetchImpl || fetch;
    let metadata: WorkerAuthorizationMetadata;
    try {
      metadata = await discoverWorkerAuthorizationMetadata(
        issuer,
        issuerHeader,
        fetchImpl,
        dependencies
      );
    } catch (error) {
      return oauthRegistrationFailure(
        request,
        error instanceof OAuthDnsSafetyValidationError
          ? 'dns_safety_validation'
          : 'authorization_metadata_discovery',
        error
      );
    }

    let registrationEndpoint: URL;
    try {
      const requestedTokenAuthMethod = typeof registrationBody.token_endpoint_auth_method === 'string'
        ? registrationBody.token_endpoint_auth_method
        : 'client_secret_basic';
      const supportedTokenAuthMethods = effectiveTokenEndpointAuthMethods(metadata);
      if (!supportedTokenAuthMethods.includes(requestedTokenAuthMethod)) {
        return oauthRouteError(
          request,
          'Error: OAuth registration token authentication method is not advertised.',
          400
        );
      }
      if (typeof metadata.registration_endpoint !== 'string') {
        return oauthRouteError(request, 'Error: Authorization server does not advertise registration.', 400);
      }
      registrationEndpoint = parsePublicHttpsUrl(
        metadata.registration_endpoint,
        'OAuth registration endpoint'
      );
      if (registrationEndpoint.toString() !== expectedEndpoint.toString()) {
        return oauthRouteError(request, 'Error: OAuth issuer/registration-endpoint binding mismatch.', 400);
      }
      await assertPublicResolvedUrl(registrationEndpoint, dependencies);
    } catch (error) {
      return oauthRegistrationFailure(
        request,
        error instanceof OAuthDnsSafetyValidationError
          ? 'dns_safety_validation'
          : 'destination_validation',
        error
      );
    }

    let targetResponse: Response;
    try {
      targetResponse = await fetchImpl(new Request(registrationEndpoint, {
        method: 'POST',
        headers: { Accept: OAUTH_JSON_CONTENT_TYPE, 'Content-Type': OAUTH_JSON_CONTENT_TYPE },
        body: JSON.stringify(registrationBody),
        redirect: 'manual',
      }));
    } catch (error) {
      return oauthRegistrationFailure(request, 'outbound_fetch', error);
    }

    try {
      if (targetResponse.status >= 300 && targetResponse.status < 400) {
        await targetResponse.body?.cancel().catch(() => {});
        throw new Error('Registration endpoint redirect');
      }
      const responseType = targetResponse.headers.get('Content-Type')
        ?.split(';', 1)[0].trim().toLowerCase();
      let rawResponse: string;
      try {
        rawResponse = await decodeBoundedText(
          targetResponse,
          MAX_OAUTH_RESPONSE_BYTES,
          'OAuth registration response is too large'
        );
      } catch (error) {
        if (targetResponse.ok) throw error;

        // The provider status is already readable and target-owned. An
        // oversized or otherwise undecodable error body must not replace that
        // evidence with a proxy-owned validation failure.
        await targetResponse.body?.cancel().catch(() => {});
        return new Response(JSON.stringify(opaqueRegistrationError()), {
          status: targetResponse.status,
          headers: {
            ...oauthCorsHeaders(request, 'target'),
            'Content-Type': OAUTH_JSON_CONTENT_TYPE,
          },
        });
      }

      if (targetResponse.ok) {
        if (responseType !== OAUTH_JSON_CONTENT_TYPE) {
          throw new TypeError('Registration endpoint content type');
        }
        const providerJson = JSON.parse(rawResponse) as unknown;
        const sanitized = sanitizeRegistrationSuccess(providerJson, registrationBody, metadata);
        return new Response(JSON.stringify(sanitized), {
          status: targetResponse.status,
          headers: {
            ...oauthCorsHeaders(request, 'target'),
            'Content-Type': OAUTH_JSON_CONTENT_TYPE,
          },
        });
      }

      // Provider errors retain their target-owned HTTP status and provenance,
      // but never their raw body. In particular, Figma currently sends a bare
      // `Forbidden` body with application/json. Any non-JSON or malformed JSON
      // response is replaced with one fixed OAuth-shaped error.
      let sanitized: Record<string, unknown> = opaqueRegistrationError();
      if (responseType === OAUTH_JSON_CONTENT_TYPE) {
        try {
          sanitized = sanitizeRegistrationError(
            JSON.parse(rawResponse),
            resourceHeader,
            issuer,
            registrationEndpoint
          );
        } catch {
          // Keep the fixed opaque response; raw provider text is discarded.
        }
      }
      return new Response(JSON.stringify(sanitized), {
        status: targetResponse.status,
        headers: {
          ...oauthCorsHeaders(request, 'target'),
          'Content-Type': OAUTH_JSON_CONTENT_TYPE,
        },
      });
    } catch (error) {
      return oauthRegistrationFailure(request, 'response_validation', error);
    }
  } catch (error) {
    // The outer boundary covers only request/issuer parsing not already mapped
    // to a client error. Treat it as destination validation without exposing it.
    return oauthRegistrationFailure(request, 'destination_validation', error);
  }
}

export function getTargetRequestHeaders(requestHeaders: HeadersInit): Headers {
  const headers = new Headers(requestHeaders);
  const targetAuthorization = headers.get('X-MCP-Authorization');

  headers.delete('Authorization');
  headers.delete('X-MCP-Authorization');
  headers.delete('X-MCP-OAuth-Client-Authorization');
  headers.delete('X-MCP-OAuth-Issuer');
  headers.delete('X-MCP-OAuth-Resource');
  headers.delete('X-MCP-OAuth-Registration-Endpoint');
  headers.delete('X-MCP-OAuth-Token-Endpoint');
  if (targetAuthorization) {
    headers.set('Authorization', targetAuthorization);
  }
  headers.delete('CF-Connecting-IP');
  headers.delete('CF-IPCountry');
  headers.delete('CF-RAY');
  headers.delete('CF-Visitor');

  stripBrowserContextHeaders(headers);

  return headers;
}

/**
 * Removes browser provenance that has no meaning on the Worker's
 * server-to-server hop. Prefix checks intentionally cover current and future
 * Sec-Fetch and Sec-CH-UA variants, while Headers provides case-insensitive
 * names for both checks and deletion.
 */
export function stripBrowserContextHeaders(headers: Headers): Headers {
  for (const name of [...headers.keys()]) {
    const normalizedName = name.toLowerCase();
    if (
      normalizedName === 'origin'
      || normalizedName === 'referer'
      || normalizedName === 'priority'
      || normalizedName.startsWith('sec-fetch-')
      || normalizedName.startsWith('sec-ch-ua')
    ) {
      headers.delete(name);
    }
  }

  return headers;
}

export async function fetchTargetRequest(
  request: Request,
  fetchImpl: (request: Request) => Promise<Response> = fetch
): Promise<Response> {
  let currentRequest = request;

  for (let redirectCount = 0; redirectCount <= MAX_TARGET_REDIRECTS; redirectCount += 1) {
    // Sanitize at the final forwarding boundary as well as in the authenticated
    // route. This keeps GET/SSE calls and every same-origin redirect hop from
    // carrying or reintroducing browser-only headers.
    currentRequest = new Request(currentRequest, {
      headers: stripBrowserContextHeaders(new Headers(currentRequest.headers)),
      redirect: 'manual',
    });
    const response = await fetchImpl(currentRequest.clone());
    if (!REDIRECT_STATUSES.has(response.status)) return response;

    const location = response.headers.get('Location');
    if (!location) return response;
    if (redirectCount === MAX_TARGET_REDIRECTS) {
      throw new Error('Target exceeded the maximum redirect count');
    }

    const redirectUrl = new URL(location, response.url || currentRequest.url);
    const currentUrl = new URL(currentRequest.url);
    if (redirectUrl.origin !== currentUrl.origin) {
      await response.body?.cancel().catch(() => {});
      throw new Error('Cross-origin target redirects are not allowed');
    }

    const switchToGet = response.status === 303
      ? currentRequest.method !== 'HEAD'
      : (response.status === 301 || response.status === 302) && currentRequest.method === 'POST';

    if (switchToGet) {
      const headers = new Headers(currentRequest.headers);
      headers.delete('Content-Encoding');
      headers.delete('Content-Language');
      headers.delete('Content-Length');
      headers.delete('Content-Location');
      headers.delete('Content-Type');
      currentRequest = new Request(redirectUrl, {
        method: 'GET',
        headers,
        redirect: 'manual',
      });
    } else {
      currentRequest = new Request(redirectUrl, currentRequest);
    }

    await response.body?.cancel().catch(() => {});
  }

  throw new Error('Target exceeded the maximum redirect count');
}

export function withCorsResponseHeaders(
  response: Response,
  source: ProxyResponseSource
): Response {
  const mutableResponse = new Response(response.body, response);
  const corsHeaders = getCorsHeaders(source);
  for (const [key, value] of Object.entries(corsHeaders)) {
    mutableResponse.headers.set(key, value);
  }

  const exposedHeaders = Array.from(mutableResponse.headers.keys()).join(', ');
  mutableResponse.headers.set('Access-Control-Expose-Headers', exposedHeaders);
  return mutableResponse;
}

// Firebase public keys URL
const FIREBASE_PUBLIC_KEYS_URL = 'https://www.googleapis.com/robot/v1/metadata/x509/securetoken@system.gserviceaccount.com';

// Cache for Firebase public keys
let publicKeysCache: Record<string, string> | null = null;
let publicKeysCacheExpiry = 0;

type ProxyRouteDependencies = {
  /** Test seam for the runtime's global, strictly-public fetch primitive. */
  fetchImpl?: (request: Request) => Promise<Response>;
  verifyToken?: (token: string, projectId: string) => Promise<string | null>;
  /** Test seam; production always uses the anonymous spend-cap constants. */
  anonymousResponseLimits?: ResponseBodyLimits;
  /** Test seam; production always uses ANONYMOUS_MAX_REQUEST_BYTES. */
  anonymousMaxRequestBytes?: number;
};

/**
 * Applies the anonymous bandwidth cap to a proxied target response. Returns a
 * proxy-owned 429 when the declared length already exceeds the byte budget.
 */
function applyCallerResponseLimits(
  response: Response,
  caller: ProxyCaller,
  limits: ResponseBodyLimits
): Response {
  if (caller.tier !== 'anonymous' || !response.body) return response;
  const declaredLength = Number(response.headers.get('Content-Length'));
  if (
    limits.maxBytes !== undefined
    && Number.isFinite(declaredLength)
    && declaredLength > limits.maxBytes
  ) {
    void response.body.cancel().catch(() => {});
    return callerLimitResponse(caller, getCorsHeaders(), 'response_bytes');
  }
  const signalToken = crypto.randomUUID();
  const limited = new Response(
    limitResponseBody(response.body, { ...limits, signalToken }),
    response
  );
  // The trailer makes the body longer than any declared length.
  limited.headers.delete('Content-Length');
  limited.headers.set(PROXY_LIMIT_SIGNAL_HEADER, signalToken);
  limited.headers.set(
    'Access-Control-Expose-Headers',
    [limited.headers.get('Access-Control-Expose-Headers'), PROXY_LIMIT_SIGNAL_HEADER]
      .filter(Boolean)
      .join(', ')
  );
  return limited;
}

export async function handleProxyRequest(
  request: Request,
  env: Env,
  dependencies: ProxyRouteDependencies = {}
): Promise<Response> {
  // Handle CORS preflight requests
  if (request.method === 'OPTIONS') {
    return handleOptions(request);
  }

  const url = new URL(request.url);
  // Extract the target URL from query string
  const targetUrl = url.searchParams.get('target');

  if (!targetUrl) {
    return new Response('Error: Missing "target" query parameter.', {
      status: 400,
      headers: getCorsHeaders()
    });
  }

  // Validate the target URL
  let target: URL;
  try {
    target = new URL(targetUrl);
  } catch (e) {
    return new Response('Error: Invalid "target" URL provided.', {
      status: 400,
      headers: getCorsHeaders()
    });
  }

  // Security: Only allow http and https protocols
  if (target.protocol !== 'http:' && target.protocol !== 'https:') {
    return new Response('Error: Target URL must use http or https protocol.', {
      status: 400,
      headers: getCorsHeaders()
    });
  }

  try {
    // The Firebase login is read from the header only and is optional: no
    // token is the anonymous tier, a valid token lifts the limits. Proxy
    // credentials must never be placed in URLs, including for streaming
    // transports.
    const caller = await identifyCaller(request, env, dependencies.verifyToken);
    if (!caller) {
      return new Response('Error: Invalid authentication token. Please login again.', {
        status: 401,
        headers: getCorsHeaders()
      });
    }
    const maxRequestBytes = caller.tier === 'anonymous'
      ? dependencies.anonymousMaxRequestBytes ?? ANONYMOUS_MAX_REQUEST_BYTES
      : undefined;
    const declaredRequestLength = Number(request.headers.get('Content-Length'));
    if (
      maxRequestBytes !== undefined
      && Number.isFinite(declaredRequestLength)
      && declaredRequestLength > maxRequestBytes
    ) {
      void request.body?.cancel().catch(() => {});
      return callerLimitResponse(caller, getCorsHeaders(), 'request_bytes');
    }
    if (!await consumeCallerRateLimit(caller, env)) {
      return callerLimitResponse(caller, getCorsHeaders());
    }

    // Create a new request to the target URL
    const headers = getTargetRequestHeaders(request.headers);
    // A declared length can understate a streamed body, so the budget is also
    // enforced on the bytes actually forwarded.
    const limitedRequestBody = request.body && maxRequestBytes !== undefined
      ? limitRequestBody(request.body, maxRequestBytes)
      : undefined;
    if (limitedRequestBody) headers.delete('Content-Length');

    const newRequest = new Request(target.toString(), {
      method: request.method,
      headers: headers,
      body: limitedRequestBody?.body ?? request.body,
      redirect: 'manual',
      ...(request.body ? { duplex: 'half' } : {}),
    } as RequestInit);

    // Make the actual request to the target server
    let response: Response;
    try {
      response = await fetchTargetRequest(newRequest, dependencies.fetchImpl);
    } catch (error) {
      if (limitedRequestBody?.exceeded()) {
        return callerLimitResponse(caller, getCorsHeaders(), 'request_bytes');
      }
      throw error;
    }
    if (limitedRequestBody?.exceeded()) {
      // The target answered before the upload finished; the excess was not
      // forwarded, and the caller still learns why the body was cut off.
      void response.body?.cancel().catch(() => {});
      return callerLimitResponse(caller, getCorsHeaders(), 'request_bytes');
    }

    return applyCallerResponseLimits(
      withCorsResponseHeaders(response, 'target'),
      caller,
      dependencies.anonymousResponseLimits || {
        maxBytes: ANONYMOUS_MAX_RESPONSE_BYTES,
        maxDurationMs: ANONYMOUS_MAX_STREAM_DURATION_MS,
      }
    );

  } catch (error) {
    console.error('Proxy error:', error);
    if (error instanceof Response) {
      return withCorsResponseHeaders(error, 'proxy');
    }
    return new Response('Error: Could not complete the proxy request.', {
      status: 502,
      headers: getCorsHeaders()
    });
  }
}

export default {
  async fetch(request: Request, env: Env): Promise<Response> {
    const url = new URL(request.url);
    if (url.pathname === OAUTH_REGISTER_PATH) {
      return handleOAuthRegistrationRequest(request, env);
    }
    if (url.pathname === OAUTH_TOKEN_PATH) {
      return handleOAuthTokenRequest(request, env);
    }
    if (url.pathname === OAUTH_OPERATOR_CLIENT_PATH) {
      return handleOAuthOperatorClientRequest(request, env);
    }
    return handleProxyRequest(request, env);
  },
};

/**
 * Handles CORS preflight (OPTIONS) requests
 */
function handleOptions(request: Request): Response {
  let allowedHeaders: string;
  try {
    allowedHeaders = getAllowedRequestHeaders(
      request.headers.get('Access-Control-Request-Headers')
    );
  } catch (error) {
    return new Response(
      error instanceof Error ? error.message : 'Invalid CORS request headers.',
      {
        status: 400,
        headers: {
          ...getCorsHeaders(),
          'Vary': 'Access-Control-Request-Headers',
        },
      }
    );
  }

  return new Response(null, { 
    headers: {
      ...getCorsHeaders('proxy', allowedHeaders),
      'Access-Control-Max-Age': '86400', // Cache preflight for 24 hours
      'Vary': 'Access-Control-Request-Headers',
    }
  });
}

const MAX_CORS_REQUEST_HEADER_VALUE_LENGTH = 2048;
const MAX_CORS_REQUEST_HEADER_COUNT = 64;
const MAX_CORS_REQUEST_HEADER_NAME_LENGTH = 128;

function getAllowedRequestHeaders(requestedHeaders: string | null): string {
  const allowedHeaders = new Map(
    REQUIRED_CORS_REQUEST_HEADERS.map(header => [header.toLowerCase(), header])
  );

  if (requestedHeaders) {
    if (requestedHeaders.length > MAX_CORS_REQUEST_HEADER_VALUE_LENGTH) {
      throw new Error('Error: Access-Control-Request-Headers value is too large.');
    }

    const requestedHeaderList = requestedHeaders.split(',');
    if (requestedHeaderList.length > MAX_CORS_REQUEST_HEADER_COUNT) {
      throw new Error('Error: Too many Access-Control-Request-Headers values.');
    }

    for (const requestedHeader of requestedHeaderList) {
      const header = requestedHeader.trim();
      if (
        !header
        || header.length > MAX_CORS_REQUEST_HEADER_NAME_LENGTH
        || !HTTP_HEADER_NAME_PATTERN.test(header)
      ) {
        throw new Error('Error: Invalid Access-Control-Request-Headers value.');
      }
      allowedHeaders.set(header.toLowerCase(), header);
    }
  }

  return Array.from(allowedHeaders.values()).join(', ');
}

/**
 * Returns standard CORS headers
 */
function getCorsHeaders(
  source: ProxyResponseSource = 'proxy',
  allowedHeaders = REQUIRED_CORS_REQUEST_HEADERS.join(', ')
): Record<string, string> {
  return {
    'Access-Control-Allow-Origin': '*',
    'Access-Control-Allow-Methods': 'GET, HEAD, POST, PUT, DELETE, OPTIONS',
    'Access-Control-Allow-Headers': allowedHeaders,
    'Access-Control-Expose-Headers': [
      PROXY_RESPONSE_SOURCE_HEADER,
      PROXY_LIMIT_HEADER,
      PROXY_LIMIT_KIND_HEADER,
      'Retry-After',
    ].join(', '),
    [PROXY_RESPONSE_SOURCE_HEADER]: source,
  };
}

/**
 * Verifies a Firebase JWT token
 */
async function verifyFirebaseToken(token: string, projectId: string): Promise<string | null> {
  try {
    console.log("[DEBUG] Starting JWT token verification");
    
    // Parse the token
    const parts = token.split('.');
    if (parts.length !== 3) {
      console.log("[DEBUG] Token has invalid format - expected 3 parts, got", parts.length);
      return null;
    }

    // Decode header and payload
    const header = JSON.parse(atob(parts[0]));
    const payload = JSON.parse(atob(parts[1]));
    console.log("[DEBUG] Token header:", JSON.stringify(header));
    console.log("[DEBUG] Token payload (user ID):", payload.sub || payload.user_id);
    
    // Check token expiration
    const now = Math.floor(Date.now() / 1000);
    if (payload.exp && payload.exp < now) {
      console.log("[DEBUG] Token expired");
      return null;
    }
    
    // Check token not before time
    if (payload.nbf && payload.nbf > now) {
      console.log("[DEBUG] Token not yet valid");
      return null;
    }
    
    // Validate issuer
    const expectedIssuer = `https://securetoken.google.com/${projectId}`;
    if (payload.iss !== expectedIssuer) {
      console.log("[DEBUG] Invalid issuer");
      return null;
    }
    
    // Validate audience
    if (payload.aud !== projectId) {
      console.log("[DEBUG] Invalid audience");
      return null;
    }
    
    // Get the signing key
    const publicKeys = await getFirebasePublicKeys();
    console.log('[DEBUG] Available key IDs:', Object.keys(publicKeys));
    console.log('[DEBUG] Looking for key ID:', header.kid);
    
    const key = publicKeys[header.kid];
    if (!key) {
      console.log('[DEBUG] Key not found! Available keys:', Object.keys(publicKeys));
      return null;
    }
    console.log('[DEBUG] Found key for ID:', header.kid);
    
    // Verify the signature
    const isValid = await verifySignature(token, key);
    if (!isValid) {
      console.log('[DEBUG] Invalid signature');
      return null;
    }
    
    // Extract user ID
    const userId = payload.sub || payload.user_id;
    if (!userId) {
      console.log('[DEBUG] No user ID in token');
      return null;
    }
    
    return userId;
  } catch (error) {
    console.error('Token verification error:', error);
    return null;
  }
}

/**
 * Get Firebase public keys with caching
 */
async function getFirebasePublicKeys(): Promise<Record<string, string>> {
  const now = Date.now();
  
  // Check if we have cached keys that haven't expired
  if (publicKeysCache && now < publicKeysCacheExpiry) {
    return publicKeysCache;
  }
  
  // Fetch new keys
  const response = await fetch(FIREBASE_PUBLIC_KEYS_URL);
  if (!response.ok) {
    throw new Error('Failed to fetch Firebase public keys');
  }
  
  const keys: unknown = await response.json();
  if (
    !keys ||
    typeof keys !== 'object' ||
    Array.isArray(keys) ||
    !Object.values(keys).every((value) => typeof value === 'string')
  ) {
    throw new Error('Firebase public-key response had an invalid shape');
  }
  const publicKeys = keys as Record<string, string>;
  
  // Cache the keys with expiry from cache-control header
  const cacheControl = response.headers.get('cache-control');
  const maxAgeMatch = cacheControl?.match(/max-age=(\d+)/);
  const maxAge = maxAgeMatch ? parseInt(maxAgeMatch[1]) : 3600; // Default 1 hour
  
  publicKeysCache = publicKeys;
  publicKeysCacheExpiry = now + (maxAge * 1000);
  
  return publicKeys;
}

/**
 * Verify JWT signature using Web Crypto API
 */
async function verifySignature(token: string, publicKeyPem: string): Promise<boolean> {
  try {
    const [headerB64, payloadB64, signatureB64] = token.split('.');
    const message = `${headerB64}.${payloadB64}`;
    
    console.log('[DEBUG] Verifying signature for token with header:', headerB64);
    
    // Convert base64url to base64
    const signature = Uint8Array.from(atob(signatureB64.replace(/-/g, '+').replace(/_/g, '/')), c => c.charCodeAt(0));
    console.log('[DEBUG] Signature length:', signature.length);
    
    // Convert PEM to crypto key
    const publicKey = await importPublicKey(publicKeyPem);
    console.log('[DEBUG] Successfully imported public key');
    
    // Verify the signature
    const encoder = new TextEncoder();
    const data = encoder.encode(message);
    
    const isValid = await crypto.subtle.verify(
      {
        name: 'RSASSA-PKCS1-v1_5',
        hash: 'SHA-256',
      },
      publicKey,
      signature,
      data
    );
    
    console.log('[DEBUG] Signature verification result:', isValid);
    return isValid;
  } catch (error) {
    console.error('Signature verification error:', error);
    if (error instanceof Error) {
      console.error('[DEBUG] Error stack:', error.stack);
    }
    return false;
  }
}

/**
 * Import PEM certificate and extract public key for Web Crypto API
 */
async function importPublicKey(pem: string): Promise<CryptoKey> {
  try {
    // Remove PEM headers and whitespace
    const pemContents = pem
      .replace(/-----BEGIN CERTIFICATE-----/g, '')
      .replace(/-----END CERTIFICATE-----/g, '')
      .replace(/\s/g, '');
    
    const binaryDer = Uint8Array.from(atob(pemContents), c => c.charCodeAt(0));
    
    // Parse the certificate to extract the public key
    // Since Cloudflare Workers doesn't support 'x509' format directly,
    // we need to manually extract the RSA public key from the certificate
    const publicKeyInfo = extractPublicKeyFromCertificate(binaryDer);
    
    // Import the extracted public key
    const publicKey = await crypto.subtle.importKey(
      'spki',
      publicKeyInfo,
      {
        name: 'RSASSA-PKCS1-v1_5',
        hash: 'SHA-256',
      },
      false,
      ['verify']
    );
    
    return publicKey;
  } catch (error) {
    console.error('Failed to import public key:', error);
    throw new Error('Failed to import public key from certificate');
  }
}

/**
 * Extract the public key from an X.509 certificate
 */
function extractPublicKeyFromCertificate(certDer: Uint8Array): ArrayBuffer {
  // This is a simplified ASN.1 parser to extract the SubjectPublicKeyInfo
  // from an X.509 certificate
  let offset = 0;
  
  // Helper function to read ASN.1 length
  function readLength(data: Uint8Array, pos: number): { length: number; bytesRead: number } {
    let length = data[pos];
    let bytesRead = 1;
    
    if (length & 0x80) {
      const numBytes = length & 0x7f;
      length = 0;
      for (let i = 0; i < numBytes; i++) {
        length = (length << 8) | data[pos + 1 + i];
      }
      bytesRead += numBytes;
    }
    
    return { length, bytesRead };
  }
  
  // Helper function to find a sequence
  function findSequence(data: Uint8Array, startPos: number): { pos: number; length: number; totalBytes: number } | null {
    let pos = startPos;
    while (pos < data.length - 1) {
      if (data[pos] === 0x30) { // SEQUENCE tag
        const { length, bytesRead } = readLength(data, pos + 1);
        return { pos, length, totalBytes: 1 + bytesRead + length };
      }
      pos++;
    }
    return null;
  }
  
  // The certificate is a SEQUENCE
  const cert = findSequence(certDer, 0);
  if (!cert) throw new Error('Invalid certificate format');
  
  // TBSCertificate is the first element in the certificate SEQUENCE
  const tbsCert = findSequence(certDer, cert.pos + 1);
  if (!tbsCert) throw new Error('Invalid certificate format');
  
  // Skip through the TBSCertificate fields to find SubjectPublicKeyInfo
  // Fields: version, serialNumber, signature, issuer, validity, subject
  let currentPos = tbsCert.pos + 1;
  
  // Skip version (if present - it's optional and tagged [0])
  if (certDer[currentPos] === 0xa0) {
    const { length, bytesRead } = readLength(certDer, currentPos + 1);
    currentPos += 1 + bytesRead + length;
  }
  
  // Skip serialNumber (INTEGER)
  if (certDer[currentPos] === 0x02) {
    const { length, bytesRead } = readLength(certDer, currentPos + 1);
    currentPos += 1 + bytesRead + length;
  }
  
  // Skip signature (SEQUENCE)
  const sig = findSequence(certDer, currentPos);
  if (sig) currentPos = sig.pos + sig.totalBytes;
  
  // Skip issuer (SEQUENCE)
  const issuer = findSequence(certDer, currentPos);
  if (issuer) currentPos = issuer.pos + issuer.totalBytes;
  
  // Skip validity (SEQUENCE)
  const validity = findSequence(certDer, currentPos);
  if (validity) currentPos = validity.pos + validity.totalBytes;
  
  // Skip subject (SEQUENCE)
  const subject = findSequence(certDer, currentPos);
  if (subject) currentPos = subject.pos + subject.totalBytes;
  
  // Now we should be at SubjectPublicKeyInfo (SEQUENCE)
  const spki = findSequence(certDer, currentPos);
  if (!spki) throw new Error('SubjectPublicKeyInfo not found');
  
  // Extract the SubjectPublicKeyInfo
  return certDer.slice(spki.pos, spki.pos + spki.totalBytes).buffer;
}
