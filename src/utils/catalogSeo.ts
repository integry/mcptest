import type {
  CatalogAuthType,
  CatalogProtocolEra,
  CatalogServer,
  CatalogTransport,
  CatalogValidationTransport,
} from '../types/catalog';

export const SITE_URL = 'https://mcptest.io';

export const getCatalogServerImageUrl = (logoUrl?: string): string => {
  return logoUrl?.startsWith('/server-logos/')
    ? `${SITE_URL}${logoUrl}`
    : `${SITE_URL}/logo.png`;
};

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

export const formatCatalogAuth = (authType: CatalogAuthType): string => {
  switch (authType) {
    case 'none':
      return 'No authentication';
    case 'oauth':
      return 'OAuth 2.1';
    case 'bearer-token':
      return 'Bearer token';
    case 'api-token':
      return 'API token';
    case 'api-key':
      return 'API key';
    default:
      return 'Not yet verified';
  }
};

export const formatProtocolEra = (era: CatalogProtocolEra, version?: string): string => {
  const revision = version ? ` · ${version}` : '';

  switch (era) {
    case 'stateless':
      return `Stateless MCP${revision}`;
    case 'stateful':
      return `Stateful MCP${revision}`;
    case 'legacy':
      return `Legacy SSE MCP${revision}`;
    default:
      return 'Not yet negotiated';
  }
};

export const formatCatalogTimestamp = (value: string): string => {
  const timestamp = new Date(value);
  if (Number.isNaN(timestamp.getTime())) {
    return value;
  }

  const date = new Intl.DateTimeFormat('en-US', {
    month: 'short',
    day: 'numeric',
    year: 'numeric',
  }).format(timestamp);
  const time = new Intl.DateTimeFormat('en-US', {
    hour: 'numeric',
    minute: '2-digit',
  }).format(timestamp);

  return `${date} at ${time}`;
};

const truncateDescription = (value: string, maxLength = 158): string => {
  if (value.length <= maxLength) {
    return value;
  }

  return `${value.slice(0, maxLength - 1).trimEnd()}…`;
};

export const getCatalogServerMetaDescription = (server: CatalogServer): string => {
  return truncateDescription(
    server.seoDescription
      || `Inspect the ${server.name} MCP server. ${server.description} Test and debug endpoints.`
  );
};

export const getCatalogServerSeo = (server: CatalogServer) => {
  const transport = formatCatalogTransport(getEffectiveCatalogTransport(server));
  const auth = formatCatalogAuth(server.authType);
  const protocol = formatProtocolEra(server.protocolEra, server.protocolVersion);
  const canonicalUrl = `${SITE_URL}${getCatalogServerPath(server.id)}`;
  const description = getCatalogServerMetaDescription(server);

  return {
    title: `${server.name} MCP Server Report | mcptest.io`,
    description,
    canonicalUrl,
    imageUrl: getCatalogServerImageUrl(server.logoUrl),
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
          value: formatCatalogAuth(server.authType),
        },
        ...(server.alternativeAuthTypes ?? []).map((authType) => ({
          '@type': 'PropertyValue' as const,
          name: 'Alternative authentication',
          value: formatCatalogAuth(authType),
        })),
        {
          '@type': 'PropertyValue',
          name: 'MCP protocol lifecycle',
          value: protocol,
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
