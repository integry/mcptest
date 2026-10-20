import React from 'react';
import { renderToStaticMarkup } from 'react-dom/server';
import { MemoryRouter } from 'react-router-dom';
import { describe, expect, it } from 'vitest';
import { CONTENT_COMPONENTS, PAGE_COMPONENTS } from '../../content/componentRegistry';
import { COMPONENT_MARKER, CONTENT_COMPONENT_NAMES } from '../../content/contentModel';
import {
  COMPONENT_PAGES,
  LEARN_ARTICLES,
  TRACK_NAVIGATION,
  getContentPage,
  getLearnArticle,
  getLearnArticleFromPath,
  getLearnArticleMetadata,
  getLearnArticleNeighbors,
} from '../../content/learnRegistry';
import { extractOutline } from '../../content/outline';
import { RESOURCE_NAV_ITEMS } from '../../content/resourceNavigation';
import { getDocsMetadata } from '../../utils/pageMetadata';
import ArticleMarkdown from './ArticleMarkdown';
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

/** Every URL that existed before the Markdown migration, with the title it must still render. */
const PRE_EXISTING_PAGES = [
  { path: '/docs/what-is-mcp', title: 'What is the Model Context Protocol?', metaTitle: 'What Is the Model Context Protocol? | mcptest.io' },
  { path: '/docs/remote-vs-local', title: 'Remote vs. Local MCP Servers', metaTitle: 'Remote vs. Local MCP Servers | mcptest.io' },
  { path: '/docs/testing-guide', title: 'Testing Remote MCP Servers', metaTitle: 'Testing Guide for Remote MCP Servers | mcptest.io' },
  { path: '/docs/troubleshooting', title: 'Troubleshooting Remote MCP Servers', metaTitle: 'Troubleshooting MCP Server Errors | mcptest.io' },
  { path: '/learn/mcp-clients-compared', title: 'MCP clients compared', metaTitle: 'MCP clients compared | mcptest.io' },
  { path: '/learn/connect-remote-mcp-server', title: 'How to connect to a remote MCP server', metaTitle: 'How to connect to a remote MCP server | mcptest.io' },
  { path: '/learn/oauth-for-mcp-explained', title: 'OAuth for MCP explained', metaTitle: 'OAuth for MCP explained | mcptest.io' },
  { path: '/learn/should-you-build-mcp-server', title: 'Should you build an MCP server?', metaTitle: 'Should you build an MCP server? | mcptest.io' },
  { path: '/learn/designing-production-mcp-server', title: 'Designing a production MCP server', metaTitle: 'Designing a production MCP server | mcptest.io' },
  { path: '/learn/mcp-server-trust-checklist', title: 'MCP server evaluation and trust checklist', metaTitle: 'MCP server evaluation and trust checklist | mcptest.io' },
];

describe('content registry', () => {
  it('loads every Markdown article and resolves it by slug and canonical path', () => {
    expect(LEARN_ARTICLES).toHaveLength(10);
    for (const article of LEARN_ARTICLES) {
      expect(getLearnArticle(article.slug)).toBe(article);
      expect(getLearnArticleFromPath(article.path)).toBe(article);
      expect(getLearnArticleFromPath(`${article.path}/`)).toBe(article);
      expect(article.sourceLinks.length).toBeGreaterThan(0);
      expect(article.relatedSlugs.length).toBeGreaterThan(0);
    }
    expect(getLearnArticleFromPath('/learn/not-a-guide')).toBeUndefined();
    expect(getLearnArticleFromPath('/learn/mcp-clients-compared/extra')).toBeUndefined();
    expect(getLearnArticleFromPath('/docs/privacy-policy')).toBeUndefined();
  });

  it('keeps every pre-existing docs and learn URL resolving to the same title', () => {
    for (const expected of PRE_EXISTING_PAGES) {
      const page = getContentPage(expected.path);
      expect(page?.kind, expected.path).toBe('article');
      if (page?.kind !== 'article') continue;
      expect(page.article.title).toBe(expected.title);
      expect(page.article.path).toBe(expected.path);
      expect(getLearnArticleMetadata(page.article).title).toBe(expected.metaTitle);
      expect(getLearnArticleMetadata(page.article).canonicalUrl).toBe(`https://mcptest.io${expected.path}`);
      const container = render(<LearnArticlePage article={page.article} />);
      expect(container.querySelector('h1')?.textContent).toBe(expected.title);
    }
  });

  it('registers the React-only pages alongside articles with their metadata', () => {
    expect(COMPONENT_PAGES.map(page => page.path)).toEqual([
      '/docs/privacy-policy',
      '/docs/terms-of-service',
      '/docs/contact',
    ]);
    for (const page of COMPONENT_PAGES) {
      expect(getContentPage(page.path)).toEqual({ kind: 'page', page });
      expect(PAGE_COMPONENTS[page.component]).toBeTypeOf('function');
      expect(getDocsMetadata(page.path)).toEqual({ title: page.metaTitle, description: page.metaDescription });
    }
    expect(getDocsMetadata('/docs/testing-guide')?.title).toBe('Testing Guide for Remote MCP Servers | mcptest.io');
    expect(getDocsMetadata('/docs/missing')).toBeUndefined();
  });

  it('exposes every embeddable component declared in the content model', () => {
    expect(Object.keys(CONTENT_COMPONENTS).sort()).toEqual([...CONTENT_COMPONENT_NAMES].sort());
  });

  it('builds track navigation covering every article exactly once', () => {
    const slugs = TRACK_NAVIGATION.flatMap(track => track.items.map(item => item.slug));
    expect(slugs.sort()).toEqual(LEARN_ARTICLES.map(article => article.slug).sort());
    expect(TRACK_NAVIGATION.map(track => track.id)).toEqual(['understand', 'use', 'build', 'reference']);
    for (const track of TRACK_NAVIGATION) {
      expect(track.items.map(item => item.order)).toEqual([...track.items.map(item => item.order)].sort((a, b) => a - b));
    }
    expect(TRACK_NAVIGATION[0].items[0].path).toBe('/docs/what-is-mcp');
  });

  it('generates the resource hub links from the tracks', () => {
    expect(RESOURCE_NAV_ITEMS.map(item => item.path)).toEqual(['/docs/what-is-mcp', '/learn', '/docs/troubleshooting']);
    expect(RESOURCE_NAV_ITEMS[0].label).toBe('What is MCP?');
    expect(RESOURCE_NAV_ITEMS[2].label).toBe('Troubleshooting');
  });
});

describe('Learn index', () => {
  it('renders a track-grouped list with title, summary, reading time, and level', () => {
    const container = render(<LearnIndex />);

    expect(container.querySelector('h1')?.textContent).toBe('Learn MCP');
    expect(container.querySelector('.learn-grid, .learn-card')).toBeNull();
    const trackHeadings = Array.from(container.querySelectorAll('.learn-track h2'), heading => heading.textContent);
    expect(trackHeadings).toEqual(['Understand', 'Use', 'Build', 'Reference']);
    expect(container.querySelectorAll('.learn-track-description')).toHaveLength(4);
    expect(container.querySelectorAll('.learn-track-item')).toHaveLength(LEARN_ARTICLES.length);
    for (const article of LEARN_ARTICLES) {
      const link = container.querySelector(`a[href="${article.path}"]`);
      expect(link?.textContent).toBe(article.title);
      expect(container.textContent).toContain(article.summary);
    }
    expect(container.textContent).toContain('11 min read');
    expect(container.textContent).toContain('Practitioner');
  });
});

describe('Learn article page', () => {
  it('renders the reading shell with Markdown, heading ids, outline, sources, related guides, and dates', () => {
    const article = getLearnArticle('oauth-for-mcp-explained')!;
    const container = render(<LearnArticlePage article={article} />);

    expect(container.querySelector('.reading-shell .reading-article h1')?.textContent).toBe(article.title);
    expect(container.querySelector('.reading-prose h2')?.textContent).toBe('The actors');
    expect(container.querySelector('.reading-prose h2')?.id).toBe('the-actors');
    expect(container.querySelector('.reading-table table')).not.toBeNull();
    expect(container.querySelectorAll(`time[datetime="${article.lastReviewed}"]`).length).toBeGreaterThan(0);

    const outline = extractOutline(article.content);
    const outlineLinks = Array.from(container.querySelectorAll('.reading-outline a'), link => link.getAttribute('href'));
    expect(outlineLinks).toEqual(outline.map(heading => `#${heading.id}`));
    for (const heading of outline) {
      expect(container.querySelector(`.reading-prose h${heading.level}[id="${heading.id}"]`)?.textContent).toBe(heading.text);
    }

    const sourceLinks = container.querySelectorAll('.reading-sources a[target="_blank"]');
    expect(sourceLinks).toHaveLength(article.sourceLinks.length);
    sourceLinks.forEach(link => {
      expect(link.getAttribute('rel')).toBe('noopener noreferrer');
      expect(link.textContent).toContain('opens in a new tab');
    });
    expect(container.querySelectorAll('.reading-related a')).toHaveLength(article.relatedSlugs.length);
    expect(container.querySelector('.learn-kicker')).toBeNull();
  });

  it('keeps the fragment ids published by the former React docs page', () => {
    const article = getLearnArticleFromPath('/docs/remote-vs-local')!;
    const container = render(<LearnArticlePage article={article} />);

    const legacy: Array<[string, string, string]> = [
      ['h2', 'local-servers', 'Local servers: stdio'],
      ['h2', 'remote-servers', 'Remote servers: Streamable HTTP'],
      ['h3', 'stateless-flow', '2026 stateless flow'],
      ['h3', 'stateful-flow', '2025 stateful flow'],
      ['h3', 'streaming', 'Streaming and compatibility'],
      ['h2', 'authorization', 'Authorization'],
      ['h2', 'cors-security', 'CORS and origin security'],
      ['h2', 'choosing-deployment', 'Choosing and testing a deployment'],
    ];
    for (const [tag, id, text] of legacy) {
      expect(container.querySelector(`.reading-prose ${tag}[id="${id}"]`)?.textContent).toBe(text);
    }
    expect(container.querySelector('.reading-prose')?.textContent).not.toContain('{#');
    const outlineLinks = Array.from(container.querySelectorAll('.reading-outline a'), link => link.getAttribute('href'));
    expect(outlineLinks).toEqual(legacy.map(([, id]) => `#${id}`));
  });

  it('renders unique heading ids when literal headings collide with generated suffixes', () => {
    const container = render(
      <ArticleMarkdown content={['## Example', 'a', '## Example', 'b', '## Example-2', 'c', '## `code` {#pinned}'].join('\n')} />
    );
    const headings = Array.from(container.querySelectorAll('h2'), heading => [heading.id, heading.textContent]);
    expect(headings).toEqual([
      ['example', 'Example'],
      ['example-2', 'Example'],
      ['example-2-2', 'Example-2'],
      ['pinned', 'code'],
    ]);
  });

  it('gives entity and link headings the same ids the outline links to', () => {
    const content = [
      '## Authentication &amp; permissions',
      'a',
      '## [OAuth](https://example.com)',
      'b',
      '### Tools &#38; resources',
      'c',
      '## `&amp;` in code',
    ].join('\n');
    const container = render(<ArticleMarkdown content={content} />);
    const visibleText = (heading: Element) => heading.textContent?.replace(' (opens in a new tab)', '');
    const headings = Array.from(container.querySelectorAll('h2, h3'), heading => [heading.id, visibleText(heading)]);
    expect(headings).toEqual([
      ['authentication-permissions', 'Authentication & permissions'],
      ['oauth', 'OAuth'],
      ['tools-resources', 'Tools & resources'],
      ['amp-in-code', '&amp; in code'],
    ]);

    const outline = extractOutline(content);
    expect(outline.map(heading => heading.id)).toEqual(headings.map(([id]) => id));
    for (const heading of outline) {
      const rendered = container.querySelector(`h${heading.level}[id="${heading.id}"]`);
      expect(rendered && visibleText(rendered)).toBe(heading.text);
    }
  });

  it('links previous and next articles within the track', () => {
    const article = getLearnArticle('mcp-clients-compared')!;
    const { previous, next } = getLearnArticleNeighbors(article);
    const container = render(<LearnArticlePage article={article} />);

    expect(previous?.slug).toBe('connect-remote-mcp-server');
    expect(next?.slug).toBe('oauth-for-mcp-explained');
    expect(container.querySelector('.reading-pager-previous')?.getAttribute('href')).toBe(previous!.path);
    expect(container.querySelector('.reading-pager-next')?.getAttribute('href')).toBe(next!.path);

    const first = getLearnArticle('what-is-mcp')!;
    const firstContainer = render(<LearnArticlePage article={first} />);
    expect(firstContainer.querySelector('.reading-pager-previous')).toBeNull();
    expect(firstContainer.querySelector('.reading-pager-next')?.getAttribute('href')).toBe('/docs/remote-vs-local');
  });

  it('highlights fenced code with a copy button and renders blockquotes and internal links', () => {
    const article = getLearnArticle('troubleshooting')!;
    const container = render(<LearnArticlePage article={article} />);

    const code = container.querySelector('.reading-code code.hljs.language-javascript');
    expect(code).not.toBeNull();
    expect(code?.querySelector('.hljs-keyword')).not.toBeNull();
    expect(container.querySelector('.reading-code-copy')?.textContent).toContain('Copy');
    expect(container.querySelector('.reading-prose a[href="/docs/testing-guide"]')?.getAttribute('target')).toBeNull();

    const guide = render(<LearnArticlePage article={getLearnArticle('testing-guide')!} />);
    expect(guide.querySelector('.reading-prose blockquote strong')?.textContent).toBe('Browser clients need CORS.');
    expect(guide.querySelectorAll('.reading-code code.language-bash')).toHaveLength(4);
  });

  it('embeds a registered component at the marker through the component escape hatch', () => {
    const base = getLearnArticle('testing-guide')!;
    const article = {
      ...base,
      component: 'DashboardDemo',
      content: `Intro paragraph.\n\n${COMPONENT_MARKER}\n\n## After the demo\n\nClosing paragraph.`,
    };
    const container = render(<LearnArticlePage article={article} />);
    const prose = container.querySelector('.reading-prose')!;

    expect(prose.children[0].tagName).toBe('P');
    expect(prose.children[1].classList.contains('reading-embed')).toBe(true);
    expect(prose.children[1].textContent).toContain('Dashboard Demo');
    expect(prose.children[2].tagName).toBe('H2');
    expect(prose.children[2].id).toBe('after-the-demo');

    const appended = render(<LearnArticlePage article={{ ...article, content: 'Only paragraph.' }} />);
    const appendedProse = appended.querySelector('.reading-prose')!;
    expect(appendedProse.lastElementChild?.classList.contains('reading-embed')).toBe(true);

    const noComponent = render(<LearnArticlePage article={{ ...article, component: undefined }} />);
    expect(noComponent.querySelector('.reading-embed')).toBeNull();
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

    const doc = getLearnArticleMetadata(getLearnArticle('what-is-mcp')!);
    expect(doc.canonicalUrl).toBe('https://mcptest.io/docs/what-is-mcp');
    expect(doc.description).toContain('Understand MCP tools, resources, prompts');
  });
});
