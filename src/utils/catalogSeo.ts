/// <reference lib="es2022.intl" />
import type {
  CatalogAuthType,
  CatalogProtocolEra,
  CatalogServer,
  CatalogTransport,
  CatalogValidationTransport,
} from '../types/catalog';
import { getMissingInventoryNotice, getToolInventoryFeatureList } from './toolInventory.ts';

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

export const getCatalogServerTitle = (name: string): string => {
  const fullSuffix = ' MCP Server: URL, Auth & Setup | mcptest.io';
  const shortSuffix = ' MCP Server: URL, Auth | mcptest.io';
  if (name.length + fullSuffix.length <= 60) return `${name}${fullSuffix}`;
  const budget = 60 - shortSuffix.length;
  const shortName = name.length <= budget ? name : `${name.slice(0, budget - 1).trimEnd()}…`;
  return `${shortName}${shortSuffix}`;
};

/** Detected auth comes from catalogValidation; unknown stays unknown. */
export const getCatalogAuthAnswer = (server: CatalogServer) => {
  switch (server.authType) {
    case 'oauth': return {
      label: 'Sign in with OAuth',
      detail: 'Add the endpoint in your client, start Connect or Sign in, approve the requested scopes, and return to the client. OAuth discovery finds the authorization server; client registration requirements vary by provider. Follow the provider guidance and client setup below.',
      guide: '/learn/oauth-for-mcp-explained',
    };
    case 'api-key': return {
      label: 'API key header',
      detail: `Create a scoped API key with the provider and configure ${server.requiredHeaders?.filter(header => header.secret).map(header => header.name).join(', ') || 'the publisher-documented credential header'} in your client. Use the generated setup below; do not put the key in the endpoint URL.`,
      guide: '/learn/mcp-server-authentication-patterns',
    };
    case 'bearer-token':
    case 'api-token': return {
      label: server.authType === 'bearer-token' ? 'Bearer token' : 'API token header',
      detail: 'Create a scoped provider token and supply it using the credential header and value format documented in the client setup below. Keep credentials out of shared URLs and logs.',
      guide: '/learn/mcp-server-authentication-patterns',
    };
    case 'none': return {
      label: 'No auth',
      detail: 'Add the endpoint directly in your client. The catalog records no authentication requirement; no OAuth sign-in or API key is configured in this setup. The live server may change.',
      guide: '/learn/connect-remote-mcp-server',
    };
    default: return {
      label: 'Auth not yet verified',
      detail: 'Catalog validation has not established the authentication method. Check the publisher documentation and test the endpoint before supplying credentials.',
      guide: '/learn/mcp-server-authentication-patterns',
    };
  }
};

export const getCatalogServerHeading = (server: CatalogServer): string => (
  `${server.name} MCP server`
);

export const getCatalogServerIntro = (server: CatalogServer): string => (
  `Endpoint: ${server.url} · Authentication: ${getCatalogAuthAnswer(server).label}`
);

export const getCatalogServerMetaDescription = (server: CatalogServer, setupPhrases: string[] = []): string => {
  let host: string;
  try { host = new URL(server.url).host; } catch { host = server.url; }
  const auth = {
    oauth: 'with OAuth sign-in',
    none: 'without authentication',
    'api-key': 'with an API key header',
    'bearer-token': 'with a bearer token',
    'api-token': 'with an API token header',
    unknown: 'with authentication not yet verified',
  }[server.authType];
  const answer = `Connect to the ${server.name} MCP server at ${host} ${auth}.`;
  const rawSummary = (server.seoDescription || server.description).trim();
  // Keep only complete sentences; never publish a source's clipped ending.
  const sentences = Array.from(new Intl.Segmenter('en', { granularity: 'sentence' }).segment(rawSummary),
    ({ segment }) => segment.trim()).filter(sentence => /(?<!\.)[.!?]$/.test(sentence));
  const summary = sentences.join(' ');
  // Drop client names before removing any summary sentences.
  for (const phrase of [...setupPhrases, '']) {
    const description = [answer, phrase, summary].filter(Boolean).join(' ');
    if (description.length <= 158) return description;
  }
  let description = answer;
  for (const sentence of sentences) {
    if (description.length + sentence.length + 1 > 158) break;
    description += ` ${sentence}`;
  }
  return description;
};

/** Inventory counts and snapshot date, or why no inventory was observed. */
export const getToolInventoryProperties = (
  server: Pick<CatalogServer, 'name' | 'authType' | 'capabilityInventory'>
) => {
  const inventory = server.capabilityInventory;
  if (!inventory) {
    return [{
      '@type': 'PropertyValue' as const,
      name: 'Tool inventory',
      value: getMissingInventoryNotice(server).title,
    }];
  }
  return [
    { '@type': 'PropertyValue' as const, name: 'Tool inventory observed at', value: inventory.observedAt },
    { '@type': 'PropertyValue' as const, name: 'Tools observed', value: inventory.tools.observedCount },
    { '@type': 'PropertyValue' as const, name: 'Resources observed', value: inventory.resources.observedCount },
    {
      '@type': 'PropertyValue' as const,
      name: 'Resource templates observed',
      value: inventory.resourceTemplates.observedCount,
    },
    { '@type': 'PropertyValue' as const, name: 'Prompts observed', value: inventory.prompts.observedCount },
  ];
};

export const getCatalogServerSeo = (server: CatalogServer) => {
  const transport = formatCatalogTransport(getEffectiveCatalogTransport(server));
  const auth = formatCatalogAuth(server.authType);
  const protocol = formatProtocolEra(server.protocolEra, server.protocolVersion);
  const canonicalUrl = `${SITE_URL}${getCatalogServerPath(server.id)}`;
  const description = getCatalogServerMetaDescription(server);

  return {
    title: getCatalogServerTitle(server.name),
    description,
    canonicalUrl,
    imageUrl: getCatalogServerImageUrl(server.logoUrl),
    structuredData: {
      '@context': 'https://schema.org',
      // SoftwareApplication carries applicationCategory and featureList.
      '@type': ['WebAPI', 'SoftwareApplication'],
      name: `${server.name} MCP Server`,
      description: server.description,
      url: canonicalUrl,
      endpointUrl: server.url,
      applicationCategory: server.category,
      keywords: server.tags.join(', '),
      documentation: server.homepageUrl || canonicalUrl,
      ...(server.capabilityInventory?.tools.items.length || server.capabilityInventory?.prompts.items.length
        ? { featureList: getToolInventoryFeatureList(server.capabilityInventory) }
        : {}),
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
        ...getToolInventoryProperties(server),
      ],
    },
  };
};
