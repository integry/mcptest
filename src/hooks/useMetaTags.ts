import { useEffect } from 'react';
import { useLocation } from 'react-router-dom';
import { getCatalogServerById, getCatalogServers } from '../utils/catalogUtils';
import {
  findCatalogCategoryBySlug,
  getCatalogCategoryNames,
  getCatalogCategorySeo,
  getCatalogCategorySlugFromPath,
  summarizeCatalogCategory,
} from '../utils/catalogCategories';
import {
  getCatalogServerIdFromPath,
  getCatalogServerPath,
  getCatalogServerSeo,
  SITE_URL,
} from '../utils/catalogSeo';
import { BREAKING_CHANGES_METADATA, CATALOG_METADATA, DISCOVERY_METADATA, HOME_METADATA } from '../utils/pageMetadata';
import { BREAKING_CHANGES_TOOL_PATH } from '../utils/breakingChangesRoute';
import { OG_IMAGE_HEIGHT, OG_IMAGE_WIDTH, getOgImagePath } from '../utils/ogImage';
import { parseResultShareUrl } from '../utils/urlUtils';
import { DISCOVERY_CHECKER_PATH, isKnownAppPath } from '../utils/appRoutes';
import {
  LEARN_INDEX_METADATA,
  getContentPage,
  getLearnArticleMetadata,
  isLearnIndexPath,
} from '../content/learnRegistry';

const DEFAULT_IMAGE = `${SITE_URL}/logo.png`;

/** The build-time Open Graph card for a prerendered page path. */
const ogImage = (pagePath: string) => `${SITE_URL}${getOgImagePath(pagePath)}`;

const setMetaTag = (property: string, content: string) => {
  let element = document.querySelector(`meta[property='${property}']`);
  if (!element) {
    element = document.createElement('meta');
    element.setAttribute('property', property);
    document.head.appendChild(element);
  }
  element.setAttribute('content', content);
};

const setNamedMetaTag = (name: string, content: string) => {
  let element = document.querySelector(`meta[name='${name}']`);
  if (!element) {
    element = document.createElement('meta');
    element.setAttribute('name', name);
    document.head.appendChild(element);
  }
  element.setAttribute('content', content);
};

const setCanonical = (href: string) => {
  let element = document.querySelector("link[rel='canonical']");
  if (!element) {
    element = document.createElement('link');
    element.setAttribute('rel', 'canonical');
    document.head.appendChild(element);
  }
  element.setAttribute('href', href);
};

const setStructuredData = (data?: Record<string, unknown>) => {
  const existing = document.getElementById('server-structured-data');
  if (!data) {
    existing?.remove();
    return;
  }

  const element = existing || document.createElement('script');
  element.id = 'server-structured-data';
  element.setAttribute('type', 'application/ld+json');
  element.textContent = JSON.stringify(data);
  if (!existing) {
    document.head.appendChild(element);
  }
};

const applyMetadata = ({
  title,
  description,
  canonicalUrl,
  imageUrl = DEFAULT_IMAGE,
  type = 'website',
  structuredData,
  robots = 'index, follow',
}: {
  title: string;
  description: string;
  canonicalUrl: string;
  imageUrl?: string;
  type?: string;
  structuredData?: Record<string, unknown>;
  robots?: string;
}) => {
  document.title = title;
  // Build-time cards are large 1200x630 images; the fallback logo is a square icon.
  const isCard = imageUrl.startsWith(`${SITE_URL}/og/`);
  setNamedMetaTag('description', description);
  setNamedMetaTag('twitter:card', isCard ? 'summary_large_image' : 'summary');
  setNamedMetaTag('twitter:title', title);
  setNamedMetaTag('twitter:description', description);
  setNamedMetaTag('twitter:image', imageUrl);
  setNamedMetaTag('robots', robots);
  setMetaTag('og:title', title);
  setMetaTag('og:description', description);
  setMetaTag('og:url', canonicalUrl);
  setMetaTag('og:image', imageUrl);
  if (isCard) {
    setMetaTag('og:image:width', String(OG_IMAGE_WIDTH));
    setMetaTag('og:image:height', String(OG_IMAGE_HEIGHT));
    setMetaTag('og:image:alt', title);
    setNamedMetaTag('twitter:image:alt', title);
  } else {
    document.querySelectorAll(
      "meta[property='og:image:width'], meta[property='og:image:height'], meta[property='og:image:alt'], meta[name='twitter:image:alt']"
    ).forEach(element => element.remove());
  }
  setMetaTag('og:type', type);
  setCanonical(canonicalUrl);
  setStructuredData(structuredData);
};

export const useMetaTags = () => {
  const location = useLocation();

  useEffect(() => {
    const resultData = parseResultShareUrl(location.pathname, location.search);
    const serverId = getCatalogServerIdFromPath(location.pathname);
    const catalogServer = serverId ? getCatalogServerById(serverId) : undefined;
    const contentPage = getContentPage(location.pathname);
    const categorySlug = getCatalogCategorySlugFromPath(location.pathname);
    const catalogServers = categorySlug !== null ? getCatalogServers() : [];
    const category = findCatalogCategoryBySlug(getCatalogCategoryNames(catalogServers), categorySlug);

    if (catalogServer) {
      applyMetadata({
        ...getCatalogServerSeo(catalogServer),
        imageUrl: ogImage(getCatalogServerPath(catalogServer.id)),
      });
    } else if (serverId) {
      applyMetadata({
        title: 'MCP Server Not Found | mcptest.io',
        description: 'This MCP server report is not available. Browse the catalog for tested remote MCP servers.',
        canonicalUrl: `${SITE_URL}${location.pathname}`,
        robots: 'noindex, follow',
      });
    } else if (category) {
      const summary = summarizeCatalogCategory(catalogServers, category);
      applyMetadata({
        ...getCatalogCategorySeo(summary),
        imageUrl: ogImage(summary.path),
      });
    } else if (categorySlug !== null) {
      applyMetadata({
        title: 'Catalog Category Not Found | mcptest.io',
        description: 'This catalog category is not available. Browse the catalog for tested remote MCP servers.',
        canonicalUrl: `${SITE_URL}${location.pathname}`,
        robots: 'noindex, follow',
      });
    } else if (contentPage?.kind === 'article') {
      applyMetadata({
        ...getLearnArticleMetadata(contentPage.article),
        imageUrl: ogImage(contentPage.article.path),
      });
    } else if (contentPage?.kind === 'page') {
      applyMetadata({
        title: contentPage.page.metaTitle,
        description: contentPage.page.metaDescription,
        canonicalUrl: `${SITE_URL}${contentPage.page.path}`,
        imageUrl: ogImage(contentPage.page.path),
      });
    } else if (isLearnIndexPath(location.pathname)) {
      applyMetadata({
        title: `${LEARN_INDEX_METADATA.title} | mcptest.io`,
        description: LEARN_INDEX_METADATA.description,
        canonicalUrl: `${SITE_URL}/learn`,
        imageUrl: ogImage('/learn'),
      });
    } else if (location.pathname.startsWith('/learn/')) {
      applyMetadata({
        title: 'Guide Not Found | mcptest.io',
        description: 'This MCP Learn guide is not available. Browse source-backed guides for using and building MCP integrations.',
        canonicalUrl: `${SITE_URL}${location.pathname}`,
        robots: 'noindex, follow',
      });
    } else if (location.pathname === BREAKING_CHANGES_TOOL_PATH) {
      applyMetadata({
        ...BREAKING_CHANGES_METADATA,
        canonicalUrl: `${SITE_URL}${BREAKING_CHANGES_TOOL_PATH}`,
        imageUrl: ogImage(BREAKING_CHANGES_TOOL_PATH),
      });
    } else if (resultData) {
      const { type, name, serverUrl } = resultData;
      const title = `MCP Test Result: ${name}`;
      const description = `Result for ${type} '${name}' from MCP server at ${serverUrl}. Click to view the full response.`;
      
      applyMetadata({
        title,
        description,
        canonicalUrl: `${SITE_URL}${location.pathname}${location.search}`,
        type: 'article',
      });

    } else if (location.pathname.startsWith('/docs/')) {
      applyMetadata({
        title: 'Documentation Not Found | mcptest.io',
        description: 'This documentation page is not available. Browse mcptest.io guides for testing and debugging remote MCP servers.',
        canonicalUrl: `${SITE_URL}${location.pathname}`,
        robots: 'noindex, follow',
      });
    } else if (location.pathname === DISCOVERY_CHECKER_PATH) {
      applyMetadata({
        ...DISCOVERY_METADATA,
        canonicalUrl: `${SITE_URL}${DISCOVERY_CHECKER_PATH}`,
        imageUrl: ogImage(DISCOVERY_CHECKER_PATH),
      });
    } else if (!isKnownAppPath(location.pathname)) {
      applyMetadata({
        title: 'Page Not Found | mcptest.io',
        description: 'This page is not available. Open the playground, browse the MCP server catalog, or read the guides.',
        canonicalUrl: `${SITE_URL}${location.pathname}`,
        robots: 'noindex, follow',
      });
    } else {
      const isCatalog = location.pathname === '/catalog';
      const isHome = location.pathname === '/';
      applyMetadata({
        title: isCatalog ? CATALOG_METADATA.title : HOME_METADATA.title,
        description: isCatalog ? CATALOG_METADATA.description : HOME_METADATA.description,
        canonicalUrl: `${SITE_URL}${location.pathname === '/' ? '' : location.pathname}`,
        imageUrl: isCatalog || isHome ? ogImage(location.pathname) : undefined,
      });
    }

  }, [location]);
};
