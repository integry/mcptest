/**
 * Sidebar navigation shared by SideNav and the static shell that
 * scripts/generate-seo-pages.js writes into dist/index.html, so the first
 * frame and the mounted app list the same links. The generator loads this
 * file with Node's built-in TypeScript support: keep runtime imports out of it.
 */
import type { TrackNavigation } from './contentModel';

export type SideNavView = 'playground' | 'dashboards' | 'docs' | 'learn' | 'report' | 'catalog' | 'server-profile';

export interface PrimaryNavItem {
  label: string;
  path: string;
  icon: string;
  /** Views in which the link is highlighted as the current section. */
  activeViews: readonly SideNavView[];
}

/** Top-level app destinations, listed first in the sidebar on every view. */
export const PRIMARY_NAV_ITEMS: readonly PrimaryNavItem[] = [
  { label: 'Playground', path: '/', icon: 'bi-search', activeViews: ['playground'] },
  { label: 'Server Catalog', path: '/catalog', icon: 'bi-grid', activeViews: ['catalog', 'server-profile'] },
  { label: 'Report', path: '/report', icon: 'bi-clipboard2-data', activeViews: ['report'] },
];

export interface ResourceNavigationItem {
  label: string;
  path: string;
  icon: string;
  matchDescendants?: boolean;
}

/**
 * High-level destinations shown in the sidebar on app views (playground,
 * catalog, report, dashboards). Generated from the learn tracks: the first
 * "Understand" article, the guide hub, and the first "Reference" article.
 */
export const buildResourceNavigation = (
  tracks: readonly TrackNavigation[]
): ResourceNavigationItem[] => {
  const firstOf = (id: TrackNavigation['id']) => tracks.find(track => track.id === id)?.items[0];
  const understand = firstOf('understand');
  const reference = firstOf('reference');
  const items: ResourceNavigationItem[] = [];
  if (understand) {
    items.push({ label: understand.navTitle, path: understand.path, icon: 'bi-info-circle' });
  }
  items.push({ label: 'Guides & Tutorials', path: '/learn', icon: 'bi-journals', matchDescendants: true });
  if (reference) {
    items.push({ label: reference.navTitle, path: reference.path, icon: 'bi-wrench' });
  }
  return items;
};
