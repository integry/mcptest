// Public report permalinks:
//   POST   /r                          publish a redacted report artifact (anonymous, rate-limited)
//   GET    /r/<id>                     the stored artifact as JSON (noindex)
//   DELETE /r/<id>                     remove a snapshot with the token returned at publish time
//   GET    /r/endpoint/<encoded url>   published snapshot index for an endpoint
//   GET    /badge/report/<encoded url>.svg   badge for the latest published snapshot
//   POST   /r/<id>/watch               turn the weekly watch on or off with that snapshot's removal token
//   GET    /r/<encoded url>/changes.xml      Atom feed of the weekly watch's classified changes
//
// POST /r?watch=weekly opts the endpoint into the weekly watch while publishing
// (see ./weeklyWatch.js); the artifact itself is unchanged by the option.
//
// Publishing accepts only the redacted public artifact: the body must validate
// against public/schemas/report/v2.schema.json and pass the redaction guard, and
// what is stored is the body run through the Worker's port of the app's
// redaction transform, so an input that slips past the guard is still stored
// redacted. The transformed artifact is then scanned by the guard again and is
// stored only when that scan finds nothing, so a stored artifact always passes
// the guard. Identity (content hash, permalink id) is derived from the stored form.
//
// Both resource bounds are enforced before any rate-limit or storage work: the
// body is read from the stream and dropped with 413 as soon as it exceeds the
// size limit, and the guard runs and the transform share one inspection budget
// per request, past which the artifact is refused as uninspectable (422).
import reportSchema from '../../public/schemas/report/v2.schema.json';
import { getBadgeVariantForResult, renderBadgeSvg } from '../../src/utils/badges.ts';
import {
  PUBLISHED_REPORT_MAX_BYTES,
  PUBLISHED_REPORT_RETENTION,
  normalizePublishedEndpoint,
  parsePublishedReportId,
  publishedEndpointKey,
  publishedReportContentHash,
  publishedReportId,
  sha256Hex,
  summarizePublishedArtifact,
} from '../../src/utils/publishedReportIdentity.ts';
import { KNOWN_BADGE_CACHE_CONTROL, UNKNOWN_BADGE_CACHE_CONTROL } from './badges.js';
import { compileSchema } from './jsonSchema.js';
import { findUnredactedSecret } from './redactionGuard.js';
import { renderChangesFeed, setEndpointWatch } from './weeklyWatch.js';
import {
  InspectionBudgetExceededError,
  createInspectionBudget,
  redactReportValue,
  withInspectionBudget,
} from './reportRedaction.js';

export const PUBLISH_RATE_LIMITS = {
  host: { limit: 10, windowMs: 60 * 60 * 1000 },
  ip: { limit: 30, windowMs: 60 * 60 * 1000 },
};
export const PUBLISHED_REPORT_CACHE_CONTROL = 'public, max-age=300, s-maxage=300';
export const PUBLISHED_INDEX_CACHE_CONTROL = 'public, max-age=60, s-maxage=60';
export const CHANGES_FEED_CACHE_CONTROL = 'public, max-age=900, s-maxage=900';
const ROBOTS_HEADER = 'noindex, nofollow';
const REMOVAL_TOKEN_HEADER = 'X-Removal-Token';
const ALLOWED_WRITE_ORIGINS = /^https:\/\/mcptest\.io$|^http:\/\/(?:localhost|127\.0\.0\.1)(?::\d+)?$/;

const validateReport = compileSchema(reportSchema);

const corsHeaders = (request, methods) => {
  const origin = request.headers.get('Origin');
  return {
    'Access-Control-Allow-Origin': methods === 'GET, HEAD, OPTIONS' || !origin
      ? '*'
      : ALLOWED_WRITE_ORIGINS.test(origin) ? origin : 'https://mcptest.io',
    'Access-Control-Allow-Methods': methods,
    'Access-Control-Allow-Headers': `Content-Type, ${REMOVAL_TOKEN_HEADER}`,
    'Access-Control-Expose-Headers': 'Retry-After, X-Badge-Result',
    'Access-Control-Max-Age': '86400',
    Vary: 'Origin',
  };
};

const jsonResponse = (request, body, status, methods, extraHeaders = {}) => new Response(
  request.method === 'HEAD' ? null : JSON.stringify(body),
  {
    status,
    headers: {
      'Content-Type': 'application/json; charset=utf-8',
      'X-Robots-Tag': ROBOTS_HEADER,
      'X-Content-Type-Options': 'nosniff',
      'Cache-Control': 'no-store',
      ...corsHeaders(request, methods),
      ...extraHeaders,
    },
  }
);

const errorResponse = (request, status, error, message, methods = 'GET, HEAD, OPTIONS', extraHeaders = {}) => (
  jsonResponse(request, { error, message }, status, methods, extraHeaders)
);

const endpointStub = (env, endpointKey) => env.PUBLISHED_REPORTS.get(
  env.PUBLISHED_REPORTS.idFromName(`endpoint:${endpointKey}`)
);

const callStub = (stub, path, init) => stub.fetch(new Request(`https://published-reports${path}`, init));

const checkRateLimit = async (env, scope, value, now) => {
  const stub = env.PUBLISHED_REPORTS.get(env.PUBLISHED_REPORTS.idFromName(`rate:${scope}:${value}`));
  const response = await callStub(stub, '/rate-limit', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ ...PUBLISH_RATE_LIMITS[scope], now }),
  });
  return response.json();
};

const randomToken = () => {
  const bytes = new Uint8Array(32);
  crypto.getRandomValues(bytes);
  return btoa(String.fromCharCode(...bytes)).replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '');
};

/**
 * Reads the body within the size limit. A declared Content-Length past the
 * limit is refused before anything is read; otherwise the stream is consumed
 * chunk by chunk, counting bytes, and cancelled the moment the running total
 * exceeds the limit, so no more than the limit is ever buffered whatever the
 * sender streams or declares.
 */
const readBody = async (request) => {
  const declared = Number(request.headers.get('Content-Length') || 0);
  if (declared > PUBLISHED_REPORT_MAX_BYTES) return { error: 'too_large' };
  if (!request.body) return { text: '' };
  const reader = request.body.getReader();
  const chunks = [];
  let total = 0;
  try {
    for (;;) {
      const { done, value } = await reader.read();
      if (done) break;
      total += value.byteLength;
      if (total > PUBLISHED_REPORT_MAX_BYTES) {
        await reader.cancel().catch(() => {});
        return { error: 'too_large' };
      }
      chunks.push(value);
    }
  } finally {
    reader.releaseLock();
  }
  const bytes = new Uint8Array(total);
  let offset = 0;
  for (const chunk of chunks) {
    bytes.set(chunk, offset);
    offset += chunk.byteLength;
  }
  return { text: new TextDecoder().decode(bytes) };
};

/**
 * The guard, the transform and the guard again, under one inspection budget.
 * Returns { artifact } to store, or { refusal } with the reason the artifact was
 * refused; throws InspectionBudgetExceededError when the budget runs out.
 */
const inspectArtifact = (received) => withInspectionBudget(createInspectionBudget(), () => {
  const secret = findUnredactedSecret(received);
  if (secret) {
    return { refusal: `Only the redacted public artifact can be published: ${secret.reason} at ${secret.path}.` };
  }
  // Store the redacted form even when the guard found nothing. The transform is
  // the identity on an artifact the app produced; anything it changes was not the
  // app's output, and must still satisfy the schema to be stored.
  const artifact = redactReportValue(received);
  // Fail closed: the stored artifact must itself pass the guard. If the transform
  // left anything the guard still recognizes, nothing is stored.
  const residual = findUnredactedSecret(artifact);
  if (residual) {
    return { refusal: `The artifact still carries credential material once redacted: ${residual.reason} at ${residual.path}.` };
  }
  return { artifact };
});

const publish = async (request, env, url) => {
  const methods = 'POST, OPTIONS';
  const body = await readBody(request);
  if (body.error) {
    return errorResponse(request, 413, 'too_large', `Artifacts larger than ${PUBLISHED_REPORT_MAX_BYTES} bytes are not accepted.`, methods);
  }
  let received;
  try {
    received = JSON.parse(body.text);
  } catch {
    return errorResponse(request, 400, 'invalid_json', 'The request body is not valid JSON.', methods);
  }
  if (!received || typeof received !== 'object' || Array.isArray(received)) {
    return errorResponse(request, 400, 'invalid_json', 'The request body must be a JSON object.', methods);
  }
  const validation = validateReport(received);
  if (!validation.valid) {
    return jsonResponse(request, {
      error: 'schema_validation_failed',
      message: 'The artifact does not match https://mcptest.io/schemas/report/v2.schema.json.',
      errors: validation.errors,
    }, 422, methods);
  }
  let inspected;
  try {
    inspected = inspectArtifact(received);
  } catch (error) {
    if (!(error instanceof InspectionBudgetExceededError)) throw error;
    return jsonResponse(request, {
      error: 'uninspectable_content',
      message: `The artifact cannot be inspected within one request's budget: ${error.message}.`,
    }, 422, methods);
  }
  if (inspected.refusal) {
    return jsonResponse(request, { error: 'unredacted_content', message: inspected.refusal }, 422, methods);
  }
  const { artifact } = inspected;
  const storedValidation = validateReport(artifact);
  if (!storedValidation.valid) {
    return jsonResponse(request, {
      error: 'schema_validation_failed',
      message: 'The artifact does not match https://mcptest.io/schemas/report/v2.schema.json once redacted.',
      errors: storedValidation.errors,
    }, 422, methods);
  }
  const endpoint = normalizePublishedEndpoint(artifact.target.testedEndpoint);
  if (!endpoint) {
    return errorResponse(request, 422, 'endpoint_not_publishable', 'Reports can be published only for public http(s) endpoints.', methods);
  }
  const host = new URL(endpoint).hostname;
  const ip = request.headers.get('CF-Connecting-IP') || 'unknown';
  const now = Date.now();
  for (const [scope, value] of [['ip', ip], ['host', host]]) {
    const limit = await checkRateLimit(env, scope, value, now);
    if (!limit.allowed) {
      return errorResponse(
        request,
        429,
        'rate_limited',
        `Publishing is limited to ${PUBLISH_RATE_LIMITS[scope].limit} reports per hour per ${scope === 'ip' ? 'address' : 'endpoint host'}.`,
        methods,
        { 'Retry-After': String(limit.retryAfterSeconds) }
      );
    }
  }
  const [endpointKey, contentHash] = await Promise.all([
    publishedEndpointKey(endpoint),
    publishedReportContentHash(artifact),
  ]);
  const id = publishedReportId(endpointKey, contentHash);
  const removalToken = randomToken();
  const stored = await callStub(endpointStub(env, endpointKey), '/publish', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({
      id,
      endpoint,
      contentHash,
      artifactJson: JSON.stringify(artifact),
      removalTokenHash: await sha256Hex(removalToken),
      summary: summarizePublishedArtifact(artifact),
      now: new Date(now).toISOString(),
    }),
  });
  if (!stored.ok) {
    return errorResponse(request, 502, 'storage_failure', 'The report could not be stored. Try again later.', methods);
  }
  const result = await stored.json();
  const summary = result.entry?.summary;
  const watch = url.searchParams.get('watch') === 'weekly'
    ? await setEndpointWatch(env, {
      endpoint,
      endpointKey,
      enabled: true,
      requiresAuthorization: summary?.status === 'authorization-required' || summary?.releaseStatus === 'authorization-required',
      now,
    }).catch(() => ({ enabled: false, reason: 'The weekly watch could not be turned on. Try again later.' }))
    : undefined;
  return jsonResponse(request, {
    id,
    url: `${url.origin}/r/${id}`,
    reportUrl: `https://mcptest.io/report/${encodeURIComponent(endpoint)}`,
    badgeUrl: `https://mcptest.io/badge/report/${encodeURIComponent(endpoint)}.svg`,
    endpoint,
    deduplicated: !result.created,
    entry: result.entry,
    snapshotCount: result.count,
    retention: PUBLISHED_REPORT_RETENTION,
    ...(result.created ? { removalToken } : {}),
    ...(watch ? { watch, changesFeedUrl: `${url.origin}/r/${encodeURIComponent(endpoint)}/changes.xml` } : {}),
  }, result.created ? 201 : 200, methods);
};

const readSnapshot = async (request, env, id) => {
  const parsed = parsePublishedReportId(id);
  if (!parsed) return errorResponse(request, 404, 'not_found', 'No published report has this id.');
  const response = await callStub(endpointStub(env, parsed.endpointKey), `/snapshot/${id}`);
  if (response.status === 404) return errorResponse(request, 404, 'not_found', 'No published report has this id.');
  if (!response.ok) return errorResponse(request, 502, 'storage_failure', 'The report could not be read.');
  const { entry, artifactJson } = await response.json();
  return new Response(request.method === 'HEAD' ? null : artifactJson, {
    status: 200,
    headers: {
      'Content-Type': 'application/json; charset=utf-8',
      'X-Robots-Tag': ROBOTS_HEADER,
      'X-Content-Type-Options': 'nosniff',
      'Cache-Control': PUBLISHED_REPORT_CACHE_CONTROL,
      'X-Published-At': entry.createdAt,
      'X-Content-Hash': entry.contentHash,
      ...corsHeaders(request, 'GET, HEAD, OPTIONS'),
    },
  });
};

const deleteSnapshot = async (request, env, id) => {
  const methods = 'DELETE, OPTIONS';
  const parsed = parsePublishedReportId(id);
  const token = request.headers.get(REMOVAL_TOKEN_HEADER)?.trim();
  if (!token) return errorResponse(request, 401, 'removal_token_required', `Send the removal token in the ${REMOVAL_TOKEN_HEADER} header.`, methods);
  if (!parsed) return errorResponse(request, 404, 'not_found', 'No published report has this id.', methods);
  const response = await callStub(endpointStub(env, parsed.endpointKey), `/snapshot/${id}`, {
    method: 'DELETE',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ removalTokenHash: await sha256Hex(token) }),
  });
  if (response.status === 404) return errorResponse(request, 404, 'not_found', 'No published report has this id.', methods);
  if (response.status === 403) return errorResponse(request, 403, 'invalid_removal_token', 'The removal token does not match this snapshot.', methods);
  if (!response.ok) return errorResponse(request, 502, 'storage_failure', 'The report could not be removed.', methods);
  return new Response(null, { status: 204, headers: corsHeaders(request, methods) });
};

const updateWatch = async (request, env, id) => {
  const methods = 'POST, OPTIONS';
  const parsed = parsePublishedReportId(id);
  const token = request.headers.get(REMOVAL_TOKEN_HEADER)?.trim();
  if (!token) return errorResponse(request, 401, 'removal_token_required', `Send the removal token in the ${REMOVAL_TOKEN_HEADER} header.`, methods);
  if (!parsed) return errorResponse(request, 404, 'not_found', 'No published report has this id.', methods);
  let body;
  try {
    body = await request.json();
  } catch {
    return errorResponse(request, 400, 'invalid_json', 'Send {"watch": true} or {"watch": false}.', methods);
  }
  if (typeof body?.watch !== 'boolean') return errorResponse(request, 400, 'invalid_json', 'Send {"watch": true} or {"watch": false}.', methods);
  const stub = endpointStub(env, parsed.endpointKey);
  const verified = await callStub(stub, `/snapshot/${id}`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ removalTokenHash: await sha256Hex(token) }),
  });
  if (verified.status === 404) return errorResponse(request, 404, 'not_found', 'No published report has this id.', methods);
  if (!verified.ok) return errorResponse(request, 502, 'storage_failure', 'The watch could not be updated.', methods);
  if (!(await verified.json()).valid) return errorResponse(request, 403, 'invalid_removal_token', 'The removal token does not match this snapshot.', methods);
  const snapshot = await (await callStub(stub, `/snapshot/${id}`)).json();
  const summary = snapshot.entry?.summary;
  const watch = await setEndpointWatch(env, {
    endpoint: snapshot.entry.endpoint,
    endpointKey: parsed.endpointKey,
    enabled: body.watch,
    requiresAuthorization: summary?.status === 'authorization-required' || summary?.releaseStatus === 'authorization-required',
    now: Date.now(),
  });
  return jsonResponse(request, { endpoint: snapshot.entry.endpoint, watch }, 200, methods);
};

const changesFeed = async (request, env, segment) => {
  const endpoint = decodeEndpoint(segment);
  if (!endpoint) return errorResponse(request, 404, 'not_found', 'This endpoint cannot have published reports.');
  const endpointKey = await publishedEndpointKey(endpoint);
  const response = await callStub(endpointStub(env, endpointKey), '/watch');
  if (!response.ok) return errorResponse(request, 502, 'storage_failure', 'The changes feed could not be read.');
  const { entries } = await response.json();
  const feedUrl = `${new URL(request.url).origin}/r/${encodeURIComponent(endpoint)}/changes.xml`;
  return new Response(request.method === 'HEAD' ? null : renderChangesFeed({ endpoint, endpointKey, entries, feedUrl }), {
    status: 200,
    headers: {
      'Content-Type': 'application/atom+xml; charset=utf-8',
      'Cache-Control': CHANGES_FEED_CACHE_CONTROL,
      'X-Content-Type-Options': 'nosniff',
      'X-Robots-Tag': ROBOTS_HEADER,
      ...corsHeaders(request, 'GET, HEAD, OPTIONS'),
    },
  });
};

const decodeEndpoint = (segment) => {
  try {
    return normalizePublishedEndpoint(decodeURIComponent(segment));
  } catch {
    return undefined;
  }
};

const listSnapshots = async (request, env, segment) => {
  const endpoint = decodeEndpoint(segment);
  if (!endpoint) return errorResponse(request, 404, 'not_found', 'This endpoint cannot have published reports.');
  const response = await callStub(endpointStub(env, await publishedEndpointKey(endpoint)), '/snapshots');
  if (!response.ok) return errorResponse(request, 502, 'storage_failure', 'Published reports could not be listed.');
  const { entries, watch } = await response.json();
  return jsonResponse(request, {
    endpoint,
    retention: PUBLISHED_REPORT_RETENTION,
    snapshots: entries,
    ...(watch ? { watch: publicWatch(watch, endpoint, request) } : {}),
  }, 200, 'GET, HEAD, OPTIONS', { 'Cache-Control': PUBLISHED_INDEX_CACHE_CONTROL });
};

/** The watch as the index exposes it: opt-in, latest check and newest classified change. */
const publicWatch = (watch, endpoint, request) => ({
  enabled: Boolean(watch.config?.enabled),
  ...(watch.config?.enabled ? { plan: watch.config.plan, optedInAt: watch.config.optedInAt } : {}),
  state: watch.state,
  lastChange: watch.lastChange,
  changesFeedUrl: `${new URL(request.url).origin}/r/${encodeURIComponent(endpoint)}/changes.xml`,
});

/**
 * A breaking change the weekly watch found after the newest published run
 * overrides that run's badge until the owner publishes again.
 */
const hasUnpublishedBreakingChange = (latest, watch) => {
  const change = watch?.lastChange;
  if (!watch?.config?.enabled || change?.severity !== 'breaking') return false;
  return !latest || Date.parse(change.observedAt) > Date.parse(latest.lastPublishedAt);
};

const latestBadgeVariant = (entries, watch) => {
  const latest = entries[0];
  if (hasUnpublishedBreakingChange(latest, watch)) return 'breaking-change';
  if (!latest) return 'neutral';
  if (latest.summary.releaseStatus) return getBadgeVariantForResult(latest.summary.releaseStatus);
  return latest.summary.status === 'authorization-required' ? 'authorization-required' : 'unknown';
};

const svgCache = new Map();
const badgeSvg = (variant) => {
  if (!svgCache.has(variant)) svgCache.set(variant, renderBadgeSvg(variant));
  return svgCache.get(variant);
};

const reportBadge = async (request, env, segment) => {
  if (request.method !== 'GET' && request.method !== 'HEAD') {
    return new Response(null, { status: 405, headers: { Allow: 'GET, HEAD' } });
  }
  const endpoint = segment.endsWith('.svg') && !segment.includes('/')
    ? decodeEndpoint(segment.slice(0, -'.svg'.length))
    : undefined;
  let variant = 'neutral';
  if (endpoint) {
    try {
      const response = await callStub(endpointStub(env, await publishedEndpointKey(endpoint)), '/snapshots');
      if (response.ok) {
        const { entries, watch } = await response.json();
        variant = latestBadgeVariant(entries, watch);
      }
    } catch {
      // Storage trouble still yields the neutral badge so READMEs never show a broken image.
    }
  }
  return new Response(request.method === 'HEAD' ? null : badgeSvg(variant), {
    status: 200,
    headers: {
      'Content-Type': 'image/svg+xml; charset=utf-8',
      'Cache-Control': variant === 'neutral' ? UNKNOWN_BADGE_CACHE_CONTROL : KNOWN_BADGE_CACHE_CONTROL,
      'Access-Control-Allow-Origin': '*',
      'Content-Security-Policy': "default-src 'none'; style-src 'unsafe-inline'",
      'X-Content-Type-Options': 'nosniff',
      'X-Robots-Tag': ROBOTS_HEADER,
      'X-Badge-Result': variant,
    },
  });
};

/** Handles the published report routes; returns undefined for any other path. */
export async function handlePublishedReportRequest(request, env) {
  const url = new URL(request.url);
  const { pathname } = url;
  if (pathname.startsWith('/badge/report/')) {
    return reportBadge(request, env, pathname.slice('/badge/report/'.length));
  }
  if (pathname !== '/r' && !pathname.startsWith('/r/')) return undefined;
  if (!env.PUBLISHED_REPORTS) {
    return errorResponse(request, 503, 'not_configured', 'Published reports are not enabled on this deployment.');
  }
  if (pathname === '/r' || pathname === '/r/') {
    if (request.method === 'OPTIONS') return new Response(null, { status: 204, headers: corsHeaders(request, 'POST, OPTIONS') });
    if (request.method !== 'POST') return errorResponse(request, 405, 'method_not_allowed', 'Publish with POST.', 'POST, OPTIONS', { Allow: 'POST, OPTIONS' });
    return publish(request, env, url);
  }
  if (pathname.startsWith('/r/endpoint/')) {
    if (request.method === 'OPTIONS') return new Response(null, { status: 204, headers: corsHeaders(request, 'GET, HEAD, OPTIONS') });
    if (request.method !== 'GET' && request.method !== 'HEAD') return errorResponse(request, 405, 'method_not_allowed', 'Use GET.', 'GET, HEAD, OPTIONS', { Allow: 'GET, HEAD, OPTIONS' });
    return listSnapshots(request, env, pathname.slice('/r/endpoint/'.length));
  }
  const feed = /^\/r\/([^/]+)\/changes\.xml$/.exec(pathname);
  if (feed) {
    if (request.method === 'OPTIONS') return new Response(null, { status: 204, headers: corsHeaders(request, 'GET, HEAD, OPTIONS') });
    if (request.method !== 'GET' && request.method !== 'HEAD') return errorResponse(request, 405, 'method_not_allowed', 'Use GET.', 'GET, HEAD, OPTIONS', { Allow: 'GET, HEAD, OPTIONS' });
    return changesFeed(request, env, feed[1]);
  }
  const watchToggle = /^\/r\/([^/]+)\/watch$/.exec(pathname);
  if (watchToggle) {
    if (request.method === 'OPTIONS') return new Response(null, { status: 204, headers: corsHeaders(request, 'POST, OPTIONS') });
    if (request.method !== 'POST') return errorResponse(request, 405, 'method_not_allowed', 'Use POST.', 'POST, OPTIONS', { Allow: 'POST, OPTIONS' });
    return updateWatch(request, env, watchToggle[1]);
  }
  const id = pathname.slice('/r/'.length);
  if (id.includes('/')) return errorResponse(request, 404, 'not_found', 'No published report has this id.');
  if (request.method === 'OPTIONS') return new Response(null, { status: 204, headers: corsHeaders(request, 'GET, HEAD, DELETE, OPTIONS') });
  if (request.method === 'DELETE') return deleteSnapshot(request, env, id);
  if (request.method === 'GET' || request.method === 'HEAD') return readSnapshot(request, env, id);
  return errorResponse(request, 405, 'method_not_allowed', 'Use GET or DELETE.', 'GET, HEAD, DELETE, OPTIONS', { Allow: 'GET, HEAD, DELETE, OPTIONS' });
}
