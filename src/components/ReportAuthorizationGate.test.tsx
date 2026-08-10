import React from 'react';
import { renderToStaticMarkup } from 'react-dom/server';
import { describe, expect, it, vi } from 'vitest';
import ReportAuthorizationGate from './ReportAuthorizationGate';

describe('ReportAuthorizationGate', () => {
  it('presents OAuth as an unscored prerequisite with both authorization paths', () => {
    const markup = renderToStaticMarkup(
      <ReportAuthorizationGate
        serverUrl="https://mcp.figma.com/"
        onAuthorize={vi.fn()}
        onConfigureClient={vi.fn()}
      />
    );
    const container = document.createElement('div');
    container.innerHTML = markup;

    expect(container.textContent).toContain('Authorization required');
    expect(container.textContent).toContain('Not scored');
    expect(container.textContent).toContain('not a failed report');
    expect(container.textContent).toContain('Authorize and run report');
    expect(container.textContent).toContain('Enter client credentials');
    expect(container.textContent).not.toContain('Final Score');
    expect(container.textContent).not.toContain('MCP negotiation failed');
  });
});
