import React from 'react';
import { renderToStaticMarkup } from 'react-dom/server';
import { describe, expect, it, vi } from 'vitest';
import { AwaitingConnectionPanel, FirstConnectionOnboarding } from './FirstConnectionOnboarding';

describe('first connection onboarding', () => {
  it('introduces the inspector and provides a clear manual connection action', () => {
    const markup = renderToStaticMarkup(
      <FirstConnectionOnboarding onConnectFirstServer={vi.fn()} />
    );
    const container = document.createElement('div');
    container.innerHTML = markup;

    expect(container.querySelector('h1')?.textContent).toBe('Welcome to mcptest.io');
    expect(container.textContent).toContain('inspect, debug, and negotiate');
    expect(container.querySelector('button')?.textContent).toContain('Connect your first server');
  });

  it('shows users where connected server data will appear', () => {
    const markup = renderToStaticMarkup(<AwaitingConnectionPanel />);
    const container = document.createElement('div');
    container.innerHTML = markup;

    expect(container.textContent).toContain('Server capabilities');
    expect(container.textContent).toContain('Inspector');
    expect(container.textContent).toContain('Connection logs');
    expect(container.querySelector('h2')?.textContent).toBe('Awaiting connection');
    expect(container.textContent).toContain('output will appear here');
  });
});
