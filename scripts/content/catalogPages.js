/**
 * Static HTML for the catalog category pages, the server-page "Connect it"
 * section and tool inventory. Mirrors CatalogView, CatalogServerCard,
 * CatalogCategoryDetails, ServerConnect and ServerToolInventory (same
 * elements and classes) so the prerendered
 * page reads the same before React mounts and replaces the root. The text
 * itself comes from the shared src/utils modules the components use.
 */
const { getPreferredCatalogEndpoint } = require('../../src/utils/clientSetup.ts');
const {
  CATALOG_PATH,
  getCatalogCategoryIntro,
  getCatalogCategoryNeighbors,
  getCatalogCategoryPath,
} = require('../../src/utils/catalogCategories.ts');
const {
  formatArgumentSignature,
  formatInputSummary,
  formatOutputSchemaPresence,
  formatSnapshotDate,
  getMissingInventoryNotice,
} = require('../../src/utils/toolInventory.ts');
const { getCategoryGuideSlugs } = require('../../src/content/categoryGuides.ts');
const {
  SERVER_CONNECT_TITLE_ID,
  createServerConnectModel,
  splitInlineCode,
} = require('../../src/utils/serverConnect.ts');
const { CLIENT_COMPATIBILITY_DATA_URL } = require('../../src/content/compatMatrix.ts');
const {
  formatCatalogAuth,
  formatCatalogTransport,
  formatProtocolEra,
  getCatalogServerPath,
  getEffectiveCatalogTransport,
} = require('../../src/utils/catalogSeo.ts');

function escapeHtml(value) {
  return String(value)
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;');
}

function playgroundPath(server) {
  const endpoint = getPreferredCatalogEndpoint(server);
  const transportMethod = endpoint.transport === 'legacy-sse' ? 'sse' : 'mcp';
  return `/server/${endpoint.url}/${transportMethod}`;
}

function initials(name) {
  const words = String(name).match(/[\p{L}\p{N}]+/gu) || [];
  const value = words.length > 1 ? `${words[0][0]}${words[1][0]}` : words[0]?.slice(0, 2) || '?';
  return value.toLocaleUpperCase();
}

function renderRowLogo(server) {
  if (typeof server.logoUrl === 'string' && server.logoUrl.startsWith('/server-logos/')) {
    return `<span class="catalog-server-logo catalog-server-card-logo flex-shrink-0" aria-hidden="true" data-catalog-server-logo="true"><img src="${escapeHtml(server.logoUrl)}" alt="" width="40" height="40" loading="lazy" decoding="async" /></span>`;
  }
  return `<span class="catalog-server-logo catalog-server-card-logo flex-shrink-0 catalog-server-logo--fallback" role="img" aria-label="${escapeHtml(server.name)} logo" data-catalog-server-logo="true"><span class="catalog-server-logo-initials" aria-hidden="true">${escapeHtml(initials(server.name))}</span></span>`;
}

const LISTING_SOURCE_LABELS = {
  publisher: 'Publisher',
  'mcp-registry': 'MCP Registry',
  'community-submission': 'Community submission',
  community: 'Community',
};

function statusLabel(server) {
  if (server.status === 'online') return 'Online';
  if (server.status === 'offline') return 'Offline when last tested';
  return server.checkedAt ? 'Inconclusive when last tested' : 'Validation pending';
}

function transportBadges(server) {
  const transport = getEffectiveCatalogTransport(server);
  if (transport === 'streamable-http') return ['HTTP'];
  if (transport === 'legacy-sse') return ['SSE'];
  if (transport === 'both') return ['HTTP', 'SSE'];
  return ['Unknown transport'];
}

function hostname(url) {
  try {
    return new URL(url).hostname;
  } catch {
    return url;
  }
}

// Keep the source link and its icon: its width affects the title row on mount.
function renderListingSource(server) {
  const label = escapeHtml(LISTING_SOURCE_LABELS[server.listingSource?.kind] || 'Community');
  if (!server.listingSource?.url) return `<span class="catalog-listing-source">${label}</span>`;
  return `<a class="catalog-listing-source" href="${escapeHtml(server.listingSource.url)}" target="_blank" rel="noopener noreferrer">${label}<svg class="catalog-listing-source-icon" viewBox="0 0 24 24" aria-hidden="true" focusable="false"><path d="M15 3h6v6M10 14l11-11M18 13v6a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2V8a2 2 0 0 1 2-2h6"/></svg></a>`;
}

/** The unfiltered catalog's first frame. Controls become active when React mounts. */
function renderCatalogFallback({ servers, summaries }) {
  const select = (field, label, options) => `<div class="catalog-${field}-field"><label class="visually-hidden" for="catalog-${field}">${label}</label><select id="catalog-${field}" class="form-select" inert>${options.map(([value, text], index) => `<option value="${escapeHtml(value)}"${index === 0 ? ' selected' : ''}>${escapeHtml(text)}</option>`).join('')}</select></div>`;
  return [
    '<div class="catalog-view"><div class="catalog-command-bar"><div class="catalog-command-copy">',
    '<h1 class="mb-1">Remote MCP server catalog</h1><p class="text-muted mb-0">Inspect transport, protocol era, and authentication before you connect.</p>',
    `<div class="catalog-results-bar" aria-live="polite"><p class="catalog-results-count">Showing <strong>${servers.length}</strong> of ${servers.length} servers</p></div>`,
    '</div><div class="catalog-filters"><div class="catalog-search-field"><i class="bi bi-search catalog-search-icon" aria-hidden="true"></i>',
    '<input id="catalog-search" type="search" class="form-control" aria-label="Search servers" value="" placeholder="Search by name, URL, tag, or description"></div>',
    '<button type="button" class="catalog-filters-toggle" aria-expanded="false" aria-controls="catalog-filter-fields"><i class="bi bi-sliders" aria-hidden="true"></i><span>Filters</span><i class="bi bi-chevron-down catalog-filters-chevron" aria-hidden="true"></i></button>',
    '<div id="catalog-filter-fields" class="catalog-filter-fields" data-active-filters="0">',
    select('auth', 'Authentication', [['all', 'All'], ['no-auth', 'No auth'], ['oauth', 'OAuth'], ['bearer-token', 'Bearer'], ['api-token', 'API token'], ['api-key', 'API key']].map(([value, label]) => [value, `Authentication: ${label}`])),
    select('sort', 'Sort', [['catalog-order', 'Catalog order'], ['name', 'Name'], ['recently-tested', 'Recently tested'], ['browser-ready', 'Browser ready']].map(([value, label]) => [value, `Sort: ${label}`])),
    select('category', 'Category', [['all', `Category: All (${servers.length})`], ...summaries.map(({category, count}) => [category, `Category: ${category} (${count})`])]),
    '</div></div></div><div class="catalog-content-layout">',
    renderCategoryRail(summaries),
    `<div class="catalog-results-region"><ul class="catalog-server-list" aria-label="Catalog servers">${servers.map(renderCatalogRow).join('')}</ul></div>`,
    '</div></div>',
  ].join('');
}

/**
 * One dense catalog row, as CatalogServerCard renders it. Keep layout classes
 * and visible content, but omit repeated tooltips and redundant ARIA prose:
 * repeating the interactive card's full attributes across 221 rows is costly.
 * Report and Playground actions stay native anchors before the mount.
 */
function renderCatalogRow(server) {
  const statusClass = server.status === 'online'
    ? 'catalog-status-dot--online'
    : server.status === 'offline' ? 'catalog-status-dot--offline' : 'catalog-status-dot--unknown';
  const browserEvidence = server.browserAccess === 'direct'
    ? '<div class="catalog-browser-evidence"><span class="badge catalog-status-badge catalog-status-badge--verified">Browser ready</span></div>'
    : server.browserAccess === 'proxy-required'
      ? '<div class="catalog-browser-evidence"><span class="badge catalog-status-badge catalog-status-badge--warning">Proxy required</span></div>'
      : '';
  return [
    '<li class="catalog-server-list-item"><article class="catalog-server-row">',
    renderRowLogo(server),
    '<div class="catalog-server-heading"><div class="catalog-server-title-row"><div class="catalog-server-name-source">',
    `<h3><a class="catalog-server-title" href="${escapeHtml(getCatalogServerPath(server.id))}">${escapeHtml(server.name)}</a></h3>`,
    renderListingSource(server),
    '</div>',
    `<span class="catalog-runtime-status${server.status === 'online' ? ' catalog-runtime-status--online' : ''}"><span class="catalog-status-dot rounded-circle ${statusClass}" aria-hidden="true"></span>${escapeHtml(statusLabel(server))}</span>`,
    '</div>',
    `<p class="catalog-server-url" title="${escapeHtml(server.url)}">${escapeHtml(hostname(server.url))}</p>`,
    `<p class="catalog-server-description">${escapeHtml(server.description)}</p>`,
    '</div>',
    '<div class="catalog-server-meta"><div class="catalog-server-badges" role="group" aria-label="Server summary">',
    `<a class="badge catalog-metadata-badge catalog-metadata-badge--category" href="${escapeHtml(getCatalogCategoryPath(server.category))}">${escapeHtml(server.category)}</a>`,
    `<span class="badge catalog-metadata-badge catalog-metadata-badge--auth">${escapeHtml(formatCatalogAuth(server.authType))}</span>`,
    ...transportBadges(server).map(label => `<span class="badge catalog-metadata-badge catalog-metadata-badge--transport">${escapeHtml(label)}</span>`),
    server.protocolEra && server.protocolEra !== 'unknown'
      ? `<span class="badge catalog-metadata-badge catalog-metadata-badge--architecture">${escapeHtml(formatProtocolEra(server.protocolEra))}</span>`
      : '',
    '</div>',
    browserEvidence,
    '</div>',
    '<div class="catalog-card-actions">',
    `<a class="catalog-report-link" href="${escapeHtml(getCatalogServerPath(server.id))}">View report</a>`,
    `<a class="btn btn-sm btn-outline-primary catalog-test-button${server.status === 'offline' ? ' disabled' : ''}"${server.status === 'offline' ? ' aria-disabled="true" tabindex="-1"' : ''} href="${escapeHtml(playgroundPath(server))}">Test in Playground</a>`,
    '</div>',
    '</article></li>',
  ].join('');
}

function renderCounts(items) {
  return items.map(({ label, count }) => (
    `<span class="catalog-category-count">${escapeHtml(label)} <strong>${count}</strong></span>`
  )).join('');
}

function renderCategorySummaryList(summary) {
  return [
    `<dl class="catalog-category-summary" aria-label="${escapeHtml(summary.category)} server summary">`,
    `<div><dt>Authentication</dt><dd>${renderCounts(summary.auth)}</dd></div>`,
    `<div><dt>Transport</dt><dd>${renderCounts(summary.transport)}</dd></div>`,
    `<div><dt>Browser ready</dt><dd><strong>${summary.browserReady}</strong> of ${summary.count}</dd></div>`,
    `<div><dt>Tool inventories</dt><dd><strong>${summary.inventories}</strong> of ${summary.count}${summary.inventories > 0 ? ` · ${summary.toolCount} tools observed` : ''}</dd></div>`,
    '</dl>',
  ].join('');
}

function renderCategoryRail(summaries, current) {
  const total = summaries.reduce((sum, summary) => sum + summary.count, 0);
  const option = (label, count, href, isCurrent) => (
    `<a class="catalog-category-option" href="${escapeHtml(href)}"${isCurrent ? ' aria-current="page"' : ''}><span>${escapeHtml(label)}</span><span aria-label="${count} servers">${count}</span></a>`
  );
  return [
    '<nav class="catalog-category-rail" aria-label="Catalog categories">',
    '<p class="catalog-category-heading">Categories</p>',
    option('All', total, CATALOG_PATH, current === undefined),
    ...summaries.map(summary => option(summary.category, summary.count, summary.path, summary.category === current)),
    '</nav>',
  ].join('\n');
}

function renderCategoryFooter(summary, categories, articles) {
  const bySlug = new Map(articles.map(article => [article.slug, article]));
  const guides = getCategoryGuideSlugs(summary.category).map(slug => bySlug.get(slug)).filter(Boolean);
  const { previous, next } = getCatalogCategoryNeighbors(categories, summary.category);
  return [
    '<div class="catalog-category-footer">',
    ...(guides.length ? [
      `<section class="catalog-category-guides" aria-labelledby="catalog-category-guides-${escapeHtml(summary.slug)}">`,
      `<h2 id="catalog-category-guides-${escapeHtml(summary.slug)}">Guides for ${escapeHtml(summary.category)} servers</h2>`,
      `<ul>${guides.map(article => `<li><a href="${escapeHtml(article.path)}">${escapeHtml(article.title)}</a><p>${escapeHtml(article.summary)}</p></li>`).join('')}</ul>`,
      '</section>',
    ] : []),
    '<nav class="catalog-category-neighbors" aria-label="Neighboring categories">',
    previous ? `<a href="${escapeHtml(getCatalogCategoryPath(previous))}" rel="prev"><i class="bi bi-arrow-left" aria-hidden="true"></i> ${escapeHtml(previous)}</a>` : '',
    `<a href="${CATALOG_PATH}">All categories</a>`,
    next ? `<a href="${escapeHtml(getCatalogCategoryPath(next))}" rel="next">${escapeHtml(next)} <i class="bi bi-arrow-right" aria-hidden="true"></i></a>` : '',
    '</nav>',
    '</div>',
  ].join('\n');
}

/**
 * Static body of `/catalog/<slug>`: breadcrumb, generated intro, counts, the
 * category's server rows, the category rail, guides and neighbors.
 */
function renderCategoryFallback({ summary, summaries, servers, articles }) {
  const members = servers.filter(server => server.category === summary.category);
  return [
    `<div class="catalog-view seo-catalog-category" data-category="${escapeHtml(summary.slug)}">`,
    '<div class="catalog-command-bar"><div class="catalog-command-copy">',
    `<nav aria-label="Breadcrumb" class="catalog-category-breadcrumb"><a href="${CATALOG_PATH}">Server Catalog</a><span aria-hidden="true">/</span><span aria-current="page">${escapeHtml(summary.category)}</span></nav>`,
    `<h1 class="mb-1">${escapeHtml(summary.category)} MCP servers</h1>`,
    `<p class="catalog-category-intro">${escapeHtml(getCatalogCategoryIntro(summary).join(' '))}</p>`,
    renderCategorySummaryList(summary),
    `<div class="catalog-results-bar"><p class="catalog-results-count">Showing <strong>${members.length}</strong> of ${summary.count} ${escapeHtml(summary.category)} ${summary.count === 1 ? 'server' : 'servers'}</p></div>`,
    '</div></div>',
    '<div class="catalog-content-layout">',
    renderCategoryRail(summaries, summary.category),
    '<div class="catalog-results-region">',
    `<ul class="catalog-server-list" aria-label="Catalog servers">${members.map(renderCatalogRow).join('\n')}</ul>`,
    renderCategoryFooter(summary, summaries.map(item => item.category), articles),
    '</div>',
    '</div>',
    '</div>',
  ].join('\n');
}

function renderInlineCode(text) {
  return splitInlineCode(text).map(part => (
    part.code ? `<code>${escapeHtml(part.text)}</code>` : escapeHtml(part.text)
  )).join('');
}

function renderNotes(notes) {
  return notes.length ? `<ul class="client-setup-notes">${notes.map(note => `<li>${escapeHtml(note)}</li>`).join('')}</ul>` : '';
}

function renderCopyButton(sourceId, label, ariaLabel, className) {
  return `<button type="button" class="btn btn-sm ${className}" data-copy-from="${sourceId}" data-copy-label="${escapeHtml(label)}" aria-label="${escapeHtml(ariaLabel)}"><i class="bi bi-copy" aria-hidden="true"></i><span>${escapeHtml(label)}</span></button>`;
}

function renderConnectSetup(client) {
  const { setup } = client;
  if (setup.kind === 'snippet') {
    const sourceId = `server-connect-setup-${client.id}`;
    return [
      `<p class="server-connect-location">${escapeHtml(setup.location)}</p>`,
      `<div class="client-setup-code-wrap"><pre id="${sourceId}" tabindex="0" aria-label="${escapeHtml(client.label)} configuration"><code>${escapeHtml(setup.copyText)}</code></pre>`,
      renderCopyButton(sourceId, 'Copy', `Copy ${client.label} setup`, 'btn-ghost client-setup-copy'),
      '</div>',
      renderNotes(setup.notes),
    ].join('');
  }
  if (setup.kind === 'unavailable') {
    return [
      `<p class="server-connect-location">${escapeHtml(setup.location)}</p>`,
      `<div class="alert alert-warning client-setup-unsupported" role="note"><strong>Setup unavailable</strong><p class="mb-0">${escapeHtml(setup.text)}</p></div>`,
      renderNotes(setup.notes),
    ].join('');
  }
  return [
    `<p class="server-connect-location">Add the endpoint above in ${escapeHtml(client.label)}:</p>`,
    `<ul class="client-setup-notes">${setup.surfaces.map(text => `<li>${renderInlineCode(text)}</li>`).join('')}</ul>`,
  ].join('');
}

/**
 * The server page's "Connect it" section, as ServerConnect renders it: the
 * agent prompt, a client switcher that works with CSS alone, per-client setup
 * and the compatibility table.
 */
function renderServerConnect(server) {
  const model = createServerConnectModel(server);
  const { endpoint } = model;
  return [
    `  <section class="card server-profile-section server-connect" aria-labelledby="${SERVER_CONNECT_TITLE_ID}"><div class="card-body">`,
    `    <div class="server-section-heading"><span class="server-section-icon"><i class="bi bi-plug" aria-hidden="true"></i></span><div><h2 id="${SERVER_CONNECT_TITLE_ID}">Connect it</h2></div></div>`,
    `    <p class="server-connect-lede">${escapeHtml(endpoint.provenanceLabel)}: <code class="technical-string technical-string-url technical-string-inline">${escapeHtml(endpoint.url)}</code> · ${escapeHtml(formatCatalogTransport(endpoint.transport))}. ${escapeHtml(model.authSummary)}</p>`,
    '    <div class="server-connect-agent">',
    `      ${renderCopyButton('server-connect-agent-prompt', 'Copy as agent prompt', 'Copy as agent prompt', 'btn-ghost server-connect-agent-copy')}`,
    `      <details class="server-connect-agent-details"><summary>Agent prompt for Claude Code or Codex</summary><pre id="server-connect-agent-prompt" tabindex="0">${escapeHtml(model.agentPrompt)}</pre></details>`,
    '    </div>',
    '    <fieldset class="server-connect-switch" data-carry-choice><legend class="visually-hidden">MCP client</legend>',
    ...model.clients.map((client, index) => (
      `      <input type="radio" name="server-connect-client" id="connect-${escapeHtml(client.id)}"${index === 0 ? ' checked' : ''}><label for="connect-${escapeHtml(client.id)}">${escapeHtml(client.label)}</label>`
    )),
    '    </fieldset>',
    ...model.clients.map(client => (
      `    <section class="server-connect-panel" data-client="${escapeHtml(client.id)}"><h3>${escapeHtml(client.heading)}</h3>${renderConnectSetup(client)}</section>`
    )),
    ...(model.sharedNotes.length ? [`    <h3 class="server-connect-subheading">Notes for every client</h3>${renderNotes(model.sharedNotes)}`] : []),
    '    <h3 class="server-connect-subheading">Client compatibility</h3>',
    '    <table class="server-connect-compat"><thead><tr><th scope="col">Client</th><th scope="col">Status</th><th scope="col">Why</th></tr></thead><tbody>',
    ...model.clients.map(client => (
      `      <tr><th scope="row"><a href="${escapeHtml(client.href)}">${escapeHtml(client.label)}</a></th><td data-level="${client.compatibility.level}">${escapeHtml(client.compatibility.label)}</td><td>${escapeHtml(client.compatibility.reason)}</td></tr>`
    )),
    '    </tbody></table>',
    `    <p class="server-connect-footnote">Computed from this server's validated transport, protocol and authentication against <a href="${CLIENT_COMPATIBILITY_DATA_URL}">documented client support</a>. Checks the catalog has not observed are not counted.</p>`,
    '  </div></section>',
  ].join('\n');
}

function renderParameters(parameters, label) {
  if (!parameters?.length) {
    return `<p class="server-tool-schema server-tool-schema--empty"><span class="server-tool-schema-label">${label}</span> No parameters</p>`;
  }
  return [
    `<details class="server-tool-schema"><summary><span class="server-tool-schema-label">${label}</span> <code>${escapeHtml(formatInputSummary(parameters))}</code></summary>`,
    `<ul class="server-tool-parameters">${parameters.map(parameter => [
      `<li><code>${escapeHtml(formatArgumentSignature(parameter))}</code>`,
      `<span>${parameter.required ? 'required' : 'optional'}</span>`,
      parameter.description ? `<p>${escapeHtml(parameter.description)}</p>` : '',
      '</li>',
    ].join('')).join('')}</ul>`,
    '</details>',
  ].join('');
}

function sectionNote(section) {
  if (section.status === 'partial' && !section.paginationComplete) {
    return `Partial listing: ${section.retainedCount} of ${section.observedCount} shown; more may exist.`;
  }
  if (section.omittedCount > 0) {
    return `${section.retainedCount} of ${section.observedCount} shown; ${section.omittedCount} omitted to keep the page bounded.`;
  }
  if (section.status === 'partial') return 'Some details were sanitized for public display.';
  return '';
}

function renderSectionHeading(id, label, section) {
  const note = sectionNote(section);
  return [
    `<h3 id="${id}" class="server-tool-inventory-heading">${escapeHtml(label)} <span class="server-tool-inventory-count">${section.observedCount}</span></h3>`,
    note ? `<p class="server-tool-inventory-note">${escapeHtml(note)}</p>` : '',
  ].join('');
}

function renderRow(name, extra, description, body = '') {
  return [
    '<li class="server-tool-row">',
    `<div class="server-tool-title"><code class="server-tool-name">${escapeHtml(name)}</code>${extra}</div>`,
    description ? `<p class="server-tool-description">${escapeHtml(description)}</p>` : '',
    body,
    '</li>',
  ].join('');
}

/** The server page's tool inventory section, as ServerToolInventory renders it. */
// Resources and resource templates come from separate discovery calls, so
// each keeps its own completeness note.
function renderResourceSection(id, label, section) {
  if (!section.items.length) return [];
  return [
    `    <section aria-labelledby="${id}">${renderSectionHeading(id, label, section)}<ul class="server-tool-list">${section.items.map(resource => renderRow(
      resource.name,
      resource.mimeType ? `<span class="server-tool-output">${escapeHtml(resource.mimeType)}</span>` : '',
      [resource.title, resource.description].filter(Boolean).join(' — ')
    )).join('')}</ul></section>`,
  ];
}

function renderToolInventory(server) {
  const inventory = server.capabilityInventory;
  const heading = [
    '  <section class="card server-profile-section server-tool-inventory" aria-labelledby="server-tool-inventory-title"><div class="card-body">',
    '    <div class="server-section-heading"><span class="server-section-icon"><i class="bi bi-tools" aria-hidden="true"></i></span><div><h2 id="server-tool-inventory-title">Tool inventory</h2></div></div>',
  ];
  if (!inventory) {
    const notice = getMissingInventoryNotice(server);
    return [
      ...heading,
      `    <div class="server-tool-inventory-missing" role="note"><strong>${escapeHtml(notice.title)}</strong><p>${escapeHtml(notice.detail)}</p></div>`,
      '  </div></section>',
    ].join('\n');
  }
  const tools = inventory.tools.items.length
    ? `<ul class="server-tool-list">${inventory.tools.items.map(tool => renderRow(
      tool.name,
      `<span class="server-tool-output${tool.outputSchema ? ' server-tool-output--declared' : ''}">${escapeHtml(formatOutputSchemaPresence(tool))}</span>`,
      tool.description,
      renderParameters(tool.input, 'Input')
    )).join('')}</ul>`
    : `<p class="server-tool-inventory-empty">${inventory.tools.status === 'unsupported' ? 'This server does not offer tools.' : 'No tools were listed.'}</p>`;
  return [
    ...heading,
    `    <p class="server-tool-inventory-provenance">What the catalog validator observed on <time datetime="${escapeHtml(inventory.observedAt)}">${escapeHtml(formatSnapshotDate(inventory.observedAt))}</time> at <code class="technical-string technical-string-url technical-string-inline">${escapeHtml(inventory.provenance.testedEndpoint)}</code>${inventory.authentication === 'authenticated' ? ' with credentials' : ' without credentials'}. The live server may have changed since; connect in the Playground for the current list.</p>`,
    `    <section aria-labelledby="server-tool-inventory-tools">${renderSectionHeading('server-tool-inventory-tools', `Tools provided by ${server.name}`, inventory.tools)}${tools}</section>`,
    ...renderResourceSection('server-tool-inventory-resources', 'Resources', inventory.resources),
    ...renderResourceSection('server-tool-inventory-resource-templates', 'Resource templates', inventory.resourceTemplates),
    ...(inventory.prompts.items.length ? [
      `    <section aria-labelledby="server-tool-inventory-prompts">${renderSectionHeading('server-tool-inventory-prompts', 'Prompts', inventory.prompts)}<ul class="server-tool-list">${inventory.prompts.items.map(prompt => renderRow(
        prompt.name,
        '',
        prompt.description,
        renderParameters(prompt.arguments, 'Arguments')
      )).join('')}</ul></section>`,
    ] : []),
    '  </div></section>',
  ].join('\n');
}

module.exports = {
  renderCatalogFallback,
  renderCatalogRow,
  renderCategoryFallback,
  renderServerConnect,
  renderToolInventory,
};
