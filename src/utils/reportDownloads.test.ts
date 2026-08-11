import { describe, expect, it } from 'vitest';
import Ajv2020 from 'ajv/dist/2020';
import addFormats from 'ajv-formats';
import publicJsonSchema from '../../public/schemas/report/v2.schema.json';
import type { EvaluationReport } from './evaluation';
import { createCompatibilityMatrix, createReleaseDecision } from './releaseReadiness';
import { createReportDownload } from './reportDownloads';
import { analyzeToolSurface } from './toolSurfaceAnalysis';

const ajv = new Ajv2020({ allErrors: true, strict: false });
addFormats(ajv);
const validatePublishedSchema = ajv.compile(publicJsonSchema);

const report: EvaluationReport = {
  serverUrl: 'https://downloads.example/mcp?access_token=secret',
  outcome: 'authorization-required',
  finalScore: 0,
  sections: {
    auth: {
      name: 'Authorization required',
      description: 'Authorize before evaluating',
      score: 0,
      maxScore: 0,
      details: [{ text: '⚠ OAuth access_token=secret is required' }],
    },
  },
};

describe('report downloads', () => {
  it.each([
    ['json', '.json', 'application/json'],
    ['markdown', '.md', 'text/markdown'],
  ] as const)('creates a redacted %s download with the shared serializer', (format, extension, mimeType) => {
    const download = createReportDownload(report, format, '2026-08-11T20:02:00.000Z');

    expect(download.filename).toBe(`mcptest-downloads.example-report${extension}`);
    expect(download.mimeType).toBe(mimeType);
    expect(download.content).toContain('authorization-required');
    expect(download.content).toContain('REDACTED');
    expect(download.content).not.toContain('access_token=secret');
    expect(download.content).not.toContain('Final Score');
  });

  it.each(['json', 'markdown'] as const)('includes the unified release-readiness data in %s', (format) => {
    const toolSurfaceAnalysis = analyzeToolSurface({
      tools: [{ name: 'search', description: 'Search records', inputSchema: { type: 'object' } }],
      resources: [],
      prompts: [],
    });
    const reportWithAnalysis = { ...report, toolSurfaceAnalysis };
    const oauthTrace = {
      version: 1 as const,
      traceId: 'trace-download',
      targetFingerprint: 'fingerprint',
      targetUrl: report.serverUrl,
      startedAt: '2026-08-11T20:02:00.000Z',
      events: [{
        sequence: 1,
        type: 'target_challenge' as const,
        outcome: 'challenged' as const,
        timestamp: '2026-08-11T20:02:00.000Z',
        provenance: 'direct_target' as const,
        route: 'direct' as const,
        explanation: 'Bearer access_token=trace-secret was requested.',
        response: {
          status: 401,
          headers: { 'www-authenticate': 'Bearer resource_metadata="https://auth.example?access_token=trace-secret"' },
        },
      }],
    };
    const compatibilityMatrix = createCompatibilityMatrix(reportWithAnalysis, oauthTrace);
    const releaseDecision = createReleaseDecision(
      reportWithAnalysis,
      compatibilityMatrix,
      toolSurfaceAnalysis,
      oauthTrace
    );

    const download = createReportDownload(
      reportWithAnalysis,
      format,
      '2026-08-11T20:02:00.000Z',
      { releaseDecision, compatibilityMatrix, toolSurfaceAnalysis, oauthTrace }
    );

    expect(download.content).toContain(format === 'json' ? '"releaseDecision"' : '## Release readiness');
    expect(download.content).toContain(format === 'json' ? '"compatibility"' : '## Host compatibility');
    expect(download.content).toContain(format === 'json' ? '"toolSurfaceAnalysis"' : '## Tool surface analysis');
    expect(download.content).toContain(format === 'json' ? '"oauthTrace"' : '## OAuth trace (redacted)');
    expect(download.content).not.toContain('trace-secret');
    expect(download.content).not.toContain('Final Score');
    if (format === 'json') {
      expect(
        validatePublishedSchema(JSON.parse(download.content)),
        JSON.stringify(validatePublishedSchema.errors)
      ).toBe(true);
    }
  });
});
