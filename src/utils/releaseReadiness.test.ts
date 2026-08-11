import { describe, expect, it } from 'vitest';
import type { EvaluationReport } from './evaluation';
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
  it('builds compatibility facts for a stateless public Streamable HTTP report', () => {
    const facts = createObservedServerFacts(evaluatedReport());

    expect(facts.transport.kind.value).toBe('streamable-http');
    expect(facts.protocol.era.value).toBe('2026');
    expect(facts.protocol.sessionBehavior.value).toBe('stateless');
    expect(facts.authorization.requirement.value).toBe('none');
    expect(facts.capabilities.tools.value).toBe('present');
    expect(facts.environment.directAccess.value).toBe('reachable');
  });

  it.each([
    ['bearer', '⚠ Bearer credential is required', 'bearer'],
    ['API key', '⚠ API key is required', 'api-key'],
  ] as const)('preserves %s protected-server schemes as compatibility evidence', (_label, text, scheme) => {
    const report = evaluatedReport({
      outcome: 'authorization-required',
      finalScore: 0,
      sections: {
        auth: { name: 'Authorization', description: 'Credential required', score: 0, maxScore: 0, details: [{ text }] },
      },
    });

    expect(createObservedServerFacts(report).authorization.schemes.value).toEqual([scheme]);
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

  it('returns a distinct unknown decision for a partial evaluation', () => {
    const report = evaluatedReport({ outcome: 'partial' });
    const decision = createReleaseDecision(report, createCompatibilityMatrix(report));

    expect(decision.status).toBe('unknown');
    expect(decision.answer).toContain('partial');
  });
});

