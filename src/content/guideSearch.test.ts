import { describe, expect, it } from 'vitest';
import { CONTENT_TRACKS } from './contentModel';
import { loadAllLearnArticles } from './__fixtures__/loadedArticles';
import { GUIDE_SEARCH_RESULT_LIMIT, prepareGuideSearch, searchGuides, snippetAround } from './guideSearch';
import { buildSearchIndex, type SearchIndex, type SearchIndexArticle } from './searchIndex';

const LEARN_ARTICLES = await loadAllLearnArticles();
const prepared = prepareGuideSearch(buildSearchIndex(LEARN_ARTICLES));
const flat = (query: string, search = prepared) => searchGuides(search, query).flatMap(group => group.results);
const marked = (text: string, ranges: readonly (readonly [number, number])[]) =>
  ranges.map(([start, end]) => text.slice(start, end));

const entry = (slug: string, overrides: Partial<SearchIndexArticle> = {}): SearchIndexArticle => ({
  slug,
  path: `/learn/${slug}`,
  title: `Guide ${slug}`,
  summary: '',
  track: 'reference',
  level: 'practitioner',
  excerpt: '',
  headings: [],
  ...overrides,
});

describe('guide search ranking', () => {
  it('returns nothing for an empty query', () => {
    expect(searchGuides(prepared, '   ')).toEqual([]);
  });

  it('puts the guide whose title names the topic first', () => {
    expect(flat('cors')[0].article.slug).toBe('mcp-cors-headers-for-browser-clients');
    expect(flat('401')[0].article.slug).toBe('remote-mcp-server-401-unauthorized');
    expect(flat('glossary')[0].article.slug).toBe('mcp-glossary');
  });

  it('accepts compact fuzzy subsequences in titles', () => {
    const [first] = flat('trnsprt diag');
    expect(first.article.slug).toBe('mcp-transport-diagnostics-reference');
    expect(first.heading).toBeUndefined();
    expect(marked(first.article.title, first.titleRanges).join('')).toBe('trnsprtdiag');
  });

  it('links a heading match to its section anchor and highlights the heading', () => {
    const synthetic = prepareGuideSearch({
      version: 1,
      articles: [
        entry('alpha', { headings: [
          { level: 2, text: 'Install the CLI', id: 'install-the-cli', excerpt: 'Run npm install.' },
          { level: 2, text: 'Rotate refresh tokens', id: 'rotate-refresh-tokens', excerpt: 'Tokens expire.' },
        ] }),
      ],
    });
    const [result] = flat('rotate tok', synthetic);
    expect(result.heading?.id).toBe('rotate-refresh-tokens');
    expect(result.href).toBe('/learn/alpha#rotate-refresh-tokens');
    expect(marked(result.heading!.text, result.headingRanges)).toEqual(['Rotate', 'tok']);
    expect(result.snippet.text).toBe('Tokens expire.');
  });

  it('matches excerpts by substring only and highlights the match in the snippet', () => {
    const synthetic = prepareGuideSearch({
      version: 1,
      articles: [entry('beta', { headings: [
        { level: 2, text: 'Notes', id: 'notes', excerpt: 'A long preamble that goes on and on before the word handshake appears.' },
      ] })],
    });
    const [result] = flat('handshake', synthetic);
    expect(result.href).toBe('/learn/beta#notes');
    expect(result.snippet.text.startsWith('…')).toBe(true);
    expect(marked(result.snippet.text, result.snippet.ranges)).toEqual(['handshake']);
    // "hdshk" is a subsequence of the excerpt but not of any title or heading.
    expect(flat('hdshk', synthetic)).toEqual([]);
  });

  it('prefers a heading match over the same words in an excerpt', () => {
    const synthetic = prepareGuideSearch({
      version: 1,
      articles: [
        entry('excerpt-only', { excerpt: 'Mentions session resumption in passing.' }),
        entry('heading-match', { headings: [{ level: 2, text: 'Session resumption', id: 'session-resumption', excerpt: '' }] }),
      ],
    });
    expect(flat('session resumption', synthetic).map(result => result.article.slug)).toEqual(['heading-match', 'excerpt-only']);
  });

  it('returns one result per article and links a title match to the article itself', () => {
    const results = flat('oauth');
    expect(new Set(results.map(result => result.article.slug)).size).toBe(results.length);
    const titleMatch = results.find(result => result.article.slug === 'oauth-for-mcp-explained');
    expect(titleMatch?.href).toBe('/learn/oauth-for-mcp-explained');
    expect(titleMatch?.heading).toBeUndefined();
  });

  it('groups by track, strongest group first, and caps the list', () => {
    const groups = searchGuides(prepared, 'mcp');
    const results = groups.flatMap(group => group.results);
    expect(results.length).toBe(GUIDE_SEARCH_RESULT_LIMIT);
    expect(new Set(groups.map(group => group.track)).size).toBe(groups.length);
    for (const group of groups) {
      expect(group.label).toBe(CONTENT_TRACKS.find(track => track.id === group.track)?.label);
      expect(group.results.every(result => result.article.track === group.track)).toBe(true);
      const scores = group.results.map(result => result.score);
      expect(scores).toEqual([...scores].sort((left, right) => right - left));
    }
    const bestPerGroup = groups.map(group => group.results[0].score);
    expect(bestPerGroup).toEqual([...bestPerGroup].sort((left, right) => right - left));
  });

  it('drops scattered subsequence matches far below the best result', () => {
    const synthetic = prepareGuideSearch({
      version: 1,
      articles: [entry('scatter', { title: 'Connect over remote streams' }), entry('direct', { title: 'CORS headers' })],
    });
    expect(flat('cors', synthetic).map(result => result.article.slug)).toEqual(['direct']);
  });
});

describe('snippetAround', () => {
  it('keeps short leads intact and shifts ranges after an ellipsis otherwise', () => {
    expect(snippetAround('match here', [[0, 5]])).toEqual({ text: 'match here', ranges: [[0, 5]] });
    const text = `${'lead '.repeat(20)}target tail`;
    const start = text.indexOf('target');
    const snippet = snippetAround(text, [[start, start + 6]]);
    expect(snippet.text.startsWith('…lead')).toBe(true);
    expect(marked(snippet.text, snippet.ranges)).toEqual(['target']);
  });
});

describe('guide search performance', () => {
  const tracks = ['use', 'build', 'reference', 'understand'] as const;
  const words = ['transport', 'oauth', 'session', 'cursor', 'header', 'schema', 'deploy', 'proxy', 'token', 'client'];
  const syntheticIndex = (count: number): SearchIndex => ({
    version: 1,
    articles: Array.from({ length: count }, (_, index) => entry(`synthetic-${index}`, {
      title: `How to ${words[index % 10]} a remote ${words[(index * 3) % 10]} server, part ${index}`,
      summary: `A practical guide to ${words[(index * 7) % 10]} and ${words[(index + 4) % 10]} for remote MCP servers.`,
      track: tracks[index % 4],
      excerpt: `${'Intro text about remote servers and their transports. '.repeat(4)}`.slice(0, 200),
      headings: Array.from({ length: 12 }, (_, section) => ({
        level: section % 3 ? 3 : 2,
        text: `${words[(index + section) % 10]} step ${section}: configure the ${words[(section * 7) % 10]}`,
        id: `step-${section}`,
        excerpt: `Section ${section} explains the ${words[(index + section * 3) % 10]} handshake, retries, timeouts and errors in detail. `.repeat(2).slice(0, 200),
      })),
    })),
  });

  it('answers every keystroke in under 50 ms for 500 articles', () => {
    const search = prepareGuideSearch(syntheticIndex(500));
    const queries = ['o', 'oa', 'oau', 'oaut', 'oauth', 'oauth ', 'oauth t', 'oauth to', 'oauth tok', 'oauth toke', 'oauth token', 'zzzz', 'step 1 hand'];
    // Warm the JIT so the measurement reflects steady-state typing.
    queries.forEach(query => searchGuides(search, query));
    // Best of three per keystroke, so a GC pause or a busy CI host is not counted.
    const slowest = Math.max(...queries.map(query => Math.min(...[0, 1, 2].map(() => {
      const started = performance.now();
      searchGuides(search, query);
      return performance.now() - started;
    }))));
    expect(slowest).toBeLessThan(50);
    expect(flat('oauth token', search).length).toBeGreaterThan(0);
  });
});
