import { MemoryRouter } from 'react-router-dom';
import React from 'react';
import { renderToStaticMarkup } from 'react-dom/server';
import { describe, expect, it, vi } from 'vitest';
import { SERVICE_PAGE_PATH as CONFIG_PATH } from './config.mts';
import { SERVICE_PAGE_PATH, canonicalAliasPath, getExactAppRoutes, isKnownAppPath } from '../utils/appRoutes';
import { SERVICE_PAGE_FOOTER_LINK, getFooterLinkColumns } from '../content/navigationLinks';
import { isSiteAssistantPath } from '../siteAssistant/config.mts';

/** The browser modules with the build flag as given. */
const loadWithFlag = async (enabled: boolean) => {
  vi.resetModules();
  vi.doMock('./buildFlag', () => ({
    SERVICE_PAGE: { enabled, serviceApi: null, quoteAssistant: null },
    SERVICE_PAGE_ENABLED: enabled,
    APP_ROUTE_OPTIONS: { servicePage: enabled },
  }));
  const [views, footer] = await Promise.all([import('../views/deferredViews'), import('../components/Footer')]);
  vi.doUnmock('./buildFlag');
  return { getRouteView: views.getRouteView, Footer: footer.default };
};

describe('the /mcp-server-development route', () => {
  it('has one spelling everywhere', () => {
    expect(SERVICE_PAGE_PATH).toBe(CONFIG_PATH);
    expect(SERVICE_PAGE_FOOTER_LINK.href).toBe(CONFIG_PATH);
  });

  it('is not a route without the flag', () => {
    expect(getExactAppRoutes()).not.toContain(SERVICE_PAGE_PATH);
    expect(isKnownAppPath(SERVICE_PAGE_PATH)).toBe(false);
    expect(isKnownAppPath(SERVICE_PAGE_PATH, { servicePage: false })).toBe(false);
    expect(canonicalAliasPath(`${SERVICE_PAGE_PATH}/`)).toBeNull();
    expect(getFooterLinkColumns().flatMap(column => column.links).map(link => link.href)).not.toContain(SERVICE_PAGE_PATH);
  });

  it('is a route with the flag', () => {
    expect(getExactAppRoutes({ servicePage: true })).toContain(SERVICE_PAGE_PATH);
    expect(isKnownAppPath(SERVICE_PAGE_PATH, { servicePage: true })).toBe(true);
    expect(canonicalAliasPath(`${SERVICE_PAGE_PATH}/`, { servicePage: true })).toBe(SERVICE_PAGE_PATH);
    expect(canonicalAliasPath(`${SERVICE_PAGE_PATH}/index.html`, { servicePage: true })).toBe(SERVICE_PAGE_PATH);
    const project = getFooterLinkColumns({ servicePage: true }).find(column => column.title === 'Project')!;
    expect(project.links.filter(link => link.href === SERVICE_PAGE_PATH)).toHaveLength(1);
  });

  it('never shows the general site assistant', () => {
    expect(isSiteAssistantPath(SERVICE_PAGE_PATH)).toBe(false);
    expect(isSiteAssistantPath(`${SERVICE_PAGE_PATH}/`)).toBe(false);
  });

  it.each([false, true])('renders the page view and footer link only with the flag (flag %s)', async enabled => {
    const { getRouteView, Footer } = await loadWithFlag(enabled);
    expect(getRouteView(SERVICE_PAGE_PATH)).toBe(enabled ? 'service-page' : 'not-found');
    expect(getRouteView('/mcp-test-client')).toBe('mcp-test-client');
    const footer = renderToStaticMarkup(<MemoryRouter><Footer /></MemoryRouter>);
    expect(footer.includes(`href="${SERVICE_PAGE_PATH}"`)).toBe(enabled);
  });
});
