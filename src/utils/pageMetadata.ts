import pageMetadata from '../data/pageMetadata.json';

export interface PageMetadata {
  title: string;
  description: string;
}

export const HOME_METADATA: PageMetadata = pageMetadata.home;

export const DOCS_METADATA: Readonly<Record<string, PageMetadata>> = pageMetadata.docs;

export const getDocsMetadata = (pathname: string): PageMetadata | undefined => {
  const match = pathname.match(/^\/docs\/([^/]+)\/?$/);
  if (!match) return undefined;

  try {
    return DOCS_METADATA[decodeURIComponent(match[1])];
  } catch {
    return undefined;
  }
};
