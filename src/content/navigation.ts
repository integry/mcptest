/**
 * Single source for the sidebar's links. SideNav renders these groups, and
 * the static first-paint fallback mirrors the same data (from
 * ./navigationLinks, which has no runtime imports) so both agree.
 *
 * Three groups: the workspace (app destinations), learn (the guide hub plus
 * the four tracks derived from the content registry) and a quiet footer.
 */
import { TRACK_NAVIGATION } from './learnRegistry';
import { buildLearnTrackNavigation } from './navigationLinks';
import type { LearnTrackNavigation } from './navigationLinks';

export * from './navigationLinks';

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
