import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { execFileSync } from 'node:child_process';
import { describe, expect, it } from 'vitest';
import {
  briefFromDocs,
  digestWindow,
  fillTemplate,
  issueTitle,
  nextDigestOrder,
  parseMonth,
  previousMonth,
  readArticles,
  renderDigestIssue,
} from './digest-issue.mjs';

const template = fs.readFileSync('.github/digest-issue-template.md', 'utf8');
const docs = fs.readFileSync('docs/monthly-digest.md', 'utf8');
const articles = readArticles('src/content/articles');
const digest = (year, month, order) => ({ slug: `mcp-changes-${year}-${String(month).padStart(2, '0')}`, track: 'reference', order, month: { year, month } });
const render = (month, now, list = articles) => renderDigestIssue({
  target: parseMonth(month),
  now: new Date(now),
  articles: list,
  template,
  brief: briefFromDocs(docs),
});

describe('digest window', () => {
  it('runs from the 20th of the previous month to the 20th of the target month', () => {
    expect(digestWindow({ year: 2026, month: 11 })).toEqual({ start: '2026-10-20', end: '2026-11-20' });
  });

  it('crosses year boundaries', () => {
    expect(digestWindow({ year: 2027, month: 1 })).toEqual({ start: '2026-12-20', end: '2027-01-20' });
    expect(digestWindow({ year: 2026, month: 12 })).toEqual({ start: '2026-11-20', end: '2026-12-20' });
  });

  it('defaults to the previous calendar month in UTC, including January', () => {
    expect(previousMonth(new Date('2026-12-02T06:00:00Z'))).toEqual({ year: 2026, month: 11 });
    expect(previousMonth(new Date('2027-01-02T06:00:00Z'))).toEqual({ year: 2026, month: 12 });
    expect(previousMonth(new Date('2027-03-01T00:30:00+02:00'))).toEqual({ year: 2027, month: 1 });
  });

  it('rejects malformed months', () => {
    expect(() => parseMonth('2026-13')).toThrow(/between 01 and 12/);
    expect(() => parseMonth('2026-1')).toThrow(/YYYY-MM/);
    expect(parseMonth(' 2027-02 ')).toEqual({ year: 2027, month: 2 });
  });
});

describe('digest order', () => {
  it('reads the October 2026 digest from the articles', () => {
    expect(articles.find((article) => article.slug === 'mcp-changes-2026-10')).toMatchObject({ track: 'reference', order: 60, month: { year: 2026, month: 10 } });
    expect(nextDigestOrder(articles, { year: 2026, month: 11 })).toEqual({ order: 61, previousSlug: 'mcp-changes-2026-10' });
  });

  it('counts months from the latest digest so pending issues keep their order, across years', () => {
    const list = [digest(2026, 10, 60), digest(2026, 11, 61)];
    expect(nextDigestOrder(list, { year: 2026, month: 12 }).order).toBe(62);
    expect(nextDigestOrder(list, { year: 2027, month: 1 }).order).toBe(63);
    expect(nextDigestOrder([digest(2026, 10, 60)], { year: 2027, month: 2 })).toEqual({ order: 64, previousSlug: 'mcp-changes-2026-10' });
  });

  it('uses the latest digest by month, not by file order', () => {
    const list = [digest(2027, 1, 63), digest(2026, 12, 62)];
    expect(nextDigestOrder(list, { year: 2027, month: 2 })).toEqual({ order: 64, previousSlug: 'mcp-changes-2027-01' });
  });

  it('starts at 60 without digests', () => {
    expect(nextDigestOrder([{ slug: 'troubleshooting', track: 'reference', order: 1 }], { year: 2026, month: 10 })).toEqual({ order: 60, previousSlug: undefined });
  });

  it('refuses months that would break the ascending order or the reserved range', () => {
    const list = [digest(2026, 10, 60), digest(2026, 12, 62)];
    expect(() => nextDigestOrder(list, { year: 2026, month: 11 })).toThrow(/not after the latest digest mcp-changes-2026-12/);
    expect(() => nextDigestOrder([digest(2029, 12, 99)], { year: 2030, month: 1 })).toThrow(/outside the digest range/);
    const clash = [digest(2026, 10, 60), { slug: 'other', track: 'reference', order: 61 }];
    expect(() => nextDigestOrder(clash, { year: 2026, month: 11 })).toThrow(/already used by other/);
  });
});

describe('issue body', () => {
  it('fills the template for November 2026 and copies the brief', () => {
    const result = render('2026-11', '2026-12-02T06:00:00Z');
    expect(result.title).toBe('Monthly digest: What changed in MCP, November 2026');
    expect(result.slug).toBe('mcp-changes-2026-11');
    expect(result.body).not.toMatch(/\{\{/);
    expect(result.body).toContain('| Window | 2026-10-20 to 2026-11-20, inclusive |');
    expect(result.body).toContain('| `order` | `61` ');
    expect(result.body).toContain('`src/content/articles/mcp-changes-2026-11.md`');
    expect(result.body).toContain('`"MCP changes, Nov 2026"`');
    expect(result.body).toContain('Start with `mcp-changes-2026-10`');
    expect(result.body).toContain('### Sources to check');
    expect(result.body).toContain('Every claim has an inline link and an entry in `sourceLinks`.');
    expect(result.body).not.toContain('How it runs');
  });

  it('titles January digests with the new year', () => {
    expect(issueTitle({ year: 2027, month: 1 })).toBe('Monthly digest: What changed in MCP, January 2027');
    expect(render('2027-01', '2027-02-02T06:00:00Z').body).toContain('| Window | 2026-12-20 to 2027-01-20, inclusive |');
  });

  it('skips a month whose article already exists', () => {
    expect(render('2026-10', '2026-11-02T06:00:00Z')).toEqual({
      title: 'Monthly digest: What changed in MCP, October 2026',
      slug: 'mcp-changes-2026-10',
      skip: 'src/content/articles/mcp-changes-2026-10.md already exists',
    });
  });

  it('refuses a month whose window has not closed', () => {
    expect(() => render('2026-11', '2026-11-19T23:00:00Z')).toThrow(/has not closed yet/);
    expect(render('2026-11', '2026-11-20T00:00:00Z').order).toBe(61);
  });
});

describe('brief and template helpers', () => {
  it('nests headings one level down outside code fences and drops "How it runs"', () => {
    const brief = briefFromDocs('# Title\n\nIntro\n\n## A\n\n```yaml\n# comment\n```\n\n## How it runs\n\nAutomation\n\n## B\n\nText\n');
    expect(brief).toBe('## Title\n\nIntro\n\n### A\n\n```yaml\n# comment\n```\n\n### B\n\nText');
  });

  it('rejects unknown and unused placeholders and keeps $ sequences literal', () => {
    expect(fillTemplate('{{a}} costs $& {{ b }}', { a: 'x', b: '$1' })).toBe('x costs $& $1');
    expect(() => fillTemplate('{{a}} {{c}}', { a: 1 })).toThrow(/Unknown placeholder \{\{c\}\}/);
    expect(() => fillTemplate('{{a}}', { a: 1, b: 2 })).toThrow(/does not use: b/);
  });
});

describe('command line', () => {
  it('writes the body and GitHub outputs', () => {
    const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'digest-issue-'));
    const output = path.join(dir, 'body.md');
    const githubOutput = path.join(dir, 'github-output');
    execFileSync(process.execPath, ['scripts/digest-issue.mjs', '--now', '2026-12-02T06:00:00Z', '--output', output], {
      env: { ...process.env, GITHUB_OUTPUT: githubOutput },
    });
    expect(fs.readFileSync(output, 'utf8')).toBe(render('2026-11', '2026-12-02T06:00:00Z').body);
    expect(fs.readFileSync(githubOutput, 'utf8')).toBe(
      'title=Monthly digest: What changed in MCP, November 2026\nslug=mcp-changes-2026-11\nskip=false\n'
    );
  });

  it('exits non-zero with a message on a bad month', () => {
    expect(() => execFileSync(process.execPath, ['scripts/digest-issue.mjs', '--month', '2026-1'], { stdio: 'pipe' })).toThrow(/YYYY-MM/);
  });
});
