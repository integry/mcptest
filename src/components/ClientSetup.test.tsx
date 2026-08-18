import React, { act } from 'react';
import { createRoot, type Root } from 'react-dom/client';
import { afterEach, beforeAll, describe, expect, it, vi } from 'vitest';
import type { CatalogServer } from '../types/catalog';
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

const renderSetup = () => {
  container = document.createElement('div');
  document.body.append(container);
  root = createRoot(container);
  act(() => root?.render(<ClientSetup server={server} />));
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
});

