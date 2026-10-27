import type { CatalogServer } from '../types/catalog';
import { getPreferredCatalogEndpoint } from './clientSetup.ts';
import { createServerConnectModel } from './serverConnect.ts';
import { formatCatalogAuth } from './catalogSeo.ts';
import { getServerUrl } from './urlUtils.ts';

export const selectSimilarServers = (server: CatalogServer, catalog: readonly CatalogServer[]) => {
  const order = (items: CatalogServer[]) => items.sort((a, b) => Number(b.status === 'online' && !!b.checkedAt) - Number(a.status === 'online' && !!a.checkedAt));
  const category = order(catalog.filter(item => item.id !== server.id && item.category === server.category));
  const fallback = order(catalog.filter(item => item.id !== server.id && item.category !== server.category && item.authType === server.authType));
  return [...category, ...fallback].slice(0, 6);
};

export const selectServerGuides = (server: CatalogServer): { path: string; title: string }[] => {
  const guides: { path: string; title: string }[] = [];
  const add = (slug: string, title: string) => guides.push({ path: `/learn/${slug}`, title });
  if (server.authType === 'oauth') {
    add('oauth-for-mcp-explained', 'OAuth for MCP explained');
    add('remote-mcp-server-401-unauthorized', 'Troubleshoot authorization');
  } else if (server.authType !== 'none') add('mcp-server-authentication-patterns', 'MCP server authentication patterns');
  if (server.transport === 'legacy-sse' || server.declaredTransport === 'legacy-sse') add('mcp-transport-diagnostics-reference', 'Legacy SSE and transport diagnostics');
  for (const client of createServerConnectModel(server).clients) {
    if (client.compatibility.level !== 'unsupported' && client.href.startsWith('/learn/') && !guides.some(g => g.path === client.href)) {
      guides.push({ path: client.href, title: `Connect to ${client.label}` });
    }
    if (guides.length >= 4) break;
  }
  if (guides.length < 2) add('connect-remote-mcp-server', 'Connect a remote MCP server');
  return guides.slice(0, 4);
};
const escape = (s: string) => s.replace(/[&<>"']/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]!));
export const serverActionPaths = (server: CatalogServer) => {
  const endpoint = getPreferredCatalogEndpoint(server);
  return { test: getServerUrl(endpoint.url, endpoint.transport), report: `/report/${encodeURIComponent(endpoint.url)}`, watch: `/tools/breaking-changes?endpoint=${encodeURIComponent(endpoint.url)}` };
};
export const renderServerActions = (server: CatalogServer) => {
  const paths = serverActionPaths(server);
  return `<div class="server-profile-actions"><a class="btn btn-primary server-profile-action" data-server-action="test_live" href="${escape(paths.test)}">Test it live</a><a data-server-action="report" href="${escape(paths.report)}">Run the release-readiness report</a></div>`;
};
export const renderServerNextSteps = (server: CatalogServer, catalog: readonly CatalogServer[]) => `<div class="server-next-steps"><section class="server-profile-section"><h2>Similar servers</h2><ul>${selectSimilarServers(server, catalog).map(item => `<li><a data-server-action="similar_server" href="/servers/${escape(item.id)}/">${escape(item.name)}</a> — ${escape(item.description)} <span class="badge text-bg-secondary">${escape(formatCatalogAuth(item.authType))}</span></li>`).join('')}</ul></section><section class="server-profile-section"><h2>Guides for this server</h2><ul>${selectServerGuides(server).map(g => `<li><a data-server-action="guide" href="${g.path}">${escape(g.title)}</a></li>`).join('')}</ul></section><p><a data-server-action="watch" href="${escape(serverActionPaths(server).watch)}">Watch this server for breaking changes</a></p></div>`;
