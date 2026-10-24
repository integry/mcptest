/**
 * The paths the single-page app renders a view for. Anything else is a 404:
 * App shows the NotFound view, and the build writes the same list to
 * dist/routes.txt (see scripts/generate-seo-pages.js) so the origin can
 * answer unknown paths with dist/404.html and a 404 status.
 *
 * Content paths (/learn/*, /docs/*, /servers/*, /catalog/<slug>) are
 * prerendered files; the app keeps its own "not found" views for unknown slugs
 * under those prefixes.
 */

/** The MCP discovery checker (src/components/DiscoveryCheckerView.tsx). */
export const DISCOVERY_CHECKER_PATH = '/tools/discovery';

/** Paths the app serves exactly (a trailing slash is not a variant). */
export const EXACT_APP_ROUTES: readonly string[] = [
  '/',
  '/catalog',
  '/learn',
  '/report',
  '/submit',
  DISCOVERY_CHECKER_PATH,
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
  // Content slugs: unknown ones get the app's own guide, server or category not-found view.
  if (/^\/servers\/[^/]+\/?$/.test(pathname)) return true;
  if (/^\/catalog\/[^/]+$/.test(pathname)) return true;
  return [...APP_ROUTE_PREFIXES, '/learn/', '/docs/'].some(
    prefix => pathname.startsWith(prefix) && pathname.length > prefix.length
  );
};

/**
 * The canonical path for another spelling of a page the host serves as a
 * file: `/index.html`, `/catalog.html`, `/learn/<slug>/index.html`,
 * `/servers/<id>/index.html`, or a trailing slash the canonical URL does not
 * have (`/catalog/`). Null when `pathname` is canonical, an app-only route, or
 * no page's spelling. main.tsx replaces the URL with it before the app mounts,
 * so a served alias shows its page instead of a 200 NotFound.
 */
export const canonicalAliasPath = (pathname: string): string | null => {
  if (APP_ROUTE_PREFIXES.some(prefix => pathname.startsWith(prefix))) return null;
  let target = pathname.replace(/\/index\.html$/, '/').replace(/\.html$/, '');
  // Server pages end in a slash (/servers/<id>/); every other page does not.
  if (/^\/servers\/[^/]+\/?$/.test(target)) target = target.replace(/\/?$/, '/');
  else if (target.length > 1) target = target.replace(/\/+$/, '');
  return target !== pathname && isKnownAppPath(target) ? target : null;
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
