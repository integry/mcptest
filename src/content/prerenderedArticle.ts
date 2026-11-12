/**
 * The guide the build prerendered into this page (scripts/generate-seo-pages.js
 * renders MarkdownLearnArticle, src/prerender/contentPages.tsx). When the app
 * mounts over it, LearnArticlePage keeps this body and outline instead of
 * downloading the Markdown parser and rendering the article again (issue #405).
 */
import type { OutlineHeading } from './outline';

/** Marks a `.reading-prose` element ArticleMarkdown rendered, at build time or in the browser. */
export const ARTICLE_PROSE_PROPS = { className: 'reading-prose', 'data-prose': 'article-markdown' } as const;

export interface PrerenderedArticle {
  slug: string;
  /** Inner HTML of the `.reading-prose` element. */
  html: string;
  outline: OutlineHeading[];
}

let captured: PrerenderedArticle | null = null;

const readOutline = (article: Element): OutlineHeading[] => {
  const outline = article.parentElement?.querySelector(':scope > .reading-outline');
  return Array.from(outline?.querySelectorAll<HTMLAnchorElement>('li > a[href^="#"]') ?? [], link => ({
    level: link.parentElement!.classList.contains('reading-outline-sub') ? 3 : 2,
    text: link.textContent ?? '',
    id: link.getAttribute('href')!.slice(1),
  }));
};

/** Records the prerendered guide under `root`; call before React replaces it. */
export const capturePrerenderedArticle = (root: ParentNode): void => {
  const article = root.querySelector<HTMLElement>('article.reading-article[data-article-slug]');
  const prose = article?.querySelector<HTMLElement>(`.reading-prose[data-prose="${ARTICLE_PROSE_PROPS['data-prose']}"]`);
  captured = article && prose
    ? { slug: article.dataset.articleSlug!, html: prose.innerHTML, outline: readOutline(article) }
    : null;
};

/** The prerendered guide `slug`, or null when this page load did not include it. */
export const getPrerenderedArticle = (slug: string): PrerenderedArticle | null => (
  captured?.slug === slug ? captured : null
);

/** Test-only. */
export const resetPrerenderedArticleForTests = (): void => {
  captured = null;
};
