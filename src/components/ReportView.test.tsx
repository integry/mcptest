import { describe, expect, it } from 'vitest';
import type { EvaluationReport } from '../utils/evaluation';
import { getStaticCredentialHeaders } from './ReportView';

const challengedReport = (challenge: string): EvaluationReport => ({
  serverUrl: 'https://auth.example/mcp',
  authenticationUrl: 'https://auth.example/mcp',
  outcome: 'authorization-required',
  finalScore: 0,
  sections: {
    auth: {
      name: 'Authorization required',
      description: 'Credential prerequisite',
      score: 0,
      maxScore: 0,
      details: [{
        text: 'Authorization required',
        metadata: {
          authenticationSource: 'target',
          responseHeaders: { 'WWW-Authenticate': challenge },
        },
      }],
    },
  },
});

describe('report static credential delivery', () => {
  it('uses the Authorization header and advertised scheme for an ApiKey challenge', () => {
    expect(getStaticCredentialHeaders(
      challengedReport('ApiKey realm="mcp"'),
      'api-key',
      'secret-value'
    )).toEqual({ Authorization: 'ApiKey secret-value' });
  });

  it('uses the x-api-key header for an x-api-key challenge', () => {
    expect(getStaticCredentialHeaders(
      challengedReport('x-api-key realm="mcp"'),
      'api-key',
      'secret-value'
    )).toEqual({ 'x-api-key': 'secret-value' });
  });
});
