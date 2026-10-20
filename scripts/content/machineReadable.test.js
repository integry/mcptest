import { mkdtempSync, readdirSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';
import { CONTENT_TRACKS } from '../../src/content/contentModel.ts';
import { loadArticles } from './loadArticles.js';
import { articleMarkdownPath, renderArticleMarkdown, renderLlmsTxt } from './machineReadable.js';

const SAMPLE = `---
title: Sample guide
summary: A short summary.
track: use
level: newcomer
order: 1
category: Getting started
readingTimeMinutes: 4
lastReviewed: "2026-08-17"
relatedSlugs: []
sourceLinks:
  - title: Spec
    url: https://example.com/spec
---

## First heading

Body text.
`;

const writeFixture = files => {
  const directory = mkdtempSync(join(tmpdir(), 'mcptest-articles-'));
  for (const [name, content] of Object.entries(files)) {
    writeFileSync(join(directory, name), content, 'utf8');
  }
  return directory;
};

describe('Node article loader', () => {
  it('loads and validates the real article directory in reading order', () => {
    const articles = loadArticles({ reservedPaths: ['/docs/contact'] });
    const markdownFiles = readdirSync(join(process.cwd(), 'src/content/articles')).filter(name => name.endsWith('.md'));
    expect(articles).toHaveLength(markdownFiles.length);
    expect(articles[0].path).toBe('/docs/what-is-mcp');
    expect(articles.map(article => article.slug)).toContain('mcp-clients-compared');
  });

  it('loads Markdown files from a directory, deriving slugs from file names', () => {
    const directory = writeFixture({ 'sample-guide.md': SAMPLE, 'notes.txt': 'ignored' });
    const [article] = loadArticles({ directory });
    expect(article.slug).toBe('sample-guide');
    expect(article.path).toBe('/learn/sample-guide');
    expect(article.content).toBe('## First heading\n\nBody text.');
  });

  it('names the failing file when frontmatter is malformed or validation fails', () => {
    const broken = writeFixture({ 'broken.md': '---\ntitle: [unterminated\n---\nBody' });
    expect(() => loadArticles({ directory: broken })).toThrow(/^broken\.md: /);

    const duplicateOrder = writeFixture({
      'one.md': SAMPLE,
      'two.md': SAMPLE.replace('title: Sample guide', 'title: Second guide'),
    });
    expect(() => loadArticles({ directory: duplicateOrder })).toThrow(/share order 1 in the use track/);

    const reserved = writeFixture({ 'contact.md': SAMPLE.replace('order: 1', 'order: 1\npath: /docs/contact') });
    expect(() => loadArticles({ directory: reserved, reservedPaths: ['/docs/contact'] })).toThrow(/reserved page/);
  });

  it('rejects path overrides that would shadow the Learn index or leave the content namespaces', () => {
    const learnIndex = writeFixture({ 'index.md': SAMPLE.replace('order: 1', 'order: 1\npath: /learn') });
    expect(() => loadArticles({ directory: learnIndex })).toThrow(/reuses path \/learn already owned by \(reserved page\)/);

    const outside = writeFixture({ 'example.md': SAMPLE.replace('order: 1', 'order: 1\npath: /catalog/example') });
    expect(() => loadArticles({ directory: outside })).toThrow(/invalid path: \/catalog\/example/);
  });
});

describe('raw Markdown output', () => {
  it('emits a title line, canonical URL header, body, and sources at <path>.md', () => {
    const [article] = loadArticles({ directory: writeFixture({ 'sample-guide.md': SAMPLE }) });
    expect(articleMarkdownPath(article)).toBe('/learn/sample-guide.md');
    expect(renderArticleMarkdown(article)).toBe([
      '# Sample guide',
      '',
      'Canonical URL: https://mcptest.io/learn/sample-guide',
      '',
      '## First heading',
      '',
      'Body text.',
      '',
      '## Sources',
      '',
      '- [Spec](https://example.com/spec)',
      '',
    ].join('\n'));
  });

  it('strips the component marker and uses docs paths for overridden articles', () => {
    const articles = loadArticles({ reservedPaths: [] });
    const guide = articles.find(article => article.slug === 'testing-guide');
    expect(articleMarkdownPath(guide)).toBe('/docs/testing-guide.md');
    const markdown = renderArticleMarkdown({ ...guide, component: 'DashboardDemo', content: `Before\n\n<!-- component -->\n\nAfter` });
    expect(markdown).toContain('Before\n\nAfter');
    expect(markdown).not.toContain('<!-- component -->');
  });
});

describe('llms.txt', () => {
  it('follows the llms.txt convention with one section per track and a tools section', () => {
    const articles = loadArticles({ reservedPaths: [] });
    const text = renderLlmsTxt(articles);
    const lines = text.split('\n');

    expect(lines[0]).toBe('# mcptest.io');
    expect(lines[2]).toMatch(/^> .+MCP.+$/);
    expect(lines[4]).toMatch(/^mcptest\.io .+\.$/);

    const sections = lines.filter(line => line.startsWith('## ')).map(line => line.slice(3));
    expect(sections).toEqual([...CONTENT_TRACKS.map(track => track.label), 'Tools']);

    for (const article of articles) {
      expect(text).toContain(`- [${article.title}](https://mcptest.io${article.path}): ${article.summary}`);
    }
    expect(text).toContain('- [Playground](https://mcptest.io/): ');
    expect(text).toContain('- [Server catalog](https://mcptest.io/catalog): ');
    expect(text.endsWith('\n')).toBe(true);
  });

  it('omits tracks that have no articles', () => {
    const [article] = loadArticles({ directory: writeFixture({ 'sample-guide.md': SAMPLE }) });
    const text = renderLlmsTxt([article]);
    expect(text).toContain('## Use');
    expect(text).not.toContain('## Build');
    expect(text).not.toContain('## Reference');
    expect(text).toContain('- [Sample guide](https://mcptest.io/learn/sample-guide): A short summary.');
  });
});
