import pageMetadata from '../data/pageMetadata.json';
import { getContentPage, getLearnArticleMetadata } from '../content/learnRegistry';

export interface PageMetadata {
  title: string;
  description: string;
}

export const HOME_METADATA: PageMetadata = pageMetadata.home;
export const CATALOG_METADATA: PageMetadata = pageMetadata.catalog;
export const DISCOVERY_METADATA: PageMetadata = pageMetadata.discovery;

/** Metadata for React-only documentation pages; article metadata lives in frontmatter. */
export const DOCS_METADATA: Readonly<Record<string, PageMetadata>> = pageMetadata.docs;

/** Title and description for any registered content page, Markdown or React. */
export const getContentPageMetadata = (pathname: string): PageMetadata | undefined => {
  const page = getContentPage(pathname);
  if (!page) return undefined;
  if (page.kind === 'article') {
    const { title, description } = getLearnArticleMetadata(page.article);
    return { title, description };
  }
  return { title: page.page.metaTitle, description: page.page.metaDescription };
};

export const getDocsMetadata = (pathname: string): PageMetadata | undefined =>
  /^\/docs\/[^/]+\/?$/.test(pathname) ? getContentPageMetadata(pathname) : undefined;
