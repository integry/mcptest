import type {
  CatalogAuthType,
  CatalogOAuthClientId,
  CatalogOAuthRegistrationEvidence,
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

const setupAuthType = (server: CatalogServer): CatalogAuthType => {
  const registration = server.oauthRegistration;
  return registration?.mode === 'unavailable-or-use-alternative'
    && registration.alternativeAuthType
    ? registration.alternativeAuthType
    : server.authType;
};

const authTypeLabel = (authType: CatalogAuthType): string => {
  if (authType === 'api-token') return 'API token';
  if (authType === 'api-key') return 'API key';
  if (authType === 'bearer-token') return 'Bearer token';
  return authType.replace('-', ' ');
};

const preRegisteredOAuth = (
  server: CatalogServer
): CatalogOAuthRegistrationEvidence | undefined => {
  return server.authType === 'oauth'
    && server.oauthRegistration?.mode === 'pre-registered-required'
    ? server.oauthRegistration
    : undefined;
};

const oauthEnvironmentVariable = (
  requirement: CatalogOAuthRegistrationEvidence['clientId'],
  fallback: string
): string => requirement.environmentVariable || fallback;

const oauthRedirects = (
  registration: CatalogOAuthRegistrationEvidence,
  clientId: CatalogOAuthClientId
): string[] => registration.callback.redirectUrls?.[clientId] || [];

const loopbackPort = (urls: string[]): number | undefined => {
  for (const value of urls) {
    try {
      const url = new URL(value);
      if ((url.hostname === 'localhost' || url.hostname === '127.0.0.1') && url.port) {
        return Number(url.port);
      }
    } catch {
      // Catalog validation reports malformed callback evidence. Keep generation non-throwing.
    }
  }
  return undefined;
};

const authSummary = (server: CatalogServer, selectedAuthType = setupAuthType(server)): string => {
  if (server.authType === 'oauth'
      && server.oauthRegistration?.mode === 'pre-registered-required') {
    return 'OAuth pre-registration required: provide a registered client ID, client secret, and the exact callback URL for this client.';
  }
  if (server.authType === 'oauth'
      && server.oauthRegistration?.mode === 'unavailable-or-use-alternative') {
    return `${authTypeLabel(selectedAuthType)} setup is preferred because automatic OAuth client registration is unavailable.`;
  }
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

const completeHeaderValueDescription = (header: HeaderTemplate): string => {
  const credentialMarker = `<${header.environmentVariable}>`;
  return header.valueTemplate === credentialMarker
    ? `the raw credential value, which is the complete ${header.name} header value`
    : `the complete ${header.name} header value, including the required syntax ${header.valueTemplate.replace(credentialMarker, '<credential>')}`;
};

const secureCompleteHeaderStorageNote = (
  header: HeaderTemplate,
  environmentVariable: string
): string => {
  return `Store ${environmentVariable} in your operating system keychain, secret manager, or protected environment; never commit the value. Set it to ${completeHeaderValueDescription(header)}.`;
};

const commonNotes = (
  server: CatalogServer,
  endpoint: PreferredCatalogEndpoint,
  selectedAuthType = setupAuthType(server)
): string[] => {
  const notes = [`Using ${endpoint.provenanceLabel.toLowerCase()}: ${endpoint.url}`];
  if (server.authType === 'oauth' && server.oauthRegistration?.mode === 'pre-registered-required') {
    notes.push(`Register the client before connecting; automatic Dynamic Client Registration is not available. Publisher evidence: ${server.oauthRegistration.evidenceUrl}`);
  } else if (server.authType === 'oauth'
      && server.oauthRegistration?.mode === 'unavailable-or-use-alternative') {
    notes.push(`Automatic OAuth client registration is unavailable. This setup uses the publisher-documented ${authTypeLabel(selectedAuthType)} alternative. Publisher evidence: ${server.oauthRegistration.evidenceUrl}`);
    const alternativeHeader = credentialHeader(server, selectedAuthType);
    if (alternativeHeader) {
      notes.push(`Use the exact publisher-documented ${alternativeHeader.name} header syntax: ${alternativeHeader.valueTemplate}.`);
    }
  } else if (server.authType === 'oauth') {
    notes.push('The client will request authorization in your browser; no OAuth secret belongs in this configuration.');
  } else if (server.authType === 'unknown') {
    notes.push('Confirm the authentication method in the publisher documentation before adding credentials.');
  }

  for (const authType of server.alternativeAuthTypes || []) {
    if (authType === selectedAuthType) continue;
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
  for (const alternative of server.alternativeEndpoints || []) {
    notes.push(`Alternative endpoint: ${alternative.url} — ${alternative.description}.`);
  }
  for (const caveat of server.caveats || []) {
    notes.push(`Provider guidance: ${caveat}`);
  }
  return notes;
};

const claudeSetup = (server: CatalogServer, endpoint: PreferredCatalogEndpoint): ClientSetup => {
  const key = sanitizeClientSetupKey(server.id);
  const selectedAuthType = setupAuthType(server);
  const registration = preRegisteredOAuth(server);
  const header = credentialHeader(server, selectedAuthType);
  const transport = endpoint.transport === 'legacy-sse' ? 'sse' : 'http';
  const clientIdEnvironment = registration
    ? oauthEnvironmentVariable(registration.clientId, `${key.replace(/-/g, '_').toUpperCase()}_CLIENT_ID`)
    : undefined;
  const callbackPort = registration
    ? loopbackPort(oauthRedirects(registration, 'claude-code'))
    : undefined;
  const command = [
    'claude mcp add',
    `--transport ${transport}`,
    '--scope user',
    ...(registration && clientIdEnvironment ? [
      `--client-id "\${${clientIdEnvironment}}"`,
      '--client-secret',
      ...(callbackPort ? [`--callback-port ${callbackPort}`] : []),
    ] : []),
    ...(header ? [
      `--header ${shellHeaderArgument(header)}`,
    ] : []),
    quoteShellArgument(key),
    quoteShellArgument(endpoint.url),
  ].join(' ');
  const notes = commonNotes(server, endpoint, selectedAuthType);
  if (registration) {
    const redirects = oauthRedirects(registration, 'claude-code');
    notes.push(`Register this exact Claude Code redirect URL: ${redirects.join(', ')}.`);
    notes.push('The bare --client-secret option opens Claude Code\'s masked prompt; the secret is stored securely instead of appearing in the command or configuration file.');
  } else if (server.authType === 'oauth'
      && server.oauthRegistration?.mode !== 'unavailable-or-use-alternative') {
    notes.push('After adding the server, open Claude Code, run /mcp, select the server, and follow the browser flow to authenticate.');
  }
  if (header) notes.push(secureStorageNote(header));
  if (CREDENTIAL_AUTH_TYPES.has(selectedAuthType) && !header) {
    notes.push('The catalog does not document the credential header, so add it through Claude Code only after checking the publisher documentation.');
  }
  return {
    id: 'claude-code', label: 'Claude Code', heading: 'Claude Code setup',
    documentationUrl: CLIENT_DOCUMENTATION['claude-code'],
    documentationLabel: 'Claude Code MCP documentation',
    location: 'Run in a terminal. This user-scoped entry is available across projects.',
    copyText: command, format: 'shell',
    supported: !(CREDENTIAL_AUTH_TYPES.has(selectedAuthType) && !header), endpoint,
    authSummary: authSummary(server, selectedAuthType), notes,
  };
};

const codexSetup = (server: CatalogServer, endpoint: PreferredCatalogEndpoint): ClientSetup => {
  const key = sanitizeClientSetupKey(server.id);
  const selectedAuthType = setupAuthType(server);
  const registration = preRegisteredOAuth(server);
  const header = credentialHeader(server, selectedAuthType);
  if (endpoint.transport === 'legacy-sse') {
    return {
      id: 'codex-cli', label: 'Codex CLI', heading: 'Codex CLI setup',
      documentationUrl: CLIENT_DOCUMENTATION['codex-cli'],
      documentationLabel: 'Codex MCP documentation',
      location: 'Review the endpoint in the publisher documentation before editing Codex configuration.',
      copyText: 'Codex CLI supports Streamable HTTP remote servers, not legacy SSE endpoints. Use a publisher-documented Streamable HTTP endpoint if one is available.',
      format: 'text', supported: false, endpoint,
      authSummary: authSummary(server, selectedAuthType),
      notes: commonNotes(server, endpoint, selectedAuthType),
    };
  }

  if (registration) {
    const remote = registration.codexMcpRemote;
    const notes = commonNotes(server, endpoint, selectedAuthType);
    if (!remote) {
      notes.push('Native direct setup is unsupported because Codex does not accept the required static OAuth client secret. No secret option is fabricated.');
      return {
        id: 'codex-cli', label: 'Codex CLI', heading: 'Codex CLI setup',
        documentationUrl: CLIENT_DOCUMENTATION['codex-cli'],
        documentationLabel: 'Codex MCP documentation',
        location: 'Use a publisher-documented compatibility bridge, or choose a client with native pre-registered OAuth support.',
        copyText: 'Native direct Codex setup is unsupported for this pre-registered OAuth server.',
        format: 'text', supported: false, endpoint,
        authSummary: authSummary(server, selectedAuthType), notes,
      };
    }

    const clientIdEnvironment = oauthEnvironmentVariable(
      registration.clientId,
      `${key.replace(/-/g, '_').toUpperCase()}_CLIENT_ID`
    );
    const clientSecretEnvironment = oauthEnvironmentVariable(
      registration.clientSecret,
      `${key.replace(/-/g, '_').toUpperCase()}_CLIENT_SECRET`
    );
    const staticClientInfo = JSON.stringify({
      client_id: `$${clientIdEnvironment}`,
      client_secret: `$${clientSecretEnvironment}`,
    });
    const shellClientInfo = `"${staticClientInfo.replace(/\\/g, '\\\\').replace(/"/g, '\\"')}"`;
    const bridgeCommand = [
      'npx -y mcp-remote@latest',
      quoteShellArgument(endpoint.url),
      String(remote.callbackPort),
      '--static-oauth-client-info',
      shellClientInfo,
      '--resource',
      quoteShellArgument(remote.resourceUrl),
    ].join(' ');
    const copyText = [
      `[mcp_servers.${key}]`,
      'command = "sh"',
      'args = [',
      '  "-c",',
      `  ${serializeTomlString(bridgeCommand)}`,
      ']',
      `env_vars = [${serializeTomlString(clientIdEnvironment)}, ${serializeTomlString(clientSecretEnvironment)}]`,
    ].join('\n');
    notes.push(`Register this exact Codex redirect URL: ${oauthRedirects(registration, 'codex-cli').join(', ')}.`);
    notes.push(`This is ${server.name}'s publisher-documented mcp-remote compatibility setup. The publisher warns that mcp-remote is experimental community software; review it before use.`);
    notes.push(`Store ${clientIdEnvironment} and ${clientSecretEnvironment} in a protected environment or secret manager; never commit their values.`);
    return {
      id: 'codex-cli', label: 'Codex CLI', heading: 'Codex CLI setup',
      documentationUrl: CLIENT_DOCUMENTATION['codex-cli'],
      documentationLabel: 'Codex MCP documentation',
      location: 'Add to ~/.codex/config.toml. This publisher-documented bridge requires Node.js and a POSIX sh environment.',
      copyText, format: 'toml', supported: true, endpoint,
      authSummary: authSummary(server, selectedAuthType), notes,
    };
  }

  let copyText: string;
  let format: ClientSetupFormat = 'shell';
  let location = 'Run in a terminal; Codex stores the entry in ~/.codex/config.toml.';
  let fullValueEnvironment: string | undefined;
  if (header && header.valueTemplate === `Bearer <${header.environmentVariable}>`) {
    copyText = `codex mcp add ${quoteShellArgument(key)} --url ${quoteShellArgument(endpoint.url)} --bearer-token-env-var ${quoteShellArgument(header.environmentVariable)}`;
  } else if (header) {
    // env_http_headers reads the complete header value from the environment,
    // preserving non-Bearer schemes such as PagerDuty's "Token token=".
    fullValueEnvironment = `${header.environmentVariable}_HEADER`;
    copyText = [
      `[mcp_servers.${key}]`,
      `url = ${serializeTomlString(endpoint.url)}`,
      `env_http_headers = { ${serializeTomlString(header.name)} = ${serializeTomlString(fullValueEnvironment)} }`,
    ].join('\n');
    format = 'toml';
    location = `Add to ~/.codex/config.toml, then securely set ${fullValueEnvironment} to ${completeHeaderValueDescription(header)}.`;
  } else {
    copyText = `codex mcp add ${quoteShellArgument(key)} --url ${quoteShellArgument(endpoint.url)}`;
  }
  if (server.authType === 'oauth'
      && server.oauthRegistration?.mode !== 'unavailable-or-use-alternative') {
    copyText += `\ncodex mcp login ${quoteShellArgument(key)}`;
  }
  const notes = commonNotes(server, endpoint, selectedAuthType);
  if (header) {
    notes.push(fullValueEnvironment
      ? secureCompleteHeaderStorageNote(header, fullValueEnvironment)
      : secureStorageNote(header));
  }
  if (CREDENTIAL_AUTH_TYPES.has(selectedAuthType) && !header) {
    notes.push('Codex cannot be configured faithfully because the catalog does not identify the credential header. Check the publisher documentation.');
  }
  return {
    id: 'codex-cli', label: 'Codex CLI', heading: 'Codex CLI setup',
    documentationUrl: CLIENT_DOCUMENTATION['codex-cli'],
    documentationLabel: 'Codex MCP documentation', location,
    copyText, format, supported: !(CREDENTIAL_AUTH_TYPES.has(selectedAuthType) && !header),
    endpoint, authSummary: authSummary(server, selectedAuthType), notes,
  };
};

const cursorSetup = (server: CatalogServer, endpoint: PreferredCatalogEndpoint): ClientSetup => {
  const key = sanitizeClientSetupKey(server.id);
  const selectedAuthType = setupAuthType(server);
  const registration = preRegisteredOAuth(server);
  const header = credentialHeader(server, selectedAuthType);
  const config: Record<string, unknown> = { url: endpoint.url };
  if (registration) {
    const clientIdEnvironment = oauthEnvironmentVariable(
      registration.clientId,
      `${key.replace(/-/g, '_').toUpperCase()}_CLIENT_ID`
    );
    const clientSecretEnvironment = oauthEnvironmentVariable(
      registration.clientSecret,
      `${key.replace(/-/g, '_').toUpperCase()}_CLIENT_SECRET`
    );
    config.auth = {
      CLIENT_ID: `\${env:${clientIdEnvironment}}`,
      CLIENT_SECRET: `\${env:${clientSecretEnvironment}}`,
    };
  } else if (header) {
    config.headers = {
      [header.name]: replacePlaceholder(header.valueTemplate, `\${env:${header.environmentVariable}}`),
    };
  }
  const notes = commonNotes(server, endpoint, selectedAuthType);
  if (endpoint.transport === 'legacy-sse') {
    notes.push('This URL is a legacy SSE endpoint; Cursor determines the remote transport from the endpoint.');
  }
  if (registration) {
    notes.push(`Register this exact Cursor redirect URL: ${oauthRedirects(registration, 'cursor').join(', ')}.`);
    notes.push('Cursor Static OAuth reads the client ID and secret from the named environment variables; never commit either value.');
  } else if (header) notes.push(secureStorageNote(header));
  if (CREDENTIAL_AUTH_TYPES.has(selectedAuthType) && !header) {
    notes.push('The credential header is not documented, so this config contains only the URL. Add authentication only from publisher guidance.');
  }
  return {
    id: 'cursor', label: 'Cursor', heading: 'Cursor setup',
    documentationUrl: CLIENT_DOCUMENTATION.cursor,
    documentationLabel: 'Cursor MCP documentation',
    location: 'Add to .cursor/mcp.json for this project, or ~/.cursor/mcp.json for all projects.',
    copyText: jsonConfig({ mcpServers: { [key]: config } }), format: 'json',
    supported: !(CREDENTIAL_AUTH_TYPES.has(selectedAuthType) && !header),
    endpoint, authSummary: authSummary(server, selectedAuthType), notes,
  };
};

const vsCodeSetup = (server: CatalogServer, endpoint: PreferredCatalogEndpoint): ClientSetup => {
  const key = sanitizeClientSetupKey(server.id);
  const selectedAuthType = setupAuthType(server);
  const registration = preRegisteredOAuth(server);
  const header = credentialHeader(server, selectedAuthType);
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
  const notes = commonNotes(server, endpoint, selectedAuthType);
  if (registration) {
    const redirects = oauthRedirects(registration, 'vs-code');
    notes.push(`Register both exact VS Code redirect URLs: ${redirects.join(' and ')}. Keep the trailing slash on ${redirects[0]}.`);
    notes.push('Start the server after adding it. VS Code detects that Dynamic Client Registration is unavailable and natively prompts first for the client ID and then for the client secret; it stores the credentials securely and manages token refresh.');
  } else if (header) {
    notes.push(`VS Code requests ${header.environmentVariable} as a masked input; use a secret manager and do not put a default value in mcp.json. The ${header.name} syntax remains ${header.valueTemplate}.`);
  }
  if (CREDENTIAL_AUTH_TYPES.has(selectedAuthType) && !header) {
    notes.push('The credential header is not documented, so this config contains only the endpoint. Use “MCP: Add Server” after consulting publisher guidance.');
  }
  return {
    id: 'vs-code', label: 'VS Code', heading: 'VS Code setup',
    documentationUrl: CLIENT_DOCUMENTATION['vs-code'],
    documentationLabel: 'VS Code MCP documentation',
    location: registration
      ? 'Run “MCP: Add Server”, choose HTTP, enter this URL and name, then choose Workspace or Global scope. VS Code will prompt for the registered credentials when the server starts.'
      : 'Add to .vscode/mcp.json, or run “MCP: Open User Configuration” for a private user-level entry.',
    copyText: jsonConfig(root), format: 'json',
    supported: !(CREDENTIAL_AUTH_TYPES.has(selectedAuthType) && !header),
    endpoint, authSummary: authSummary(server, selectedAuthType), notes,
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
