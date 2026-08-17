import { useEffect } from 'react';
import { useLocation } from 'react-router-dom';
import { getCatalogServerById } from '../utils/catalogUtils';
import { getCatalogServerIdFromPath, getCatalogServerSeo, SITE_URL } from '../utils/catalogSeo';
import { getDocsMetadata, HOME_METADATA } from '../utils/pageMetadata';
import { parseResultShareUrl } from '../utils/urlUtils';

const DEFAULT_IMAGE = `${SITE_URL}/logo.png`;

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
  setNamedMetaTag('description', description);
  setNamedMetaTag('twitter:card', 'summary');
  setNamedMetaTag('twitter:title', title);
  setNamedMetaTag('twitter:description', description);
  setNamedMetaTag('twitter:image', imageUrl);
  setNamedMetaTag('robots', robots);
  setMetaTag('og:title', title);
  setMetaTag('og:description', description);
  setMetaTag('og:url', canonicalUrl);
  setMetaTag('og:image', imageUrl);
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
    const docsMetadata = getDocsMetadata(location.pathname);

    if (catalogServer) {
      applyMetadata(getCatalogServerSeo(catalogServer));
    } else if (serverId) {
      applyMetadata({
        title: 'MCP Server Not Found | mcptest.io',
        description: 'This MCP server report is not available. Browse the catalog for tested remote MCP servers.',
        canonicalUrl: `${SITE_URL}${location.pathname}`,
        robots: 'noindex, follow',
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

    } else if (docsMetadata) {
      applyMetadata({
        ...docsMetadata,
        canonicalUrl: `${SITE_URL}${location.pathname.replace(/\/$/, '')}`,
      });
    } else if (location.pathname.startsWith('/docs/')) {
      applyMetadata({
        title: 'Documentation Not Found | mcptest.io',
        description: 'This documentation page is not available. Browse mcptest.io guides for testing and debugging remote MCP servers.',
        canonicalUrl: `${SITE_URL}${location.pathname}`,
        robots: 'noindex, follow',
      });
    } else {
      const isCatalog = location.pathname === '/catalog';
      applyMetadata({
        title: isCatalog ? 'Remote MCP Server Catalog | mcptest.io' : HOME_METADATA.title,
        description: isCatalog
          ? 'Browse remote MCP servers by capability, transport, authentication method, and live validation status.'
          : HOME_METADATA.description,
        canonicalUrl: `${SITE_URL}${location.pathname === '/' ? '' : location.pathname}`,
      });
    }

  }, [location]);
};
