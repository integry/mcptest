#!/usr/bin/env node

const fs = require('fs');
const path = require('path');
const {
  generateClientSetups,
  getPreferredCatalogEndpoint,
} = require('../src/utils/clientSetup.ts');
const { createAuthorizationGuidance } = require('../src/utils/authorizationGuidance.ts');
const {
  CONTENT_LEVEL_LABELS,
  buildTrackNavigation,
  getArticleBodyMarkdown,
  getArticleMetaDescription,
  getArticleMetaTitle,
  getTrack,
  getTrackNeighbors,
} = require('../src/content/contentModel.ts');
const { extractHeadings, splitHeadingAnchor } = require('../src/content/outline.ts');
const { loadArticles } = require('./content/loadArticles.js');
const { SEARCH_INDEX_PATH, buildSearchIndex, serializeSearchIndex } = require('../src/content/searchIndex.ts');
const {
  FEED_PATH,
  FEED_TITLE,
  FEED_URL,
  articleMarkdownPath,
  renderArticleMarkdown,
  renderLearnFeed,
  renderLlmsTxt,
} = require('./content/machineReadable.js');
const {
  LANDING_AUDIENCE_PATHS,
  LANDING_CATALOG_LINK_PREFIX,
  LANDING_CATALOG_LINK_SUFFIX,
  LANDING_COVERAGE_TITLE,
  LANDING_HEADLINE,
  LANDING_LEDE,
  LANDING_PATHS_LABEL,
  LANDING_REPORT_COVERAGE,
} = require('../src/content/landingCopy.ts');
const { OG_IMAGE_HEIGHT, OG_IMAGE_WIDTH, getOgImagePath } = require('../src/utils/ogImage.ts');
const {
  DASHBOARDS_NAVIGATION,
  FOOTER_NAVIGATION,
  LEARN_HUB_NAVIGATION,
  LEGAL_NAVIGATION,
  PRIMARY_NAVIGATION,
  buildLearnTrackNavigation,
} = require('../src/content/navigationLinks.ts');
const { createDefaultSpaces, createDefaultTabs } = require('../src/utils/defaultWorkspace.ts');
const { selectLandingQuickPicks } = require('../src/utils/landingQuickPicks.ts');
const { VERSION_INFO, getGithubCommitUrl } = require('../src/utils/versionInfo.ts');
const { getSpaceUrl } = require('../src/utils/urlUtils.ts');
const { highlightCode } = require('../src/content/codeHighlighting.ts');
const { writeOgImages } = require('./og/ogImages.js');
const { renderCategoryFallback, renderToolInventory } = require('./content/catalogPages.js');
const {
  getCatalogCategoryNames,
  getCatalogCategoryPath,
  getCatalogCategorySeo,
  getCatalogCategorySlug,
  summarizeCatalogCategories,
} = require('../src/utils/catalogCategories.ts');
const { getToolInventoryProperties } = require('../src/utils/catalogSeo.ts');
const { getToolInventoryFeatureList } = require('../src/utils/toolInventory.ts');

const SITE_URL = 'https://mcptest.io';
const projectRoot = path.join(__dirname, '..');
const distRoot = path.join(projectRoot, 'dist');
const indexPath = path.join(distRoot, 'index.html');
const catalogPath = path.join(projectRoot, 'src', 'data', 'serverCatalog.json');
const validationPath = path.join(projectRoot, 'src', 'data', 'catalogValidation.json');
const capabilitiesPath = path.join(projectRoot, 'src', 'data', 'catalogCapabilities.json');
const pageMetadataPath = path.join(projectRoot, 'src', 'data', 'pageMetadata.json');
const publicRoot = path.join(projectRoot, 'public');
const DEFAULT_LEARN_INDEX = { title: 'Learn MCP' };
const STANDALONE_CREDENTIAL = /(?<![A-Za-z0-9])(?:gh[pousr]_[A-Za-z0-9]{20,255}|github_pat_[A-Za-z0-9_]{20,255}|(?:sk|rk)_(?:live|test)_[A-Za-z0-9]{16,255}|sk-(?:proj-)?[A-Za-z0-9_-]{20,255}|(?:AKIA|ASIA)[A-Z0-9]{16}|AIza[A-Za-z0-9_-]{35}|xox(?:b|p|a|r|s)-[A-Za-z0-9-]{20,255}|npm_[A-Za-z0-9]{20,255}|glpat-[A-Za-z0-9_-]{20,255}|hf_[A-Za-z0-9]{20,255})(?![A-Za-z0-9])/g;

function containsStandaloneCredential(value) {
  STANDALONE_CREDENTIAL.lastIndex = 0;
  return STANDALONE_CREDENTIAL.test(value);
}

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

function safeJsonForHtml(value) {
  return JSON.stringify(value)
    .replace(/&/g, '\\u0026')
    .replace(/</g, '\\u003c')
    .replace(/>/g, '\\u003e');
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
  if (authType === 'api-token') return 'API token';
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

function mergeCatalogServers(seeds, validationResults, capabilitySnapshots = {}) {
  const validationByServerId = new Map(
    validationResults.map((result) => [result.serverId, result])
  );

  return seeds.map((seed) => {
    const validation = validationByServerId.get(seed.id);
    const declaredAuthType = seed.authType || (seed.requiresOAuth ? 'oauth' : 'none');
    const authType = declaredAuthType === 'api-key'
      || declaredAuthType === 'api-token'
      || declaredAuthType === 'bearer-token'
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
      capabilityInventory: capabilitySnapshots[seed.id],
    };
  });
}

function formatDisplayTimestamp(value) {
  if (!value) return value;
  const timestamp = new Date(value);
  if (Number.isNaN(timestamp.getTime())) return value;

  const date = new Intl.DateTimeFormat('en-US', {
    month: 'short', day: 'numeric', year: 'numeric',
  }).format(timestamp);
  const time = new Intl.DateTimeFormat('en-US', {
    hour: 'numeric', minute: '2-digit',
  }).format(timestamp);
  return `${date} at ${time}`;
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
  const endpoint = getPreferredCatalogEndpoint(server);
  const transportMethod = endpoint.transport === 'legacy-sse' ? 'sse' : 'mcp';
  return `/server/${endpoint.url}/${transportMethod}`;
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

/** Advertises the guides RSS feed in a page head. */
function setFeedLink(html) {
  return replaceOrInsertHead(
    html,
    /<link\s+[^>]*type=["']application\/rss\+xml["'][^>]*>/i,
    `<link rel="alternate" type="application/rss+xml" title="${escapeHtml(FEED_TITLE)}" href="${escapeHtml(FEED_URL)}" />`
  );
}

/** Absolute URL of the build-time Open Graph image for a page path. */
function ogImageUrl(pathname) {
  return `${SITE_URL}${getOgImagePath(pathname)}`;
}

/** Large-card social image tags for Open Graph and Twitter. */
function setSocialImage(html, imageUrl, alt) {
  html = setNamedMeta(html, 'twitter:card', 'summary_large_image');
  html = setNamedMeta(html, 'twitter:image', imageUrl);
  html = setNamedMeta(html, 'twitter:image:alt', alt);
  html = setPropertyMeta(html, 'og:image', imageUrl);
  html = setPropertyMeta(html, 'og:image:width', String(OG_IMAGE_WIDTH));
  html = setPropertyMeta(html, 'og:image:height', String(OG_IMAGE_HEIGHT));
  html = setPropertyMeta(html, 'og:image:alt', alt);
  return html;
}

function serverInitials(name) {
  const words = String(name).match(/[\p{L}\p{N}]+/gu) || [];
  const initials = words.length > 1
    ? `${words[0][0]}${words[1][0]}`
    : words[0]?.slice(0, 2) || '?';
  return initials.toLocaleUpperCase();
}

function isLocalServerLogo(logoUrl) {
  return typeof logoUrl === 'string' && logoUrl.startsWith('/server-logos/');
}

function renderServerLogo(server) {
  if (isLocalServerLogo(server.logoUrl)) {
    return `<span class="catalog-server-logo server-profile-logo" aria-hidden="true"><img src="${escapeHtml(server.logoUrl)}" alt="" /></span>`;
  }

  return `<span class="catalog-server-logo catalog-server-logo--fallback server-profile-logo" role="img" aria-label="${escapeHtml(server.name)} logo"><span class="catalog-server-logo-initials" aria-hidden="true">${escapeHtml(serverInitials(server.name))}</span></span>`;
}

function renderClientSetups(server) {
  const setups = generateClientSetups(server);
  return [
    '  <section class="card server-profile-section client-setup seo-client-setup"><div class="card-body">',
    '    <h2>Connect this server to your client</h2>',
    ...setups.map(setup => [
      `    <section class="client-setup-panel" data-client="${escapeHtml(setup.id)}">`,
      `      <h3>${escapeHtml(setup.heading)}</h3>`,
      `      <p>${escapeHtml(setup.location)}</p>`,
      setup.supported
        ? `      <pre aria-label="${escapeHtml(setup.label)} configuration"><code class="language-${escapeHtml(setup.format)}">${escapeHtml(setup.copyText)}</code></pre>`
        : `      <div class="alert alert-warning client-setup-unsupported" role="status"><strong>Setup unavailable</strong><p>${escapeHtml(setup.copyText)}</p></div>`,
      `      <p>${escapeHtml(setup.authSummary)}</p>`,
      `      <ul>${setup.notes.map(note => `<li>${escapeHtml(note)}</li>`).join('')}</ul>`,
      `      <p><a href="${escapeHtml(setup.documentationUrl)}">${escapeHtml(setup.documentationLabel)}</a></p>`,
      '    </section>',
    ].join('\n')),
    '  </div></section>',
  ].join('\n');
}

function renderAuthorizationSetup(server) {
  const guidance = createAuthorizationGuidance(server);
  return [
    `  <section class="authorization-setup authorization-setup--${escapeHtml(guidance.status)}" aria-labelledby="authorization-setup-${escapeHtml(server.id)}-title">`,
    '    <p class="authorization-setup-kicker">Authorization setup</p>',
    `    <h2 id="authorization-setup-${escapeHtml(server.id)}-title">${escapeHtml(guidance.statusLabel)}</h2>`,
    `    <p>${escapeHtml(guidance.summary)}</p>`,
    ...(guidance.reviewedAt ? [`    <p>Publisher evidence reviewed <time datetime="${escapeHtml(guidance.reviewedAt)}">${escapeHtml(guidance.reviewedAt)}</time>.</p>`] : []),
    ...(guidance.clientIdRequired || guidance.clientSecretRequired ? [
      '    <dl class="authorization-setup-requirements">',
      `      <div><dt>Client ID</dt><dd>${guidance.clientIdRequired ? 'Required' : 'Not required'}</dd></div>`,
      `      <div><dt>Client secret</dt><dd>${guidance.clientSecretRequired ? 'Required — never enter it in a browser' : 'Not required'}</dd></div>`,
      `      <div><dt>Browser/public client</dt><dd>${guidance.browserPublicClientSupported === true ? 'Supported' : guidance.browserPublicClientSupported === false ? 'Not supported' : 'Not verified'}</dd></div>`,
      '    </dl>',
    ] : []),
    ...(guidance.settings.length ? [
      '    <h3>Required non-secret settings</h3>',
      `    <dl>${guidance.settings.map(({ label, value, required }) => `<div><dt>${escapeHtml(label)}</dt><dd>${escapeHtml(value)}${required ? ' (required)' : ' (optional)'}</dd></div>`).join('')}</dl>`,
    ] : []),
    ...(guidance.callbacks.length ? [
      '    <h3>Callback URIs</h3>',
      `    <ul>${guidance.callbacks.map(callback => `<li><code>${escapeHtml(callback)}</code></li>`).join('')}</ul>`,
    ] : []),
    ...(guidance.steps.length ? [
      '    <h3>Provider setup steps</h3>',
      `    <ol>${guidance.steps.map(step => `<li>${escapeHtml(step)}</li>`).join('')}</ol>`,
    ] : []),
    ...(guidance.alternativeHeaderTemplate ? [
      `    <p><strong>Safe header template:</strong> <code>${escapeHtml(guidance.alternativeHeaderTemplate)}</code>. Replace only the named placeholder in protected client configuration.</p>`,
    ] : []),
    ...(guidance.registrationUrl ? [`    <p><a href="${escapeHtml(guidance.registrationUrl)}">Open provider setup or application page</a></p>`] : []),
    ...(guidance.documentationUrl ? [`    <p><a href="${escapeHtml(guidance.documentationUrl)}">Publisher documentation</a></p>`] : []),
    '  </section>',
  ].join('\n');
}

function renderServerFallback(server) {
  const {
    createCatalogBadgeSnippets,
    getBadgeTitle,
    getCatalogBadgeVariant,
    getStaticBadgeUrl,
  } = require('../src/utils/badges.ts');
  const badgeVariant = getCatalogBadgeVariant(server.checkedAt ? server : undefined);
  const badgeSnippets = createCatalogBadgeSnippets(server.id);
  const badgeFormats = [
    ['markdown', 'Markdown'],
    ['html', 'HTML'],
    ['restructuredText', 'reStructuredText'],
  ];
  const homepageLink = server.homepageUrl
    ? `<a href="${escapeHtml(server.homepageUrl)}">Product documentation</a>`
    : '';
  const sourceLink = server.sourceUrl
    ? `<a href="${escapeHtml(server.sourceUrl)}">Source repository</a>`
    : '';
  const registryLink = server.registryUrl
    ? `<a href="${escapeHtml(server.registryUrl)}">Official MCP Registry record</a>`
    : '';
  const listingLink = server.listingSource?.url && server.listingSource.url !== server.homepageUrl
    ? `<a href="${escapeHtml(server.listingSource.url)}">Official listing documentation</a>`
    : '';
  const references = [homepageLink, sourceLink, listingLink, registryLink].filter(Boolean).join(' · ');
  const requiredHeaders = (server.requiredHeaders || []).map((header) => (
    `      <div><dt>Required header</dt><dd><code class="technical-string technical-string-inline">${escapeHtml(header.name)}</code>${header.description ? ` — ${escapeHtml(header.description)}` : ''}</dd></div>`
  ));
  const alternativeAuthTypes = (server.alternativeAuthTypes || []).map((authType) => (
    `      <div><dt>Alternative authentication</dt><dd>${escapeHtml(authenticationLabel(authType))}</dd></div>`
  ));
  const alternativeEndpoints = (server.alternativeEndpoints || []).map((endpoint) => (
    `      <div><dt>Alternative endpoint</dt><dd><code class="technical-string technical-string-url">${escapeHtml(endpoint.url)}</code> — ${escapeHtml(endpoint.description)}${endpoint.authType ? ` (${escapeHtml(authenticationLabel(endpoint.authType))})` : ''}</dd></div>`
  ));
  const authorizationServers = (server.authorizationServers || []).map((issuer) => (
    `      <div><dt>Authorization server</dt><dd><code class="technical-string technical-string-url">${escapeHtml(issuer)}</code></dd></div>`
  ));

  return [
    `<article class="server-profile seo-server-fallback" data-server-id="${escapeHtml(server.id)}">`,
    `  <nav class="server-profile-breadcrumb" aria-label="Breadcrumb"><ol class="breadcrumb mb-0"><li class="breadcrumb-item server-profile-breadcrumb-parent"><a href="/catalog">Server Catalog</a></li><li class="breadcrumb-item server-profile-breadcrumb-parent"><a href="${escapeHtml(getCatalogCategoryPath(server.category))}">${escapeHtml(server.category)}</a></li><li class="breadcrumb-item active server-profile-breadcrumb-current" aria-current="page">${escapeHtml(server.name)}</li></ol></nav>`,
    '  <header class="server-profile-hero">',
    `    <div class="server-profile-identity">${renderServerLogo(server)}<div>`,
    `      <h1>${escapeHtml(server.name)}</h1>`,
    `      <p>${escapeHtml(server.description)}</p>`,
    '    </div></div>',
    '  </header>',
    '  <section class="card server-profile-section"><div class="card-body">',
    '    <h2>Connection specification</h2>',
    '    <dl class="server-spec-list server-connection-specs">',
    `      <div><dt>Remote endpoint</dt><dd><code class="technical-string technical-string-url">${escapeHtml(server.url)}</code></dd></div>`,
    ...(server.validatedUrl && server.validatedUrl !== server.url
      ? [`      <div><dt>Live-validated endpoint</dt><dd><code class="technical-string technical-string-url">${escapeHtml(server.validatedUrl)}</code></dd></div>`]
      : []),
    ...(server.browserUrl && server.browserUrl !== server.validatedUrl
      ? [`      <div><dt>Browser-verified endpoint</dt><dd><code class="technical-string technical-string-url">${escapeHtml(server.browserUrl)}</code></dd></div>`]
      : []),
    `      <div><dt>Browser access</dt><dd>${escapeHtml(server.browserAccess === 'direct' ? 'Direct browser connection verified' : server.browserAccess === 'proxy-required' ? 'Authenticated proxy required' : 'Not yet measured')}</dd></div>`,
    `      <div><dt>Declared MCP transport</dt><dd>${escapeHtml(transportLabel(server.declaredTransport))}</dd></div>`,
    `      <div><dt>Live-validated MCP transport</dt><dd>${escapeHtml(transportLabel(server.transport))} — ${escapeHtml(validationTransportNote(server))}</dd></div>`,
    `      <div><dt>Declared authentication</dt><dd>${escapeHtml(authenticationLabel(server.declaredAuthType))}</dd></div>`,
    `      <div><dt>Detected authentication</dt><dd>${escapeHtml(detectedAuthenticationLabel(server))}</dd></div>`,
    ...alternativeAuthTypes,
    ...alternativeEndpoints,
    `      <div><dt>Protocol lifecycle</dt><dd>${escapeHtml(protocolLabel(server.protocolEra, server.protocolVersion))}</dd></div>`,
    ...requiredHeaders,
    ...authorizationServers,
    `      <div><dt>Category</dt><dd><a href="${escapeHtml(getCatalogCategoryPath(server.category))}">${escapeHtml(server.category)}</a></dd></div>`,
    '    </dl>',
    `    <p>${references}</p>`,
    ...(server.caveats?.length ? [
      '    <h3>Provider guidance</h3>',
      `    <ul>${server.caveats.map(caveat => `<li>${escapeHtml(caveat)}</li>`).join('')}</ul>`,
    ] : []),
    `    <p><a href="${escapeHtml(getCatalogCategoryPath(server.category))}">More ${escapeHtml(server.category)} MCP servers</a> · <a href="/catalog">Browse all MCP servers</a> · <a href="${escapeHtml(playgroundPath(server))}">Test this endpoint in the MCP Playground</a></p>`,
    '  </div></section>',
    renderAuthorizationSetup(server),
    renderClientSetups(server),
    '  <section class="card server-profile-section"><div class="card-body">',
    '    <section class="badge-embed" aria-labelledby="server-badge-embed-title">',
    '      <div class="badge-embed-heading">',
    '        <h2 id="server-badge-embed-title">Share and embed</h2>',
    `        <p>Maintain ${escapeHtml(server.name)}? Embed this badge in your README. It follows the latest catalog validation result and links to this server profile.</p>`,
    '      </div>',
    `      <a class="badge-embed-preview" href="${escapeHtml(serverPath(server.id))}"><img src="${escapeHtml(getStaticBadgeUrl(badgeVariant, ''))}" alt="${escapeHtml(getBadgeTitle(badgeVariant))}" height="20"></a>`,
    '      <div class="badge-embed-snippets">',
    ...badgeFormats.map(([key, label]) => (
      `        <div class="badge-embed-snippet"><div class="badge-embed-snippet-header"><label for="server-badge-embed-title-${key}">${label}</label></div><textarea id="server-badge-embed-title-${key}" class="form-control badge-embed-code" readonly spellcheck="false" rows="${key === 'restructuredText' ? 3 : 2}">${escapeHtml(badgeSnippets[key])}</textarea></div>`
    )),
    '      </div>',
    '    </section>',
    '  </div></section>',
    '  <section class="card server-profile-section"><div class="card-body">',
    '    <h2>Latest validation evidence</h2>',
    '    <dl class="server-spec-list">',
    `      <div><dt>Validation status</dt><dd>${escapeHtml(validationStatusLabel(server))}</dd></div>`,
    `      <div><dt>Validation checked at</dt><dd>${escapeHtml(server.checkedAt ? formatDisplayTimestamp(server.checkedAt) : 'Not yet validated')}</dd></div>`,
    `      <div><dt>Validation detail</dt><dd>${escapeHtml(validationDetail(server))}</dd></div>`,
    '    </dl>',
    '  </div></section>',
    renderToolInventory(server),
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
  const imageUrl = ogImageUrl(serverPath(server.id));
  const structuredData = {
    '@context': 'https://schema.org',
    // SoftwareApplication carries applicationCategory and featureList.
    '@type': ['WebAPI', 'SoftwareApplication'],
    name: `${server.name} MCP Server`,
    description: server.description,
    url: canonicalUrl,
    endpointUrl: server.url,
    applicationCategory: server.category,
    keywords: server.tags.join(', '),
    documentation: server.homepageUrl || canonicalUrl,
    ...(server.capabilityInventory?.tools.items.length || server.capabilityInventory?.prompts.items.length
      ? { featureList: getToolInventoryFeatureList(server.capabilityInventory) }
      : {}),
    additionalProperty: [
      { '@type': 'PropertyValue', name: 'Declared MCP transport', value: transportLabel(server.declaredTransport) },
      { '@type': 'PropertyValue', name: 'Live-validated MCP transport', value: transportLabel(server.transport) },
      { '@type': 'PropertyValue', name: 'Declared authentication', value: authenticationLabel(server.declaredAuthType) },
      { '@type': 'PropertyValue', name: 'Detected authentication', value: detectedAuthenticationLabel(server) },
      ...(server.alternativeAuthTypes || []).map(authType => ({
        '@type': 'PropertyValue', name: 'Alternative authentication', value: authenticationLabel(authType),
      })),
      ...(server.alternativeEndpoints || []).map(endpoint => ({
        '@type': 'PropertyValue', name: 'Alternative endpoint', value: endpoint.url,
      })),
      { '@type': 'PropertyValue', name: 'MCP protocol lifecycle', value: protocolLabel(server.protocolEra, server.protocolVersion) },
      { '@type': 'PropertyValue', name: 'Validation status', value: validationStatusLabel(server) },
      { '@type': 'PropertyValue', name: 'Validation checked at', value: server.checkedAt || 'Not yet validated' },
      { '@type': 'PropertyValue', name: 'Validation detail', value: validationDetail(server) },
      ...getToolInventoryProperties(server),
    ],
  };

  let html = indexHtml.replace(/<title>[^<]*<\/title>/i, `<title>${escapeHtml(title)}</title>`);
  html = setNamedMeta(html, 'description', description);
  html = setNamedMeta(html, 'twitter:title', title);
  html = setNamedMeta(html, 'twitter:description', description);
  html = setPropertyMeta(html, 'og:title', title);
  html = setPropertyMeta(html, 'og:description', description);
  html = setPropertyMeta(html, 'og:url', canonicalUrl);
  html = setPropertyMeta(html, 'og:type', 'website');
  html = setSocialImage(html, imageUrl, title);
  html = replaceOrInsertHead(
    html,
    /<link\s+[^>]*rel=["']canonical["'][^>]*>/i,
    `<link rel="canonical" href="${escapeHtml(canonicalUrl)}" />`
  );

  const safeJson = safeJsonForHtml(structuredData);
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

/**
 * Head metadata (and optional static body) for a prerendered page. Every page
 * gets its build-time Open Graph image; `options.feed` adds the guides RSS
 * link. The home page's canonical URL has no trailing slash, as in the app.
 */
function renderStaticPageHtml(indexHtml, pathname, metadata, options = {}) {
  const canonicalUrl = pathname === '/' ? SITE_URL : `${SITE_URL}${pathname}`;
  let html = indexHtml.replace(
    /<title>[^<]*<\/title>/i,
    `<title>${escapeHtml(metadata.title)}</title>`
  );
  html = setNamedMeta(html, 'description', metadata.description);
  html = setNamedMeta(html, 'twitter:title', metadata.title);
  html = setNamedMeta(html, 'twitter:description', metadata.description);
  html = setPropertyMeta(html, 'og:title', metadata.title);
  html = setPropertyMeta(html, 'og:description', metadata.description);
  html = setPropertyMeta(html, 'og:url', canonicalUrl);
  html = setPropertyMeta(html, 'og:type', options.type || 'website');
  html = setSocialImage(html, ogImageUrl(pathname), metadata.title);
  if (options.feed) html = setFeedLink(html);
  html = replaceOrInsertHead(
    html,
    /<link\s+[^>]*rel=["']canonical["'][^>]*>/i,
    `<link rel="canonical" href="${escapeHtml(canonicalUrl)}" />`
  );
  if (options.structuredData) {
    const safeJson = safeJsonForHtml(options.structuredData);
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

const FENCE_PATTERN = /^(`{3,}|~{3,})(.*)$/;

/**
 * Parses a CommonMark fenced-code opener: three or more backticks or tildes
 * followed by an optional info string. A backtick info string may not contain
 * backticks, so a line such as ``` ``code`` ``` stays inline.
 */
function openingFence(line) {
  const match = line.match(FENCE_PATTERN);
  if (!match) return null;
  const marker = match[1];
  const info = match[2].trim();
  if (marker[0] === '`' && info.includes('`')) return null;
  return { marker, info };
}

/** A closing fence repeats the opener's character at least as many times, with nothing else on the line. */
function closesFence(line, fence) {
  const match = line.match(/^(`{3,}|~{3,})\s*$/);
  return Boolean(match) && match[1][0] === fence.marker[0] && match[1].length >= fence.marker.length;
}

/**
 * CommonMark HTML block (type 2): a line starting with `<!--` opens a block
 * that runs through the first line containing `-->`, or to the end of the
 * document when never closed. The browser renders no HTML, so the fallback
 * emits nothing for it; its interior lines are never headings.
 */
function opensHtmlComment(line) {
  return /^ {0,3}<!--/.test(line);
}

function isTableSeparator(line) {
  const cells = line.trim().replace(/^\||\|$/g, '').split('|');
  return cells.length > 1 && cells.every(cell => /^\s*:?-{3,}:?\s*$/.test(cell));
}

/**
 * Heading ids come from the parsed Markdown tree (`extractHeadings`), keyed
 * by source line, so the fallback HTML carries exactly the ids the browser
 * outline links to. `context` carries that map through blockquote recursion
 * together with the line offset of the nested slice.
 */
function renderMarkdown(markdown, context = undefined) {
  const lines = markdown.replace(/\r\n/g, '\n').split('\n');
  const html = [];
  const { headingIdsByLine, lineOffset } = context || {
    headingIdsByLine: new Map(extractHeadings(markdown).map(heading => [heading.line, heading.id])),
    lineOffset: 0,
  };
  let index = 0;

  while (index < lines.length) {
    const line = lines[index];
    if (!line.trim()) {
      index += 1;
      continue;
    }

    const fence = openingFence(line);
    if (fence) {
      const language = fence.info.split(/\s+/)[0];
      const code = [];
      index += 1;
      while (index < lines.length && !closesFence(lines[index], fence)) {
        code.push(lines[index]);
        index += 1;
      }
      index += 1;
      // Highlighted at build time with the same highlight.js languages the
      // browser registers, so a guide paints its code colored before any
      // script runs; unknown languages stay plain, exactly as in the browser.
      const highlighted = highlightCode(code.join('\n'), language || undefined);
      html.push(highlighted !== null
        ? `<pre><code class="hljs language-${escapeHtml(language)}">${highlighted}</code></pre>`
        : `<pre><code${language ? ` class="language-${escapeHtml(language)}"` : ''}>${escapeHtml(code.join('\n'))}</code></pre>`);
      continue;
    }

    if (opensHtmlComment(line)) {
      while (index < lines.length && !lines[index].includes('-->')) {
        index += 1;
      }
      index += 1;
      continue;
    }

    const heading = line.match(/^(#{2,6})\s+(.+)$/);
    if (heading) {
      const level = heading[1].length;
      const { text } = splitHeadingAnchor(heading[2]);
      const id = headingIdsByLine.get(lineOffset + index);
      if (id === undefined) {
        throw new Error(
          `Prerenderer treated line ${lineOffset + index + 1} as a heading but the Markdown parser did not: ${line}`
        );
      }
      html.push(`<h${level} id="${escapeHtml(id)}">${renderInlineMarkdown(text)}</h${level}>`);
      index += 1;
      continue;
    }

    if (line.startsWith('>')) {
      const quoted = [];
      const quoteStart = index;
      while (index < lines.length && lines[index].startsWith('>')) {
        quoted.push(lines[index].replace(/^>\s?/, ''));
        index += 1;
      }
      html.push(`<blockquote>${renderMarkdown(quoted.join('\n'), { headingIdsByLine, lineOffset: lineOffset + quoteStart })}</blockquote>`);
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
      !openingFence(lines[index]) &&
      !opensHtmlComment(lines[index]) &&
      !/^(#{2,6})\s+/.test(lines[index]) &&
      !lines[index].startsWith('>') &&
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

function renderLearnIndexFallback(learnIndex, articles) {
  const tracks = buildTrackNavigation(articles);
  return [
    '<main class="reading-shell reading-shell-index seo-learn-fallback">',
    '  <div class="reading-article learn-index">',
    '    <header class="reading-header">',
    `      <h1>${escapeHtml(learnIndex.title)}</h1>`,
    `      <p class="reading-summary">${escapeHtml(learnIndex.summary)}</p>`,
    '    </header>',
    ...tracks.map(track => [
      `    <section class="learn-track" id="track-${escapeHtml(track.id)}">`,
      `      <h2>${escapeHtml(track.label)}</h2>`,
      `      <p class="learn-track-description">${escapeHtml(track.description)}</p>`,
      '      <ol class="learn-track-list">',
      ...track.items.map(item => [
        '        <li class="learn-track-item">',
        `          <a class="learn-track-item-title" href="${escapeHtml(item.path)}">${escapeHtml(item.title)}</a>`,
        `          <p class="learn-track-item-summary">${escapeHtml(item.summary)}</p>`,
        `          <p class="learn-track-item-meta">${item.readingTimeMinutes} min read · ${escapeHtml(CONTENT_LEVEL_LABELS[item.level])}</p>`,
        '        </li>',
      ].join('\n')),
      '      </ol>',
      '    </section>',
    ].join('\n')),
    '  </div>',
    '</main>',
  ].join('\n');
}

function renderLearnArticleFallback(article, articles) {
  const related = getRelatedLearnArticles(article, articles);
  const { previous, next } = getTrackNeighbors(article, articles);
  const pager = [];
  if (previous) pager.push(`        <a class="reading-pager-link reading-pager-previous" rel="prev" href="${escapeHtml(previous.path)}">Previous: ${escapeHtml(previous.title)}</a>`);
  if (next) pager.push(`        <a class="reading-pager-link reading-pager-next" rel="next" href="${escapeHtml(next.path)}">Next: ${escapeHtml(next.title)}</a>`);
  // Mirror LearnArticlePage: a shell wrapping one article. The fallback emits
  // no outline column, so the shell stays single-column at every width.
  return [
    '<div class="reading-shell reading-shell-single seo-learn-fallback">',
    `  <article class="reading-article" data-article-slug="${escapeHtml(article.slug)}">`,
    `    <nav class="reading-breadcrumb" aria-label="Breadcrumb"><a href="/learn">Learn</a><span>/</span><span aria-current="page">${escapeHtml(article.title)}</span></nav>`,
    '    <header class="reading-header">',
    `      <h1>${escapeHtml(article.title)}</h1>`,
    `      <p class="reading-summary">${escapeHtml(article.summary)}</p>`,
    `      <p class="reading-meta">${escapeHtml(CONTENT_LEVEL_LABELS[article.level])} · ${article.readingTimeMinutes} min read · Last reviewed <time datetime="${escapeHtml(article.lastReviewed)}">${escapeHtml(article.lastReviewed)}</time></p>`,
    '    </header>',
    `    <div class="reading-prose">${renderMarkdown(getArticleBodyMarkdown(article))}</div>`,
    '    <footer class="reading-footer">',
    ...(pager.length ? ['      <nav class="reading-pager" aria-label="Track navigation">', ...pager, '      </nav>'] : []),
    '      <section class="reading-related"><h2>Related guides</h2><ul>',
    ...related.map(item => `        <li><a href="${escapeHtml(item.path)}">${escapeHtml(item.title)}</a></li>`),
    '      </ul></section>',
    '      <section class="reading-sources"><h2>Sources</h2><ul>',
    ...article.sourceLinks.map(source => `        <li><a href="${escapeHtml(source.url)}">${escapeHtml(source.title)}</a></li>`),
    '      </ul></section>',
    '    </footer>',
    '  </article>',
    '</div>',
  ].join('\n');
}

function getLearnArticleStructuredData(article, learnIndex) {
  const canonicalUrl = `${SITE_URL}${article.path}`;
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
    image: ogImageUrl(article.path),
    citation: article.sourceLinks.map(({ url }) => url),
    isPartOf: { '@type': 'CollectionPage', name: learnIndex.title, url: `${SITE_URL}/learn` },
  };
}

function renderLearnArticleHtml(indexHtml, article, articles, learnIndex = DEFAULT_LEARN_INDEX) {
  return renderStaticPageHtml(indexHtml, article.path, {
    title: getArticleMetaTitle(article),
    description: getArticleMetaDescription(article),
  }, {
    type: 'article',
    feed: true,
    structuredData: getLearnArticleStructuredData(article, learnIndex),
    fallbackHtml: renderLearnArticleFallback(article, articles),
  });
}

function renderLearnIndexHtml(indexHtml, learnIndex, articles) {
  return renderStaticPageHtml(indexHtml, '/learn', {
    title: `${learnIndex.title} | mcptest.io`,
    description: learnIndex.description,
  }, {
    feed: true,
    fallbackHtml: renderLearnIndexFallback(learnIndex, articles),
  });
}

const SHELL_FALLBACK_END = '<!-- /seo-shell-fallback -->';
const SHELL_FALLBACK_PATTERN = /<div id="root">\s*<div class="[^"]*\bseo-shell-fallback\b[\s\S]*?<!-- \/seo-shell-fallback -->\s*<\/div>/;
const LANDING_FALLBACK_PATTERN = /<div id="root">\s*<section class="landing seo-landing-fallback"[\s\S]*?<\/section>\s*<\/div>/;

function renderQuickPicks(quickPicks) {
  if (quickPicks.length === 0) return [];
  return [
    '    <div class="landing-quick-picks">',
    '      <span class="landing-quick-picks-label" id="landing-quick-picks-label">Try with</span>',
    '      <ul aria-labelledby="landing-quick-picks-label">',
    ...quickPicks.map(server => [
      `        <li><button type="button" class="landing-quick-pick" data-server-id="${escapeHtml(server.id)}" title="${escapeHtml(getPreferredCatalogEndpoint(server).url)}">`,
      `<span class="catalog-server-logo landing-quick-pick-logo" aria-hidden="true" data-catalog-server-logo="true"><img src="${escapeHtml(server.logoUrl)}" alt=""></span>`,
      `${escapeHtml(server.name)}</button></li>`,
    ].join('')),
    '      </ul>',
    '    </div>',
  ];
}

/**
 * Static copy of LandingHero: the same strings from src/content/landingCopy.ts
 * in the component's own elements and classes, including the connect form
 * and quick picks as inert markup, so the page looks the same before React
 * mounts and replaces the root.
 */
function renderLandingFallback(catalogCount, quickPicks = [], { advancedToggle = false } = {}) {
  return [
    '<section class="landing seo-landing-fallback" aria-labelledby="landing-title">',
    '  <div class="landing-hero">',
    `    <h1 id="landing-title" class="landing-title">${escapeHtml(LANDING_HEADLINE)}</h1>`,
    `    <p class="landing-lede">${escapeHtml(LANDING_LEDE)}</p>`,
    '    <div class="landing-connect">',
    '      <label for="serverUrl" class="visually-hidden">MCP endpoint URL</label>',
    '      <input id="serverUrl" type="text" inputmode="url" autocomplete="off" autocapitalize="off" spellcheck="false" class="form-control landing-connect-input" placeholder="https://example.com/mcp" value="" readonly>',
    '      <button id="connectBtn" type="button" class="btn btn-primary landing-connect-button" disabled>Connect</button>',
    '    </div>',
    ...renderQuickPicks(quickPicks),
    // TabContent passes the connection panel as LandingHero's advancedOptions.
    ...(advancedToggle
      ? ['    <button type="button" class="landing-advanced-toggle" aria-expanded="false"><i class="bi bi-gear" aria-hidden="true"></i>Advanced options<span class="landing-advanced-hint">headers, auth, proxy</span></button>']
      : []),
    '  </div>',
    `  <nav class="landing-paths" aria-label="${escapeHtml(LANDING_PATHS_LABEL)}">`,
    '    <ul>',
    ...LANDING_AUDIENCE_PATHS.map(item => [
      `      <li><a href="${escapeHtml(item.to)}" class="landing-path">`,
      `<span class="landing-path-title">${escapeHtml(item.title)}</span>`,
      `<span class="landing-path-description">${escapeHtml(item.description)}</span>`,
      '<span class="landing-path-arrow" aria-hidden="true">&rarr;</span></a></li>',
    ].join('')),
    '    </ul>',
    '  </nav>',
    '  <div class="landing-coverage">',
    `    <h2 class="landing-coverage-title">${escapeHtml(LANDING_COVERAGE_TITLE)}</h2>`,
    '    <ul>',
    ...LANDING_REPORT_COVERAGE.map(item => (
      `      <li><i class="bi bi-check2" aria-hidden="true"></i>${escapeHtml(item)}</li>`
    )),
    '    </ul>',
    '  </div>',
    '  <p class="landing-catalog">',
    `    <a href="/catalog">${escapeHtml(LANDING_CATALOG_LINK_PREFIX)} ${catalogCount} ${escapeHtml(LANDING_CATALOG_LINK_SUFFIX)} <span aria-hidden="true">&rarr;</span></a>`,
    '  </p>',
    '</section>',
  ].join('\n');
}

/**
 * Header as src/components/Header.tsx renders it while auth is loading. The
 * theme toggle carries both icons; the inline style shows the one matching
 * the data-theme that public/theme-init.js set before this paints.
 */
function renderHeaderFallback({ authEnabled }) {
  return [
    '<header class="app-header">',
    '  <div class="app-header-brand">',
    '    <button type="button" class="mobile-menu-toggle d-md-none position-relative" aria-label="Toggle navigation menu"><span class="hamburger"></span></button>',
    '    <a href="/" class="app-logo" aria-label="mcptest.io home"><img src="/logo.png" alt="MCP Logo" width="40" height="40"></a>',
    '    <a href="/" class="app-brand-copy">',
    '      <h1 class="app-brand-title">mcptest.io</h1>',
    '      <p class="app-brand-subtitle d-none d-md-block">Remote MCP Inspector</p>',
    '    </a>',
    '  </div>',
    '  <div class="app-header-actions d-none d-md-flex">',
    '    <button type="button" class="btn btn-outline-secondary app-theme-toggle" aria-label="Toggle color theme">'
      + '<i class="theme-toggle-icon bi bi-moon-stars-fill"></i><i class="theme-toggle-icon bi bi-sun-fill"></i></button>',
    ...(authEnabled
      ? ['    <button type="button" class="btn btn-sm btn-primary app-auth-placeholder" style="visibility: hidden;" aria-hidden="true" tabindex="-1" disabled>Login with Google</button>']
      : []),
    '  </div>',
    '</header>',
  ].join('\n');
}

/** Same inline style SideNav gives a dashboard with no cards to check. */
const HEALTH_INDICATOR_STYLE = 'display: inline-block; width: 12px; height: 12px; border-radius: 50%; background-color: #6c757d; flex-shrink: 0; vertical-align: middle; position: relative; top: -1px;';

function cardCountLabel(count) {
  return `${count} ${count === 1 ? 'card' : 'cards'}`;
}

/**
 * Desktop sidebar as src/components/SideNav.tsx renders it on the playground
 * for a visitor with nothing saved and the sidebar expanded: the workspace
 * and learn groups from src/content/navigationLinks.ts, the default dashboard
 * from src/utils/defaultWorkspace.ts, and the footer.
 */
function renderSideNavFallback({ learnTracks, versionInfo, year }) {
  const idSuffix = 'desktop';
  const learnPrefix = `sidenav-${idSuffix}`;
  const commitDate = new Date(versionInfo.commitDate);
  const updated = `${commitDate.toLocaleDateString('en-US', { month: 'short', day: 'numeric', year: 'numeric' })} ${commitDate.toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' })}`;
  const sidenavLink = (item, className, extra = '') => (
    `<a href="${escapeHtml(item.path)}" class="${className}"${extra}><i class="bi ${escapeHtml(item.icon)} sidenav-icon" aria-hidden="true"></i><span class="sidenav-label">${escapeHtml(item.label)}</span></a>`
  );
  return [
    `<nav id="app-sidenav-${idSuffix}" class="app-sidenav d-flex flex-column flex-grow-1" aria-label="Main">`,
    `  <section class="sidenav-group" aria-labelledby="workspace-nav-heading-${idSuffix}">`,
    `    <h2 id="workspace-nav-heading-${idSuffix}" class="sidenav-section-label">Workspace</h2>`,
    '    <ul class="sidenav-list">',
    ...PRIMARY_NAVIGATION.map(item => {
      const active = item.path === '/';
      return `      <li class="nav-item">${sidenavLink(item, `nav-link sidenav-link${active ? ' active' : ''}`, active ? ' aria-current="page"' : '')}</li>`;
    }),
    '      <li class="nav-item sidenav-dashboards">',
    '        <div class="sidenav-group-header">',
    `          <button type="button" class="nav-link sidenav-link sidenav-group-toggle" aria-expanded="true" aria-controls="sidenav-dashboards-${idSuffix}"><i class="bi ${escapeHtml(DASHBOARDS_NAVIGATION.icon)} sidenav-icon" aria-hidden="true"></i><span class="sidenav-label">${escapeHtml(DASHBOARDS_NAVIGATION.label)}</span><i class="bi bi-chevron-right sidenav-chevron" aria-hidden="true"></i></button>`,
    '          <div class="sidenav-group-actions">',
    '            <button type="button" class="btn btn-sm btn-ghost sidenav-action" title="Refresh health status" aria-label="Refresh health status of all dashboards"><i class="bi bi-arrow-clockwise" aria-hidden="true"></i></button>',
    '            <button type="button" class="btn btn-sm btn-ghost sidenav-action" title="Create new dashboard" aria-label="Create new dashboard"><i class="bi bi-plus-lg" aria-hidden="true"></i></button>',
    '          </div>',
    '        </div>',
    `        <div id="sidenav-dashboards-${idSuffix}" class="sidenav-dashboards-body">`,
    '          <ul class="nav flex-column dashboard-list" role="listbox" aria-label="Dashboards">',
    ...createDefaultSpaces().map(space => [
      '            <li class="nav-item" tabindex="-1" role="option" aria-selected="false">',
      `<a href="${escapeHtml(getSpaceUrl(space.name))}" class="dashboard-link nav-link sidenav-sublink py-1 d-flex align-items-center" style="cursor: move; opacity: 1; user-select: none;">`,
      `<span class="me-2 health-indicator health-indicator-gray" title="No cards to check" style="${HEALTH_INDICATOR_STYLE}"></span>`,
      `<span class="dashboard-name flex-grow-1 text-truncate" title="${escapeHtml(space.name)}">${escapeHtml(space.name)}</span>`,
      `<span class="dashboard-card-count">${cardCountLabel(space.cards.length)}</span></a></li>`,
    ].join('')),
    '          </ul>',
    '        </div>',
    '      </li>',
    '    </ul>',
    '  </section>',
    `  <section class="sidenav-group content-track-nav" aria-labelledby="${learnPrefix}-learn-heading">`,
    `    <h2 id="${learnPrefix}-learn-heading" class="sidenav-section-label">Learn</h2>`,
    // The guide search field, inert until React mounts, so the tracks below it do not shift.
    `    <div class="guide-search guide-search--sidebar" role="search" aria-label="Guides"><div class="guide-search-field"><i class="bi bi-search guide-search-icon" aria-hidden="true"></i><input type="search" class="guide-search-input" placeholder="Search guides" aria-label="Search guides" role="combobox" aria-expanded="false" aria-controls="${learnPrefix}-guide-search-results" aria-autocomplete="list" autocomplete="off" spellcheck="false"></div><p class="guide-search-status visually-hidden" role="status" aria-live="polite"></p><div id="${learnPrefix}-guide-search-results" class="guide-search-results" role="listbox" aria-label="Guide search results" hidden></div></div>`,
    '    <ul class="sidenav-list">',
    `      <li class="nav-item">${sidenavLink(LEARN_HUB_NAVIGATION, 'nav-link sidenav-link')}</li>`,
    ...learnTracks.map(track => [
      `      <li class="nav-item content-track" data-track="${escapeHtml(track.id)}">`,
      `<button type="button" class="nav-link sidenav-link sidenav-group-toggle content-track-label" aria-expanded="false" aria-controls="${learnPrefix}-track-${escapeHtml(track.id)}"><i class="bi ${escapeHtml(track.icon)} sidenav-icon" aria-hidden="true"></i><span class="sidenav-label">${escapeHtml(track.label)}</span><i class="bi bi-chevron-right sidenav-chevron" aria-hidden="true"></i></button>`,
      `<ul id="${learnPrefix}-track-${escapeHtml(track.id)}" class="sidenav-list sidenav-sublist" aria-label="${escapeHtml(track.label)} guides" hidden>`,
      ...track.items.map(item => (
        `<li class="nav-item"><a href="${escapeHtml(item.path)}" class="nav-link sidenav-link sidenav-sublink">${escapeHtml(item.navTitle)}</a></li>`
      )),
      '</ul></li>',
    ].join('')),
    '    </ul>',
    '  </section>',
    '  <div class="sidenav-footer">',
    '    <ul class="sidenav-footer-links" aria-label="Project links">',
    ...FOOTER_NAVIGATION.map(link => (link.external
      ? `      <li><a href="${escapeHtml(link.href)}" target="_blank" rel="noopener noreferrer" class="sidenav-footer-link">${escapeHtml(link.label)}<span class="visually-hidden"> (opens in a new tab)</span></a></li>`
      : `      <li><a href="${escapeHtml(link.href)}" class="sidenav-footer-link">${escapeHtml(link.label)}</a></li>`
    )),
    '    </ul>',
    '    <div class="sidenav-legal">',
    ...LEGAL_NAVIGATION.map(link => (
      `      <a href="${escapeHtml(link.href)}" class="sidenav-footer-link">${escapeHtml(link.label)}</a>`
    )),
    '    </div>',
    `    <p class="sidenav-build"><span>&copy; ${year} Unchained Development OÜ</span><span>Updated <a href="${escapeHtml(getGithubCommitUrl(versionInfo.commitHash))}" target="_blank" rel="noopener noreferrer" class="sidenav-footer-link"><time datetime="${escapeHtml(versionInfo.commitDate)}">${escapeHtml(updated)}</time></a></span></p>`,
    `    <button type="button" class="sidenav-collapse-toggle" aria-expanded="true" aria-controls="app-sidenav-${idSuffix}" aria-label="Collapse sidebar" title="Collapse sidebar"><i class="bi bi-chevron-double-left" aria-hidden="true"></i><span class="sidenav-label">Collapse</span></button>`,
    '  </div>',
    '</nav>',
  ].join('\n');
}

/**
 * The full first frame of the home page: header, sidebar, playground tab
 * strip and landing, in the elements and classes App.tsx renders for a
 * first-time visitor. React replaces it in one commit when it mounts.
 * The mobile drawer is omitted; it is off-screen until opened.
 */
function renderShellFallback({
  catalogCount,
  quickPicks = [],
  learnTracks = [],
  authEnabled = false,
  versionInfo = VERSION_INFO,
  year = new Date().getFullYear(),
}) {
  const [tab] = createDefaultTabs();
  return [
    '<div class="app-shell container-fluid vh-100 d-flex flex-column p-0 seo-shell-fallback">',
    '<style>',
    ":root[data-theme='dark'] .seo-shell-fallback .theme-toggle-icon.bi-moon-stars-fill,",
    ":root:not([data-theme='dark']) .seo-shell-fallback .theme-toggle-icon.bi-sun-fill { display: none; }",
    '</style>',
    renderHeaderFallback({ authEnabled }),
    '<main class="app-workspace flex-grow-1 d-flex overflow-hidden" role="main">',
    '<div class="desktop-sidebar col-auto p-2 d-flex flex-column">',
    renderSideNavFallback({ learnTracks, versionInfo, year }),
    '</div>',
    '<div class="main-content col overflow-auto p-3 position-relative">',
    '<div class="view-panel" style="height: 100%;">',
    '<div class="h-100 d-flex flex-column">',
    '<div class="playground-tabs-wrapper">',
    '<div class="playground-tab-strip">',
    '<div class="nav nav-tabs playground-tabs" role="tablist">',
    '<div class="nav-item position-relative" role="presentation">'
      + `<button type="button" class="nav-link active active-tab-override" role="tab" aria-selected="true" title="${escapeHtml(tab.title)}">`
      + '<span class="me-2 playground-tab-status" style="width: 8px; height: 8px; border-radius: 50%; background-color: #6c757d; display: inline-block;"></span>'
      + `<span class="playground-tab-label">${escapeHtml(tab.title)}</span></button></div>`,
    '<div class="nav-item" role="presentation"><button type="button" class="nav-link playground-tab-new">+ New</button></div>',
    '</div>',
    '</div>',
    '</div>',
    '<div class="flex-grow-1 position-relative">',
    '<div class="tab-content-panel" style="height: 100%; position: static; top: 0; left: 0; right: 0; bottom: 0; display: flex; flex-direction: column;">',
    renderLandingFallback(catalogCount, quickPicks, { advancedToggle: true }),
    '</div>',
    '</div>',
    '</div>',
    '</div>',
    '</div>',
    '</main>',
    '</div>',
    SHELL_FALLBACK_END,
  ].join('\n');
}

/**
 * dist/index.html is both the home page and the shell every other page is
 * rendered from. Running the generator twice must not copy the home page's
 * fallback into other pages, so a previous run's fallback is removed first.
 */
function stripLandingFallback(indexHtml) {
  const html = indexHtml
    .replace(SHELL_FALLBACK_PATTERN, '<div id="root"></div>')
    .replace(LANDING_FALLBACK_PATTERN, '<div id="root"></div>');
  if (!html.includes('<div id="root"></div>')) {
    throw new Error('dist/index.html has no empty <div id="root"></div>; rebuild with Vite before generating SEO pages.');
  }
  return html;
}

function renderHomeHtml(indexHtml, homeMetadata, catalogCount, shellOptions = {}) {
  return renderStaticPageHtml(indexHtml, '/', homeMetadata, {
    fallbackHtml: renderShellFallback({ catalogCount, ...shellOptions }),
  });
}

/**
 * Fonts the first frame paints with: Inter's latin subset for the text, and
 * the icon font, which is `font-display: block` and moves the sidebar labels
 * when it arrives.
 */
const FIRST_FRAME_FONTS = [
  { label: 'Inter latin', pattern: /^\/assets\/inter-latin-wght-normal-[\w-]+\.woff2(?:\?[\w=&-]*)?$/ },
  { label: 'Bootstrap Icons', pattern: /^\/assets\/bootstrap-icons-[\w-]+\.woff2(?:\?[\w=&-]*)?$/ },
];
const FONT_PRELOAD_PATTERN = /<link rel="preload" href="[^"]*" as="font"[^>]*>\n\s*/g;

/**
 * Font URLs exactly as the production stylesheets request them (hash and
 * query included), so the preload and the @font-face fetch share one request.
 */
function findFirstFrameFontAssets(assetsDirectory) {
  const stylesheets = fs.existsSync(assetsDirectory)
    ? fs.readdirSync(assetsDirectory).filter(name => name.endsWith('.css'))
    : [];
  const urls = new Set(stylesheets.flatMap(name => Array.from(
    fs.readFileSync(path.join(assetsDirectory, name), 'utf8').matchAll(/url\(\s*["']?([^"')]+)["']?\s*\)/g),
    match => match[1]
  )));
  return FIRST_FRAME_FONTS.map(({ label, pattern }) => {
    const matches = [...urls].filter(url => pattern.test(url));
    if (matches.length !== 1) {
      throw new Error(`Expected one ${label} woff2 referenced from ${assetsDirectory}/*.css, found ${matches.length ? matches.join(', ') : 'none'}.`);
    }
    return matches[0];
  });
}

/**
 * Preloads the first frame's fonts so text paints in Inter rather than
 * swapping in after a fallback-font frame. Placed before the scripts and
 * stylesheets so the requests start as soon as the head is parsed;
 * idempotent across reruns.
 */
function addFontPreloads(indexHtml, fontHrefs) {
  const html = indexHtml.replace(FONT_PRELOAD_PATTERN, '');
  const tags = fontHrefs.map(href => (
    `<link rel="preload" href="${escapeHtml(href)}" as="font" type="font/woff2" crossorigin />\n    `
  )).join('');
  const anchor = html.search(/<script type="module"|<link rel="stylesheet"/);
  if (anchor === -1) return html.replace('</head>', `    ${tags}</head>`);
  return `${html.slice(0, anchor)}${tags}${html.slice(anchor)}`;
}

/** Reads a VITE_ build flag the way Vite does: process env first, then .env files. */
function readBuildEnv(name, mode = 'production') {
  if (process.env[name] !== undefined) return process.env[name];
  for (const file of [`.env.${mode}.local`, '.env.local', `.env.${mode}`, '.env']) {
    const envPath = path.join(projectRoot, file);
    if (!fs.existsSync(envPath)) continue;
    const match = fs.readFileSync(envPath, 'utf8').match(new RegExp(`^\\s*${name}\\s*=\\s*["']?([^"'\\r\\n#]*)`, 'm'));
    if (match) return match[1].trim();
  }
  return undefined;
}

function renderCatalogHtml(indexHtml, catalogMetadata) {
  return renderStaticPageHtml(indexHtml, '/catalog', catalogMetadata);
}

/** Prerendered `/catalog/<slug>`: metadata, CollectionPage JSON-LD and the static category body. */
function renderCategoryHtml(indexHtml, summary, { summaries, servers, articles }) {
  const seo = getCatalogCategorySeo(summary);
  return renderStaticPageHtml(indexHtml, summary.path, seo, {
    structuredData: seo.structuredData,
    fallbackHtml: renderCategoryFallback({ summary, summaries, servers, articles }),
  });
}

/** Title without the trailing `| mcptest.io` suffix, for image cards. */
function stripSiteSuffix(title) {
  return title.replace(/\s*\|\s*mcptest\.io$/i, '');
}

/** One Open Graph card per prerendered page. */
function buildOgCards({ servers, articles, pageMetadata }) {
  const categoryCards = summarizeCatalogCategories(servers).map(summary => ({
    pagePath: summary.path,
    eyebrow: 'Server catalog',
    title: `${summary.category} MCP servers`,
    summary: getCatalogCategorySeo(summary).description,
  }));
  const cards = [
    { pagePath: '/', title: LANDING_HEADLINE, summary: LANDING_LEDE },
    {
      pagePath: '/catalog',
      eyebrow: 'Server catalog',
      title: stripSiteSuffix(pageMetadata.catalog.title),
      summary: `${servers.length} public remote MCP servers. ${pageMetadata.catalog.description}`,
    },
    ...categoryCards,
    { pagePath: '/learn', eyebrow: 'Guides', title: pageMetadata.learn.title, summary: pageMetadata.learn.description },
    ...Object.entries(pageMetadata.docs).map(([slug, metadata]) => ({
      pagePath: `/docs/${slug}`,
      title: stripSiteSuffix(metadata.title),
      summary: metadata.description,
    })),
    ...articles.map(article => ({
      pagePath: article.path,
      eyebrow: `Guide · ${getTrack(article.track)?.label || article.category}`,
      title: article.title,
      summary: article.summary,
    })),
    ...servers.map(server => ({
      pagePath: serverPath(server.id),
      eyebrow: `MCP server · ${server.category}`,
      title: server.name,
      summary: server.description,
      ...(isLocalServerLogo(server.logoUrl)
        ? { logoFile: path.join(publicRoot, ...server.logoUrl.split('/').filter(Boolean)) }
        : { initials: serverInitials(server.name) }),
    })),
  ];
  for (const card of cards) {
    if (card.logoFile && !card.logoFile.startsWith(publicRoot + path.sep)) {
      throw new Error(`Server logo resolves outside public/: ${card.logoFile}`);
    }
  }
  return cards;
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

/** `/catalog/<slug>` as catalog/<slug>.html, served without a trailing slash like catalog.html. */
function writeCategoryPages(indexHtml, servers, articles) {
  const summaries = summarizeCatalogCategories(servers);
  fs.mkdirSync(path.join(distRoot, 'catalog'), { recursive: true });
  for (const summary of summaries) {
    fs.writeFileSync(
      `${distPathFor(summary.path)}.html`,
      renderCategoryHtml(indexHtml, summary, { summaries, servers, articles }),
      'utf8'
    );
  }
  return summaries.length;
}

/** React-only documentation pages (privacy, terms, contact) keep their metadata in pageMetadata.json. */
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

function distPathFor(pathname) {
  const resolved = path.join(distRoot, ...pathname.split('/').filter(Boolean));
  if (!resolved.startsWith(distRoot + path.sep)) {
    throw new Error(`Refusing to write outside dist: ${pathname}`);
  }
  return resolved;
}

/** Prerendered HTML plus raw Markdown for every article, at its canonical path. */
function writeArticlePages(indexHtml, learnIndex, articles) {
  const learnDirectory = path.join(distRoot, 'learn');
  fs.mkdirSync(learnDirectory, { recursive: true });
  fs.writeFileSync(
    path.join(learnDirectory, 'index.html'),
    renderLearnIndexHtml(indexHtml, learnIndex, articles),
    'utf8'
  );

  for (const article of articles) {
    const outputDirectory = distPathFor(article.path);
    fs.mkdirSync(outputDirectory, { recursive: true });
    fs.writeFileSync(
      path.join(outputDirectory, 'index.html'),
      renderLearnArticleHtml(indexHtml, article, articles, learnIndex),
      'utf8'
    );
    fs.writeFileSync(distPathFor(articleMarkdownPath(article)), renderArticleMarkdown(article), 'utf8');
  }
}

function writeHomeAndCatalogPages(indexHtml, pageMetadata, catalogCount, shellOptions) {
  // catalog.html, not catalog/index.html: hosts serve /catalog from it without
  // a trailing-slash redirect, and the app matches /catalog exactly.
  fs.writeFileSync(path.join(distRoot, 'catalog.html'), renderCatalogHtml(indexHtml, pageMetadata.catalog), 'utf8');
  fs.writeFileSync(indexPath, renderHomeHtml(indexHtml, pageMetadata.home, catalogCount, shellOptions), 'utf8');
}

function writeLearnFeed(articles, learnIndex) {
  fs.writeFileSync(distPathFor(FEED_PATH), renderLearnFeed(articles, learnIndex), 'utf8');
}

/** The guide search index the sidebar and /learn search fetch on first use. */
function writeSearchIndex(articles) {
  fs.writeFileSync(distPathFor(SEARCH_INDEX_PATH), serializeSearchIndex(buildSearchIndex(articles)), 'utf8');
}

function writeLlmsTxt(articles) {
  fs.writeFileSync(path.join(distRoot, 'llms.txt'), renderLlmsTxt(articles), 'utf8');
}

function renderSitemap(servers, articles, lastModified = new Date().toISOString().slice(0, 10)) {
  const staticPaths = ['/', '/catalog', '/report', '/learn'];
  const categoryPaths = summarizeCatalogCategories(servers.filter(server => server.category))
    .map(summary => summary.path);
  const paths = [
    ...staticPaths.map(pathname => ({ pathname, lastModified })),
    ...categoryPaths.map(pathname => ({ pathname, lastModified })),
    ...articles.map(article => ({
      pathname: article.path,
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
  return [
    '<?xml version="1.0" encoding="UTF-8"?>',
    '<urlset xmlns="http://www.sitemaps.org/schemas/sitemap/0.9">',
    ...entries,
    '</urlset>',
    '',
  ].join('\n');
}

function writeSitemap(servers, articles) {
  fs.writeFileSync(path.join(distRoot, 'sitemap.xml'), renderSitemap(servers, articles), 'utf8');
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
  const categoriesBySlug = new Map();
  for (const category of getCatalogCategoryNames(servers)) {
    const slug = getCatalogCategorySlug(category);
    if (!slug) throw new Error(`Catalog category has no URL slug: ${category}`);
    if (categoriesBySlug.has(slug)) {
      throw new Error(`Catalog categories ${categoriesBySlug.get(slug)} and ${category} share the slug ${slug}`);
    }
    categoriesBySlug.set(slug, category);
  }
}

function assertExactKeys(value, allowed, label) {
  if (!value || typeof value !== 'object' || Array.isArray(value)) {
    throw new Error(`${label} must be an object.`);
  }
  for (const key of Object.keys(value)) {
    if (!allowed.includes(key)) throw new Error(`${label} contains unsafe field ${key}.`);
  }
}

function assertSafeInventoryString(value, maxLength, label, optional = false) {
  if (value === undefined && optional) return;
  if (typeof value !== 'string' || !value || value.length > maxLength
      || /[\u0000-\u001f\u007f-\u009f]/.test(value)
      || value !== value.replace(/\s+/g, ' ').trim()) {
    throw new Error(`${label} is not a canonical public-safe string.`);
  }
  const sanitized = value
    .replace(/\b(authorization|cookie|password|passwd|secret|client[_ -]?secret|access[_ -]?token|refresh[_ -]?token|id[_ -]?token|api[_ -]?key|private[_ -]?key|credential|session|token)\s*[:=]\s*(?:\[REDACTED\]|"(?:\\.|[^"\\])*"|'(?:\\.|[^'\\])*'|[^\s,;&]+)/gi, '$1=[REDACTED]')
    .replace(/\b(Bearer|Basic)\s+[A-Za-z0-9._~+/=-]+/gi, '$1 [REDACTED]')
    .replace(/\beyJ[A-Za-z0-9_-]*\.[A-Za-z0-9_-]+\.[A-Za-z0-9_-]+\b/g, '[REDACTED]')
    .replace(STANDALONE_CREDENTIAL, '[REDACTED]')
    .replace(/\b[A-Za-z][A-Za-z0-9+.-]*:\/\/[^\s<>]+/g, '[REDACTED URI]');
  if (sanitized !== value) throw new Error(`${label} contains unsanitized data.`);
}

function validateCapabilitySnapshots(snapshots, seeds) {
  assertExactKeys(snapshots, Object.keys(snapshots), 'Catalog capability snapshots');
  const seedsById = new Map(seeds.map(seed => [seed.id, seed]));
  const identifier = /^[A-Za-z0-9](?:[A-Za-z0-9._/-]{0,127})$/;
  const statuses = new Set(['complete', 'partial', 'unsupported', 'unavailable']);
  const validateArgument = (argument, label) => {
    assertExactKeys(argument, ['name', 'type', 'description', 'required'], label);
    assertSafeInventoryString(argument.name, 128, `${label} name`);
    if (!identifier.test(argument.name)) throw new Error(`${label} has an invalid name.`);
    assertSafeInventoryString(argument.type, 64, `${label} type`, true);
    if (argument.type && !argument.type.split(' | ').every(type => (
      ['array', 'boolean', 'integer', 'null', 'number', 'object', 'string'].includes(type)
    ))) throw new Error(`${label} type is invalid.`);
    assertSafeInventoryString(argument.description, 600, `${label} description`, true);
    if (typeof argument.required !== 'boolean') throw new Error(`${label} required flag is invalid.`);
  };
  for (const [serverId, inventory] of Object.entries(snapshots)) {
    if (!seedsById.has(serverId)) throw new Error(`Capability snapshot references unknown server id: ${serverId}`);
    assertExactKeys(inventory, ['version', 'observedAt', 'provenance', 'authentication', 'tools', 'resources', 'resourceTemplates', 'prompts'], `${serverId} inventory`);
    if (inventory.version !== 1 || Number.isNaN(Date.parse(inventory.observedAt))) {
      throw new Error(`${serverId} inventory version or timestamp is invalid.`);
    }
    assertExactKeys(inventory.provenance, ['testedEndpoint', 'route'], `${serverId} provenance`);
    const endpoint = new URL(inventory.provenance.testedEndpoint);
    const seedOrigin = new URL(seedsById.get(serverId).url).origin;
    const endpointContainsCredential = [endpoint.pathname, ...endpoint.searchParams.values()]
      .some(containsStandaloneCredential);
    if (!['http:', 'https:'].includes(endpoint.protocol) || endpoint.origin !== seedOrigin
        || endpoint.username || endpoint.password || endpoint.hash
        || endpointContainsCredential
        || [...endpoint.searchParams.keys()].some(key => (
          /(?:auth|code|cookie|credential|key|password|secret|session|signature|token)/i.test(key)
          || /^(?:sig|x-amz-credential)$/i.test(key)
        ))) {
      throw new Error(`${serverId} inventory endpoint does not match its catalog origin.`);
    }
    if (!['direct', 'authenticated-proxy'].includes(inventory.provenance.route)
        || !['authenticated', 'unauthenticated'].includes(inventory.authentication)) {
      throw new Error(`${serverId} inventory provenance is invalid.`);
    }
    for (const category of ['tools', 'resources', 'resourceTemplates', 'prompts']) {
      const section = inventory[category];
      assertExactKeys(section, ['status', 'observedCount', 'retainedCount', 'omittedCount', 'paginationComplete', 'items'], `${serverId} ${category}`);
      if (!statuses.has(section.status) || !Array.isArray(section.items) || section.items.length > 100
          || ![section.observedCount, section.retainedCount, section.omittedCount].every(Number.isInteger)
          || section.retainedCount !== section.items.length
          || section.observedCount !== section.retainedCount + section.omittedCount
          || typeof section.paginationComplete !== 'boolean') {
        throw new Error(`${serverId} ${category} metadata is invalid.`);
      }
      for (const [index, item] of section.items.entries()) {
        const label = `${serverId} ${category}[${index}]`;
        const itemKeys = category === 'tools'
          ? ['name', 'description', 'input', 'outputSchema']
          : category === 'prompts'
            ? ['name', 'description', 'arguments']
            : ['name', 'title', 'description', 'mimeType'];
        assertExactKeys(item, itemKeys, label);
        assertSafeInventoryString(item.name, 128, `${label} name`);
        if (/[<>]/.test(item.name) || /\b[A-Za-z][A-Za-z0-9+.-]*:\/\//.test(item.name)) {
          throw new Error(`${label} has an unsafe name.`);
        }
        if ((category === 'tools' || category === 'prompts') && !identifier.test(item.name)) {
          throw new Error(`${label} has an invalid name.`);
        }
        if (item.outputSchema !== undefined && typeof item.outputSchema !== 'boolean') {
          throw new Error(`${label} outputSchema flag is invalid.`);
        }
        assertSafeInventoryString(item.title, 200, `${label} title`, true);
        assertSafeInventoryString(item.description, 600, `${label} description`, true);
        assertSafeInventoryString(item.mimeType, 128, `${label} MIME type`, true);
        if (item.mimeType && !/^[A-Za-z0-9!#$&^_.+-]+\/[A-Za-z0-9!#$&^_.+-]+(?:\s*;\s*charset=[A-Za-z0-9._-]+)?$/i.test(item.mimeType)) {
          throw new Error(`${label} MIME type is invalid.`);
        }
        const argumentsList = category === 'tools' ? item.input : item.arguments;
        if (argumentsList !== undefined) {
          if (!Array.isArray(argumentsList) || argumentsList.length > 32) {
            throw new Error(`${label} arguments are invalid.`);
          }
          argumentsList.forEach((argument, argumentIndex) => (
            validateArgument(argument, `${label} argument[${argumentIndex}]`)
          ));
          const argumentNames = argumentsList.map(argument => argument.name.toLowerCase());
          if (new Set(argumentNames).size !== argumentNames.length
              || argumentsList.some((argument, argumentIndex) => argumentIndex > 0
                && argumentsList[argumentIndex - 1].name.localeCompare(argument.name, 'en-US') > 0)) {
            throw new Error(`${label} arguments are not deterministically ordered and unique.`);
          }
        }
      }
      const itemNames = section.items.map(item => item.name.toLowerCase());
      if (new Set(itemNames).size !== itemNames.length
          || section.items.some((item, index) => index > 0
            && section.items[index - 1].name.localeCompare(item.name, 'en-US') > 0)) {
        throw new Error(`${serverId} ${category} items are not deterministically ordered and unique.`);
      }
      if (Buffer.byteLength(JSON.stringify(section), 'utf8') > 32_000) {
        throw new Error(`${serverId} ${category} exceeds the section byte limit.`);
      }
    }
    if (Buffer.byteLength(JSON.stringify(inventory), 'utf8') > 96_000) {
      throw new Error(`${serverId} inventory exceeds the aggregate byte limit.`);
    }
  }
}

function validateLearnIndex(learnIndex) {
  if (!learnIndex?.title || !learnIndex?.description || !learnIndex?.summary) {
    throw new Error('Learn SEO generation requires complete index metadata.');
  }
}

function validatePageMetadata(pageMetadata) {
  for (const key of ['home', 'catalog']) {
    if (!pageMetadata[key]?.title || !pageMetadata[key]?.description) {
      throw new Error(`pageMetadata.json requires a title and description for ${key}.`);
    }
  }
}

async function main() {
  if (!fs.existsSync(indexPath)) {
    throw new Error('dist/index.html is missing; run Vite before generating SEO pages.');
  }

  const seeds = JSON.parse(fs.readFileSync(catalogPath, 'utf8'));
  const validationResults = JSON.parse(fs.readFileSync(validationPath, 'utf8'));
  const capabilitySnapshots = JSON.parse(fs.readFileSync(capabilitiesPath, 'utf8'));
  const pageMetadata = JSON.parse(fs.readFileSync(pageMetadataPath, 'utf8'));
  const learnIndex = pageMetadata.learn;
  validateInputs(seeds);
  validateCapabilitySnapshots(capabilitySnapshots, seeds);
  validateLearnIndex(learnIndex);
  validatePageMetadata(pageMetadata);
  const articles = loadArticles({
    reservedPaths: Object.keys(pageMetadata.docs).map(slug => `/docs/${slug}`),
  });
  const servers = mergeCatalogServers(seeds, validationResults, capabilitySnapshots);
  const fontHrefs = findFirstFrameFontAssets(path.join(distRoot, 'assets'));
  const indexHtml = addFontPreloads(stripLandingFallback(fs.readFileSync(indexPath, 'utf8')), fontHrefs);
  const shellOptions = {
    quickPicks: selectLandingQuickPicks(servers),
    learnTracks: buildLearnTrackNavigation(buildTrackNavigation(articles)),
    authEnabled: readBuildEnv('VITE_FIREBASE_AUTH_ENABLED') === 'true',
  };

  writeServerPages(indexHtml, servers);
  const categoryCount = writeCategoryPages(indexHtml, servers, articles);
  writeStaticPages(indexHtml, pageMetadata.docs);
  writeArticlePages(indexHtml, learnIndex, articles);
  // Last: overwrites the shell the pages above were rendered from.
  writeHomeAndCatalogPages(indexHtml, pageMetadata, servers.length, shellOptions);
  writeLearnFeed(articles, learnIndex);
  writeSearchIndex(articles);
  writeLlmsTxt(articles);
  writeSitemap(servers, articles);

  const ogStartedAt = Date.now();
  const cards = buildOgCards({ servers, articles, pageMetadata });
  const og = await writeOgImages(cards, { distRoot });

  console.log(`Generated ${servers.length} server profile documents, ${categoryCount} catalog category pages, ${Object.keys(pageMetadata.docs).length} documentation documents, ${articles.length} Markdown articles (HTML + .md), the home and catalog pages, learn/feed.xml, learn/search-index.json, llms.txt, sitemap.xml, and robots.txt.`);
  console.log(`Open Graph images: ${cards.length} (${og.rendered} rendered, ${og.cached} from cache) in ${((Date.now() - ogStartedAt) / 1000).toFixed(1)}s.`);
}

if (require.main === module || process.argv[1] === __filename) {
  main().catch(error => {
    console.error(error);
    process.exitCode = 1;
  });
}

module.exports = {
  buildOgCards,
  loadArticles,
  mergeCatalogServers,
  renderArticleMarkdown,
  renderCatalogHtml,
  renderCategoryHtml,
  renderHomeHtml,
  addFontPreloads,
  findFirstFrameFontAssets,
  renderLandingFallback,
  renderShellFallback,
  renderLearnArticleHtml,
  renderLearnIndexHtml,
  renderLlmsTxt,
  renderMarkdown,
  renderServerHtml,
  renderServerLogo,
  renderClientSetups,
  renderAuthorizationSetup,
  renderSitemap,
  renderStaticPageHtml,
  serverPath,
  stripLandingFallback,
  transportLabel,
  validateCapabilitySnapshots,
};
