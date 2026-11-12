import { describe, expect, it } from 'vitest';
import {
  KEYWORD_LANDING_PAGES,
  KEYWORD_LANDING_PATHS,
  getKeywordLandingFaqStructuredData,
  getKeywordLandingPage,
  type KeywordLandingPage,
} from './keywordLandingPages';
import {
  LANDING_AUDIENCE_PATHS,
  LANDING_FAQ,
  LANDING_HEADLINE,
  LANDING_LEDE,
  LANDING_REPORT_COVERAGE,
  LANDING_STEPS,
  landingPlainText,
  parseLandingText,
} from './landingCopy';
import { LANDING_PAGE_NAVIGATION } from './navigationLinks';
import { EXACT_APP_ROUTES, isKnownAppPath } from '../utils/appRoutes';
import { CI_PATH } from './ciCopy';

/** Every string a page shows, links reduced to their labels. */
const pageStrings = (page: KeywordLandingPage): string[] => [
  page.h1,
  page.intro,
  ...page.sections.flatMap(section => [
    section.title,
    ...(section.paragraphs ?? []),
    ...(section.steps ?? []).flatMap(step => [step.title, step.description]),
    ...(section.items ?? []).flatMap(item => [item.title, item.description]),
    ...(section.table ? [section.table.caption, ...section.table.columns, ...section.table.rows.flat()] : []),
    ...(section.after ?? []),
  ]),
  ...page.faq.flatMap(item => [item.question, item.answer]),
  page.relatedTitle,
  ...page.related.flatMap(link => [link.label, link.description]),
].map(landingPlainText);

const homeStrings = [
  LANDING_HEADLINE,
  LANDING_LEDE,
  ...LANDING_STEPS.flatMap(step => [step.title, step.description]),
  ...LANDING_AUDIENCE_PATHS.flatMap(path => [path.title, path.description]),
  ...LANDING_REPORT_COVERAGE,
  ...LANDING_FAQ.flatMap(item => [item.question, item.answer]),
].map(landingPlainText);

const words = (strings: readonly string[]) => strings.join(' ').toLowerCase().match(/[a-z0-9][a-z0-9.'-]*/g) ?? [];

/** Five-word shingles: near-duplicate copy shares most of them. */
const shingles = (strings: readonly string[]) => {
  const list = words(strings);
  const result = new Set<string>();
  for (let index = 0; index + 5 <= list.length; index++) result.add(list.slice(index, index + 5).join(' '));
  return result;
};

const overlap = (left: Set<string>, right: Set<string>) => {
  const shared = [...left].filter(item => right.has(item)).length;
  return shared / Math.min(left.size, right.size);
};

const internalLinks = (page: KeywordLandingPage): string[] => [
  ...[
    page.intro,
    ...page.sections.flatMap(section => [
      ...(section.paragraphs ?? []),
      ...(section.steps ?? []).map(step => step.description),
      ...(section.items ?? []).map(item => item.description),
      ...(section.after ?? []),
    ]),
    ...page.faq.map(item => item.answer),
  ].flatMap(value => parseLandingText(value).map(part => part.href).filter((href): href is string => Boolean(href))),
  ...page.related.map(link => link.href),
].filter(href => href.startsWith('/'));

describe('keyword landing pages', () => {
  it('are the three app routes, each with unique metadata, H1 and page-view title', () => {
    expect(KEYWORD_LANDING_PATHS).toEqual(['/mcp-test-server', '/mcp-inspector-online', '/mcp-playground']);
    expect(KEYWORD_LANDING_PAGES.map(page => page.path)).toEqual(KEYWORD_LANDING_PATHS);
    for (const path of KEYWORD_LANDING_PATHS) {
      expect(EXACT_APP_ROUTES).toContain(path);
      expect(isKnownAppPath(path)).toBe(true);
      expect(getKeywordLandingPage(path)?.path).toBe(path);
    }
    expect(getKeywordLandingPage('/mcp-test-server/')).toBeUndefined();

    for (const field of ['title', 'description', 'h1', 'intro', 'pageViewTitle'] as const) {
      const values = KEYWORD_LANDING_PAGES.map(page => page[field]);
      expect(new Set(values).size, field).toBe(values.length);
    }
    expect(KEYWORD_LANDING_PAGES.map(page => page.h1)).toEqual([
      'Test your MCP server online',
      'MCP Inspector online',
      'MCP playground',
    ]);
    expect(KEYWORD_LANDING_PAGES.map(page => page.h1)).not.toContain(LANDING_HEADLINE);
  });

  it('keep titles and descriptions within what search results show', () => {
    for (const page of KEYWORD_LANDING_PAGES) {
      expect(page.title, page.path).toMatch(/ \| mcptest\.io$/);
      expect(page.title.length, page.path).toBeLessThanOrEqual(70);
      expect(page.description.length, page.path).toBeGreaterThanOrEqual(120);
      expect(page.description.length, page.path).toBeLessThanOrEqual(170);
    }
  });

  it('each carry 500 to 900 words of copy', () => {
    for (const page of KEYWORD_LANDING_PAGES) {
      const count = words(pageStrings(page)).length;
      expect(count, page.path).toBeGreaterThanOrEqual(500);
      expect(count, page.path).toBeLessThanOrEqual(900);
    }
  });

  it('are not near-duplicates of each other or of the home page', () => {
    const home = shingles(homeStrings);
    const pages = KEYWORD_LANDING_PAGES.map(page => shingles(pageStrings(page)));
    for (const [index, page] of pages.entries()) {
      expect(overlap(page, home), `${KEYWORD_LANDING_PAGES[index].path} vs home`).toBeLessThan(0.1);
      for (const other of pages.slice(index + 1)) {
        expect(overlap(page, other), KEYWORD_LANDING_PAGES[index].path).toBeLessThan(0.1);
      }
    }
  });

  it('use unique section anchors on each page', () => {
    for (const page of KEYWORD_LANDING_PAGES) {
      const ids = page.sections.map(section => section.id);
      expect(new Set([...ids, 'faq']).size, page.path).toBe(ids.length + 1);
      for (const id of ids) expect(id).toMatch(/^[a-z][a-z-]*$/);
    }
  });

  it('link to each other, to guides and only to pages the site serves', () => {
    for (const page of KEYWORD_LANDING_PAGES) {
      const links = internalLinks(page);
      for (const other of KEYWORD_LANDING_PATHS.filter(path => path !== page.path)) {
        expect(links, `${page.path} links to ${other}`).toContain(other);
      }
      expect(links.some(href => href.startsWith('/learn/') || href.startsWith('/docs/')), page.path).toBe(true);
      expect(links, page.path).not.toContain(page.path);
      for (const href of links) {
        const pathname = href.split('#')[0];
        // App routes, server profiles (served with a trailing slash) and the standalone /ci page.
        expect(isKnownAppPath(pathname) || /^\/servers\/[^/]+\/$/.test(pathname) || pathname === CI_PATH, href).toBe(true);
      }
    }
    expect(internalLinks(getKeywordLandingPage('/mcp-test-server')!)).toEqual(expect.arrayContaining([
      '/learn/convert-local-stdio-mcp-server-to-remote',
      '/ci',
      '/learn/test-remote-mcp-server-in-ci',
    ]));
    expect(internalLinks(getKeywordLandingPage('/mcp-inspector-online')!)).toContain('/learn/mcptest-vs-mcp-inspector');
    expect(internalLinks(getKeywordLandingPage('/mcp-playground')!)).toContain('/catalog');
  });

  it('are linked from the sidebar footer and the home page copy', () => {
    expect(LANDING_PAGE_NAVIGATION.map(link => link.href)).toEqual(KEYWORD_LANDING_PATHS);
    const homeLinks = [...LANDING_STEPS.map(step => step.description), ...LANDING_FAQ.map(item => item.answer)]
      .flatMap(value => parseLandingText(value).map(part => part.href?.split('#')[0]));
    for (const path of KEYWORD_LANDING_PATHS) expect(homeLinks, path).toContain(path);
  });

  it('emit FAQPage JSON-LD with exactly the visible questions and plain-text answers', () => {
    for (const page of KEYWORD_LANDING_PAGES) {
      const data = getKeywordLandingFaqStructuredData(page) as {
        '@type': string;
        mainEntity: { name: string; acceptedAnswer: { text: string } }[];
      };
      expect(data['@type']).toBe('FAQPage');
      expect(data.mainEntity.map(entry => entry.name)).toEqual(page.faq.map(item => item.question));
      expect(data.mainEntity.map(entry => entry.acceptedAnswer.text)).toEqual(page.faq.map(item => landingPlainText(item.answer)));
      for (const entry of data.mainEntity) expect(entry.acceptedAnswer.text).not.toMatch(/\]\(/);
      expect(page.faq.length, page.path).toBeGreaterThanOrEqual(3);
    }
  });
});
