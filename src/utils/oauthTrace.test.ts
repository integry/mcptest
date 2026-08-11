import { beforeEach, describe, expect, it, vi } from 'vitest';
import {
  OAUTH_TRACE_REDACTED,
  OAUTH_TRACE_VERSION,
  createOAuthFlightRecorder,
  createOAuthTraceFetch,
  getStoredOAuthTrace,
  sanitizeOAuthTraceUrl,
  serializeOAuthTrace,
} from './oauthTrace';

const TARGET_URL = 'https://mcp.example/mcp';

beforeEach(() => {
  sessionStorage.clear();
});

describe('OAuth flight recorder core', () => {
  it('serializes a versioned trace with method, URL, timing, status, route, and provenance', async () => {
    const recorder = createOAuthFlightRecorder({
      targetUrl: TARGET_URL,
      storage: sessionStorage,
      traceId: 'trace-1',
      startedAt: '2026-08-11T12:00:00.000Z',
    });
    const fetchFn = vi.fn().mockResolvedValue(new Response('{}', {
      status: 200,
      headers: { 'Content-Type': 'application/json' },
    }));

    await createOAuthTraceFetch(recorder, fetchFn)(
      'https://mcp.example/.well-known/oauth-protected-resource'
    );

    const trace = recorder.snapshot();
    expect(trace).toMatchObject({
      version: OAUTH_TRACE_VERSION,
      traceId: 'trace-1',
      targetUrl: TARGET_URL,
      events: [expect.objectContaining({
        type: 'protected_resource_metadata',
        outcome: 'succeeded',
        provenance: 'direct_target',
        route: 'direct',
        request: {
          method: 'GET',
          url: 'https://mcp.example/.well-known/oauth-protected-resource',
        },
        response: expect.objectContaining({ status: 200 }),
        timing: expect.objectContaining({ durationMs: expect.any(Number) }),
      })],
    });
    expect(getStoredOAuthTrace(TARGET_URL, sessionStorage)).toEqual(trace);
  });

  it('records metadata HTTP and network failures without retaining response bodies', async () => {
    const recorder = createOAuthFlightRecorder({ targetUrl: TARGET_URL });
    const failedResponseFetch = vi.fn().mockResolvedValue(new Response(
      '{"access_token":"response-body-secret"}',
      { status: 503, headers: { 'Set-Cookie': 'session=cookie-secret' } }
    ));
    await createOAuthTraceFetch(recorder, failedResponseFetch)(
      'https://auth.example/.well-known/oauth-authorization-server'
    );

    const networkRecorder = createOAuthFlightRecorder({ targetUrl: TARGET_URL });
    await expect(createOAuthTraceFetch(
      networkRecorder,
      vi.fn().mockRejectedValue(new Error('offline'))
    )('https://auth.example/.well-known/openid-configuration')).rejects.toThrow('offline');

    expect(recorder.snapshot().events[0]).toMatchObject({
      type: 'authorization_server_metadata',
      outcome: 'failed',
      response: { status: 503 },
    });
    expect(networkRecorder.snapshot().events[0]).toMatchObject({
      type: 'authorization_server_metadata',
      outcome: 'failed',
    });
    expect(recorder.serialize()).not.toContain('response-body-secret');
    expect(recorder.serialize()).not.toContain('cookie-secret');
  });

  it('redacts every OAuth credential class from JSON serialization', () => {
    const secrets = {
      code: 'authorization-code-secret',
      accessToken: 'access-token-secret',
      refreshToken: 'refresh-token-secret',
      clientSecret: 'client-secret-value',
      cookie: 'cookie-secret-value',
      verifier: 'pkce-verifier-secret',
      state: 'oauth-state-secret',
      apiKey: 'api-key-secret',
    };
    const recorder = createOAuthFlightRecorder({ targetUrl: TARGET_URL });
    recorder.registerSecret(...Object.values(secrets));
    recorder.record({
      type: 'callback',
      outcome: 'failed',
      provenance: 'browser_callback',
      route: 'browser',
      explanation: `Callback rejected ${secrets.code}`,
      request: {
        method: 'GET',
        url: `https://mcptest.io/oauth/callback?code=${secrets.code}&state=${secrets.state}&api_key=${secrets.apiKey}`,
      },
      response: {
        headers: {
          authorization: `Bearer ${secrets.accessToken}`,
          cookie: `session=${secrets.cookie}`,
        },
        metadata: {
          refresh_token: secrets.refreshToken,
          client_secret: secrets.clientSecret,
          code_verifier: secrets.verifier,
        },
      },
    });

    const json = serializeOAuthTrace(recorder);
    for (const secret of Object.values(secrets)) expect(json).not.toContain(secret);
    expect(json).toContain(OAUTH_TRACE_REDACTED);
  });

  it('sanitizes nested proxy targets without losing route context', () => {
    const target = 'https://mcp.example/mcp?access_token=target-secret&tenant=acme';
    const proxy = `https://proxy.example/?target=${encodeURIComponent(target)}&state=proxy-secret`;

    const sanitized = sanitizeOAuthTraceUrl(proxy);

    expect(sanitized).toContain('proxy.example');
    expect(new URL(sanitized).searchParams.get('state')).toBe(OAUTH_TRACE_REDACTED);
    expect(new URL(new URL(sanitized).searchParams.get('target') || '').searchParams.get('tenant')).toBe('acme');
    expect(sanitized).not.toContain('target-secret');
    expect(sanitized).not.toContain('proxy-secret');

    createOAuthFlightRecorder({ targetUrl: target, storage: sessionStorage });
    expect(Object.keys(sessionStorage).join(' ')).not.toContain('target-secret');
    expect(getStoredOAuthTrace(target, sessionStorage)?.targetUrl).not.toContain('target-secret');
  });
});
