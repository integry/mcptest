import { describe, expect, it } from 'vitest';
import type { EvaluationReport } from './evaluation';
import type { OAuthTraceV1 } from './oauthTrace';
import { analyzeToolSurface } from './toolSurfaceAnalysis';
import {
  createCompatibilityMatrix,
  createObservedServerFacts,
  createReleaseDecision,
} from './releaseReadiness';

const evaluatedReport = (overrides: Partial<EvaluationReport> = {}): EvaluationReport => ({
  serverUrl: 'https://release.example/mcp',
  outcome: 'scored',
  finalScore: 70,
  sections: {
    protocol: {
      name: 'Core protocol',
      description: 'Protocol negotiation',
      score: 15,
      maxScore: 15,
      details: [{
        text: '✓ Negotiated MCP',
        metadata: {
          protocolEra: 'modern',
          protocolVersion: '2026-07-28',
          transportType: 'streamable-http',
          route: 'direct',
          unauthenticatedTargetRequestSucceeded: true,
        },
      }],
    },
    capabilities: {
      name: 'Capabilities',
      description: 'Discovery methods',
      score: 10,
      maxScore: 10,
      details: [
        { text: '✓ tools/list succeeded (1 tools)', metadata: { method: 'tools/list' } },
        { text: '✓ resources/list succeeded (0 resources)', metadata: { method: 'resources/list' } },
        { text: '✓ prompts/list succeeded (0 prompts)', metadata: { method: 'prompts/list' } },
      ],
    },
    transport: {
      name: 'Transport',
      description: 'Transport negotiation',
      score: 15,
      maxScore: 15,
      details: [{ text: '✓ Streamable HTTP', metadata: { transportType: 'streamable-http' } }],
    },
    cors: {
      name: 'Browser access',
      description: 'Direct browser access',
      score: 15,
      maxScore: 15,
      details: [{ text: '✓ Direct browser MCP negotiation succeeded' }],
    },
    performance: {
      name: 'Performance',
      description: 'Connection timing',
      score: 15,
      maxScore: 15,
      details: [{ text: '✓ excellent negotiation time: 100ms', metadata: { durationMs: 100 } }],
    },
  },
  toolSurfaceAnalysis: analyzeToolSurface({
    tools: [{ name: 'search_docs', description: 'Search documentation by query', inputSchema: { type: 'object', properties: { query: { type: 'string', description: 'Search query' } }, required: ['query'] } }],
    resources: [],
    prompts: [],
  }),
  ...overrides,
});

describe('release readiness integration', () => {
  it('keeps session behavior unknown when only a protocol era was observed', () => {
    const facts = createObservedServerFacts(evaluatedReport());

    expect(facts.transport.kind.value).toBe('streamable-http');
    expect(facts.protocol.era.value).toBe('2026');
    expect(facts.protocol.sessionBehavior.value).toBe('unknown');
    expect(facts.authorization.requirement.value).toBe('none');
    expect(facts.capabilities.tools.value).toBe('present');
    expect(facts.environment.directAccess.value).toBe('reachable');
  });

  it('marks session behavior stateful from observed MCP-Session-Id evidence', () => {
    const report = evaluatedReport();
    report.sections.protocol.details[0].metadata = {
      ...(report.sections.protocol.details[0].metadata as Record<string, unknown>),
      responseHeaders: { 'MCP-Session-Id': '[REDACTED]' },
    };

    const sessionBehavior = createObservedServerFacts(report).protocol.sessionBehavior;

    expect(sessionBehavior.value).toBe('stateful');
    expect(sessionBehavior.evidence[0].description).toContain('MCP-Session-Id');
  });

  it('keeps a modern transport era unknown without an explicit protocol version', () => {
    const report = evaluatedReport();
    const metadata = report.sections.protocol.details[0].metadata as Record<string, unknown>;
    delete metadata.protocolVersion;

    expect(createObservedServerFacts(report).protocol.era.value).toBe('unknown');
  });

  it('derives the 2025 era from an explicit negotiated protocol version', () => {
    const report = evaluatedReport();
    report.sections.protocol.details[0].metadata = {
      ...(report.sections.protocol.details[0].metadata as Record<string, unknown>),
      protocolVersion: '2025-11-25',
    };

    expect(createObservedServerFacts(report).protocol.era.value).toBe('2025');
  });

  it.each([
    ['cached OAuth', 'oauth', 'cached-oauth'],
    ['bearer retry', 'bearer', 'target-header'],
    ['API-key retry', 'api-key', 'target-header'],
  ] as const)('keeps authorization unknown after a successful authenticated %s evaluation', (
    _label,
    scheme,
    provenance
  ) => {
    const report = evaluatedReport();
    report.sections.protocol.details[0].metadata = {
      protocolEra: 'modern',
      protocolVersion: '2026-07-28',
      transportType: 'streamable-http',
      route: 'direct',
      authorizationSchemes: [scheme],
      authorizationCredentialProvenance: [provenance],
    };

    const authorization = createObservedServerFacts(report).authorization;
    expect(authorization.schemes.value).toEqual([scheme]);
    expect(authorization.requirement.value).toBe('unknown');
  });

  it.each([
    ['bearer', '⚠ Bearer credential is required', 'bearer', 'bearer token'],
    ['API key', '⚠ API key is required', 'api-key', 'API key'],
  ] as const)('preserves %s protected-server schemes as compatibility evidence', (_label, text, scheme, remediation) => {
    const report = evaluatedReport({
      outcome: 'authorization-required',
      finalScore: 0,
      sections: {
        auth: { name: 'Authorization', description: 'Credential required', score: 0, maxScore: 0, details: [{ text }] },
      },
    });

    expect(createObservedServerFacts(report).authorization.schemes.value).toEqual([scheme]);
    expect(createReleaseDecision(report, createCompatibilityMatrix(report)).priorities[0].remediation)
      .toContain(remediation);
  });

  it('keeps unperformed OAuth checks unknown behind the authorization gate', () => {
    const report = evaluatedReport({
      outcome: 'authorization-required',
      finalScore: 0,
      sections: {
        auth: {
          name: 'Authorization',
          description: 'OAuth prerequisite',
          score: 0,
          maxScore: 0,
          details: [{ text: '⚠ OAuth authorization required' }],
        },
      },
      toolSurfaceAnalysis: undefined,
    });

    const oauth = createObservedServerFacts(report).authorization.oauth;

    expect(oauth.protectedResourceMetadata.value).toBe('unknown');
    expect(oauth.authorizationServerMetadata.value).toBe('unknown');
    expect(oauth.pkceS256.value).toBe('unknown');
  });

  it('uses explicit completed OAuth negatives instead of treating every absence as failure', () => {
    const report = evaluatedReport({
      sections: {
        ...evaluatedReport().sections,
        security: {
          name: 'Security',
          description: 'OAuth metadata',
          score: 0,
          maxScore: 40,
          details: [
            { text: '⚠ OAuth protected-resource metadata not available' },
            { text: '✗ Authorization-server metadata not available' },
            { text: '✗ PKCE S256 support not advertised' },
          ],
        },
      },
    });

    const oauth = createObservedServerFacts(report).authorization.oauth;
    expect(oauth.protectedResourceMetadata.value).toBe(false);
    expect(oauth.authorizationServerMetadata.value).toBe(false);
    expect(oauth.pkceS256.value).toBe(false);
  });

  it('keeps operational OAuth trace failures unknown without a conclusive response', () => {
    const report = evaluatedReport();
    const trace: OAuthTraceV1 = {
      version: 1,
      traceId: 'failed-discovery',
      targetFingerprint: 'fingerprint',
      targetUrl: report.serverUrl,
      startedAt: '2026-08-11T20:02:00.000Z',
      events: [{
        sequence: 1,
        type: 'authorization_server_metadata' as const,
        outcome: 'failed' as const,
        timestamp: '2026-08-11T20:02:00.000Z',
        provenance: 'authorization_server' as const,
        route: 'direct' as const,
        explanation: 'The request did not receive an HTTP response.',
      }],
    };

    expect(createObservedServerFacts(report, trace).authorization.oauth.authorizationServerMetadata.value)
      .toBe('unknown');
  });

  it('describes successful refresh and dynamic-registration observations as established', () => {
    const report = evaluatedReport();
    const trace: OAuthTraceV1 = {
      version: 1,
      traceId: 'successful-oauth-operations',
      targetFingerprint: 'fingerprint',
      targetUrl: report.serverUrl,
      startedAt: '2026-08-11T20:02:00.000Z',
      events: ['refresh', 'dynamic_client_registration'].map((type, index) => ({
        sequence: index + 1,
        type: type as 'refresh' | 'dynamic_client_registration',
        outcome: 'succeeded' as const,
        timestamp: '2026-08-11T20:02:00.000Z',
        provenance: 'authorization_server' as const,
        route: 'direct' as const,
        explanation: `${type} succeeded.`,
      })),
    };

    const oauth = createObservedServerFacts(report, trace).authorization.oauth;
    expect(oauth.refreshTokens.value).toBe(true);
    expect(oauth.refreshTokens.evidence[0].description).toContain('succeeded');
    expect(oauth.dynamicRedirectRegistration.value).toBe(true);
    expect(oauth.dynamicRedirectRegistration.evidence[0].description).toContain('succeeded');
  });

  it('preserves OAuth and static-token paths for a legacy Bearer-only OAuth target', () => {
    const report = evaluatedReport({
      outcome: 'authorization-required',
      finalScore: 0,
      sections: {
        auth: {
          name: 'Authorization',
          description: 'Credential prerequisite',
          score: 0,
          maxScore: 0,
          details: [{
            text: '⚠ Authorization required',
            metadata: {
              authenticationSource: 'target',
              responseHeaders: { 'WWW-Authenticate': 'Bearer' },
            },
          }],
        },
      },
    });

    const facts = createObservedServerFacts(report);
    expect(facts.authorization.schemes.value).toEqual(['bearer', 'oauth']);
    expect(facts.authorization.oauth.protectedResourceMetadata.value).toBe('unknown');
    const remediation = createReleaseDecision(report, createCompatibilityMatrix(report))
      .priorities[0].remediation;
    expect(remediation).toContain('guided OAuth');
    expect(remediation).toContain('bearer token');
  });

  it('preserves every advertised alternative from a multi-challenge target', () => {
    const report = evaluatedReport({
      outcome: 'authorization-required',
      finalScore: 0,
      sections: {
        auth: {
          name: 'Authorization',
          description: 'Credential prerequisite',
          score: 0,
          maxScore: 0,
          details: [{
            text: '⚠ Authorization required',
            metadata: {
              authenticationSource: 'target',
              responseHeaders: {
                'WWW-Authenticate': 'Bearer, ApiKey',
              },
            },
          }],
        },
      },
    });

    const facts = createObservedServerFacts(report);
    expect(facts.authorization.schemes.value).toEqual(['bearer', 'oauth', 'api-key']);
    const remediation = createReleaseDecision(report, createCompatibilityMatrix(report))
      .priorities[0].remediation;
    expect(remediation).toContain('guided OAuth');
    expect(remediation).toContain('bearer token');
    expect(remediation).toContain('API key');
  });

  it('ignores proxy-only traces when deriving target authorization facts', () => {
    const report = evaluatedReport({ outcome: 'failed' });
    delete (report.sections.protocol.details[0].metadata as Record<string, unknown>)
      .unauthenticatedTargetRequestSucceeded;
    const facts = createObservedServerFacts(report, {
      version: 1,
      traceId: 'proxy-trace',
      targetFingerprint: 'fingerprint',
      targetUrl: report.serverUrl,
      startedAt: '2026-08-11T20:02:00.000Z',
      events: [{
        sequence: 1,
        type: 'target_challenge',
        outcome: 'challenged',
        timestamp: '2026-08-11T20:02:00.000Z',
        provenance: 'authenticated_proxy',
        route: 'proxy',
        explanation: 'The proxy requested its own credential.',
        response: { status: 401, headers: { 'www-authenticate': 'Bearer realm="proxy"' } },
      }],
    });

    expect(facts.authorization.schemes.value).toBe('unknown');
    expect(facts.authorization.requirement.value).toBe('unknown');
  });

  it('does not let a historical target challenge override current unauthenticated success', () => {
    const report = evaluatedReport();
    const facts = createObservedServerFacts(report, {
      version: 1,
      traceId: 'historical-target-trace',
      targetFingerprint: 'fingerprint',
      targetUrl: report.serverUrl,
      startedAt: '2026-08-10T20:02:00.000Z',
      events: [{
        sequence: 1,
        type: 'target_challenge',
        outcome: 'challenged',
        timestamp: '2026-08-10T20:02:00.000Z',
        provenance: 'direct_target',
        route: 'direct',
        explanation: 'A previous evaluation received a challenge.',
        response: { status: 401, headers: { 'www-authenticate': 'Bearer realm="mcp"' } },
      }],
    });

    expect(facts.authorization.schemes.value).toEqual([]);
    expect(facts.authorization.requirement.value).toBe('none');
  });

  it('keeps the authorization prerequisite unscored and ahead of every other decision', () => {
    const report = evaluatedReport({
      outcome: 'authorization-required',
      finalScore: 0,
      sections: {
        auth: { name: 'Authorization required', description: 'OAuth required', score: 0, maxScore: 0, details: [{ text: '⚠ OAuth authorization required' }] },
      },
      toolSurfaceAnalysis: undefined,
    });
    const decision = createReleaseDecision(report, createCompatibilityMatrix(report));

    expect(decision.status).toBe('authorization-required');
    expect(decision.answer).toContain('authorization is required');
    expect(decision.priorities[0].remediation).toContain('OAuth');
  });

  it('treats proxy login as unscored infrastructure access, not target authorization', () => {
    const report = evaluatedReport({
      outcome: 'authorization-required',
      authenticationRequirement: { kind: 'proxy', status: 401 },
      finalScore: 0,
      sections: {
        auth: {
          name: 'Proxy Authentication Required',
          description: 'mcptest login required',
          score: 0,
          maxScore: 0,
          status: 'skipped',
          details: [{ text: 'Sign in to mcptest again.' }],
        },
      },
      toolSurfaceAnalysis: undefined,
    });
    const facts = createObservedServerFacts(report);
    const decision = createReleaseDecision(report, createCompatibilityMatrix(report));

    expect(facts.authorization.requirement.value).toBe('unknown');
    expect(facts.authorization.requirement.evidence[0].description).toContain('Proxy login');
    expect(decision.status).toBe('unknown');
    expect(decision.answer).toContain('mcptest login');
    expect(decision.priorities[0].title).toBe('Sign in to mcptest');
    expect(JSON.stringify(decision)).not.toContain('Complete server authorization');
  });

  it('returns a distinct unknown decision for a partial evaluation', () => {
    const report = evaluatedReport({ outcome: 'partial' });
    const decision = createReleaseDecision(report, createCompatibilityMatrix(report));

    expect(decision.status).toBe('unknown');
    expect(decision.answer).toContain('partial');
  });

  it('keeps a confirmed blocker ahead of unknowns in a partial evaluation', () => {
    const report = evaluatedReport({
      outcome: 'partial',
      toolSurfaceAnalysis: analyzeToolSurface({
        tools: [{
          name: 'delete_account',
          description: 'Permanently delete an account.',
          inputSchema: { type: 'object' },
        }],
      }),
    });
    const decision = createReleaseDecision(report, createCompatibilityMatrix(report));

    expect(decision.status).toBe('blocked');
    expect(decision.answer).toContain('fix blockers first');
    expect(decision.priorities).toEqual(expect.arrayContaining([
      expect.objectContaining({ severity: 'high', source: 'Tool surface' }),
    ]));
  });
});
