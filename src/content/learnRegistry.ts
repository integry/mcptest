/**
 * Single registry for every content page: Markdown articles loaded from
 * `./articles/*.md` plus the few React-only pages (privacy, terms, contact).
 * Routes, titles, and metadata for all of them resolve through this module.
 */
import pageMetadata from '../data/pageMetadata.json';
import {
  CONTENT_COMPONENT_NAMES,
  SITE_NAME,
  SITE_URL,
  buildTrackNavigation,
  createArticle,
  getArticleCanonicalUrl,
  getArticleMetaDescription,
  getArticleMetaTitle,
  getTrackNeighbors,
  sortArticlesForReading,
  validateArticles,
} from './contentModel';
import type { LearnArticle, TrackNavigation } from './contentModel';
import { parseFrontmatter } from './frontmatter';

export type {
  ContentLevel,
  ContentTrack,
  ContentTrackId,
  LearnArticle,
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
  | { kind: 'article'; article: LearnArticle }
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

const rawArticles = import.meta.glob('./articles/*.md', {
  query: '?raw',
  import: 'default',
  eager: true,
}) as Record<string, string>;

const loadedArticles = Object.entries(rawArticles)
  .sort(([left], [right]) => left.localeCompare(right))
  .map(([fileName, raw]) => {
    const { data, content } = parseFrontmatter(raw);
    return createArticle(data, content, fileName);
  });

validateArticles(loadedArticles, {
  knownComponents: CONTENT_COMPONENT_NAMES,
  reservedPaths: COMPONENT_PAGES.map(page => page.path),
});

export const LEARN_INDEX_METADATA: LearnIndexMetadata = pageMetadata.learn;
export const LEARN_ARTICLES: readonly LearnArticle[] = sortArticlesForReading(loadedArticles);
export const TRACK_NAVIGATION: readonly TrackNavigation[] = buildTrackNavigation(LEARN_ARTICLES);

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

export const getRelatedLearnArticles = (article: LearnArticle) =>
  article.relatedSlugs
    .map(getLearnArticle)
    .filter((related): related is LearnArticle => Boolean(related));

export const getLearnArticleNeighbors = (article: LearnArticle) =>
  getTrackNeighbors(article, LEARN_ARTICLES);

export const getLearnArticleMetadata = (article: LearnArticle) => {
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
