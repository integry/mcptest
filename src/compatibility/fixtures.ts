import {
  COMPATIBILITY_SCHEMA_VERSION,
  type CompatibilityEvidenceV1,
  type Known,
  type ObservedServerFactsV1,
  type ObservedValueV1,
} from './types';

const targetEvidence = (description: string): CompatibilityEvidenceV1 => ({
  schemaVersion: COMPATIBILITY_SCHEMA_VERSION,
  source: 'target-server',
  description,
});

export const observedFact = <T>(
  value: Known<T>,
  description: string,
  source: CompatibilityEvidenceV1['source'] = 'target-server'
): ObservedValueV1<T> => ({
  value,
  evidence: [{
    schemaVersion: COMPATIBILITY_SCHEMA_VERSION,
    source,
    description,
  }],
});

export const unknownFact = <T>(description: string): ObservedValueV1<T> => ({
  value: 'unknown',
  evidence: [targetEvidence(description)],
});

const absentCapabilities = () => ({
  resources: observedFact('absent' as const, 'resources/list was not advertised.'),
  prompts: observedFact('absent' as const, 'prompts/list was not advertised.'),
  resourceSubscriptions: observedFact('absent' as const, 'Resource subscriptions were not advertised.'),
  sampling: observedFact('absent' as const, 'Sampling was not advertised.'),
  elicitation: observedFact('absent' as const, 'Elicitation was not advertised.'),
  tasks: observedFact('absent' as const, 'Tasks were not advertised.'),
});

const unusedOAuth = () => ({
  protectedResourceMetadata: unknownFact<boolean>('OAuth was not applicable to this public fixture.'),
  authorizationServerMetadata: unknownFact<boolean>('OAuth was not applicable to this public fixture.'),
  registrationModes: unknownFact<readonly []>('OAuth was not applicable to this public fixture.'),
  pkceS256: unknownFact<boolean>('OAuth was not applicable to this public fixture.'),
  refreshTokens: unknownFact<boolean>('OAuth was not applicable to this public fixture.'),
  redirectPolicy: unknownFact<'unrestricted'>('OAuth was not applicable to this public fixture.'),
  registeredRedirectUris: unknownFact<readonly string[]>('OAuth was not applicable to this public fixture.'),
  dynamicRedirectRegistration: unknownFact<boolean>('OAuth was not applicable to this public fixture.'),
});

const directEnvironment = () => ({
  directAccess: observedFact('reachable' as const, 'The target was reached directly.', 'browser'),
  cors: observedFact('allowed' as const, 'The target allowed the discovery browser origin.', 'browser'),
  proxyRoute: observedFact('not-used' as const, 'No proxy was used.', 'configuration'),
});

export const publicServerFixture: ObservedServerFactsV1 = {
  schemaVersion: COMPATIBILITY_SCHEMA_VERSION,
  serverUrl: 'https://public.example/mcp',
  transport: {
    kind: observedFact('streamable-http', 'A Streamable HTTP response was received.'),
  },
  protocol: {
    era: observedFact('2026', 'server/discover selected the 2026 protocol era.'),
    version: observedFact('2026-07-28', 'The server selected MCP 2026-07-28.'),
    sessionBehavior: observedFact('stateless', 'Requests completed without an MCP session identifier.'),
  },
  authorization: {
    requirement: observedFact('none', 'The server accepted an unauthenticated initialize request.'),
    schemes: observedFact<readonly []>([], 'No authentication challenge was returned.'),
    oauth: unusedOAuth(),
  },
  capabilities: {
    tools: observedFact('present', 'tools/list returned at least one tool.'),
    ...absentCapabilities(),
  },
  environment: directEnvironment(),
};

export const oauthProtectedServerFixture: ObservedServerFactsV1 = {
  ...publicServerFixture,
  serverUrl: 'https://oauth.example/mcp',
  authorization: {
    requirement: observedFact('required', 'The target returned 401 with a Bearer challenge.'),
    schemes: observedFact<readonly ['oauth']>(['oauth'], 'WWW-Authenticate identified OAuth Bearer authorization.'),
    oauth: {
      protectedResourceMetadata: observedFact(true, 'RFC 9728 protected resource metadata was discovered.'),
      authorizationServerMetadata: observedFact(true, 'RFC 8414 authorization server metadata was discovered.', 'authorization-server'),
      registrationModes: observedFact<readonly ['dynamic-client-registration']>(
        ['dynamic-client-registration'],
        'Authorization metadata advertised registration_endpoint.',
        'authorization-server'
      ),
      pkceS256: observedFact(true, 'Authorization metadata advertised S256 PKCE.', 'authorization-server'),
      refreshTokens: observedFact(true, 'The authorization server advertised refresh_token support.', 'authorization-server'),
      redirectPolicy: observedFact('exact-match', 'Registered redirect URIs are compared exactly.', 'authorization-server'),
      registeredRedirectUris: observedFact<readonly []>([], 'No host-specific callback was pre-registered.', 'authorization-server'),
      dynamicRedirectRegistration: observedFact(true, 'DCR accepts and registers the client callback exactly.', 'authorization-server'),
    },
  },
};

export const optionalOAuthServerFixture: ObservedServerFactsV1 = {
  ...publicServerFixture,
  serverUrl: 'https://optional-oauth.example/mcp',
  authorization: {
    requirement: observedFact('optional', 'The target accepted an unauthenticated initialize request.'),
    schemes: observedFact<readonly ['oauth']>(['oauth'], 'The target optionally advertises OAuth authorization.'),
    oauth: {
      ...unusedOAuth(),
      protectedResourceMetadata: observedFact(
        false,
        'Protected resource metadata was conclusively unavailable.'
      ),
    },
  },
};

export const statefulStreamableHttpServerFixture: ObservedServerFactsV1 = {
  ...publicServerFixture,
  serverUrl: 'https://stateful.example/mcp',
  protocol: {
    era: observedFact('2025', 'initialize selected a 2025 protocol revision.'),
    version: observedFact('2025-11-25', 'The server selected MCP 2025-11-25.'),
    sessionBehavior: observedFact('stateful', 'The server issued and subsequently required Mcp-Session-Id.'),
  },
};

export const statelessStreamableHttpServerFixture: ObservedServerFactsV1 = {
  ...publicServerFixture,
  serverUrl: 'https://stateless.example/mcp',
};

export const legacySseServerFixture: ObservedServerFactsV1 = {
  ...statefulStreamableHttpServerFixture,
  serverUrl: 'https://legacy.example/sse',
  transport: {
    kind: observedFact('legacy-sse', 'The server established the deprecated HTTP+SSE transport.'),
  },
  protocol: {
    era: observedFact('2024', 'initialize selected a 2024 protocol revision.'),
    version: observedFact('2024-11-05', 'The server selected MCP 2024-11-05.'),
    sessionBehavior: observedFact('stateful', 'The SSE connection and message endpoint retain connection state.'),
  },
};

export const compatibilityFixtures = Object.freeze({
  public: publicServerFixture,
  oauthProtected: oauthProtectedServerFixture,
  optionalOAuth: optionalOAuthServerFixture,
  statefulStreamableHttp: statefulStreamableHttpServerFixture,
  statelessStreamableHttp: statelessStreamableHttpServerFixture,
  legacySse: legacySseServerFixture,
});
