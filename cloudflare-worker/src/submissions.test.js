import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import worker from './index.js';
import {
  SUBMISSION_RATE_LIMITS,
  SubmissionRateLimiter,
  TURNSTILE_VERIFY_URL,
  handleSubmissionRequest,
} from './submissions.js';

const ENDPOINT = 'https://mcp.example-submission.dev/mcp';

const evidence = (overrides = {}) => ({
  checkedAt: '2026-10-20T10:00:00.000Z',
  endpointUrl: ENDPOINT,
  outcome: 'mcp',
  validatedUrl: ENDPOINT,
  transport: 'streamable-http',
  protocolVersion: '2025-06-18',
  protocolEra: 'stateless',
  authChallenge: 'none',
  browserAccess: 'direct',
  toolCount: 3,
  detail: 'Live browser probe negotiated stateless MCP 2025-06-18 over streamable-http.',
  ...overrides,
});

const submission = (overrides = {}) => ({
  $schema: 'https://mcptest.io/schemas/catalog-submission/v1.schema.json',
  url: ENDPOINT,
  name: 'Example Submission',
  description: 'Exposes read-only example records over MCP without authentication.',
  category: 'Developer Tools',
  homepageUrl: 'https://example-submission.dev',
  logoLicense: 'none',
  contactEmail: 'owner@example-submission.dev',
  authorized: true,
  evidence: evidence(),
  ...overrides,
});

// In-memory stand-in for the Durable Object namespace that runs the real class.
const rateLimiterNamespace = () => {
  const instances = new Map();
  return {
    idFromName: (name) => name,
    get: (id) => {
      if (!instances.has(id)) {
        const data = new Map();
        instances.set(id, new SubmissionRateLimiter({
          storage: {
            get: async (key) => data.get(key),
            put: async (key, value) => { data.set(key, value); },
          },
        }));
      }
      return { fetch: (url, init) => instances.get(id).fetch(new Request(url, init)) };
    },
  };
};

let env;
let fetchMock;

const post = (body, { ip = '203.0.113.7', headers = {}, raw } = {}) => worker.fetch(new Request('https://mcptest.io/api/catalog/submissions', {
  method: 'POST',
  headers: {
    'Content-Type': 'application/json',
    Origin: 'https://mcptest.io',
    'CF-Connecting-IP': ip,
    ...headers,
  },
  body: raw ?? JSON.stringify(body),
}), env, {});

const dispatchCalls = () => fetchMock.mock.calls.filter(([url]) => String(url).startsWith('https://api.github.com/'));
const turnstileCalls = () => fetchMock.mock.calls.filter(([url]) => url === TURNSTILE_VERIFY_URL);

beforeEach(() => {
  env = {
    FIREBASE_PROJECT_ID: 'test-project',
    GITHUB_DISPATCH_TOKEN: 'test-dispatch-token',
    SUBMISSION_RATE_LIMITER: rateLimiterNamespace(),
    USER_STATE: { idFromName: () => { throw new Error('submissions must not reach the user state'); } },
  };
  fetchMock = vi.fn(async (url) => {
    if (url === TURNSTILE_VERIFY_URL) return Response.json({ success: true });
    if (String(url).startsWith('https://api.github.com/')) return new Response(null, { status: 204 });
    throw new Error(`unexpected fetch ${url}`);
  });
  vi.stubGlobal('fetch', fetchMock);
});

afterEach(() => {
  vi.unstubAllGlobals();
});

describe('POST /api/catalog/submissions', () => {
  it('dispatches a valid submission and returns the id and next step without the email', async () => {
    const response = await post(submission({ turnstileToken: 'ignored-without-secret' }));
    expect(response.status).toBe(202);
    expect(response.headers.get('Access-Control-Allow-Origin')).toBe('https://mcptest.io');
    const text = await response.text();
    expect(text).not.toContain('owner@example-submission.dev');
    const body = JSON.parse(text);
    expect(body).toMatchObject({ status: 'queued', proposedCatalogId: 'example-submission' });
    expect(body.submissionId).toMatch(/^[0-9a-f-]{36}$/);
    // The branch is per submission, so two submissions that derive the same id keep separate pull requests.
    expect(body.nextStep).toContain(`submissions/${body.submissionId}`);
    expect(body.docsUrl).toContain('docs/catalog-submissions.md');

    expect(dispatchCalls()).toHaveLength(1);
    const [url, init] = dispatchCalls()[0];
    expect(url).toBe('https://api.github.com/repos/integry/mcptest/dispatches');
    expect(init.method).toBe('POST');
    expect(init.headers.Authorization).toBe('Bearer test-dispatch-token');
    expect(init.headers['User-Agent']).toBeTruthy();
    const dispatched = JSON.parse(init.body);
    expect(dispatched.event_type).toBe('catalog-submission');
    expect(dispatched.client_payload).toMatchObject({
      submission_id: body.submissionId,
      proposed_id: 'example-submission',
      contact_email: 'owner@example-submission.dev',
      evidence: evidence(),
      submission: { url: ENDPOINT, name: 'Example Submission', logoLicense: 'none', authorized: true },
    });
    expect(dispatched.client_payload.submission).not.toHaveProperty('contactEmail');
    expect(dispatched.client_payload.submission).not.toHaveProperty('turnstileToken');
    expect(dispatched.client_payload.submission).not.toHaveProperty('evidence');
    expect(Object.keys(dispatched.client_payload).length).toBeLessThanOrEqual(10);
  });

  it('honours a configured dispatch repository and omits an absent email', async () => {
    env.GITHUB_DISPATCH_REPOSITORY = 'someone/fork';
    const { contactEmail, ...withoutEmail } = submission();
    expect((await post(withoutEmail)).status).toBe(202);
    const [url, init] = dispatchCalls()[0];
    expect(url).toBe('https://api.github.com/repos/someone/fork/dispatches');
    expect(JSON.parse(init.body).client_payload).not.toHaveProperty('contact_email');
  });

  it.each([
    ['a missing name', { name: undefined }],
    ['an unknown property', { extra: true }],
    ['an unknown category', { category: 'Gardening' }],
    ['a short description', { description: 'Too short.' }],
    ['HTML in the description', { description: 'Exposes records <script>alert(1)</script> over MCP.' }],
    ['a missing authorization confirmation', { authorized: false }],
    ['a logo URL without a license', { logoLicense: 'none', logoUrl: 'https://example-submission.dev/logo.svg' }],
    ['a licensed logo without a URL', { logoLicense: 'simple-icons' }],
    ['an invalid email', { contactEmail: 'not-an-email' }],
    ['unreachable evidence', { evidence: evidence({ outcome: 'unreachable' }) }],
    ['evidence for another endpoint', { evidence: evidence({ endpointUrl: 'https://other.example-submission.dev/mcp' }) }],
    ['a handshake with an auth challenge', { evidence: evidence({ authChallenge: 'oauth' }) }],
    ['an auth challenge without an observed HTTP status', { evidence: evidence({ outcome: 'auth-challenge', authChallenge: 'unspecified', transport: undefined, toolCount: undefined }) }],
    ['an auth challenge with a non-auth HTTP status', { evidence: evidence({ outcome: 'auth-challenge', authChallenge: 'unspecified', authStatus: 500, transport: undefined, toolCount: undefined }) }],
    ['a plain-HTTP endpoint', { url: 'http://mcp.example-submission.dev/mcp' }],
    ['credentials in the URL', { url: 'https://user:secret@mcp.example-submission.dev/mcp' }],
    ['a query string', { url: `${ENDPOINT}?api_key=abc` }],
    ['localhost', { url: 'https://localhost/mcp' }],
    ['a private IP literal', { url: 'https://10.0.0.8/mcp' }],
    ['an IPv6 literal', { url: 'https://[::1]/mcp' }],
    ['an internal name', { url: 'https://mcp.corp.internal/mcp' }],
    ['a single-label host', { url: 'https://intranet/mcp' }],
    ['a private homepage', { homepageUrl: 'https://192.168.1.1/' }],
  ])('rejects %s with 422 and never dispatches', async (_label, overrides) => {
    const body = submission(overrides);
    for (const [key, value] of Object.entries(overrides)) if (value === undefined) delete body[key];
    // Keep the evidence aligned with the URL so only the rule under test fails.
    if (overrides.url && !overrides.evidence) body.evidence = evidence({ endpointUrl: overrides.url, validatedUrl: undefined });
    const response = await post(body);
    expect(response.status).toBe(422);
    const payload = await response.json();
    expect(payload.error).toBe('invalid_submission');
    expect(payload.errors.length).toBeGreaterThan(0);
    expect(dispatchCalls()).toHaveLength(0);
  });

  it('accepts a recognized auth challenge as evidence', async () => {
    const response = await post(submission({
      evidence: evidence({ outcome: 'auth-challenge', authChallenge: 'oauth', authStatus: 401, transport: undefined, toolCount: undefined }),
    }));
    expect(response.status).toBe(202);
  });

  it('rejects an endpoint that is already listed, matching /mcp and trailing-slash variants', async () => {
    for (const url of ['https://mcp.context7.com/mcp', 'https://MCP.context7.com', 'https://mcp.context7.com/sse/']) {
      const response = await post(submission({ url, evidence: evidence({ endpointUrl: url, validatedUrl: undefined }) }));
      expect(response.status).toBe(409);
      expect(await response.json()).toMatchObject({ error: 'already_listed', catalogId: 'context7' });
    }
    expect(dispatchCalls()).toHaveLength(0);
  });

  it('limits submissions per endpoint host per day', async () => {
    const { limit } = SUBMISSION_RATE_LIMITS.perHost;
    for (let index = 0; index < limit; index += 1) {
      const url = `https://mcp.example-submission.dev/tenant-${index}/mcp`;
      const response = await post(submission({ url, evidence: evidence({ endpointUrl: url }) }), { ip: `198.51.100.${index}` });
      expect(response.status).toBe(202);
    }
    const blocked = await post(submission(), { ip: '198.51.100.200' });
    expect(blocked.status).toBe(429);
    expect(Number(blocked.headers.get('Retry-After'))).toBeGreaterThan(0);
    expect((await blocked.json()).message).toContain('endpoint host');
    expect(dispatchCalls()).toHaveLength(limit);
  });

  it('counts other ports of the same host against the host limit', async () => {
    const { limit } = SUBMISSION_RATE_LIMITS.perHost;
    for (let index = 0; index < limit; index += 1) {
      const response = await post(submission(), { ip: `198.51.100.${index}` });
      expect(response.status).toBe(202);
    }
    for (const [index, url] of [
      'https://mcp.example-submission.dev:8443/mcp',
      'https://mcp.example-submission.dev:443/other',
      'https://MCP.Example-Submission.dev.:9000/mcp',
    ].entries()) {
      const blocked = await post(submission({ url, evidence: evidence({ endpointUrl: url, validatedUrl: undefined }) }), { ip: `192.0.2.${index}` });
      expect(blocked.status).toBe(429);
      expect((await blocked.json()).message).toContain('endpoint host');
    }
    expect(dispatchCalls()).toHaveLength(limit);
  });

  it('limits submissions per client address per day', async () => {
    const { limit } = SUBMISSION_RATE_LIMITS.perIp;
    for (let index = 0; index < limit; index += 1) {
      const url = `https://mcp.host-${index}.dev/mcp`;
      expect((await post(submission({ url, evidence: evidence({ endpointUrl: url, validatedUrl: url }) }))).status).toBe(202);
    }
    const url = 'https://mcp.host-final.dev/mcp';
    const blocked = await post(submission({ url, evidence: evidence({ endpointUrl: url, validatedUrl: url }) }));
    expect(blocked.status).toBe(429);
    expect((await blocked.json()).message).toContain('address');
    const otherAddress = await post(submission({ url, evidence: evidence({ endpointUrl: url, validatedUrl: url }) }), { ip: '192.0.2.44' });
    expect(otherAddress.status).toBe(202);
  });

  it('frees a slot once the window has passed', async () => {
    vi.useFakeTimers({ toFake: ['Date'] });
    try {
      vi.setSystemTime(new Date('2026-10-20T00:00:00Z'));
      for (let index = 0; index < SUBMISSION_RATE_LIMITS.perHost.limit; index += 1) await post(submission(), { ip: `198.51.100.${index}` });
      expect((await post(submission(), { ip: '198.51.100.99' })).status).toBe(429);
      vi.setSystemTime(new Date('2026-10-21T00:00:01Z'));
      expect((await post(submission(), { ip: '198.51.100.99' })).status).toBe(202);
    } finally {
      vi.useRealTimers();
    }
  });

  describe('Turnstile', () => {
    it('skips verification when TURNSTILE_SECRET is not configured', async () => {
      expect((await post(submission())).status).toBe(202);
      expect(turnstileCalls()).toHaveLength(0);
    });

    it('requires a token when TURNSTILE_SECRET is configured', async () => {
      env.TURNSTILE_SECRET = 'turnstile-secret';
      const response = await post(submission());
      expect(response.status).toBe(403);
      expect((await response.json()).error).toBe('turnstile_failed');
      expect(turnstileCalls()).toHaveLength(0);
      expect(dispatchCalls()).toHaveLength(0);
    });

    it('verifies the token with the secret and the client address', async () => {
      env.TURNSTILE_SECRET = 'turnstile-secret';
      const response = await post(submission({ turnstileToken: 'token-from-widget' }));
      expect(response.status).toBe(202);
      const [, init] = turnstileCalls()[0];
      expect(init.body.get('secret')).toBe('turnstile-secret');
      expect(init.body.get('response')).toBe('token-from-widget');
      expect(init.body.get('remoteip')).toBe('203.0.113.7');
      const dispatched = JSON.parse(dispatchCalls()[0][1].body).client_payload;
      expect(JSON.stringify(dispatched)).not.toContain('token-from-widget');
    });

    it('rejects a token that Turnstile does not accept', async () => {
      env.TURNSTILE_SECRET = 'turnstile-secret';
      fetchMock.mockImplementation(async (url) => (url === TURNSTILE_VERIFY_URL
        ? Response.json({ success: false, 'error-codes': ['timeout-or-duplicate'] })
        : new Response(null, { status: 204 })));
      const response = await post(submission({ turnstileToken: 'stale' }));
      expect(response.status).toBe(403);
      expect(dispatchCalls()).toHaveLength(0);
    });
  });

  it('reports 503 when the dispatch token is not configured', async () => {
    delete env.GITHUB_DISPATCH_TOKEN;
    const response = await post(submission());
    expect(response.status).toBe(503);
    expect((await response.json()).error).toBe('submissions_not_configured');
    expect(fetchMock).not.toHaveBeenCalled();
  });

  it('gives the rate-limit slots back when the dispatch fails', async () => {
    const { limit } = SUBMISSION_RATE_LIMITS.perHost;
    fetchMock.mockImplementation(async () => new Response('{"message":"Bad credentials"}', { status: 401 }));
    const errorSpy = vi.spyOn(console, 'error').mockImplementation(() => {});
    // Burn through more attempts than the host quota while GitHub is rejecting dispatches.
    for (let index = 0; index < limit + 2; index += 1) {
      const failed = await post(submission(), { ip: '198.51.100.77' });
      expect(failed.status).toBe(502);
    }
    errorSpy.mockRestore();
    // Once dispatch works again the same host and address are not locked out.
    fetchMock.mockImplementation(async () => new Response(null, { status: 204 }));
    const recovered = await post(submission(), { ip: '198.51.100.77' });
    expect(recovered.status).toBe(202);
  });

  it('reports 502 without details when GitHub rejects the dispatch', async () => {
    fetchMock.mockImplementation(async () => new Response('{"message":"Bad credentials"}', { status: 401 }));
    const errorSpy = vi.spyOn(console, 'error').mockImplementation(() => {});
    const response = await post(submission());
    expect(response.status).toBe(502);
    expect(await response.text()).not.toContain('Bad credentials');
    errorSpy.mockRestore();
  });

  it('rejects malformed requests before validation', async () => {
    expect((await post(null, { raw: '{not json' })).status).toBe(400);
    expect((await post(submission(), { headers: { 'Content-Type': 'text/plain' } })).status).toBe(415);
    expect((await post(null, { raw: JSON.stringify({ padding: 'x'.repeat(40 * 1024) }) })).status).toBe(413);
    expect((await post(submission(), { headers: { Origin: 'https://evil.example.net' } })).status).toBe(403);
    expect(dispatchCalls()).toHaveLength(0);
  });

  it('answers preflight and rejects other methods; leaves other routes alone', async () => {
    const preflight = await worker.fetch(new Request('https://mcptest.io/api/catalog/submissions', {
      method: 'OPTIONS',
      headers: { Origin: 'http://localhost:5173' },
    }), env, {});
    expect(preflight.status).toBe(204);
    expect(preflight.headers.get('Access-Control-Allow-Origin')).toBe('http://localhost:5173');
    expect(preflight.headers.get('Access-Control-Allow-Methods')).toContain('POST');

    const get = await worker.fetch(new Request('https://mcptest.io/api/catalog/submissions'), env, {});
    expect(get.status).toBe(405);

    expect(await handleSubmissionRequest(new Request('https://mcptest.io/api/state'), env)).toBeUndefined();
    expect((await worker.fetch(new Request('https://mcptest.io/api/state'), env, {})).status).toBe(401);
  });
});
