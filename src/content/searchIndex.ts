/**
 * The guide search index: one entry per article with its h2/h3 sections and a
 * short plain-text excerpt of each. Built from the same parsed Markdown and
 * heading-id allocator as the reading outline, so every result links to an id
 * the rendered heading carries. The build writes it to
 * `dist/learn/search-index.json`; the dev server serves the same JSON.
 */

import { splitAtComponentMarker } from './contentModel.ts';
import type { ContentLevel, ContentTrackId, LearnArticle } from './contentModel.ts';
import {
  assignHeadingIds,
  createHeadingIdAllocator,
  parseMarkdown,
  type MarkdownNode,
} from './outline.ts';

export {
  SEARCH_EXCERPT_LENGTH,
  SEARCH_INDEX_MAX_BYTES,
  SEARCH_INDEX_PATH,
  SEARCH_INDEX_VERSION,
} from './searchIndexContract.ts';
export type { SearchIndex, SearchIndexArticle, SearchIndexHeading } from './searchIndexContract.ts';
import {
  SEARCH_EXCERPT_LENGTH,
  SEARCH_INDEX_MAX_BYTES,
  SEARCH_INDEX_VERSION,
} from './searchIndexContract.ts';
import type { SearchIndex, SearchIndexArticle, SearchIndexHeading } from './searchIndexContract.ts';


/** Block-level nodes whose text is separated from the next block by a space. */
const SKIPPED_NODES = new Set(['code', 'html', 'definition', 'footnoteDefinition', 'yaml']);

/** Plain text of a node with Markdown syntax dropped: links keep labels, images their alt text. */
const nodeText = (node: MarkdownNode): string => {
  if (SKIPPED_NODES.has(node.type)) return '';
  if (node.type === 'image') return node.alt ?? '';
  if (node.type === 'break' || node.type === 'thematicBreak') return ' ';
  if (typeof node.value === 'string') return node.value;
  const children = node.children ?? [];
  const inline = node.type === 'paragraph' || node.type === 'heading' || node.type === 'tableCell'
    || node.type === 'emphasis' || node.type === 'strong' || node.type === 'delete'
    || node.type === 'link' || node.type === 'linkReference';
  return children.map(nodeText).join(inline ? '' : ' ');
};

const collapseWhitespace = (text: string) => text.replace(/\s+/g, ' ').trim();

/** The first `maxLength` characters, cut back to a word boundary when that loses little. */
export const truncateExcerpt = (text: string, maxLength = SEARCH_EXCERPT_LENGTH): string => {
  if (text.length <= maxLength) return text;
  if (maxLength <= 1) return '';
  const cut = text.slice(0, maxLength - 1);
  const space = cut.lastIndexOf(' ');
  return `${(space > maxLength * 0.6 ? cut.slice(0, space) : cut).trimEnd()}…`;
};

interface SectionDraft {
  heading?: Omit<SearchIndexHeading, 'excerpt'>;
  parts: string[];
}

/**
 * Splits an article body into the text before its first h2/h3 and one section
 * per h2/h3, in document order, with untruncated plain text. Headings are
 * parsed per component-marker segment with ids allocated across the whole
 * body, exactly like the outline.
 */
export const extractSearchSections = (markdown: string) => {
  const allocate = createHeadingIdAllocator();
  const sections: SectionDraft[] = [{ parts: [] }];
  for (const segment of splitAtComponentMarker(markdown)) {
    if (!segment.markdown) continue;
    const tree = parseMarkdown(segment.markdown);
    assignHeadingIds(tree, allocate);
    for (const node of tree.children ?? []) {
      const id = node.data?.hProperties?.id;
      if (node.type === 'heading' && (node.depth === 2 || node.depth === 3) && typeof id === 'string') {
        sections.push({ heading: { level: node.depth, text: collapseWhitespace(nodeText(node)), id }, parts: [] });
      } else {
        sections[sections.length - 1].parts.push(nodeText(node));
      }
    }
  }
  const textOf = (section: SectionDraft) => collapseWhitespace(section.parts.join(' '));
  const [intro, ...rest] = sections;
  return {
    excerpt: textOf(intro),
    headings: rest.map(section => ({ ...section.heading!, excerpt: textOf(section) })),
  };
};

const withExcerptLength = (article: SearchIndexArticle, length: number): SearchIndexArticle => ({
  ...article,
  excerpt: truncateExcerpt(article.excerpt, length),
  headings: article.headings.map(heading => ({ ...heading, excerpt: truncateExcerpt(heading.excerpt, length) })),
});

const fullSearchIndexArticle = (article: LearnArticle): SearchIndexArticle => ({
  slug: article.slug,
  path: article.path,
  title: article.title,
  summary: article.summary,
  track: article.track,
  level: article.level,
  ...extractSearchSections(article.content),
});

export const buildSearchIndexArticle = (article: LearnArticle, excerptLength = SEARCH_EXCERPT_LENGTH) =>
  withExcerptLength(fullSearchIndexArticle(article), excerptLength);

export const serializeSearchIndex = (index: SearchIndex) => JSON.stringify(index);

const byteLength = (text: string) => new TextEncoder().encode(text).length;

/**
 * Builds the index and keeps its JSON under `maxBytes` by shortening every
 * excerpt in steps; titles, summaries and headings are never dropped.
 */
export const buildSearchIndex = (
  articles: readonly LearnArticle[],
  { maxBytes = SEARCH_INDEX_MAX_BYTES, excerptLength = SEARCH_EXCERPT_LENGTH } = {}
): SearchIndex => {
  const full = articles.map(fullSearchIndexArticle);
  for (let length = excerptLength; ; length = length < 20 ? 0 : Math.floor(length * 0.75)) {
    const index = { version: SEARCH_INDEX_VERSION, articles: full.map(article => withExcerptLength(article, length)) };
    if (byteLength(serializeSearchIndex(index)) <= maxBytes) return index;
    if (length === 0) {
      throw new Error(`The guide search index exceeds ${maxBytes} bytes even without excerpts.`);
    }
  }
};
