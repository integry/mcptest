import { beforeEach, describe, expect, it } from 'vitest';
import {
  classifySavedCardAuthenticationFailure,
  resumeSavedCardAuthenticatedMcpRetry,
} from './App';
import {
  ProxiedAuthenticationError,
  TransportConnectionError,
} from './utils/transportDetection';
import {
  getStoredOAuthTrace,
  recordOAuthAuthenticationChallenge,
} from './utils/oauthTrace';

describe('saved card authentication failures', () => {
  beforeEach(() => {
    sessionStorage.clear();
  });
  it('does not request OAuth for a direct JSON-RPC Forbidden application error', () => {
    const error = new Error('MCP error -32000: Forbidden operation');

    expect(classifySavedCardAuthenticationFailure(error, false)).toBeUndefined();
  });

  it('does not treat application-defined JSON-RPC data as an HTTP challenge', () => {
    const error = Object.assign(new Error('MCP application error'), {
      data: { status: 403 },
    });

    expect(classifySavedCardAuthenticationFailure(error, false)).toBeUndefined();
  });

  it('classifies a structured direct HTTP authentication status as target OAuth', () => {
    const error = Object.assign(new Error('Request failed'), { status: 401 });

    expect(classifySavedCardAuthenticationFailure(error, false)).toEqual({
      status: 401,
      source: 'target',
    });
  });

  it('uses an observed direct response challenge for saved-card OAuth', () => {
    expect(classifySavedCardAuthenticationFailure(
      new Error('Transport rejected the request'),
      false,
      { status: 403, source: 'target' }
    )).toEqual({ status: 403, source: 'target' });
  });

  it('preserves target provenance through nested proxy connection failures', () => {
    const targetError = new ProxiedAuthenticationError(
      403,
      'target',
      new Error('Upstream denied the request')
    );

    expect(classifySavedCardAuthenticationFailure(
      new TransportConnectionError([targetError]),
      true
    )).toEqual({ status: 403, source: 'target' });
  });

  it('keeps proxy-owned authentication failures out of target OAuth', () => {
    const proxyError = new ProxiedAuthenticationError(
      401,
      'proxy',
      new Error('Proxy session expired')
    );

    expect(classifySavedCardAuthenticationFailure(proxyError, true)).toEqual({
      status: 401,
      source: 'proxy',
    });
  });

  it('does not guess the source of an unproven proxied HTTP status', () => {
    const ambiguousError = Object.assign(new Error('Request failed'), { status: 401 });

    expect(classifySavedCardAuthenticationFailure(ambiguousError, true)).toBeUndefined();
  });

  it.each([
    ['successful', 'succeeded', 200, 'authorized'],
    ['failed', 'failed', 503, 'failed'],
  ] as const)(
    'finalizes a %s saved-card post-callback retry with its actual request evidence',
    (_label, retryOutcome, status, terminalStatus) => {
      const endpoint = `https://${retryOutcome}-saved-card.example/mcp`;
      const trace = recordOAuthAuthenticationChallenge({
        targetUrl: endpoint,
        status: 401,
        source: 'target',
        route: 'direct',
        storage: sessionStorage,
      });
      trace.setAuthenticatedMcpRetryState('pending');
      const retry = resumeSavedCardAuthenticatedMcpRetry(
        endpoint,
        'oauth-access-token',
        sessionStorage
      );
      const request = {
        method: 'POST',
        url: `${endpoint}?operation=tools-call`,
        status,
        outcome: retryOutcome,
        startedAt: '2026-08-11T18:30:00.000Z',
        durationMs: 38,
        transportType: 'streamable-http' as const,
      };
      retry?.observeRequest('direct')(request);

      if (retryOutcome === 'succeeded') {
        retry?.succeed({
          route: 'direct',
          result: {
            url: endpoint,
            transportType: 'streamable-http',
            protocolEra: 'modern',
            observedRequests: [request],
          },
        });
      } else {
        retry?.fail({ route: 'direct', error: new Error('Saved-card tool call failed') });
      }

      const stored = getStoredOAuthTrace(endpoint, sessionStorage);
      expect(stored?.events.find(({ type }) => type === 'mcp_retry')).toMatchObject({
        outcome: retryOutcome,
        route: 'direct',
        request: { method: 'POST', url: request.url },
        response: { status },
        timing: { startedAt: request.startedAt, durationMs: 38 },
      });
      expect(stored?.outcome?.status).toBe(terminalStatus);
      expect(stored?.authenticatedMcpRetry).toBeUndefined();
    }
  );
});
