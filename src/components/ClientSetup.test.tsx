import React, { act } from 'react';
import { createRoot, type Root } from 'react-dom/client';
import { afterEach, beforeAll, describe, expect, it, vi } from 'vitest';
import type { CatalogServer } from '../types/catalog';
import { getCatalogServerById } from '../utils/catalogUtils';
import ClientSetup from './ClientSetup';

const server: CatalogServer = {
  id: 'example', name: 'Example', url: 'https://example.com/mcp', description: 'Example',
  category: 'Testing', tags: [], listingSource: { kind: 'community' },
  declaredTransport: 'streamable-http', transport: 'streamable-http', requiresOAuth: false,
  declaredAuthType: 'none', authType: 'none', protocolEra: 'unknown', status: 'online',
  logoUrl: '/server-logos/example.svg', logoSourceKind: 'generated-fallback', logoRetrievedAt: '2026-08-18',
};

let root: Root | undefined;
let container: HTMLDivElement | undefined;

beforeAll(() => {
  (globalThis as typeof globalThis & { IS_REACT_ACT_ENVIRONMENT: boolean }).IS_REACT_ACT_ENVIRONMENT = true;
});

afterEach(() => {
  if (root) act(() => root?.unmount());
  container?.remove();
  root = undefined;
  container = undefined;
  vi.restoreAllMocks();
});

const renderSetup = (setupServer: CatalogServer = server) => {
  container = document.createElement('div');
  document.body.append(container);
  root = createRoot(container);
  act(() => root?.render(<ClientSetup server={setupServer} />));
  return container;
};

describe('ClientSetup accessibility and copying', () => {
  it('provides arrow, Home, and End keyboard behavior for tabs', () => {
    const view = renderSetup();
    const tabs = Array.from(view.querySelectorAll<HTMLButtonElement>('[role="tab"]'));
    expect(tabs).toHaveLength(4);
    expect(tabs[0].getAttribute('aria-selected')).toBe('true');

    act(() => tabs[0].dispatchEvent(new KeyboardEvent('keydown', { key: 'ArrowRight', bubbles: true })));
    expect(tabs[1].getAttribute('aria-selected')).toBe('true');
    expect(document.activeElement).toBe(tabs[1]);

    act(() => tabs[1].dispatchEvent(new KeyboardEvent('keydown', { key: 'End', bubbles: true })));
    expect(tabs[3].getAttribute('aria-selected')).toBe('true');

    act(() => tabs[3].dispatchEvent(new KeyboardEvent('keydown', { key: 'Home', bubbles: true })));
    expect(tabs[0].getAttribute('aria-selected')).toBe('true');
  });

  it('copies plain text and announces success', async () => {
    const writeText = vi.fn().mockResolvedValue(undefined);
    Object.defineProperty(navigator, 'clipboard', {
      value: { writeText }, configurable: true,
    });
    const view = renderSetup();
    const copyButton = view.querySelector<HTMLButtonElement>('.client-setup-panel:not([hidden]) .client-setup-copy');

    await act(async () => copyButton?.click());

    expect(writeText).toHaveBeenCalledWith(expect.stringContaining('claude mcp add'));
    expect(view.querySelector('[role="status"]')?.textContent).toContain('Claude Code setup copied');
  });

  it('keeps selectable text and announces a no-clipboard fallback', async () => {
    Object.defineProperty(navigator, 'clipboard', { value: undefined, configurable: true });
    const view = renderSetup();
    const pre = view.querySelector<HTMLPreElement>('.client-setup-panel:not([hidden]) pre');
    const copyButton = view.querySelector<HTMLButtonElement>('.client-setup-panel:not([hidden]) .client-setup-copy');

    await act(async () => copyButton?.click());

    expect(pre?.textContent).toContain('claude mcp add');
    expect(pre?.tabIndex).toBe(0);
    expect(view.querySelector('[role="status"]')?.textContent).toContain('Select the Claude Code setup text');
  });

  it('renders unsupported setups as guidance without a runnable copy action', () => {
    const view = renderSetup({
      ...server,
      declaredAuthType: 'api-key',
      authType: 'api-key',
      requiredHeaders: [{
        name: 'X-Region', description: 'Select the account region',
        required: true, secret: false,
      }],
    });
    const selectedPanel = view.querySelector('.client-setup-panel:not([hidden])');

    expect(selectedPanel?.querySelector('.client-setup-unsupported')?.textContent)
      .toContain('Setup unavailable');
    expect(selectedPanel?.textContent).toContain('required header X-Region');
    expect(selectedPanel?.querySelector('pre')).toBeNull();
    expect(selectedPanel?.querySelector('.client-setup-copy')).toBeNull();
    expect(selectedPanel?.textContent).not.toContain('claude mcp add');
  });

  it('hydrates accurate Asana registration instructions in all client panels', () => {
    const asana = getCatalogServerById('asana');
    expect(asana).toBeDefined();
    const text = renderSetup(asana!).textContent || '';

    expect(text).toContain('--client-id "${ASANA_CLIENT_ID}" --client-secret --callback-port 8080');
    expect(text).toContain('mcp-remote@latest');
    expect(text).toContain('CLIENT_SECRET');
    expect(text).toContain('http://127.0.0.1:33418/');
    expect(text).toContain('https://vscode.dev/redirect');
    expect(text).toContain('natively prompts first for the client ID');
    expect(text).not.toContain('no OAuth secret belongs in this configuration');
  });

  it('hydrates missing callback evidence as unsupported for all four clients', () => {
    const view = renderSetup({
      ...server,
      requiresOAuth: true,
      declaredAuthType: 'oauth',
      authType: 'oauth',
      oauthRegistration: {
        mode: 'pre-registered-required',
        clientId: { required: true, environmentVariable: 'EXAMPLE_CLIENT_ID' },
        clientSecret: { required: true, environmentVariable: 'EXAMPLE_CLIENT_SECRET' },
        callback: { required: true, redirectUrls: {} },
        codexMcpRemote: {
          resourceUrl: 'https://example.com',
          callbackUrl: 'http://localhost:3334/oauth/callback',
          callbackPort: 3334,
        },
        evidenceUrl: 'https://example.com/oauth-registration',
      },
    });

    expect(view.querySelectorAll('.client-setup-unsupported')).toHaveLength(4);
    expect(view.querySelectorAll('.client-setup-panel pre')).toHaveLength(0);
    expect(view.querySelectorAll('.client-setup-copy')).toHaveLength(0);
    expect(view.textContent).not.toMatch(/redirect URL:\s*\./);
  });

  it('hydrates the PagerDuty API-token alternative and EU guidance', () => {
    const pagerduty = getCatalogServerById('pagerduty');
    expect(pagerduty).toBeDefined();
    const text = renderSetup(pagerduty!).textContent || '';

    expect(text).toContain('Token token=');
    expect(text).toContain('PAGERDUTY_API_TOKEN');
    expect(text).toContain('https://mcp.eu.pagerduty.com/mcp');
    expect(text).toContain('automatic OAuth client registration is unavailable');
    expect(text).not.toContain('no OAuth secret belongs in this configuration');
  });
});
