import React from 'react';
import { renderToStaticMarkup } from 'react-dom/server';
import { MemoryRouter } from 'react-router-dom';
import { describe, expect, it } from 'vitest';
import NotFound from './NotFound';
import { NOT_FOUND_LINKS } from '../utils/appRoutes';
import { getRouteView } from '../views/deferredViews';

const render = () => {
  const container = document.createElement('div');
  container.innerHTML = renderToStaticMarkup(<MemoryRouter><NotFound /></MemoryRouter>);
  return container;
};

describe('NotFound', () => {
  it('renders the heading, the guide search and links to the playground, catalog and guides', () => {
    const container = render();
    expect(container.querySelector('.reading-shell h1')?.textContent).toBe('Page not found');
    expect(container.querySelector('[role="combobox"]')).not.toBeNull();
    expect([...container.querySelectorAll('.not-found-links a')].map(link => link.getAttribute('href')))
      .toEqual(NOT_FOUND_LINKS.map(link => link.path));
  });

  it('is the first view for unknown paths, so no view chunk is preloaded for them', () => {
    expect(getRouteView('/no-such-page')).toBe('not-found');
    expect(getRouteView('/catalog/')).toBe('not-found');
    expect(getRouteView('/server/https://example.com/mcp')).toBe('playground');
    expect(getRouteView('/')).toBe('playground');
  });
});
