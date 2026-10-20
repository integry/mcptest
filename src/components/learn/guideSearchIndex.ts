/**
 * Lazily fetches the build-time guide search index (`/learn/search-index.json`)
 * the first time a search field is used, and prepares it once per session.
 */
import { prepareGuideSearch, type PreparedGuideSearch } from '../../content/guideSearch';
import { SEARCH_INDEX_PATH, SEARCH_INDEX_VERSION, type SearchIndex } from '../../content/searchIndexContract';

export type GuideSearchLoader = () => Promise<PreparedGuideSearch>;

let pending: Promise<PreparedGuideSearch> | undefined;

const isSearchIndex = (value: unknown): value is SearchIndex => {
  const index = value as Partial<SearchIndex> | null;
  return Boolean(index) && index!.version === SEARCH_INDEX_VERSION && Array.isArray(index!.articles);
};

const fetchGuideSearch = async (): Promise<PreparedGuideSearch> => {
  const response = await fetch(SEARCH_INDEX_PATH, { headers: { Accept: 'application/json' } });
  if (!response.ok) throw new Error(`The guide search index returned HTTP ${response.status}.`);
  const index: unknown = await response.json();
  if (!isSearchIndex(index)) throw new Error('The guide search index has an unexpected shape.');
  return prepareGuideSearch(index);
};

/** Shared by every search field; a failed load is retried on the next use. */
export const loadGuideSearch: GuideSearchLoader = () => {
  pending ??= fetchGuideSearch().catch(error => {
    pending = undefined;
    throw error;
  });
  return pending;
};
