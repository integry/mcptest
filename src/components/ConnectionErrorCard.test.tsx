import React, { act } from 'react';
import { createRoot, type Root } from 'react-dom/client';
import { afterEach, beforeAll, describe, expect, it } from 'vitest';
import ConnectionErrorCard from './ConnectionErrorCard';

beforeAll(() => {
  (
    globalThis as typeof globalThis & { IS_REACT_ACT_ENVIRONMENT: boolean }
  ).IS_REACT_ACT_ENVIRONMENT = true;
});

let root: Root | undefined;

afterEach(() => {
  if (root) act(() => root?.unmount());
  root = undefined;
});

const renderError = (serverUrl: string): HTMLElement => {
  const container = document.createElement('div');
  root = createRoot(container);
  act(() => {
    root?.render(<ConnectionErrorCard errorDetails={{
      error: 'All connections failed: Failed to fetch',
      serverUrl,
      timestamp: new Date('2026-08-12T00:00:00.000Z'),
    }} />);
  });
  return container;
};

describe('provider-aware connection diagnostics', () => {
  it('renders only Streamable HTTP troubleshooting for Slack', () => {
    const container = renderError('https://mcp.slack.com/mcp');

    expect(container.textContent).toContain('Streamable HTTP (POST)');
    expect(container.textContent).not.toContain('SSE (GET)');
    expect(container.textContent).not.toContain('/sse');
    expect(container.textContent).not.toContain('either command');
  });

  it('keeps legacy SSE troubleshooting for providers without an HTTP-only policy', () => {
    const container = renderError('https://mcp.example/mcp');

    expect(container.textContent).toContain('Streamable HTTP (POST)');
    expect(container.textContent).toContain('SSE (GET)');
    expect(container.textContent).toContain('/sse');
  });
});
