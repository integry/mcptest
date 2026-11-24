import { resolveServicePageConfig, type ServicePageConfig } from './config.mts';

/*
 * The service page's build config in the browser (and in the vite-node
 * prerender). Each variable is read by name so Vite inlines its value
 * instead of the whole env object. With the flag off the page's lazy chunk is
 * never requested and none of its routes or links render.
 * Node scripts never import this file: they read the env themselves
 * (scripts/generate-seo-pages.js) and pass `servicePage` options.
 */
export const SERVICE_PAGE: ServicePageConfig = resolveServicePageConfig({
  VITE_SERVICE_PAGE_ENABLED: import.meta.env.VITE_SERVICE_PAGE_ENABLED,
  VITE_SERVICE_API: import.meta.env.VITE_SERVICE_API,
  VITE_SOLV_ENDPOINT: import.meta.env.VITE_SOLV_ENDPOINT,
  VITE_SOLV_QUOTE_ASSISTANT_KEY: import.meta.env.VITE_SOLV_QUOTE_ASSISTANT_KEY,
});

export const SERVICE_PAGE_ENABLED: boolean = SERVICE_PAGE.enabled;

/** For src/utils/appRoutes.ts and src/content/navigationLinks.ts, which Node scripts share. */
export const APP_ROUTE_OPTIONS = { servicePage: SERVICE_PAGE_ENABLED } as const;
