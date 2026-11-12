import React, { act } from 'react';
import { createRoot } from 'react-dom/client';
import { MemoryRouter } from 'react-router-dom';
import { beforeAll, describe, expect, it, vi } from 'vitest';
import { SuggestedServersPanel } from './SuggestedServersPanel';

beforeAll(() => {
  (globalThis as typeof globalThis & { IS_REACT_ACT_ENVIRONMENT: boolean }).IS_REACT_ACT_ENVIRONMENT = true;
});

describe('SuggestedServersPanel', () => {
  it('suggests the public echo fixture first and links to the test servers page', () => {
    const onServerSelect = vi.fn();
    const container = document.createElement('div');
    const root = createRoot(container);
    act(() => root.render(
      <MemoryRouter><SuggestedServersPanel onServerSelect={onServerSelect} isConnected={false} isConnecting={false} /></MemoryRouter>
    ));
    const rows = container.querySelectorAll('.suggested-server-row');
    expect(rows.length).toBeGreaterThan(1);
    expect(rows[0].getAttribute('data-server-id')).toBe('mcptest-echo');
    expect(rows[0].textContent).toContain('https://mcptest.io/fixtures/echo/mcp');

    act(() => rows[0].querySelector('button')?.dispatchEvent(new MouseEvent('click', { bubbles: true })));
    expect(onServerSelect).toHaveBeenCalledWith({
      endpoint: expect.objectContaining({ url: 'https://mcptest.io/fixtures/echo/mcp', transport: 'streamable-http' }),
      protocolEra: 'stateless',
    });
    expect(container.querySelector('a[href="/mcp-test-servers"]')).not.toBeNull();
    act(() => root.unmount());
  });
});
