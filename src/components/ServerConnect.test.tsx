import React, { act } from 'react';
import { createRoot, type Root } from 'react-dom/client';
import { MemoryRouter } from 'react-router-dom';
import { afterEach, beforeAll, describe, expect, it, vi } from 'vitest';
import type { CatalogServer } from '../types/catalog';
import { CLIENT_COMPATIBILITY } from '../data/clientCompatibility';
import { getCatalogServerById } from '../utils/catalogUtils';
import ServerConnect from './ServerConnect';

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

const renderConnect = (connectServer: CatalogServer = server) => {
  container = document.createElement('div');
  document.body.append(container);
  root = createRoot(container);
  act(() => root?.render(<MemoryRouter><ServerConnect server={connectServer} /></MemoryRouter>));
  return container;
};

const panel = (view: HTMLElement, clientId: string) => view.querySelector<HTMLElement>(`.server-connect-panel[data-client="${clientId}"]`);

describe('ServerConnect client switcher and copying', () => {
  it('offers every client of the compatibility data as a radio, Claude Code first', () => {
    const view = renderConnect();
    const radios = Array.from(view.querySelectorAll<HTMLInputElement>('.server-connect-switch input[type="radio"]'));
    expect(radios.map(({ id }) => id.replace(/^connect-/, '')).sort()).toEqual(CLIENT_COMPATIBILITY.clients.map(({ id }) => id).sort());
    expect(radios[0].id).toBe('connect-claude-code');
    expect(radios[0].checked).toBe(true);
    expect(view.querySelector('fieldset.server-connect-switch legend')?.textContent).toBe('MCP client');
    for (const radio of radios) {
      expect(view.querySelector(`label[for="${radio.id}"]`), radio.id).not.toBeNull();
    }

    const cursor = view.querySelector<HTMLInputElement>('#connect-cursor');
    act(() => cursor?.click());
    expect(cursor?.checked).toBe(true);
    expect(radios[0].checked).toBe(false);
  });

  it('hides unselected panels itself instead of relying on :has() CSS', () => {
    const view = renderConnect();
    const visible = () => Array.from(view.querySelectorAll<HTMLElement>('.server-connect-panel'))
      .filter(({ hidden }) => !hidden)
      .map(({ dataset }) => dataset.client);
    expect(visible()).toEqual(['claude-code']);

    act(() => view.querySelector<HTMLInputElement>('#connect-cursor')?.click());
    expect(visible()).toEqual(['cursor']);
  });

  it('copies a setup snippet and announces success', async () => {
    const writeText = vi.fn().mockResolvedValue(undefined);
    Object.defineProperty(navigator, 'clipboard', { value: { writeText }, configurable: true });
    const view = renderConnect();
    const copyButton = panel(view, 'claude-code')?.querySelector<HTMLButtonElement>('.client-setup-copy');

    await act(async () => copyButton?.click());

    expect(writeText).toHaveBeenCalledWith(expect.stringContaining('claude mcp add'));
    expect(view.querySelector('[role="status"]')?.textContent).toContain('Claude Code setup copied');
    expect(copyButton?.textContent).toBe('Copied');
  });

  it('copies the agent prompt with the server, URL, auth, tools and tools/list verification', async () => {
    const writeText = vi.fn().mockResolvedValue(undefined);
    Object.defineProperty(navigator, 'clipboard', { value: { writeText }, configurable: true });
    const context7 = getCatalogServerById('context7')!;
    const view = renderConnect(context7);
    const button = view.querySelector<HTMLButtonElement>('.server-connect-agent-copy');
    expect(button?.textContent).toBe('Copy as agent prompt');
    expect(button?.dataset.copyFrom).toBe('server-connect-agent-prompt');

    await act(async () => button?.click());

    const prompt = writeText.mock.calls[0][0] as string;
    expect(prompt).toBe(view.querySelector('#server-connect-agent-prompt')?.textContent);
    expect(view.querySelector('details.server-connect-agent-details pre')).not.toBeNull();
    expect(prompt).toContain('Add the Context7 MCP server');
    expect(prompt).toContain('Server URL: https://mcp.context7.com/mcp');
    expect(prompt).toContain('Transport: Streamable HTTP');
    expect(prompt).toContain('Authentication: none');
    for (const tool of context7.capabilityInventory!.tools.items) expect(prompt).toContain(tool.name);
    expect(prompt).toContain('call tools/list');
    expect(prompt).toContain('claude mcp add');
  });

  it('keeps selectable text and announces a no-clipboard fallback', async () => {
    Object.defineProperty(navigator, 'clipboard', { value: undefined, configurable: true });
    const view = renderConnect();
    const pre = panel(view, 'claude-code')?.querySelector<HTMLPreElement>('pre');
    const copyButton = panel(view, 'claude-code')?.querySelector<HTMLButtonElement>('.client-setup-copy');

    await act(async () => copyButton?.click());

    expect(pre?.textContent).toContain('claude mcp add');
    expect(pre?.tabIndex).toBe(0);
    expect(view.querySelector('[role="status"]')?.textContent).toContain('Select the Claude Code setup text');
  });

  it('shows documented configuration surfaces for clients without a generated setup', () => {
    const view = renderConnect();
    const claude = panel(view, 'claude-ai');
    expect(claude?.querySelector('h3')?.textContent).toBe('Claude setup');
    expect(claude?.textContent).toContain('Add custom connector');
    expect(claude?.querySelector('pre')).toBeNull();
    expect(panel(view, 'gemini-cli')?.querySelector('code')?.textContent).toBe('gemini mcp add --transport http <name> <url>');
  });

  it('renders unsupported setups as guidance without a runnable copy action', () => {
    const view = renderConnect({
      ...server,
      declaredAuthType: 'api-key',
      authType: 'api-key',
      requiredHeaders: [{
        name: 'X-Region', description: 'Select the account region',
        required: true, secret: false,
      }],
    });
    const selectedPanel = panel(view, 'claude-code');

    expect(selectedPanel?.querySelector('.client-setup-unsupported')?.textContent).toContain('Setup unavailable');
    expect(selectedPanel?.textContent).toContain('required header X-Region');
    expect(selectedPanel?.querySelector('pre')).toBeNull();
    expect(selectedPanel?.querySelector('.client-setup-copy')).toBeNull();
    expect(view.textContent).not.toContain('claude mcp add');
  });

  it('renders accurate Asana registration instructions across the generated setups', () => {
    const asana = getCatalogServerById('asana');
    expect(asana).toBeDefined();
    const text = renderConnect(asana!).textContent || '';

    expect(text).toContain('--client-id "${ASANA_CLIENT_ID}" --client-secret --callback-port 8080');
    expect(text).toContain('mcp-remote@latest');
    expect(text).toContain('CLIENT_SECRET');
    expect(text).toContain('http://127.0.0.1:33418/');
    expect(text).toContain('https://vscode.dev/redirect');
    expect(text).toContain('natively prompts first for the client ID');
    expect(text).not.toContain('no OAuth secret belongs in this configuration');
  });

  it('renders missing callback evidence as unsupported for all four generated setups', () => {
    const view = renderConnect({
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
    expect(view.querySelectorAll('.server-connect-panel .client-setup-code-wrap')).toHaveLength(0);
    expect(view.querySelectorAll('.client-setup-copy')).toHaveLength(0);
    expect(view.textContent).not.toMatch(/redirect URL:\s*\./);
  });

  it('renders the PagerDuty API-token alternative and EU guidance', () => {
    const pagerduty = getCatalogServerById('pagerduty');
    expect(pagerduty).toBeDefined();
    const text = renderConnect(pagerduty!).textContent || '';

    expect(text).toContain('Token token=');
    expect(text).toContain('PAGERDUTY_API_TOKEN');
    expect(text).toContain('https://mcp.eu.pagerduty.com/mcp');
    expect(text).toContain('automatic OAuth client registration is unavailable');
    expect(text).not.toContain('no OAuth secret belongs in this configuration');
  });
});

describe('ServerConnect compatibility rows', () => {
  it('lists one row per client with a level, a reason and a guide link', () => {
    const view = renderConnect();
    const rows = Array.from(view.querySelectorAll('table.server-connect-compat tbody tr'));
    expect(rows).toHaveLength(CLIENT_COMPATIBILITY.clients.length);
    for (const row of rows) {
      expect(row.querySelector('th a')?.getAttribute('href')).toBeTruthy();
      expect(row.querySelector('td[data-level]')?.textContent).toMatch(/^(Supported|Partial|Not supported)$/);
      expect(row.querySelectorAll('td')[1]?.textContent?.length).toBeGreaterThan(10);
    }
  });

  it('marks clients that cannot send an API key header as not supported, with the reason', () => {
    const view = renderConnect({
      ...server,
      declaredAuthType: 'api-key',
      authType: 'api-key',
      requiredHeaders: [{ name: 'X-API-Key', valueTemplate: '<EXAMPLE_API_KEY>', required: true, secret: true }],
    });
    const chatgpt = Array.from(view.querySelectorAll('table.server-connect-compat tbody tr'))
      .find((row) => row.querySelector('th')?.textContent === 'ChatGPT');
    expect(chatgpt?.querySelector('td[data-level="unsupported"]')?.textContent).toBe('Not supported');
    expect(chatgpt?.textContent).toContain('ChatGPT does not support API key headers');
  });
});
