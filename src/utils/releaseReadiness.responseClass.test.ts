import { describe, expect, it } from 'vitest';
import type { EvaluationReport } from './evaluation';
import { getReportBadgeVariant } from '../components/ReportBadgeEmbed';
import { createCompatibilityMatrix, createReleaseDecision } from './releaseReadiness';
import { classifyHttpResponse } from './responseClassification';
import { collectTransportDiagnostics, transportDiagnosticReportDetail } from './transportDiagnostics';

const ENDPOINT = 'https://paid.example/mcp';

/** A failed evaluation whose only target response is `status` with `headers`. */
const failedReport = (status: number, headers: Record<string, string>): EvaluationReport => {
  const responseClass = classifyHttpResponse({ status, headers });
  const diagnostics = collectTransportDiagnostics([{
    route: 'direct',
    requests: [{
      method: 'POST',
      mcpMethod: 'initialize',
      url: ENDPOINT,
      targetUrl: ENDPOINT,
      transportType: 'streamable-http',
      status,
      responseSource: 'target',
      ...(responseClass ? { responseClass } : {}),
    }],
  }], 'headless');
  return {
    serverUrl: ENDPOINT,
    outcome: 'failed',
    finalScore: 0,
    sections: {
      protocol: {
        name: 'Core protocol',
        description: 'Protocol negotiation',
        score: 0,
        maxScore: 15,
        status: 'failed',
        details: [
          { text: '✗ MCP negotiation failed' },
          ...diagnostics.map(transportDiagnosticReportDetail),
        ],
      },
    },
  } as EvaluationReport;
};

const decide = (report: EvaluationReport) => createReleaseDecision(report, createCompatibilityMatrix(report));

describe('release decision response classes', () => {
  it('reports a 402 as not scored with payment required, never as blocked', () => {
    const report = failedReport(402, { 'payment-required': 'eyJ4NDAyVmVyc2lvbiI6Mn0=' });
    const decision = decide(report);

    expect(decision.status).toBe('unknown');
    expect(decision.answer).toBe('Not scored — the server requires payment');
    expect(decision.priorities).toEqual([expect.objectContaining({
      id: 'transport.payment-required-402',
      severity: 'unknown',
      title: 'Server requires payment (HTTP 402)',
    })]);
    expect(decision.priorities[0].detail).toContain('payment-required: eyJ4NDAyVmVyc2lvbiI6Mn0=');
    expect(getReportBadgeVariant(report)).toBe('payment-required');
  });

  it('blocks release on bot protection and says what to change', () => {
    const decision = decide(failedReport(403, { 'cf-mitigated': 'challenge' }));

    expect(decision.status).toBe('blocked');
    expect(decision.priorities.slice(0, 2).map(({ id }) => id)).toEqual(['evaluation.negotiation-failed', 'transport.bot-protection-challenge']);
    expect(decision.priorities[0].title).toBe('Let MCP clients past bot protection');
    expect(decision.priorities[1]).toMatchObject({ severity: 'high', title: 'Bot protection is blocking MCP clients' });
    expect(decision.priorities[1].remediation).toContain('Exempt the MCP endpoint');
  });

  it('does not block release on a challenge 429 the automatic retry recovered', () => {
    const challenge = classifyHttpResponse({ status: 429, headers: { 'cf-mitigated': 'challenge', 'retry-after': '1' } });
    const initialize = {
      method: 'POST',
      mcpMethod: 'initialize',
      url: ENDPOINT,
      targetUrl: ENDPOINT,
      candidateUrl: ENDPOINT,
      transportType: 'streamable-http',
      responseSource: 'target',
    } as const;
    const diagnostics = collectTransportDiagnostics([{
      route: 'direct',
      requests: [
        { ...initialize, status: 429, retryAfter: '1', rateLimitRetry: { action: 'retried', waitMs: 1000 }, ...(challenge ? { responseClass: challenge } : {}) },
        { ...initialize, status: 200, responseContentType: 'application/json', automaticRetry: { reason: 'target-rate-limit', waitMs: 1000 } },
      ],
    }], 'headless');
    const report = {
      serverUrl: ENDPOINT,
      outcome: 'scored',
      finalScore: 15,
      sections: {
        protocol: {
          name: 'Core protocol',
          description: 'Protocol negotiation',
          score: 15,
          maxScore: 15,
          status: 'passed',
          details: [{ text: '✓ MCP negotiation succeeded' }, ...diagnostics.map(transportDiagnosticReportDetail)],
        },
      },
    } as unknown as EvaluationReport;

    const decision = decide(report);

    expect(challenge?.kind).toBe('bot-protection');
    expect(decision.status).not.toBe('blocked');
    expect(decision.priorities.find(({ id }) => id === 'transport.bot-protection-challenge'))
      .toMatchObject({ severity: 'medium' });
    expect(decision.priorities.some(({ severity }) => severity === 'high' || severity === 'critical')).toBe(false);
  });

  it('keeps the generic negotiation priority for an unclassified failure', () => {
    const decision = decide(failedReport(404, {}));

    expect(decision.status).toBe('blocked');
    expect(decision.priorities[0].title).toBe('Restore MCP negotiation');
  });
});
