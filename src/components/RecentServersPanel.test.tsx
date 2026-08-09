import React from 'react';
import { renderToStaticMarkup } from 'react-dom/server';
import { describe, expect, it, vi } from 'vitest';
import { RecentServersPanel } from './RecentServersPanel';

describe('RecentServersPanel actions', () => {
  it('uses accessible buttons for reconnecting and removing a server', () => {
    const url = 'https://mcp.example';
    const markup = renderToStaticMarkup(
      <RecentServersPanel
        recentServers={[url]}
        setServerUrl={vi.fn()}
        handleConnect={vi.fn()}
        removeRecentServer={vi.fn()}
        isConnected={false}
        isConnecting={false}
      />
    );
    const container = document.createElement('div');
    container.innerHTML = markup;

    const reconnect = container.querySelector<HTMLButtonElement>('.recent-server-link');
    const remove = container.querySelector<HTMLButtonElement>('.recent-server-remove');

    expect(reconnect?.tagName).toBe('BUTTON');
    expect(reconnect?.textContent).toContain(url);
    expect(remove?.getAttribute('aria-label')).toBe(`Remove ${url} from recent connections`);
    expect(remove?.querySelector('.bi-x-lg')).not.toBeNull();
  });
});
