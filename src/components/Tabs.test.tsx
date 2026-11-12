import React, { act } from 'react';
import { createRoot, type Root } from 'react-dom/client';
import { renderToStaticMarkup } from 'react-dom/server';
import { afterEach, beforeAll, describe, expect, it, vi } from 'vitest';
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import Tabs, { getTabDisplayLabel } from './Tabs';
import type { ConnectionTab } from '../types';

const tab = (overrides: Partial<ConnectionTab>): ConnectionTab => ({
  id: 'tab',
  title: 'New Connection',
  serverUrl: '',
  connectionStatus: 'Disconnected',
  useProxy: false,
  ...overrides,
});

describe('playground tab labels', () => {
  it('shows the host first so truncation keeps it visible', () => {
    expect(getTabDisplayLabel('Server: https://mcp.context7.com/mcp')).toBe('mcp.context7.com/mcp');
    expect(getTabDisplayLabel('Server: https://mcp.deepwiki.com/')).toBe('mcp.deepwiki.com');
    expect(getTabDisplayLabel('mcp.api.coingecko.com/sse')).toBe('mcp.api.coingecko.com/sse');
    expect(getTabDisplayLabel('Server: localhost:3001/mcp')).toBe('Server: localhost:3001/mcp');
  });

  it('leaves plain titles alone', () => {
    expect(getTabDisplayLabel('New Connection')).toBe('New Connection');
    expect(getTabDisplayLabel('Context7')).toBe('Context7');
    expect(getTabDisplayLabel('Result: get_weather')).toBe('Result: get_weather');
  });

  it('renders a scrollable strip with the full title in the tooltip and close label', () => {
    const markup = renderToStaticMarkup(
      <Tabs
        tabs={[
          tab({ id: 'a', title: 'Server: https://mcp.context7.com/mcp', connectionStatus: 'Connected' }),
          tab({ id: 'b' }),
        ]}
        activeTabId="a"
        onSelectTab={vi.fn()}
        onCloseTab={vi.fn()}
        onNewTab={vi.fn()}
      />
    );
    const container = document.createElement('div');
    container.innerHTML = markup;

    const strip = container.querySelector('.playground-tab-strip');
    const list = strip?.querySelector('.nav-tabs.playground-tabs[role="tablist"]');
    const active = list?.querySelector<HTMLElement>('[role="tab"][aria-selected="true"]');

    expect(list).not.toBeNull();
    expect(active?.title).toBe('Server: https://mcp.context7.com/mcp');
    expect(active?.querySelector('.playground-tab-label')?.textContent).toBe('mcp.context7.com/mcp');
    expect(container.querySelector('[aria-label="Close Server: https://mcp.context7.com/mcp tab"]')).not.toBeNull();

    const css = readFileSync(resolve('src/components/Tabs.css'), 'utf8');
    expect(css).toMatch(/\.playground-tabs\.nav-tabs\s*\{[^}]*flex-wrap:\s*nowrap;[^}]*overflow-x:\s*auto;/);
    expect(css).toMatch(/\.playground-tab-strip--fade-end/);
    expect(css).toMatch(/\.playground-tab-label\s*\{[^}]*text-overflow:\s*ellipsis;/);
  });
});

describe('playground tab strip overflow', () => {
  beforeAll(() => {
    (globalThis as typeof globalThis & { IS_REACT_ACT_ENVIRONMENT: boolean }).IS_REACT_ACT_ENVIRONMENT = true;
  });

  let root: Root | undefined;
  afterEach(() => {
    if (root) act(() => root?.unmount());
    root = undefined;
  });

  /** jsdom has no layout, so the strip reports whatever widths the test sets. */
  const mockWidths = (strip: HTMLElement, widths: { scrollWidth: number; clientWidth: number }) => {
    Object.defineProperty(strip, 'scrollWidth', { configurable: true, get: () => widths.scrollWidth });
    Object.defineProperty(strip, 'clientWidth', { configurable: true, get: () => widths.clientWidth });
  };

  const renderStrip = (tabs: ConnectionTab[], activeTabId: string) => {
    root?.render(
      <Tabs tabs={tabs} activeTabId={activeTabId} onSelectTab={vi.fn()} onCloseTab={vi.fn()} onNewTab={vi.fn()} />
    );
  };

  it('shows the end fade and keeps the active tab in view when titles grow past the width', () => {
    const container = document.createElement('div');
    document.body.appendChild(container);
    root = createRoot(container);
    const shortTabs = [
      tab({ id: 'a', title: 'New Connection' }),
      tab({ id: 'b', title: 'New Connection' }),
      tab({ id: 'c', title: 'New Connection' }),
    ];

    // The strip starts narrow enough to fit the short titles; measure before
    // the effects first run so the initial state is "no overflow".
    const widths = { scrollWidth: 300, clientWidth: 300 };
    const scrollIntoView = vi.fn();
    HTMLElement.prototype.scrollIntoView = scrollIntoView;
    act(() => renderStrip(shortTabs, 'c'));
    const strip = container.querySelector<HTMLElement>('.playground-tabs')!;
    mockWidths(strip, widths);
    act(() => renderStrip(shortTabs, 'c'));
    expect(container.querySelector('.playground-tab-strip--fade-end')).toBeNull();
    scrollIntoView.mockClear();

    // Same IDs, same active tab, same count: only the titles change.
    widths.scrollWidth = 900;
    const longTabs = shortTabs.map((t, i) => ({
      ...t,
      title: `Server: https://mcp.server-${i}.example.com/a/very/long/path/segment`,
    }));
    act(() => renderStrip(longTabs, 'c'));

    expect(container.querySelector('.playground-tab-strip--fade-end')).not.toBeNull();
    expect(container.querySelector('.playground-tab-strip--fade-start')).toBeNull();
    expect(scrollIntoView).toHaveBeenCalledWith({ block: 'nearest', inline: 'nearest' });
    expect(scrollIntoView.mock.instances[0]).toBe(
      container.querySelector('[role="tab"][aria-selected="true"]')
    );
    container.remove();
  });

  it('observes the tab items as well as the strip so growing labels retrigger measurement', () => {
    const observed: Element[] = [];
    class FakeResizeObserver {
      observe(el: Element) { observed.push(el); }
      disconnect() {}
      unobserve() {}
    }
    vi.stubGlobal('ResizeObserver', FakeResizeObserver);
    try {
      const container = document.createElement('div');
      root = createRoot(container);
      act(() => renderStrip([tab({ id: 'a' }), tab({ id: 'b' })], 'a'));
      const strip = container.querySelector('.playground-tabs')!;
      expect(observed).toContain(strip);
      strip.querySelectorAll('.nav-item').forEach((item) => expect(observed).toContain(item));
    } finally {
      vi.unstubAllGlobals();
    }
  });
});
