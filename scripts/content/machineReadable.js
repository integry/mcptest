/**
 * Machine-readable build outputs: per-article raw Markdown files and the
 * site-wide llms.txt index (https://llmstxt.org/).
 */
const {
  SITE_NAME,
  SITE_URL,
  buildTrackNavigation,
  getArticleBodyMarkdown,
  getArticleCanonicalUrl,
} = require('../../src/content/contentModel.ts');

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

module.exports = { articleMarkdownPath, renderArticleMarkdown, renderLlmsTxt, SITE_DESCRIPTION };
