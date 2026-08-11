import { describe, expect, it, vi } from 'vitest';
import type { EvaluationReport } from '../utils/evaluation';
import {
  REPORT_SCHEMA_VERSION,
  PublicReportSchema,
  REDACTED_VALUE,
} from '../utils/reportArtifact';
import type { ReleaseDecision } from '../utils/releaseReadiness';
import {
  RELEASE_GATE_EXIT_CODES,
  getReleaseGateThresholdReasons,
  runReleaseGate,
} from './releaseGate';

const evaluatedReport = (
  endpoint = 'https://fixture.example/mcp',
  transportType: 'streamable-http' | 'legacy-sse' = 'streamable-http',
  protocolEra: 'modern' | 'stateful' = 'modern'
): EvaluationReport => ({
  serverUrl: endpoint,
  outcome: 'scored',
  finalScore: transportType === 'streamable-http' ? 55 : 46,
  sections: {
    protocol: {
      name: 'Core Protocol', description: 'Protocol', score: 15, maxScore: 15,
      details: [{
        text: '✓ Negotiated MCP',
        metadata: {
          protocolEra,
          protocolVersion: protocolEra === 'modern' ? '2026-07-28' : '2025-11-25',
          endpoint,
          route: 'direct',
          evaluationRuntime: 'headless',
          unauthenticatedTargetRequestSucceeded: true,
        },
      }],
    },
    capabilities: {
      name: 'Capabilities', description: 'Discovery', score: 10, maxScore: 10,
      details: [
        { text: '✓ tools/list succeeded (0 tools)', metadata: { method: 'tools/list' } },
        { text: '✓ resources/list succeeded (0 resources)', metadata: { method: 'resources/list' } },
        { text: '✓ prompts/list succeeded (0 prompts)', metadata: { method: 'prompts/list' } },
      ],
    },
    transport: {
      name: 'Transport', description: 'Transport',
      score: transportType === 'streamable-http' ? 15 : 6, maxScore: 15,
      details: [{ text: '✓ Transport negotiated', metadata: { transportType, protocolEra, endpoint } }],
    },
    performance: {
      name: 'Performance', description: 'Timing', score: 15, maxScore: 15,
      details: [{ text: '✓ excellent', metadata: { durationMs: 25 } }],
    },
  },
});

const authorizationReport = (): EvaluationReport => ({
  serverUrl: 'https://auth.fixture.example/mcp',
  authenticationUrl: 'https://auth.fixture.example/mcp',
  outcome: 'authorization-required',
  finalScore: 0,
  sections: {
    auth: {
      name: 'Authorization Required', description: 'Authorize first', score: 0, maxScore: 0,
      details: [{
        text: '⚠ OAuth authorization required',
        metadata: {
          authenticationSource: 'target',
          responseHeaders: { 'www-authenticate': 'Bearer [REDACTED]' },
        },
      }],
    },
  },
});

describe('headless release gate', () => {
  it.each([
    ['stateless Streamable HTTP', 'streamable-http', 'modern'],
    ['stateful Streamable HTTP', 'streamable-http', 'stateful'],
    ['legacy SSE fallback', 'legacy-sse', 'stateful'],
  ] as const)('uses the shared report schema for %s', async (_label, transport, era) => {
    const evaluator = vi.fn(async () => evaluatedReport(undefined, transport, era));
    const result = await runReleaseGate({
      endpoints: ['https://fixture.example/mcp'],
      policy: { failOnResults: new Set(), failOnSeverity: 'none' },
      generatedAt: '2026-08-11T23:30:00.000Z',
    }, { evaluate: evaluator });

    expect(result.exitCode).toBe(RELEASE_GATE_EXIT_CODES.pass);
    expect(result.targets[0].report?.schemaVersion).toBe(REPORT_SCHEMA_VERSION);
    expect(result.targets[0].report?.transport?.type).toBe(transport);
    expect(PublicReportSchema.parse(JSON.parse(result.targets[0].json || '')))
      .toEqual(result.targets[0].report);
    expect(evaluator).toHaveBeenCalledWith(
      'https://fixture.example/mcp', '', expect.any(Function), null,
      undefined, undefined, { runtime: 'headless' }
    );
  });

  it('returns the distinct authorization-required exit and still emits artifacts', async () => {
    const result = await runReleaseGate({ endpoints: ['https://auth.fixture.example/mcp'] }, {
      evaluate: async () => authorizationReport(),
    });

    expect(result.exitCode).toBe(RELEASE_GATE_EXIT_CODES.authorizationRequired);
    expect(result.targets[0].status).toBe('authorization-required');
    expect(result.targets[0].report?.outcome.status).toBe('authorization-required');
    expect(result.targets[0].json).toContain('authorization-required');
    expect(result.targets[0].markdown).toContain('Authorization is a prerequisite');
  });

  it('redacts credentials even when a transport error includes them', async () => {
    const result = await runReleaseGate({
      endpoints: ['https://fixture.example/mcp'],
      headers: { 'X-API-Key': 'unlabelled-fixture-secret' },
    }, {
      evaluate: async () => {
        throw new Error('Transport rejected unlabelled-fixture-secret');
      },
    });

    expect(result.exitCode).toBe(RELEASE_GATE_EXIT_CODES.infrastructureFailure);
    expect(result.targets[0].error).toContain(REDACTED_VALUE);
    expect(result.targets[0].error).not.toContain('unlabelled-fixture-secret');
  });

  it('scrubs a supplied credential from arbitrary evaluator evidence before both artifacts', async () => {
    const secret = 'arbitrary-evidence-secret';
    const result = await runReleaseGate({
      endpoints: ['https://fixture.example/mcp'],
      headers: { Authorization: `Bearer ${secret}` },
      policy: { failOnResults: new Set(), failOnSeverity: 'none' },
    }, {
      evaluate: async () => {
        const report = evaluatedReport();
        report.sections.protocol.details[0].context = `Opaque SDK diagnostic ${secret}`;
        return report;
      },
    });

    expect(result.targets[0].json).toContain(REDACTED_VALUE);
    expect(result.targets[0].json).not.toContain(secret);
    expect(result.targets[0].markdown).not.toContain(secret);
  });

  it.each(['direct', 'scored'])('keeps gate semantics intact when the credential is %s', async (credential) => {
    const generatedAt = '2026-08-11T23:30:00.000Z';
    const evaluate = async () => {
      const report = evaluatedReport();
      report.sections.protocol.details[0].context = `Opaque SDK diagnostic ${credential}`;
      return report;
    };
    const baseline = await runReleaseGate({
      endpoints: ['https://fixture.example/mcp'],
      generatedAt,
    }, { evaluate });
    const result = await runReleaseGate({
      endpoints: ['https://fixture.example/mcp'],
      headers: { Authorization: `Bearer ${credential}` },
      generatedAt,
    }, { evaluate });

    expect(result.exitCode).toBe(baseline.exitCode);
    expect(result.targets[0].thresholdReasons).toEqual(baseline.targets[0].thresholdReasons);
    expect(result.targets[0].releaseDecision?.status)
      .toBe(baseline.targets[0].releaseDecision?.status);
    expect(result.targets[0].report?.outcome.status).toBe('scored');
    expect(result.targets[0].report?.provenance.route).toBe('direct');
    expect(result.targets[0].report?.transport?.type).toBe('streamable-http');
    expect(result.targets[0].report?.sections[0].evidence[0].context)
      .toBe(`Opaque SDK diagnostic ${REDACTED_VALUE}`);
    expect(PublicReportSchema.parse(JSON.parse(result.targets[0].json || '')))
      .toEqual(result.targets[0].report);
  });

  it('applies overall and severity thresholds without redefining release semantics', () => {
    const decision: ReleaseDecision = {
      status: 'review',
      answer: 'Review',
      summary: 'Review required',
      priorities: [
        { id: 'one', severity: 'high', title: 'High risk', detail: '', remediation: 'Fix', source: 'Tool surface' },
        { id: 'two', severity: 'medium', title: 'Medium risk', detail: '', remediation: 'Review', source: 'Tool surface' },
      ],
    };

    expect(getReleaseGateThresholdReasons(decision, {
      failOnResults: new Set(['review']), failOnSeverity: 'high',
    })).toEqual(['overall result is review', 'high finding: High risk']);
    expect(getReleaseGateThresholdReasons(decision, {
      failOnResults: new Set(), failOnSeverity: 'critical',
    })).toEqual([]);
  });

  it('numbers artifact names so repeated hosts cannot overwrite each other', async () => {
    const result = await runReleaseGate({
      endpoints: ['https://fixture.example/one', 'https://fixture.example/two'],
      policy: { failOnResults: new Set(), failOnSeverity: 'none' },
    }, { evaluate: async (endpoint) => evaluatedReport(endpoint) });

    expect(result.targets.map(({ filenameBase }) => filenameBase)).toEqual([
      '001-mcptest-fixture.example-report',
      '002-mcptest-fixture.example-report',
    ]);
  });
});
