import type {
  CatalogAuthType,
  CatalogProtocolEra,
  CatalogServer,
  CatalogTransport,
  CatalogValidationTransport,
} from '../types/catalog';

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

export const formatCatalogAuth = (authType: CatalogAuthType): string => {
  switch (authType) {
    case 'none':
      return 'No authentication';
    case 'oauth':
      return 'OAuth 2.1';
    case 'bearer-token':
      return 'Bearer token';
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

const truncateDescription = (value: string, maxLength = 158): string => {
  if (value.length <= maxLength) {
    return value;
  }

  return `${value.slice(0, maxLength - 1).trimEnd()}…`;
};

export const getCatalogServerSeo = (server: CatalogServer) => {
  const transport = formatCatalogTransport(getEffectiveCatalogTransport(server));
  const auth = formatCatalogAuth(server.authType);
  const protocol = formatProtocolEra(server.protocolEra, server.protocolVersion);
  const canonicalUrl = `${SITE_URL}${getCatalogServerPath(server.id)}`;
  const description = truncateDescription(
    `${server.name} MCP server connection report: ${transport}, ${protocol}, ${auth}, endpoint details, and live-test status.`
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
          value: formatCatalogAuth(server.authType),
        },
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
