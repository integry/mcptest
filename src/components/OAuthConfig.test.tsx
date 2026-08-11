import React, { act } from 'react';
import { createRoot, type Root } from 'react-dom/client';
import { afterEach, beforeAll, describe, expect, it, vi } from 'vitest';
import type { OAuthPrerequisite } from '../utils/oauthFlow';
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
  sessionStorage.clear();
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
    expect(view.textContent).toContain('Supplying arbitrary client credentials is not expected');
    expect(view.textContent).toContain(`${window.location.origin}/oauth/callback`);
    expect(view.querySelector('#clientId')).toBeNull();
    expect(view.querySelector('a[href="https://developers.figma.com/docs/figma-mcp-server/"]'))
      .not.toBeNull();
  });

  it('offers provider registration and existing-client configuration for Slack', () => {
    const view = renderPanel({
      kind: 'pre_registered_client_required',
      serverUrl: 'https://mcp.slack.com/mcp',
      providerName: 'Slack',
      explanation: 'Slack requires a pre-registered OAuth application.',
      documentationUrl: 'https://api.slack.com/authentication/oauth-v2',
      registrationUrl: 'https://api.slack.com/apps',
      requiredScopes: ['channels:read', 'chat:write'],
      pkceS256: true,
      publicClientSecretSupported: false,
      canConfigureClient: true,
      failedStage: 'dynamic client registration',
    });

    expect(view.textContent).toContain('Register an OAuth application for Slack');
    expect(view.textContent).toContain('channels:read, chat:write');
    expect(view.textContent).toContain('does not support safely keeping a client secret');
    expect(view.querySelector('#clientId')).not.toBeNull();
    expect(view.querySelector('a[href="https://api.slack.com/apps"]')).not.toBeNull();
  });
});
