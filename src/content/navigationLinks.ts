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
  /** Match nested routes too (e.g. `/catalog` stays active on `/servers/:id`). */
  matchDescendants?: boolean;
}

export interface LearnTrackNavigation extends TrackNavigation {
  icon: string;
}

export interface FooterLink {
  label: string;
  href: string;
  /** Opens in a new tab; internal links use the router. */
  external?: boolean;
}

export const GITHUB_REPOSITORY_URL = 'https://github.com/integry/mcptest';

/** App destinations. The report route is kept; its label reads as a destination. */
export const PRIMARY_NAVIGATION: readonly NavigationLink[] = [
  { label: 'Playground', path: '/', icon: 'bi-terminal' },
  { label: 'Catalog', path: '/catalog', icon: 'bi-grid', matchDescendants: true },
  { label: 'Reports', path: '/report', icon: 'bi-clipboard2-data', matchDescendants: true },
  // The free breaking-change check (src/components/BreakingChangesView.tsx).
  { label: 'Breaking changes', path: '/tools/breaking-changes', icon: 'bi-signpost-split' },
];

/** Dashboards are rendered as a collapsible group rather than a flat link. */
export const DASHBOARDS_NAVIGATION: NavigationLink = {
  label: 'Dashboards',
  path: '/space',
  icon: 'bi-speedometer2',
  matchDescendants: true,
};

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
export const FOOTER_NAVIGATION: readonly FooterLink[] = [
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
