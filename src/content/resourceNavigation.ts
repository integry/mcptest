import type { TrackNavigation } from './contentModel';
import { TRACK_NAVIGATION } from './learnRegistry';

export interface ResourceNavigationItem {
  label: string;
  path: string;
  icon: string;
  matchDescendants?: boolean;
}

/**
 * High-level destinations shown in the sidebar on app views (playground,
 * catalog, report, dashboards). Generated from the track navigation: the
 * first "Understand" article, the guide hub, and the first "Reference" article.
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

export const RESOURCE_NAV_ITEMS: readonly ResourceNavigationItem[] =
  buildResourceNavigation(TRACK_NAVIGATION);
