/**
 * Ranking for the guide search. Titles and headings are identifiers (fuzzy:
 * substring or subsequence); summaries and excerpts are prose (substring
 * only). Every article yields at most one result: the article itself or its
 * best-matching section, which the result links to.
 */

import { CONTENT_TRACKS } from './contentModel.ts';
import type { ContentTrackId } from './contentModel.ts';
import type { SearchIndex, SearchIndexArticle, SearchIndexHeading } from './searchIndex.ts';
import {
  matchField,
  prepareFields,
  tokenizeQuery,
  type FieldMatch,
  type MatchRange,
  type PreparedField,
} from '../utils/fuzzyMatch.ts';

export const GUIDE_SEARCH_RESULT_LIMIT = 12;
/**
 * A subsequence match must fit in this many times the token length; letters
 * scattered across a whole title ("cors" in "Connect over remote streams")
 * are noise in a corpus of long titles.
 */
const SUBSEQUENCE_SPAN_FACTOR = 3;
const SNIPPET_LEAD = 32;
const WEIGHTS = {
  title: 4,
  summary: 1,
  articleExcerpt: 0.75,
  heading: 1.75,
  sectionTitle: 1.5,
  sectionExcerpt: 1,
} as const;

interface SearchEntry {
  article: SearchIndexArticle;
  articleIndex: number;
  heading?: SearchIndexHeading;
  fields: PreparedField[];
}

export interface PreparedGuideSearch {
  entries: SearchEntry[];
}

export interface GuideSearchSnippet {
  text: string;
  ranges: MatchRange[];
}

export interface GuideSearchResult {
  /** Unique within one result list; also the basis of the option element id. */
  key: string;
  article: SearchIndexArticle;
  heading?: SearchIndexHeading;
  href: string;
  score: number;
  titleRanges: MatchRange[];
  headingRanges: MatchRange[];
  snippet: GuideSearchSnippet;
}

export interface GuideSearchGroup {
  track: ContentTrackId;
  label: string;
  results: GuideSearchResult[];
}

/** Prepares lowercase fields once per index so each keystroke only scans. */
export const prepareGuideSearch = (index: SearchIndex): PreparedGuideSearch => {
  const entries: SearchEntry[] = [];
  index.articles.forEach((article, articleIndex) => {
    const fields = prepareFields([
      { key: 'title', text: article.title, kind: 'identifier', weight: WEIGHTS.title },
      { key: 'summary', text: article.summary, kind: 'prose', weight: WEIGHTS.summary },
      { key: 'excerpt', text: article.excerpt, kind: 'prose', weight: WEIGHTS.articleExcerpt },
    ]);
    entries.push({ article, articleIndex, fields });
    // In a section, the article title still counts, but less than the heading.
    const sectionTitle = fields.filter(field => field.key === 'title').map(field => ({ ...field, weight: WEIGHTS.sectionTitle }));
    for (const heading of article.headings) {
      entries.push({
        article,
        articleIndex,
        heading,
        fields: prepareFields([
          { key: 'heading', text: heading.text, kind: 'identifier', weight: WEIGHTS.heading },
          { key: 'excerpt', text: heading.excerpt, kind: 'prose', weight: WEIGHTS.sectionExcerpt },
        ]).concat(sectionTitle),
      });
    }
  });
  return { entries };
};

/** `matchField` without scattered subsequences; a substring is always one range. */
const compactMatch = (field: PreparedField, token: string): FieldMatch | null => {
  const match = matchField(field, token);
  if (!match || match.ranges.length === 1) return match;
  const span = match.ranges[match.ranges.length - 1][1] - match.ranges[0][0];
  return span <= token.length * SUBSEQUENCE_SPAN_FACTOR ? match : null;
};

/** Like `fuzzyMatchFields`: every token must match a field; the best field scores it. */
const scoreEntry = (fields: readonly PreparedField[], tokens: readonly string[]) => {
  const ranges: Record<string, MatchRange[]> = {};
  let score = 0;
  for (const token of tokens) {
    let best = 0;
    let matched = false;
    for (const field of fields) {
      const match = compactMatch(field, token);
      if (!match) continue;
      matched = true;
      ranges[field.key] = [...(ranges[field.key] ?? []), ...match.ranges];
      best = Math.max(best, match.score * field.weight);
    }
    if (!matched) return null;
    score += best;
  }
  for (const key of Object.keys(ranges)) ranges[key].sort((left, right) => left[0] - right[0]);
  return { score, ranges };
};

/** A window of `text` that starts shortly before the first match, with shifted ranges. */
export const snippetAround = (text: string, ranges: readonly MatchRange[] = []): GuideSearchSnippet => {
  const first = ranges[0]?.[0] ?? 0;
  if (first <= SNIPPET_LEAD) return { text, ranges: [...ranges] };
  const space = text.lastIndexOf(' ', first - SNIPPET_LEAD);
  const start = space >= 0 && first - space < SNIPPET_LEAD * 2 ? space + 1 : first - SNIPPET_LEAD;
  const prefix = '…';
  const shift = prefix.length - start;
  return {
    text: prefix + text.slice(start),
    ranges: ranges.map(([from, to]) => [from + shift, to + shift] as const),
  };
};

const snippetFor = (entry: SearchEntry, ranges: Record<string, MatchRange[]>): GuideSearchSnippet => {
  const excerpt = entry.heading ? entry.heading.excerpt : entry.article.excerpt;
  if (ranges.excerpt?.length) return snippetAround(excerpt, ranges.excerpt);
  if (!entry.heading) return { text: entry.article.summary, ranges: ranges.summary ?? [] };
  return { text: excerpt, ranges: [] };
};

const trackLabel = (track: ContentTrackId) =>
  CONTENT_TRACKS.find(candidate => candidate.id === track)?.label ?? track;

/**
 * Ranks the index for `query` and groups the best results by track. Groups
 * are ordered by their best result, results within a group by score, so the
 * first option is always the strongest match.
 */
export const searchGuides = (
  prepared: PreparedGuideSearch,
  query: string,
  { limit = GUIDE_SEARCH_RESULT_LIMIT } = {}
): GuideSearchGroup[] => {
  const tokens = tokenizeQuery(query);
  if (tokens.length === 0) return [];

  const bestByArticle = new Map<number, { entry: SearchEntry; score: number; ranges: Record<string, MatchRange[]> }>();
  for (const entry of prepared.entries) {
    const match = scoreEntry(entry.fields, tokens);
    if (!match) continue;
    const current = bestByArticle.get(entry.articleIndex);
    if (!current || match.score > current.score) {
      bestByArticle.set(entry.articleIndex, { entry, score: match.score, ranges: match.ranges });
    }
  }

  const ranked = [...bestByArticle.values()]
    .sort((left, right) => right.score - left.score || left.entry.articleIndex - right.entry.articleIndex);

  const groups = new Map<ContentTrackId, GuideSearchGroup>();
  for (const { entry, score, ranges } of ranked.slice(0, limit)) {
    const { article, heading } = entry;
    const track = article.track;
    if (!groups.has(track)) groups.set(track, { track, label: trackLabel(track), results: [] });
    groups.get(track)!.results.push({
      key: heading ? `${article.slug}--${heading.id}` : article.slug,
      article,
      heading,
      href: heading ? `${article.path}#${heading.id}` : article.path,
      score,
      titleRanges: ranges.title ?? [],
      headingRanges: ranges.heading ?? [],
      snippet: snippetFor(entry, ranges),
    });
  }
  return [...groups.values()];
};
