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
  unsupportedReasons: string[];
  endpoint: PreferredCatalogEndpoint;
  authSummary: string;
  notes: string[];
}

interface HeaderTemplate {
  name: string;
  environmentVariable: string;
  valueTemplate: string;
  secret: boolean;
  required: boolean;
}

interface HeaderRequirements {
  headers: HeaderTemplate[];
  unsupportedReasons: string[];
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
  authType: CatalogAuthType,
  header: CatalogRequiredHeader
): HeaderTemplate | undefined => {
  // Reject malformed HTTP field names rather than putting them into a command or config.
  if (!/^[!#$%&'*+.^_`|~0-9A-Za-z-]+$/.test(header.name)) return undefined;

  const documentedPlaceholder = placeholderFromDescription(header);
  // A header name alone does not establish its complete value syntax. Require
  // publisher metadata to name the value instead of inventing one.
  if (!documentedPlaceholder) return undefined;
  const environmentVariable = documentedPlaceholder;
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

  return {
    name: header.name,
    environmentVariable,
    valueTemplate,
    secret: header.secret === true,
    required: header.required !== false,
  };
};

const headerRequirements = (
  server: CatalogServer,
  authType: CatalogAuthType
): HeaderRequirements => {
  const credentialAuth = CREDENTIAL_AUTH_TYPES.has(authType);
  const headers: HeaderTemplate[] = [];
  const unsupportedReasons: string[] = [];

  for (const header of server.requiredHeaders || []) {
    const selectedCredentialHeader = credentialAuth && header.secret === true;
    if (header.required === false && !selectedCredentialHeader) continue;
    const template = exactHeaderTemplate(authType, header);
    if (template) {
      headers.push(template);
      continue;
    }
    const requirement = header.required === false ? 'credential' : 'required';
    unsupportedReasons.push(
      `The ${requirement} header ${header.name} cannot be represented faithfully because its name or value placeholder is not fully documented.`
    );
  }

  // Authorization: Bearer is defined by the auth type itself. API key/token
  // header names are not, so those combinations need publisher guidance.
  if (authType === 'bearer-token' && !headers.some((header) => header.secret)) {
    const environmentVariable = toEnvironmentVariable(server.id, authType);
    headers.unshift({
      name: 'Authorization',
      environmentVariable,
      valueTemplate: `Bearer <${environmentVariable}>`,
      secret: true,
      required: true,
    });
  } else if (credentialAuth && !headers.some((header) => header.secret)) {
    unsupportedReasons.push(
      `The catalog does not document the credential header required for ${authTypeLabel(authType)} authentication.`
    );
  }

  return { headers, unsupportedReasons };
};

const credentialHeader = (
  server: CatalogServer,
  authType: CatalogAuthType
): HeaderTemplate | undefined => headerRequirements(server, authType).headers.find((header) => header.secret);

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

const usableRedirects = (
  registration: CatalogOAuthRegistrationEvidence,
  clientId: CatalogOAuthClientId,
  protocols: string[]
): string[] => {
  const usable = oauthRedirects(registration, clientId).filter((value) => {
    try {
      const url = new URL(value);
      return protocols.includes(url.protocol) && !url.username && !url.password && !url.hash;
    } catch {
      // Catalog validation reports malformed callback evidence. Keep generation non-throwing.
      return false;
    }
  });
  return [...new Set(usable)];
};

const explicitRedirectPort = (value: string): number | undefined => {
  const authority = value.match(/^[a-z][a-z0-9+.-]*:\/\/([^/?#]*)/i)?.[1];
  const portText = authority?.match(/:(\d+)$/)?.[1];
  const port = portText ? Number(portText) : undefined;
  return port && Number.isInteger(port) && port <= 65535 ? port : undefined;
};

const loopbackRedirects = (urls: string[]): Array<{ url: string; port: number }> => {
  const redirects: Array<{ url: string; port: number }> = [];
  for (const value of urls) {
    try {
      const parsed = new URL(value);
      const loopback = parsed.hostname === 'localhost'
        || parsed.hostname === '127.0.0.1'
        || parsed.hostname === '[::1]';
      const port = explicitRedirectPort(value);
      if (loopback && port) redirects.push({ url: value, port });
    } catch {
      // usableRedirects normally filters this first; remain defensive for direct callers.
    }
  }
  return redirects;
};

const redirectRegistrationNote = (clientLabel: string, redirects: string[]): string => {
  if (redirects.length === 1) {
    return `Register this exact ${clientLabel} redirect URL: ${redirects[0]}.`;
  }
  return `Register these exact ${clientLabel} redirect URLs: ${redirects.join(', ')}.`;
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

const unsupportedCopyText = (label: string, reasons: string[]): string => {
  return `${label} setup is unavailable for this catalog entry. ${reasons.join(' ')} Consult the publisher and client documentation before configuring this server.`;
};

const appendHeaderNotes = (
  notes: string[],
  requirements: HeaderRequirements,
  noteForHeader: (header: HeaderTemplate) => string
): void => {
  for (const header of requirements.headers) notes.push(noteForHeader(header));
  for (const reason of requirements.unsupportedReasons) notes.push(`Unsupported setup: ${reason}`);
};

const headerInputNote = (header: HeaderTemplate): string => {
  if (header.secret) return secureStorageNote(header);
  return `Set ${header.environmentVariable} to the publisher-required value for the ${header.name} header.`;
};

const claudeSetup = (server: CatalogServer, endpoint: PreferredCatalogEndpoint): ClientSetup => {
  const key = sanitizeClientSetupKey(server.id);
  const selectedAuthType = setupAuthType(server);
  const registration = preRegisteredOAuth(server);
  const requirements = headerRequirements(server, selectedAuthType);
  const transport = endpoint.transport === 'legacy-sse' ? 'sse' : 'http';
  const clientIdEnvironment = registration
    ? oauthEnvironmentVariable(registration.clientId, `${key.replace(/-/g, '_').toUpperCase()}_CLIENT_ID`)
    : undefined;
  const claudeRedirects = registration
    ? loopbackRedirects(usableRedirects(registration, 'claude-code', ['http:']))
    : [];
  const callbackPort = claudeRedirects[0]?.port;
  if (registration && claudeRedirects.length === 0) {
    requirements.unsupportedReasons.push(
      'The catalog does not document a usable Claude Code loopback redirect URL with an explicit port.'
    );
  }
  const command = [
    'claude mcp add',
    `--transport ${transport}`,
    '--scope user',
    ...(registration && clientIdEnvironment ? [
      `--client-id "\${${clientIdEnvironment}}"`,
      '--client-secret',
      ...(callbackPort ? [`--callback-port ${callbackPort}`] : []),
    ] : []),
    ...requirements.headers.map((header) => `--header ${shellHeaderArgument(header)}`),
    quoteShellArgument(key),
    quoteShellArgument(endpoint.url),
  ].join(' ');
  const notes = commonNotes(server, endpoint, selectedAuthType);
  if (registration && claudeRedirects.length > 0) {
    notes.push(redirectRegistrationNote(
      'Claude Code', claudeRedirects.map(({ url }) => url)
    ));
    notes.push('The bare --client-secret option opens Claude Code\'s masked prompt; the secret is stored securely instead of appearing in the command or configuration file.');
  } else if (!registration && server.authType === 'oauth'
      && server.oauthRegistration?.mode !== 'unavailable-or-use-alternative') {
    notes.push('After adding the server, open Claude Code, run /mcp, select the server, and follow the browser flow to authenticate.');
  }
  appendHeaderNotes(notes, requirements, headerInputNote);
  const supported = requirements.unsupportedReasons.length === 0;
  return {
    id: 'claude-code', label: 'Claude Code', heading: 'Claude Code setup',
    documentationUrl: CLIENT_DOCUMENTATION['claude-code'],
    documentationLabel: 'Claude Code MCP documentation',
    location: 'Run in a terminal. This user-scoped entry is available across projects.',
    copyText: supported ? command : unsupportedCopyText('Claude Code', requirements.unsupportedReasons),
    format: supported ? 'shell' : 'text',
    supported, unsupportedReasons: requirements.unsupportedReasons, endpoint,
    authSummary: authSummary(server, selectedAuthType), notes,
  };
};

const codexSetup = (server: CatalogServer, endpoint: PreferredCatalogEndpoint): ClientSetup => {
  const key = sanitizeClientSetupKey(server.id);
  const selectedAuthType = setupAuthType(server);
  const registration = preRegisteredOAuth(server);
  const requirements = headerRequirements(server, selectedAuthType);
  if (endpoint.transport === 'legacy-sse') {
    const unsupportedReasons = ['Codex CLI supports Streamable HTTP remote servers, not legacy SSE endpoints.'];
    return {
      id: 'codex-cli', label: 'Codex CLI', heading: 'Codex CLI setup',
      documentationUrl: CLIENT_DOCUMENTATION['codex-cli'],
      documentationLabel: 'Codex MCP documentation',
      location: 'Review the endpoint in the publisher documentation before editing Codex configuration.',
      copyText: 'Codex CLI supports Streamable HTTP remote servers, not legacy SSE endpoints. Use a publisher-documented Streamable HTTP endpoint if one is available.',
      format: 'text', supported: false, unsupportedReasons, endpoint,
      authSummary: authSummary(server, selectedAuthType),
      notes: commonNotes(server, endpoint, selectedAuthType),
    };
  }

  if (registration) {
    const remote = registration.codexMcpRemote;
    const notes = commonNotes(server, endpoint, selectedAuthType);
    if (!remote) {
      const unsupportedReasons = ['Codex does not accept the required static OAuth client secret.'];
      notes.push(`Unsupported setup: ${unsupportedReasons[0]} No secret option is fabricated.`);
      return {
        id: 'codex-cli', label: 'Codex CLI', heading: 'Codex CLI setup',
        documentationUrl: CLIENT_DOCUMENTATION['codex-cli'],
        documentationLabel: 'Codex MCP documentation',
        location: 'Use a publisher-documented compatibility bridge, or choose a client with native pre-registered OAuth support.',
        copyText: 'Native direct Codex setup is unsupported for this pre-registered OAuth server.',
        format: 'text', supported: false, unsupportedReasons, endpoint,
        authSummary: authSummary(server, selectedAuthType), notes,
      };
    }

    const codexRedirects = loopbackRedirects(
      usableRedirects(registration, 'codex-cli', ['http:'])
    );
    let usableResource = false;
    try {
      const resource = new URL(remote.resourceUrl);
      usableResource = resource.protocol === 'https:' && !resource.username && !resource.password;
    } catch {
      // Treat malformed bridge evidence as unsupported without throwing during rendering.
    }
    const usableRemote = usableResource
      && Number.isInteger(remote.callbackPort)
      && remote.callbackPort >= 1
      && remote.callbackPort <= 65535;
    const matchingRedirects = usableRemote
      ? codexRedirects.filter(({ port }) => port === remote.callbackPort)
      : [];
    if (matchingRedirects.length === 0) {
      const unsupportedReasons = [
        'The catalog does not document matching usable Codex redirect and mcp-remote bridge callback evidence.',
      ];
      notes.push(`Unsupported setup: ${unsupportedReasons[0]} No bridge command is fabricated.`);
      return {
        id: 'codex-cli', label: 'Codex CLI', heading: 'Codex CLI setup',
        documentationUrl: CLIENT_DOCUMENTATION['codex-cli'],
        documentationLabel: 'Codex MCP documentation',
        location: 'Use a publisher-documented compatibility bridge, or choose a client with native pre-registered OAuth support.',
        copyText: unsupportedCopyText('Codex CLI', unsupportedReasons),
        format: 'text', supported: false, unsupportedReasons, endpoint,
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
    notes.push(redirectRegistrationNote(
      'Codex', matchingRedirects.map(({ url }) => url)
    ));
    notes.push(`This is ${server.name}'s publisher-documented mcp-remote compatibility setup. The publisher warns that mcp-remote is experimental community software; review it before use.`);
    notes.push(`Store ${clientIdEnvironment} and ${clientSecretEnvironment} in a protected environment or secret manager; never commit their values.`);
    if (requirements.headers.length > 0) {
      requirements.unsupportedReasons.push(
        `The required headers ${requirements.headers.map(({ name }) => name).join(', ')} cannot be added faithfully to the publisher-documented mcp-remote bridge configuration.`
      );
    }
    appendHeaderNotes(notes, requirements, headerInputNote);
    const supported = requirements.unsupportedReasons.length === 0;
    return {
      id: 'codex-cli', label: 'Codex CLI', heading: 'Codex CLI setup',
      documentationUrl: CLIENT_DOCUMENTATION['codex-cli'],
      documentationLabel: 'Codex MCP documentation',
      location: 'Add to ~/.codex/config.toml. This publisher-documented bridge requires Node.js and a POSIX sh environment.',
      copyText: supported ? copyText : unsupportedCopyText('Codex CLI', requirements.unsupportedReasons),
      format: supported ? 'toml' : 'text', supported,
      unsupportedReasons: requirements.unsupportedReasons, endpoint,
      authSummary: authSummary(server, selectedAuthType), notes,
    };
  }

  let copyText: string;
  let format: ClientSetupFormat = 'shell';
  let location = 'Run in a terminal; Codex stores the entry in ~/.codex/config.toml.';
  const fullValueEnvironments = new Map<HeaderTemplate, string>();
  const [onlyHeader] = requirements.headers;
  if (requirements.headers.length === 1
      && onlyHeader.valueTemplate === `Bearer <${onlyHeader.environmentVariable}>`) {
    copyText = `codex mcp add ${quoteShellArgument(key)} --url ${quoteShellArgument(endpoint.url)} --bearer-token-env-var ${quoteShellArgument(onlyHeader.environmentVariable)}`;
  } else if (requirements.headers.length > 0) {
    // env_http_headers reads the complete header value from the environment,
    // preserving non-Bearer schemes such as PagerDuty's "Token token=".
    for (const header of requirements.headers) {
      fullValueEnvironments.set(header, `${header.environmentVariable}_HEADER`);
    }
    const serializedHeaders = requirements.headers.map((header) => (
      `${serializeTomlString(header.name)} = ${serializeTomlString(fullValueEnvironments.get(header)!)}`
    )).join(', ');
    copyText = [
      `[mcp_servers.${key}]`,
      `url = ${serializeTomlString(endpoint.url)}`,
      `env_http_headers = { ${serializedHeaders} }`,
    ].join('\n');
    format = 'toml';
    const environmentGuidance = requirements.headers.map((header) => {
      const environmentVariable = fullValueEnvironments.get(header)!;
      return `${environmentVariable} to ${completeHeaderValueDescription(header)}`;
    }).join('; ');
    location = `Add to ~/.codex/config.toml, then ${requirements.headers.every(({ secret }) => secret) ? 'securely set' : 'set'} ${environmentGuidance}.`;
  } else {
    copyText = `codex mcp add ${quoteShellArgument(key)} --url ${quoteShellArgument(endpoint.url)}`;
  }
  if (server.authType === 'oauth'
      && server.oauthRegistration?.mode !== 'unavailable-or-use-alternative') {
    copyText += `\ncodex mcp login ${quoteShellArgument(key)}`;
  }
  const notes = commonNotes(server, endpoint, selectedAuthType);
  appendHeaderNotes(notes, requirements, (header) => {
    const fullValueEnvironment = fullValueEnvironments.get(header);
    return fullValueEnvironment
      ? secureCompleteHeaderStorageNote(header, fullValueEnvironment)
      : headerInputNote(header);
  });
  const supported = requirements.unsupportedReasons.length === 0;
  return {
    id: 'codex-cli', label: 'Codex CLI', heading: 'Codex CLI setup',
    documentationUrl: CLIENT_DOCUMENTATION['codex-cli'],
    documentationLabel: 'Codex MCP documentation', location,
    copyText: supported ? copyText : unsupportedCopyText('Codex CLI', requirements.unsupportedReasons),
    format: supported ? format : 'text', supported,
    unsupportedReasons: requirements.unsupportedReasons,
    endpoint, authSummary: authSummary(server, selectedAuthType), notes,
  };
};

const cursorSetup = (server: CatalogServer, endpoint: PreferredCatalogEndpoint): ClientSetup => {
  const key = sanitizeClientSetupKey(server.id);
  const selectedAuthType = setupAuthType(server);
  const registration = preRegisteredOAuth(server);
  const requirements = headerRequirements(server, selectedAuthType);
  const cursorRedirects = registration
    ? usableRedirects(registration, 'cursor', ['http:', 'https:', 'cursor:'])
    : [];
  if (registration && cursorRedirects.length === 0) {
    requirements.unsupportedReasons.push(
      'The catalog does not document a usable Cursor redirect URL.'
    );
  }
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
  }
  if (requirements.headers.length > 0) {
    config.headers = Object.fromEntries(requirements.headers.map((header) => [
      header.name,
      replacePlaceholder(header.valueTemplate, `\${env:${header.environmentVariable}}`),
    ]));
  }
  const notes = commonNotes(server, endpoint, selectedAuthType);
  if (endpoint.transport === 'legacy-sse') {
    notes.push('This URL is a legacy SSE endpoint; Cursor determines the remote transport from the endpoint.');
  }
  if (registration && cursorRedirects.length > 0) {
    notes.push(redirectRegistrationNote('Cursor', cursorRedirects));
    notes.push('Cursor Static OAuth reads the client ID and secret from the named environment variables; never commit either value.');
  }
  appendHeaderNotes(notes, requirements, headerInputNote);
  const supported = requirements.unsupportedReasons.length === 0;
  return {
    id: 'cursor', label: 'Cursor', heading: 'Cursor setup',
    documentationUrl: CLIENT_DOCUMENTATION.cursor,
    documentationLabel: 'Cursor MCP documentation',
    location: 'Add to .cursor/mcp.json for this project, or ~/.cursor/mcp.json for all projects.',
    copyText: supported
      ? jsonConfig({ mcpServers: { [key]: config } })
      : unsupportedCopyText('Cursor', requirements.unsupportedReasons),
    format: supported ? 'json' : 'text', supported,
    unsupportedReasons: requirements.unsupportedReasons,
    endpoint, authSummary: authSummary(server, selectedAuthType), notes,
  };
};

const vsCodeSetup = (server: CatalogServer, endpoint: PreferredCatalogEndpoint): ClientSetup => {
  const key = sanitizeClientSetupKey(server.id);
  const selectedAuthType = setupAuthType(server);
  const registration = preRegisteredOAuth(server);
  const requirements = headerRequirements(server, selectedAuthType);
  const vsCodeRedirects = registration
    ? usableRedirects(registration, 'vs-code', ['http:', 'https:'])
    : [];
  if (registration && vsCodeRedirects.length === 0) {
    requirements.unsupportedReasons.push(
      'The catalog does not document a usable VS Code redirect URL.'
    );
  }
  const config: Record<string, unknown> = {
    type: endpoint.transport === 'legacy-sse' ? 'sse' : 'http',
    url: endpoint.url,
  };
  const root: Record<string, unknown> = { servers: { [key]: config } };
  if (requirements.headers.length > 0) {
    config.headers = Object.fromEntries(requirements.headers.map((header) => {
      const inputId = header.environmentVariable.toLowerCase();
      return [header.name, replacePlaceholder(header.valueTemplate, `\${input:${inputId}}`)];
    }));
    root.inputs = requirements.headers.map((header) => ({
      type: 'promptString', id: header.environmentVariable.toLowerCase(),
      description: `${header.environmentVariable} for ${server.name}`,
      password: header.secret,
    }));
  }
  const notes = commonNotes(server, endpoint, selectedAuthType);
  if (registration && vsCodeRedirects.length > 0) {
    notes.push(redirectRegistrationNote('VS Code', vsCodeRedirects));
    notes.push('Start the server after adding it. VS Code detects that Dynamic Client Registration is unavailable and natively prompts first for the client ID and then for the client secret; it stores the credentials securely and manages token refresh.');
  }
  appendHeaderNotes(notes, requirements, (header) => header.secret
    ? `VS Code requests ${header.environmentVariable} as a masked input; use a secret manager and do not put a default value in mcp.json. The ${header.name} syntax remains ${header.valueTemplate}.`
    : `VS Code requests the publisher-required ${header.name} value through the ${header.environmentVariable} input.`);
  const supported = requirements.unsupportedReasons.length === 0;
  return {
    id: 'vs-code', label: 'VS Code', heading: 'VS Code setup',
    documentationUrl: CLIENT_DOCUMENTATION['vs-code'],
    documentationLabel: 'VS Code MCP documentation',
    location: registration
      ? 'Run “MCP: Add Server”, choose HTTP, enter this URL and name, then choose Workspace or Global scope. VS Code will prompt for the registered credentials when the server starts.'
      : 'Add to .vscode/mcp.json, or run “MCP: Open User Configuration” for a private user-level entry.',
    copyText: supported ? jsonConfig(root) : unsupportedCopyText('VS Code', requirements.unsupportedReasons),
    format: supported ? 'json' : 'text', supported,
    unsupportedReasons: requirements.unsupportedReasons,
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
