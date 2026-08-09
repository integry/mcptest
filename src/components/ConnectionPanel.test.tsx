import React from 'react';
import { renderToStaticMarkup } from 'react-dom/server';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

const authState = vi.hoisted(() => ({ currentUser: null as { uid: string } | null }));

vi.mock('../context/AuthContext', () => ({
  useAuth: () => ({ currentUser: authState.currentUser }),
}));

import ConnectionPanel from './ConnectionPanel';

const renderPanel = (useProxy = true) => {
  const markup = renderToStaticMarkup(
    <ConnectionPanel
      serverUrl="https://mcp.example/mcp"
      setServerUrl={vi.fn()}
      connectionStatus="Disconnected"
      transportType={null}
      protocolEra={null}
      protocolVersion={null}
      isConnecting={false}
      isConnected={false}
      isDisconnected={true}
      connectionStartTime={null}
      recentServers={[]}
      handleConnect={vi.fn()}
      handleDisconnect={vi.fn()}
      handleAbortConnection={vi.fn()}
      useProxy={useProxy}
      setUseProxy={vi.fn()}
    />
  );
  const container = document.createElement('div');
  container.innerHTML = markup;
  return container;
};

describe('ConnectionPanel landing-page states', () => {
  beforeEach(() => {
    vi.stubEnv('VITE_PROXY_URL', 'https://proxy.example');
    authState.currentUser = null;
  });

  afterEach(() => {
    vi.unstubAllEnvs();
  });

  it('shows proxy fallback as off and unavailable while signed out', () => {
    const panel = renderPanel(true);
    const proxyToggle = panel.querySelector<HTMLInputElement>('#proxyFallbackCheck');

    expect(proxyToggle?.checked).toBe(false);
    expect(proxyToggle?.disabled).toBe(true);
    expect(proxyToggle?.getAttribute('aria-describedby')).toBe('proxyFallbackHelp');
    expect(panel.textContent).toContain('Sign in with Google to enable proxy fallback.');
  });

  it('restores the chosen proxy preference when its login prerequisite is met', () => {
    authState.currentUser = { uid: 'user-1' };
    const panel = renderPanel(true);
    const proxyToggle = panel.querySelector<HTMLInputElement>('#proxyFallbackCheck');

    expect(proxyToggle?.checked).toBe(true);
    expect(proxyToggle?.disabled).toBe(false);
    expect(panel.querySelector('#proxyFallbackHelp')).toBeNull();
  });

  it('keeps connection state by the endpoint action and renders negotiation as prose', () => {
    const panel = renderPanel();
    const heading = panel.querySelector('.connection-field-heading');
    const route = panel.querySelector('.connection-route');

    expect(heading?.querySelector('#connectionStatus')?.textContent).toBe('Disconnected');
    expect(panel.querySelector('.card-header #connectionStatus')).toBeNull();
    expect(route?.textContent).toContain('Exact endpoint');
    expect(route?.textContent).toContain('2026 stateless discovery');
    expect(route?.textContent).toContain('2025 stateful fallback');
    expect(route?.querySelector('.badge')).toBeNull();
  });
});
