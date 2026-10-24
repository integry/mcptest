/**
 * Catalog category landing pages: slugs, paths, and everything a category page
 * says about its servers, derived from the catalog data rather than written by
 * hand. Shared by the React catalog and scripts/generate-seo-pages.js, which
 * loads it through Node's native require (hence the `.ts` import).
 */
import type { CapabilityInventoryV1 } from '../types/capabilityInventory';
import type {
  CatalogAuthType,
  CatalogBrowserAccess,
  CatalogTransport,
  CatalogValidationTransport,
} from '../types/catalog';
import {
  SITE_URL,
  formatCatalogAuth,
  formatCatalogTransport,
  getCatalogServerPath,
} from './catalogSeo.ts';

/** The catalog fields a category page reads; the build's merged servers have the same shape. */
export interface CategoryServer {
  id: string;
  name: string;
  category: string;
  tags: string[];
  authType: CatalogAuthType;
  transport: CatalogValidationTransport;
  declaredTransport: CatalogTransport;
  browserAccess?: CatalogBrowserAccess;
  capabilityInventory?: CapabilityInventoryV1;
}

export interface CategoryCount<T extends string> {
  value: T;
  label: string;
  count: number;
}

export interface CatalogCategorySummary {
  category: string;
  slug: string;
  path: string;
  count: number;
  serverIds: string[];
  serverNames: string[];
  auth: CategoryCount<CatalogAuthType>[];
  transport: CategoryCount<CatalogValidationTransport>[];
  browserReady: number;
  inventories: number;
  toolCount: number;
  resourceCount: number;
  promptCount: number;
  topTags: string[];
  toolActions: string[];
}

export const CATALOG_PATH = '/catalog';

export const getCatalogCategorySlug = (category: string): string =>
  category
    .normalize('NFKD')
    .toLowerCase()
    .replace(/&/g, ' and ')
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-+|-+$/g, '');

export const getCatalogCategoryPath = (category: string): string =>
  `${CATALOG_PATH}/${getCatalogCategorySlug(category)}`;

/** The slug in `/catalog/<slug>`, or null for any other path. */
export const getCatalogCategorySlugFromPath = (pathname: string): string | null => {
  const match = pathname.match(/^\/catalog\/([^/]+)\/?$/);
  if (!match) return null;
  try {
    return decodeURIComponent(match[1]).toLowerCase();
  } catch {
    return null;
  }
};

export const isCatalogPath = (pathname: string): boolean =>
  pathname === CATALOG_PATH || getCatalogCategorySlugFromPath(pathname) !== null;

export const findCatalogCategoryBySlug = (
  categories: readonly string[],
  slug: string | null
): string | undefined => (
  slug ? categories.find((category) => getCatalogCategorySlug(category) === slug) : undefined
);

const AUTH_ORDER: CatalogAuthType[] = ['none', 'oauth', 'bearer-token', 'api-token', 'api-key', 'unknown'];
const TRANSPORT_ORDER: CatalogValidationTransport[] = ['streamable-http', 'both', 'legacy-sse', 'unknown'];

/** Leading verbs of tool names (`search_docs`, `listIssues`) that say what a server does. */
const TOOL_ACTIONS = new Set([
  'analyze', 'create', 'delete', 'deploy', 'describe', 'execute', 'fetch', 'find', 'generate',
  'get', 'list', 'lookup', 'query', 'read', 'resolve', 'run', 'search', 'send', 'update', 'write',
]);

/** Tags about the listing or its credentials rather than what the server covers. */
const NON_TOPIC_TAGS = new Set([
  'api-key', 'api-token', 'bearer-token', 'community', 'dcr', 'no-auth', 'oauth', 'official', 'suggested',
]);

/** `web-search` reads as "web search"; abbreviations such as `ci-cd` stay as written. */
const tagPhrase = (tag: string) => (
  tag.split('-').some((part) => part.length <= 2) ? tag : tag.replace(/-/g, ' ')
);

const singularWord = (word: string) => word.replace(/s$/, '');

const effectiveTransport = (server: CategoryServer): CatalogValidationTransport =>
  server.transport === 'unknown' ? server.declaredTransport : server.transport;

const countBy = <T extends string>(values: T[], order: T[], label: (value: T) => string) => {
  const counts = new Map<T, number>();
  values.forEach((value) => counts.set(value, (counts.get(value) ?? 0) + 1));
  return order
    .filter((value) => counts.has(value))
    .map((value) => ({ value, label: label(value), count: counts.get(value) ?? 0 }));
};

/** Most frequent first, alphabetical among equals; only values seen at least twice. */
const topRepeated = (values: string[], limit: number): string[] => {
  const counts = new Map<string, number>();
  values.forEach((value) => counts.set(value, (counts.get(value) ?? 0) + 1));
  return [...counts.entries()]
    .filter(([, count]) => count >= 2)
    .sort(([left, leftCount], [right, rightCount]) => rightCount - leftCount || left.localeCompare(right))
    .slice(0, limit)
    .map(([value]) => value);
};

const toolAction = (toolName: string): string | undefined =>
  toolName
    .replace(/([a-z0-9])([A-Z])/g, '$1_$2')
    .toLowerCase()
    .split(/[^a-z0-9]+/)
    .find((token) => TOOL_ACTIONS.has(token));

export const summarizeCatalogCategory = (
  servers: readonly CategoryServer[],
  category: string
): CatalogCategorySummary => {
  const members = servers.filter((server) => server.category === category);
  const slug = getCatalogCategorySlug(category);
  const categoryWords = new Set(slug.split('-').map(singularWord));
  const inventories = members
    .map((server) => server.capabilityInventory)
    .filter((inventory): inventory is CapabilityInventoryV1 => Boolean(inventory));
  const toolNames = inventories.flatMap((inventory) => inventory.tools.items.map(({ name }) => name));

  return {
    category,
    slug,
    path: getCatalogCategoryPath(category),
    count: members.length,
    serverIds: members.map(({ id }) => id),
    serverNames: members.map(({ name }) => name),
    auth: countBy(members.map(({ authType }) => authType), AUTH_ORDER, formatCatalogAuth),
    transport: countBy(members.map(effectiveTransport), TRANSPORT_ORDER, formatCatalogTransport),
    browserReady: members.filter(({ browserAccess }) => browserAccess === 'direct').length,
    inventories: inventories.length,
    toolCount: inventories.reduce((total, inventory) => total + inventory.tools.observedCount, 0),
    resourceCount: inventories.reduce((total, inventory) => (
      total + inventory.resources.observedCount + inventory.resourceTemplates.observedCount
    ), 0),
    promptCount: inventories.reduce((total, inventory) => total + inventory.prompts.observedCount, 0),
    topTags: topRepeated(
      members.flatMap(({ tags }) => [...new Set(tags.map((tag) => tag.toLowerCase()))])
        .filter((tag) => (
          !NON_TOPIC_TAGS.has(tag) && tag !== slug && !categoryWords.has(singularWord(tag))
        )),
      3
    ).map(tagPhrase),
    toolActions: topRepeated(
      toolNames.map(toolAction).filter((action): action is string => Boolean(action)),
      3
    ),
  };
};

export const getCatalogCategoryNames = (servers: readonly CategoryServer[]): string[] =>
  [...new Set(servers.map(({ category }) => category))].sort((left, right) => left.localeCompare(right));

/** One summary per category, alphabetical, matching the catalog's category list. */
export const summarizeCatalogCategories = (servers: readonly CategoryServer[]): CatalogCategorySummary[] =>
  getCatalogCategoryNames(servers).map((category) => summarizeCatalogCategory(servers, category));

/** The categories either side of `category` in alphabetical order, wrapping around. */
export const getCatalogCategoryNeighbors = (
  categories: readonly string[],
  category: string
): { previous?: string; next?: string } => {
  const index = categories.indexOf(category);
  if (index < 0 || categories.length < 2) return {};
  if (categories.length === 2) return { next: categories[1 - index] };
  return {
    previous: categories[(index - 1 + categories.length) % categories.length],
    next: categories[(index + 1) % categories.length],
  };
};

const joinList = (items: string[], conjunction = 'and'): string => {
  if (items.length <= 1) return items.join('');
  return `${items.slice(0, -1).join(', ')} ${conjunction} ${items[items.length - 1]}`;
};

const plural = (count: number, singular: string, pluralForm = `${singular}s`) =>
  `${count} ${count === 1 ? singular : pluralForm}`;

const AUTH_CLAUSES: Record<CatalogAuthType, [string, string]> = {
  none: ['needs no credentials', 'need no credentials'],
  oauth: ['uses OAuth 2.1', 'use OAuth 2.1'],
  'bearer-token': ['takes a bearer token', 'take a bearer token'],
  'api-token': ['takes an API token', 'take an API token'],
  'api-key': ['takes an API key', 'take an API key'],
  unknown: ['has no verified authentication yet', 'have no verified authentication yet'],
};

/**
 * The short generated introduction for a category page: what the servers are,
 * how they authenticate, and what the validator saw them expose.
 */
export const getCatalogCategoryIntro = (summary: CatalogCategorySummary): string[] => {
  const shown = summary.serverNames.slice(0, 3);
  const remaining = summary.count - shown.length;
  const names = remaining > 0
    ? `${shown.join(', ')} and ${plural(remaining, 'more', 'more')}`
    : joinList(shown);
  const sentences = [
    `${plural(summary.count, 'remote MCP server')} in ${summary.category}: ${names}.`,
  ];
  if (summary.topTags.length) {
    sentences.push(`They most often cover ${joinList(summary.topTags)}.`);
  }
  if (summary.auth.length === 0) {
    // An empty category has nothing to count; the first sentence already says so.
  } else if (summary.auth.length === 1) {
    const [{ value }] = summary.auth;
    sentences.push(summary.count === 1
      ? `It ${AUTH_CLAUSES[value][0]}.`
      : `All ${summary.count} ${AUTH_CLAUSES[value][1]}.`);
  } else {
    const authClauses = summary.auth.map(({ value, count }) => (
      `${count} ${AUTH_CLAUSES[value][count === 1 ? 0 : 1]}`
    ));
    sentences.push(`${authClauses[0]}; ${joinList(authClauses.slice(1))}.`);
  }
  if (summary.inventories > 0) {
    const extras = [
      summary.resourceCount ? plural(summary.resourceCount, 'resource') : '',
      summary.promptCount ? plural(summary.promptCount, 'prompt') : '',
    ].filter(Boolean);
    sentences.push(`The catalog validator observed public inventories for ${summary.inventories} of ${summary.count}: ${
      plural(summary.toolCount, 'tool')
    }${extras.length ? ` plus ${joinList(extras)}` : ''}${
      summary.toolActions.length ? `, most often to ${joinList(summary.toolActions, 'or')}` : ''
    }.`);
  } else {
    sentences.push(summary.count === 1
      ? 'The catalog validator has not observed a public tool inventory for it; its tools are listed after you connect.'
      : 'The catalog validator has not observed a public tool inventory for these servers; their tools are listed after you connect.');
  }
  return sentences;
};

const truncate = (value: string, maxLength = 158): string =>
  value.length <= maxLength ? value : `${value.slice(0, maxLength - 1).trimEnd()}…`;

export const getCatalogCategorySeo = (summary: CatalogCategorySummary) => {
  const canonicalUrl = `${SITE_URL}${summary.path}`;
  const title = `${summary.category} MCP Servers | mcptest.io`;
  const description = truncate(
    `${plural(summary.count, `remote ${summary.category} MCP server`)}${
      summary.count > 3 ? ', including ' : ': '
    }${joinList(summary.serverNames.slice(0, 3))}. Compare authentication, transport and observed tools before you connect.`
  );
  return {
    title,
    description,
    canonicalUrl,
    structuredData: {
      '@context': 'https://schema.org',
      '@type': 'CollectionPage',
      name: `${summary.category} MCP servers`,
      description,
      url: canonicalUrl,
      isPartOf: { '@type': 'WebSite', name: 'mcptest.io', url: SITE_URL },
      breadcrumb: {
        '@type': 'BreadcrumbList',
        itemListElement: [
          { '@type': 'ListItem', position: 1, name: 'Server Catalog', item: `${SITE_URL}${CATALOG_PATH}` },
          { '@type': 'ListItem', position: 2, name: summary.category, item: canonicalUrl },
        ],
      },
      mainEntity: {
        '@type': 'ItemList',
        numberOfItems: summary.count,
        itemListElement: summary.serverIds.map((id, index) => ({
          '@type': 'ListItem',
          position: index + 1,
          name: summary.serverNames[index],
          url: `${SITE_URL}${getCatalogServerPath(id)}`,
        })),
      },
    },
  };
};
