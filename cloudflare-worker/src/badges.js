// Catalog badge route: GET /badge/server/<catalog id>.svg
//
// Validation data is bundled at build time from src/data/catalogValidation.json,
// so a badge request is a pure lookup. It never contacts the MCP server, which keeps
// badges cheap and prevents the route from being used to scan arbitrary endpoints.
// Redeploy the worker after `npm run validate-catalog` to publish fresh results.
import catalogValidation from "../../src/data/catalogValidation.json";
import { getCatalogBadgeVariant, renderBadgeSvg } from "../../src/utils/badges.ts";

const BADGE_PATH_PREFIX = "/badge/server/";

// Known servers change only on deploy; unknown ids are cached briefly so a newly
// listed server picks up its result badge soon after the next deploy.
export const KNOWN_BADGE_CACHE_CONTROL = "public, max-age=3600, s-maxage=3600, stale-while-revalidate=86400";
export const UNKNOWN_BADGE_CACHE_CONTROL = "public, max-age=300, s-maxage=300";

const validationById = new Map(
  (Array.isArray(catalogValidation) ? catalogValidation : [])
    .filter((entry) => entry && typeof entry.serverId === "string")
    .map((entry) => [entry.serverId, entry])
);

// Rendered once per isolate; there are only six variants.
const svgCache = new Map();
const badgeSvg = (variant) => {
  if (!svgCache.has(variant)) svgCache.set(variant, renderBadgeSvg(variant));
  return svgCache.get(variant);
};

const catalogIdFromPath = (pathname) => {
  const segment = pathname.slice(BADGE_PATH_PREFIX.length);
  if (!segment.endsWith(".svg") || segment.includes("/")) return undefined;
  try {
    return decodeURIComponent(segment.slice(0, -".svg".length));
  } catch {
    return undefined;
  }
};

/** Returns a badge response for /badge/server/* requests, or undefined for any other route. */
export function handleBadgeRequest(request) {
  const url = new URL(request.url);
  if (!url.pathname.startsWith(BADGE_PATH_PREFIX)) return undefined;
  if (request.method !== "GET" && request.method !== "HEAD") {
    return new Response(null, { status: 405, headers: { Allow: "GET, HEAD" } });
  }

  const serverId = catalogIdFromPath(url.pathname);
  const validation = serverId === undefined ? undefined : validationById.get(serverId);
  // Unknown ids still return 200 with the neutral badge so READMEs never show a broken image.
  const variant = getCatalogBadgeVariant(validation);
  const svg = badgeSvg(variant);
  return new Response(request.method === "HEAD" ? null : svg, {
    status: 200,
    headers: {
      "Content-Type": "image/svg+xml; charset=utf-8",
      "Cache-Control": validation ? KNOWN_BADGE_CACHE_CONTROL : UNKNOWN_BADGE_CACHE_CONTROL,
      "Access-Control-Allow-Origin": "*",
      "Content-Security-Policy": "default-src 'none'; style-src 'unsafe-inline'",
      "X-Content-Type-Options": "nosniff",
      "X-Badge-Result": variant,
    },
  });
}
