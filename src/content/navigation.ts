/**
 * Single source for the sidebar's links. SideNav renders these groups, and
 * the static first-paint fallback can mirror the same data so both agree.
 *
 * Three groups: the workspace (app destinations), learn (the guide hub plus
 * the four tracks derived from the content registry) and a quiet footer.
 */
import type { ContentTrackId, TrackNavigation } from './contentModel';
import { TRACK_NAVIGATION } from './learnRegistry';

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

/** The four tracks (Understand, Use, Build, Reference) with their articles in reading order. */
export const LEARN_TRACKS: readonly LearnTrackNavigation[] = buildLearnTrackNavigation(TRACK_NAVIGATION);

/** Finds the track that owns a content page, so the sidebar can expand it. */
export const getLearnTrackForPath = (
  pathname: string,
  tracks: readonly LearnTrackNavigation[] = LEARN_TRACKS
): LearnTrackNavigation | undefined => {
  const normalized = pathname.length > 1 ? pathname.replace(/\/+$/, '') : pathname;
  return tracks.find(track => track.items.some(item => item.path === normalized));
};

/** Project links shown above the legal links in the sidebar footer. */
export const FOOTER_NAVIGATION: readonly FooterLink[] = [
  {
    label: 'Submit a server',
    href: `${GITHUB_REPOSITORY_URL}/blob/master/docs/catalog-submissions.md`,
    external: true,
  },
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
