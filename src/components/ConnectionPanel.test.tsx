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

  it('preserves the enabled proxy preference while signed out', () => {
    const panel = renderPanel(true);
    const proxyToggle = panel.querySelector<HTMLInputElement>('#proxyFallbackCheck');

    expect(proxyToggle?.checked).toBe(true);
    expect(proxyToggle?.disabled).toBe(true);
    expect(proxyToggle?.getAttribute('aria-describedby')).toBe('proxyFallbackHelp');
    expect(panel.textContent).toContain('Sign in with Google before mcptest can use the enabled proxy fallback.');
  });

  it('preserves an explicit proxy opt-out while signed out', () => {
    const panel = renderPanel(false);
    const proxyToggle = panel.querySelector<HTMLInputElement>('#proxyFallbackCheck');

    expect(proxyToggle?.checked).toBe(false);
    expect(proxyToggle?.disabled).toBe(true);
    expect(panel.textContent).toContain('Proxy fallback is off. Sign in with Google to change this preference.');
  });

  it('restores the chosen proxy preference when its login prerequisite is met', () => {
    authState.currentUser = { uid: 'user-1' };
    const panel = renderPanel(true);
    const proxyToggle = panel.querySelector<HTMLInputElement>('#proxyFallbackCheck');

    expect(proxyToggle?.checked).toBe(true);
    expect(proxyToggle?.disabled).toBe(false);
    expect(panel.querySelector('#proxyFallbackHelp')).toBeNull();
  });

  it('places connection state beside the panel heading and renders negotiation as prose', () => {
    const panel = renderPanel();
    const heading = panel.querySelector('.connection-title-row');
    const route = panel.querySelector('.connection-route');

    expect(heading?.querySelector('#connectionStatus')?.textContent).toBe('Disconnected');
    expect(panel.querySelector('.card-header #connectionStatus')).not.toBeNull();
    expect(panel.querySelector('.input-group #connectionStatus')).toBeNull();
    expect(route?.textContent).toContain('Exact endpoint');
    expect(route?.textContent).toContain('2026 stateless discovery');
    expect(route?.textContent).toContain('2025 stateful fallback');
    expect(route?.textContent).toContain('OAuth discovery after a verified authorization challenge');
    expect(route?.querySelector('.badge')).toBeNull();
    expect(panel.textContent).not.toContain('Use OAuth Authentication');
  });

  it('hides connection negotiation and proxy controls behind advanced options', () => {
    const panel = renderPanel();
    const advanced = panel.querySelector<HTMLDetailsElement>('.connection-advanced');

    expect(advanced).not.toBeNull();
    expect(advanced?.open).toBe(false);
    expect(advanced?.querySelector('summary')?.textContent).toContain('Advanced options');
    expect(advanced?.querySelector('#proxyFallbackCheck')).not.toBeNull();
    expect(advanced?.querySelector('.connection-route')).not.toBeNull();
  });
});
