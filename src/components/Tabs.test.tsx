import React from 'react';
import { renderToStaticMarkup } from 'react-dom/server';
import { describe, expect, it, vi } from 'vitest';
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
