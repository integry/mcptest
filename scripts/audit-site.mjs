/**
 * Sitemap, robots and canonical audit of the built site (issue #407).
 * scripts/audit-site.test.mjs runs it against dist/ after the build.
 *
 * Every prerendered page (an HTML file in dist/ other than 404.html) must:
 *   - have exactly one <link rel="canonical"> and one og:url, and they agree;
 *   - canonicalise to the https://mcptest.io URL the host serves it at;
 *   - be in the sitemap exactly once under that URL, unless it is noindex;
 * and robots.txt must reference the sitemap and block no sitemap URL.
 */

import fs from 'node:fs';
import path from 'node:path';
import { SITE_ORIGIN, decodeEntities, loadSite, resolveFile } from './check-links.mjs';

/** <loc> and optional <lastmod> of each <url> in a sitemap. */
export function parseSitemap(xml) {
  return [...xml.matchAll(/<url>([\s\S]*?)<\/url>/g)].map(([, body]) => ({
    loc: decodeEntities(body.match(/<loc>([^<]*)<\/loc>/)?.[1]?.trim() ?? ''),
    lastmod: body.match(/<lastmod>([^<]*)<\/lastmod>/)?.[1]?.trim(),
  }));
}

/**
 * robots.txt groups: the user agents each group applies to and its Allow and
 * Disallow rules, plus every Sitemap line.
 */
export function parseRobots(text) {
  const groups = [];
  const sitemaps = [];
  let current = null;
  let lastWasAgent = false;
  for (const raw of text.split(/\r?\n/)) {
    const line = raw.replace(/#.*/, '').trim();
    const match = line.match(/^([A-Za-z-]+)\s*:\s*(.*)$/);
    if (!match) continue;
    const field = match[1].toLowerCase();
    const value = match[2].trim();
    if (field === 'sitemap') {
      sitemaps.push(value);
      continue;
    }
    if (field === 'user-agent') {
      if (!lastWasAgent) groups.push(current = { agents: [], rules: [] });
      current.agents.push(value.toLowerCase());
      lastWasAgent = true;
      continue;
    }
    lastWasAgent = false;
    if (current && (field === 'allow' || field === 'disallow')) current.rules.push({ allow: field === 'allow', pattern: value });
  }
  return { groups, sitemaps };
}

function robotsPatternMatches(pattern, pathname) {
  if (!pattern) return false;
  const anchored = pattern.endsWith('$');
  const source = (anchored ? pattern.slice(0, -1) : pattern)
    .split('*')
    .map(part => part.replace(/[.+?^${}()|[\]\\]/g, '\\$&'))
    .join('.*');
  return new RegExp(`^${source}${anchored ? '$' : ''}`).test(pathname);
}

/**
 * Whether `pathname` is blocked for any crawler, by RFC 9309 precedence: the
 * longest matching rule wins, and Allow wins a tie. An empty Disallow allows.
 */
export function isBlockedByRobots(robots, pathname) {
  return robots.groups.some(group => {
    const matching = group.rules
      .filter(rule => robotsPatternMatches(rule.pattern, pathname))
      .sort((a, b) => b.pattern.length - a.pattern.length || Number(b.allow) - Number(a.allow));
    return matching.length > 0 && !matching[0].allow;
  });
}

const isNoindex = page => page.meta.robots.some(value => /\bnoindex\b/i.test(value));

/**
 * Audits dist/. Returns a list of problems (empty when the site is clean) and
 * the parsed sitemap for further checks.
 */
export function auditSite(distDir) {
  const site = loadSite(distDir);
  const problems = [];
  const sitemapPath = path.join(site.root, 'sitemap.xml');
  const robotsPath = path.join(site.root, 'robots.txt');
  const sitemap = fs.existsSync(sitemapPath) ? parseSitemap(fs.readFileSync(sitemapPath, 'utf8')) : [];
  if (!sitemap.length) problems.push('sitemap.xml is missing or empty');

  const sitemapCounts = new Map();
  for (const { loc } of sitemap) sitemapCounts.set(loc, (sitemapCounts.get(loc) ?? 0) + 1);
  for (const [loc, count] of sitemapCounts) {
    if (count > 1) problems.push(`sitemap lists ${loc} ${count} times`);
  }

  const pagesByCanonical = new Map();
  for (const [file, page] of site.pages) {
    if (file === '404.html') {
      if (!isNoindex(page)) problems.push('404.html is not noindex');
      if (page.meta.canonical.length) problems.push('404.html has a canonical link');
      continue;
    }
    const { canonical, ogUrl } = page.meta;
    if (canonical.length !== 1) {
      problems.push(`${file}: ${canonical.length} canonical links`);
      continue;
    }
    if (ogUrl.length !== 1) problems.push(`${file}: ${ogUrl.length} og:url tags`);
    else if (ogUrl[0] !== canonical[0]) problems.push(`${file}: og:url ${ogUrl[0]} differs from canonical ${canonical[0]}`);

    let url;
    try {
      url = new URL(canonical[0]);
    } catch {
      problems.push(`${file}: canonical ${canonical[0]} is not an absolute URL`);
      continue;
    }
    if (url.origin !== SITE_ORIGIN || url.search || url.hash) {
      problems.push(`${file}: canonical ${canonical[0]} is not a bare ${SITE_ORIGIN} URL`);
    }
    // The canonical URL must be the one the host serves this file at.
    const served = resolveFile(site, url.pathname);
    if (served !== file) problems.push(`${file}: canonical ${canonical[0]} is served from ${served ?? 'no file'}`);
    if (pagesByCanonical.has(canonical[0])) {
      problems.push(`${file} and ${pagesByCanonical.get(canonical[0]).file} share the canonical ${canonical[0]}`);
    }
    pagesByCanonical.set(canonical[0], { file, page });

    const listed = sitemapCounts.get(canonical[0]) ?? 0;
    if (isNoindex(page) && listed) problems.push(`${file} is noindex but the sitemap lists ${canonical[0]}`);
    if (!isNoindex(page) && !listed) problems.push(`${file} (${canonical[0]}) is missing from the sitemap`);
  }

  for (const { loc, lastmod } of sitemap) {
    if (!pagesByCanonical.has(loc)) problems.push(`sitemap lists ${loc}, which is no prerendered page's canonical URL`);
    if (lastmod !== undefined && !/^\d{4}-\d{2}-\d{2}$/.test(lastmod)) problems.push(`sitemap lastmod ${lastmod} for ${loc} is not a YYYY-MM-DD date`);
  }

  if (!fs.existsSync(robotsPath)) {
    problems.push('robots.txt is missing');
  } else {
    const robots = parseRobots(fs.readFileSync(robotsPath, 'utf8'));
    if (!robots.sitemaps.includes(`${SITE_ORIGIN}/sitemap.xml`)) problems.push(`robots.txt does not reference ${SITE_ORIGIN}/sitemap.xml`);
    for (const { loc } of sitemap) {
      let pathname;
      try {
        pathname = new URL(loc).pathname;
      } catch {
        continue;
      }
      if (isBlockedByRobots(robots, pathname)) problems.push(`robots.txt blocks ${loc}`);
    }
  }

  return { problems, sitemap, pages: pagesByCanonical };
}
