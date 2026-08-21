import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import {
  beginHostedOAuthFlow,
  classifyHostedOAuthProvider,
  completeHostedOAuthFlow,
  loadHostedOAuthAuthorization,
} from './hostedOAuth';

describe('browser hosted OAuth boundary', () => {
  beforeEach(() => {
    sessionStorage.clear();
    localStorage.clear();
  });

  afterEach(() => vi.unstubAllGlobals());

  it('classifies only exact trusted target and issuer pairs and never activates Figma', () => {
    expect(classifyHostedOAuthProvider(
      'https://mcp.slack.com/mcp/', 'https://mcp.slack.com'
    )).toMatchObject({ provider: 'slack' });
    expect(classifyHostedOAuthProvider(
      'https://api.githubcopilot.com/mcp', 'https://github.com/login/oauth'
    )).toMatchObject({ provider: 'github' });
    expect(classifyHostedOAuthProvider(
      'https://attacker.example/mcp', 'https://mcp.slack.com'
    )).toBeUndefined();
    expect(classifyHostedOAuthProvider(
      'https://mcp.slack.com/mcp', 'https://attacker.example'
    )).toBeUndefined();
    expect(classifyHostedOAuthProvider(
      'https://mcp.figma.com/mcp', 'https://www.figma.com'
    )).toBeUndefined();
  });

  it('starts with an authenticated request and redirects using only an opaque transaction', async () => {
    const fetchMock = vi.fn().mockResolvedValue(Response.json({ transaction: 'opaque-result' }));
    vi.stubGlobal('fetch', fetchMock);
    const redirect = vi.fn();
    await beginHostedOAuthFlow({
      serverUrl: 'https://mcp.slack.com/mcp', issuer: 'https://mcp.slack.com',
      resourceMetadataUrl: 'https://mcp.slack.com/.well-known/oauth-protected-resource',
      proxyUrl: 'https://proxy.mcptest.io/', firebaseToken: 'firebase-token', redirect,
    });

    const [startUrl, startInit] = fetchMock.mock.calls[0];
    expect(String(startUrl)).toBe('https://proxy.mcptest.io/oauth/hosted/start');
    expect(new Headers(startInit.headers).get('authorization')).toBe('Bearer firebase-token');
    expect(String(startInit.body)).not.toContain('client_secret');
    expect(redirect.mock.calls[0][0].toString()).toBe(
      'https://proxy.mcptest.io/oauth/hosted/authorize?transaction=opaque-result'
    );
  });

  it('persists only an opaque grant in session storage, never provider tokens or local storage', async () => {
    vi.stubGlobal('fetch', vi.fn().mockResolvedValue(Response.json({
      grant: 'opaque-grant', serverUrl: 'https://api.githubcopilot.com/mcp',
      issuer: 'https://github.com/login/oauth',
    })));
    await completeHostedOAuthFlow({
      result: 'opaque-result', proxyUrl: 'https://proxy.mcptest.io/',
      firebaseToken: 'firebase-token',
    });
    expect(loadHostedOAuthAuthorization('https://api.githubcopilot.com/mcp/')).toEqual({
      grant: 'opaque-grant', issuer: 'https://github.com/login/oauth',
    });
    expect(JSON.stringify(sessionStorage)).not.toContain('access_token');
    expect(JSON.stringify(sessionStorage)).not.toContain('refresh_token');
    expect(localStorage.length).toBe(0);
  });
});

