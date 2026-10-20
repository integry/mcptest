// Shared by the React app and the main Cloudflare Worker (bundled by wrangler).
// Keep it free of runtime imports so the worker bundle stays small.
//
// A published report lives in a Durable Object named by the normalized endpoint
// URL's hash. The permalink id embeds that endpoint key plus a prefix of the
// artifact's content hash, so `GET /r/<id>` needs no lookup index and identical
// runs for an endpoint share one permalink.

export const PUBLISHED_REPORT_RETENTION = 20;
/** Largest accepted artifact body in bytes. Artifacts are stored in 96 KiB chunks. */
export const PUBLISHED_REPORT_MAX_BYTES = 512 * 1024;
export const PUBLISHED_REPORT_ENDPOINT_KEY_LENGTH = 20;
export const PUBLISHED_REPORT_CONTENT_HASH_LENGTH = 20;

const PUBLISHED_REPORT_ID_PATTERN = new RegExp(
  `^([a-f0-9]{${PUBLISHED_REPORT_ENDPOINT_KEY_LENGTH}})-([a-f0-9]{${PUBLISHED_REPORT_CONTENT_HASH_LENGTH}})$`
);

const isPrivateHostname = (hostname: string): boolean => (
  hostname === 'localhost'
  || hostname.endsWith('.localhost')
  || hostname.endsWith('.local')
  || /^\d{1,3}(?:\.\d{1,3}){3}$/.test(hostname)
  || hostname.startsWith('[')
);

/**
 * Canonical identity of an endpoint for publishing: http(s) only, lowercase
 * host, no credentials and no fragment. Returns undefined when the endpoint is
 * not publishable (unparseable, non-http, loopback, IP literal or local host).
 */
export const normalizePublishedEndpoint = (endpoint: string): string | undefined => {
  let url: URL;
  try {
    url = new URL(endpoint.trim());
  } catch {
    return undefined;
  }
  if (url.protocol !== 'https:' && url.protocol !== 'http:') return undefined;
  if (!url.hostname || isPrivateHostname(url.hostname)) return undefined;
  url.hostname = url.hostname.toLowerCase();
  url.username = '';
  url.password = '';
  url.hash = '';
  return url.toString();
};

const toHex = (bytes: ArrayBuffer): string => (
  Array.from(new Uint8Array(bytes), (byte) => byte.toString(16).padStart(2, '0')).join('')
);

export const sha256Hex = async (text: string): Promise<string> => (
  toHex(await crypto.subtle.digest('SHA-256', new TextEncoder().encode(text)))
);

/** Durable Object name and permalink prefix for a normalized endpoint. */
export const publishedEndpointKey = async (normalizedEndpoint: string): Promise<string> => (
  (await sha256Hex(normalizedEndpoint)).slice(0, PUBLISHED_REPORT_ENDPOINT_KEY_LENGTH)
);

const stableValue = (value: unknown): unknown => {
  if (Array.isArray(value)) return value.map(stableValue);
  if (value && typeof value === 'object') {
    return Object.fromEntries(
      Object.keys(value as Record<string, unknown>).sort()
        .map((key) => [key, stableValue((value as Record<string, unknown>)[key])])
    );
  }
  return value;
};

/** Keys ignored by the content hash so a re-run that only differs in clocks is the same snapshot. */
export const PUBLISHED_REPORT_HASH_IGNORED_KEYS = ['generatedAt', 'timings'] as const;

/** Hash of the artifact with run-specific clocks removed; identical runs share one snapshot. */
export const publishedReportContentHash = async (artifact: Record<string, unknown>): Promise<string> => {
  const comparable = Object.fromEntries(
    Object.entries(artifact).filter(([key]) => (
      !(PUBLISHED_REPORT_HASH_IGNORED_KEYS as readonly string[]).includes(key)
    ))
  );
  return sha256Hex(JSON.stringify(stableValue(comparable)));
};

export const publishedReportId = (endpointKey: string, contentHash: string): string => (
  `${endpointKey}-${contentHash.slice(0, PUBLISHED_REPORT_CONTENT_HASH_LENGTH)}`
);

export const parsePublishedReportId = (
  id: string
): { endpointKey: string; contentHashPrefix: string } | undefined => {
  const match = PUBLISHED_REPORT_ID_PATTERN.exec(id);
  return match ? { endpointKey: match[1], contentHashPrefix: match[2] } : undefined;
};

/** Public per-snapshot metadata returned by the index route and embedded in publish responses. */
export interface PublishedReportSummary {
  status: 'scored' | 'authorization-required' | 'partial' | 'failed';
  releaseStatus?: 'ready' | 'blocked' | 'review' | 'authorization-required' | 'unknown';
  scorePercentage?: number;
  generatedAt: string;
  generatorVersion?: string;
}

export interface PublishedReportEntry {
  id: string;
  endpoint: string;
  createdAt: string;
  lastPublishedAt: string;
  contentHash: string;
  summary: PublishedReportSummary;
}

export const summarizePublishedArtifact = (artifact: Record<string, unknown>): PublishedReportSummary => {
  const outcome = artifact.outcome as { status?: PublishedReportSummary['status'] } | undefined;
  const release = artifact.releaseDecision as { status?: PublishedReportSummary['releaseStatus'] } | undefined;
  const score = artifact.score as { percentage?: number } | null | undefined;
  const generator = artifact.generator as { version?: string } | undefined;
  return {
    status: outcome?.status ?? 'failed',
    ...(release?.status ? { releaseStatus: release.status } : {}),
    ...(typeof score?.percentage === 'number' ? { scorePercentage: score.percentage } : {}),
    generatedAt: typeof artifact.generatedAt === 'string' ? artifact.generatedAt : '',
    ...(generator?.version ? { generatorVersion: generator.version } : {}),
  };
};
