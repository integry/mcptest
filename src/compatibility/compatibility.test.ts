import { describe, expect, it } from 'vitest';
import {
  COMPATIBILITY_SCHEMA_VERSION,
  HOST_PROFILE_LIST,
  assessCompatibilityMatrix,
  assessHostCompatibility,
  evaluateCondition,
  legacySseServerFixture,
  oauthProtectedServerFixture,
  observedFact,
  publicServerFixture,
  statefulStreamableHttpServerFixture,
  statelessStreamableHttpServerFixture,
  unknownFact,
  type ObservedServerFactsV1,
} from '.';

const cloneFacts = (facts: ObservedServerFactsV1): ObservedServerFactsV1 => structuredClone(facts);

describe('host compatibility evaluator', () => {
  it('returns the same matrix for the same facts without mutating its input', () => {
    const facts = cloneFacts(oauthProtectedServerFixture);
    const before = structuredClone(facts);

    const first = assessCompatibilityMatrix(facts);
    const second = assessCompatibilityMatrix(facts);

    expect(first).toEqual(second);
    expect(facts).toEqual(before);
    expect(Object.keys(first.assessments)).toEqual([
      'chatgpt',
      'claude',
      'cursor',
      'vscode-copilot',
      'generic-sdk',
    ]);
  });

  it('marks a public stateless Streamable HTTP tool server compatible with every profile', () => {
    const matrix = assessCompatibilityMatrix(publicServerFixture);

    expect(Object.values(matrix.assessments).map(({ status }) => status)).toEqual([
      'compatible',
      'compatible',
      'compatible',
      'compatible',
      'compatible',
    ]);
  });

  it('does not mark an authorization-required server broken because credentials are absent', () => {
    const matrix = assessCompatibilityMatrix(oauthProtectedServerFixture);

    expect(Object.values(matrix.assessments).every(({ status }) => status === 'compatible')).toBe(true);
    expect(matrix.assessments.chatgpt.findings).toContainEqual(expect.objectContaining({
      ruleId: 'authorization.scheme',
      outcome: 'pass',
      scope: 'target-server',
    }));
    expect(JSON.stringify(matrix)).not.toContain('credentials are absent');
  });

  it('accepts optional authorization when the host supports none of the advertised schemes', () => {
    const facts = cloneFacts(publicServerFixture);
    facts.authorization.requirement = observedFact(
      'optional',
      'The target accepts unauthenticated requests and optionally supports bearer authorization.'
    );
    facts.authorization.schemes = observedFact(
      ['bearer'],
      'The target optionally accepts a bearer credential.'
    );

    const assessment = assessHostCompatibility(facts, 'chatgpt');

    expect(assessment.status).toBe('compatible');
    expect(assessment.findings).toContainEqual(expect.objectContaining({
      ruleId: 'authorization.scheme',
      outcome: 'pass',
    }));
  });

  it('distinguishes stateful and stateless Streamable HTTP behavior', () => {
    const stateful = assessCompatibilityMatrix(statefulStreamableHttpServerFixture);
    const stateless = assessCompatibilityMatrix(statelessStreamableHttpServerFixture);

    expect(stateful.assessments.chatgpt.status).toBe('compatible-with-caveats');
    expect(stateful.assessments.chatgpt.findings).toContainEqual(expect.objectContaining({
      ruleId: 'protocol.stateful-scaling-caveat',
      outcome: 'caveat',
    }));
    expect(stateful.assessments.claude.status).toBe('compatible');
    expect(Object.values(stateless.assessments).every(({ status }) => status === 'compatible')).toBe(true);
  });

  it('reports legacy SSE as supported with an explicit migration caveat', () => {
    const matrix = assessCompatibilityMatrix(legacySseServerFixture);

    for (const assessment of Object.values(matrix.assessments)) {
      expect(assessment.status).toBe('compatible-with-caveats');
      expect(assessment.findings).toContainEqual(expect.objectContaining({
        ruleId: 'transport.legacy-sse-deprecated',
        outcome: 'caveat',
        remediation: expect.objectContaining({ action: expect.stringContaining('Streamable HTTP') }),
      }));
    }
  });

  it('keeps an unobserved material fact unknown instead of failing closed', () => {
    const facts = cloneFacts(publicServerFixture);
    facts.transport.kind = unknownFact('Every transport probe timed out before a target response.');

    const assessment = assessHostCompatibility(facts, 'claude');

    expect(assessment.status).toBe('unknown');
    expect(assessment.findings).toContainEqual(expect.objectContaining({
      ruleId: 'transport.kind',
      outcome: 'unknown',
      severity: 'warning',
    }));
    expect(assessment.findings.some(({ outcome }) => outcome === 'fail')).toBe(false);
  });

  it.each(['bearer', 'api-key'] as const)(
    'uses profile data to distinguish static %s credential support',
    (scheme) => {
      const facts = cloneFacts(publicServerFixture);
      facts.authorization.requirement = observedFact('required', `The target requires a static ${scheme} credential.`);
      facts.authorization.schemes = observedFact([scheme], `Configuration documents a static ${scheme} credential.`);

      expect(assessHostCompatibility(facts, 'chatgpt').status).toBe('incompatible');
      expect(assessHostCompatibility(facts, 'claude').status).toBe('incompatible');
      expect(assessHostCompatibility(facts, 'cursor').status).toBe('compatible');
      expect(assessHostCompatibility(facts, 'vscode-copilot').status).toBe('compatible');
      expect(assessHostCompatibility(facts, 'generic-sdk').status).toBe('compatible');
    }
  );

  it.each([
    ['protectedResourceMetadata', 'authorization.oauth.protected-resource-metadata'],
    ['authorizationServerMetadata', 'authorization.oauth.authorization-server-metadata'],
    ['pkceS256', 'authorization.oauth.pkce'],
  ] as const)('fails OAuth when %s is conclusively unavailable', (factName, ruleId) => {
    const facts = cloneFacts(oauthProtectedServerFixture);
    facts.authorization.oauth[factName] = observedFact(false, `${factName} is unavailable.`);

    const assessment = assessHostCompatibility(facts, 'claude');
    const finding = assessment.findings.find((item) => item.ruleId === ruleId);

    expect(assessment.status).toBe('incompatible');
    expect(finding).toMatchObject({ outcome: 'fail', severity: 'error' });
    expect(finding?.remediation?.action).toBeTruthy();
  });

  it('fails when OAuth client registration modes do not intersect', () => {
    const facts = cloneFacts(oauthProtectedServerFixture);
    facts.authorization.oauth.registrationModes = observedFact(
      ['client-id-metadata-document'],
      'Only Client ID Metadata Documents are accepted.'
    );

    expect(assessHostCompatibility(facts, 'chatgpt').status).toBe('compatible');
    const claude = assessHostCompatibility(facts, 'claude');
    expect(claude.status).toBe('incompatible');
    expect(claude.findings).toContainEqual(expect.objectContaining({
      ruleId: 'authorization.oauth.registration',
      outcome: 'fail',
    }));
  });

  it('checks hosted and loopback redirect constraints independently', () => {
    const facts = cloneFacts(oauthProtectedServerFixture);
    facts.authorization.oauth.dynamicRedirectRegistration = observedFact(false, 'Redirects cannot be added during registration.');
    facts.authorization.oauth.redirectPolicy = observedFact('loopback-only', 'Only loopback callbacks are accepted.');

    expect(assessHostCompatibility(facts, 'chatgpt').status).toBe('incompatible');
    expect(assessHostCompatibility(facts, 'claude').status).toBe('incompatible');
    expect(assessHostCompatibility(facts, 'cursor').status).toBe('compatible');
    expect(assessHostCompatibility(facts, 'vscode-copilot').status).toBe('compatible');
    expect(assessHostCompatibility(facts, 'generic-sdk').status).toBe('compatible');
  });

  it('makes missing refresh support a caveat rather than an OAuth failure', () => {
    const facts = cloneFacts(oauthProtectedServerFixture);
    facts.authorization.oauth.refreshTokens = observedFact(false, 'No refresh token was issued.');

    const assessment = assessHostCompatibility(facts, 'chatgpt');

    expect(assessment.status).toBe('compatible-with-caveats');
    expect(assessment.findings).toContainEqual(expect.objectContaining({
      ruleId: 'authorization.oauth.refresh-tokens',
      outcome: 'caveat',
    }));
  });

  it('separates browser/proxy limitations from target-server compatibility', () => {
    const facts = cloneFacts(publicServerFixture);
    facts.environment.directAccess = observedFact('blocked', 'The browser fetch failed before an HTTP response.', 'browser');
    facts.environment.cors = observedFact('blocked', 'The browser blocked the target response for CORS.', 'browser');
    facts.environment.proxyRoute = observedFact('used', 'A proxy reached the target.', 'proxy');

    const chatgpt = assessHostCompatibility(facts, 'chatgpt');
    expect(chatgpt.status).toBe('compatible');
    expect(chatgpt.findings.filter(({ ruleId }) => ruleId.startsWith('environment.'))).toEqual([
      expect.objectContaining({ ruleId: 'environment.browser-cors', scope: 'client-environment', outcome: 'pass' }),
      expect.objectContaining({ ruleId: 'environment.proxy-route', scope: 'client-environment', outcome: 'pass' }),
    ]);

    const generic = assessHostCompatibility(facts, 'generic-sdk');
    expect(generic.status).toBe('compatible-with-caveats');
    expect(generic.findings).toContainEqual(expect.objectContaining({
      ruleId: 'environment.browser-cors',
      outcome: 'caveat',
      scope: 'client-environment',
    }));
  });

  it('evaluates capabilities that materially differ between hosts', () => {
    const facts = cloneFacts(publicServerFixture);
    facts.capabilities.tools = observedFact('absent', 'No tools were advertised.');
    facts.capabilities.resources = observedFact('present', 'resources/list returned a resource.');

    expect(assessHostCompatibility(facts, 'chatgpt').status).toBe('incompatible');
    expect(assessHostCompatibility(facts, 'cursor').status).toBe('incompatible');
    expect(assessHostCompatibility(facts, 'claude').status).toBe('compatible');
    expect(assessHostCompatibility(facts, 'vscode-copilot').status).toBe('compatible');
    expect(assessHostCompatibility(facts, 'generic-sdk').status).toBe('compatible');
  });

  it('reports ignored advanced capabilities as caveats without breaking usable tools', () => {
    const facts = cloneFacts(publicServerFixture);
    facts.capabilities.sampling = observedFact('present', 'The server advertised sampling.');

    expect(assessHostCompatibility(facts, 'claude')).toMatchObject({
      status: 'compatible-with-caveats',
      findings: expect.arrayContaining([
        expect.objectContaining({ ruleId: 'capabilities.sampling', outcome: 'caveat' }),
      ]),
    });
    expect(assessHostCompatibility(facts, 'generic-sdk').status).toBe('compatible');
  });

  it('attaches observed and profile evidence to findings', () => {
    const finding = assessHostCompatibility(publicServerFixture, 'vscode-copilot')
      .findings.find(({ ruleId }) => ruleId === 'transport.kind');

    expect(finding?.evidence).toEqual(expect.arrayContaining([
      expect.objectContaining({ source: 'target-server' }),
      expect.objectContaining({ source: 'host-profile', location: expect.stringMatching(/^https:/) }),
    ]));
  });

  it('executes every rule in every profile across the canonical rule scenarios', () => {
    const environmentLimited = cloneFacts(publicServerFixture);
    environmentLimited.environment.directAccess = observedFact('blocked', 'Direct browser access failed.', 'browser');
    environmentLimited.environment.cors = observedFact('blocked', 'CORS blocked the browser.', 'browser');
    environmentLimited.environment.proxyRoute = observedFact('used', 'The proxy reached the target.', 'proxy');

    const everyCapability = cloneFacts(publicServerFixture);
    for (const name of Object.keys(everyCapability.capabilities) as Array<keyof typeof everyCapability.capabilities>) {
      everyCapability.capabilities[name] = observedFact('present', `${name} is advertised.`);
    }

    const scenarios = [
      publicServerFixture,
      oauthProtectedServerFixture,
      statefulStreamableHttpServerFixture,
      legacySseServerFixture,
      environmentLimited,
      everyCapability,
    ];

    for (const profile of HOST_PROFILE_LIST) {
      const executed = new Set(scenarios.flatMap((facts) => (
        assessHostCompatibility(facts, profile).findings.map(({ ruleId }) => ruleId)
      )));
      expect([...executed].sort(), profile.id).toEqual(profile.rules.map(({ id }) => id).sort());
    }
  });

  it('supports every declarative condition operator with three-valued logic', () => {
    expect(evaluateCondition({
      fact: 'authorization.schemes',
      operator: 'contains-all',
      value: ['oauth'],
    }, oauthProtectedServerFixture)).toBe(true);
    expect(evaluateCondition({
      not: { fact: 'transport.kind', operator: 'equals', value: 'legacy-sse' },
    }, publicServerFixture)).toBe(true);
    expect(evaluateCondition({
      any: [
        { fact: 'transport.kind', operator: 'equals', value: 'legacy-sse' },
        { fact: 'transport.kind', operator: 'equals', value: 'streamable-http' },
      ],
    }, publicServerFixture)).toBe(true);

    const unknown = cloneFacts(publicServerFixture);
    unknown.protocol.era = unknownFact('Protocol negotiation did not finish.');
    expect(evaluateCondition({
      all: [
        { fact: 'transport.kind', operator: 'equals', value: 'streamable-http' },
        { fact: 'protocol.era', operator: 'equals', value: '2026' },
      ],
    }, unknown)).toBe('unknown');
  });

  it('rejects unsupported fact schema versions explicitly', () => {
    const facts = cloneFacts(publicServerFixture);
    (facts as { schemaVersion: string }).schemaVersion = '2.0';

    expect(() => assessHostCompatibility(facts, 'claude')).toThrow(
      `Unsupported observed facts schema version 2.0; expected ${COMPATIBILITY_SCHEMA_VERSION}.`
    );
  });
});
