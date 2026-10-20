// Catalog submission route: POST /api/catalog/submissions
//
// The /submit page posts a server listing request with the browser-side probe as
// evidence. This route validates it, rate limits it, and triggers the
// `catalog-submission` repository_dispatch event; the GitHub Actions workflow
// .github/workflows/catalog-submission.yml then writes the catalog entry,
// re-validates it on the runner and opens a pull request for a maintainer.
//
// Nothing is stored here except rate-limit counters (keyed by a hash of the
// client IP and by endpoint host). The optional contact email is passed only in
// the dispatch payload and is never echoed back to the client.
//
// Configuration (see docs/catalog-submissions.md):
// - GITHUB_DISPATCH_TOKEN (secret, required): fine-grained token for the target
//   repository with "Contents: read and write"; repository_dispatch needs it.
// - TURNSTILE_SECRET (secret, optional): when set, every submission needs a valid
//   Cloudflare Turnstile token. When it is not set the check is skipped.
// - GITHUB_DISPATCH_REPOSITORY (var, optional): defaults to integry/mcptest.
// - SUBMISSION_RATE_LIMITER: Durable Object binding for SubmissionRateLimiter.
import {
  CATALOG_SUBMISSION_API_PATH,
  CATALOG_SUBMISSION_DISPATCH_EVENT,
  CATALOG_SUBMISSION_DOCS_URL,
  deriveCatalogId,
  findCatalogDuplicate,
  normalizeCatalogEndpoint,
} from "../../src/utils/catalogSubmission.ts";
import { validateCatalogSubmission } from "../../src/utils/catalogSubmissionSchema.ts";

export const SUBMISSION_RATE_LIMITS = {
  perIp: { limit: 10, windowMs: 24 * 60 * 60 * 1000 },
  perHost: { limit: 5, windowMs: 24 * 60 * 60 * 1000 },
};
export const MAX_SUBMISSION_BYTES = 32 * 1024;
export const TURNSTILE_VERIFY_URL = "https://challenges.cloudflare.com/turnstile/v0/siteverify";
const DEFAULT_DISPATCH_REPOSITORY = "integry/mcptest";
const SITE_ORIGIN = "https://mcptest.io";

const isAllowedOrigin = (origin) => (
  origin === SITE_ORIGIN
  || origin === "https://www.mcptest.io"
  || /^http:\/\/(?:localhost|127\.0\.0\.1)(?::\d{1,5})?$/.test(origin)
);

const corsHeaders = (request) => {
  const origin = request.headers.get("Origin");
  return {
    "Access-Control-Allow-Origin": origin && isAllowedOrigin(origin) ? origin : SITE_ORIGIN,
    "Access-Control-Allow-Methods": "POST, OPTIONS",
    "Access-Control-Allow-Headers": "Content-Type",
    "Access-Control-Max-Age": "86400",
    Vary: "Origin",
  };
};

const json = (request, status, body, extraHeaders = {}) => new Response(JSON.stringify(body), {
  status,
  headers: {
    ...corsHeaders(request),
    "Content-Type": "application/json; charset=utf-8",
    "Cache-Control": "no-store",
    "X-Content-Type-Options": "nosniff",
    ...extraHeaders,
  },
});

const failure = (request, status, error, message, extra = {}, headers = {}) => (
  json(request, status, { error, message, ...extra }, headers)
);

const sha256Hex = async (value) => {
  const digest = await crypto.subtle.digest("SHA-256", new TextEncoder().encode(value));
  return Array.from(new Uint8Array(digest), (byte) => byte.toString(16).padStart(2, "0")).join("");
};

const readBody = async (request) => {
  const declared = Number(request.headers.get("Content-Length") || "0");
  if (declared > MAX_SUBMISSION_BYTES) return { tooLarge: true };
  const text = await request.text();
  if (new TextEncoder().encode(text).byteLength > MAX_SUBMISSION_BYTES) return { tooLarge: true };
  try {
    return { value: JSON.parse(text) };
  } catch {
    return { invalidJson: true };
  }
};

const verifyTurnstile = async (secret, token, remoteIp) => {
  if (typeof token !== "string" || token.length === 0) return { success: false, reason: "missing" };
  const form = new FormData();
  form.append("secret", secret);
  form.append("response", token);
  if (remoteIp) form.append("remoteip", remoteIp);
  try {
    const response = await fetch(TURNSTILE_VERIFY_URL, { method: "POST", body: form });
    const outcome = await response.json();
    return { success: outcome && outcome.success === true, reason: "rejected" };
  } catch {
    return { success: false, reason: "unavailable" };
  }
};

/** Consumes one slot from a sliding-window counter; returns { allowed, retryAfterSeconds }. */
const consumeRateLimit = async (env, key, { limit, windowMs }) => {
  const stub = env.SUBMISSION_RATE_LIMITER.get(env.SUBMISSION_RATE_LIMITER.idFromName(key));
  const response = await stub.fetch("https://rate-limiter/consume", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ limit, windowMs, now: Date.now() }),
  });
  return response.json();
};

const dispatchPayload = (submissionId, proposedCatalogId, submission) => {
  const { evidence, contactEmail, turnstileToken: _turnstileToken, $schema: _schema, ...listing } = submission;
  return {
    submission_id: submissionId,
    proposed_id: proposedCatalogId,
    submitted_at: new Date().toISOString(),
    submission: listing,
    evidence,
    ...(contactEmail ? { contact_email: contactEmail } : {}),
  };
};

const triggerDispatch = async (env, payload) => {
  const repository = env.GITHUB_DISPATCH_REPOSITORY || DEFAULT_DISPATCH_REPOSITORY;
  return fetch(`https://api.github.com/repos/${repository}/dispatches`, {
    method: "POST",
    headers: {
      Authorization: `Bearer ${env.GITHUB_DISPATCH_TOKEN}`,
      Accept: "application/vnd.github+json",
      "Content-Type": "application/json",
      "User-Agent": "mcptest-catalog-submissions",
      "X-GitHub-Api-Version": "2022-11-28",
    },
    body: JSON.stringify({ event_type: CATALOG_SUBMISSION_DISPATCH_EVENT, client_payload: payload }),
  });
};

const handleSubmission = async (request, env) => {
  const origin = request.headers.get("Origin");
  if (origin && !isAllowedOrigin(origin)) {
    return failure(request, 403, "origin_not_allowed", "Submissions are accepted from mcptest.io only.");
  }
  if (!env.GITHUB_DISPATCH_TOKEN || !env.SUBMISSION_RATE_LIMITER) {
    return failure(request, 503, "submissions_not_configured", "Catalog submissions are not enabled on this deployment. Use the manual pull request path in the docs.", { docsUrl: CATALOG_SUBMISSION_DOCS_URL });
  }
  if (!/^application\/json\b/i.test(request.headers.get("Content-Type") || "")) {
    return failure(request, 415, "unsupported_media_type", "Send the submission as application/json.");
  }

  const body = await readBody(request);
  if (body.tooLarge) return failure(request, 413, "payload_too_large", `Submissions are limited to ${MAX_SUBMISSION_BYTES} bytes.`);
  if (body.invalidJson) return failure(request, 400, "invalid_json", "The request body is not valid JSON.");

  const validation = validateCatalogSubmission(body.value);
  if (!validation.valid) {
    return failure(request, 422, "invalid_submission", "The submission does not match the catalog submission schema.", { errors: validation.errors });
  }
  const { submission } = validation;

  const duplicate = findCatalogDuplicate(submission.url);
  if (duplicate) {
    return failure(request, 409, "already_listed", `This endpoint is already listed as ${duplicate.name}.`, {
      catalogId: duplicate.id,
      catalogUrl: `${SITE_ORIGIN}/servers/${encodeURIComponent(duplicate.id)}`,
    });
  }

  const clientIp = request.headers.get("CF-Connecting-IP") || "";
  if (env.TURNSTILE_SECRET) {
    const turnstile = await verifyTurnstile(env.TURNSTILE_SECRET, submission.turnstileToken, clientIp);
    if (!turnstile.success) {
      return turnstile.reason === "unavailable"
        ? failure(request, 503, "turnstile_unavailable", "The human check could not be verified. Try again in a minute.")
        : failure(request, 403, "turnstile_failed", turnstile.reason === "missing"
          ? "Complete the human check before submitting."
          : "The human check expired or failed. Complete it again and resubmit.");
    }
  }

  const ipKey = `ip:${await sha256Hex(clientIp || "unknown")}`;
  const hostKey = `host:${normalizeCatalogEndpoint(submission.url).split("/")[0]}`;
  for (const [key, rule, scope] of [
    [ipKey, SUBMISSION_RATE_LIMITS.perIp, "address"],
    [hostKey, SUBMISSION_RATE_LIMITS.perHost, "endpoint host"],
  ]) {
    const decision = await consumeRateLimit(env, key, rule);
    if (!decision.allowed) {
      const retryAfter = String(Math.max(1, decision.retryAfterSeconds || 3600));
      return failure(request, 429, "rate_limited", `Too many submissions from this ${scope} today. Try again later.`, { retryAfterSeconds: Number(retryAfter) }, { "Retry-After": retryAfter });
    }
  }

  const submissionId = crypto.randomUUID();
  const proposedCatalogId = deriveCatalogId(submission.url);
  let dispatch;
  try {
    dispatch = await triggerDispatch(env, dispatchPayload(submissionId, proposedCatalogId, submission));
  } catch {
    dispatch = undefined;
  }
  if (!dispatch || !dispatch.ok) {
    console.error(`[submissions] repository_dispatch failed with status ${dispatch ? dispatch.status : "network error"}`);
    return failure(request, 502, "dispatch_failed", "The submission was valid but could not be queued. Try again later.");
  }

  return json(request, 202, {
    submissionId,
    proposedCatalogId,
    status: "queued",
    nextStep: `A GitHub Actions workflow re-checks the endpoint and opens a pull request on the branch submissions/${proposedCatalogId} for a maintainer to review. This usually takes a few minutes.`,
    docsUrl: CATALOG_SUBMISSION_DOCS_URL,
  });
};

/** Returns a response for /api/catalog/submissions, or undefined for any other route. */
export async function handleSubmissionRequest(request, env) {
  const url = new URL(request.url);
  if (url.pathname !== CATALOG_SUBMISSION_API_PATH) return undefined;
  if (request.method === "OPTIONS") return new Response(null, { status: 204, headers: corsHeaders(request) });
  if (request.method !== "POST") {
    return failure(request, 405, "method_not_allowed", "Use POST.", {}, { Allow: "POST, OPTIONS" });
  }
  return handleSubmission(request, env);
}

/**
 * Sliding-window counter, one instance per rate-limit key. Requests to one
 * Durable Object are serialized, so concurrent submissions cannot both take the
 * last slot. Only timestamps are stored, and they expire with the window.
 */
export class SubmissionRateLimiter {
  constructor(state) {
    this.storage = state.storage;
  }

  async fetch(request) {
    const { limit, windowMs, now } = await request.json();
    const hits = ((await this.storage.get("hits")) || []).filter((time) => time > now - windowMs);
    if (hits.length >= limit) {
      await this.storage.put("hits", hits);
      return Response.json({ allowed: false, retryAfterSeconds: Math.ceil((hits[0] + windowMs - now) / 1000) });
    }
    hits.push(now);
    await this.storage.put("hits", hits);
    return Response.json({ allowed: true, remaining: limit - hits.length });
  }
}
