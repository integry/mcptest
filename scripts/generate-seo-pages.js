#!/usr/bin/env node

const fs = require('fs');
const path = require('path');

const SITE_URL = 'https://mcptest.io';
const projectRoot = path.join(__dirname, '..');
const distRoot = path.join(projectRoot, 'dist');
const indexPath = path.join(distRoot, 'index.html');
const catalogPath = path.join(projectRoot, 'src', 'data', 'serverCatalog.json');

function escapeHtml(value) {
  return String(value)
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;');
}

function escapeXml(value) {
  return escapeHtml(value).replace(/'/g, '&apos;');
}

function serverPath(serverId) {
  return `/servers/${encodeURIComponent(serverId)}/`;
}

function transportLabel(transport) {
  if (transport === 'streamable-http') return 'Streamable HTTP';
  if (transport === 'legacy-sse') return 'Legacy HTTP+SSE';
  return 'MCP';
}

function truncate(value, maxLength = 158) {
  return value.length <= maxLength
    ? value
    : `${value.slice(0, maxLength - 1).trimEnd()}…`;
}

function replaceOrInsertHead(html, pattern, replacement) {
  if (pattern.test(html)) {
    return html.replace(pattern, replacement);
  }
  return html.replace('</head>', `    ${replacement}\n  </head>`);
}

function setPropertyMeta(html, property, content) {
  const pattern = new RegExp(`<meta\\s+[^>]*property=["']${property}["'][^>]*>`, 'i');
  return replaceOrInsertHead(
    html,
    pattern,
    `<meta property="${property}" content="${escapeHtml(content)}" />`
  );
}

function setNamedMeta(html, name, content) {
  const pattern = new RegExp(`<meta\\s+[^>]*name=["']${name}["'][^>]*>`, 'i');
  return replaceOrInsertHead(
    html,
    pattern,
    `<meta name="${name}" content="${escapeHtml(content)}" />`
  );
}

function renderServerFallback(server) {
  const homepageLink = server.homepageUrl
    ? `<a href="${escapeHtml(server.homepageUrl)}">Product documentation</a>`
    : '';
  const sourceLink = server.sourceUrl
    ? `<a href="${escapeHtml(server.sourceUrl)}">Source repository</a>`
    : '';
  const references = [homepageLink, sourceLink].filter(Boolean).join(' · ');

  return [
    `<article class="server-profile seo-server-fallback" data-server-id="${escapeHtml(server.id)}">`,
    '  <nav class="server-profile-breadcrumb" aria-label="Breadcrumb"><a href="/catalog">Server Catalog</a></nav>',
    '  <header class="server-profile-hero">',
    '    <div class="server-profile-identity"><div>',
    '      <div class="server-profile-eyebrow">MCP server report</div>',
    `      <h1>${escapeHtml(server.name)}</h1>`,
    `      <p>${escapeHtml(server.description)}</p>`,
    '    </div></div>',
    '  </header>',
    '  <section class="card server-profile-section"><div class="card-body">',
    '    <h2>Connection specification</h2>',
    '    <dl class="server-spec-list">',
    `      <div><dt>Remote endpoint</dt><dd><code>${escapeHtml(server.url)}</code></dd></div>`,
    `      <div><dt>MCP transport</dt><dd>${escapeHtml(transportLabel(server.transport))}</dd></div>`,
    `      <div><dt>Authentication</dt><dd>${server.requiresOAuth ? 'OAuth 2.1 authorization code flow with PKCE' : 'No authentication declared'}</dd></div>`,
    `      <div><dt>Category</dt><dd>${escapeHtml(server.category)}</dd></div>`,
    '    </dl>',
    `    <p>${references}</p>`,
    `    <p><a href="/catalog">Browse all MCP servers</a> · <a href="${escapeHtml(`/server/${server.url}`)}">Test this endpoint in the MCP Playground</a></p>`,
    '  </div></section>',
    '</article>',
  ].join('\n');
}

function renderServerHtml(indexHtml, server) {
  const canonicalUrl = `${SITE_URL}${serverPath(server.id)}`;
  const title = `${server.name} MCP Server Report | mcptest.io`;
  const description = truncate(
    `${server.name} MCP server connection report: ${transportLabel(server.transport)}, ${server.requiresOAuth ? 'OAuth 2.1' : 'no authentication declared'}, endpoint details, live-test status, and playground compatibility.`
  );
  const imageUrl = server.logoUrl
    ? (server.logoUrl.startsWith('http') ? server.logoUrl : `${SITE_URL}${server.logoUrl}`)
    : `${SITE_URL}/logo.png`;
  const structuredData = {
    '@context': 'https://schema.org',
    '@type': 'WebAPI',
    name: `${server.name} MCP Server`,
    description: server.description,
    url: canonicalUrl,
    endpointUrl: server.url,
    applicationCategory: server.category,
    keywords: server.tags.join(', '),
    documentation: server.homepageUrl || canonicalUrl,
    additionalProperty: [
      { '@type': 'PropertyValue', name: 'MCP transport', value: transportLabel(server.transport) },
      { '@type': 'PropertyValue', name: 'Authentication', value: server.requiresOAuth ? 'OAuth 2.1' : 'None declared' },
    ],
  };

  let html = indexHtml.replace(/<title>[^<]*<\/title>/i, `<title>${escapeHtml(title)}</title>`);
  html = setNamedMeta(html, 'description', description);
  html = setNamedMeta(html, 'twitter:card', 'summary');
  html = setNamedMeta(html, 'twitter:title', title);
  html = setNamedMeta(html, 'twitter:description', description);
  html = setPropertyMeta(html, 'og:title', title);
  html = setPropertyMeta(html, 'og:description', description);
  html = setPropertyMeta(html, 'og:url', canonicalUrl);
  html = setPropertyMeta(html, 'og:image', imageUrl);
  html = setPropertyMeta(html, 'og:type', 'website');
  html = replaceOrInsertHead(
    html,
    /<link\s+[^>]*rel=["']canonical["'][^>]*>/i,
    `<link rel="canonical" href="${escapeHtml(canonicalUrl)}" />`
  );

  const safeJson = JSON.stringify(structuredData).replace(/<\//g, '<\\/');
  html = html.replace(
    '</head>',
    `    <script id="server-structured-data" type="application/ld+json">${safeJson}</script>\n  </head>`
  );
  html = html.replace(
    '<div id="root"></div>',
    `<div id="root">\n${renderServerFallback(server)}\n    </div>`
  );

  return html;
}

function writeServerPages(indexHtml, servers) {
  for (const server of servers) {
    const outputDirectory = path.join(distRoot, 'servers', server.id);
    fs.mkdirSync(outputDirectory, { recursive: true });
    fs.writeFileSync(
      path.join(outputDirectory, 'index.html'),
      renderServerHtml(indexHtml, server),
      'utf8'
    );
  }
}

function writeSitemap(servers) {
  const staticPaths = [
    '/',
    '/catalog',
    '/report',
    '/docs/what-is-mcp',
    '/docs/remote-vs-local',
    '/docs/testing-guide',
    '/docs/troubleshooting',
  ];
  const paths = [...staticPaths, ...servers.map((server) => serverPath(server.id))];
  const lastModified = new Date().toISOString().slice(0, 10);
  const entries = paths.map((pathname) => [
    '  <url>',
    `    <loc>${escapeXml(`${SITE_URL}${pathname === '/' ? '' : pathname}`)}</loc>`,
    `    <lastmod>${lastModified}</lastmod>`,
    '  </url>',
  ].join('\n'));
  const sitemap = [
    '<?xml version="1.0" encoding="UTF-8"?>',
    '<urlset xmlns="http://www.sitemaps.org/schemas/sitemap/0.9">',
    ...entries,
    '</urlset>',
    '',
  ].join('\n');

  fs.writeFileSync(path.join(distRoot, 'sitemap.xml'), sitemap, 'utf8');
  fs.writeFileSync(
    path.join(distRoot, 'robots.txt'),
    `User-agent: *\nAllow: /\n\nSitemap: ${SITE_URL}/sitemap.xml\n`,
    'utf8'
  );
}

function validateInputs(servers) {
  const ids = new Set();
  for (const server of servers) {
    if (!server.id || !server.name || !server.url || !server.transport) {
      throw new Error(`Catalog SEO generation requires id, name, url, and transport: ${JSON.stringify(server)}`);
    }
    if (!/^[a-z0-9]+(?:-[a-z0-9]+)*$/.test(server.id)) {
      throw new Error(`Catalog server id must be a safe lowercase slug: ${server.id}`);
    }
    if (ids.has(server.id)) {
      throw new Error(`Duplicate catalog server id: ${server.id}`);
    }
    ids.add(server.id);
  }
}

function main() {
  if (!fs.existsSync(indexPath)) {
    throw new Error('dist/index.html is missing; run Vite before generating SEO pages.');
  }

  const servers = JSON.parse(fs.readFileSync(catalogPath, 'utf8'));
  validateInputs(servers);
  const indexHtml = fs.readFileSync(indexPath, 'utf8');

  writeServerPages(indexHtml, servers);
  writeSitemap(servers);

  console.log(`Generated ${servers.length} server profile documents, sitemap.xml, and robots.txt.`);
}

if (require.main === module) {
  main();
}

module.exports = { renderServerHtml, serverPath, transportLabel };
