import { describe, expect, it } from 'vitest';
import type { EvaluationReport } from './evaluation';
import { createReportDownload } from './reportDownloads';

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
});
