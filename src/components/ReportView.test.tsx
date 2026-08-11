import React, { act } from 'react';
import { createRoot, type Root } from 'react-dom/client';
import { afterEach, beforeAll, beforeEach, describe, expect, it, vi } from 'vitest';

const authMocks = vi.hoisted(() => ({
  getIdToken: vi.fn(),
}));
const oauthMocks = vi.hoisted(() => ({
  begin: vi.fn(),
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
  };
});

vi.mock('../utils/evaluation', async (importOriginal) => {
  const actual = await importOriginal<typeof import('../utils/evaluation')>();
  return {
    ...actual,
    evaluateServer: evaluationMocks.evaluate,
  };
});

import ReportView from './ReportView';

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
          details: [],
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
            details: [],
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

  it('uses challenge metadata and authenticated proxy fallback before showing registered-client fields', async () => {
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
          details: [],
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
    expect(container.textContent).toContain('Configure an existing client');
    expect(container.querySelector('#clientId')).not.toBeNull();
  });
});
