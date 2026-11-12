/**
 * Machine-readable build outputs: per-article raw Markdown files, the
 * site-wide llms.txt index (https://llmstxt.org/) and the guides RSS feed.
 */
const {
  SITE_NAME,
  SITE_URL,
  buildTrackNavigation,
  getArticleBodyMarkdown,
  getArticleCanonicalUrl,
  getTrack,
} = require('../../src/content/contentModel.ts');

const FEED_PATH = '/learn/feed.xml';
const FEED_URL = `${SITE_URL}${FEED_PATH}`;
const FEED_TITLE = `${SITE_NAME} guides`;

const SITE_DESCRIPTION =
  'Browser-based inspector, playground, evaluator, and public catalog for remote Model Context Protocol (MCP) servers.';

const SITE_SUMMARY =
  'mcptest.io connects to any remote MCP endpoint, negotiates the stateless 2026 and stateful 2025 protocol eras, ' +
  'exercises tools, resources, and prompts with raw JSON-RPC logs, and produces shareable server reports. ' +
  'The guides below are plain Markdown; append .md to any article URL for the raw source.';

const TOOL_LINKS = [
  { title: 'Playground', url: `${SITE_URL}/`, note: 'Connect to a remote MCP server and inspect its tools, resources, and prompts live.' },
  { title: 'Server catalog', url: `${SITE_URL}/catalog`, note: 'Validated public remote MCP servers with transport, authentication, and protocol badges.' },
  { title: 'Server report', url: `${SITE_URL}/report`, note: 'Evaluate an endpoint and share a redacted compatibility report.' },
  { title: 'Guides feed', url: FEED_URL, note: 'RSS 2.0 feed of every guide above, most recently reviewed first.' },
];

/** Raw Markdown for one article, with a title line and canonical URL header. */
function renderArticleMarkdown(article) {
  const lines = [
    `# ${article.title}`,
    '',
    `Canonical URL: ${getArticleCanonicalUrl(article)}`,
    '',
    getArticleBodyMarkdown(article),
  ];
  if (article.sourceLinks.length) {
    lines.push('', '## Sources', '', ...article.sourceLinks.map(link => `- [${link.title}](${link.url})`));
  }
  return `${lines.join('\n')}\n`;
}

/** Output file path (relative to dist) for an article's raw Markdown. */
function articleMarkdownPath(article) {
  return `${article.path}.md`;
}

/** llms.txt: site name, description, one section per track, plus tool links. */
function renderLlmsTxt(articles) {
  const tracks = buildTrackNavigation(articles);
  const byPath = new Map(articles.map(article => [article.path, article]));
  const lines = [`# ${SITE_NAME}`, '', `> ${SITE_DESCRIPTION}`, '', SITE_SUMMARY, ''];

  for (const track of tracks) {
    lines.push(`## ${track.label}`, '', track.description, '');
    for (const item of track.items) {
      const article = byPath.get(item.path);
      lines.push(`- [${item.title}](${getArticleCanonicalUrl(article)}): ${item.summary}`);
    }
    lines.push('');
  }

  lines.push('## Tools', '');
  for (const link of TOOL_LINKS) {
    lines.push(`- [${link.title}](${link.url}): ${link.note}`);
  }
  lines.push('');
  return lines.join('\n');
}

function escapeXml(value) {
  return String(value)
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&apos;');
}

/** RFC 822 date for a `YYYY-MM-DD` review date, at midnight UTC. */
function rssDate(reviewDate) {
  return new Date(`${reviewDate}T00:00:00Z`).toUTCString();
}

/** Guides newest review first; title then path break ties so the feed is stable. */
function sortArticlesForFeed(articles) {
  return [...articles].sort((left, right) => (
    right.lastReviewed.localeCompare(left.lastReviewed)
    || left.title.localeCompare(right.title, 'en-US')
    || left.path.localeCompare(right.path)
  ));
}

/**
 * RSS 2.0 feed of every guide with an Atom self link. The channel date is the
 * newest review date rather than the build time, so rebuilding unchanged
 * content produces an identical feed.
 */
function renderLearnFeed(articles, learnIndex) {
  const sorted = sortArticlesForFeed(articles);
  const lines = [
    '<?xml version="1.0" encoding="UTF-8"?>',
    '<rss version="2.0" xmlns:atom="http://www.w3.org/2005/Atom">',
    '  <channel>',
    `    <title>${escapeXml(FEED_TITLE)}</title>`,
    `    <link>${escapeXml(`${SITE_URL}/learn`)}</link>`,
    `    <description>${escapeXml(learnIndex.description)}</description>`,
    '    <language>en</language>',
    `    <atom:link href="${escapeXml(FEED_URL)}" rel="self" type="application/rss+xml" />`,
    ...(sorted.length ? [`    <lastBuildDate>${rssDate(sorted[0].lastReviewed)}</lastBuildDate>`] : []),
  ];
  for (const article of sorted) {
    const url = getArticleCanonicalUrl(article);
    const track = getTrack(article.track);
    lines.push(
      '    <item>',
      `      <title>${escapeXml(article.title)}</title>`,
      `      <link>${escapeXml(url)}</link>`,
      `      <guid isPermaLink="true">${escapeXml(url)}</guid>`,
      `      <description>${escapeXml(article.summary)}</description>`,
      `      <pubDate>${rssDate(article.lastReviewed)}</pubDate>`,
      ...(track ? [`      <category>${escapeXml(track.label)}</category>`] : []),
      '    </item>'
    );
  }
  lines.push('  </channel>', '</rss>', '');
  return lines.join('\n');
}

module.exports = {
  FEED_PATH,
  FEED_TITLE,
  FEED_URL,
  articleMarkdownPath,
  renderArticleMarkdown,
  renderLearnFeed,
  renderLlmsTxt,
  SITE_DESCRIPTION,
};
