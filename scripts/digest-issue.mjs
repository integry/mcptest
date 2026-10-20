#!/usr/bin/env node
// Renders the GitHub issue that asks the agent to write the next monthly
// "What changed in MCP" digest. Called by .github/workflows/monthly-digest.yml.
//
//   node scripts/digest-issue.mjs [--month YYYY-MM] [--output body.md]
//
// Without --month the previous calendar month (UTC) is used. The title, slug and
// a skip flag are written to $GITHUB_OUTPUT when it is set.
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const MONTH_NAMES = [
  'January', 'February', 'March', 'April', 'May', 'June',
  'July', 'August', 'September', 'October', 'November', 'December',
];
const DIGEST_FILE = /^mcp-changes-(\d{4})-(\d{2})\.md$/;
// docs/monthly-digest.md reserves 60 to 99 of the reference track for digests.
export const FIRST_DIGEST_ORDER = 60;
export const LAST_DIGEST_ORDER = 99;
const WINDOW_DAY = 20;

const pad = (value) => String(value).padStart(2, '0');
const isoDate = ({ year, month }, day) => `${year}-${pad(month)}-${pad(day)}`;
const monthIndex = ({ year, month }) => year * 12 + (month - 1);
const fromIndex = (index) => ({ year: Math.floor(index / 12), month: (index % 12) + 1 });

export const formatMonth = ({ year, month }) => `${year}-${pad(month)}`;

export function parseMonth(value) {
  const match = /^(\d{4})-(\d{2})$/.exec(String(value ?? '').trim());
  if (!match) throw new Error(`Month must be YYYY-MM, got "${value}"`);
  const year = Number(match[1]);
  const month = Number(match[2]);
  if (month < 1 || month > 12) throw new Error(`Month must be between 01 and 12, got "${value}"`);
  return { year, month };
}

/** The calendar month before the one containing `now`, in UTC. */
export function previousMonth(now) {
  return fromIndex(now.getUTCFullYear() * 12 + now.getUTCMonth() - 1);
}

/** Window of the digest published in `target`: the 20th of the month before to the 20th of `target`, inclusive. */
export function digestWindow(target) {
  return {
    start: isoDate(fromIndex(monthIndex(target) - 1), WINDOW_DAY),
    end: isoDate(target, WINDOW_DAY),
  };
}

export const digestSlug = (target) => `mcp-changes-${formatMonth(target)}`;
export const digestTitle = (target) => `What changed in MCP, ${MONTH_NAMES[target.month - 1]} ${target.year}`;
export const issueTitle = (target) => `Monthly digest: ${digestTitle(target)}`;

const frontmatterField = (source, field) => {
  const block = /^﻿?---\r?\n([\s\S]*?)\r?\n---/.exec(source)?.[1] ?? '';
  const line = block.split(/\r?\n/).find((entry) => entry.startsWith(`${field}:`));
  return line ? line.slice(field.length + 1).trim().replace(/^["']|["']$/g, '') : undefined;
};

/** Reads every article's slug, track and order; digests also get their month. */
export function readArticles(articlesDir) {
  return fs.readdirSync(articlesDir)
    .filter((name) => name.endsWith('.md'))
    .sort()
    .map((name) => {
      const source = fs.readFileSync(path.join(articlesDir, name), 'utf8');
      const digest = DIGEST_FILE.exec(name);
      return {
        slug: name.replace(/\.md$/, ''),
        track: frontmatterField(source, 'track'),
        order: Number(frontmatterField(source, 'order')),
        month: digest ? { year: Number(digest[1]), month: Number(digest[2]) } : undefined,
      };
    });
}

/**
 * Order for the digest of `target`. Digests are numbered by month from the latest
 * existing one (October 2026 is 60, November 2026 is 61, ...), so the order stays
 * ascending even while an earlier month's issue is still open and its article is
 * not merged yet.
 */
export function nextDigestOrder(articles, target) {
  const digests = articles.filter((article) => article.month).sort((a, b) => monthIndex(a.month) - monthIndex(b.month));
  const latest = digests.at(-1);
  if (latest && monthIndex(target) <= monthIndex(latest.month)) {
    throw new Error(`${digestSlug(target)} is not after the latest digest ${latest.slug}; digest orders must stay ascending`);
  }
  if (latest && !Number.isInteger(latest.order)) throw new Error(`${latest.slug} has no integer order`);
  const order = latest ? latest.order + monthIndex(target) - monthIndex(latest.month) : FIRST_DIGEST_ORDER;
  if (order < FIRST_DIGEST_ORDER || order > LAST_DIGEST_ORDER) {
    throw new Error(`Order ${order} for ${digestSlug(target)} is outside the digest range ${FIRST_DIGEST_ORDER}-${LAST_DIGEST_ORDER}`);
  }
  const taken = articles.find((article) => article.track === 'reference' && article.order === order);
  if (taken) throw new Error(`Order ${order} is already used by ${taken.slug} in the reference track`);
  return { order, previousSlug: latest?.slug };
}

/** The brief from docs/monthly-digest.md without the automation notes, headings nested one level down. */
export function briefFromDocs(markdown) {
  let inFence = false;
  let skipping = false;
  const lines = [];
  for (const line of markdown.replace(/\r\n/g, '\n').split('\n')) {
    if (/^(```|~~~)/.test(line)) inFence = !inFence;
    if (!inFence && /^#{1,2} /.test(line)) skipping = /^## How it runs\s*$/.test(line);
    if (skipping) continue;
    lines.push(!inFence && /^#{1,5} /.test(line) ? `#${line}` : line);
  }
  return lines.join('\n').trim();
}

/** Replaces every `{{name}}` in the template; an unknown or unused placeholder is an error. */
export function fillTemplate(template, values) {
  const used = new Set();
  const body = template.replace(/\{\{\s*([a-z_]+)\s*\}\}/g, (_, name) => {
    if (!(name in values)) throw new Error(`Unknown placeholder {{${name}}} in the issue template`);
    used.add(name);
    return String(values[name]);
  });
  const unused = Object.keys(values).filter((name) => !used.has(name));
  if (unused.length) throw new Error(`Issue template does not use: ${unused.join(', ')}`);
  return body;
}

/**
 * Everything the workflow needs for one month. `skip` is set when the article
 * already exists, for example the hand-written October 2026 digest.
 */
export function renderDigestIssue({ target, now, articles, template, brief }) {
  const window = digestWindow(target);
  const slug = digestSlug(target);
  const title = issueTitle(target);
  if (window.end > now.toISOString().slice(0, 10)) {
    throw new Error(`The ${formatMonth(target)} window ends on ${window.end} and has not closed yet`);
  }
  if (articles.some((article) => article.slug === slug)) {
    return { title, slug, skip: `src/content/articles/${slug}.md already exists` };
  }
  const { order, previousSlug } = nextDigestOrder(articles, target);
  const body = fillTemplate(template, {
    article_title: digestTitle(target),
    month_name: `${MONTH_NAMES[target.month - 1]} ${target.year}`,
    month_short: `${MONTH_NAMES[target.month - 1].slice(0, 3)} ${target.year}`,
    slug,
    order,
    window_start: window.start,
    window_end: window.end,
    previous_slug: previousSlug ?? 'mcp-protocol-versions-explained',
    brief,
  });
  return { title, slug, order, window, body };
}

function parseArgs(argv) {
  const args = {};
  for (let i = 0; i < argv.length; i += 1) {
    const flag = argv[i];
    if (!flag.startsWith('--')) throw new Error(`Unexpected argument: ${flag}`);
    const value = argv[i + 1];
    if (value === undefined || value.startsWith('--')) throw new Error(`Missing value for ${flag}`);
    args[flag.slice(2)] = value;
    i += 1;
  }
  return args;
}

function main() {
  const args = parseArgs(process.argv.slice(2));
  const now = args.now ? new Date(args.now) : new Date();
  if (Number.isNaN(now.getTime())) throw new Error(`Invalid --now: ${args.now}`);
  const target = args.month ? parseMonth(args.month) : previousMonth(now);
  const result = renderDigestIssue({
    target,
    now,
    articles: readArticles(path.resolve(ROOT, args.articles ?? 'src/content/articles')),
    template: fs.readFileSync(path.resolve(ROOT, args.template ?? '.github/digest-issue-template.md'), 'utf8'),
    brief: briefFromDocs(fs.readFileSync(path.resolve(ROOT, args.brief ?? 'docs/monthly-digest.md'), 'utf8')),
  });

  if (result.skip) {
    console.log(`Skipping ${result.slug}: ${result.skip}`);
  } else if (args.output) {
    fs.writeFileSync(args.output, result.body);
    console.log(`Wrote "${result.title}" (order ${result.order}, ${result.window.start} to ${result.window.end}) to ${args.output}`);
  } else {
    process.stdout.write(result.body);
  }

  if (process.env.GITHUB_OUTPUT) {
    fs.appendFileSync(
      process.env.GITHUB_OUTPUT,
      `title=${result.title}\nslug=${result.slug}\nskip=${result.skip ? 'true' : 'false'}\n`
    );
  }
}

if (process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  try {
    main();
  } catch (error) {
    console.error(`digest-issue: ${error.message}`);
    process.exitCode = 1;
  }
}
