/**
 * Shared classifier for HTTP responses that are not the MCP server failing but
 * something in front of it, or a deliberate access gate:
 *
 * - `bot-protection`: a CDN, WAF or bot-management rule answered with a
 *   challenge or block page instead of letting the MCP client through.
 * - `rate-limited`: HTTP 429, with or without Retry-After.
 * - `payment-required`: HTTP 402, including x402.
 *
 * The connection flow, the OAuth and discovery checkers, catalog validation,
 * the submission probe and the CLI all call this module, so one response is
 * judged the same way everywhere. It has no runtime dependencies and never
 * guesses: each signature below is tied to vendor documentation, and the
 * result carries the status and the headers that matched as evidence.
 *
 * Signatures (keep this list small, documented and tested):
 *
 * | id | matches | source |
 * | --- | --- | --- |
 * | `cloudflare.cf-mitigated` | `cf-mitigated: challenge` | https://developers.cloudflare.com/cloudflare-challenges/challenge-types/challenge-pages/detect-response/ |
 * | `cloudflare.challenge-platform` | HTML that loads `/cdn-cgi/challenge-platform/` | https://developers.cloudflare.com/cloudflare-challenges/challenge-types/javascript-detections/ |
 * | `cloudflare.error-1020` | "Error 1020" / "Access denied" block page | https://developers.cloudflare.com/support/troubleshooting/http-status-codes/cloudflare-1xxx-errors/error-1020/ |
 * | `cloudflare.error-1015` | "Error 1015" / "You are being rate limited" (rate limit) | https://developers.cloudflare.com/support/troubleshooting/http-status-codes/cloudflare-1xxx-errors/error-1015/ |
 * | `vercel.security-checkpoint` | the "Vercel Security Checkpoint" challenge page | https://vercel.com/docs/vercel-firewall/firewall-concepts#challenge |
 * | `vercel.x-vercel-mitigated` | `x-vercel-mitigated: challenge` or `deny` on a 403/429 | Vercel Firewall deny/challenge actions (https://vercel.com/docs/vercel-firewall/firewall-concepts#firewall-actions); the header itself is what Vercel sends on those responses but is not listed on its response-headers page, so it only ever adds to a 4xx |
 * | `generic.html-403` | 403 with an HTML page, no WWW-Authenticate, where JSON or SSE was expected | heuristic, reported as `suspected` only |
 * | `x402.payment-required` | 402 with the `PAYMENT-REQUIRED` header (x402 v2) or an `x402Version` body (v1) | https://github.com/coinbase/x402/blob/main/specs/transports-v2/http.md |
 * | `http.402` | any other 402 | RFC 9110 §15.5.3 |
 * | `http.429` | any other 429 | RFC 6585 §4 |
 *
 * Deliberately not classified:
 * - a 401, or a 403 with WWW-Authenticate: that is an authentication challenge;
 * - 404 and other statuses: real errors that must stay visible as such;
 * - a plain 503 HTML page: hibernating or cold-starting hosts (Render, Fly,
 *   Heroku and similar) answer with vendor-specific pages and statuses that
 *   cannot be told apart from an outage reliably, so no class is claimed;
 * - `Server: cloudflare` or `cf-ray`: Cloudflare adds them to every response
 *   it serves, including the mcptest proxy's own, so they prove nothing.
 */

export type ResponseClass = 'bot-protection' | 'rate-limited' | 'payment-required';

/** `confirmed`: a documented vendor signature or the status itself. `suspected`: consistent, not proven. */
export type ResponseClassConfidence = 'confirmed' | 'suspected';

export type ResponseClassVendor = 'cloudflare' | 'vercel' | 'x402';

export type ResponseSignatureId =
  | 'cloudflare.cf-mitigated'
  | 'cloudflare.challenge-platform'
  | 'cloudflare.error-1020'
  | 'cloudflare.error-1015'
  | 'vercel.security-checkpoint'
  | 'vercel.x-vercel-mitigated'
  | 'generic.html-403'
  | 'x402.payment-required'
  | 'http.402'
  | 'http.429';

export interface ResponseClassification {
  kind: ResponseClass;
  confidence: ResponseClassConfidence;
  signature: ResponseSignatureId;
  vendor?: ResponseClassVendor;
  status: number;
  /** The response headers that matter for this class, lowercase names, bounded values. */
  headers: Record<string, string>;
  /** The short body marker that matched, when the signature is in the body. */
  bodyMarker?: string;
}

/**
 * Response headers the classifier reads. Proxies that forward target responses
 * must keep and expose these so a proxied response can still be classified.
 */
export const RESPONSE_CLASSIFICATION_HEADERS = [
  'content-type',
  'retry-after',
  'cf-mitigated',
  'x-vercel-mitigated',
  'payment-required',
] as const;

export type ResponseClassificationHeaderName = typeof RESPONSE_CLASSIFICATION_HEADERS[number];

/** Status codes for which a body prefix is worth reading. */
export const RESPONSE_CLASSIFICATION_STATUSES: ReadonlySet<number> = new Set([402, 403, 429, 503]);

/** Bytes of body read for signatures; challenge markers are in the document head. */
export const RESPONSE_CLASSIFICATION_BODY_BYTES = 16 * 1024;
const BODY_READ_TIMEOUT_MS = 250;
const MAX_HEADER_VALUE_LENGTH = 128;

export type HeaderSource =
  | Headers
  | Readonly<Record<string, string | readonly string[] | null | undefined>>
  | undefined;

export interface ResponseClassificationInput {
  status: number;
  headers?: HeaderSource;
  /** Overrides the content-type header, for callers that keep it separately. */
  contentType?: string;
  /** A bounded body prefix, when it was readable. */
  body?: string;
  /** Whether the WWW-Authenticate header was present; overrides headers. */
  hasWwwAuthenticate?: boolean;
}

const boundValue = (value: string): string => (
  value.replace(/[\u0000-\u001f\u007f]+/g, ' ').trim().slice(0, MAX_HEADER_VALUE_LENGTH)
);

const readHeader = (headers: HeaderSource, name: string): string | undefined => {
  if (!headers) return undefined;
  if (typeof Headers !== 'undefined' && headers instanceof Headers) {
    return headers.get(name) ?? undefined;
  }
  const record = headers as Record<string, string | readonly string[] | null | undefined>;
  for (const [key, value] of Object.entries(record)) {
    if (key.toLowerCase() !== name || value === undefined || value === null) continue;
    return Array.isArray(value) ? value.join(', ') : String(value);
  }
  return undefined;
};

/** The classification-relevant headers of a response, lowercase names and bounded values. */
export const pickClassificationHeaders = (headers: HeaderSource): Record<string, string> => {
  const picked: Record<string, string> = {};
  for (const name of RESPONSE_CLASSIFICATION_HEADERS) {
    const value = readHeader(headers, name);
    const bounded = value === undefined ? '' : boundValue(value);
    if (bounded) picked[name] = bounded;
  }
  return picked;
};

const mediaType = (contentType: string | undefined): string => (
  (contentType ?? '').split(';', 1)[0].trim().toLowerCase()
);

const isHtml = (contentType: string | undefined, body: string | undefined): boolean => (
  mediaType(contentType) === 'text/html'
  || mediaType(contentType) === 'application/xhtml+xml'
  || (!mediaType(contentType) && /^\s*(?:<!doctype\s+html|<html)/i.test(body ?? ''))
);

const isJsonOrSse = (contentType: string | undefined): boolean => {
  const type = mediaType(contentType);
  return type === 'application/json' || type.endsWith('+json') || type === 'text/event-stream';
};

interface BodySignature {
  id: ResponseSignatureId;
  kind: ResponseClass;
  vendor: ResponseClassVendor;
  pattern: RegExp;
  /** Markers that also require the page to name the vendor, so a lookalike page does not match. */
  vendorPattern?: RegExp;
  marker: string;
}

const BODY_SIGNATURES: readonly BodySignature[] = [
  {
    id: 'cloudflare.challenge-platform',
    kind: 'bot-protection',
    vendor: 'cloudflare',
    pattern: /\/cdn-cgi\/challenge-platform\//i,
    marker: '/cdn-cgi/challenge-platform/',
  },
  {
    id: 'cloudflare.error-1020',
    kind: 'bot-protection',
    vendor: 'cloudflare',
    pattern: /\berror(?:\s+code)?:?\s*1020\b/i,
    vendorPattern: /cloudflare/i,
    marker: 'Cloudflare error 1020 (Access denied)',
  },
  {
    id: 'cloudflare.error-1015',
    kind: 'rate-limited',
    vendor: 'cloudflare',
    pattern: /\berror(?:\s+code)?:?\s*1015\b/i,
    vendorPattern: /cloudflare/i,
    marker: 'Cloudflare error 1015 (You are being rate limited)',
  },
  {
    id: 'vercel.security-checkpoint',
    kind: 'bot-protection',
    vendor: 'vercel',
    pattern: /Vercel Security Checkpoint/i,
    marker: 'Vercel Security Checkpoint page',
  },
];

const X402_BODY = /"x402Version"\s*:/;

/**
 * Classifies one HTTP response. Returns undefined when the response is none of
 * the classes above, including every authentication challenge and every 404.
 */
export const classifyHttpResponse = (
  input: ResponseClassificationInput
): ResponseClassification | undefined => {
  const { status } = input;
  if (!Number.isInteger(status) || status < 400) return undefined;
  const headers = pickClassificationHeaders(input.headers);
  if (input.contentType) headers['content-type'] = boundValue(input.contentType);
  const contentType = headers['content-type'];
  const body = input.body;
  const hasWwwAuthenticate = input.hasWwwAuthenticate
    ?? Boolean(readHeader(input.headers, 'www-authenticate'));
  const result = (
    kind: ResponseClass,
    confidence: ResponseClassConfidence,
    signature: ResponseSignatureId,
    vendor?: ResponseClassVendor,
    bodyMarker?: string
  ): ResponseClassification => ({
    kind,
    confidence,
    signature,
    ...(vendor ? { vendor } : {}),
    status,
    headers,
    ...(bodyMarker ? { bodyMarker } : {}),
  });

  // An authentication challenge is never re-labelled as bot protection.
  if (status === 401 || (status === 403 && hasWwwAuthenticate)) return undefined;

  if (status === 402) {
    const x402 = Boolean(headers['payment-required']) || X402_BODY.test(body ?? '');
    return x402
      ? result('payment-required', 'confirmed', 'x402.payment-required', 'x402', headers['payment-required'] ? undefined : 'x402Version in the response body')
      : result('payment-required', 'confirmed', 'http.402');
  }

  if (headers['cf-mitigated']?.toLowerCase() === 'challenge') {
    return result('bot-protection', 'confirmed', 'cloudflare.cf-mitigated', 'cloudflare');
  }

  if (!RESPONSE_CLASSIFICATION_STATUSES.has(status)) return undefined;

  if (body && !isJsonOrSse(contentType)) {
    for (const signature of BODY_SIGNATURES) {
      if (!signature.pattern.test(body)) continue;
      if (signature.vendorPattern && !signature.vendorPattern.test(body)) continue;
      return result(signature.kind, 'confirmed', signature.id, signature.vendor, signature.marker);
    }
  }

  const vercelMitigated = headers['x-vercel-mitigated']?.toLowerCase();
  if ((status === 403 || status === 429) && (vercelMitigated === 'challenge' || vercelMitigated === 'deny')) {
    return result('bot-protection', 'confirmed', 'vercel.x-vercel-mitigated', 'vercel');
  }

  if (status === 429) return result('rate-limited', 'confirmed', 'http.429');

  if (status === 403 && isHtml(contentType, body)) {
    return result('bot-protection', 'suspected', 'generic.html-403', undefined, 'an HTML page where JSON or an event stream was expected');
  }
  return undefined;
};

/**
 * Reads at most `maxBytes` of a response clone for body signatures. The
 * original response is untouched. Returns undefined when nothing is readable
 * within a short deadline.
 */
export const readClassificationBody = async (
  response: Response,
  maxBytes = RESPONSE_CLASSIFICATION_BODY_BYTES
): Promise<string | undefined> => {
  let stream: ReadableStream<Uint8Array> | null;
  try {
    stream = response.clone().body;
  } catch {
    return undefined;
  }
  if (!stream) return undefined;
  const reader = stream.getReader();
  const chunks: Uint8Array[] = [];
  let size = 0;
  const timeout = setTimeout(() => {
    void reader.cancel().catch(() => {});
  }, BODY_READ_TIMEOUT_MS);
  try {
    while (size < maxBytes) {
      const { done, value } = await reader.read();
      if (done || !value) break;
      chunks.push(value.subarray(0, maxBytes - size));
      size += Math.min(value.byteLength, maxBytes - size);
    }
  } catch {
    // A cancelled or failed read leaves whatever arrived.
  } finally {
    clearTimeout(timeout);
    void reader.cancel().catch(() => {});
  }
  if (size === 0) return undefined;
  const bytes = new Uint8Array(size);
  let offset = 0;
  for (const chunk of chunks) {
    bytes.set(chunk, offset);
    offset += chunk.byteLength;
  }
  return new TextDecoder().decode(bytes);
};

/** Classifies a fetch Response, reading a bounded body prefix only for candidate statuses. */
export const classifyFetchResponse = async (
  response: Response
): Promise<ResponseClassification | undefined> => {
  if (response.status < 400) return undefined;
  const body = RESPONSE_CLASSIFICATION_STATUSES.has(response.status)
    ? await readClassificationBody(response).catch(() => undefined)
    : undefined;
  return classifyHttpResponse({ status: response.status, headers: response.headers, body });
};

const RESPONSE_CLASSES: ReadonlySet<string> = new Set(['bot-protection', 'rate-limited', 'payment-required']);

/** Type guard for classifications read back from JSON (reports, stored evidence). */
export const isResponseClassification = (value: unknown): value is ResponseClassification => {
  if (!value || typeof value !== 'object' || Array.isArray(value)) return false;
  const record = value as Record<string, unknown>;
  return typeof record.kind === 'string' && RESPONSE_CLASSES.has(record.kind)
    && (record.confidence === 'confirmed' || record.confidence === 'suspected')
    && typeof record.status === 'number'
    && typeof record.signature === 'string';
};

// ---------------------------------------------------------------------------
// Plain-language content for each class, shared by every surface.
// ---------------------------------------------------------------------------

export interface ResponseClassLearnLink {
  title: string;
  path: string;
}

export interface ResponseClassContent {
  /** Short label for badges and table cells. */
  label: string;
  /** Headline; `location` is the path that answered, e.g. /.well-known/oauth-protected-resource. */
  title: (location: string) => string;
  explanation: string;
  /** What to change, in one or two sentences. */
  fix: string;
  learnMore: ResponseClassLearnLink;
}

const VENDOR_NAMES: Record<ResponseClassVendor, string> = {
  cloudflare: 'Cloudflare',
  vercel: 'Vercel Firewall',
  x402: 'x402',
};

export const RESPONSE_CLASS_CONTENT: Record<ResponseClass, ResponseClassContent> = {
  'bot-protection': {
    label: 'Bot protection',
    title: (location) => `Bot protection is blocking MCP clients on ${location}`,
    explanation: 'A CDN, WAF or bot-management rule answered with a challenge or block page instead of passing the request to the MCP server. MCP clients are programs, not browsers, so they cannot solve a challenge; every client sees this as a failed connection or failed discovery even though the server itself may be fine.',
    fix: 'Exempt the MCP endpoint, its /.well-known/oauth-protected-resource and /.well-known/oauth-authorization-server documents and the token endpoint from challenge and block rules. Cloudflare: a WAF custom rule with the Skip action for those paths covers managed challenges and Super Bot Fight Mode; the free Bot Fight Mode cannot be skipped per path, so turn it off for the zone. Vercel: a Firewall bypass rule for those paths, and Attack Challenge Mode off. Rate-limit those paths instead of challenging them.',
    learnMore: { title: 'Deploying a remote MCP server', path: '/learn/deploy-remote-mcp-server' },
  },
  'rate-limited': {
    label: 'Rate limited',
    title: (location) => `Rate limit reached on ${location}`,
    explanation: 'The request was answered with HTTP 429 Too Many Requests. This is a limit, not a broken server: retry after the Retry-After wait, if one was sent.',
    fix: 'Wait and retry. Server operators should send Retry-After with every 429, expose it with Access-Control-Expose-Headers, and size limits so one client connection (initialize plus discovery and listing) does not trip them.',
    learnMore: {
      title: 'MCP transport diagnostics reference: HTTP 429',
      path: '/learn/mcp-transport-diagnostics-reference#transport-target-rate-limited-429',
    },
  },
  'payment-required': {
    label: 'Payment required',
    title: (location) => `Payment required on ${location}`,
    explanation: 'The server answered HTTP 402 Payment Required. It is reachable and working, but it charges for access (for example through x402), so mcptest cannot inspect it further without paying. This is not reported as a broken server.',
    fix: 'Nothing to fix if charging is intended: use a client that supports the server\'s payment method. If the endpoint should be free to inspect, stop returning 402 for initialize and discovery requests.',
    learnMore: {
      title: 'MCP transport diagnostics reference: HTTP 402',
      path: '/learn/mcp-transport-diagnostics-reference#transport-payment-required-402',
    },
  },
};

/** The path a classification refers to, for headlines: `/mcp`, `/.well-known/...`. */
export const responseLocation = (url: string | undefined): string => {
  if (!url) return 'this endpoint';
  try {
    const parsed = new URL(url);
    return parsed.pathname && parsed.pathname !== '/' ? parsed.pathname : parsed.host;
  } catch {
    return url;
  }
};

/** "HTTP 403, cf-mitigated: challenge, content-type: text/html" — the observed evidence, never a guess. */
export const describeResponseEvidence = (classification: ResponseClassification): string => {
  const parts = [`HTTP ${classification.status}`];
  for (const [name, value] of Object.entries(classification.headers)) {
    parts.push(`${name}: ${name === 'payment-required' && value.length > 48 ? `${value.slice(0, 48)}…` : value}`);
  }
  if (classification.bodyMarker) parts.push(`body: ${classification.bodyMarker}`);
  return parts.join(', ');
};

/** One sentence naming the class, the vendor when known, the evidence and the confidence. */
export const describeResponseClassification = (
  classification: ResponseClassification,
  url?: string
): string => {
  const content = RESPONSE_CLASS_CONTENT[classification.kind];
  const vendor = classification.vendor ? ` (${VENDOR_NAMES[classification.vendor]})` : '';
  const prefix = classification.confidence === 'suspected' ? 'Possibly: ' : '';
  return `${prefix}${content.title(responseLocation(url))}${vendor}. Observed ${describeResponseEvidence(classification)}.`;
};
