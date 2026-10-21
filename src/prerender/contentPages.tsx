/**
 * Build-time rendering of the Learn pages with the app's own components, for
 * scripts/generate-seo-pages.js (loaded through vite-node). The prerendered
 * page is then the markup React would render: the static first frame and the
 * mount on first input look the same, and LearnArticlePage can keep the
 * article body instead of rendering the Markdown again (issue #405).
 */
import React from 'react';
import { renderToStaticMarkup } from 'react-dom/server';
import { MemoryRouter } from 'react-router-dom';
import LearnIndex from '../components/learn/LearnIndex';
import MarkdownLearnArticle from '../components/learn/MarkdownLearnArticle';
import { loadHighlighter } from '../components/learn/highlighter';
import { getContentPage } from '../content/learnRegistry';

/** Loads highlight.js so code blocks render highlighted, as they do once the browser has it. */
export const prepareContentPrerender = async (): Promise<void> => {
  await loadHighlighter();
};

/**
 * React 19 writes the `dateTime` prop as `dateTime="…"`. Browsers read it
 * either way, but the site audit and crawlers read the HTML spelling
 * (`<time datetime>`, as the guides' "Last reviewed" date). Text and code
 * cannot match: React escapes their quotes.
 */
const lowercaseDateTime = (html: string): string => html.replace(/ dateTime="/g, ' datetime="');

const renderAt = (pathname: string, element: React.ReactElement): string => lowercaseDateTime(renderToStaticMarkup(
  <MemoryRouter initialEntries={[pathname]}>{element}</MemoryRouter>
));

/**
 * The Markdown article at `pathname` as LearnArticlePage renders it in the
 * browser (through MarkdownLearnArticle), or null when there is none.
 */
export const renderArticlePage = (pathname: string): string | null => {
  const page = getContentPage(pathname);
  if (page?.kind !== 'article') return null;
  return renderAt(pathname, <MarkdownLearnArticle article={page.article} />);
};

/** The Learn index as /learn renders it. */
export const renderLearnIndexPage = (): string => renderAt('/learn', <LearnIndex />);
