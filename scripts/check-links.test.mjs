// @vitest-environment node
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { afterAll, describe, expect, it } from 'vitest';
import {
  checkExternalLinks,
  checkSite,
  loadSite,
  parseHtml,
  parseMarkdown,
  parseWorkerRoutes,
} from './check-links.mjs';

const temporaryDirectories = [];
afterAll(() => {
  for (const directory of temporaryDirectories) fs.rmSync(directory, { recursive: true, force: true });
});

const page = (canonicalPath, body = '') => [
  '<!doctype html><html><head>',
  `<link rel="canonical" href="https://mcptest.io${canonicalPath === '/' ? '' : canonicalPath}" />`,
  '<link rel="preconnect" href="https://fonts.example" />',
  '<script type="module" src="/assets/app.js"></script>',
  '</head><body>',
  body,
  '</body></html>',
].join('\n');

/** A minimal dist/ with the shapes the generator writes. */
function writeSite(extraFiles = {}) {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'check-links-'));
  temporaryDirectories.push(root);
  const files = {
    'index.html': page('/', '<a href="/catalog">Catalog</a><a href="/learn/guide#setup">Setup</a>'),
    'catalog.html': page('/catalog', '<a href="/servers/alpha/">Alpha</a><a href="https://example.com/docs">Docs</a>'),
    'servers/alpha/index.html': page('/servers/alpha/', '<a href="/server/https://alpha.example/mcp/mcp">Test</a><img src="/server-logos/alpha.svg" alt="">'),
    'learn/guide/index.html': page('/learn/guide', '<h2 id="setup">Setup</h2><a href="#setup">here</a><a href="/badge/server/alpha.svg">badge</a>'),
    'learn/guide.md': '# Guide\n\nSee [the catalog](/catalog) and [setup](/learn/guide#setup).\n\n```\n[not a link](/nowhere)\n```\n',
    'learn/index.html': page('/learn'),
    'llms.txt': '- [Guide](https://mcptest.io/learn/guide)\n',
    'assets/app.js': '',
    'server-logos/alpha.svg': '<svg/>',
    '404.html': '<html><head><meta name="robots" content="noindex"></head><body><a href="/">Home</a></body></html>',
    'routes.txt': '/\n/catalog\n/learn\n/report\n/server/*\n/space/*\n',
    ...extraFiles,
  };
  for (const [file, contents] of Object.entries(files)) {
    fs.mkdirSync(path.dirname(path.join(root, file)), { recursive: true });
    fs.writeFileSync(path.join(root, file), contents);
  }
  return root;
}

const check = root => checkSite(loadSite(root));

describe('parsing', () => {
  it('reads hrefs, srcs, ids and social images, but not scripts, comments or preconnect hints', () => {
    const { links, ids, meta } = parseHtml([
      '<head><link rel="canonical" href="https://mcptest.io/x" /><meta property="og:url" content="https://mcptest.io/x">',
      '<meta property="og:image" content="https://mcptest.io/og/x.png"><link rel="preconnect" href="https://cdn.example"></head>',
      '<!-- <a href="/commented-out"> -->',
      '<script type="application/ld+json">{"url":"<a href=\\"/in-json\\">"}</script>',
      '<pre><code>&lt;a href="/escaped"&gt;</code></pre>',
      '<h2 id="intro">Intro</h2><a name="legacy"></a><a href="/a?x=1&amp;y=2">A</a><img src=\'/b.png\'>',
    ].join('\n'));
    expect(links.map(link => link.value)).toEqual(['https://mcptest.io/x', 'https://mcptest.io/og/x.png', '/a?x=1&y=2', '/b.png']);
    expect([...ids]).toEqual(['intro', 'legacy']);
    expect(meta).toEqual({ canonical: ['https://mcptest.io/x'], ogUrl: ['https://mcptest.io/x'], robots: [] });
  });

  it('reads Markdown links, references and bare URLs outside code', () => {
    const { links } = parseMarkdown([
      'A [link](/a "title") and ![img](/b.png), <https://example.com/auto>, and https://example.com/bare.',
      '[ref]: /c',
      'Inline `[code](/not-a-link)` stays out.',
      '~~~',
      '[fenced](/not-either)',
      '~~~',
    ].join('\n'));
    expect(links.map(link => link.value).sort()).toEqual(['/a', '/b.png', '/c', 'https://example.com/auto', 'https://example.com/bare']);
  });

  it('reads site routes from wrangler.toml', () => {
    const routes = parseWorkerRoutes('routes = [\n  { pattern = "mcptest.io/badge/server/*" },\n  { pattern = "mcptest.io/r" },\n  { pattern = "other.io/x" }\n]');
    expect(routes).toEqual({ exact: new Set(['/r']), prefixes: ['/badge/server/'] });
  });
});

describe('checkSite', () => {
  it('passes a clean site and lists external links without fetching them', () => {
    const result = check(writeSite());
    expect(result.errors).toEqual([]);
    expect([...result.external.keys()]).toEqual(['https://example.com/docs']);
  });

  it.each([
    ['a broken link', '<a href="/missing-page">x</a>', 'broken link: no file or app route'],
    ['a missing anchor', '<a href="/learn/guide#nope">x</a>', 'missing anchor #nope in learn/guide/index.html'],
    ['a missing same-page anchor', '<a href="#nope">x</a>', 'missing anchor #nope in catalog.html'],
    ['a trailing slash on a page without one', '<a href="/learn/guide/">x</a>', 'non-canonical variant of /learn/guide'],
    ['a missing trailing slash on a page with one', '<a href="/servers/alpha">x</a>', 'non-canonical variant of /servers/alpha/'],
    ['a trailing slash on an app route', '<a href="/report/">x</a>', 'non-canonical variant: trailing slash (use /report)'],
    ['an .html spelling', '<a href="/catalog.html">x</a>', 'non-canonical variant of /catalog'],
    ['an index.html spelling', '<a href="/index.html">x</a>', 'non-canonical variant of /'],
    ['http://', '<a href="http://mcptest.io/catalog">x</a>', 'non-canonical variant: http:// (use https://mcptest.io/catalog)'],
    ['www', '<a href="https://www.mcptest.io/catalog">x</a>', 'non-canonical variant: www (use https://mcptest.io/catalog)'],
    ['a missing image', '<img src="/server-logos/missing.svg">', 'broken link: no file or app route'],
    ['an anchor on an app route', '<a href="/report#x">x</a>', 'cannot verify anchor #x: /report is an app route with no prerendered page'],
  ])('fails on %s', (_label, body, reason) => {
    const result = check(writeSite({ 'catalog.html': page('/catalog', body) }));
    expect(result.errors).toEqual([{ file: 'catalog.html', link: expect.any(String), reason }]);
  });

  it('checks the raw Markdown exports and llms.txt', () => {
    const result = check(writeSite({
      'learn/guide.md': '# Guide\n\n[gone](/learn/gone) and [anchor](#nope)\n',
      'llms.txt': '- [Guide](https://mcptest.io/learn/guide/)\n',
    }));
    expect(result.errors).toEqual([
      { file: 'learn/guide.md', link: '/learn/gone', reason: 'broken link: no file or app route' },
      { file: 'learn/guide.md', link: '#nope', reason: 'missing anchor #nope in learn/guide/index.html' },
      { file: 'llms.txt', link: 'https://mcptest.io/learn/guide/', reason: 'non-canonical variant of /learn/guide' },
    ]);
  });

  it('requires dist/routes.txt', () => {
    const root = writeSite();
    fs.rmSync(path.join(root, 'routes.txt'));
    expect(() => loadSite(root)).toThrow(/routes\.txt is missing/);
  });
});

describe('checkExternalLinks', () => {
  it('limits concurrency, falls back to GET, and separates broken from unverified', async () => {
    let inFlight = 0;
    let peak = 0;
    const calls = [];
    const fetchImpl = async (url, { method }) => {
      calls.push(`${method} ${url}`);
      inFlight += 1;
      peak = Math.max(peak, inFlight);
      await new Promise(resolve => setTimeout(resolve, 5));
      inFlight -= 1;
      if (url.endsWith('/timeout')) throw Object.assign(new Error('aborted'), { name: 'TimeoutError' });
      const status = { '/ok': 200, '/no-head': method === 'HEAD' ? 405 : 200, '/gone': 404, '/forbidden': 403 }[new URL(url).pathname];
      return { status, body: null };
    };
    const urls = ['/ok', '/no-head', '/gone', '/forbidden', '/timeout'].map(pathname => `https://example.com${pathname}`);
    const results = await checkExternalLinks(urls, { concurrency: 2, timeoutMs: 50, fetchImpl });

    expect(peak).toBe(2);
    expect(calls).toContain('GET https://example.com/no-head');
    expect(Object.fromEntries(results.map(result => [new URL(result.url).pathname, result.verdict]))).toEqual({
      '/ok': 'ok', '/no-head': 'ok', '/gone': 'broken', '/forbidden': 'unverified', '/timeout': 'broken',
    });
    expect(results.find(result => result.url.endsWith('/timeout')).error).toBe('timed out after 50 ms');
  });
});
