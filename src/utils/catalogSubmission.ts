/**
 * Shared rules for in-app catalog submissions.
 *
 * The /submit form, the Worker route (cloudflare-worker/src/submissions.js) and
 * the workflow script (scripts/apply-catalog-submission.ts) all import this file,
 * so a submission is judged by the same URL, id and evidence rules everywhere.
 * It has no runtime dependencies and no network access.
 */
import serverCatalog from '../data/serverCatalog.json';
import type { CatalogServerSeed } from '../types/catalog';

export const CATALOG_SUBMISSION_SCHEMA_URL = 'https://mcptest.io/schemas/catalog-submission/v1.schema.json' as const;
export const CATALOG_SUBMISSION_API_PATH = '/api/catalog/submissions';
export const CATALOG_SUBMISSION_DISPATCH_EVENT = 'catalog-submission';
export const CATALOG_SUBMISSION_DOCS_URL = 'https://github.com/integry/mcptest/blob/master/docs/catalog-submissions.md';

export const CATALOG_SUBMISSION_LIMITS = {
  url: 2048,
  name: 60,
  description: 300,
  email: 254,
} as const;

/** License statement for an optional logo URL. `none` means a generated monogram is used. */
export type CatalogSubmissionLogoLicense = 'official-brand' | 'simple-icons' | 'none';

export const CATALOG_SUBMISSION_LOGO_LICENSES: readonly {
  value: CatalogSubmissionLogoLicense;
  label: string;
}[] = [
  { value: 'none', label: 'No logo. Use a generated monogram' },
  { value: 'official-brand', label: "From the publisher's official brand asset page" },
  { value: 'simple-icons', label: 'From Simple Icons (pinned release URL)' },
];

/** Categories already used by the catalog; a submission must pick one of them. */
export const CATALOG_SUBMISSION_CATEGORIES: readonly string[] = Array.from(
  new Set((serverCatalog as CatalogServerSeed[]).map((seed) => seed.category))
).sort((left, right) => left.localeCompare(right));

/** Kind of authentication challenge the browser observed instead of an MCP handshake. */
export type CatalogSubmissionAuthChallenge = 'none' | 'oauth' | 'bearer' | 'unspecified';

/** Browser-side probe result attached to a submission as evidence. */
export interface CatalogSubmissionEvidence {
  /** When the browser probe finished (ISO timestamp). */
  checkedAt: string;
  /** Exact endpoint the user asked to check. */
  endpointUrl: string;
  /** `mcp` when a handshake completed, `auth-challenge` when the target asked for credentials. */
  outcome: 'mcp' | 'auth-challenge' | 'unreachable';
  /** Endpoint that answered, which can be a /mcp or /sse sibling of endpointUrl. */
  validatedUrl?: string;
  transport?: 'streamable-http' | 'legacy-sse';
  protocolVersion?: string;
  /** MCP lifecycle negotiated by the browser client. */
  protocolEra?: 'stateless' | 'stateful';
  authChallenge: CatalogSubmissionAuthChallenge;
  /** HTTP status of the challenge, when the browser could read it. */
  authStatus?: number;
  /** `direct` when the browser read the response itself, `proxy-required` when CORS blocked it. */
  browserAccess: 'direct' | 'proxy-required' | 'unknown';
  /** Number of tools listed without credentials. */
  toolCount?: number;
  /** Short human-readable summary. */
  detail: string;
}

/** Payload of POST /api/catalog/submissions (see public/schemas/catalog-submission/v1.schema.json). */
export interface CatalogSubmission {
  $schema: typeof CATALOG_SUBMISSION_SCHEMA_URL;
  url: string;
  name: string;
  description: string;
  category: string;
  homepageUrl: string;
  logoLicense: CatalogSubmissionLogoLicense;
  logoUrl?: string;
  /** Passed only to the maintainer through the workflow; never stored or returned. */
  contactEmail?: string;
  authorized: true;
  evidence: CatalogSubmissionEvidence;
  /** Cloudflare Turnstile response, required only when the Worker has TURNSTILE_SECRET. */
  turnstileToken?: string;
}

export interface CatalogSubmissionResponse {
  submissionId: string;
  proposedCatalogId: string;
  status: 'queued';
  nextStep: string;
  docsUrl: string;
}

// Names that never resolve to a public host, or that are reserved for tests and examples.
const RESERVED_HOST_SUFFIXES = [
  'localhost', 'local', 'localdomain', 'internal', 'intranet', 'lan', 'home', 'corp',
  'home.arpa', 'test', 'example', 'invalid', 'onion',
];
const IPV4_LITERAL = /^\d{1,3}(?:\.\d{1,3}){3}$/;

/** True for hosts a public catalog must not list: IP literals, single labels and reserved names. */
export const isPrivateOrReservedHost = (hostname: string): boolean => {
  const host = hostname.toLowerCase().replace(/\.$/, '');
  if (!host || host.startsWith('[') || host.includes(':') || IPV4_LITERAL.test(host)) return true;
  if (!host.includes('.')) return true;
  return RESERVED_HOST_SUFFIXES.some((suffix) => host === suffix || host.endsWith(`.${suffix}`))
    || /^(?:example\.(?:com|net|org))$/.test(host);
};

/**
 * Returns why `value` cannot be listed, or undefined when it is a public HTTPS
 * endpoint without credentials. `label` names the field in the message.
 */
export const getSubmissionUrlError = (value: unknown, label = 'Endpoint URL'): string | undefined => {
  if (typeof value !== 'string' || value.trim() === '') return `${label} is required.`;
  if (value.length > CATALOG_SUBMISSION_LIMITS.url) return `${label} is too long.`;
  let url: URL;
  try {
    url = new URL(value.trim());
  } catch {
    return `${label} is not a valid URL.`;
  }
  if (url.protocol !== 'https:') return `${label} must use HTTPS.`;
  if (url.username || url.password) return `${label} must not contain credentials.`;
  if (isPrivateOrReservedHost(url.hostname)) return `${label} must use a public host name, not a private, local or IP address.`;
  return undefined;
};

/** Endpoint-specific rule on top of getSubmissionUrlError: no query or fragment, which often carry keys. */
export const getSubmissionEndpointError = (value: unknown): string | undefined => {
  const error = getSubmissionUrlError(value);
  if (error) return error;
  const url = new URL((value as string).trim());
  if (url.search || url.hash) return 'Endpoint URL must not contain a query string or fragment. Those often carry credentials.';
  return undefined;
};

/**
 * Normalizes an endpoint for duplicate detection: lowercase host without `www.`
 * or the default port, and a path without trailing slashes or a final /mcp or
 * /sse segment (the catalog validator probes those siblings as the same server).
 */
export const normalizeCatalogEndpoint = (value: string): string | undefined => {
  try {
    const url = new URL(value.trim());
    const host = url.hostname.toLowerCase().replace(/\.$/, '').replace(/^www\./, '');
    const port = url.port && url.port !== '443' ? `:${url.port}` : '';
    const path = url.pathname
      .replace(/\/+$/, '')
      .replace(/\/(?:mcp|sse)$/i, '')
      .replace(/\/+$/, '')
      .toLowerCase();
    return `${host}${port}${path}`;
  } catch {
    return undefined;
  }
};

const seedEndpoints = (seed: CatalogServerSeed): string[] => [
  seed.url,
  ...(seed.browserUrl ? [seed.browserUrl] : []),
  ...(seed.alternativeEndpoints || []).map((endpoint) => endpoint.url),
];

/** Returns the catalog entry that already lists this endpoint, if any. */
export const findCatalogDuplicate = (
  value: string,
  seeds: readonly CatalogServerSeed[] = serverCatalog as CatalogServerSeed[]
): CatalogServerSeed | undefined => {
  const normalized = normalizeCatalogEndpoint(value);
  if (!normalized) return undefined;
  return seeds.find((seed) => seedEndpoints(seed).some((endpoint) => normalizeCatalogEndpoint(endpoint) === normalized));
};

// Shared hosting domains: the subdomain names the server, not the platform.
const SHARED_HOSTING_SUFFIXES = [
  'workers.dev', 'pages.dev', 'vercel.app', 'netlify.app', 'onrender.com', 'fly.dev',
  'herokuapp.com', 'github.io', 'deno.dev', 'railway.app', 'azurewebsites.net',
  'run.app', 'modal.run', 'replit.app', 'smithery.ai',
];
const GENERIC_LABELS = new Set(['www', 'mcp', 'api', 'server', 'servers', 'remote', 'app', 'gateway', 'sse']);
const SECOND_LEVEL_TLD_LABELS = new Set(['co', 'com', 'org', 'net', 'ac', 'gov', 'edu']);

const slugify = (value: string): string => value
  .toLowerCase()
  .replace(/[^a-z0-9]+/g, '-')
  .replace(/^-+|-+$/g, '')
  .slice(0, 48)
  .replace(/-+$/g, '');

/**
 * Derives a catalog id from the endpoint host, for example
 * `https://mcp.acme.com/mcp` → `acme`. Generic labels such as `mcp` and `api`
 * and the public suffix are dropped. The id is made unique against `existingIds`
 * by appending `-2`, `-3` and so on.
 */
export const deriveCatalogId = (
  value: string,
  existingIds: Iterable<string> = (serverCatalog as CatalogServerSeed[]).map((seed) => seed.id)
): string => {
  const taken = new Set(existingIds);
  let host = '';
  try {
    host = new URL(value).hostname.toLowerCase().replace(/\.$/, '');
  } catch {
    host = '';
  }
  let labels = host.split('.').filter(Boolean);
  const sharedSuffix = SHARED_HOSTING_SUFFIXES.find((suffix) => host.endsWith(`.${suffix}`));
  if (sharedSuffix) {
    labels = host.slice(0, -(sharedSuffix.length + 1)).split('.');
  } else if (labels.length > 1) {
    labels = labels.slice(0, -1);
    const last = labels[labels.length - 1];
    if (labels.length > 1 && host.split('.').pop()!.length === 2 && SECOND_LEVEL_TLD_LABELS.has(last)) {
      labels = labels.slice(0, -1);
    }
  }
  const meaningful = labels.filter((label) => !GENERIC_LABELS.has(label));
  const base = slugify((meaningful.length > 0 ? meaningful : labels).reverse().join('-')) || 'server';
  if (!taken.has(base)) return base;
  for (let suffix = 2; ; suffix += 1) {
    const candidate = `${base.slice(0, 44)}-${suffix}`;
    if (!taken.has(candidate)) return candidate;
  }
};

/**
 * True when a probe result may be submitted: the endpoint completed an MCP
 * handshake, or the target itself answered with a recognized authentication
 * challenge. The evidence must belong to the endpoint being submitted.
 */
export const isSubmittableEvidence = (
  evidence: CatalogSubmissionEvidence | undefined,
  endpointUrl?: string
): boolean => {
  if (!evidence) return false;
  if (endpointUrl !== undefined && evidence.endpointUrl.trim() !== endpointUrl.trim()) return false;
  if (evidence.outcome === 'mcp') return true;
  return evidence.outcome === 'auth-challenge' && evidence.authChallenge !== 'none';
};

const EMAIL_PATTERN = /^[^\s@<>()"',;:]+@[^\s@<>()"',;:]+\.[^\s@<>()"',;:]{2,}$/;

/** Form-level field errors for a draft submission, keyed by field name. */
export type CatalogSubmissionFieldErrors = Partial<Record<
  'url' | 'name' | 'description' | 'category' | 'homepageUrl' | 'logoUrl' | 'logoLicense' | 'contactEmail' | 'authorized',
  string
>>;

export interface CatalogSubmissionDraft {
  url: string;
  name: string;
  description: string;
  category: string;
  homepageUrl: string;
  logoUrl: string;
  logoLicense: CatalogSubmissionLogoLicense | '';
  contactEmail: string;
  authorized: boolean;
}

const isPlainText = (value: string): boolean => !/[\u0000-\u001f\u007f<>]/.test(value);

/** Mirrors the JSON Schema rules so the form explains problems before the Worker rejects them. */
export const validateCatalogSubmissionDraft = (draft: CatalogSubmissionDraft): CatalogSubmissionFieldErrors => {
  const errors: CatalogSubmissionFieldErrors = {};
  const urlError = getSubmissionEndpointError(draft.url);
  if (urlError) errors.url = urlError;

  const name = draft.name.trim();
  if (!name) errors.name = 'Display name is required.';
  else if (name.length > CATALOG_SUBMISSION_LIMITS.name) errors.name = `Keep the name under ${CATALOG_SUBMISSION_LIMITS.name} characters.`;
  else if (!isPlainText(name)) errors.name = 'Use plain text without angle brackets or control characters.';

  const description = draft.description.trim().replace(/\s+/g, ' ');
  if (description.length < 20) errors.description = 'Describe what the server exposes in one or two sentences.';
  else if (description.length > CATALOG_SUBMISSION_LIMITS.description) errors.description = `Keep the description under ${CATALOG_SUBMISSION_LIMITS.description} characters.`;
  else if (!isPlainText(description)) errors.description = 'Use plain text without angle brackets or control characters.';

  if (!CATALOG_SUBMISSION_CATEGORIES.includes(draft.category)) errors.category = 'Choose a category.';

  const homepageError = getSubmissionUrlError(draft.homepageUrl, 'Homepage URL');
  if (homepageError) errors.homepageUrl = homepageError;

  if (!draft.logoLicense) {
    errors.logoLicense = 'Choose a logo license statement.';
  } else if (draft.logoLicense === 'none') {
    if (draft.logoUrl.trim()) errors.logoUrl = 'Remove the logo URL or choose where the logo comes from.';
  } else {
    const logoError = getSubmissionUrlError(draft.logoUrl, 'Logo URL');
    if (logoError) errors.logoUrl = logoError;
  }

  const email = draft.contactEmail.trim();
  if (email && (email.length > CATALOG_SUBMISSION_LIMITS.email || !EMAIL_PATTERN.test(email))) {
    errors.contactEmail = 'Enter a valid email address or leave it empty.';
  }
  if (!draft.authorized) errors.authorized = 'Confirm that you are authorized to list this server.';
  return errors;
};

/** Builds the request body from a valid draft and its probe evidence. */
export const buildCatalogSubmission = (
  draft: CatalogSubmissionDraft,
  evidence: CatalogSubmissionEvidence,
  turnstileToken?: string
): CatalogSubmission => ({
  $schema: CATALOG_SUBMISSION_SCHEMA_URL,
  url: draft.url.trim(),
  name: draft.name.trim(),
  description: draft.description.trim().replace(/\s+/g, ' '),
  category: draft.category,
  homepageUrl: draft.homepageUrl.trim(),
  logoLicense: draft.logoLicense as CatalogSubmissionLogoLicense,
  ...(draft.logoLicense !== 'none' && draft.logoUrl.trim() ? { logoUrl: draft.logoUrl.trim() } : {}),
  ...(draft.contactEmail.trim() ? { contactEmail: draft.contactEmail.trim() } : {}),
  authorized: true,
  evidence,
  ...(turnstileToken ? { turnstileToken } : {}),
});
