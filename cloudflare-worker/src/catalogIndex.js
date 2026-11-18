// Slim read-only search index over the public server catalog, served by the
// /mcp/catalog endpoint (catalogMcp.js).
//
// The catalog, its latest validation run and the observed capability inventories
// are bundled at build time (the same files the badge route and the site read),
// and this module keeps only the public fields the catalog tools return. Nothing
// here contacts a listed server: every tool call is a lookup in this index, so a
// redeploy after `npm run validate-catalog` publishes fresh results.
import serverCatalog from "../../src/data/serverCatalog.json";
import catalogValidation from "../../src/data/catalogValidation.json";
import catalogCapabilities from "../../src/data/catalogCapabilities.json";
import { getCatalogBadgeVariant } from "../../src/utils/badges.ts";
import { getCatalogCategoryPath } from "../../src/utils/catalogCategories.ts";
import { SITE_URL, getCatalogServerPath } from "../../src/utils/catalogSeo.ts";

/** The validation states a catalog tool reports; badges.ts variants outside this set map to unknown. */
export const CATALOG_STATUSES = ["ready", "authorization-required", "blocked", "unknown"];
export const MAX_SUMMARY_LENGTH = 200;
export const MAX_DESCRIPTION_LENGTH = 1_000;
export const MAX_TOOL_NAMES = 50;
const MAX_TOOL_NAME_LENGTH = 100;
const MAX_CAVEATS = 3;
const MAX_CAVEAT_LENGTH = 300;
export const MAX_QUERY_TERMS = 8;

const truncate = (value, max) => (value.length > max ? `${value.slice(0, max - 1).trimEnd()}…` : value);
const normalize = (value) => String(value ?? "").normalize("NFKD").replace(/[̀-ͯ]/g, "").toLowerCase();
const words = (value) => normalize(value).split(/[^a-z0-9]+/).filter(Boolean);

/** The first sentence of a description, capped at MAX_SUMMARY_LENGTH characters. */
const oneLine = (description) => {
  const flat = String(description ?? "").replace(/\s+/g, " ").trim();
  const sentence = /^(.+?[.!?])(?:\s|$)/.exec(flat)?.[1] ?? flat;
  return truncate(sentence, MAX_SUMMARY_LENGTH);
};

const validationStatus = (validation) => {
  const variant = getCatalogBadgeVariant(validation);
  return CATALOG_STATUSES.includes(variant) ? variant : "unknown";
};

const countOf = (section) => {
  if (!section || typeof section !== "object") return undefined;
  const count = section.observedCount ?? section.retainedCount ?? (Array.isArray(section.items) ? section.items.length : undefined);
  return Number.isInteger(count) ? count : undefined;
};

const capabilitySummary = (inventory) => {
  if (!inventory || typeof inventory !== "object") return null;
  const items = Array.isArray(inventory.tools?.items) ? inventory.tools.items : [];
  const toolNames = items
    .map((item) => (typeof item?.name === "string" ? truncate(item.name, MAX_TOOL_NAME_LENGTH) : undefined))
    .filter(Boolean);
  return {
    observedAt: typeof inventory.observedAt === "string" ? inventory.observedAt : null,
    authentication: typeof inventory.authentication === "string" ? inventory.authentication : null,
    toolCount: countOf(inventory.tools) ?? toolNames.length,
    toolNames,
    resourceCount: countOf(inventory.resources) ?? null,
    promptCount: countOf(inventory.prompts) ?? null,
  };
};

const validationById = new Map(
  (Array.isArray(catalogValidation) ? catalogValidation : [])
    .filter((entry) => entry && typeof entry.serverId === "string")
    .map((entry) => [entry.serverId, entry]),
);

const buildEntry = (seed, order) => {
  const validation = validationById.get(seed.id);
  const capabilities = capabilitySummary(Object.hasOwn(catalogCapabilities, seed.id) ? catalogCapabilities[seed.id] : undefined);
  const encodedId = encodeURIComponent(seed.id);
  return {
    order,
    id: seed.id,
    name: seed.name,
    summary: oneLine(seed.description),
    description: truncate(String(seed.description ?? ""), MAX_DESCRIPTION_LENGTH),
    category: seed.category,
    endpoint: seed.url,
    transport: seed.transport,
    auth: {
      type: seed.authType ?? (seed.requiresOAuth ? "oauth" : "none"),
      requiresOAuth: Boolean(seed.requiresOAuth),
      alternatives: Array.isArray(seed.alternativeAuthTypes) ? seed.alternativeAuthTypes : [],
      // Header names and whether they are required; templates and values are never part of the index.
      headers: (Array.isArray(seed.requiredHeaders) ? seed.requiredHeaders : [])
        .filter((header) => typeof header?.name === "string")
        .map((header) => ({ name: header.name, required: header.required !== false })),
    },
    validation: {
      status: validationStatus(validation),
      checkedAt: typeof validation?.checkedAt === "string" ? validation.checkedAt : null,
    },
    capabilities,
    caveats: (Array.isArray(seed.caveats) ? seed.caveats : [])
      .slice(0, MAX_CAVEATS)
      .map((caveat) => truncate(String(caveat), MAX_CAVEAT_LENGTH)),
    homepageUrl: typeof seed.homepageUrl === "string" ? seed.homepageUrl : null,
    pageUrl: `${SITE_URL}${getCatalogServerPath(seed.id)}`,
    badgeUrl: `${SITE_URL}/badge/server/${encodedId}.svg`,
    search: {
      id: normalize(seed.id),
      name: normalize(seed.name),
      nameWords: words(`${seed.name} ${seed.id}`),
      category: normalize(seed.category),
      categoryWords: words(seed.category),
      description: normalize(seed.description),
      descriptionWords: words(seed.description),
      toolNames: (capabilities?.toolNames ?? []).map(normalize),
    },
  };
};

export const CATALOG_INDEX = Object.freeze(
  (Array.isArray(serverCatalog) ? serverCatalog : [])
    .filter((seed) => seed && typeof seed.id === "string" && typeof seed.name === "string")
    .map(buildEntry),
);

const entriesById = new Map(CATALOG_INDEX.map((entry) => [entry.id, entry]));

export const CATALOG_CATEGORIES = Object.freeze((() => {
  const counts = new Map();
  for (const entry of CATALOG_INDEX) counts.set(entry.category, (counts.get(entry.category) ?? 0) + 1);
  return [...counts]
    .map(([name, count]) => ({ name, count, url: `${SITE_URL}${getCatalogCategoryPath(name)}` }))
    .sort((a, b) => b.count - a.count || a.name.localeCompare(b.name));
})());

/** Looks a catalog entry up by exact id; undefined when the id is not listed. */
export const findCatalogEntry = (id) => entriesById.get(id);

/** The canonical category name for a case-insensitive match, or undefined. */
export const resolveCatalogCategory = (category) => {
  const wanted = normalize(category).trim();
  return CATALOG_CATEGORIES.find((candidate) => normalize(candidate.name) === wanted)?.name;
};

/** Distinct lowercased query terms, at most MAX_QUERY_TERMS. */
export const queryTerms = (query) => [...new Set(words(query))].slice(0, MAX_QUERY_TERMS);

// One term's weight in one entry, or 0 when the term matches nowhere. Name and
// id matches dominate, then category, tool names and the description.
const termScore = (term, { search }) => {
  let score = 0;
  if (search.nameWords.includes(term)) score += 30;
  else if (search.nameWords.some((word) => word.startsWith(term))) score += 20;
  else if (search.name.includes(term) || search.id.includes(term)) score += 12;
  if (search.categoryWords.includes(term)) score += 10;
  else if (search.category.includes(term)) score += 5;
  if (search.toolNames.some((tool) => tool.includes(term))) score += 6;
  if (search.descriptionWords.includes(term)) score += 4;
  else if (search.descriptionWords.some((word) => word.startsWith(term))) score += 2;
  return score;
};

/**
 * Ranks catalog entries for a query. Every query term must match the name, id,
 * category, description or an observed tool name; entries are ordered by score,
 * then catalog order. Without terms the catalog order is kept.
 */
export const searchCatalog = ({ query = "", category, status, limit }) => {
  const terms = queryTerms(query);
  const phrase = normalize(query).trim();
  const matches = [];
  for (const entry of CATALOG_INDEX) {
    if (category !== undefined && entry.category !== category) continue;
    if (status !== undefined && entry.validation.status !== status) continue;
    let score = 0;
    let matched = true;
    for (const term of terms) {
      const value = termScore(term, entry);
      if (!value) {
        matched = false;
        break;
      }
      score += value;
    }
    if (!matched) continue;
    if (phrase && (entry.search.name === phrase || entry.search.id === phrase)) score += 100;
    else if (phrase && entry.search.toolNames.includes(phrase)) score += 40;
    matches.push({ entry, score });
  }
  matches.sort((a, b) => b.score - a.score || a.entry.order - b.entry.order);
  return { total: matches.length, results: matches.slice(0, limit) };
};
