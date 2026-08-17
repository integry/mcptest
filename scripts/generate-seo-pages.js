#!/usr/bin/env node

const fs = require('fs');
const path = require('path');

const SITE_URL = 'https://mcptest.io';
const projectRoot = path.join(__dirname, '..');
const distRoot = path.join(projectRoot, 'dist');
const indexPath = path.join(distRoot, 'index.html');
const catalogPath = path.join(projectRoot, 'src', 'data', 'serverCatalog.json');
const validationPath = path.join(projectRoot, 'src', 'data', 'catalogValidation.json');
const pageMetadataPath = path.join(projectRoot, 'src', 'data', 'pageMetadata.json');
const learnArticlesPath = path.join(projectRoot, 'src', 'data', 'learnArticles.json');

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
  if (transport === 'both') return 'Streamable HTTP and legacy SSE';
  return 'Not yet verified';
}

function isValidationTransport(transport) {
  return (
    transport === 'streamable-http' ||
    transport === 'legacy-sse' ||
    transport === 'both' ||
    transport === 'unknown'
  );
}

function authenticationLabel(authType) {
  if (authType === 'oauth') return 'OAuth 2.1';
  if (authType === 'bearer-token') return 'Bearer token';
  if (authType === 'api-key') return 'API key';
  if (authType === 'none') return 'No authentication';
  return 'Not yet verified';
}

function protocolLabel(era, version) {
  const revision = version ? ` · ${version}` : '';
  if (era === 'stateless') return `Stateless MCP${revision}`;
  if (era === 'stateful') return `Stateful MCP${revision}`;
  if (era === 'legacy') return `Legacy SSE MCP${revision}`;
  return 'Not yet negotiated';
}

function mergeCatalogServers(seeds, validationResults) {
  const validationByServerId = new Map(
    validationResults.map((result) => [result.serverId, result])
  );

  return seeds.map((seed) => {
    const validation = validationByServerId.get(seed.id);
    const declaredAuthType = seed.authType || (seed.requiresOAuth ? 'oauth' : 'none');
    const authType = declaredAuthType === 'api-key' || declaredAuthType === 'bearer-token'
      ? declaredAuthType
      : validation?.authType || declaredAuthType;

    return {
      ...seed,
      declaredTransport: seed.transport,
      declaredAuthType,
      status: validation?.status ?? 'unknown',
      transport: isValidationTransport(validation?.transport)
        ? validation.transport
        : 'unknown',
      authType,
      requiresOAuth: authType === 'oauth',
      protocolEra: validation?.protocolEra || 'unknown',
      protocolVersion: validation?.protocolVersion,
      validatedUrl: validation?.validatedUrl,
      authorizationServers: validation?.authorizationServers,
      checkedAt: validation?.checkedAt,
      validationMessage: validation?.message,
    };
  });
}

function validationStatusLabel(server) {
  if (server.status === 'online') return 'Online when last tested';
  if (server.status === 'offline') return 'Offline when last tested';
  if (server.checkedAt) return 'Latest validation was inconclusive';
  return 'Validation pending — live status not yet verified';
}

function validationTransportNote(server) {
  if (!server.checkedAt) return 'Validation pending — no validation result has been recorded';
  if (server.transport === 'unknown') return 'Latest validation did not verify a transport';
  return 'Observed by the latest catalog validation';
}

function validationDetail(server) {
  if (server.validationMessage) return server.validationMessage;
  if (server.checkedAt) return 'The latest automated probe completed without additional validation detail.';
  return 'Validation pending — no automated probe result is stored yet.';
}

function detectedAuthenticationLabel(server) {
  if (!server.checkedAt) return 'Validation pending — not yet checked';
  return `${authenticationLabel(server.authType)} detected or retained from publisher evidence`;
}

function playgroundPath(server) {
  const endpoint = server.browserUrl || server.validatedUrl || server.url;
  const transport = server.transport === 'unknown'
    ? server.declaredTransport
    : server.transport;
  const transportMethod = /\/sse\/?$/.test(endpoint) || transport === 'legacy-sse' ? 'sse' : 'mcp';
  return `/server/${endpoint}/${transportMethod}`;
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
  const registryLink = server.registryUrl
    ? `<a href="${escapeHtml(server.registryUrl)}">Official MCP Registry record</a>`
    : '';
  const references = [homepageLink, sourceLink, registryLink].filter(Boolean).join(' · ');
  const requiredHeaders = (server.requiredHeaders || []).map((header) => (
    `      <div><dt>Required header</dt><dd><code>${escapeHtml(header.name)}</code>${header.description ? ` — ${escapeHtml(header.description)}` : ''}</dd></div>`
  ));
  const authorizationServers = (server.authorizationServers || []).map((issuer) => (
    `      <div><dt>Authorization server</dt><dd><code>${escapeHtml(issuer)}</code></dd></div>`
  ));

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
    ...(server.validatedUrl && server.validatedUrl !== server.url
      ? [`      <div><dt>Live-validated endpoint</dt><dd><code>${escapeHtml(server.validatedUrl)}</code></dd></div>`]
      : []),
    ...(server.browserUrl && server.browserUrl !== server.validatedUrl
      ? [`      <div><dt>Browser-verified endpoint</dt><dd><code>${escapeHtml(server.browserUrl)}</code></dd></div>`]
      : []),
    `      <div><dt>Browser access</dt><dd>${escapeHtml(server.browserAccess === 'direct' ? 'Direct browser connection verified' : server.browserAccess === 'proxy-required' ? 'Authenticated proxy required' : 'Not yet measured')}</dd></div>`,
    `      <div><dt>Declared MCP transport</dt><dd>${escapeHtml(transportLabel(server.declaredTransport))}</dd></div>`,
    `      <div><dt>Live-validated MCP transport</dt><dd>${escapeHtml(transportLabel(server.transport))} — ${escapeHtml(validationTransportNote(server))}</dd></div>`,
    `      <div><dt>Declared authentication</dt><dd>${escapeHtml(authenticationLabel(server.declaredAuthType))}</dd></div>`,
    `      <div><dt>Detected authentication</dt><dd>${escapeHtml(detectedAuthenticationLabel(server))}</dd></div>`,
    `      <div><dt>Protocol lifecycle</dt><dd>${escapeHtml(protocolLabel(server.protocolEra, server.protocolVersion))}</dd></div>`,
    ...requiredHeaders,
    ...authorizationServers,
    `      <div><dt>Category</dt><dd>${escapeHtml(server.category)}</dd></div>`,
    '    </dl>',
    `    <p>${references}</p>`,
    `    <p><a href="/catalog">Browse all MCP servers</a> · <a href="${escapeHtml(playgroundPath(server))}">Test this endpoint in the MCP Playground</a></p>`,
    '  </div></section>',
    '  <section class="card server-profile-section"><div class="card-body">',
    '    <h2>Latest validation evidence</h2>',
    '    <dl class="server-spec-list">',
    `      <div><dt>Validation status</dt><dd>${escapeHtml(validationStatusLabel(server))}</dd></div>`,
    `      <div><dt>Validation checked at</dt><dd>${escapeHtml(server.checkedAt || 'Not yet validated')}</dd></div>`,
    `      <div><dt>Validation detail</dt><dd>${escapeHtml(validationDetail(server))}</dd></div>`,
    '    </dl>',
    '  </div></section>',
    '</article>',
  ].join('\n');
}

function renderServerHtml(indexHtml, server) {
  server = server.declaredTransport
    ? {
        ...server,
        declaredAuthType:
          server.declaredAuthType || server.authType || (server.requiresOAuth ? 'oauth' : 'none'),
        authType: server.authType || (server.requiresOAuth ? 'oauth' : 'none'),
        protocolEra: server.protocolEra || 'unknown',
      }
    : mergeCatalogServers([server], [])[0];

  const canonicalUrl = `${SITE_URL}${serverPath(server.id)}`;
  const title = `${server.name} MCP Server Report | mcptest.io`;
  const description = truncate(
    server.seoDescription
      || `Inspect the ${server.name} MCP server. ${server.description} Test and debug endpoints.`
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
      { '@type': 'PropertyValue', name: 'Declared MCP transport', value: transportLabel(server.declaredTransport) },
      { '@type': 'PropertyValue', name: 'Live-validated MCP transport', value: transportLabel(server.transport) },
      { '@type': 'PropertyValue', name: 'Declared authentication', value: authenticationLabel(server.declaredAuthType) },
      { '@type': 'PropertyValue', name: 'Detected authentication', value: detectedAuthenticationLabel(server) },
      { '@type': 'PropertyValue', name: 'MCP protocol lifecycle', value: protocolLabel(server.protocolEra, server.protocolVersion) },
      { '@type': 'PropertyValue', name: 'Validation status', value: validationStatusLabel(server) },
      { '@type': 'PropertyValue', name: 'Validation checked at', value: server.checkedAt || 'Not yet validated' },
      { '@type': 'PropertyValue', name: 'Validation detail', value: validationDetail(server) },
    ],
  };

  let html = indexHtml.replace(/<title>[^<]*<\/title>/i, `<title>${escapeHtml(title)}</title>`);
  html = setNamedMeta(html, 'description', description);
  html = setNamedMeta(html, 'twitter:card', 'summary');
  html = setNamedMeta(html, 'twitter:title', title);
  html = setNamedMeta(html, 'twitter:description', description);
  html = setNamedMeta(html, 'twitter:image', imageUrl);
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

function renderStaticPageHtml(indexHtml, pathname, metadata, options = {}) {
  const canonicalUrl = `${SITE_URL}${pathname}`;
  const imageUrl = `${SITE_URL}/logo.png`;
  let html = indexHtml.replace(
    /<title>[^<]*<\/title>/i,
    `<title>${escapeHtml(metadata.title)}</title>`
  );
  html = setNamedMeta(html, 'description', metadata.description);
  html = setNamedMeta(html, 'twitter:card', 'summary');
  html = setNamedMeta(html, 'twitter:title', metadata.title);
  html = setNamedMeta(html, 'twitter:description', metadata.description);
  html = setNamedMeta(html, 'twitter:image', imageUrl);
  html = setPropertyMeta(html, 'og:title', metadata.title);
  html = setPropertyMeta(html, 'og:description', metadata.description);
  html = setPropertyMeta(html, 'og:url', canonicalUrl);
  html = setPropertyMeta(html, 'og:image', imageUrl);
  html = setPropertyMeta(html, 'og:type', options.type || 'website');
  html = replaceOrInsertHead(
    html,
    /<link\s+[^>]*rel=["']canonical["'][^>]*>/i,
    `<link rel="canonical" href="${escapeHtml(canonicalUrl)}" />`
  );
  if (options.structuredData) {
    const safeJson = JSON.stringify(options.structuredData).replace(/<\//g, '<\\/');
    html = html.replace(
      '</head>',
      `    <script id="server-structured-data" type="application/ld+json">${safeJson}</script>\n  </head>`
    );
  }
  if (options.fallbackHtml) {
    html = html.replace(
      '<div id="root"></div>',
      `<div id="root">\n${options.fallbackHtml}\n    </div>`
    );
  }
  return html;
}

function renderInlineMarkdown(value) {
  return escapeHtml(value)
    .replace(/\[([^\]]+)\]\(([^)]+)\)/g, (_match, label, href) => (
      `<a href="${escapeHtml(href)}">${label}</a>`
    ))
    .replace(/`([^`]+)`/g, '<code>$1</code>')
    .replace(/\*\*([^*]+)\*\*/g, '<strong>$1</strong>');
}

function isTableSeparator(line) {
  const cells = line.trim().replace(/^\||\|$/g, '').split('|');
  return cells.length > 1 && cells.every(cell => /^\s*:?-{3,}:?\s*$/.test(cell));
}

function renderMarkdown(markdown) {
  const lines = markdown.replace(/\r\n/g, '\n').split('\n');
  const html = [];
  let index = 0;

  while (index < lines.length) {
    const line = lines[index];
    if (!line.trim()) {
      index += 1;
      continue;
    }

    if (line.startsWith('```')) {
      const language = line.slice(3).trim();
      const code = [];
      index += 1;
      while (index < lines.length && !lines[index].startsWith('```')) {
        code.push(lines[index]);
        index += 1;
      }
      index += 1;
      html.push(`<pre><code${language ? ` class="language-${escapeHtml(language)}"` : ''}>${escapeHtml(code.join('\n'))}</code></pre>`);
      continue;
    }

    const heading = line.match(/^(#{2,6})\s+(.+)$/);
    if (heading) {
      const level = heading[1].length;
      html.push(`<h${level}>${renderInlineMarkdown(heading[2])}</h${level}>`);
      index += 1;
      continue;
    }

    if (
      line.includes('|') &&
      index + 1 < lines.length &&
      isTableSeparator(lines[index + 1])
    ) {
      const headerCells = line.trim().replace(/^\||\|$/g, '').split('|');
      const rows = [];
      index += 2;
      while (index < lines.length && lines[index].includes('|') && lines[index].trim()) {
        rows.push(lines[index].trim().replace(/^\||\|$/g, '').split('|'));
        index += 1;
      }
      html.push([
        '<table><thead><tr>',
        ...headerCells.map(cell => `<th>${renderInlineMarkdown(cell.trim())}</th>`),
        '</tr></thead><tbody>',
        ...rows.map(cells => `<tr>${cells.map(cell => `<td>${renderInlineMarkdown(cell.trim())}</td>`).join('')}</tr>`),
        '</tbody></table>',
      ].join(''));
      continue;
    }

    const listMatch = line.match(/^\s*(?:([-*])|(\d+)\.)\s+(.+)$/);
    if (listMatch) {
      const ordered = Boolean(listMatch[2]);
      const tag = ordered ? 'ol' : 'ul';
      const items = [];
      while (index < lines.length) {
        const item = lines[index].match(/^\s*(?:([-*])|(\d+)\.)\s+(.+)$/);
        if (!item || Boolean(item[2]) !== ordered) break;
        items.push(item[3]);
        index += 1;
      }
      html.push(`<${tag}>${items.map(item => `<li>${renderInlineMarkdown(item)}</li>`).join('')}</${tag}>`);
      continue;
    }

    const paragraph = [line.trim()];
    index += 1;
    while (
      index < lines.length &&
      lines[index].trim() &&
      !lines[index].startsWith('```') &&
      !/^(#{2,6})\s+/.test(lines[index]) &&
      !/^\s*(?:[-*]|\d+\.)\s+/.test(lines[index]) &&
      !(lines[index].includes('|') && index + 1 < lines.length && isTableSeparator(lines[index + 1]))
    ) {
      paragraph.push(lines[index].trim());
      index += 1;
    }
    html.push(`<p>${renderInlineMarkdown(paragraph.join(' '))}</p>`);
  }

  return html.join('\n');
}

function getRelatedLearnArticles(article, articles) {
  const bySlug = new Map(articles.map(item => [item.slug, item]));
  return article.relatedSlugs.map(slug => bySlug.get(slug)).filter(Boolean);
}

function renderLearnIndexFallback(learnData) {
  return [
    '<main class="learn-page learn-index seo-learn-fallback">',
    '  <header class="learn-hero">',
    '    <p class="learn-kicker">Guides</p>',
    `    <h1>${escapeHtml(learnData.index.title)}</h1>`,
    `    <p>${escapeHtml(learnData.index.summary)}</p>`,
    '  </header>',
    '  <div class="learn-grid">',
    ...learnData.articles.map(article => [
      '    <article class="learn-card">',
      `      <p>${escapeHtml(article.category)} · ${article.readingTimeMinutes} min read</p>`,
      `      <h2><a href="/learn/${escapeHtml(article.slug)}">${escapeHtml(article.title)}</a></h2>`,
      `      <p>${escapeHtml(article.summary)}</p>`,
      `      <p>Reviewed <time datetime="${escapeHtml(article.lastReviewed)}">${escapeHtml(article.lastReviewed)}</time></p>`,
      '    </article>',
    ].join('\n')),
    '  </div>',
    '</main>',
  ].join('\n');
}

function renderLearnArticleFallback(article, articles) {
  const related = getRelatedLearnArticles(article, articles);
  return [
    `<article class="learn-page learn-article seo-learn-fallback" data-article-slug="${escapeHtml(article.slug)}">`,
    `  <nav class="learn-breadcrumb" aria-label="Breadcrumb"><a href="/learn">Learn</a><span>/</span><span aria-current="page">${escapeHtml(article.title)}</span></nav>`,
    '  <header class="learn-article-header">',
    `    <p class="learn-kicker">${escapeHtml(article.category)}</p>`,
    `    <h1>${escapeHtml(article.title)}</h1>`,
    `    <p>${escapeHtml(article.summary)}</p>`,
    `    <p>${article.readingTimeMinutes} min read · Last reviewed <time datetime="${escapeHtml(article.lastReviewed)}">${escapeHtml(article.lastReviewed)}</time></p>`,
    '  </header>',
    `  <div class="learn-markdown">${renderMarkdown(article.content)}</div>`,
    '  <footer class="learn-article-footer">',
    '    <section><h2>Sources</h2><ul>',
    ...article.sourceLinks.map(source => `      <li><a href="${escapeHtml(source.url)}">${escapeHtml(source.title)}</a></li>`),
    '    </ul></section>',
    '    <section><h2>Related guides</h2><ul>',
    ...related.map(item => `      <li><a href="/learn/${escapeHtml(item.slug)}">${escapeHtml(item.title)}</a></li>`),
    '    </ul></section>',
    '  </footer>',
    '</article>',
  ].join('\n');
}

function getLearnArticleStructuredData(article) {
  const canonicalUrl = `${SITE_URL}/learn/${article.slug}`;
  return {
    '@context': 'https://schema.org',
    '@type': 'Article',
    headline: article.title,
    description: article.summary,
    mainEntityOfPage: canonicalUrl,
    url: canonicalUrl,
    dateModified: article.lastReviewed,
    articleSection: article.category,
    author: { '@type': 'Organization', name: 'mcptest.io', url: SITE_URL },
    publisher: {
      '@type': 'Organization',
      name: 'mcptest.io',
      url: SITE_URL,
      logo: { '@type': 'ImageObject', url: `${SITE_URL}/logo.png` },
    },
    citation: article.sourceLinks.map(({ url }) => url),
    isPartOf: { '@type': 'CollectionPage', name: 'Learn MCP', url: `${SITE_URL}/learn` },
  };
}

function renderLearnArticleHtml(indexHtml, article, articles) {
  return renderStaticPageHtml(indexHtml, `/learn/${article.slug}`, {
    title: `${article.title} | mcptest.io`,
    description: article.summary,
  }, {
    type: 'article',
    structuredData: getLearnArticleStructuredData(article),
    fallbackHtml: renderLearnArticleFallback(article, articles),
  });
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

function writeStaticPages(indexHtml, docsMetadata) {
  for (const [slug, metadata] of Object.entries(docsMetadata)) {
    const pathname = `/docs/${slug}`;
    const outputDirectory = path.join(distRoot, 'docs', slug);
    fs.mkdirSync(outputDirectory, { recursive: true });
    fs.writeFileSync(
      path.join(outputDirectory, 'index.html'),
      renderStaticPageHtml(indexHtml, pathname, metadata),
      'utf8'
    );
  }
}

function writeLearnPages(indexHtml, learnData) {
  const learnDirectory = path.join(distRoot, 'learn');
  fs.mkdirSync(learnDirectory, { recursive: true });
  fs.writeFileSync(
    path.join(learnDirectory, 'index.html'),
    renderStaticPageHtml(indexHtml, '/learn', {
      title: `${learnData.index.title} | mcptest.io`,
      description: learnData.index.description,
    }, {
      fallbackHtml: renderLearnIndexFallback(learnData),
    }),
    'utf8'
  );

  for (const article of learnData.articles) {
    const outputDirectory = path.join(learnDirectory, article.slug);
    fs.mkdirSync(outputDirectory, { recursive: true });
    fs.writeFileSync(
      path.join(outputDirectory, 'index.html'),
      renderLearnArticleHtml(indexHtml, article, learnData.articles),
      'utf8'
    );
  }
}

function writeSitemap(servers, learnData) {
  const staticPaths = [
    '/',
    '/catalog',
    '/report',
    '/docs/what-is-mcp',
    '/docs/remote-vs-local',
    '/docs/testing-guide',
    '/docs/troubleshooting',
    '/learn',
  ];
  const lastModified = new Date().toISOString().slice(0, 10);
  const paths = [
    ...staticPaths.map(pathname => ({ pathname, lastModified })),
    ...learnData.articles.map(article => ({
      pathname: `/learn/${article.slug}`,
      lastModified: article.lastReviewed,
    })),
    ...servers.map(server => ({ pathname: serverPath(server.id), lastModified })),
  ];
  const entries = paths.map(({ pathname, lastModified: entryLastModified }) => [
    '  <url>',
    `    <loc>${escapeXml(`${SITE_URL}${pathname === '/' ? '' : pathname}`)}</loc>`,
    `    <lastmod>${entryLastModified}</lastmod>`,
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

function validateLearnArticles(learnData) {
  if (!learnData.index?.title || !learnData.index?.description || !learnData.index?.summary) {
    throw new Error('Learn SEO generation requires complete index metadata.');
  }
  const slugs = new Set();
  for (const article of learnData.articles || []) {
    const required = [
      article.title,
      article.summary,
      article.slug,
      article.category,
      article.readingTimeMinutes,
      article.lastReviewed,
      article.content,
      article.relatedSlugs,
      article.sourceLinks,
    ];
    if (required.some(value => value === undefined || value === null || value === '')) {
      throw new Error(`Learn SEO generation requires complete article metadata: ${JSON.stringify(article)}`);
    }
    if (!/^[a-z0-9]+(?:-[a-z0-9]+)*$/.test(article.slug) || slugs.has(article.slug)) {
      throw new Error(`Learn article slug must be unique and safe: ${article.slug}`);
    }
    if (!/^\d{4}-\d{2}-\d{2}$/.test(article.lastReviewed)) {
      throw new Error(`Learn article last-reviewed date is invalid: ${article.slug}`);
    }
    if (!Array.isArray(article.sourceLinks) || article.sourceLinks.length === 0) {
      throw new Error(`Learn article requires source links: ${article.slug}`);
    }
    slugs.add(article.slug);
  }
  for (const article of learnData.articles) {
    for (const relatedSlug of article.relatedSlugs) {
      if (!slugs.has(relatedSlug)) {
        throw new Error(`Learn article ${article.slug} references unknown article ${relatedSlug}.`);
      }
    }
  }
}

function main() {
  if (!fs.existsSync(indexPath)) {
    throw new Error('dist/index.html is missing; run Vite before generating SEO pages.');
  }

  const seeds = JSON.parse(fs.readFileSync(catalogPath, 'utf8'));
  const validationResults = JSON.parse(fs.readFileSync(validationPath, 'utf8'));
  const pageMetadata = JSON.parse(fs.readFileSync(pageMetadataPath, 'utf8'));
  const learnData = JSON.parse(fs.readFileSync(learnArticlesPath, 'utf8'));
  validateInputs(seeds);
  validateLearnArticles(learnData);
  const servers = mergeCatalogServers(seeds, validationResults);
  const indexHtml = fs.readFileSync(indexPath, 'utf8');

  writeServerPages(indexHtml, servers);
  writeStaticPages(indexHtml, pageMetadata.docs);
  writeLearnPages(indexHtml, learnData);
  writeSitemap(servers, learnData);

  console.log(`Generated ${servers.length} server profile documents, ${Object.keys(pageMetadata.docs).length} documentation documents, ${learnData.articles.length} Learn articles, sitemap.xml, and robots.txt.`);
}

if (require.main === module) {
  main();
}

module.exports = {
  mergeCatalogServers,
  renderServerHtml,
  renderStaticPageHtml,
  renderLearnArticleHtml,
  renderMarkdown,
  serverPath,
  transportLabel,
};
