import React from 'react';
import { renderToStaticMarkup } from 'react-dom/server';
import { MemoryRouter } from 'react-router-dom';
import { describe, expect, it } from 'vitest';
import {
  LEARN_ARTICLES,
  getLearnArticle,
  getLearnArticleFromPath,
  getLearnArticleMetadata,
} from '../../content/learnRegistry';
import { DOCUMENTATION_NAV_ITEMS, getDocumentationPage } from '../../content/docsRegistry';
import { getDocsMetadata } from '../../utils/pageMetadata';
import LearnArticlePage from './LearnArticlePage';
import LearnIndex from './LearnIndex';
import LearnNotFound from './LearnNotFound';

const render = (node: React.ReactNode) => {
  const container = document.createElement('div');
  container.innerHTML = renderToStaticMarkup(
    <MemoryRouter>{node}</MemoryRouter>
  );
  return container;
};

describe('Learn article registry', () => {
  it('looks up all six stable article routes and rejects unknown slugs', () => {
    expect(LEARN_ARTICLES).toHaveLength(6);
    for (const article of LEARN_ARTICLES) {
      expect(getLearnArticle(article.slug)).toBe(article);
      expect(getLearnArticleFromPath(`/learn/${article.slug}`)).toBe(article);
      expect(article.sourceLinks.length).toBeGreaterThan(0);
      expect(article.relatedSlugs.length).toBeGreaterThan(0);
    }
    expect(getLearnArticleFromPath('/learn/not-a-guide')).toBeUndefined();
    expect(getLearnArticleFromPath('/learn/mcp-clients-compared/extra')).toBeUndefined();
  });

  it('renders the Learn index with summaries, categories, dates, and related links', () => {
    const container = render(<LearnIndex />);

    expect(container.querySelector('h1')?.textContent).toBe('Learn MCP');
    expect(container.querySelectorAll('.learn-card')).toHaveLength(6);
    for (const article of LEARN_ARTICLES) {
      const link = container.querySelector(`a[href="/learn/${article.slug}"]`);
      expect(link?.textContent).toBe(article.title);
      expect(container.textContent).toContain(article.summary);
      expect(container.textContent).toContain(article.category);
      expect(container.querySelector(`time[datetime="${article.lastReviewed}"]`)).not.toBeNull();
    }
    expect(container.querySelectorAll('.learn-card-related')).toHaveLength(6);
  });

  it('renders Markdown content, reviewed date, sources, and accessible external links', () => {
    const article = getLearnArticle('oauth-for-mcp-explained')!;
    const container = render(<LearnArticlePage article={article} />);

    expect(container.querySelector('h1')?.textContent).toBe(article.title);
    expect(container.querySelector('.learn-markdown h2')?.textContent).toBe('The actors');
    expect(container.querySelector('.learn-markdown table')).not.toBeNull();
    expect(container.querySelector(`time[datetime="${article.lastReviewed}"]`)).not.toBeNull();
    const sourceLinks = container.querySelectorAll('.learn-article-footer a[target="_blank"]');
    expect(sourceLinks).toHaveLength(article.sourceLinks.length);
    sourceLinks.forEach(link => {
      expect(link.getAttribute('rel')).toBe('noopener noreferrer');
      expect(link.textContent).toContain('opens in a new tab');
    });
  });

  it('renders a useful unknown-slug state', () => {
    const container = render(<LearnNotFound />);
    expect(container.querySelector('h1')?.textContent).toBe('Guide not found');
    expect(container.querySelector('a[href="/learn"]')?.textContent).toContain('Browse all');
  });

  it('creates canonical social and Article structured metadata', () => {
    const article = getLearnArticle('designing-production-mcp-server')!;
    const metadata = getLearnArticleMetadata(article);

    expect(metadata.title).toBe(`${article.title} | mcptest.io`);
    expect(metadata.description).toBe(article.summary);
    expect(metadata.canonicalUrl).toBe(`https://mcptest.io/learn/${article.slug}`);
    expect(metadata.type).toBe('article');
    expect(metadata.structuredData).toMatchObject({
      '@type': 'Article',
      headline: article.title,
      dateModified: article.lastReviewed,
      articleSection: article.category,
    });
    expect(metadata.structuredData.citation).toEqual(article.sourceLinks.map(source => source.url));
  });
});

describe('preserved documentation registry', () => {
  it('keeps the four public documentation routes and metadata', () => {
    const expected = ['what-is-mcp', 'remote-vs-local', 'testing-guide', 'troubleshooting'];
    expect(DOCUMENTATION_NAV_ITEMS.map(page => page.slug)).toEqual(expected);
    for (const slug of expected) {
      expect(getDocumentationPage(slug)?.component).toBeTypeOf('function');
      expect(getDocsMetadata(`/docs/${slug}`)).toBeDefined();
    }
  });
});
