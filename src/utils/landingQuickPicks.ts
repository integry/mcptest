import type { CatalogServer } from '../types/catalog';

export const QUICK_PICK_LIMIT = 3;

type QuickPickCandidate = Pick<
  CatalogServer,
  'status' | 'authType' | 'requiresOAuth' | 'requiredHeaders' | 'browserAccess' | 'browserUrl' | 'logoUrl' | 'logoSourceKind' | 'tags'
>;

/**
 * Catalog servers a first-time visitor can connect to with one click: online
 * or unproven (never offline), no credentials of any kind, reachable directly
 * from the browser, and carrying a real publisher logo. Servers tagged as
 * suggested keep their catalog order ahead of the rest.
 *
 * LandingHero renders these, and scripts/generate-seo-pages.js renders the
 * same picks into the static first frame, so it has no runtime imports.
 */
export const selectLandingQuickPicks = <T extends QuickPickCandidate>(
  servers: T[],
  limit = QUICK_PICK_LIMIT
): T[] => {
  const eligible = servers.filter((server) => (
    server.status !== 'offline'
    && server.authType === 'none'
    && !server.requiresOAuth
    && !server.requiredHeaders?.some(({ required }) => required !== false)
    && server.browserAccess === 'direct'
    && Boolean(server.browserUrl)
    && Boolean(server.logoUrl)
    && server.logoSourceKind !== 'generated-fallback'
  ));
  const suggested = eligible.filter((server) => server.tags.includes('suggested'));
  const others = eligible.filter((server) => !server.tags.includes('suggested'));
  return [...suggested, ...others].slice(0, limit);
};
