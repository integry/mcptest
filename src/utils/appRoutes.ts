/**
 * The paths the single-page app renders a view for. Anything else is a 404:
 * App shows the NotFound view, and the build writes the same list to
 * dist/routes.txt (see scripts/generate-seo-pages.js) so the origin can
 * answer unknown paths with dist/404.html and a 404 status.
 *
 * Content paths (/learn/*, /docs/*, /servers/*) are prerendered files; the app
 * keeps its own "not found" views for unknown slugs under those prefixes.
 */

/** Paths the app serves exactly (a trailing slash is not a variant). */
export const EXACT_APP_ROUTES: readonly string[] = [
  '/',
  '/catalog',
  '/learn',
  '/report',
  '/submit',
  '/oauth/callback',
  '/install-integration',
];

/** Dynamic app routes: every path under these prefixes is an app view. */
export const APP_ROUTE_PREFIXES: readonly string[] = [
  '/server/', // playground connection links: /server/<endpoint>[/mcp|/sse]
  '/call/', // shared tool and resource results
  '/space/', // dashboards
  '/report/',
];

/** Whether the app has a view for `pathname`; false means the NotFound page. */
export const isKnownAppPath = (pathname: string): boolean => {
  if (EXACT_APP_ROUTES.includes(pathname)) return true;
  if (pathname === '/learn/') return true;
  // Content slugs: unknown ones get the app's own guide or server not-found view.
  if (/^\/servers\/[^/]+\/?$/.test(pathname)) return true;
  return [...APP_ROUTE_PREFIXES, '/learn/', '/docs/'].some(
    prefix => pathname.startsWith(prefix) && pathname.length > prefix.length
  );
};

/** Where a reader who followed a dead link most likely wanted to go (NotFound and dist/404.html). */
export const NOT_FOUND_LINKS = [
  { path: '/', label: 'Open the playground', description: 'Connect to a remote MCP server and inspect it.' },
  { path: '/catalog', label: 'Browse the server catalog', description: 'Tested remote MCP servers with setup notes.' },
  { path: '/learn', label: 'Read the guides', description: 'Connecting clients, OAuth, transports and debugging.' },
] as const;

export const NOT_FOUND_TITLE = 'Page not found';
export const NOT_FOUND_SUMMARY =
  'Nothing lives at this address. It may have moved, or the link that brought you here may be mistyped.';
