import { beforeEach, describe, expect, it, vi } from 'vitest';
import {
  OAUTH_TRACE_REDACTED,
  OAUTH_TRACE_VERSION,
  createOAuthFlightRecorder,
  createOAuthTraceFetch,
  getStoredOAuthTrace,
  sanitizeOAuthTraceUrl,
  serializeOAuthTrace,
  recordOAuthAuthenticationChallenge,
  resumePendingAuthenticatedMcpRetry,
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
    expect(recorder.snapshot().events[0]).toMatchObject({
      outcome: 'started',
      explanation: expect.stringContaining('awaiting SDK parsing and validation'),
    });
    expect(recorder.snapshot().events[0].explanation).not.toContain('succeeded');
    recorder.settleLatestProvisionalOAuthResponse('succeeded');

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

  it('rewrites persisted events when a value is registered as secret after recording', () => {
    const lateSecret = 'opaque-late-bound-value-7f6d4a';
    const recorder = createOAuthFlightRecorder({
      targetUrl: TARGET_URL,
      storage: sessionStorage,
    });
    recorder.record({
      type: 'callback',
      outcome: 'failed',
      provenance: 'browser_callback',
      route: 'browser',
      explanation: `The callback response included ${lateSecret}.`,
    });

    recorder.registerSecret(lateSecret);

    const persisted = JSON.stringify(getStoredOAuthTrace(TARGET_URL, sessionStorage));
    expect(persisted).not.toContain(lateSecret);
    expect(persisted).toContain(OAUTH_TRACE_REDACTED);
  });

  it('sanitizes nested proxy targets without losing route context', () => {
    const target = 'https://mcp.example/mcp?access_token=target-secret&custom_secret=custom-secret&tenant=acme&operation=initialize';
    const proxy = `https://proxy.example/?target=${encodeURIComponent(target)}&state=proxy-secret&signed_request=signed-secret&login_hint=alice%40example.com&x-amz-signature=aws-secret`;

    const sanitized = sanitizeOAuthTraceUrl(proxy);
    const sanitizedTarget = new URL(sanitized).searchParams.get('target') || '';

    expect(sanitized).toContain('proxy.example');
    expect(new URL(sanitized).searchParams.get('state')).toBe(OAUTH_TRACE_REDACTED);
    expect(new URL(sanitizedTarget).searchParams.get('tenant')).toBe('acme');
    expect(new URL(sanitizedTarget).searchParams.get('operation')).toBe('initialize');
    for (const secret of [
      'target-secret',
      'custom-secret',
      'proxy-secret',
      'signed-secret',
      'alice@example.com',
      'aws-secret',
    ]) {
      expect(decodeURIComponent(sanitized)).not.toContain(secret);
    }

    createOAuthFlightRecorder({ targetUrl: target, storage: sessionStorage });
    expect(Object.keys(sessionStorage).join(' ')).not.toContain('target-secret');
    expect(JSON.stringify(getStoredOAuthTrace(target, sessionStorage))).not.toContain('custom-secret');
  });

  it('redacts sensitive assignments hidden in allowlisted nested query values', () => {
    const url = new URL('https://proxy.example/connect');
    url.searchParams.set('operation', 'initialize&access_token=operation-secret');
    url.searchParams.set('tenant', 'acme%2526client%255Fsecret%253Dtenant-secret');
    url.searchParams.set('target', 'not-a-url&refresh_token=target-secret');
    url.searchParams.set('resource', 'resource-scope%26code%3Dresource-secret');
    url.searchParams.set(
      'redirect_uri',
      '/oauth/callback?code=redirect-secret&operation=complete%26state%3Dnested-secret'
    );

    const sanitized = sanitizeOAuthTraceUrl(url);
    const params = new URL(sanitized).searchParams;
    const redirectUri = params.get('redirect_uri') || '';

    expect(params.get('operation')).toBe(OAUTH_TRACE_REDACTED);
    expect(params.get('tenant')).toBe(OAUTH_TRACE_REDACTED);
    expect(params.get('target')).toBe(OAUTH_TRACE_REDACTED);
    expect(params.get('resource')).toBe(OAUTH_TRACE_REDACTED);
    expect(new URL(redirectUri, 'https://proxy.example').searchParams.get('code'))
      .toBe(OAUTH_TRACE_REDACTED);
    expect(new URL(redirectUri, 'https://proxy.example').searchParams.get('operation'))
      .toBe(OAUTH_TRACE_REDACTED);
    for (const secret of [
      'operation-secret',
      'tenant-secret',
      'target-secret',
      'resource-secret',
      'redirect-secret',
      'nested-secret',
    ]) {
      expect(decodeURIComponent(sanitized)).not.toContain(secret);
    }
  });

  it('keys and validates traces by the exact target without exposing sensitive query values', () => {
    const firstTarget = `${TARGET_URL}?state=first-secret&tenant=acme`;
    const secondTarget = `${TARGET_URL}?state=second-secret&tenant=acme`;
    const first = createOAuthFlightRecorder({
      targetUrl: firstTarget,
      storage: sessionStorage,
      traceId: 'first-trace',
    });
    first.setAuthenticatedMcpRetryState('pending');
    createOAuthFlightRecorder({
      targetUrl: secondTarget,
      storage: sessionStorage,
      traceId: 'second-trace',
    });

    expect(getStoredOAuthTrace(firstTarget, sessionStorage)?.traceId).toBe('first-trace');
    expect(getStoredOAuthTrace(secondTarget, sessionStorage)?.traceId).toBe('second-trace');
    expect(resumePendingAuthenticatedMcpRetry({
      targetUrl: secondTarget,
      storage: sessionStorage,
      operation: 'wrong target',
    })).toBeUndefined();
    expect(Object.keys(sessionStorage).join(' ')).not.toContain('first-secret');
    expect(Object.keys(sessionStorage).join(' ')).not.toContain('second-secret');
    expect(JSON.stringify(getStoredOAuthTrace(firstTarget, sessionStorage))).not.toContain('first-secret');
  });

  it('stores only allowlisted sanitized challenge response metadata', () => {
    const recorder = recordOAuthAuthenticationChallenge({
      targetUrl: TARGET_URL,
      status: 401,
      source: 'target',
      route: 'direct',
      responseHeaders: {
        'www-authenticate': 'Bearer realm="private-realm", error_description="credential rejected for alice@example.com", resource_metadata="https://auth.example/metadata?device_code=device-secret&token=%5BREDACTED%5D"',
        'set-cookie': 'session=must-not-be-stored',
      },
    });

    expect(recorder.snapshot().events[0].response?.headers).toEqual({
      'www-authenticate': expect.stringContaining('resource_metadata='),
    });
    expect(recorder.serialize()).toContain('auth.example/metadata');
    expect(recorder.serialize()).not.toContain('must-not-be-stored');
    expect(recorder.serialize()).not.toContain('private-realm');
    expect(recorder.serialize()).not.toContain('credential rejected for alice@example.com');
    expect(recorder.serialize()).not.toContain('device-secret');
    expect(recorder.serialize()).toMatch(/(?:\[REDACTED\]|%5BREDACTED%5D)/i);
  });

  it('centrally allowlists and sanitizes raw response headers recorded by public producers', () => {
    const recorder = createOAuthFlightRecorder({ targetUrl: TARGET_URL });
    recorder.record({
      type: 'target_challenge',
      outcome: 'challenged',
      provenance: 'direct_target',
      route: 'direct',
      explanation: 'A producer recorded the raw challenge response.',
      response: {
        status: 401,
        headers: {
          'Content-Type': 'application/json',
          Location: 'https://auth.example/continue?code=location-secret&tenant=acme',
          'WWW-Authenticate': 'Bearer realm="private-realm", error_description="credential rejected", resource_metadata="https://metadata.example/custom?device_code=challenge-secret&tenant=acme"',
          'X-Debug-Context': 'unsupported-secret',
          'Set-Cookie': 'session=cookie-secret',
        },
      },
    });

    const headers = recorder.snapshot().events[0].response?.headers;
    expect(headers).toEqual({
      'content-type': 'application/json',
      location: expect.stringContaining('tenant=acme'),
      'www-authenticate': expect.stringContaining('resource_metadata='),
    });
    const serialized = recorder.serialize();
    for (const secret of [
      'location-secret',
      'private-realm',
      'credential rejected',
      'challenge-secret',
      'unsupported-secret',
      'cookie-secret',
    ]) {
      expect(serialized).not.toContain(secret);
    }
  });

  it('records HTTP evidence for a custom resource-metadata URL learned from a challenge', async () => {
    const metadataUrl = 'https://metadata.example/oauth/resource?tenant=public&device_code=metadata-secret';
    const recorder = recordOAuthAuthenticationChallenge({
      targetUrl: TARGET_URL,
      status: 401,
      source: 'target',
      route: 'direct',
      responseHeaders: {
        'WWW-Authenticate': `Bearer resource_metadata="${metadataUrl}"`,
      },
    });
    const fetchFn = vi.fn().mockResolvedValue(new Response(
      JSON.stringify({ resource: TARGET_URL }),
      { status: 200, headers: { 'Content-Type': 'application/json' } }
    ));

    await createOAuthTraceFetch(recorder, fetchFn)(metadataUrl, { method: 'GET' });

    const event = recorder.snapshot().events.find(
      ({ type }) => type === 'protected_resource_metadata'
    );
    expect(event).toMatchObject({
      outcome: 'started',
      provenance: 'direct_target',
      request: {
        method: 'GET',
        url: expect.stringContaining('tenant=public'),
      },
      response: { status: 200 },
      timing: expect.objectContaining({ durationMs: expect.any(Number) }),
    });
    expect(recorder.serialize()).not.toContain('metadata-secret');
  });

  it('redacts sensitive assignments nested in decoded, encoded, and header-style text', () => {
    const callback = new URL('https://mcptest.io/oauth/callback');
    callback.searchParams.set(
      'error_description',
      'access_token=nested-access&refresh_token=nested-refresh&authorization_code%3Dnested-code'
    );
    const recorder = createOAuthFlightRecorder({ targetUrl: TARGET_URL });
    recorder.record({
      type: 'callback',
      outcome: 'failed',
      provenance: 'browser_callback',
      route: 'browser',
      explanation: 'Authorization: Bearer header-access, refresh_token: header-refresh',
      request: { method: 'GET', url: callback.toString() },
    });

    const serialized = recorder.serialize();
    for (const secret of [
      'nested-access',
      'nested-refresh',
      'nested-code',
      'header-access',
      'header-refresh',
    ]) {
      expect(serialized).not.toContain(secret);
    }
    expect(serialized).toContain(OAUTH_TRACE_REDACTED);
  });

  it('canonicalizes OAuth credential key variants across URLs, metadata, snapshots, persistence, and serialization', () => {
    const credentialVariants = {
      device_code: 'device-secret-exact',
      user_code: 'user-secret-exact',
      id_token_hint: 'hint-secret-exact',
      accessToken: 'access-secret-exact',
      authorizationCode: 'code-secret-exact',
      'client-secret': 'client-secret-exact',
    };
    const credentialUrl = new URL('https://auth.example/authorize');
    for (const [key, value] of Object.entries(credentialVariants)) {
      credentialUrl.searchParams.set(key, value);
    }

    const sanitizedUrl = sanitizeOAuthTraceUrl(credentialUrl);
    const recorder = createOAuthFlightRecorder({
      targetUrl: credentialUrl.toString(),
      storage: sessionStorage,
    });
    recorder.record({
      type: 'callback',
      outcome: 'failed',
      provenance: 'browser_callback',
      route: 'browser',
      explanation: Object.entries(credentialVariants)
        .map(([key, value]) => `${key}=${value}`)
        .join(' '),
      request: { method: 'GET', url: credentialUrl.toString() },
      response: { metadata: credentialVariants },
    });

    const evidence = [
      sanitizedUrl,
      JSON.stringify(recorder.snapshot()),
      JSON.stringify(getStoredOAuthTrace(credentialUrl.toString(), sessionStorage)),
      recorder.serialize(),
      serializeOAuthTrace(recorder.snapshot()),
    ];
    for (const secret of Object.values(credentialVariants)) {
      for (const value of evidence) expect(value).not.toContain(secret);
    }
    expect(recorder.snapshot().events[0].response?.metadata).toEqual(
      Object.fromEntries(Object.keys(credentialVariants).map((key) => [key, OAUTH_TRACE_REDACTED]))
    );
  });

  it('sanitizes query values in authorization server URL arrays before persistence', () => {
    const secrets = ['login-hint-secret', 'signed-request-secret', 'aws-signature-secret'];
    const authorizationServer = new URL('https://auth.example/authorize');
    authorizationServer.searchParams.set('tenant', 'acme');
    authorizationServer.searchParams.set('login_hint', secrets[0]);
    authorizationServer.searchParams.set('signed_request', secrets[1]);
    authorizationServer.searchParams.set('x-amz-signature', secrets[2]);
    const recorder = createOAuthFlightRecorder({ targetUrl: TARGET_URL, storage: sessionStorage });

    recorder.record({
      type: 'protected_resource_metadata',
      outcome: 'succeeded',
      provenance: 'direct_target',
      route: 'direct',
      explanation: 'Protected-resource metadata returned authorization servers.',
      response: {
        metadata: { authorizationServers: [authorizationServer.toString()] },
      },
    });

    const snapshotUrl = new URL(
      (recorder.snapshot().events[0].response?.metadata?.authorizationServers as string[])[0]
    );
    expect(snapshotUrl.searchParams.get('tenant')).toBe('acme');
    expect(snapshotUrl.searchParams.get('login_hint')).toBe(OAUTH_TRACE_REDACTED);
    expect(snapshotUrl.searchParams.get('signed_request')).toBe(OAUTH_TRACE_REDACTED);
    expect(snapshotUrl.searchParams.get('x-amz-signature')).toBe(OAUTH_TRACE_REDACTED);

    const evidence = [
      JSON.stringify(recorder.snapshot()),
      JSON.stringify(getStoredOAuthTrace(TARGET_URL, sessionStorage)),
      recorder.serialize(),
    ];
    for (const secret of secrets) {
      for (const value of evidence) expect(value).not.toContain(secret);
    }
  });

  it('redacts credentials in nested assignments from ordinary and persisted trace evidence', () => {
    const nestedSecrets = [
      'plain-secret-exact',
      'quoted-secret-exact',
      'json-secret-exact',
      'code-secret-exact',
    ];
    const nestedText = [
      `error_description=access_token=${nestedSecrets[0]}`,
      `error="client_secret=${nestedSecrets[1]}"`,
      `{"error_description":"refresh_token=${nestedSecrets[2]}"}`,
      `outer=authorization_code=${nestedSecrets[3]}`,
    ].join(' | ');
    const recorder = createOAuthFlightRecorder({ targetUrl: TARGET_URL, storage: sessionStorage });
    recorder.record({
      type: 'callback',
      outcome: 'failed',
      provenance: 'browser_callback',
      route: 'browser',
      explanation: nestedText,
      response: {
        metadata: {
          error_description: nestedText,
          nested: { message: nestedText },
        },
      },
    });

    const evidence = [
      recorder.snapshot().events[0].explanation,
      JSON.stringify(recorder.snapshot()),
      JSON.stringify(getStoredOAuthTrace(TARGET_URL, sessionStorage)),
      recorder.serialize(),
      serializeOAuthTrace(recorder.snapshot()),
    ];
    for (const secret of nestedSecrets) {
      for (const value of evidence) expect(value).not.toContain(secret);
    }
  });

  it('resumes and finalizes only the pending retry for the exact target without replacing it', () => {
    const original = recordOAuthAuthenticationChallenge({
      targetUrl: TARGET_URL,
      status: 401,
      source: 'target',
      route: 'direct',
      storage: sessionStorage,
    });
    original.setAuthenticatedMcpRetryState('pending');
    const originalTraceId = original.snapshot().traceId;

    const duplicate = recordOAuthAuthenticationChallenge({
      targetUrl: TARGET_URL,
      status: 403,
      source: 'target',
      route: 'proxy',
      storage: sessionStorage,
    });
    expect(duplicate.snapshot().traceId).not.toBe(originalTraceId);
    expect(duplicate.snapshot().events.filter(({ type }) => type === 'target_challenge')).toHaveLength(1);
    expect(getStoredOAuthTrace(TARGET_URL, sessionStorage)?.traceId).toBe(originalTraceId);
    expect(resumePendingAuthenticatedMcpRetry({
      targetUrl: 'https://other.example/mcp',
      storage: sessionStorage,
      operation: 'unrelated connection',
    })).toBeUndefined();

    const retry = resumePendingAuthenticatedMcpRetry({
      targetUrl: TARGET_URL,
      storage: sessionStorage,
      operation: 'test operation',
    });
    const competingRetry = resumePendingAuthenticatedMcpRetry({
      targetUrl: TARGET_URL,
      storage: sessionStorage,
      operation: 'competing operation',
    });
    const request = {
      method: 'POST',
      url: `${TARGET_URL}?operation=initialize`,
      status: 200,
      outcome: 'succeeded' as const,
      startedAt: '2026-08-11T18:00:00.000Z',
      durationMs: 19,
    };
    retry?.observeRequest('direct')(request);
    expect(retry?.succeed({
      route: 'direct',
      result: {
        url: TARGET_URL,
        transportType: 'streamable-http',
        protocolEra: 'modern',
        observedRequests: [request],
      },
    })).toBe(true);
    expect(competingRetry?.succeed({
      route: 'direct',
      result: {
        url: TARGET_URL,
        transportType: 'streamable-http',
        protocolEra: 'modern',
        observedRequests: [request],
      },
    })).toBe(false);

    const stored = getStoredOAuthTrace(TARGET_URL, sessionStorage);
    expect(stored).toMatchObject({
      traceId: originalTraceId,
      outcome: { status: 'authorized' },
      events: expect.arrayContaining([expect.objectContaining({
        type: 'mcp_retry',
        outcome: 'succeeded',
        request: { method: 'POST', url: request.url },
        response: { status: 200, metadata: expect.any(Object) },
        timing: { startedAt: request.startedAt, durationMs: 19 },
      })]),
    });
    expect(stored?.authenticatedMcpRetry).toBeUndefined();
    expect(stored?.events.filter(({ type }) => type === 'mcp_retry')).toHaveLength(1);
    expect(stored?.events.filter(({ type }) => type === 'terminal_outcome')).toHaveLength(1);
  });

  it('keeps a pending authenticated retry open across a retryable failure that later succeeds', () => {
    const trace = recordOAuthAuthenticationChallenge({
      targetUrl: TARGET_URL,
      status: 401,
      source: 'target',
      route: 'direct',
      storage: sessionStorage,
    });
    trace.setAuthenticatedMcpRetryState('pending');
    const retry = resumePendingAuthenticatedMcpRetry({
      targetUrl: TARGET_URL,
      storage: sessionStorage,
      operation: 'saved-card tool call',
    });
    retry?.observeRequest('direct')({
      method: 'POST',
      url: TARGET_URL,
      status: 409,
      outcome: 'failed',
    });

    expect(getStoredOAuthTrace(TARGET_URL, sessionStorage)).toMatchObject({
      authenticatedMcpRetry: { phase: 'pending' },
    });
    expect(getStoredOAuthTrace(TARGET_URL, sessionStorage)?.outcome).toBeUndefined();

    const successfulRequest = {
      method: 'POST',
      url: TARGET_URL,
      status: 200,
      outcome: 'succeeded' as const,
    };
    retry?.observeRequest('direct')(successfulRequest);
    retry?.succeed({
      route: 'direct',
      result: {
        url: TARGET_URL,
        transportType: 'streamable-http',
        protocolEra: 'modern',
        observedRequests: [successfulRequest],
      },
    });

    expect(getStoredOAuthTrace(TARGET_URL, sessionStorage)).toMatchObject({
      outcome: { status: 'authorized' },
      events: expect.arrayContaining([
        expect.objectContaining({
          type: 'mcp_retry',
          outcome: 'succeeded',
          response: expect.objectContaining({ status: 200 }),
        }),
      ]),
    });
  });

  it('uses failed request evidence when a retry is finalized as failed', () => {
    const trace = recordOAuthAuthenticationChallenge({
      targetUrl: TARGET_URL,
      status: 401,
      source: 'target',
      route: 'direct',
      storage: sessionStorage,
    });
    trace.setAuthenticatedMcpRetryState('pending');
    const retry = resumePendingAuthenticatedMcpRetry({
      targetUrl: TARGET_URL,
      storage: sessionStorage,
      operation: 'server report evaluation',
    });
    const failedRequest = {
      method: 'POST',
      url: `${TARGET_URL}?operation=tools-list`,
      status: 500,
      outcome: 'failed' as const,
    };
    const laterSuccessfulRequest = {
      method: 'POST',
      url: `${TARGET_URL}?operation=resources-list`,
      status: 200,
      outcome: 'succeeded' as const,
    };

    retry?.fail({
      route: 'direct',
      error: new Error('Capability evaluation failed'),
      result: {
        url: TARGET_URL,
        transportType: 'streamable-http',
        protocolEra: 'modern',
        observedRequests: [failedRequest, laterSuccessfulRequest],
      },
    });

    expect(getStoredOAuthTrace(TARGET_URL, sessionStorage)?.events).toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          type: 'mcp_retry',
          outcome: 'failed',
          request: { method: 'POST', url: failedRequest.url },
          response: expect.objectContaining({ status: 500 }),
        }),
      ])
    );
  });

  it('finalizes a cancelled authenticated retry without recording a failure', () => {
    const trace = recordOAuthAuthenticationChallenge({
      targetUrl: TARGET_URL,
      status: 401,
      source: 'target',
      route: 'direct',
      storage: sessionStorage,
    });
    trace.setAuthenticatedMcpRetryState('pending');
    const retry = resumePendingAuthenticatedMcpRetry({
      targetUrl: TARGET_URL,
      storage: sessionStorage,
      operation: 'connection',
    });

    expect(retry?.cancel({
      route: 'direct',
      error: new Error('Connection aborted by user'),
    })).toBe(true);

    const stored = getStoredOAuthTrace(TARGET_URL, sessionStorage);
    expect(stored?.authenticatedMcpRetry).toBeUndefined();
    expect(stored?.outcome?.status).toBe('cancelled');
    expect(stored?.events.filter(({ type }) => type === 'mcp_retry')).toEqual([
      expect.objectContaining({ outcome: 'cancelled' }),
    ]);
    expect(stored?.events.filter(({ type }) => type === 'terminal_outcome')).toEqual([
      expect.objectContaining({ outcome: 'cancelled' }),
    ]);
  });

  it('keeps recording in memory when trace persistence fails', () => {
    const unavailableStorage = {
      getItem: vi.fn().mockReturnValue(null),
      setItem: vi.fn(() => {
        throw new DOMException('Storage quota exceeded', 'QuotaExceededError');
      }),
    };

    expect(() => {
      const recorder = createOAuthFlightRecorder({
        targetUrl: TARGET_URL,
        storage: unavailableStorage,
      });
      recorder.record({
        type: 'target_challenge',
        outcome: 'challenged',
        provenance: 'direct_target',
        route: 'direct',
        explanation: 'The target requires OAuth.',
      });
      expect(recorder.snapshot().events).toHaveLength(1);
    }).not.toThrow();
    expect(unavailableStorage.setItem).toHaveBeenCalled();
  });
});
