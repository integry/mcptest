// Public read-only catalog MCP endpoint: https://mcptest.io/mcp/catalog
//
// A Streamable HTTP MCP server with three read-only tools over the bundled
// catalog index (catalogIndex.js): search_catalog, get_catalog_server and
// list_catalog_categories. No authentication, no cookies and no outbound
// fetches; a tool call never contacts a listed server.
//
// The protocol layer (stateless 2026-07-28 and stateful 2025-11-25 on the same
// endpoint, CORS, bounded bodies) is the fixtures' serveMcpServer. This module
// adds the tool definitions and a per-IP rate limit kept in the
// SubmissionRateLimiter Durable Object under its own key prefix.
import { FIXTURE_CORS_HEADERS, serveMcpServer } from "./fixtures.js";
import { consumeRateLimit, sha256Hex } from "./submissions.js";
import {
  CATALOG_CATEGORIES,
  CATALOG_INDEX,
  CATALOG_STATUSES,
  MAX_TOOL_NAMES,
  findCatalogEntry,
  resolveCatalogCategory,
  searchCatalog,
} from "./catalogIndex.js";

export const CATALOG_MCP_PATH = "/mcp/catalog";
export const CATALOG_MCP_URL = `https://mcptest.io${CATALOG_MCP_PATH}`;
export const CATALOG_MCP_VERSION = "1.0.0";
export const CATALOG_MCP_RATE_LIMIT = { limit: 120, windowMs: 60 * 1000 };
export const MAX_QUERY_LENGTH = 200;
export const MAX_CATEGORY_LENGTH = 64;
export const MAX_ID_LENGTH = 100;
export const DEFAULT_SEARCH_LIMIT = 10;
export const MAX_SEARCH_LIMIT = 25;
/** Upper bound on the serialized structuredContent of any catalog tool result. */
export const MAX_RESULT_BYTES = 32 * 1024;

const readOnly = { readOnlyHint: true, destructiveHint: false, idempotentHint: true, openWorldHint: false };
const byteLength = (value) => new TextEncoder().encode(JSON.stringify(value)).byteLength;

const structuredResult = (value) => ({ content: [{ type: "text", text: JSON.stringify(value, null, 2) }], structuredContent: value });

// Tool-level failures are results with isError, not JSON-RPC errors, so a model
// can read and correct them. No structuredContent: it would not match outputSchema.
const toolError = (code, message, details = {}) => ({
  isError: true,
  content: [{ type: "text", text: JSON.stringify({ error: { code, message, ...details } }, null, 2) }],
});

const nullable = (type) => ({ type: [type, "null"] });
const validationSchema = {
  type: "object",
  properties: {
    status: { type: "string", enum: CATALOG_STATUSES },
    checkedAt: { ...nullable("string"), description: "When the catalog validation run last checked the endpoint (ISO 8601)." },
  },
  required: ["status", "checkedAt"],
  additionalProperties: false,
};

const searchResult = (entry) => ({
  id: entry.id,
  name: entry.name,
  description: entry.summary,
  category: entry.category,
  endpoint: entry.endpoint,
  validation: entry.validation,
  pageUrl: entry.pageUrl,
});

const searchCatalogTool = {
  definition: {
    name: "search_catalog",
    title: "Search the MCP server catalog",
    description: "Searches the mcptest.io catalog of public remote MCP servers by name, description, category and observed tool names. "
      + "Every query word must match. Filter by category (see list_catalog_categories) or by validation status. "
      + "Results come from the published catalog data; no listed server is contacted.",
    inputSchema: {
      type: "object",
      properties: {
        query: { type: "string", maxLength: MAX_QUERY_LENGTH, description: "Search words, for example \"github issues\". Omit to list in catalog order." },
        category: { type: "string", minLength: 1, maxLength: MAX_CATEGORY_LENGTH, description: "Category name, case-insensitive, as returned by list_catalog_categories." },
        status: { type: "string", enum: CATALOG_STATUSES, description: "Only servers whose latest validation had this result." },
        limit: { type: "integer", minimum: 1, maximum: MAX_SEARCH_LIMIT, description: `Maximum results (default ${DEFAULT_SEARCH_LIMIT}, at most ${MAX_SEARCH_LIMIT}).` },
      },
      additionalProperties: false,
    },
    outputSchema: {
      type: "object",
      properties: {
        total: { type: "integer", description: "Matching servers before the limit." },
        returned: { type: "integer" },
        results: {
          type: "array",
          maxItems: MAX_SEARCH_LIMIT,
          items: {
            type: "object",
            properties: {
              id: { type: "string" },
              name: { type: "string" },
              description: { type: "string", description: "One-line summary." },
              category: { type: "string" },
              endpoint: { type: "string", format: "uri" },
              validation: validationSchema,
              pageUrl: { type: "string", format: "uri" },
            },
            required: ["id", "name", "description", "category", "endpoint", "validation", "pageUrl"],
            additionalProperties: false,
          },
        },
      },
      required: ["total", "returned", "results"],
      additionalProperties: false,
    },
    annotations: readOnly,
  },
  run: (args) => {
    let category;
    if (args.category !== undefined) {
      category = resolveCatalogCategory(args.category);
      if (!category) {
        return toolError("unknown_category", `No catalog category is named ${JSON.stringify(args.category)}.`, {
          categories: CATALOG_CATEGORIES.map((candidate) => candidate.name),
        });
      }
    }
    const { total, results } = searchCatalog({
      query: args.query ?? "",
      category,
      status: args.status,
      limit: args.limit ?? DEFAULT_SEARCH_LIMIT,
    });
    const value = { total, returned: 0, results: results.map(({ entry }) => searchResult(entry)) };
    // Every entry is bounded, so this only trims if the catalog grows unusually long fields.
    while (value.results.length && byteLength(value) > MAX_RESULT_BYTES) value.results.pop();
    value.returned = value.results.length;
    return structuredResult(value);
  },
};

const serverDetail = (entry) => {
  const { capabilities } = entry;
  return {
    id: entry.id,
    name: entry.name,
    description: entry.description,
    category: entry.category,
    endpoint: entry.endpoint,
    transport: entry.transport,
    auth: entry.auth,
    validation: entry.validation,
    capabilities: capabilities ? {
      observedAt: capabilities.observedAt,
      authentication: capabilities.authentication,
      toolCount: capabilities.toolCount,
      toolNames: capabilities.toolNames.slice(0, MAX_TOOL_NAMES),
      toolNamesTruncated: capabilities.toolNames.length > MAX_TOOL_NAMES,
      resourceCount: capabilities.resourceCount,
      promptCount: capabilities.promptCount,
    } : null,
    caveats: entry.caveats,
    homepageUrl: entry.homepageUrl,
    pageUrl: entry.pageUrl,
    badgeUrl: entry.badgeUrl,
  };
};

const getCatalogServerTool = {
  definition: {
    name: "get_catalog_server",
    title: "Get a catalog server",
    description: "Returns the public catalog entry for one server id from search_catalog: description, endpoint, authentication "
      + "requirement, latest validation result and date, observed capability summary, and its mcptest.io page and badge URLs.",
    inputSchema: {
      type: "object",
      properties: {
        id: { type: "string", minLength: 1, maxLength: MAX_ID_LENGTH, description: "Catalog id, for example \"github\"." },
      },
      required: ["id"],
      additionalProperties: false,
    },
    outputSchema: {
      type: "object",
      properties: {
        id: { type: "string" },
        name: { type: "string" },
        description: { type: "string" },
        category: { type: "string" },
        endpoint: { type: "string", format: "uri" },
        transport: { type: "string" },
        auth: {
          type: "object",
          properties: {
            type: { type: "string" },
            requiresOAuth: { type: "boolean" },
            alternatives: { type: "array", items: { type: "string" } },
            headers: {
              type: "array",
              items: {
                type: "object",
                properties: { name: { type: "string" }, required: { type: "boolean" } },
                required: ["name", "required"],
                additionalProperties: false,
              },
            },
          },
          required: ["type", "requiresOAuth", "alternatives", "headers"],
          additionalProperties: false,
        },
        validation: validationSchema,
        capabilities: {
          type: ["object", "null"],
          description: "Observed by the catalog capability import; null when no inventory was captured.",
          properties: {
            observedAt: nullable("string"),
            authentication: nullable("string"),
            toolCount: { type: "integer" },
            toolNames: { type: "array", maxItems: MAX_TOOL_NAMES, items: { type: "string" } },
            toolNamesTruncated: { type: "boolean" },
            resourceCount: nullable("integer"),
            promptCount: nullable("integer"),
          },
          required: ["observedAt", "authentication", "toolCount", "toolNames", "toolNamesTruncated", "resourceCount", "promptCount"],
          additionalProperties: false,
        },
        caveats: { type: "array", items: { type: "string" } },
        homepageUrl: nullable("string"),
        pageUrl: { type: "string", format: "uri" },
        badgeUrl: { type: "string", format: "uri" },
      },
      required: ["id", "name", "description", "category", "endpoint", "transport", "auth", "validation", "capabilities", "caveats", "homepageUrl", "pageUrl", "badgeUrl"],
      additionalProperties: false,
    },
    annotations: readOnly,
  },
  run: ({ id }) => {
    const entry = findCatalogEntry(id);
    if (!entry) {
      return toolError("unknown_server", `No catalog server has the id ${JSON.stringify(id.slice(0, MAX_ID_LENGTH))}.`, {
        id: id.slice(0, MAX_ID_LENGTH),
        hint: "Use search_catalog to find the id.",
      });
    }
    return structuredResult(serverDetail(entry));
  },
};

const listCatalogCategoriesTool = {
  definition: {
    name: "list_catalog_categories",
    title: "List catalog categories",
    description: "Lists the categories of the mcptest.io MCP server catalog with the number of servers in each and the category page URL.",
    inputSchema: { type: "object", properties: {}, additionalProperties: false },
    outputSchema: {
      type: "object",
      properties: {
        totalServers: { type: "integer" },
        categories: {
          type: "array",
          items: {
            type: "object",
            properties: { name: { type: "string" }, count: { type: "integer" }, url: { type: "string", format: "uri" } },
            required: ["name", "count", "url"],
            additionalProperties: false,
          },
        },
      },
      required: ["totalServers", "categories"],
      additionalProperties: false,
    },
    annotations: readOnly,
  },
  run: () => structuredResult({ totalServers: CATALOG_INDEX.length, categories: CATALOG_CATEGORIES }),
};

export const CATALOG_MCP_SERVER = Object.freeze({
  name: "catalog",
  title: "mcptest.io catalog",
  serverInfo: { name: "mcptest-catalog", title: "mcptest.io catalog", version: CATALOG_MCP_VERSION },
  instructions: "Read-only search over the mcptest.io catalog of public remote MCP servers. Use search_catalog to find servers, "
    + "get_catalog_server for one entry's endpoint, auth requirement and latest validation result, and list_catalog_categories "
    + "for the categories. Data is the published catalog snapshot; no listed server is contacted.",
  tools: [searchCatalogTool, getCatalogServerTool, listCatalogCategoriesTool],
  resources: [],
  prompts: [],
});

const rateLimitedResponse = (retryAfterSeconds) => {
  const retryAfter = String(Math.max(1, Math.ceil(retryAfterSeconds || 60)));
  return new Response(JSON.stringify({
    jsonrpc: "2.0",
    id: null,
    error: { code: -32000, message: `Rate limit exceeded: at most ${CATALOG_MCP_RATE_LIMIT.limit} requests per minute per address. Retry after ${retryAfter} seconds.` },
  }), {
    status: 429,
    headers: { ...FIXTURE_CORS_HEADERS, "Content-Type": "application/json", "Cache-Control": "no-store", "Retry-After": retryAfter },
  });
};

/**
 * Takes one per-IP slot. Fails open when the limiter is not bound or errors:
 * the data is public and static, so availability matters more than the quota.
 */
const checkRateLimit = async (request, env) => {
  if (!env?.SUBMISSION_RATE_LIMITER) return undefined;
  try {
    const ip = request.headers.get("CF-Connecting-IP") || "unknown";
    const decision = await consumeRateLimit(env, `catalog-mcp:ip:${await sha256Hex(ip)}`, { ...CATALOG_MCP_RATE_LIMIT, expire: true });
    return decision.allowed ? undefined : rateLimitedResponse(decision.retryAfterSeconds);
  } catch (error) {
    console.error(`[catalog-mcp] rate limiter unavailable: ${error}`);
    return undefined;
  }
};

/** Handles /mcp/catalog; returns undefined for any other path. */
export const handleCatalogMcpRequest = async (request, env) => {
  const { pathname } = new URL(request.url);
  if (pathname !== CATALOG_MCP_PATH && pathname !== `${CATALOG_MCP_PATH}/`) return undefined;
  // Preflights are free so browser clients are never blocked before the real request.
  if (request.method !== "OPTIONS") {
    const limited = await checkRateLimit(request, env);
    if (limited) return limited;
  }
  return serveMcpServer(request, CATALOG_MCP_SERVER);
};
