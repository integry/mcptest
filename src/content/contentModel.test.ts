import { describe, expect, it } from 'vitest';
import {
  CONTENT_TRACKS,
  COMPONENT_MARKER,
  buildTrackNavigation,
  createArticle,
  getArticleBodyMarkdown,
  getArticleMetaDescription,
  getArticleMetaTitle,
  getTrackNeighbors,
  sortArticlesForReading,
  validateArticles,
  type LearnArticle,
} from './contentModel';
import { extractOutline, slugifyHeading } from './outline';

const baseFrontmatter = {
  title: 'Sample article',
  summary: 'A sample summary.',
  track: 'use',
  level: 'newcomer',
  order: 1,
  category: 'Getting started',
  readingTimeMinutes: 5,
  lastReviewed: '2026-08-17',
  relatedSlugs: [],
  sourceLinks: [{ title: 'Spec', url: 'https://example.com/spec' }],
};

const article = (overrides: Partial<LearnArticle> & { slug: string }): LearnArticle => ({
  ...createArticle(baseFrontmatter, '## Intro\n\nBody.', `${overrides.slug}.md`),
  ...overrides,
});

describe('createArticle', () => {
  it('derives slug from the file name and applies defaults', () => {
    const result = createArticle(baseFrontmatter, 'Body', './articles/sample-guide.md');
    expect(result.slug).toBe('sample-guide');
    expect(result.path).toBe('/learn/sample-guide');
    expect(result.navTitle).toBe('Sample article');
    expect(result.metaTitle).toBeUndefined();
    expect(getArticleMetaTitle(result)).toBe('Sample article | mcptest.io');
    expect(getArticleMetaDescription(result)).toBe('A sample summary.');
  });

  it('honours path, navTitle, metaTitle, metaDescription, and component overrides', () => {
    const result = createArticle(
      {
        ...baseFrontmatter,
        path: '/docs/sample',
        navTitle: 'Sample',
        metaTitle: 'Sample | mcptest.io',
        metaDescription: 'Meta description.',
        component: 'DashboardDemo',
      },
      'Body',
      'sample.md'
    );
    expect(result.path).toBe('/docs/sample');
    expect(result.navTitle).toBe('Sample');
    expect(getArticleMetaTitle(result)).toBe('Sample | mcptest.io');
    expect(getArticleMetaDescription(result)).toBe('Meta description.');
    expect(result.component).toBe('DashboardDemo');
  });

  it('rejects missing or mistyped required fields', () => {
    expect(() => createArticle({ ...baseFrontmatter, title: '' }, 'Body', 'x.md')).toThrow(/"title"/);
    expect(() => createArticle({ ...baseFrontmatter, order: '1' }, 'Body', 'x.md')).toThrow(/"order" must be a number/);
    expect(() => createArticle({ ...baseFrontmatter, relatedSlugs: 'a' }, 'Body', 'x.md')).toThrow(/list of strings/);
    expect(() => createArticle({ ...baseFrontmatter, sourceLinks: [{ title: 'x' }] }, 'Body', 'x.md')).toThrow(/url/);
  });
});

describe('validateArticles', () => {
  const valid = [
    article({ slug: 'first', track: 'use', order: 1 }),
    article({ slug: 'second', track: 'use', order: 2, relatedSlugs: ['first'] }),
    article({ slug: 'third', track: 'build', order: 1, path: '/docs/third' }),
  ];

  it('accepts a consistent set of articles', () => {
    expect(() => validateArticles(valid)).not.toThrow();
  });

  it.each([
    ['slug pattern', [article({ slug: 'Bad_Slug' })], /Invalid Learn article slug/],
    ['duplicate slug', [article({ slug: 'dup' }), article({ slug: 'dup', order: 2 })], /Duplicate Learn article slug/],
    ['missing content', [article({ slug: 'a', content: '' })], /missing required content metadata/],
    ['reading time', [article({ slug: 'a', readingTimeMinutes: 0 })], /invalid reading time/],
    ['review date', [article({ slug: 'a', lastReviewed: '17-08-2026' })], /invalid last-reviewed date/],
    ['source links', [article({ slug: 'a', sourceLinks: [] })], /must include source links/],
    ['unknown related slug', [article({ slug: 'a', relatedSlugs: ['missing'] })], /references unknown article missing/],
    ['unknown track', [article({ slug: 'a', track: 'learn' as LearnArticle['track'] })], /unknown track: learn/],
    ['unknown level', [article({ slug: 'a', level: 'guru' as LearnArticle['level'] })], /unknown level: guru/],
    ['non-integer order', [article({ slug: 'a', order: 1.5 })], /invalid order/],
    ['zero order', [article({ slug: 'a', order: 0 })], /invalid order/],
    [
      'duplicate order within a track',
      [article({ slug: 'a', track: 'use', order: 1 }), article({ slug: 'b', track: 'use', order: 1 })],
      /share order 1 in the use track/,
    ],
    ['invalid path', [article({ slug: 'a', path: 'docs/a' })], /invalid path/],
    ['invalid path characters', [article({ slug: 'a', path: '/docs/A b' })], /invalid path/],
    [
      'duplicate path',
      [article({ slug: 'a', path: '/docs/same' }), article({ slug: 'b', order: 2, path: '/docs/same' })],
      /reuses path \/docs\/same/,
    ],
    ['unknown component', [article({ slug: 'a', component: 'Nope' })], /unknown component Nope/],
    [
      'marker without component',
      [article({ slug: 'a', content: `Intro\n\n${COMPONENT_MARKER}\n\nMore` })],
      /component marker but declares no component/,
    ],
  ])('rejects %s', (_label, articles, message) => {
    expect(() => validateArticles(articles)).toThrow(message);
  });

  it('allows the same order in different tracks', () => {
    expect(() =>
      validateArticles([article({ slug: 'a', track: 'use', order: 1 }), article({ slug: 'b', track: 'build', order: 1 })])
    ).not.toThrow();
  });

  it('rejects paths reserved by React-only pages', () => {
    expect(() =>
      validateArticles([article({ slug: 'contact', path: '/docs/contact' })], { reservedPaths: ['/docs/contact'] })
    ).toThrow(/already owned by \(reserved page\)/);
  });

  it('accepts a known component with a marker', () => {
    const withComponent = article({
      slug: 'demo',
      component: 'DashboardDemo',
      content: `Intro\n\n${COMPONENT_MARKER}\n\nAfter`,
    });
    expect(() => validateArticles([withComponent], { knownComponents: ['DashboardDemo'] })).not.toThrow();
    expect(getArticleBodyMarkdown(withComponent)).toBe('Intro\n\nAfter');
  });
});

describe('track navigation', () => {
  const articles = [
    article({ slug: 'use-2', track: 'use', order: 2, title: 'Use two' }),
    article({ slug: 'use-1', track: 'use', order: 1, title: 'Use one', navTitle: 'U1' }),
    article({ slug: 'ref-1', track: 'reference', order: 1, title: 'Ref one', path: '/docs/ref-one' }),
    article({ slug: 'use-3', track: 'use', order: 3, title: 'Use three' }),
  ];

  it('groups articles by track in canonical track order, sorted by order, omitting empty tracks', () => {
    const navigation = buildTrackNavigation(articles);
    expect(navigation.map(track => track.id)).toEqual(['use', 'reference']);
    expect(navigation[0].label).toBe('Use');
    expect(navigation[0].description).toBe(CONTENT_TRACKS[1].description);
    expect(navigation[0].items.map(item => item.slug)).toEqual(['use-1', 'use-2', 'use-3']);
    expect(navigation[0].items[0]).toMatchObject({
      navTitle: 'U1',
      path: '/learn/use-1',
      level: 'newcomer',
      readingTimeMinutes: 5,
      summary: 'A sample summary.',
    });
    expect(navigation[1].items[0].path).toBe('/docs/ref-one');
  });

  it('orders articles for reading by track then order', () => {
    expect(sortArticlesForReading(articles).map(item => item.slug)).toEqual(['use-1', 'use-2', 'use-3', 'ref-1']);
  });

  it('finds previous and next articles within a track only', () => {
    const [useTwo, useOne, refOne, useThree] = articles;
    expect(getTrackNeighbors(useOne, articles)).toEqual({ previous: undefined, next: useTwo });
    expect(getTrackNeighbors(useTwo, articles)).toEqual({ previous: useOne, next: useThree });
    expect(getTrackNeighbors(useThree, articles)).toEqual({ previous: useTwo, next: undefined });
    expect(getTrackNeighbors(refOne, articles)).toEqual({ previous: undefined, next: undefined });
  });
});

describe('outline extraction', () => {
  it('collects h2 and h3 headings with unique slug ids and skips fenced code', () => {
    const outline = extractOutline([
      '## The actors',
      'text',
      '### `tools/call` and **bold**',
      '```bash',
      '## not a heading',
      '```',
      '## The actors',
      '#### ignored depth',
    ].join('\n'));

    expect(outline).toEqual([
      { level: 2, text: 'The actors', id: 'the-actors' },
      { level: 3, text: 'tools/call and bold', id: 'toolscall-and-bold' },
      { level: 2, text: 'The actors', id: 'the-actors-2' },
    ]);
  });

  it('slugifies punctuation and accents', () => {
    expect(slugifyHeading('Command-line check: stateless 2026')).toBe('command-line-check-stateless-2026');
    expect(slugifyHeading('Café & crème')).toBe('cafe-creme');
    expect(slugifyHeading('???')).toBe('section');
  });
});
