import type { CatalogServer, CatalogTransport, CatalogValidationTransport } from '../types/catalog';

export const SITE_URL = 'https://mcptest.io';

export const getCatalogServerPath = (serverId: string): string => {
  return `/servers/${encodeURIComponent(serverId)}/`;
};

export const getCatalogServerIdFromPath = (pathname: string): string | null => {
  const match = pathname.match(/^\/servers\/([^/]+)\/?$/);
  if (!match) {
    return null;
  }

  try {
    return decodeURIComponent(match[1]);
  } catch {
    return null;
  }
};

export const formatCatalogTransport = (
  transport: CatalogValidationTransport | CatalogTransport
): string => {
  switch (transport) {
    case 'streamable-http':
      return 'Streamable HTTP';
    case 'legacy-sse':
      return 'Legacy HTTP+SSE';
    case 'both':
      return 'Streamable HTTP and legacy SSE';
    default:
      return 'Not yet verified';
  }
};

export const getEffectiveCatalogTransport = (server: CatalogServer) => {
  return server.transport === 'unknown' ? server.declaredTransport : server.transport;
};

const truncateDescription = (value: string, maxLength = 158): string => {
  if (value.length <= maxLength) {
    return value;
  }

  return `${value.slice(0, maxLength - 1).trimEnd()}…`;
};

export const getCatalogServerSeo = (server: CatalogServer) => {
  const transport = formatCatalogTransport(getEffectiveCatalogTransport(server));
  const auth = server.requiresOAuth ? 'OAuth 2.1' : 'no authentication declared';
  const canonicalUrl = `${SITE_URL}${getCatalogServerPath(server.id)}`;
  const description = truncateDescription(
    `${server.name} MCP server connection report: ${transport}, ${auth}, endpoint details, live-test status, and playground compatibility.`
  );

  return {
    title: `${server.name} MCP Server Report | mcptest.io`,
    description,
    canonicalUrl,
    imageUrl: server.logoUrl?.startsWith('http')
      ? server.logoUrl
      : `${SITE_URL}${server.logoUrl || '/logo.png'}`,
    structuredData: {
      '@context': 'https://schema.org',
      '@type': 'WebAPI',
      name: `${server.name} MCP Server`,
      description: server.description,
      url: canonicalUrl,
      endpointUrl: server.url,
      applicationCategory: server.category,
      keywords: server.tags.join(', '),
      documentation: server.homepageUrl || canonicalUrl,
      additionalProperty: [
        {
          '@type': 'PropertyValue',
          name: 'MCP transport',
          value: transport,
        },
        {
          '@type': 'PropertyValue',
          name: 'Authentication',
          value: server.requiresOAuth ? 'OAuth 2.1' : 'None declared',
        },
        {
          '@type': 'PropertyValue',
          name: 'Validation status',
          value: server.status,
        },
      ],
    },
  };
};
