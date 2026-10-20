import React from 'react';
import { renderToStaticMarkup } from 'react-dom/server';
import { describe, expect, it } from 'vitest';
import { AwaitingConnectionPanel } from './FirstConnectionOnboarding';

describe('awaiting connection panel', () => {
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
