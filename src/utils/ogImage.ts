/**
 * Open Graph images are rendered at build time by scripts/og/ogImages.js,
 * one per prerendered page, at `/og/<page path>.png`. The client meta-tag
 * hook and the prerenderer both resolve image URLs here so they agree.
 */
export const OG_IMAGE_WIDTH = 1200;
export const OG_IMAGE_HEIGHT = 630;

/** Image slug for a page path: `/` is `home`, otherwise the path without its outer slashes. */
export const getOgImageSlug = (pagePath: string): string => {
  const trimmed = pagePath.replace(/^\/+|\/+$/g, '');
  return trimmed || 'home';
};

/** Site-relative image path, e.g. `/og/learn/what-is-mcp.png`. */
export const getOgImagePath = (pagePath: string): string => `/og/${getOgImageSlug(pagePath)}.png`;
