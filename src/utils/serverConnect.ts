/**
 * The "Connect it" section of a catalog server page (issue #444): setup for
 * every client in clientCompatibility.json, a compatibility row per client
 * and a prompt a coding agent can follow. ServerConnect.tsx and the
 * prerendered page (scripts/content/catalogPages.js) both render this model,
 * so the static HTML and the app show the same text.
 *
 * Setup snippets come from the existing generator (clientSetup.ts). The
 * compatibility rows run the host profiles of src/compatibility over the
 * facts the catalog has recorded for the server; clients the generator does
 * not cover get their documented configuration surfaces instead of a guessed
 * snippet.
 *
 * Runtime imports carry their `.ts` extension: the page generator loads this
 * module through native `require`.
 */
import type {
  CatalogAuthType,
  CatalogServer,
  CatalogTransport,
} from '../types/catalog';
import type {
  AuthorizationScheme,
  CompatibilityFactPath,
  CompatibilityFindingV1,
  HostProfileV1,
  Known,
  ObservedServerFactsV1,
  ObservedValueV1,
  OAuthRegistrationMode,
} from '../compatibility/types.ts';
import { COMPATIBILITY_SCHEMA_VERSION } from '../compatibility/types.ts';
import { assessHostCompatibility } from '../compatibility/evaluate.ts';
import { getClientHostProfile } from '../compatibility/profiles.ts';
import {
  CLIENT_COMPATIBILITY,
  type ClientCompatibilityEntry,
  type SourcedCell,
  type SupportLevel,
} from '../data/clientCompatibility.ts';
import {
  generateClientSetups,
  sanitizeClientSetupKey,
  type ClientSetup,
  type ClientSetupFormat,
  type ClientSetupId,
  type PreferredCatalogEndpoint,
} from './clientSetup.ts';
import {
  SITE_URL,
  formatCatalogAuth,
  formatCatalogTransport,
  getCatalogServerPath,
  getCatalogServerSeo,
  getCatalogServerMetaDescription,
} from './catalogSeo.ts';

export type ClientSupportLevel = 'supported' | 'partial' | 'unsupported';

export interface ClientCompatibilityRow {
  level: ClientSupportLevel;
  label: string;
  reason: string;
}

/** One way to set the client up: a generated snippet, or its documented configuration surfaces. */
export type ServerConnectSetup =
  | { kind: 'snippet'; format: ClientSetupFormat; location: string; copyText: string; notes: string[] }
  | { kind: 'unavailable'; location: string; text: string; notes: string[] }
  | { kind: 'surfaces'; surfaces: string[] };

export interface ServerConnectClient {
  /** clientCompatibility.json id. */
  id: string;
  /** Short name for the client switcher and the compatibility table. */
  label: string;
  heading: string;
  /** Guide for this client on mcptest, or the vendor documentation. */
  href: string;
  documentationUrl: string;
  compatibility: ClientCompatibilityRow;
  setup: ServerConnectSetup;
}

export interface ServerConnectModel {
  endpoint: PreferredCatalogEndpoint;
  authSummary: string;
  /** Notes every generated setup shares, shown once rather than per client. */
  sharedNotes: string[];
  clients: ServerConnectClient[];
  agentPrompt: string;
}

const SUPPORT_LABELS: Record<ClientSupportLevel, string> = {
  supported: 'Supported',
  partial: 'Partial',
  unsupported: 'Not supported',
};

const SHORT_LABELS: Readonly<Record<string, string>> = {
  'claude-ai': 'Claude',
  'claude-desktop': 'Claude Desktop',
  'claude-code': 'Claude Code',
  chatgpt: 'ChatGPT',
  'codex-cli': 'Codex',
  cursor: 'Cursor',
  'vscode-copilot': 'VS Code',
  windsurf: 'Windsurf',
  'gemini-cli': 'Gemini CLI',
  'generic-sdk': 'MCP SDK',
};

/** Generated setups by clientCompatibility.json id. */
const SETUP_CLIENTS: Readonly<Record<string, ClientSetupId>> = {
  'claude-code': 'claude-code',
  'codex-cli': 'codex-cli',
  cursor: 'cursor',
  'vscode-copilot': 'vs-code',
};

/** Switcher order: clients with a generated setup first, then the rest in data order. */
const CLIENT_ORDER = ['claude-code', 'codex-cli', 'cursor', 'vscode-copilot'];

/** Clients a meta description names, most searched first. */
const META_CLIENTS = ['claude-ai', 'chatgpt', 'cursor', 'vscode-copilot', 'claude-code', 'codex-cli'];

const orderedClients = (): ClientCompatibilityEntry[] => {
  const rank = (id: string) => {
    const index = CLIENT_ORDER.indexOf(id);
    return index === -1 ? CLIENT_ORDER.length : index;
  };
  return CLIENT_COMPATIBILITY.clients
    .map((entry, index) => ({ entry, index }))
    .sort((left, right) => rank(left.entry.id) - rank(right.entry.id) || left.index - right.index)
    .map(({ entry }) => entry);
};

export const getClientShortLabel = (entry: Pick<ClientCompatibilityEntry, 'id' | 'name'>): string => (
  SHORT_LABELS[entry.id] ?? entry.name
);

const evidence = (description: string) => [{
  schemaVersion: COMPATIBILITY_SCHEMA_VERSION,
  source: 'configuration' as const,
  description,
}];

const fact = <T>(value: Known<T>, description: string): ObservedValueV1<T> => ({
  value,
  evidence: evidence(description),
});

const notRecorded = <T>(): ObservedValueV1<T> => fact<T>('unknown', 'Not recorded by catalog validation.');

/** The credential methods a client can use with this server, primary first. */
const authOptions = (server: CatalogServer): CatalogAuthType[] => {
  const registration = server.oauthRegistration;
  const options = [server.authType, ...(server.alternativeAuthTypes ?? [])];
  // The publisher steers clients to the alternative when OAuth registration is unavailable.
  const usable = registration?.mode === 'unavailable-or-use-alternative'
    ? options.filter((authType) => authType !== 'oauth')
    : options;
  const unique = [...new Set(usable.length ? usable : options)];
  return unique;
};

const authScheme = (authType: CatalogAuthType): AuthorizationScheme | undefined => {
  if (authType === 'oauth') return 'oauth';
  if (authType === 'bearer-token') return 'bearer';
  if (authType === 'api-key' || authType === 'api-token') return 'api-key';
  return undefined;
};

const registrationModes = (server: CatalogServer): Known<readonly OAuthRegistrationMode[]> => {
  const mode = server.oauthRegistration?.mode;
  // Only a publisher-documented requirement for the user's own OAuth app is a
  // registration fact; automatic registration may be DCR or CIMD.
  if (mode === 'pre-registered-required' || mode === 'operator-confidential') return ['pre-registered'];
  return 'unknown';
};

const capabilityFact = (
  section: { status: string; items: unknown[] } | undefined,
  name: string
): ObservedValueV1<'present' | 'absent'> => {
  if (!section) return notRecorded();
  if (section.items.length > 0) return fact('present', `The catalog inventory lists ${name}.`);
  if (section.status === 'unsupported' || section.status === 'complete') {
    return fact('absent', `The catalog inventory found no ${name}.`);
  }
  return notRecorded();
};

/**
 * What the catalog knows about a server, as compatibility-engine facts.
 * Anything validation has not recorded stays unknown, so the engine never
 * decides on a guess.
 */
export const getCatalogServerFacts = (
  server: CatalogServer,
  endpoint: PreferredCatalogEndpoint
): ObservedServerFactsV1 => {
  const era = server.protocolVersion?.match(/^(2024|2025|2026)-/)?.[1] as '2024' | '2025' | '2026' | undefined;
  const session = server.protocolEra === 'stateless' || server.protocolEra === 'stateful' ? server.protocolEra : undefined;
  const options = authOptions(server);
  const schemes = options.map(authScheme).filter((scheme): scheme is AuthorizationScheme => Boolean(scheme));
  const requirement = server.authType === 'none'
    ? 'none'
    : server.authType === 'unknown' ? 'unknown' : 'required';
  const inventory = server.capabilityInventory;
  return {
    schemaVersion: COMPATIBILITY_SCHEMA_VERSION,
    serverUrl: endpoint.url,
    transport: { kind: fact(endpoint.transport ?? 'unknown', `${endpoint.provenanceLabel}.`) },
    protocol: {
      era: era ? fact(era, `Catalog validation negotiated MCP ${server.protocolVersion}.`) : notRecorded(),
      version: server.protocolVersion ? fact(server.protocolVersion, 'Catalog validation.') : notRecorded(),
      sessionBehavior: session ? fact(session, `Catalog validation observed ${session} MCP.`) : notRecorded(),
    },
    authorization: {
      requirement: fact(requirement, `Catalog authentication: ${formatCatalogAuth(server.authType)}.`),
      schemes: requirement === 'unknown'
        ? notRecorded()
        : fact(schemes, `Catalog authentication: ${options.map(formatCatalogAuth).join(', ')}.`),
      oauth: {
        protectedResourceMetadata: server.authorizationServers?.length
          ? fact(true, 'Validation found protected resource metadata naming an authorization server.')
          : notRecorded(),
        authorizationServerMetadata: notRecorded(),
        registrationModes: fact(registrationModes(server), 'Publisher OAuth registration evidence.'),
        pkceS256: notRecorded(),
        refreshTokens: notRecorded(),
        redirectPolicy: notRecorded(),
        registeredRedirectUris: notRecorded(),
        dynamicRedirectRegistration: notRecorded(),
      },
    },
    capabilities: {
      tools: capabilityFact(inventory?.tools, 'tools'),
      resources: capabilityFact(inventory?.resources, 'resources'),
      prompts: capabilityFact(inventory?.prompts, 'prompts'),
      resourceSubscriptions: notRecorded(),
      sampling: notRecorded(),
      elicitation: notRecorded(),
      tasks: notRecorded(),
    },
    environment: {
      directAccess: notRecorded(),
      cors: notRecorded(),
      proxyRoute: notRecorded(),
    },
  };
};

const AUTH_PHRASES: Record<CatalogAuthType, string> = {
  none: 'servers without authentication',
  oauth: 'OAuth sign-in',
  'bearer-token': 'bearer-token headers',
  'api-token': 'API key headers',
  'api-key': 'API key headers',
  unknown: 'unverified authentication',
};

const LEVEL_RANK: Record<ClientSupportLevel, number> = { supported: 0, partial: 1, unsupported: 2 };

interface CellCheck {
  level: ClientSupportLevel;
  reason?: string;
  /** The client's documentation does not state this support. */
  undocumented?: boolean;
}

const cellCheck = (cell: SourcedCell<SupportLevel>, what: string, client: string): CellCheck => {
  const note = cell.note ? ` ${cell.note}` : '';
  if (cell.value === 'supported') return { level: 'supported' };
  if (cell.value === 'limited') return { level: 'partial', reason: `${client} supports ${what} only in limited availability.${note}` };
  if (cell.value === 'unknown') {
    return { level: 'partial', undocumented: true, reason: `${client}'s documentation does not state support for ${what}.` };
  }
  if (cell.value === 'bridge-required') return { level: 'partial', reason: `${client} needs a bridge for ${what}.${note}` };
  return { level: 'unsupported', reason: `${client} does not support ${what}.${note}` };
};

const transportCheck = (entry: ClientCompatibilityEntry, transport: CatalogTransport | undefined, client: string): CellCheck => (
  !transport ? { level: 'partial', reason: 'The endpoint transport has not been verified.' } :
  transport === 'legacy-sse'
    ? cellCheck(entry.transports.legacySse, 'legacy SSE servers', client)
    : cellCheck(entry.transports.streamableHttp, 'Streamable HTTP servers', client)
);

const best = (checks: CellCheck[]): CellCheck => (
  checks.reduce((left, right) => (LEVEL_RANK[right.level] < LEVEL_RANK[left.level] ? right : left))
);

const oauthCheck = (entry: ClientCompatibilityEntry, server: CatalogServer, client: string): CellCheck => {
  const preRegistered = cellCheck(entry.auth.preRegisteredClient, 'OAuth with your own client ID', client);
  if (server.oauthRegistration?.mode === 'pre-registered-required') return preRegistered;
  return best([
    cellCheck(entry.auth.oauthDcr, AUTH_PHRASES.oauth, client),
    cellCheck(entry.auth.cimd, AUTH_PHRASES.oauth, client),
    preRegistered,
  ]);
};

const authCheck = (entry: ClientCompatibilityEntry, server: CatalogServer, client: string): CellCheck | undefined => {
  if (server.authType === 'unknown') return undefined;
  return best(authOptions(server).map((authType) => {
    if (authType === 'none') return cellCheck(entry.auth.none, AUTH_PHRASES.none, client);
    if (authType === 'oauth') return oauthCheck(entry, server, client);
    if (authType === 'bearer-token') return cellCheck(entry.auth.bearerToken, AUTH_PHRASES[authType], client);
    return cellCheck(entry.auth.apiKeyHeader, AUTH_PHRASES[authType], client);
  }));
};

/** Rules the client's own transport and credential cells answer with more nuance than the engine's yes/no. */
const CELL_RULES = new Set(['transport.kind', 'authorization.scheme']);

const factIsKnown = (facts: ObservedServerFactsV1, path: CompatibilityFactPath): boolean => {
  const value = path.split('.').reduce<unknown>(
    (node, key) => (node as Record<string, unknown> | undefined)?.[key],
    facts
  ) as ObservedValueV1<unknown> | undefined;
  return value !== undefined && value.value !== 'unknown';
};

/**
 * Engine findings that change the verdict. Unknown outcomes are left out:
 * the catalog has not observed OAuth metadata or every protocol detail, and
 * a gap in its evidence is not a client limitation. A caveat counts only
 * when the facts behind it were observed.
 */
const decisiveFindings = (
  profile: HostProfileV1,
  facts: ObservedServerFactsV1,
  skipAuthorization: boolean
): CompatibilityFindingV1[] => {
  const assessment = assessHostCompatibility(facts, profile);
  return assessment.findings.filter((finding) => {
    if (CELL_RULES.has(finding.ruleId)) return false;
    if (skipAuthorization && finding.ruleId.startsWith('authorization.')) return false;
    if (finding.outcome === 'fail') return true;
    if (finding.outcome !== 'caveat') return false;
    const rule = profile.rules.find(({ id }) => id === finding.ruleId);
    return Boolean(rule?.evidenceFacts.some((path) => factIsKnown(facts, path)));
  });
};

const supportedReason = (server: CatalogServer, transport: CatalogTransport, client: string): string => {
  const transportText = `${client} supports ${formatCatalogTransport(transport)} servers`;
  if (server.authType === 'unknown') return `${transportText}; the server's authentication is not yet verified.`;
  return `${transportText} and ${[...new Set(authOptions(server).map((authType) => AUTH_PHRASES[authType]))].join(' or ')}.`;
};

/** Supported, partial or not supported, with the reason, for one client. */
export const assessClientCompatibility = (
  server: CatalogServer,
  entry: ClientCompatibilityEntry,
  endpoint: PreferredCatalogEndpoint,
  facts: ObservedServerFactsV1 = getCatalogServerFacts(server, endpoint)
): ClientCompatibilityRow => {
  const client = getClientShortLabel(entry);
  const checks = [transportCheck(entry, endpoint.transport, client)];
  const auth = authCheck(entry, server, client);
  if (auth) checks.push(auth);

  const profile = getClientHostProfile(entry);
  const findings = profile ? decisiveFindings(profile, facts, Boolean(auth?.undocumented)) : [];
  for (const finding of findings) {
    checks.push({
      level: finding.outcome === 'fail' ? 'unsupported' : 'partial',
      reason: `${finding.summary}: ${finding.detail}`,
    });
  }

  const worst = checks.reduce((left, right) => (LEVEL_RANK[right.level] > LEVEL_RANK[left.level] ? right : left));
  const reason = worst.level === 'supported'
    ? supportedReason(server, endpoint.transport, client)
    : checks.filter(({ level }) => level === worst.level).map(({ reason: text }) => text).filter(Boolean).join(' ');
  return { level: worst.level, label: SUPPORT_LABELS[worst.level], reason };
};

/** Notes every generated setup carries, shown once. */
const sharedNotesOf = (setups: ClientSetup[]): string[] => (
  setups[0]?.notes.filter((note) => setups.every((setup) => setup.notes.includes(note))) ?? []
);

const endpointNote = (endpoint: PreferredCatalogEndpoint): string => (
  `Using ${endpoint.provenanceLabel.toLowerCase()}: ${endpoint.url}`
);

const toConnectSetup = (setup: ClientSetup, shared: Set<string>): ServerConnectSetup => {
  const notes = setup.notes.filter((note) => !shared.has(note));
  return setup.supported
    ? { kind: 'snippet', format: setup.format, location: setup.location, copyText: setup.copyText, notes }
    : { kind: 'unavailable', location: setup.location, text: setup.copyText, notes };
};

const MAX_PROMPT_TOOLS = 25;

const promptAuth = (server: CatalogServer, authSummary: string, sharedNotes: string[]): string[] => {
  const credentialNotes = sharedNotes.filter((note) => note.startsWith('Store '));
  if (server.authType === 'none') return ['Authentication: none. The server accepts connections without credentials.'];
  if (server.authType === 'oauth' && !server.oauthRegistration) {
    return [`Authentication: OAuth 2.1. The client opens a browser sign-in on first connect; do not create or store tokens yourself. ${authSummary}`];
  }
  return [`Authentication: ${formatCatalogAuth(server.authType)}. ${authSummary}`, ...credentialNotes];
};

/**
 * A prompt for a coding agent (Claude Code, Codex): what the server is, how
 * to reach it, how it authenticates, the tools it lists, and to add it to the
 * user's client and verify it with tools/list.
 */
export const createAgentPrompt = (
  server: CatalogServer,
  endpoint: PreferredCatalogEndpoint,
  setups: ClientSetup[],
  sharedNotes: string[]
): string => {
  const key = sanitizeClientSetupKey(server.id);
  const tools = server.capabilityInventory?.tools.items.map(({ name }) => name) ?? [];
  const toolLine = tools.length
    ? `Tools (${tools.length > MAX_PROMPT_TOOLS ? `first ${MAX_PROMPT_TOOLS} of ${tools.length}` : tools.length}, as last observed by mcptest): ${tools.slice(0, MAX_PROMPT_TOOLS).join(', ')}.`
    : 'Tools: not yet observed by mcptest; tools/list will show them.';
  // One-line commands only; longer configurations stay on the page the prompt links to.
  const command = (id: ClientSetupId) => setups.find((setup) => (
    setup.id === id && setup.supported && setup.format === 'shell' && !setup.copyText.includes('\n')
  ))?.copyText;
  const claudeCode = command('claude-code');
  const codex = command('codex-cli');
  const authSummary = setups[0]?.authSummary ?? '';
  return [
    `Add the ${server.name} MCP server to my MCP client configuration and verify that it works.`,
    '',
    `What it is: ${server.description}`,
    `Server URL: ${endpoint.url}`,
    `Transport: ${formatCatalogTransport(endpoint.transport)} (remote MCP server, no local install).`,
    ...promptAuth(server, authSummary, sharedNotes),
    ...setups.filter(({ supported }) => !supported).map((setup) => (
      `${setup.label} setup unavailable: ${setup.unsupportedReasons.join(' ')} Do not invent a configuration for this client.`
    )),
    toolLine,
    `Reference: ${SITE_URL}${getCatalogServerPath(server.id)}`,
    '',
    'Steps:',
    `1. Work out which MCP client I use (Claude Code, Codex, Cursor, VS Code or another) and add the server under the name "${key}" in that client's MCP configuration, user scope unless I ask otherwise.`,
    ...(claudeCode ? [`   Claude Code: ${claudeCode}`] : []),
    ...(codex ? [`   Codex: ${codex}`] : []),
    '   Other clients: use the setup for that client on the reference page.',
    '2. Never write a credential value into a file that could be committed; reference an environment variable or the client\'s secret store, and ask me for any value you need.',
    '3. Verify: connect to the server and call tools/list. Confirm the tools above are listed, and report any sign-in step I still have to complete.',
  ].join('\n');
};

const clientHref = (entry: ClientCompatibilityEntry): string => entry.guidePath ?? entry.documentationUrl;

/** Everything the "Connect it" section shows for one server. */
export const createServerConnectModel = (server: CatalogServer): ServerConnectModel => {
  const setups = generateClientSetups(server);
  const endpoint = setups[0].endpoint;
  const shared = new Set(sharedNotesOf(setups));
  // The lede shows the endpoint and the authentication summary.
  const sharedNotes = [...shared].filter((note) => note !== endpointNote(endpoint) && note !== setups[0].authSummary);
  const facts = getCatalogServerFacts(server, endpoint);
  const clients = orderedClients().map((entry): ServerConnectClient => {
    const generated = setups.find(({ id }) => id === SETUP_CLIENTS[entry.id]);
    return {
      id: entry.id,
      label: getClientShortLabel(entry),
      heading: generated?.heading ?? `${getClientShortLabel(entry)} setup`,
      href: clientHref(entry),
      documentationUrl: entry.documentationUrl,
      compatibility: assessClientCompatibility(server, entry, endpoint, facts),
      setup: generated
        ? toConnectSetup(generated, shared)
        : { kind: 'surfaces', surfaces: entry.configuration.map(({ text }) => text) },
    };
  });
  return {
    endpoint,
    authSummary: setups[0].authSummary,
    sharedNotes,
    clients,
    agentPrompt: createAgentPrompt(server, endpoint, setups, sharedNotes),
  };
};

/** Up to four widely used clients that can connect to the server, for meta descriptions. */
export const getServerSetupClientNames = (server: CatalogServer, limit = 4): string[] => {
  const model = createServerConnectModel(server);
  return META_CLIENTS
    .map((id) => model.clients.find((client) => client.id === id))
    .filter((client): client is ServerConnectClient => Boolean(client && client.compatibility.level !== 'unsupported'))
    .slice(0, limit)
    .map(({ label }) => label);
};

const listNames = (names: string[]): string => (
  names.length <= 1 ? names.join('') : `${names.slice(0, -1).join(', ')} or ${names[names.length - 1]}`
);

/** Setup phrases in descending length, using clients that can connect. */
const getServerSetupPhrases = (server: CatalogServer): string[] => {
  const names = getServerSetupClientNames(server);
  if (!names.length) return ['Client setup, auth and tools.'];
  return [
    ...names.map((_, index) => {
      const clients = names.slice(0, names.length - index);
      const list = clients.length === 1
        ? `${clients[0]} and more`
        : `${clients.slice(0, -1).join(', ')} and ${clients[clients.length - 1]}`;
      return `Setup for ${list}.`;
    }),
  ];
};

/**
 * Splits configuration text from clientCompatibility.json (inline Markdown)
 * into plain and code runs; `**bold**` markers are dropped.
 */
export const splitInlineCode = (text: string): Array<{ code: boolean; text: string }> => (
  text.replace(/\*\*/g, '').split('`').map((part, index) => ({ code: index % 2 === 1, text: part })).filter(({ text: part }) => part)
);

/** Endpoint and auth, then the longest fitting setup phrase, then a summary sentence. */
export const getServerPageMetaDescription = (server: CatalogServer): string => (
  getCatalogServerMetaDescription(server, getServerSetupPhrases(server))
);

/** Anchor of the "Connect it" heading; JSON-LD points installUrl at it. */
export const SERVER_CONNECT_TITLE_ID = 'server-connect-title';

/**
 * Setup facts for the page's SoftwareApplication JSON-LD: where the setup
 * is (installUrl), what a client needs (softwareRequirements) and client
 * support by level.
 */
export const getServerSetupStructuredData = (server: CatalogServer, canonicalUrl: string) => {
  const model = createServerConnectModel(server);
  const byLevel = (level: ClientSupportLevel) => model.clients
    .filter(({ compatibility }) => compatibility.level === level)
    .map(({ label }) => label);
  const supported = byLevel('supported');
  return {
    installUrl: `${canonicalUrl}#${SERVER_CONNECT_TITLE_ID}`,
    softwareRequirements: `An MCP client that connects to ${formatCatalogTransport(model.endpoint.transport)} remote servers${supported.length ? `, such as ${listNames(supported.slice(0, 4))}` : ''}.`,
    additionalProperty: ([
      ['Supported MCP clients', supported],
      ['Partially supported MCP clients', byLevel('partial')],
      ['Unsupported MCP clients', byLevel('unsupported')],
    ] as const)
      .filter(([, names]) => names.length > 0)
      .map(([name, names]) => ({ '@type': 'PropertyValue' as const, name, value: names.join(', ') })),
  };
};

/** The app's head metadata for a server page, matching the prerendered page's description and setup JSON-LD. */
export const getServerPageSeo = (server: CatalogServer) => {
  const seo = getCatalogServerSeo(server);
  const setup = getServerSetupStructuredData(server, seo.canonicalUrl);
  return {
    ...seo,
    description: getServerPageMetaDescription(server),
    structuredData: {
      ...seo.structuredData,
      installUrl: setup.installUrl,
      softwareRequirements: setup.softwareRequirements,
      additionalProperty: [...seo.structuredData.additionalProperty, ...setup.additionalProperty],
    },
  };
};
