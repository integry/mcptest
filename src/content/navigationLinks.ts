/**
 * The sidebar's links, with no runtime imports: SideNav renders them through
 * ./navigation, and scripts/generate-seo-pages.js loads this file with Node's
 * built-in TypeScript support to draw the same sidebar in the static first frame.
 */
import type { ContentTrackId, TrackNavigation } from './contentModel';

export interface NavigationLink {
  label: string;
  path: string;
  /** Bootstrap Icons class, e.g. `bi-grid`. */
  icon: string;
  /** One line on what the entry is for: the link's tooltip and accessible description. */
  description?: string;
  /** Match nested routes too (e.g. `/catalog` stays active on `/servers/:id`). */
  matchDescendants?: boolean;
}

export type NavigationGroupId = 'start' | 'checks' | 'saved';

/**
 * One block of the sidebar, ordered by what people come to do: test a server
 * and browse servers first, then the checks, then their saved work.
 */
export interface NavigationGroup {
  id: NavigationGroupId;
  label: string;
  /** The heading names the group for screen readers only. */
  labelHidden?: boolean;
  items: readonly NavigationLink[];
}

export interface LearnTrackNavigation extends TrackNavigation {
  icon: string;
}

export interface FooterLink {
  /** Use a full document load for standalone static pages. */
  reloadDocument?: boolean;
  label: string;
  href: string;
  /** Opens in a new tab; internal links use the router. */
  external?: boolean;
}

export const GITHUB_REPOSITORY_URL = 'https://github.com/integry/mcptest';

/** The primary action: test a server in the browser. */
export const PLAYGROUND_NAVIGATION: NavigationLink = {
  label: 'Playground',
  path: '/',
  icon: 'bi-terminal',
  description: 'Connect to a remote MCP server and call its tools in the browser.',
};

export const CATALOG_NAVIGATION: NavigationLink = {
  label: 'Catalog',
  path: '/catalog',
  icon: 'bi-grid',
  description: 'Browse tested public remote MCP servers with setup notes.',
  matchDescendants: true,
};

/** The free single-purpose checks under /tools. */
export const CHECKS_NAVIGATION: readonly NavigationLink[] = [
  // The free breaking-change check (src/components/BreakingChangesView.tsx).
  {
    label: 'Breaking changes',
    path: '/tools/breaking-changes',
    icon: 'bi-signpost-split',
    description: 'Compare two tools/list results and see which changes break clients.',
  },
  {
    label: 'OAuth checker',
    path: '/tools/oauth-check',
    icon: 'bi-shield-check',
    description: "Test a server's OAuth authorization step by step, with fixes.",
  },
  {
    label: 'Discovery checker',
    path: '/tools/discovery',
    icon: 'bi-broadcast',
    description: 'Find the MCP servers a domain advertises and validate them.',
  },
];

/** The report route is kept; its label reads as a destination. */
export const REPORTS_NAVIGATION: NavigationLink = {
  label: 'Reports',
  path: '/report',
  icon: 'bi-clipboard2-data',
  description: 'Run a release-readiness report and revisit servers you tested.',
  matchDescendants: true,
};

/**
 * Dashboards: a single link to the dashboards page until the visitor has one,
 * then a collapsible group listing them.
 */
export const DASHBOARDS_NAVIGATION: NavigationLink = {
  label: 'Dashboards',
  path: '/space',
  icon: 'bi-speedometer2',
  description: 'Saved tool calls you can re-run and health-check together.',
  matchDescendants: true,
};

export const NAVIGATION_GROUPS: readonly NavigationGroup[] = [
  { id: 'start', label: 'Workspace', items: [PLAYGROUND_NAVIGATION, CATALOG_NAVIGATION] },
  { id: 'checks', label: 'Checks', items: CHECKS_NAVIGATION },
  { id: 'saved', label: 'Saved work', items: [REPORTS_NAVIGATION, DASHBOARDS_NAVIGATION] },
];

/**
 * Which app views light up each entry; the catalog owns server profiles too.
 * scripts/generate-seo-pages.js uses the same map for the static sidebar.
 */
export const NAVIGATION_ACTIVE_VIEWS: Readonly<Record<string, readonly string[]>> = {
  '/': ['playground'],
  '/catalog': ['catalog', 'server-profile'],
  '/tools/breaking-changes': ['breaking-changes'],
  '/tools/oauth-check': ['oauth-check'],
  '/tools/discovery': ['discovery'],
  '/report': ['report'],
  '/space': ['dashboards'],
};

export const isNavigationItemActive = (item: NavigationLink, view: string): boolean =>
  (NAVIGATION_ACTIVE_VIEWS[item.path] ?? []).includes(view);

/** Every app destination in sidebar order, dashboards included. */
export const PRIMARY_NAVIGATION: readonly NavigationLink[] = NAVIGATION_GROUPS.flatMap(group => group.items);

/** The entry's tooltip; the icon rail also needs the label in it. */
export const navigationTooltip = (item: NavigationLink, collapsed: boolean): string | undefined => {
  if (!item.description) return collapsed ? item.label : undefined;
  return collapsed ? `${item.label}: ${item.description}` : item.description;
};

/** Views on which the Learn group starts open: guides and docs (and the not-found page, shown as docs). */
export const LEARN_OPEN_VIEWS: readonly string[] = ['learn', 'docs'];

export const isLearnOpenByDefault = (view: string): boolean => LEARN_OPEN_VIEWS.includes(view);

/** Id of the visually hidden description of a sidebar entry (aria-describedby). */
export const navigationDescriptionId = (item: NavigationLink, idSuffix: string): string =>
  `sidenav-desc-${item.path.replace(/[^a-z0-9]+/gi, '-').replace(/^-|-$/g, '') || 'home'}-${idSuffix}`;

export const LEARN_HUB_NAVIGATION: NavigationLink = {
  label: 'Guides',
  path: '/learn',
  icon: 'bi-journals',
};

const TRACK_ICONS: Record<ContentTrackId, string> = {
  understand: 'bi-lightbulb',
  use: 'bi-plug',
  build: 'bi-tools',
  reference: 'bi-book',
};

export const buildLearnTrackNavigation = (
  tracks: readonly TrackNavigation[]
): LearnTrackNavigation[] =>
  tracks.map(track => ({ ...track, icon: TRACK_ICONS[track.id] ?? 'bi-journal-text' }));

/** Project links shown above the legal links in the sidebar footer. */
export const CI_NAVIGATION: FooterLink = { label: 'CI release gate', href: '/ci', reloadDocument: true };

/**
 * The keyword landing pages (src/content/keywordLandingPages.ts); paths as
 * in src/utils/appRoutes.ts, spelled out so this file stays import-free.
 */
export const LANDING_PAGE_NAVIGATION: readonly FooterLink[] = [
  { label: 'Test an MCP server', href: '/mcp-test-server' },
  { label: 'MCP Inspector online', href: '/mcp-inspector-online' },
  { label: 'MCP playground', href: '/mcp-playground' },
];

export const FOOTER_NAVIGATION: readonly FooterLink[] = [
  ...LANDING_PAGE_NAVIGATION,
  CI_NAVIGATION,
  { label: 'Submit a server', href: '/submit' },
  {
    label: 'Badges',
    href: `${GITHUB_REPOSITORY_URL}#embedding-a-badge`,
    external: true,
  },
  {
    label: 'GitHub repository',
    href: GITHUB_REPOSITORY_URL,
    external: true,
  },
];

export const LEGAL_NAVIGATION: readonly FooterLink[] = [
  { label: 'Contact', href: '/docs/contact' },
  { label: 'Privacy', href: '/docs/privacy-policy' },
  { label: 'Terms', href: '/docs/terms-of-service' },
];

/**
 * Header copy, shared with the static shell. What signing in adds is what the
 * code does with a signed-in user: useDataSync stores dashboards and
 * connection tabs for the account, and the CORS proxy gives signed-in callers
 * a per-account allowance instead of the anonymous per-IP rate limit
 * (cors-proxy-worker). Connecting and testing need no account.
 */
export const HEADER_COPY = {
  descriptor: 'Remote MCP Inspector',
  signIn: 'Login with Google',
  signInHint: 'Optional: sync and higher proxy limits',
  signInDescription:
    'Optional. Testing works without an account. Signing in keeps your dashboards and connection tabs with your account across devices and raises the CORS proxy rate limit.',
} as const;

export const SIGN_IN_HINT_ID = 'app-auth-hint';
