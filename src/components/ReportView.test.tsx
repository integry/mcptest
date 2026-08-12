import React, { act } from 'react';
import { createRoot, type Root } from 'react-dom/client';
import { afterEach, beforeAll, beforeEach, describe, expect, it, vi } from 'vitest';
import type { EvaluationReport } from '../utils/evaluation';
import ReportView, {
  getAuthorizationGateOptions,
  getOAuthTraceForEvaluation,
  getStaticCredentialHeaders,
} from './ReportView';
import { createOAuthFlightRecorder } from '../utils/oauthTrace';

const challengedReport = (challenge: string): EvaluationReport => ({
  serverUrl: 'https://auth.example/mcp',
  authenticationUrl: 'https://auth.example/mcp',
  outcome: 'authorization-required',
  finalScore: 0,
  sections: {
    auth: {
      name: 'Authorization required',
      description: 'Credential prerequisite',
      score: 0,
      maxScore: 0,
      details: [{
        text: 'Authorization required',
        metadata: {
          authenticationSource: 'target',
          responseHeaders: { 'WWW-Authenticate': challenge },
        },
      }],
    },
  },
});

const oauthAuthorizationDetail = { text: 'OAuth authorization is required' };

describe('report static credential delivery', () => {
  it('uses the Authorization header and advertised scheme for an ApiKey challenge', () => {
    expect(getStaticCredentialHeaders(
      challengedReport('ApiKey realm="mcp"'),
      'api-key',
      'secret-value'
    )).toEqual({ Authorization: 'ApiKey secret-value' });
  });

  it('uses the x-api-key header for an x-api-key challenge', () => {
    expect(getStaticCredentialHeaders(
      challengedReport('x-api-key realm="mcp"'),
      'api-key',
      'secret-value'
    )).toEqual({ 'x-api-key': 'secret-value' });
  });

  it.each([
    ['x-api-key', { 'x-api-key': 'secret-value' }],
    ['api-key', { 'api-key': 'secret-value' }],
    ['authorization', { Authorization: 'ApiKey secret-value' }],
  ] as const)('uses the selected %s API-key delivery for an unknown challenge', (header, expected) => {
    expect(getStaticCredentialHeaders(
      challengedReport('Proprietary realm="mcp"'),
      'api-key',
      'secret-value',
      header
    )).toEqual(expected);
  });
});

describe('report authorization alternatives', () => {
  it('offers guided OAuth alongside bearer entry for a legacy Bearer-only target', () => {
    expect(getAuthorizationGateOptions(challengedReport('Bearer'))).toEqual({
      offersOAuth: true,
      staticSchemes: ['bearer'],
      isUnknown: false,
    });
  });

  it('keeps every choice exposed for a multi-challenge target', () => {
    expect(getAuthorizationGateOptions(
      challengedReport('Bearer, ApiKey')
    )).toEqual({
      offersOAuth: true,
      staticSchemes: ['bearer', 'api-key'],
      isUnknown: false,
    });
  });
});

describe('report OAuth trace correlation', () => {
  it('excludes a target trace that was not created or continued by the current evaluation', () => {
    sessionStorage.clear();
    const report = challengedReport('Bearer realm="mcp"');
    const recorder = createOAuthFlightRecorder({
      targetUrl: report.serverUrl,
      storage: sessionStorage,
      startedAt: '2026-08-11T20:00:00.000Z',
    });
    recorder.record({
      type: 'target_challenge',
      outcome: 'challenged',
      timestamp: '2026-08-11T20:00:00.000Z',
      provenance: 'direct_target',
      route: 'direct',
      explanation: 'Historical challenge.',
    });

    expect(getOAuthTraceForEvaluation(
      report,
      Date.parse('2026-08-11T21:00:00.000Z'),
      sessionStorage
    )).toBeUndefined();
    expect(getOAuthTraceForEvaluation(
      report,
      Date.parse('2026-08-11T19:00:00.000Z'),
      sessionStorage
    )?.traceId).toBe(recorder.snapshot().traceId);
  });
});

const authMocks = vi.hoisted(() => ({
  getIdToken: vi.fn(),
}));
const oauthMocks = vi.hoisted(() => ({
  begin: vi.fn(),
  prepare: vi.fn(),
}));
const evaluationMocks = vi.hoisted(() => ({
  evaluate: vi.fn(),
}));

vi.mock('react-router-dom', async (importOriginal) => {
  const actual = await importOriginal<typeof import('react-router-dom')>();
  return {
    ...actual,
    useNavigate: () => vi.fn(),
    useLocation: () => ({
      pathname: `/report/${encodeURIComponent('https://api.githubcopilot.com/mcp/')}`,
      state: null,
    }),
  };
});

vi.mock('../context/AuthContext', () => ({
  useAuth: () => ({
    currentUser: { getIdToken: authMocks.getIdToken },
    loading: false,
  }),
}));

vi.mock('../utils/oauthFlow', async (importOriginal) => {
  const actual = await importOriginal<typeof import('../utils/oauthFlow')>();
  return {
    ...actual,
    beginOAuthFlow: oauthMocks.begin,
    prepareManualOAuthClient: oauthMocks.prepare,
  };
});

vi.mock('../utils/evaluation', async (importOriginal) => {
  const actual = await importOriginal<typeof import('../utils/evaluation')>();
  return {
    ...actual,
    evaluateServer: evaluationMocks.evaluate,
  };
});

beforeAll(() => {
  (
    globalThis as typeof globalThis & { IS_REACT_ACT_ENVIRONMENT: boolean }
  ).IS_REACT_ACT_ENVIRONMENT = true;
});

let root: Root | undefined;

describe('ReportView OAuth discovery', () => {
  beforeEach(() => {
    localStorage.clear();
    sessionStorage.clear();
    vi.stubEnv('VITE_PROXY_URL', 'https://proxy.mcptest.test/');
    authMocks.getIdToken.mockReset().mockResolvedValue('firebase-session-token');
    oauthMocks.begin.mockReset().mockResolvedValue('REDIRECT');
    oauthMocks.prepare.mockReset().mockResolvedValue(undefined);
    evaluationMocks.evaluate.mockReset().mockResolvedValue({
      serverUrl: 'https://api.githubcopilot.com/mcp/',
      authenticationUrl: 'https://api.githubcopilot.com/mcp/',
      outcome: 'authorization-required',
      finalScore: 0,
      sections: {
        auth: {
          name: 'Authorization Required',
          description: 'OAuth authorization is required',
          score: 0,
          maxScore: 0,
          details: [oauthAuthorizationDetail],
        },
      },
    });
  });

  afterEach(() => {
    if (root) act(() => root?.unmount());
    root = undefined;
    vi.unstubAllEnvs();
    vi.unstubAllGlobals();
    vi.restoreAllMocks();
  });

  it('supplies the authenticated proxy to report OAuth discovery when fallback is configured', async () => {
    const container = document.createElement('div');
    root = createRoot(container);
    act(() => {
      root?.render(<ReportView />);
    });

    const runButton = Array.from(container.querySelectorAll('button')).find(
      (button) => button.textContent?.includes('Run Report')
    );
    await act(async () => {
      runButton?.click();
    });

    const authorizeButton = Array.from(container.querySelectorAll('button')).find(
      (button) => button.textContent?.includes('Authorize and run report')
    );
    await act(async () => {
      authorizeButton?.click();
    });

    expect(oauthMocks.begin).toHaveBeenCalledWith(
      'https://api.githubcopilot.com/mcp/',
      expect.objectContaining({
        discoveryProxy: {
          url: 'https://proxy.mcptest.test/',
          authorizationToken: 'firebase-session-token',
        },
        deferAuthorizedTraceOutcome: true,
      })
    );
  });

  it('passes ephemeral challenge metadata and scope into report OAuth discovery', async () => {
    const metadataUrl = 'https://api.githubcopilot.com/.well-known/oauth-protected-resource/mcp/?token=challenge-secret';
    evaluationMocks.evaluate.mockImplementationOnce(async () => {
      const report = {
        serverUrl: 'https://api.githubcopilot.com/mcp/',
        authenticationUrl: 'https://api.githubcopilot.com/mcp/',
        outcome: 'authorization-required' as const,
        finalScore: 0,
        sections: {
          auth: {
            name: 'Authorization Required',
            description: 'OAuth authorization is required',
            score: 0,
            maxScore: 0,
            details: [oauthAuthorizationDetail],
          },
        },
      };
      Object.defineProperties(report, {
        resourceMetadataUrl: { value: metadataUrl, enumerable: false },
        scope: { value: 'repo read:user', enumerable: false },
      });
      return report;
    });
    const container = document.createElement('div');
    root = createRoot(container);
    act(() => {
      root?.render(<ReportView />);
    });

    const runButton = Array.from(container.querySelectorAll('button')).find(
      (button) => button.textContent?.includes('Run Report')
    );
    await act(async () => {
      runButton?.click();
    });
    const authorizeButton = Array.from(container.querySelectorAll('button')).find(
      (button) => button.textContent?.includes('Authorize and run report')
    );
    await act(async () => {
      authorizeButton?.click();
    });

    expect(oauthMocks.begin).toHaveBeenCalledWith(
      'https://api.githubcopilot.com/mcp/',
      expect.objectContaining({
        resourceMetadataUrl: metadataUrl,
        scope: 'repo read:user',
      })
    );
    expect(Array.from({ length: sessionStorage.length }, (_, index) => {
      const key = sessionStorage.key(index) || '';
      return `${key}:${sessionStorage.getItem(key) || ''}`;
    }).join('\n')).not.toContain('challenge-secret');
  });

  it('uses challenge metadata and authenticated proxy fallback before showing hosted GitHub and PAT paths', async () => {
    const target = 'https://api.githubcopilot.com/mcp/';
    const metadataUrl = 'https://api.githubcopilot.com/.well-known/oauth-protected-resource/mcp/';
    const issuer = 'https://github.com/login/oauth';
    const authorizationMetadataUrl = 'https://github.com/.well-known/oauth-authorization-server/login/oauth';
    const directCalls: string[] = [];
    const proxyTargets: string[] = [];
    evaluationMocks.evaluate.mockResolvedValueOnce({
      serverUrl: target,
      authenticationUrl: target,
      resourceMetadataUrl: metadataUrl,
      outcome: 'authorization-required',
      finalScore: 0,
      sections: {
        auth: {
          name: 'Authorization Required',
          description: 'OAuth authorization is required',
          score: 0,
          maxScore: 0,
          details: [{
            ...oauthAuthorizationDetail,
            metadata: { authenticationSource: 'target', route: 'proxy', status: 401 },
          }],
        },
      },
    });
    vi.stubGlobal('fetch', vi.fn(async (input: RequestInfo | URL, init?: RequestInit) => {
      const url = String(input);
      if (url.startsWith('https://proxy.mcptest.test/')) {
        const proxyUrl = new URL(url);
        proxyTargets.push(proxyUrl.searchParams.get('target') || '');
        expect(new Headers(init?.headers).get('authorization')).toBe('Bearer firebase-session-token');
        return new Response(JSON.stringify({
          issuer,
          authorization_endpoint: `${issuer}/authorize`,
          token_endpoint: `${issuer}/token`,
          response_types_supported: ['code'],
          code_challenge_methods_supported: ['S256'],
        }), {
          headers: {
            'Content-Type': 'application/json',
            'X-MCP-Proxy-Response-Source': 'target',
          },
        });
      }
      directCalls.push(url);
      if (url === metadataUrl) {
        return new Response(JSON.stringify({
          resource: target,
          authorization_servers: [issuer],
        }), { headers: { 'Content-Type': 'application/json' } });
      }
      if (url === authorizationMetadataUrl) {
        throw new TypeError('Direct browser CORS failure');
      }
      return new Response('Not found', { status: 404 });
    }));
    const { prepareManualOAuthClient: actualPrepareManualOAuthClient } = await vi.importActual<
      typeof import('../utils/oauthFlow')
    >('../utils/oauthFlow');
    oauthMocks.prepare.mockImplementationOnce(actualPrepareManualOAuthClient);

    const container = document.createElement('div');
    root = createRoot(container);
    act(() => {
      root?.render(<ReportView />);
    });

    const runButton = Array.from(container.querySelectorAll('button')).find(
      (button) => button.textContent?.includes('Run Report')
    );
    await act(async () => {
      runButton?.click();
    });
    const configureButton = Array.from(container.querySelectorAll('button')).find(
      (button) => button.textContent?.includes('Enter client credentials')
    );
    await act(async () => {
      configureButton?.click();
    });

    expect(directCalls).toContain(metadataUrl);
    expect(directCalls).toContain(authorizationMetadataUrl);
    expect(proxyTargets).toEqual([authorizationMetadataUrl]);
    expect(oauthMocks.begin).not.toHaveBeenCalled();
    expect(container.textContent).toContain('Authorize with GitHub');
    expect(container.textContent).toContain('GitHub host application required');
    expect(container.textContent).toContain('Use a GitHub personal access token');
    expect(container.querySelector('#clientId')).toBeNull();
    expect(container.querySelector('#clientSecret')).toBeNull();
    const bearerInput = container.querySelector<HTMLInputElement>(
      '#oauth-prerequisite-bearer-token'
    );
    expect(bearerInput).not.toBeNull();

    await act(async () => {
      const valueSetter = Object.getOwnPropertyDescriptor(
        HTMLInputElement.prototype,
        'value'
      )?.set;
      valueSetter?.call(bearerInput, 'github-pat');
      bearerInput?.dispatchEvent(new Event('input', { bubbles: true }));
      bearerInput?.dispatchEvent(new Event('change', { bubbles: true }));
    });
    const retryButton = Array.from(container.querySelectorAll('button')).find(
      (button) => button.textContent?.includes('Retry with bearer token')
    );
    expect(bearerInput?.value).toBe('github-pat');
    expect(retryButton?.disabled).toBe(false);
    await act(async () => {
      retryButton?.closest('form')?.dispatchEvent(new Event('submit', {
        bubbles: true,
        cancelable: true,
      }));
    });

    expect(evaluationMocks.evaluate).toHaveBeenCalledTimes(2);
    expect(evaluationMocks.evaluate.mock.calls[1][4]).toEqual({
      Authorization: 'Bearer github-pat',
    });
    expect(evaluationMocks.evaluate.mock.calls[1][5]).toBeUndefined();
  });

  it('does not launch automatic registration or redirect from the registered-client action', async () => {
    const target = 'https://mcp.figma.com/mcp';
    const resourceMetadataUrl = 'https://mcp.figma.com/.well-known/oauth-protected-resource';
    const issuer = 'https://api.figma.com';
    const registrationEndpoint = 'https://api.figma.com/v1/oauth/mcp/register';
    const calls: Array<{ method: string; url: string }> = [];
    evaluationMocks.evaluate.mockResolvedValueOnce({
      serverUrl: target,
      authenticationUrl: target,
      resourceMetadataUrl,
      scope: 'file_content:read',
      outcome: 'authorization-required',
      finalScore: 0,
      sections: {
        auth: {
          name: 'Authorization Required',
          description: 'OAuth authorization is required',
          score: 0,
          maxScore: 0,
          details: [oauthAuthorizationDetail],
        },
      },
    });
    vi.stubGlobal('fetch', vi.fn(async (input: RequestInfo | URL, init?: RequestInit) => {
      const url = String(input);
      calls.push({ method: init?.method || 'GET', url });
      if (url === resourceMetadataUrl) {
        return new Response(JSON.stringify({
          resource: target,
          authorization_servers: [issuer],
          scopes_supported: ['file_content:read'],
        }), { headers: { 'Content-Type': 'application/json' } });
      }
      if (url === `${issuer}/.well-known/oauth-authorization-server`) {
        return new Response(JSON.stringify({
          issuer,
          authorization_endpoint: `${issuer}/authorize`,
          token_endpoint: `${issuer}/token`,
          registration_endpoint: registrationEndpoint,
          response_types_supported: ['code'],
          code_challenge_methods_supported: ['S256'],
        }), { headers: { 'Content-Type': 'application/json' } });
      }
      return new Response('Not found', { status: 404 });
    }));
    const { prepareManualOAuthClient: actualPrepareManualOAuthClient } = await vi.importActual<
      typeof import('../utils/oauthFlow')
    >('../utils/oauthFlow');
    oauthMocks.prepare.mockImplementationOnce(actualPrepareManualOAuthClient);

    const container = document.createElement('div');
    root = createRoot(container);
    act(() => {
      root?.render(<ReportView />);
    });

    const runButton = Array.from(container.querySelectorAll('button')).find(
      (button) => button.textContent?.includes('Run Report')
    );
    await act(async () => {
      runButton?.click();
    });
    const configureButton = Array.from(container.querySelectorAll('button')).find(
      (button) => button.textContent?.includes('Enter client credentials')
    );
    await act(async () => {
      configureButton?.click();
    });

    expect(oauthMocks.prepare).toHaveBeenCalledWith(target, expect.objectContaining({
      resourceMetadataUrl,
      discoveryProxy: {
        url: 'https://proxy.mcptest.test/',
        authorizationToken: 'firebase-session-token',
      },
    }));
    expect(oauthMocks.begin).not.toHaveBeenCalled();
    expect(calls).not.toContainEqual({ method: 'POST', url: registrationEndpoint });
    expect(container.textContent).toContain('Configure an existing client');
    expect(container.querySelector('#clientId')).not.toBeNull();
  });

  it('renders proxy login without target-authorization actions or guidance', async () => {
    evaluationMocks.evaluate.mockResolvedValue({
      serverUrl: 'https://mcp.slack.com/mcp',
      outcome: 'authorization-required',
      authenticationRequirement: { kind: 'proxy', status: 401 },
      finalScore: 0,
      sections: {
        auth: {
          name: 'Proxy Authentication Required',
          description: 'A valid mcptest login is required to use the authenticated proxy',
          score: 0,
          maxScore: 0,
          status: 'skipped',
          details: [{ text: 'Sign in to mcptest again, then retry the report.' }],
        },
      },
    });
    const container = document.createElement('div');
    root = createRoot(container);
    act(() => {
      root?.render(<ReportView />);
    });

    const runButton = Array.from(container.querySelectorAll('button')).find(
      (button) => button.textContent?.includes('Run Report')
    );
    await act(async () => {
      runButton?.click();
    });

    expect(container.textContent).toContain('mcptest login required');
    expect(container.textContent).toContain('Sign in to mcptest');
    expect(container.textContent).not.toContain('Complete server authorization');
    expect(container.textContent).not.toContain('Authorize and run report');
    expect(oauthMocks.begin).not.toHaveBeenCalled();
  });
});
