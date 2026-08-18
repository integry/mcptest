import type {
  CatalogAuthType,
  CatalogRequiredHeader,
  CatalogServer,
  CatalogTransport,
} from '../types/catalog';

export type ClientSetupId = 'claude-code' | 'codex-cli' | 'cursor' | 'vs-code';
export type EndpointProvenance = 'canonical' | 'live-validated' | 'browser-verified';
export type ClientSetupFormat = 'shell' | 'json' | 'toml' | 'text';

export interface PreferredCatalogEndpoint {
  url: string;
  provenance: EndpointProvenance;
  provenanceLabel: string;
  transport: CatalogTransport;
}

export interface ClientSetup {
  id: ClientSetupId;
  label: string;
  heading: string;
  documentationUrl: string;
  documentationLabel: string;
  location: string;
  copyText: string;
  format: ClientSetupFormat;
  supported: boolean;
  endpoint: PreferredCatalogEndpoint;
  authSummary: string;
  notes: string[];
}

interface HeaderTemplate {
  name: string;
  environmentVariable: string;
  valueTemplate: string;
}

const CLIENT_DOCUMENTATION = {
  'claude-code': 'https://code.claude.com/docs/en/mcp',
  'codex-cli': 'https://developers.openai.com/codex/mcp/',
  cursor: 'https://cursor.com/docs/context/mcp',
  'vs-code': 'https://code.visualstudio.com/docs/agent-customization/mcp-servers',
} as const;

const PROVENANCE_LABELS: Record<EndpointProvenance, string> = {
  canonical: 'Canonical catalog endpoint',
  'live-validated': 'Live-validated endpoint',
  'browser-verified': 'Browser-verified endpoint',
};

const CREDENTIAL_AUTH_TYPES = new Set<CatalogAuthType>([
  'bearer-token',
  'api-token',
  'api-key',
]);

/**
 * Turn a catalog identifier into a portable config key and CLI name. The
 * returned value contains only lowercase ASCII letters, numbers, and hyphens.
 */
export const sanitizeClientSetupKey = (serverId: string): string => {
  const normalized = String(serverId)
    .normalize('NFKD')
    .toLowerCase()
    .replace(/[\u0300-\u036f]/g, '')
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-+|-+$/g, '')
    .slice(0, 64)
    .replace(/-+$/g, '');
  const key = normalized || 'mcp-server';
  return /^[a-z]/.test(key) ? key : `mcp-${key}`.slice(0, 64);
};

const toEnvironmentVariable = (serverId: string, authType: CatalogAuthType): string => {
  const prefix = sanitizeClientSetupKey(serverId).replace(/-/g, '_').toUpperCase();
  if (authType === 'api-key') return `${prefix}_API_KEY`;
  if (authType === 'api-token') return `${prefix}_API_TOKEN`;
  return `${prefix}_TOKEN`;
};

const effectiveTransport = (server: CatalogServer, endpoint: string): CatalogTransport => {
  if (/\/sse\/?(?:[?#].*)?$/i.test(endpoint)) return 'legacy-sse';
  if (server.transport === 'streamable-http' || server.transport === 'legacy-sse') {
    return server.transport;
  }
  return server.declaredTransport;
};

/** Select the endpoint used by the Playground and every client setup surface. */
export const getPreferredCatalogEndpoint = (server: CatalogServer): PreferredCatalogEndpoint => {
  const provenance: EndpointProvenance = server.browserUrl
    ? 'browser-verified'
    : server.validatedUrl
      ? 'live-validated'
      : 'canonical';
  const url = server.browserUrl || server.validatedUrl || server.url;
  return {
    url,
    provenance,
    provenanceLabel: PROVENANCE_LABELS[provenance],
    transport: effectiveTransport(server, url),
  };
};

/** POSIX shell quoting for catalog-controlled names and URLs. */
export const quoteShellArgument = (value: string): string => {
  return `'${String(value).replace(/'/g, `'"'"'`)}'`;
};

/** TOML basic-string serialization; JSON string escaping is valid TOML here. */
export const serializeTomlString = (value: string): string => JSON.stringify(String(value));

const placeholderFromDescription = (header: CatalogRequiredHeader): string | undefined => {
  return header.description?.match(/<([A-Z][A-Z0-9_]{1,63})>/)?.[1];
};

const exactHeaderTemplate = (
  server: CatalogServer,
  authType: CatalogAuthType,
  header: CatalogRequiredHeader
): HeaderTemplate | undefined => {
  // Reject malformed HTTP field names rather than putting them into a command or config.
  if (!/^[!#$%&'*+.^_`|~0-9A-Za-z-]+$/.test(header.name)) return undefined;

  const environmentVariable = placeholderFromDescription(header)
    || toEnvironmentVariable(server.id, authType);
  const placeholder = `<${environmentVariable}>`;
  const description = header.description || '';
  const exactAuthorization = description.match(
    new RegExp(`\\b(Bearer\\s+|Token\\s+token=)${placeholder.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')}`, 'i')
  );

  let valueTemplate = placeholder;
  if (exactAuthorization) {
    valueTemplate = `${exactAuthorization[1]}${placeholder}`;
  } else if (header.name.toLowerCase() === 'authorization' && authType === 'bearer-token') {
    valueTemplate = `Bearer ${placeholder}`;
  }

  return { name: header.name, environmentVariable, valueTemplate };
};

const credentialHeader = (
  server: CatalogServer,
  authType: CatalogAuthType
): HeaderTemplate | undefined => {
  if (!CREDENTIAL_AUTH_TYPES.has(authType)) return undefined;
  const documented = server.requiredHeaders?.find((header) => header.secret);
  if (documented) return exactHeaderTemplate(server, authType, documented);

  // Authorization: Bearer is defined by the auth type itself. API key/token
  // header names are not, so those combinations need publisher guidance.
  if (authType === 'bearer-token') {
    const environmentVariable = toEnvironmentVariable(server.id, authType);
    return {
      name: 'Authorization',
      environmentVariable,
      valueTemplate: `Bearer <${environmentVariable}>`,
    };
  }
  return undefined;
};

const replacePlaceholder = (template: string, replacement: string): string => {
  return template.replace(/<[A-Z][A-Z0-9_]{1,63}>/, replacement);
};

const shellHeaderArgument = (header: HeaderTemplate): string => {
  const marker = `<${header.environmentVariable}>`;
  const [before, after = ''] = header.valueTemplate.split(marker);
  return [
    quoteShellArgument(`${header.name}: ${before}`),
    `"\${${header.environmentVariable}}"`,
    after ? quoteShellArgument(after) : '',
  ].join('');
};

const jsonConfig = (value: unknown): string => JSON.stringify(value, null, 2);

const authSummary = (server: CatalogServer): string => {
  if (server.authType === 'oauth') {
    return 'OAuth: the client will request authorization after the server is added.';
  }
  if (server.authType === 'none') return 'No authentication is required by the catalog listing.';
  if (server.authType === 'bearer-token') return 'Bearer token authentication uses a named environment placeholder.';
  if (server.authType === 'api-token') return 'API token authentication uses the publisher-documented header syntax when available.';
  if (server.authType === 'api-key') return 'API key authentication uses the publisher-documented header name when available.';
  return 'Authentication has not been verified; no credential configuration is fabricated.';
};

const secureStorageNote = (header: HeaderTemplate): string => {
  return `Store ${header.environmentVariable} in your operating system keychain, secret manager, or protected environment; never commit the value. The ${header.name} header syntax is ${header.valueTemplate}.`;
};

const commonNotes = (server: CatalogServer, endpoint: PreferredCatalogEndpoint): string[] => {
  const notes = [`Using ${endpoint.provenanceLabel.toLowerCase()}: ${endpoint.url}`];
  if (server.authType === 'oauth') {
    notes.push('The client will request authorization in your browser; no OAuth secret belongs in this configuration.');
  } else if (server.authType === 'unknown') {
    notes.push('Confirm the authentication method in the publisher documentation before adding credentials.');
  }

  for (const authType of server.alternativeAuthTypes || []) {
    const header = credentialHeader(server, authType);
    if (header) {
      notes.push(`Optional ${authType.replace('-', ' ')} alternative: ${secureStorageNote(header)}`);
    } else {
      notes.push(`An optional ${authType.replace('-', ' ')} flow is cataloged, but its exact header is not documented; follow the publisher instructions instead of guessing.`);
    }
  }

  for (const header of server.requiredHeaders || []) {
    if (!header.secret) {
      notes.push(`${header.required === false ? 'Optional' : 'Required'} header ${header.name}${header.description ? `: ${header.description}` : '.'}`);
    }
  }
  for (const caveat of server.caveats || []) {
    notes.push(`Provider guidance: ${caveat}`);
  }
  return notes;
};

const claudeSetup = (server: CatalogServer, endpoint: PreferredCatalogEndpoint): ClientSetup => {
  const key = sanitizeClientSetupKey(server.id);
  const header = credentialHeader(server, server.authType);
  const transport = endpoint.transport === 'legacy-sse' ? 'sse' : 'http';
  const command = [
    'claude mcp add',
    `--transport ${transport}`,
    '--scope user',
    ...(header ? [
      `--header ${shellHeaderArgument(header)}`,
    ] : []),
    quoteShellArgument(key),
    quoteShellArgument(endpoint.url),
  ].join(' ');
  const notes = commonNotes(server, endpoint);
  if (server.authType === 'oauth') {
    notes.push('After adding the server, open Claude Code, run /mcp, select the server, and follow the browser flow to authenticate.');
  }
  if (header) notes.push(secureStorageNote(header));
  if (CREDENTIAL_AUTH_TYPES.has(server.authType) && !header) {
    notes.push('The catalog does not document the credential header, so add it through Claude Code only after checking the publisher documentation.');
  }
  return {
    id: 'claude-code', label: 'Claude Code', heading: 'Claude Code setup',
    documentationUrl: CLIENT_DOCUMENTATION['claude-code'],
    documentationLabel: 'Claude Code MCP documentation',
    location: 'Run in a terminal. This user-scoped entry is available across projects.',
    copyText: command, format: 'shell',
    supported: !(CREDENTIAL_AUTH_TYPES.has(server.authType) && !header), endpoint,
    authSummary: authSummary(server), notes,
  };
};

const codexSetup = (server: CatalogServer, endpoint: PreferredCatalogEndpoint): ClientSetup => {
  const key = sanitizeClientSetupKey(server.id);
  const header = credentialHeader(server, server.authType);
  if (endpoint.transport === 'legacy-sse') {
    return {
      id: 'codex-cli', label: 'Codex CLI', heading: 'Codex CLI setup',
      documentationUrl: CLIENT_DOCUMENTATION['codex-cli'],
      documentationLabel: 'Codex MCP documentation',
      location: 'Review the endpoint in the publisher documentation before editing Codex configuration.',
      copyText: 'Codex CLI supports Streamable HTTP remote servers, not legacy SSE endpoints. Use a publisher-documented Streamable HTTP endpoint if one is available.',
      format: 'text', supported: false, endpoint,
      authSummary: authSummary(server), notes: commonNotes(server, endpoint),
    };
  }

  let copyText: string;
  let format: ClientSetupFormat = 'shell';
  let location = 'Run in a terminal; Codex stores the entry in ~/.codex/config.toml.';
  if (header && header.valueTemplate === `Bearer <${header.environmentVariable}>`) {
    copyText = `codex mcp add ${quoteShellArgument(key)} --url ${quoteShellArgument(endpoint.url)} --bearer-token-env-var ${quoteShellArgument(header.environmentVariable)}`;
  } else if (header) {
    // env_http_headers reads the complete header value from the environment,
    // preserving non-Bearer schemes such as PagerDuty's "Token token=".
    const fullValueEnvironment = `${header.environmentVariable}_HEADER`;
    copyText = [
      `[mcp_servers.${key}]`,
      `url = ${serializeTomlString(endpoint.url)}`,
      `env_http_headers = { ${serializeTomlString(header.name)} = ${serializeTomlString(fullValueEnvironment)} }`,
    ].join('\n');
    format = 'toml';
    location = `Add to ~/.codex/config.toml, then set ${fullValueEnvironment} securely to the complete ${header.valueTemplate} header value.`;
  } else {
    copyText = `codex mcp add ${quoteShellArgument(key)} --url ${quoteShellArgument(endpoint.url)}`;
  }
  if (server.authType === 'oauth') {
    copyText += `\ncodex mcp login ${quoteShellArgument(key)}`;
  }
  const notes = commonNotes(server, endpoint);
  if (header) notes.push(secureStorageNote(header));
  if (CREDENTIAL_AUTH_TYPES.has(server.authType) && !header) {
    notes.push('Codex cannot be configured faithfully because the catalog does not identify the credential header. Check the publisher documentation.');
  }
  return {
    id: 'codex-cli', label: 'Codex CLI', heading: 'Codex CLI setup',
    documentationUrl: CLIENT_DOCUMENTATION['codex-cli'],
    documentationLabel: 'Codex MCP documentation', location,
    copyText, format, supported: !(CREDENTIAL_AUTH_TYPES.has(server.authType) && !header),
    endpoint, authSummary: authSummary(server), notes,
  };
};

const cursorSetup = (server: CatalogServer, endpoint: PreferredCatalogEndpoint): ClientSetup => {
  const key = sanitizeClientSetupKey(server.id);
  const header = credentialHeader(server, server.authType);
  const config: Record<string, unknown> = { url: endpoint.url };
  if (header) {
    config.headers = {
      [header.name]: replacePlaceholder(header.valueTemplate, `\${env:${header.environmentVariable}}`),
    };
  }
  const notes = commonNotes(server, endpoint);
  if (endpoint.transport === 'legacy-sse') {
    notes.push('This URL is a legacy SSE endpoint; Cursor determines the remote transport from the endpoint.');
  }
  if (header) notes.push(secureStorageNote(header));
  if (CREDENTIAL_AUTH_TYPES.has(server.authType) && !header) {
    notes.push('The credential header is not documented, so this config contains only the URL. Add authentication only from publisher guidance.');
  }
  return {
    id: 'cursor', label: 'Cursor', heading: 'Cursor setup',
    documentationUrl: CLIENT_DOCUMENTATION.cursor,
    documentationLabel: 'Cursor MCP documentation',
    location: 'Add to .cursor/mcp.json for this project, or ~/.cursor/mcp.json for all projects.',
    copyText: jsonConfig({ mcpServers: { [key]: config } }), format: 'json',
    supported: !(CREDENTIAL_AUTH_TYPES.has(server.authType) && !header),
    endpoint, authSummary: authSummary(server), notes,
  };
};

const vsCodeSetup = (server: CatalogServer, endpoint: PreferredCatalogEndpoint): ClientSetup => {
  const key = sanitizeClientSetupKey(server.id);
  const header = credentialHeader(server, server.authType);
  const config: Record<string, unknown> = {
    type: endpoint.transport === 'legacy-sse' ? 'sse' : 'http',
    url: endpoint.url,
  };
  const root: Record<string, unknown> = { servers: { [key]: config } };
  if (header) {
    const inputId = header.environmentVariable.toLowerCase();
    config.headers = {
      [header.name]: replacePlaceholder(header.valueTemplate, `\${input:${inputId}}`),
    };
    root.inputs = [{
      type: 'promptString', id: inputId,
      description: `${header.environmentVariable} for ${server.name}`,
      password: true,
    }];
  }
  const notes = commonNotes(server, endpoint);
  if (header) {
    notes.push(`VS Code requests ${header.environmentVariable} as a masked input; use a secret manager and do not put a default value in mcp.json. The ${header.name} syntax remains ${header.valueTemplate}.`);
  }
  if (CREDENTIAL_AUTH_TYPES.has(server.authType) && !header) {
    notes.push('The credential header is not documented, so this config contains only the endpoint. Use “MCP: Add Server” after consulting publisher guidance.');
  }
  return {
    id: 'vs-code', label: 'VS Code', heading: 'VS Code setup',
    documentationUrl: CLIENT_DOCUMENTATION['vs-code'],
    documentationLabel: 'VS Code MCP documentation',
    location: 'Add to .vscode/mcp.json, or run “MCP: Open User Configuration” for a private user-level entry.',
    copyText: jsonConfig(root), format: 'json',
    supported: !(CREDENTIAL_AUTH_TYPES.has(server.authType) && !header),
    endpoint, authSummary: authSummary(server), notes,
  };
};

/** Generate the complete, deterministic client setup model without touching the DOM. */
export const generateClientSetups = (server: CatalogServer): ClientSetup[] => {
  const endpoint = getPreferredCatalogEndpoint(server);
  return [
    claudeSetup(server, endpoint),
    codexSetup(server, endpoint),
    cursorSetup(server, endpoint),
    vsCodeSetup(server, endpoint),
  ];
};
