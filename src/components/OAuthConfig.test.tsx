import React, { act } from 'react';
import { createRoot, type Root } from 'react-dom/client';
import { afterEach, beforeAll, describe, expect, it, vi } from 'vitest';
import type { OAuthPrerequisite } from '../utils/oauthFlow';

const hostedOAuthMocks = vi.hoisted(() => ({ begin: vi.fn() }));

vi.mock('../utils/hostedOAuth', () => ({
  beginHostedOAuthFlow: hostedOAuthMocks.begin,
}));

import OAuthConfig from './OAuthConfig';

beforeAll(() => {
  (
    globalThis as typeof globalThis & { IS_REACT_ACT_ENVIRONMENT: boolean }
  ).IS_REACT_ACT_ENVIRONMENT = true;
});

let root: Root | undefined;
let container: HTMLDivElement | undefined;

afterEach(() => {
  if (root) act(() => root?.unmount());
  root = undefined;
  container = undefined;
  localStorage.clear();
  sessionStorage.clear();
  hostedOAuthMocks.begin.mockReset();
  vi.unstubAllEnvs();
});

const renderPanel = (prerequisite: OAuthPrerequisite): HTMLDivElement => {
  container = document.createElement('div');
  root = createRoot(container);
  act(() => {
    root?.render(
      <OAuthConfig
        serverUrl={prerequisite.serverUrl}
        prerequisite={prerequisite}
        onConfigured={vi.fn()}
        onCancel={vi.fn()}
      />
    );
  });
  return container;
};

describe('OAuth authorization prerequisite panel', () => {
  it('presents Figma approval as a calm prerequisite without arbitrary credentials', () => {
    const view = renderPanel({
      kind: 'provider_approval_required',
      serverUrl: 'https://mcp.figma.com/mcp',
      providerName: 'Figma',
      explanation: 'Figma rejected automatic registration for this client.',
      documentationUrl: 'https://developers.figma.com/docs/figma-mcp-server/',
      registrationUrl: 'https://developers.figma.com/docs/figma-mcp-server/',
      requiredScopes: ['file_content:read'],
      pkceS256: true,
      publicClientSecretSupported: true,
      canConfigureClient: false,
      failedStage: 'dynamic client registration',
      httpStatus: 403,
    });

    expect(view.querySelector('.modal')).toBeNull();
    expect(view.querySelector('.oauth-prerequisite-panel')).not.toBeNull();
    expect(view.textContent).toContain('Figma approval is required');
    expect(view.textContent).toContain('Supplying arbitrary ordinary OAuth credentials is not expected');
    expect(view.textContent).toContain(`${window.location.origin}/oauth/callback`);
    expect(view.querySelector('#clientId')).toBeNull();
    expect(view.querySelector('a[href="https://developers.figma.com/docs/figma-mcp-server/"]'))
      .not.toBeNull();
  });

  it('explains Slack confidential operator configuration without browser secret fields', () => {
    const view = renderPanel({
      kind: 'pre_registered_client_required',
      serverUrl: 'https://mcp.slack.com/mcp',
      providerName: 'Slack',
      explanation: 'Slack requires a pre-registered OAuth application.',
      documentationUrl: 'https://docs.slack.dev/ai/slack-mcp-server/',
      registrationUrl: 'https://api.slack.com/apps',
      requiredScopes: ['channels:read', 'chat:write'],
      pkceS256: true,
      publicClientSecretSupported: false,
      canConfigureClient: false,
      configurationMode: 'operator-confidential',
      failedStage: 'dynamic client registration',
    });

    expect(view.textContent).toContain('Slack host application required');
    expect(view.textContent).toContain('channels:read, chat:write');
    expect(view.textContent).toContain('does not support safely keeping a client secret');
    expect(view.textContent).toContain('will not ask you to paste that secret');
    expect(view.querySelector('#clientId')).toBeNull();
    expect(view.querySelector('#clientSecret')).toBeNull();
    expect(view.querySelector('a[href="https://api.slack.com/apps"]')).not.toBeNull();
  });

  it('offers the hosted operator path without a browser secret form for a classified Slack challenge', () => {
    const view = renderPanel({
      kind: 'pre_registered_client_required',
      serverUrl: 'https://mcp.slack.com/mcp',
      providerName: 'Slack',
      explanation: 'Slack requires a confidential client.',
      issuer: 'https://mcp.slack.com',
      documentationUrl: 'https://docs.slack.dev/ai/slack-mcp-server/',
      requiredScopes: ['channels:read'],
      hostedScope: 'channels:read',
      pkceS256: true,
      publicClientSecretSupported: false,
      canConfigureClient: false,
      hostedProvider: 'slack',
    });

    expect(view.textContent).toContain('Authorize with Slack');
    expect(view.textContent).toContain('client secret stays in the Worker');
    expect(view.querySelector('#clientId')).toBeNull();
    expect(view.querySelector('#clientSecret')).toBeNull();
  });

  it('runs return-state persistence before hosted authorization without continuing the manual flow', async () => {
    vi.stubEnv('VITE_PROXY_URL', 'https://proxy.mcptest.test/');
    const order: string[] = [];
    const onConfigured = vi.fn();
    const onBeforeHostedAuthorization = vi.fn(() => {
      order.push('return-state');
      sessionStorage.setItem('oauth_return_view', JSON.stringify({
        activeView: 'playground',
        activeTabId: 'playground-tab-2',
      }));
    });
    hostedOAuthMocks.begin.mockImplementation(async () => {
      order.push('hosted-start');
    });
    const prerequisite: OAuthPrerequisite = {
      kind: 'pre_registered_client_required',
      serverUrl: 'https://mcp.slack.com/mcp',
      providerName: 'Slack',
      explanation: 'Slack requires a confidential client.',
      issuer: 'https://mcp.slack.com',
      requiredScopes: ['channels:read'],
      hostedScope: 'channels:read',
      pkceS256: true,
      publicClientSecretSupported: false,
      canConfigureClient: false,
      hostedProvider: 'slack',
    };
    container = document.createElement('div');
    root = createRoot(container);
    act(() => {
      root?.render(
        <OAuthConfig
          serverUrl={prerequisite.serverUrl}
          prerequisite={prerequisite}
          currentUser={{ getIdToken: vi.fn().mockResolvedValue('firebase-token') }}
          onBeforeHostedAuthorization={onBeforeHostedAuthorization}
          onConfigured={onConfigured}
          onCancel={vi.fn()}
        />
      );
    });

    const authorizeButton = Array.from(container.querySelectorAll('button')).find(
      (button) => button.textContent?.includes('Authorize with Slack')
    );
    await act(async () => {
      authorizeButton?.click();
    });

    expect(order).toEqual(['return-state', 'hosted-start']);
    expect(onBeforeHostedAuthorization).toHaveBeenCalledOnce();
    expect(onConfigured).not.toHaveBeenCalled();
    expect(JSON.parse(sessionStorage.getItem('oauth_return_view') || 'null')).toEqual({
      activeView: 'playground',
      activeTabId: 'playground-tab-2',
    });
  });

  it('explains the operator scope policy when a hosted-provider challenge omits scope', () => {
    const view = renderPanel({
      kind: 'pre_registered_client_required',
      serverUrl: 'https://api.githubcopilot.com/mcp',
      providerName: 'GitHub',
      explanation: 'GitHub requires a confidential client.',
      issuer: 'https://github.com/login/oauth',
      requiredScopes: ['repo', 'read:user', 'workflow'],
      pkceS256: true,
      publicClientSecretSupported: false,
      canConfigureClient: false,
      hostedProvider: 'github',
    });

    expect(view.textContent).toContain('explicit operator policy will supply least-privilege scopes');
    expect(view.textContent).toContain('advertised scopes are not requested automatically');
    expect(view.textContent).not.toContain('repo, read:user, workflow');
  });

  it('offers GitHub PAT guidance without inventing browser OAuth registration', () => {
    const view = renderPanel({
      kind: 'pre_registered_client_required',
      serverUrl: 'https://api.githubcopilot.com/mcp/',
      providerName: 'GitHub',
      explanation: 'GitHub requires a host application or a PAT.',
      documentationUrl: 'https://github.com/github/github-mcp-server/blob/main/docs/remote-server.md',
      registrationUrl: 'https://github.com/settings/applications/new',
      requiredScopes: [],
      pkceS256: false,
      publicClientSecretSupported: false,
      canConfigureClient: false,
      configurationMode: 'operator-confidential',
      supportsBearerToken: true,
      bearerTokenName: 'GitHub personal access token',
    });

    expect(view.textContent).toContain('Use a GitHub personal access token');
    expect(view.textContent).toContain('Authorization: Bearer');
    expect(view.querySelector('#clientId')).toBeNull();
    expect(view.querySelector('#clientSecret')).toBeNull();
  });

  it('suppresses target-provider remedies for proxy authentication', () => {
    const view = renderPanel({
      kind: 'proxy_authentication_required',
      serverUrl: 'https://api.githubcopilot.com/mcp/',
      providerName: 'mcptest proxy',
      explanation: 'Sign in to mcptest again.',
      documentationUrl: 'https://docs.github.com/',
      registrationUrl: 'https://github.com/settings/applications/new',
      requiredScopes: [],
      pkceS256: false,
      publicClientSecretSupported: 'unknown',
      canConfigureClient: true,
      configurationMode: 'operator-confidential',
      supportsBearerToken: true,
      bearerTokenName: 'GitHub personal access token',
    });

    expect(view.textContent).toContain('mcptest proxy authentication required');
    expect(view.textContent).not.toContain('fixed confidential host application');
    expect(view.textContent).not.toContain('GitHub personal access token');
    expect(view.querySelector('.oauth-bearer-option')).toBeNull();
    expect(view.querySelector('#clientId')).toBeNull();
    expect(view.querySelector('a')).toBeNull();
  });
});
