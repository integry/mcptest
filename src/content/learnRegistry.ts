import learnData from '../data/learnArticles.json';
import { SITE_URL } from '../utils/catalogSeo';

export interface LearnSourceLink {
  title: string;
  url: string;
}

export interface LearnArticle {
  title: string;
  summary: string;
  slug: string;
  category: string;
  readingTimeMinutes: number;
  lastReviewed: string;
  relatedSlugs: string[];
  sourceLinks: LearnSourceLink[];
  content: string;
}

export interface LearnIndexMetadata {
  title: string;
  description: string;
  summary: string;
}

const SLUG_PATTERN = /^[a-z0-9]+(?:-[a-z0-9]+)*$/;
const REVIEW_DATE_PATTERN = /^\d{4}-\d{2}-\d{2}$/;

const validateArticles = (articles: LearnArticle[]) => {
  const slugs = new Set<string>();

  for (const article of articles) {
    if (!SLUG_PATTERN.test(article.slug)) {
      throw new Error(`Invalid Learn article slug: ${article.slug}`);
    }
    if (slugs.has(article.slug)) {
      throw new Error(`Duplicate Learn article slug: ${article.slug}`);
    }
    if (!article.title || !article.summary || !article.category || !article.content) {
      throw new Error(`Learn article ${article.slug} is missing required content metadata.`);
    }
    if (!Number.isInteger(article.readingTimeMinutes) || article.readingTimeMinutes < 1) {
      throw new Error(`Learn article ${article.slug} has an invalid reading time.`);
    }
    if (!REVIEW_DATE_PATTERN.test(article.lastReviewed)) {
      throw new Error(`Learn article ${article.slug} has an invalid last-reviewed date.`);
    }
    if (!article.sourceLinks.length) {
      throw new Error(`Learn article ${article.slug} must include source links.`);
    }
    slugs.add(article.slug);
  }

  for (const article of articles) {
    for (const relatedSlug of article.relatedSlugs) {
      if (!slugs.has(relatedSlug)) {
        throw new Error(`Learn article ${article.slug} references unknown article ${relatedSlug}.`);
      }
    }
  }
};

export const LEARN_INDEX_METADATA: LearnIndexMetadata = learnData.index;
export const LEARN_ARTICLES: readonly LearnArticle[] = learnData.articles;

validateArticles([...LEARN_ARTICLES]);

export const getLearnArticle = (slug: string | null | undefined) =>
  slug ? LEARN_ARTICLES.find(article => article.slug === slug) : undefined;

export const isLearnIndexPath = (pathname: string) =>
  pathname === '/learn' || pathname === '/learn/';

export const getLearnArticleSlugFromPath = (pathname: string): string | undefined => {
  const match = pathname.match(/^\/learn\/([^/]+)\/?$/);
  if (!match) return undefined;

  try {
    return decodeURIComponent(match[1]);
  } catch {
    return undefined;
  }
};

export const getLearnArticleFromPath = (pathname: string) =>
  getLearnArticle(getLearnArticleSlugFromPath(pathname));

export const getRelatedLearnArticles = (article: LearnArticle) =>
  article.relatedSlugs
    .map(getLearnArticle)
    .filter((related): related is LearnArticle => Boolean(related));

export const getLearnArticleMetadata = (article: LearnArticle) => {
  const canonicalUrl = `${SITE_URL}/learn/${article.slug}`;
  return {
    title: `${article.title} | mcptest.io`,
    description: article.summary,
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
        name: 'mcptest.io',
        url: SITE_URL,
      },
      publisher: {
        '@type': 'Organization',
        name: 'mcptest.io',
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
