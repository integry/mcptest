import { TRACK_NAVIGATION } from './learnRegistry';
import { buildResourceNavigation } from './navigation';

export { buildResourceNavigation } from './navigation';
export type { ResourceNavigationItem } from './navigation';

/** Resource links for the app's learn tracks; the builder lives in ./navigation. */
export const RESOURCE_NAV_ITEMS = buildResourceNavigation(TRACK_NAVIGATION);
