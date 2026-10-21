import React, { act } from 'react';
import { readdirSync } from 'node:fs';
import { resolve } from 'node:path';
import { createRoot } from 'react-dom/client';
import { renderToStaticMarkup } from 'react-dom/server';
import { MemoryRouter } from 'react-router-dom';
import { afterEach, describe, expect, it } from 'vitest';
import { loadArticles } from '../../../scripts/content/loadArticles.js';
import { loadAllLearnArticles } from '../../content/__fixtures__/loadedArticles';
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
  getLoadedLearnArticleBody,
  loadLearnArticleBody,
} from '../../content/learnRegistry';
import { extractOutline } from '../../content/outline';
import { LEARN_HUB_NAVIGATION, LEARN_TRACKS, getLearnTrackForPath } from '../../content/navigation';
import { getDocsMetadata } from '../../utils/pageMetadata';
import ArticleMarkdown from './ArticleMarkdown';
import { loadHighlighter } from './highlighter';
import LearnArticlePage from './LearnArticlePage';
import LearnIndex from './LearnIndex';
import LearnNotFound from './LearnNotFound';

// Loads every body through the on-demand path, as main.tsx does before
// mounting a guide route, so the pages below render without a loading state.
const LOADED_ARTICLES = await loadAllLearnArticles();

const render = (node: React.ReactNode) => {
  const container = document.createElement('div');
  container.innerHTML = renderToStaticMarkup(
    <MemoryRouter>{node}</MemoryRouter>
  );
  return container;
};

(globalThis as typeof globalThis & { IS_REACT_ACT_ENVIRONMENT: boolean }).IS_REACT_ACT_ENVIRONMENT = true;
const mountedRoots: Array<ReturnType<typeof createRoot>> = [];
afterEach(() => {
  mountedRoots.splice(0).forEach(root => act(() => root.unmount()));
});

/** Client render under the application's StrictMode entry point, which invokes renderers twice. */
const renderStrict = (node: React.ReactNode) => {
  const container = document.createElement('div');
  const root = createRoot(container);
  mountedRoots.push(root);
  act(() => root.render(
    <React.StrictMode>
      <MemoryRouter>{node}</MemoryRouter>
    </React.StrictMode>
  ));
  return { container, root };
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
    const markdownFiles = readdirSync(resolve('src/content/articles')).filter(file => file.endsWith('.md'));
    expect(LEARN_ARTICLES).toHaveLength(markdownFiles.length);
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

  it('indexes exactly the Markdown files, frontmatter only', () => {
    const slugs = readdirSync(resolve('src/content/articles'))
      .filter(file => file.endsWith('.md'))
      .map(file => file.replace(/\.md$/, ''));
    expect(LEARN_ARTICLES.map(article => article.slug).sort()).toEqual(slugs.sort());
    for (const article of LEARN_ARTICLES) {
      expect(article, article.slug).not.toHaveProperty('content');
      expect(article.outline, article.slug).toBeInstanceOf(Array);
      expect(typeof article.hasCodeBlock, article.slug).toBe('boolean');
    }
  });

  it('matches the build-time loader for every article, body loaded on demand', async () => {
    const built = loadArticles({ reservedPaths: COMPONENT_PAGES.map(page => page.path) });
    expect(LEARN_ARTICLES.map(article => article.slug)).toEqual(built.map(article => article.slug));
    for (const [position, { content, ...summary }] of built.entries()) {
      const entry = LEARN_ARTICLES[position];
      expect(entry, entry.slug).toMatchObject(summary);
      await expect(loadLearnArticleBody(entry), entry.slug).resolves.toBe(content);
      expect(entry.hasCodeBlock, entry.slug).toBe(/^(`{3,}|~{3,})/m.test(content));
    }
  });

  it('precomputes the outline the rendered headings carry', () => {
    for (const article of LEARN_ARTICLES) {
      expect(article.outline, article.slug).toEqual(extractOutline(getLoadedLearnArticleBody(article.slug)!));
      const container = render(<LearnArticlePage article={article} />);
      const rendered = Array.from(container.querySelectorAll('.reading-prose h2[id], .reading-prose h3[id]'), heading => ({
        level: Number(heading.tagName.slice(1)),
        id: heading.id,
      }));
      expect(rendered, article.slug).toEqual(article.outline.map(({ level, id }) => ({ level, id })));
      const outlineLinks = Array.from(container.querySelectorAll('.reading-outline a'), link => link.getAttribute('href'));
      expect(outlineLinks, article.slug).toEqual(article.outline.map(heading => `#${heading.id}`));
    }
  }, 120_000);

  it('keeps the page outline in place while a body is loading, and offers a retry when it fails', async () => {
    const pending = { ...getLearnArticle('oauth-for-mcp-explained')!, slug: 'not-loaded-yet' };
    const loading = render(<LearnArticlePage article={pending} />);
    expect(loading.querySelector('h1')?.textContent).toBe(pending.title);
    expect(loading.querySelector('.reading-prose [role="status"]')?.textContent).toContain('Loading guide');
    expect(Array.from(loading.querySelectorAll('.reading-outline a'), link => link.getAttribute('href'))).toEqual(
      pending.outline.map(heading => `#${heading.id}`)
    );
    expect(loading.querySelector('.reading-sources')).not.toBeNull();

    const { container } = renderStrict(<LearnArticlePage article={pending} />);
    await act(async () => {
      await loadLearnArticleBody(pending).catch(() => undefined);
    });
    expect(container.querySelector('.reading-prose [role="alert"]')?.textContent).toContain('could not be loaded');
    expect(container.querySelector('.reading-prose button')?.textContent).toBe('Try again');
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

  it('keeps environment references unexpanded in shell commands that save MCP server config', () => {
    const shellBlocks = (markdown: string) =>
      [...markdown.matchAll(/^[ \t]*```(?:bash|sh|shell|console)\n([\s\S]*?)^[ \t]*```/gm)].map(match => match[1]);
    const mcpAddCommands = LOADED_ARTICLES.flatMap(article =>
      shellBlocks(article.content)
        .flatMap(block => block.replace(/\\\n/g, ' ').split('\n'))
        .filter(command => /\bmcp add\b/.test(command))
        .map(command => ({ slug: article.slug, command }))
    );
    expect(mcpAddCommands.some(({ command }) => command.includes("'Authorization: Bearer ${EXAMPLE_TOKEN}'"))).toBe(true);
    for (const { slug, command } of mcpAddCommands) {
      expect(command, slug).not.toMatch(/"[^"]*\$[^"]*"/);
    }
  });

  it('derives the sidebar learn tracks from the content registry', () => {
    expect(LEARN_HUB_NAVIGATION.path).toBe('/learn');
    expect(LEARN_TRACKS.map(track => track.label)).toEqual(['Understand', 'Use', 'Build', 'Reference']);
    expect(LEARN_TRACKS.every(track => track.icon.startsWith('bi-'))).toBe(true);
    // The former "Resources" entries live inside their tracks.
    expect(getLearnTrackForPath('/docs/what-is-mcp')?.id).toBe('understand');
    expect(getLearnTrackForPath('/docs/troubleshooting/')?.id).toBe('reference');
    expect(getLearnTrackForPath('/catalog')).toBeUndefined();
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

    const outline = extractOutline(getLoadedLearnArticleBody(article.slug)!);
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

  it('keeps heading ids stable under StrictMode double rendering and re-renders', () => {
    const content = [
      '## The actors',
      'a',
      '## Example',
      'b',
      COMPONENT_MARKER,
      '',
      '## Example',
      'c',
      '## Example-2 {#pinned}',
    ].join('\n');
    const expected = extractOutline(content).map(heading => heading.id);
    expect(expected).toEqual(['the-actors', 'example', 'example-2', 'pinned']);

    const { container, root } = renderStrict(<ArticleMarkdown content={content} embedded={<p id="demo">demo</p>} />);
    const ids = () => Array.from(container.querySelectorAll('h2'), heading => heading.id);
    expect(ids()).toEqual(expected);
    expect(container.querySelector('#demo')?.previousElementSibling?.textContent).toBe('b');

    act(() => root.render(
      <React.StrictMode>
        <MemoryRouter>
          <ArticleMarkdown content={content} embedded={<p id="demo">demo again</p>} />
        </MemoryRouter>
      </React.StrictMode>
    ));
    expect(ids()).toEqual(expected);

    const outline = renderStrict(<LearnArticlePage article={{ ...LEARN_ARTICLES[0], content }} />).container;
    expect(Array.from(outline.querySelectorAll('.reading-prose h2'), heading => heading.id)).toEqual(expected);
    expect(Array.from(outline.querySelectorAll('.reading-outline a'), link => link.getAttribute('href'))).toEqual(
      expected.map(id => `#${id}`)
    );
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

  it('links reference-style link headings in the outline to the ids the rendered headings carry', () => {
    const base = getLearnArticle('testing-guide')!;
    const article = {
      ...base,
      content: [
        'Intro paragraph.',
        '',
        '## [OAuth][auth]',
        '',
        'Body.',
        '',
        '### [Dynamic client registration][]',
        '',
        '## [Tokens]',
        '',
        '## [Undefined][missing]',
        '',
        '[auth]: https://example.com/oauth',
        '[dynamic client registration]: https://example.com/dcr',
        '[tokens]: /docs/testing-guide',
      ].join('\n'),
    };
    const container = render(<LearnArticlePage article={article} />);
    const visibleText = (heading: Element) => heading.textContent?.replace(' (opens in a new tab)', '');

    const outline = extractOutline(article.content);
    expect(outline.map(heading => [heading.id, heading.text])).toEqual([
      ['oauth', 'OAuth'],
      ['dynamic-client-registration', 'Dynamic client registration'],
      ['tokens', 'Tokens'],
      ['undefinedmissing', '[Undefined][missing]'],
    ]);

    const outlineLinks = Array.from(container.querySelectorAll('.reading-outline a'), link => link.getAttribute('href'));
    expect(outlineLinks).toEqual(outline.map(heading => `#${heading.id}`));
    for (const href of outlineLinks) {
      const target = container.querySelector(`.reading-prose [id="${href!.slice(1)}"]`);
      expect(target, `outline link ${href} has no rendered target`).not.toBeNull();
    }
    for (const heading of outline) {
      const rendered = container.querySelector(`.reading-prose h${heading.level}[id="${heading.id}"]`);
      expect(rendered && visibleText(rendered)).toBe(heading.text);
    }
    expect(container.querySelector('.reading-prose h2[id="oauth"] a')?.getAttribute('href')).toBe('https://example.com/oauth');
    expect(container.querySelector('.reading-prose h2[id="tokens"] a')?.getAttribute('href')).toBe('/docs/testing-guide');
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

  it('highlights fenced code with a copy button and renders blockquotes and internal links', async () => {
    // The highlighter is a separate chunk; main.tsx preloads it for articles with code.
    await loadHighlighter();
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
