import { describe, expect, it } from 'vitest';
import { createArticle } from './contentModel';
import type { LearnArticle } from './contentModel';
import { LEARN_ARTICLES } from './learnRegistry';
import { extractOutline } from './outline';
import {
  SEARCH_EXCERPT_LENGTH,
  SEARCH_INDEX_MAX_BYTES,
  SEARCH_INDEX_VERSION,
  buildSearchIndex,
  buildSearchIndexArticle,
  serializeSearchIndex,
  truncateExcerpt,
} from './searchIndex';

const bytes = (text: string) => new TextEncoder().encode(text).length;

const article = (slug: string, content: string, overrides: Record<string, unknown> = {}): LearnArticle =>
  createArticle({
    title: `Guide ${slug}`,
    summary: `Summary of ${slug}.`,
    slug,
    category: 'Testing',
    readingTimeMinutes: 3,
    lastReviewed: '2026-10-01',
    track: 'reference',
    level: 'practitioner',
    order: 1,
    ...overrides,
  }, content, `${slug}.md`);

/** Synthetic articles with long sections. */
const syntheticArticles = (count: number): LearnArticle[] =>
  Array.from({ length: count }, (_, index) => article(
    `synthetic-${index}`,
    [
      `Intro paragraph ${index} about remote servers and transports. `.repeat(6),
      ...Array.from({ length: 8 }, (_, section) => [
        `## Section ${section} of guide ${index}`,
        '',
        `Body text for section ${section} with **bold** words, a [link](https://example.com/${index}) and \`code\`. `.repeat(5),
        '',
        section % 2 ? `### Detail ${section}` : '',
        '',
        'More detail text that keeps going for a while. '.repeat(4),
      ].join('\n')),
    ].join('\n\n'),
    { track: (['use', 'build', 'reference', 'understand'] as const)[index % 4], order: index + 1 }
  ));

describe('guide search index', () => {
  const index = buildSearchIndex(LEARN_ARTICLES);

  it('carries every article with its listing fields', () => {
    expect(index.version).toBe(SEARCH_INDEX_VERSION);
    expect(index.articles.map(entry => entry.slug)).toEqual(LEARN_ARTICLES.map(entry => entry.slug));
    for (const [position, entry] of index.articles.entries()) {
      const source = LEARN_ARTICLES[position];
      expect(Object.keys(entry).sort()).toEqual(['excerpt', 'headings', 'level', 'path', 'slug', 'summary', 'title', 'track']);
      expect(entry).toMatchObject({
        slug: source.slug,
        path: source.path,
        title: source.title,
        summary: source.summary,
        track: source.track,
        level: source.level,
      });
    }
  });

  it('lists the h2/h3 headings with the ids the reading outline links to', () => {
    for (const [position, entry] of index.articles.entries()) {
      const outline = extractOutline(LEARN_ARTICLES[position].content);
      expect(entry.headings.map(({ level, text, id }) => ({ level, text, id })), entry.slug).toEqual(outline);
    }
  });

  it('keeps short plain-text excerpts with the Markdown stripped', () => {
    const excerpts = index.articles.flatMap(entry => [entry.excerpt, ...entry.headings.map(heading => heading.excerpt)]);
    expect(excerpts.filter(Boolean).length).toBeGreaterThan(index.articles.length);
    for (const excerpt of excerpts) {
      expect(excerpt.length).toBeLessThanOrEqual(SEARCH_EXCERPT_LENGTH);
      expect(excerpt).not.toMatch(/\*\*|\]\(|```|<!--|\n/);
      expect(excerpt).toBe(excerpt.trim());
    }
  });

  it('stays under the size budget for the current corpus', () => {
    expect(bytes(serializeSearchIndex(index))).toBeLessThanOrEqual(SEARCH_INDEX_MAX_BYTES);
  });

  it('shortens excerpts rather than exceed the budget', () => {
    const synthetic = syntheticArticles(20);
    const fullSize = bytes(serializeSearchIndex(buildSearchIndex(synthetic, { maxBytes: Infinity })));
    const maxBytes = Math.floor(fullSize * 0.8);

    const bounded = buildSearchIndex(synthetic, { maxBytes });

    expect(bytes(serializeSearchIndex(bounded))).toBeLessThanOrEqual(maxBytes);
    expect(bounded.articles).toHaveLength(20);
    expect(bounded.articles.every(entry => entry.headings.length === 12)).toBe(true);
    const longest = Math.max(...bounded.articles.flatMap(entry => entry.headings.map(heading => heading.excerpt.length)));
    expect(longest).toBeGreaterThan(0);
    expect(longest).toBeLessThan(SEARCH_EXCERPT_LENGTH);
  });

  it('refuses an index that cannot fit even without excerpts', () => {
    expect(() => buildSearchIndex(syntheticArticles(5), { maxBytes: 500 })).toThrow(/exceeds 500 bytes/);
  });
});

describe('search sections', () => {
  it('splits text at h2/h3, keeps deeper headings in their section and skips code blocks', () => {
    const entry = buildSearchIndexArticle(article('sections', [
      'Before the **first** heading, see [the spec](https://example.com).',
      '',
      '## Configure *the* client {#configure}',
      '',
      'Set the `Accept` header.',
      '',
      '```json',
      '{ "hidden": true }',
      '```',
      '',
      '#### Deep heading',
      '',
      '- one',
      '- two',
      '',
      '## Configure the client',
      '',
      '<!-- component -->',
      '',
      '### After the component',
      '',
      '| Header | Value |',
      '| --- | --- |',
      '| a | b |',
    ].join('\n')));

    expect(entry.excerpt).toBe('Before the first heading, see the spec.');
    expect(entry.headings).toEqual([
      { level: 2, text: 'Configure the client', id: 'configure', excerpt: 'Set the Accept header. Deep heading one two' },
      { level: 2, text: 'Configure the client', id: 'configure-the-client', excerpt: '' },
      { level: 3, text: 'After the component', id: 'after-the-component', excerpt: 'Header Value a b' },
    ]);
  });

  it('truncates to the excerpt length on a word boundary', () => {
    const text = 'word '.repeat(80).trim();
    const excerpt = truncateExcerpt(text);
    expect(excerpt.length).toBeLessThanOrEqual(SEARCH_EXCERPT_LENGTH);
    expect(excerpt.endsWith('word…')).toBe(true);
    expect(truncateExcerpt('short')).toBe('short');
    expect(truncateExcerpt('anything', 0)).toBe('');
  });
});
