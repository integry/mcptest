import { describe, expect, it } from 'vitest';
import { getLearnArticle } from '../content/learnRegistry';
import type { ConnectionAttemptFact, ConnectionErrorDetails } from './connectionDiagnostics';
import { GUIDANCE_ARTICLES, getCallGuidance, getConnectionGuidance, learnLink } from './connectionGuidance';
import { DIAGNOSTICS_REFERENCE_PATH } from './referenceLinks';
import type { TransportDiagnostic } from '../types/transportDiagnostics';

const attempt = (overrides: Partial<ConnectionAttemptFact>): ConnectionAttemptFact => ({
  route: 'direct',
  candidateUrl: 'https://example.com/mcp',
  transportType: 'streamable-http',
  method: 'POST',
  browserUnreadable: false,
  failureKind: 'http',
  message: 'failed',
  ...overrides,
});

const details = (overrides: Partial<ConnectionErrorDetails> = {}): ConnectionErrorDetails => ({
  error: 'Connection failed',
  serverUrl: 'https://example.com/mcp',
  timestamp: new Date('2026-11-12T00:00:00Z'),
  ...overrides,
});

const idFor = (overrides: Partial<ConnectionErrorDetails>) => getConnectionGuidance(details(overrides)).id;

describe('connection failure guidance', () => {
  it('links only to articles that exist in the registry, at their registered path', () => {
    for (const [key, slug] of Object.entries(GUIDANCE_ARTICLES)) {
      const article = getLearnArticle(slug);
      expect(article, slug).toBeDefined();
      expect(learnLink(key as keyof typeof GUIDANCE_ARTICLES)?.path).toBe(article!.path);
    }
  });

  it.each([
    ['browser-blocked', { attempts: [attempt({ browserUnreadable: true, failureKind: 'browser-unreadable', status: undefined })] }, 'cors'],
    ['unauthorized', { attempts: [attempt({ status: 401, authenticationSource: 'target', failureKind: 'authentication' })] }, 'unauthorized'],
    ['forbidden', { attempts: [attempt({ status: 403 })] }, 'unauthorized'],
    ['not-found', { attempts: [attempt({ status: 404 })] }, 'notFound'],
    ['session-not-found', { error: 'Session not found', attempts: [attempt({ status: 404 })] }, 'sessionNotFound'],
    ['media-type', { attempts: [attempt({ status: 405 })] }, 'mediaType'],
    ['server-error', { attempts: [attempt({ status: 502 })] }, 'posting'],
    ['timeout', { attempts: [attempt({ failureKind: 'timeout', status: undefined })] }, 'timeout'],
    ['unreachable', { attempts: [attempt({ failureKind: 'refused', status: undefined })] }, 'connect'],
    ['unreachable', { error: 'TypeError: Failed to fetch' }, 'connect'],
    ['closed', { error: 'MCP error -32000: Connection closed' }, 'closed'],
    ['oauth-failed', { failureStage: 'oauth' as const, error: 'OAuth authorization failed: invalid_client' }, 'oauthDiscovery'],
    ['unknown', {}, 'connect'],
  ] as const)('maps %s to plain language and its article', (id, overrides, article) => {
    const guidance = getConnectionGuidance(details(overrides as Partial<ConnectionErrorDetails>));
    expect(guidance.id).toBe(id);
    expect(guidance.whatFailed).toMatch(/\.$/);
    expect(guidance.likelyCause.length).toBeGreaterThan(10);
    expect(guidance.tryThis.length).toBeGreaterThan(0);
    expect(guidance.learn?.path).toBe(getLearnArticle(GUIDANCE_ARTICLES[article])!.path);
  });

  it('separates the mcptest proxy login from the target server', () => {
    expect(idFor({ attempts: [attempt({ route: 'proxy', status: 401, authenticationSource: 'proxy' })] })).toBe('proxy-login');
  });

  it('prefers the target status over a 404 on a guessed candidate path', () => {
    expect(idFor({ attempts: [attempt({ status: 404 }), attempt({ status: 401, authenticationSource: 'target' })] })).toBe('unauthorized');
  });

  it('is not a CORS problem once the proxy read the target response', () => {
    expect(idFor({
      attempts: [
        attempt({ browserUnreadable: true, failureKind: 'browser-unreadable' }),
        attempt({ route: 'proxy', status: 500, responseSource: 'target' }),
      ],
    })).toBe('server-error');
  });

  it('never reports a proxy-owned response as the target status', () => {
    expect(idFor({ attempts: [attempt({ route: 'proxy', status: 500, responseSource: 'proxy' })] })).toBe('proxy-error');
    expect(idFor({ attempts: [attempt({ status: 502, responseSource: 'proxy' })] })).toBe('proxy-error');
    // Behind an opaque direct attempt, the proxy's own failure leaves the browser block as the evidence.
    expect(idFor({
      attempts: [
        attempt({ browserUnreadable: true, failureKind: 'browser-unreadable' }),
        attempt({ route: 'proxy', status: 500, responseSource: 'proxy' }),
      ],
    })).toBe('browser-blocked');
  });

  it('prefers a later target 401 over an earlier proxy-login challenge', () => {
    expect(idFor({
      attempts: [
        attempt({ route: 'proxy', status: 401, authenticationSource: 'proxy' }),
        attempt({ route: 'proxy', status: 401, authenticationSource: 'target', responseSource: 'target' }),
      ],
    })).toBe('unauthorized');
  });

  it('keeps a successful initialize and later browser block ahead of a guessed-path 404', () => {
    const endpoint = 'https://example.com/mcp';
    const sequence = [
      attempt({ candidateUrl: `${endpoint}/`, status: 404, responseSource: 'target' }),
      attempt({ candidateUrl: endpoint, mcpMethod: 'initialize', status: 200, responseSource: 'target', failureKind: 'success' }),
      attempt({ candidateUrl: endpoint, mcpMethod: 'notifications/initialized', browserUnreadable: true, failureKind: 'browser-unreadable' }),
    ];
    const guidance = getConnectionGuidance(details({ attempts: sequence }));
    expect(guidance.id).toBe('browser-blocked-after-initialize');
    expect(guidance.learn?.path).toBe(getLearnArticle(GUIDANCE_ARTICLES.cors)!.path);
  });

  it('uses the transport diagnostics for 429 and 406 findings', () => {
    const diagnostic = (id: TransportDiagnostic['id']) => ({
      id, status: 'detected', severity: 'error', title: id, explanation: '', remediation: '', evidence: [],
    }) as unknown as TransportDiagnostic;
    const limited = getConnectionGuidance(details({ transportDiagnostics: [diagnostic('transport.target-rate-limited-429')] }));
    expect(limited.id).toBe('rate-limited');
    expect(limited.learn?.path).toBe(`${DIAGNOSTICS_REFERENCE_PATH}#transport-target-rate-limited-429`);
    expect(idFor({ transportDiagnostics: [diagnostic('transport.accept-header-406')] })).toBe('media-type');
  });
});

describe('tool call failure guidance', () => {
  it.each([
    [{ isError: true }, 'tool-error-result'],
    [{ message: 'Failed to execute tool x: MCP error -32602: Invalid params' }, 'invalid-params'],
    [{ message: '“items” must contain valid JSON.' }, 'invalid-params'],
    [{ message: 'MCP error -32601: Method not found' }, 'method-not-found'],
    [{ message: 'MCP error -32001: Request timed out' }, 'call-timeout'],
    [{ message: 'HTTP 404: Session not found' }, 'call-session-lost'],
    [{ message: 'HTTP 401 Unauthorized' }, 'call-unauthorized'],
    [{ message: 'TypeError: Failed to fetch' }, 'call-connection-lost'],
    [{ message: 'Something odd' }, 'call-failed'],
  ])('maps %o to %s', (failure, id) => {
    const guidance = getCallGuidance(failure);
    expect(guidance.id).toBe(id);
    expect(guidance.learn).toBeDefined();
  });
});
