/**
 * Single registry for every content page: Markdown articles in
 * `./articles/*.md` plus the few React-only pages (privacy, terms, contact).
 * Routes, titles, and metadata for all of them resolve through this module.
 *
 * Articles come in two layers. The index (frontmatter, outline, code-block
 * flag) is parsed and validated at build time and imported eagerly; it is all
 * navigation, the Learn index and metadata need. A body is a separate chunk,
 * fetched when its guide renders, so adding guides does not grow the initial
 * JavaScript.
 */
import articleIndex from 'virtual:learn-article-index';
import pageMetadata from '../data/pageMetadata.json';
import {
  SITE_NAME,
  SITE_URL,
  buildTrackNavigation,
  getArticleCanonicalUrl,
  getArticleMetaDescription,
  getArticleMetaTitle,
  getTrackNeighbors,
} from './contentModel';
import type { LearnArticleEntry, LearnArticleSummary, TrackNavigation } from './contentModel';
import { splitFrontmatter } from './frontmatter';

export type {
  ContentLevel,
  ContentTrack,
  ContentTrackId,
  LearnArticle,
  LearnArticleEntry,
  LearnArticleSummary,
  LearnSourceLink,
  TrackNavigation,
  TrackNavigationItem,
} from './contentModel';
export {
  CONTENT_LEVEL_LABELS,
  CONTENT_TRACKS,
  buildTrackNavigation,
  getTrack,
  getTrackNeighbors,
} from './contentModel';

export interface LearnIndexMetadata {
  title: string;
  description: string;
  summary: string;
}

/** A page rendered by a dedicated React component instead of Markdown. */
export interface ComponentPage {
  slug: string;
  path: string;
  title: string;
  component: 'PrivacyPolicy' | 'TermsOfService' | 'Contact';
  metaTitle: string;
  metaDescription: string;
}

export type ContentPage =
  | { kind: 'article'; article: LearnArticleEntry }
  | { kind: 'page'; page: ComponentPage };

const componentPage = (
  slug: string,
  title: string,
  component: ComponentPage['component']
): ComponentPage => {
  const metadata = (pageMetadata.docs as Record<string, { title: string; description: string }>)[slug];
  if (!metadata) {
    throw new Error(`pageMetadata.json is missing the docs entry for ${slug}.`);
  }
  return {
    slug,
    path: `/docs/${slug}`,
    title,
    component,
    metaTitle: metadata.title,
    metaDescription: metadata.description,
  };
};

export const COMPONENT_PAGES: readonly ComponentPage[] = [
  componentPage('privacy-policy', 'Privacy Policy', 'PrivacyPolicy'),
  componentPage('terms-of-service', 'Terms of Service', 'TermsOfService'),
  componentPage('contact', 'Contact', 'Contact'),
];

export const LEARN_INDEX_METADATA: LearnIndexMetadata = pageMetadata.learn;
/** Every article without its body, in reading order (by track, then `order`). */
export const LEARN_ARTICLES: readonly LearnArticleEntry[] = articleIndex;
export const TRACK_NAVIGATION: readonly TrackNavigation[] = buildTrackNavigation(LEARN_ARTICLES);

const articleBodyFiles = import.meta.glob('./articles/*.md', {
  query: '?raw',
  import: 'default',
}) as Record<string, () => Promise<string>>;

const loadedBodies = new Map<string, string>();
const pendingBodies = new Map<string, Promise<string>>();

const fetchArticleBody = async (article: LearnArticleSummary): Promise<string> => {
  const file = articleBodyFiles[`./articles/${article.slug}.md`];
  if (!file) throw new Error(`No Markdown file for article ${article.slug}.`);
  // The matrix renderer and its data are only needed once a body is shown.
  const [raw, { expandCompatMatrixDirectives }] = await Promise.all([file(), import('./compatMatrix')]);
  // Same body createArticle builds at build time for the prerendered page and exports.
  const content = expandCompatMatrixDirectives(splitFrontmatter(raw).content, article.path);
  loadedBodies.set(article.slug, content);
  return content;
};

/** The article's Markdown body if it has already been loaded, for a render without a loading state. */
export const getLoadedLearnArticleBody = (slug: string): string | undefined => loadedBodies.get(slug);

/** Loads the article's Markdown body once; a failed load is retried on the next call. */
export const loadLearnArticleBody = (article: LearnArticleSummary): Promise<string> => {
  let pending = pendingBodies.get(article.slug);
  if (!pending) {
    pending = fetchArticleBody(article).catch(error => {
      pendingBodies.delete(article.slug);
      throw error;
    });
    pendingBodies.set(article.slug, pending);
  }
  return pending;
};

const articlesBySlug = new Map(LEARN_ARTICLES.map(article => [article.slug, article]));
const articlesByPath = new Map(LEARN_ARTICLES.map(article => [article.path, article]));
const pagesByPath = new Map(COMPONENT_PAGES.map(page => [page.path, page]));

export const getLearnArticle = (slug: string | null | undefined) =>
  slug ? articlesBySlug.get(slug) : undefined;

export const isLearnIndexPath = (pathname: string) =>
  pathname === '/learn' || pathname === '/learn/';

const normalizePath = (pathname: string): string | undefined => {
  const trimmed = pathname.length > 1 ? pathname.replace(/\/+$/, '') : pathname;
  try {
    return decodeURIComponent(trimmed);
  } catch {
    return undefined;
  }
};

/** Resolves any content page (Markdown article or React page) from a pathname. */
export const getContentPage = (pathname: string): ContentPage | undefined => {
  const normalized = normalizePath(pathname);
  if (!normalized) return undefined;
  const article = articlesByPath.get(normalized);
  if (article) return { kind: 'article', article };
  const page = pagesByPath.get(normalized);
  if (page) return { kind: 'page', page };
  return undefined;
};

export const isContentPath = (pathname: string) =>
  isLearnIndexPath(pathname) || pathname.startsWith('/learn/') || pathname.startsWith('/docs/');

export const getLearnArticleSlugFromPath = (pathname: string): string | undefined => {
  const match = pathname.match(/^\/learn\/([^/]+)\/?$/);
  if (!match) return undefined;

  try {
    return decodeURIComponent(match[1]);
  } catch {
    return undefined;
  }
};

/** Finds the article whose canonical path matches, for `/learn/*` and `/docs/*` alike. */
export const getLearnArticleFromPath = (pathname: string) => {
  const page = getContentPage(pathname);
  return page?.kind === 'article' ? page.article : undefined;
};

export const getRelatedLearnArticles = (article: LearnArticleSummary) =>
  article.relatedSlugs
    .map(getLearnArticle)
    .filter((related): related is LearnArticleEntry => Boolean(related));

export const getLearnArticleNeighbors = (article: LearnArticleSummary) =>
  getTrackNeighbors(article, LEARN_ARTICLES);

export const getLearnArticleMetadata = (article: LearnArticleSummary) => {
  const canonicalUrl = getArticleCanonicalUrl(article);
  return {
    title: getArticleMetaTitle(article),
    description: getArticleMetaDescription(article),
    canonicalUrl,
    type: 'article',
    structuredData: {
      '@context': 'https://schema.org',
      '@type': 'Article',
      headline: article.title,
      description: article.summary,
      mainEntityOfPage: canonicalUrl,
      url: canonicalUrl,
      dateModified: article.lastReviewed,
      articleSection: article.category,
      author: {
        '@type': 'Organization',
        name: SITE_NAME,
        url: SITE_URL,
      },
      publisher: {
        '@type': 'Organization',
        name: SITE_NAME,
        url: SITE_URL,
        logo: {
          '@type': 'ImageObject',
          url: `${SITE_URL}/logo.png`,
        },
      },
      citation: article.sourceLinks.map(({ url }) => url),
      isPartOf: {
        '@type': 'CollectionPage',
        name: LEARN_INDEX_METADATA.title,
        url: `${SITE_URL}/learn`,
      },
    },
  } as const;
};
