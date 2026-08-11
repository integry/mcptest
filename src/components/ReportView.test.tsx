import { describe, expect, it } from 'vitest';
import type { EvaluationReport } from '../utils/evaluation';
import {
  getAuthorizationGateOptions,
  getOAuthTraceForEvaluation,
  getStaticCredentialHeaders,
} from './ReportView';
import { createOAuthFlightRecorder } from '../utils/oauthTrace';

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

  it.each([
    ['x-api-key', { 'x-api-key': 'secret-value' }],
    ['api-key', { 'api-key': 'secret-value' }],
    ['authorization', { Authorization: 'ApiKey secret-value' }],
  ] as const)('uses the selected %s API-key delivery for an unknown challenge', (header, expected) => {
    expect(getStaticCredentialHeaders(
      challengedReport('Proprietary realm="mcp"'),
      'api-key',
      'secret-value',
      header
    )).toEqual(expected);
  });
});

describe('report authorization alternatives', () => {
  it('offers guided OAuth alongside bearer entry for a legacy Bearer-only target', () => {
    expect(getAuthorizationGateOptions(challengedReport('Bearer'))).toEqual({
      offersOAuth: true,
      staticSchemes: ['bearer'],
      isUnknown: false,
    });
  });

  it('keeps every choice exposed for a multi-challenge target', () => {
    expect(getAuthorizationGateOptions(
      challengedReport('Bearer, ApiKey')
    )).toEqual({
      offersOAuth: true,
      staticSchemes: ['bearer', 'api-key'],
      isUnknown: false,
    });
  });
});

describe('report OAuth trace correlation', () => {
  it('excludes a target trace that was not created or continued by the current evaluation', () => {
    sessionStorage.clear();
    const report = challengedReport('Bearer realm="mcp"');
    const recorder = createOAuthFlightRecorder({
      targetUrl: report.serverUrl,
      storage: sessionStorage,
      startedAt: '2026-08-11T20:00:00.000Z',
    });
    recorder.record({
      type: 'target_challenge',
      outcome: 'challenged',
      timestamp: '2026-08-11T20:00:00.000Z',
      provenance: 'direct_target',
      route: 'direct',
      explanation: 'Historical challenge.',
    });

    expect(getOAuthTraceForEvaluation(
      report,
      Date.parse('2026-08-11T21:00:00.000Z'),
      sessionStorage
    )).toBeUndefined();
    expect(getOAuthTraceForEvaluation(
      report,
      Date.parse('2026-08-11T19:00:00.000Z'),
      sessionStorage
    )?.traceId).toBe(recorder.snapshot().traceId);
  });
});
