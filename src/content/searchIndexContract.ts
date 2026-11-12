/**
 * The shape and location of the guide search index, shared by the build-time
 * builder (`searchIndex.ts`, which needs the Markdown parser) and the browser
 * loader (`components/learn/guideSearchIndex.ts`, which must not).
 */
import type { ContentLevel, ContentTrackId } from './contentModel.ts';

export const SEARCH_INDEX_PATH = '/learn/search-index.json';
export const SEARCH_INDEX_VERSION = 1;
export const SEARCH_EXCERPT_LENGTH = 200;
export const SEARCH_INDEX_MAX_BYTES = 300 * 1024;

export interface SearchIndexHeading {
  level: 2 | 3;
  text: string;
  /** The id the rendered heading carries; the result links to `${path}#${id}`. */
  id: string;
  /** Plain text of the section up to the next h2/h3, at most the excerpt length. */
  excerpt: string;
}

export interface SearchIndexArticle {
  slug: string;
  path: string;
  title: string;
  summary: string;
  track: ContentTrackId;
  level: ContentLevel;
  /** Plain text before the first h2/h3. */
  excerpt: string;
  headings: SearchIndexHeading[];
}

export interface SearchIndex {
  version: number;
  articles: SearchIndexArticle[];
}
