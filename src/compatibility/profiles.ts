import {
  COMPATIBILITY_SCHEMA_VERSION,
  type AuthorizationScheme,
  type CompatibilityConditionV1,
  type CompatibilityFactPath,
  type CompatibilityRemediationV1,
  type CompatibilityRuleV1,
  type HostAssumptionSourceV1,
  type HostId,
  type HostProfileV1,
  type OAuthRegistrationMode,
  type ProtocolEra,
  type RedirectPolicy,
  type SessionBehavior,
  type TransportKind,
} from './types';
import {
  CAPABILITY_NAMES,
  getClientCompatibilityForHost,
  listCells,
  type CapabilityName,
  type ClientCompatibilityEntry,
  type SourcedCell,
  type SupportLevel,
} from '../data/clientCompatibility.ts';

const MCP_AUTH_SPEC = 'https://modelcontextprotocol.io/specification/2025-11-25/basic/authorization';
const MCP_AUTH_SPEC_REVIEWED_ON = '2026-08-11';
const MCP_TRANSPORT_SPEC = 'https://modelcontextprotocol.io/specification/2025-06-18/basic/transports';

const remediation = (
  kind: CompatibilityRemediationV1['kind'],
  action: string,
  documentationUrl?: string
): CompatibilityRemediationV1 => ({
  schemaVersion: COMPATIBILITY_SCHEMA_VERSION,
  kind,
  action,
  documentationUrl,
});

const result = (
  outcome: 'pass' | 'caveat' | 'fail' | 'unknown',
  summary: string,
  detail: string,
  fix?: CompatibilityRemediationV1
) => ({
  outcome,
  severity: outcome === 'fail' ? 'error' as const : outcome === 'pass' ? 'info' as const : 'warning' as const,
  summary,
  detail,
  remediation: fix,
});

const observed = (fact: CompatibilityFactPath, value: string | boolean): CompatibilityConditionV1 => ({
  fact,
  operator: 'equals',
  value,
});

function condition(
  fact: CompatibilityFactPath,
  operator: 'one-of' | 'contains-any',
  value: readonly (string | boolean)[]
): CompatibilityConditionV1 {
  return { fact, operator, value } as CompatibilityConditionV1;
}

interface ProfileConstraints {
  id: HostId;
  name: string;
  description: string;
  assumptions: readonly HostAssumptionSourceV1[];
  transports: readonly TransportKind[];
  protocolEras: readonly ProtocolEra[];
  sessions: readonly SessionBehavior[];
  statefulIsCaveat?: boolean;
  authSchemes: readonly AuthorizationScheme[];
  oauthRegistrationModes: readonly OAuthRegistrationMode[];
  callbackKind: 'hosted-https' | 'loopback' | 'flexible';
  callbackUris: readonly string[];
  supportedCapabilities: readonly CapabilityName[];
  ignoredCapabilities: readonly CapabilityName[];
  browserCors: 'irrelevant' | 'runtime-dependent';
}

const all = (...conditions: CompatibilityConditionV1[]): CompatibilityConditionV1 => ({ all: conditions });
const any = (...conditions: CompatibilityConditionV1[]): CompatibilityConditionV1 => ({ any: conditions });

const makeRules = (profile: ProfileConstraints): readonly CompatibilityRuleV1[] => {
  const sourceIds = profile.assumptions.map(({ id }) => id);
  const callbackPolicies: readonly RedirectPolicy[] = profile.callbackKind === 'hosted-https'
    ? ['unrestricted', 'https-only']
    : profile.callbackKind === 'loopback'
      ? ['unrestricted', 'loopback-only']
      : ['unrestricted', 'https-only', 'loopback-only'];
  const supportedStaticSchemes = profile.authSchemes.filter((scheme) => scheme !== 'oauth');
  const oauthApplies = all(
    observed('authorization.requirement', 'required'),
    condition('authorization.schemes', 'contains-any', ['oauth']),
    ...(supportedStaticSchemes.length > 0
      ? [{
          not: condition(
            'authorization.schemes',
            'contains-any',
            supportedStaticSchemes
          ),
        } satisfies CompatibilityConditionV1]
      : [])
  );

  const rule = (
    value: Omit<CompatibilityRuleV1, 'schemaVersion' | 'assumptionSourceIds'>
  ): CompatibilityRuleV1 => ({
    schemaVersion: COMPATIBILITY_SCHEMA_VERSION,
    assumptionSourceIds: sourceIds,
    ...value,
  });

  const rules: CompatibilityRuleV1[] = [
    rule({
      id: 'transport.kind',
      scope: 'target-server',
      passWhen: condition('transport.kind', 'one-of', profile.transports),
      onPass: result('pass', 'Transport is supported', `${profile.name} supports the observed remote transport.`),
      onFail: result(
        'fail',
        'Transport is not supported',
        `${profile.name} cannot connect with the observed remote transport.`,
        remediation('server-change', `Expose a ${profile.transports.join(' or ')} endpoint.`, MCP_TRANSPORT_SPEC)
      ),
      onUnknown: result(
        'unknown',
        'Transport compatibility is unknown',
        'No target-server transport was established.',
        remediation('observation-needed', 'Complete transport discovery and record the target endpoint transport.')
      ),
      evidenceFacts: ['transport.kind'],
    }),
    rule({
      id: 'transport.legacy-sse-deprecated',
      scope: 'target-server',
      appliesWhen: observed('transport.kind', 'legacy-sse'),
      passWhen: { fact: 'transport.kind', operator: 'not-equals', value: 'legacy-sse' },
      onPass: result('pass', 'Transport is current', 'The server does not depend on deprecated HTTP+SSE.'),
      onFail: result(
        'caveat',
        'Legacy SSE is deprecated',
        `${profile.name} can use legacy HTTP+SSE today, but Streamable HTTP is the durable remote transport.`,
        remediation('server-change', 'Add a Streamable HTTP endpoint and retain SSE only during migration.', MCP_TRANSPORT_SPEC)
      ),
      onUnknown: result('unknown', 'Legacy transport use is unknown', 'The transport was not observed.'),
      evidenceFacts: ['transport.kind'],
    }),
    rule({
      id: 'protocol.era',
      scope: 'target-server',
      passWhen: condition('protocol.era', 'one-of', profile.protocolEras),
      onPass: result('pass', 'Protocol era is supported', `${profile.name} supports the observed MCP protocol era.`),
      onFail: result(
        'fail',
        'Protocol era is not supported',
        `${profile.name} is not known to speak the observed protocol era.`,
        remediation('server-change', `Negotiate one of these protocol eras: ${profile.protocolEras.join(', ')}.`)
      ),
      onUnknown: result(
        'unknown',
        'Protocol era is unknown',
        'A transport response without a negotiated or advertised protocol era is insufficient to decide compatibility.',
        remediation('observation-needed', 'Record the negotiated MCP version or protocol-era discovery response.')
      ),
      evidenceFacts: ['protocol.era', 'protocol.version'],
    }),
    rule({
      id: 'protocol.session-behavior',
      scope: 'target-server',
      passWhen: condition('protocol.sessionBehavior', 'one-of', profile.sessions),
      onPass: result('pass', 'Session behavior is supported', `${profile.name} supports the observed session behavior.`),
      onFail: result(
        'fail',
        'Session behavior is not supported',
        `${profile.name} cannot reliably preserve the server's required session behavior.`,
        remediation('server-change', `Use ${profile.sessions.join(' or ')} Streamable HTTP request handling.`)
      ),
      onUnknown: result(
        'unknown',
        'Session behavior is unknown',
        'The observations do not establish whether requests require server-held session state.',
        remediation('observation-needed', 'Record whether the server issues or requires an MCP session identifier.')
      ),
      evidenceFacts: ['protocol.sessionBehavior'],
    }),
    rule({
      id: 'authorization.scheme',
      scope: 'target-server',
      passWhen: any(
        condition('authorization.requirement', 'one-of', ['none', 'optional']),
        condition('authorization.schemes', 'contains-any', profile.authSchemes)
      ),
      onPass: result(
        'pass',
        'Authorization mode is supported',
        'The server is public or advertises a credential mechanism this host can supply.'
      ),
      onFail: result(
        'fail',
        'No supported authorization mode',
        `The server requires authorization, but ${profile.name} cannot supply any observed scheme.`,
        remediation(
          'server-change',
          `Offer OAuth or one of the host-supported schemes: ${profile.authSchemes.join(', ')}.`,
          MCP_AUTH_SPEC
        )
      ),
      onUnknown: result(
        'unknown',
        'Authorization compatibility is unknown',
        'Authorization may be required, but the accepted schemes were not established. Missing user credentials alone is not a server failure.',
        remediation('observation-needed', 'Capture the target server\'s WWW-Authenticate challenge or configuration metadata.')
      ),
      evidenceFacts: ['authorization.requirement', 'authorization.schemes'],
    }),
    rule({
      id: 'authorization.oauth.protected-resource-metadata',
      scope: 'target-server',
      appliesWhen: oauthApplies,
      passWhen: observed('authorization.oauth.protectedResourceMetadata', true),
      onPass: result('pass', 'Protected resource metadata is available', 'The MCP resource identifies its authorization server.'),
      onFail: result(
        'fail',
        'Protected resource metadata is missing',
        'OAuth hosts cannot reliably discover the authorization server for this protected MCP resource.',
        remediation('server-change', 'Publish RFC 9728 protected resource metadata and identify at least one authorization server.', MCP_AUTH_SPEC)
      ),
      onUnknown: result(
        'unknown',
        'Protected resource discovery is unknown',
        'OAuth was observed, but protected resource metadata was not conclusively tested.',
        remediation('observation-needed', 'Fetch the resource metadata URL advertised by WWW-Authenticate.')
      ),
      evidenceFacts: ['authorization.oauth.protectedResourceMetadata'],
    }),
    rule({
      id: 'authorization.oauth.authorization-server-metadata',
      scope: 'authorization-server',
      appliesWhen: oauthApplies,
      passWhen: observed('authorization.oauth.authorizationServerMetadata', true),
      onPass: result('pass', 'Authorization server metadata is available', 'OAuth endpoints can be discovered without guessing.'),
      onFail: result(
        'fail',
        'Authorization server metadata is missing',
        'The authorization and token endpoints cannot be discovered through standard metadata.',
        remediation('authorization-server-change', 'Publish RFC 8414 authorization server metadata.', MCP_AUTH_SPEC)
      ),
      onUnknown: result(
        'unknown',
        'Authorization server discovery is unknown',
        'No conclusive authorization server metadata observation is available.',
        remediation('observation-needed', 'Fetch the issuer\'s OAuth authorization server metadata document.')
      ),
      evidenceFacts: ['authorization.oauth.authorizationServerMetadata'],
    }),
    rule({
      id: 'authorization.oauth.registration',
      scope: 'authorization-server',
      appliesWhen: oauthApplies,
      passWhen: condition(
        'authorization.oauth.registrationModes',
        'contains-any',
        profile.oauthRegistrationModes
      ),
      onPass: result('pass', 'OAuth client registration is compatible', `${profile.name} can establish a client identity using an advertised mode.`),
      onFail: result(
        'fail',
        'OAuth client registration is incompatible',
        `The authorization server and ${profile.name} have no registration mode in common.`,
        remediation(
          'authorization-server-change',
          `Enable one of: ${profile.oauthRegistrationModes.join(', ')}.`,
          MCP_AUTH_SPEC
        )
      ),
      onUnknown: result(
        'unknown',
        'OAuth client registration is unknown',
        'The authorization server registration modes were not observed.',
        remediation('observation-needed', 'Inspect registration_endpoint and client_id_metadata_document_supported in OAuth metadata.')
      ),
      evidenceFacts: ['authorization.oauth.registrationModes'],
    }),
    rule({
      id: 'authorization.oauth.pkce',
      scope: 'authorization-server',
      appliesWhen: oauthApplies,
      passWhen: observed('authorization.oauth.pkceS256', true),
      onPass: result('pass', 'PKCE S256 is supported', 'The authorization-code flow supports the MCP-required code challenge.'),
      onFail: result(
        'fail',
        'PKCE S256 is not supported',
        'Public MCP clients require PKCE to protect the authorization code flow.',
        remediation('authorization-server-change', 'Accept code_challenge_method=S256 for authorization-code grants.', MCP_AUTH_SPEC)
      ),
      onUnknown: result(
        'unknown',
        'PKCE support is unknown',
        'OAuth metadata or a flow observation did not establish S256 support.',
        remediation('observation-needed', 'Inspect code_challenge_methods_supported or exercise an S256 authorization request.')
      ),
      evidenceFacts: ['authorization.oauth.pkceS256'],
    }),
    rule({
      id: 'authorization.oauth.refresh-tokens',
      scope: 'authorization-server',
      appliesWhen: oauthApplies,
      passWhen: observed('authorization.oauth.refreshTokens', true),
      onPass: result('pass', 'Token refresh is supported', 'Long-lived host connections can renew access without repeating sign-in.'),
      onFail: result(
        'caveat',
        'Token refresh is unavailable',
        'Initial authorization can work, but users may need to authenticate again after access tokens expire.',
        remediation('authorization-server-change', 'Issue refresh tokens and advertise the required offline-access scope where applicable.', MCP_AUTH_SPEC)
      ),
      onUnknown: result(
        'caveat',
        'Token refresh is unknown',
        'This does not block initial authorization, but session longevity is unverified.',
        remediation('observation-needed', 'Confirm refresh_token issuance and refresh-token grant support.')
      ),
      evidenceFacts: ['authorization.oauth.refreshTokens'],
    }),
    rule({
      id: 'authorization.oauth.redirects',
      scope: 'authorization-server',
      appliesWhen: oauthApplies,
      ...(profile.callbackUris.length === 0
        ? {
            unknownWhen: all(
              observed('authorization.oauth.dynamicRedirectRegistration', false),
              observed('authorization.oauth.redirectPolicy', 'exact-match')
            ),
          }
        : {}),
      passWhen: any(
        observed('authorization.oauth.dynamicRedirectRegistration', true),
        condition('authorization.oauth.redirectPolicy', 'one-of', callbackPolicies),
        ...(profile.callbackUris.length > 0
          ? [condition('authorization.oauth.registeredRedirectUris', 'contains-any', profile.callbackUris)]
          : [])
      ),
      onPass: result('pass', 'OAuth redirect constraints are compatible', `The authorization server can accept ${profile.name}'s callback style.`),
      onFail: result(
        'fail',
        'OAuth redirect constraints are incompatible',
        `The authorization server does not accept ${profile.callbackKind} callbacks required by ${profile.name}.`,
        remediation(
          'authorization-server-change',
          profile.callbackUris.length > 0
            ? `Register an exact callback URI: ${profile.callbackUris.join(' or ')}.`
            : `Allow ${profile.callbackKind} redirect URIs supplied during client registration.`,
          MCP_AUTH_SPEC
        )
      ),
      onUnknown: result(
        'unknown',
        'OAuth redirect compatibility is unknown',
        profile.callbackUris.length === 0
          ? `No verified ${profile.name} callback URI is available to compare with the authorization server's exact-match policy.`
          : 'The available redirect evidence does not establish whether the authorization server accepts the host callback URI.',
        remediation(
          'observation-needed',
          profile.callbackUris.length === 0
            ? `Verify ${profile.name}'s exact callback URI and compare it with the registered redirect URIs.`
            : 'Record accepted redirect URI classes or the exact registered callbacks.'
        )
      ),
      evidenceFacts: [
        'authorization.oauth.dynamicRedirectRegistration',
        'authorization.oauth.redirectPolicy',
        'authorization.oauth.registeredRedirectUris',
      ],
    }),
  ];

  const usableConditions = profile.supportedCapabilities.map((capability) => (
    observed(`capabilities.${capability}` as `capabilities.${CapabilityName}`, 'present')
  ));
  rules.push(rule({
    id: 'capabilities.usable',
    scope: 'target-server',
    passWhen: any(...usableConditions),
    onPass: result('pass', 'A usable capability is available', `${profile.name} can consume at least one advertised server capability.`),
    onFail: result(
      'fail',
      'No usable capability is available',
      `The server exposes none of the capabilities ${profile.name} can consume: ${profile.supportedCapabilities.join(', ')}.`,
      remediation('server-change', `Expose at least one supported capability: ${profile.supportedCapabilities.join(', ')}.`)
    ),
    onUnknown: result(
      'unknown',
      'Usable capabilities are unknown',
      'Capability discovery did not establish a host-usable feature.',
      remediation('observation-needed', 'Complete MCP capability and list-method discovery.')
    ),
    evidenceFacts: profile.supportedCapabilities.map((name) => `capabilities.${name}` as `capabilities.${CapabilityName}`),
  }));

  for (const capability of profile.ignoredCapabilities) {
    rules.push(rule({
      id: `capabilities.${capability}`,
      scope: 'target-server',
      appliesWhen: observed(`capabilities.${capability}` as `capabilities.${CapabilityName}`, 'present'),
      passWhen: observed(`capabilities.${capability}` as `capabilities.${CapabilityName}`, 'absent'),
      onPass: result('pass', 'Capability is not required', `${capability} is not advertised.`),
      onFail: result(
        'caveat',
        `${profile.name} ignores ${capability}`,
        `The server can still connect, but ${profile.name} does not consume the advertised ${capability} capability.`,
        remediation('server-change', `Do not rely on ${capability} when serving ${profile.name}; provide equivalent behavior through a supported capability.`)
      ),
      onUnknown: result('pass', 'Capability support is not material', `${capability} was not conclusively observed.`),
      evidenceFacts: [`capabilities.${capability}` as `capabilities.${CapabilityName}`],
    }));
  }

  rules.push(rule({
    id: 'environment.browser-cors',
    scope: 'client-environment',
    appliesWhen: observed('environment.cors', 'blocked'),
    passWhen: observed('environment.cors', 'allowed'),
    onPass: result('pass', 'Browser access is available', 'The discovery browser can call the target directly.'),
    onFail: profile.browserCors === 'irrelevant'
      ? result(
          'pass',
          'Browser CORS is not a target-host incompatibility',
          `${profile.name} does not depend on mcptest's browser origin. The target may still be fully compatible.`
        )
      : result(
          'caveat',
          'Browser runtimes need CORS access',
          'Node-based SDK clients can connect, but browser-based SDK clients need an allowed origin or a trusted backend proxy.',
          remediation('server-change', 'Allow the intended browser origin and MCP request headers, or connect from a server-side runtime.')
        ),
    onUnknown: result('pass', 'Browser CORS was not tested', 'CORS does not determine target protocol compatibility by itself.'),
    evidenceFacts: ['environment.cors'],
  }));
  rules.push(rule({
    id: 'environment.proxy-route',
    scope: 'client-environment',
    appliesWhen: any(
      observed('environment.proxyRoute', 'used'),
      observed('environment.proxyRoute', 'failed'),
      observed('environment.directAccess', 'blocked')
    ),
    passWhen: observed('environment.proxyRoute', 'not-used'),
    onPass: result('pass', 'No proxy limitation was observed', 'The test reached the target directly.'),
    onFail: result(
      'pass',
      'Proxy or browser limitation is isolated',
      'This observation describes the mcptest execution path, not the target MCP server behavior. It does not make the server incompatible with the host.'
    ),
    onUnknown: result('pass', 'Proxy use is unknown', 'Proxy state does not determine target-server compatibility.'),
    evidenceFacts: ['environment.directAccess', 'environment.proxyRoute'],
  }));

  if (profile.statefulIsCaveat) {
    rules.push(rule({
      id: 'protocol.stateful-scaling-caveat',
      scope: 'target-server',
      appliesWhen: observed('protocol.sessionBehavior', 'stateful'),
      passWhen: observed('protocol.sessionBehavior', 'stateless'),
      onPass: result('pass', 'Server is horizontally portable', 'Requests do not depend on server-held MCP session state.'),
      onFail: result(
        'caveat',
        'Stateful routing needs operational care',
        `${profile.name} can preserve MCP sessions, but the deployment must route a session consistently and retain its state.`,
        remediation('server-change', 'Prefer stateless request handling, or guarantee durable session storage and affinity across instances.')
      ),
      onUnknown: result('unknown', 'Session scaling behavior is unknown', 'Statefulness was not established.'),
      evidenceFacts: ['protocol.sessionBehavior'],
    }));
  }

  return rules;
};

const source = (
  id: string,
  title: string,
  url: string,
  notes: string,
  accessedOn: string
): HostAssumptionSourceV1 => ({ id, title, url, accessedOn, notes });

const supported = (cell: SourcedCell<SupportLevel>) => cell.value === 'supported';

const cellLabels: Record<string, string> = {
  'transports.streamableHttp': 'Streamable HTTP',
  'transports.legacySse': 'legacy SSE',
  'transports.stdio': 'stdio',
  'protocolVersions': 'protocol versions',
  'auth.oauthDcr': 'OAuth dynamic client registration',
  'auth.preRegisteredClient': 'pre-registered OAuth clients',
  'auth.cimd': 'Client ID Metadata Documents',
  'auth.bearerToken': 'bearer tokens',
  'auth.apiKeyHeader': 'API key headers',
  'auth.none': 'authless servers',
  'oauthCallbacks': 'OAuth callback URIs',
  'headers.custom': 'custom headers',
  'privateHosts': 'private hosts',
  'capabilities.tools': 'tools',
  'capabilities.resources': 'resources',
  'capabilities.prompts': 'prompts',
  'capabilities.resourceSubscriptions': 'resource subscriptions',
  'capabilities.sampling': 'sampling',
  'capabilities.elicitation': 'elicitation',
  'capabilities.tasks': 'tasks',
};

const describeCell = (path: string, cell: SourcedCell<unknown>): string => {
  const label = cellLabels[path] ?? path;
  const value = Array.isArray(cell.value) ? cell.value.join(', ') : String(cell.value);
  return `${label}: ${value}`;
};

/**
 * Host-profile assumptions cite the client compatibility data: one assumption
 * per source page, listing the engine-relevant cells that page establishes.
 */
const clientAssumptions = (entry: ClientCompatibilityEntry): HostAssumptionSourceV1[] => {
  const cells = listCells(entry).filter((item): item is { path: string; cell: SourcedCell<unknown> } => (
    'value' in item.cell && item.path in cellLabels
  ));
  return entry.sources.flatMap((link, index) => {
    const cited = cells.filter(({ cell }) => cell.source === link.url);
    if (cited.length === 0) return [];
    const verifiedOn = cited.map(({ cell }) => cell.verifiedOn).sort()[0];
    return [source(
      `${entry.id}-${index + 1}`,
      link.title,
      link.url,
      `${entry.name}: ${cited.map(({ path, cell }) => describeCell(path, cell)).join('; ')}.`,
      verifiedOn
    )];
  });
};

/** Profile constraints that describe the client itself, read from clientCompatibility.json. */
const fromClientData = (hostId: HostId) => {
  const entry = getClientCompatibilityForHost(hostId);
  const transports: TransportKind[] = [];
  if (supported(entry.transports.streamableHttp)) transports.push('streamable-http');
  if (supported(entry.transports.legacySse)) transports.push('legacy-sse');

  const oauthRegistrationModes: OAuthRegistrationMode[] = [];
  if (supported(entry.auth.cimd)) oauthRegistrationModes.push('client-id-metadata-document');
  if (supported(entry.auth.oauthDcr)) oauthRegistrationModes.push('dynamic-client-registration');
  // A client that accepts a user-supplied client ID can use both a client the
  // server already registered for it and credentials the user registers.
  if (supported(entry.auth.preRegisteredClient)) oauthRegistrationModes.push('pre-registered', 'manual-client-credentials');

  const authSchemes: AuthorizationScheme[] = [];
  if (oauthRegistrationModes.length > 0) authSchemes.push('oauth');
  if (supported(entry.auth.bearerToken)) authSchemes.push('bearer');
  if (supported(entry.auth.apiKeyHeader)) authSchemes.push('api-key');

  return {
    entry,
    assumptions: clientAssumptions(entry),
    transports,
    authSchemes,
    oauthRegistrationModes,
    // Only exact URIs are usable for exact-match redirect checks.
    callbackUris: entry.oauthCallbacks.value === 'unknown' ? [] : entry.oauthCallbacks.value,
    supportedCapabilities: CAPABILITY_NAMES.filter((name) => supported(entry.capabilities[name])),
    ignoredCapabilities: CAPABILITY_NAMES.filter((name) => !supported(entry.capabilities[name])),
  };
};

const mcpAuthAssumption = (notes: string) => source(
  'mcp-auth',
  'MCP authorization specification',
  MCP_AUTH_SPEC,
  notes,
  MCP_AUTH_SPEC_REVIEWED_ON
);

const common = {
  protocolEras: ['2024', '2025', '2026'] as const,
  sessions: ['stateful', 'stateless'] as const,
};

export const HOST_IDS = Object.freeze([
  'chatgpt',
  'claude',
  'cursor',
  'vscode-copilot',
  'generic-sdk',
] as const satisfies readonly HostId[]);

/**
 * Client facts (transports, credentials, registration, callbacks, consumed
 * capabilities and their sources) come from clientCompatibility.json. What
 * stays here is modeling: protocol eras, session handling, callback style and
 * whether browser CORS matters for the host.
 */
const withClientData = (
  hostId: HostId,
  profile: Omit<ProfileConstraints, 'id' | 'assumptions' | 'transports' | 'authSchemes' | 'oauthRegistrationModes' | 'callbackUris' | 'supportedCapabilities' | 'ignoredCapabilities'>,
  authNotes: string
): ProfileConstraints & { verifiedOn: string } => {
  const { entry, assumptions, ...client } = fromClientData(hostId);
  return {
    id: hostId,
    ...profile,
    ...client,
    assumptions: [...assumptions, mcpAuthAssumption(authNotes)],
    verifiedOn: entry.verifiedOn,
  };
};

const constraints: ReadonlyArray<ProfileConstraints & { verifiedOn: string }> = [
  withClientData('chatgpt', {
    name: 'ChatGPT',
    description: 'ChatGPT custom remote MCP apps/connectors.',
    ...common,
    statefulIsCaveat: true,
    callbackKind: 'hosted-https',
    browserCors: 'irrelevant',
  }, 'Discovery, PKCE, registration, and redirect requirements.'),
  withClientData('claude', {
    name: 'Claude',
    description: 'Claude web and desktop remote custom connectors.',
    ...common,
    callbackKind: 'hosted-https',
    browserCors: 'irrelevant',
  }, 'Discovery, PKCE, registration, and redirect requirements.'),
  withClientData('cursor', {
    name: 'Cursor',
    description: 'Cursor IDE remote MCP clients.',
    ...common,
    callbackKind: 'loopback',
    browserCors: 'irrelevant',
  }, 'Local public clients use PKCE and loopback redirect URIs.'),
  withClientData('vscode-copilot', {
    name: 'VS Code/Copilot',
    description: 'VS Code MCP support used by GitHub Copilot chat.',
    ...common,
    callbackKind: 'loopback',
    browserCors: 'irrelevant',
  }, 'Local public clients use PKCE and loopback redirect URIs.'),
  withClientData('generic-sdk', {
    name: 'Generic MCP SDK',
    description: 'A configurable client built on a current MCP SDK.',
    ...common,
    callbackKind: 'flexible',
    browserCors: 'runtime-dependent',
  }, 'Generic clients can select any standardized registration and redirect strategy.'),
];

export const HOST_PROFILES: Readonly<Record<HostId, HostProfileV1>> = Object.freeze(
  Object.fromEntries(constraints.map((profile) => [
    profile.id,
    Object.freeze({
      schemaVersion: COMPATIBILITY_SCHEMA_VERSION,
      // The profile version follows the client data it was built from, so a
      // stored assessment records which verified assumptions it used.
      profileVersion: `${profile.verifiedOn}.1`,
      id: profile.id,
      name: profile.name,
      description: profile.description,
      assumptions: profile.assumptions,
      rules: makeRules(profile),
    }),
  ])) as Record<HostId, HostProfileV1>
);

export const HOST_PROFILE_LIST: readonly HostProfileV1[] = Object.freeze(
  HOST_IDS.map((id) => HOST_PROFILES[id])
);
