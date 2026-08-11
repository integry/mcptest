import React from 'react';
import { renderToStaticMarkup } from 'react-dom/server';
import { describe, expect, it } from 'vitest';
import type { EvaluationReport } from '../utils/evaluation';
import ReleaseReadinessReport from './ReleaseReadinessReport';

const authorizationReport: EvaluationReport = {
  serverUrl: 'https://oauth.example/mcp',
  outcome: 'authorization-required',
  finalScore: 0,
  sections: {
    auth: {
      name: 'Authorization required',
      description: 'OAuth authorization is a prerequisite',
      score: 0,
      maxScore: 0,
      details: [{ text: '⚠ OAuth authorization required' }],
    },
  },
};

describe('ReleaseReadinessReport', () => {
  it('renders the primary hierarchy and never exposes a score behind the authorization gate', () => {
    const markup = renderToStaticMarkup(
      <ReleaseReadinessReport
        report={authorizationReport}
        expandedItems={new Set()}
        onToggleItem={() => undefined}
      />
    );
    const container = document.createElement('div');
    container.innerHTML = markup;

    expect(container.textContent).toContain('Can I ship?');
    expect(container.textContent).toContain('What blocks me?');
    expect(container.textContent).toContain('Fix first:');
    expect(container.textContent).toContain('Host compatibility');
    expect(container.textContent).toContain('OAuth flight recorder');
    expect(container.textContent).toContain('Tool surface, context, and risk');
    expect(container.textContent).not.toContain('Final Score');
    expect(container.textContent).not.toContain('grade');
  });

  it('labels an expected OAuth challenge as a step instead of an error', () => {
    const markup = renderToStaticMarkup(
      <ReleaseReadinessReport
        report={authorizationReport}
        expandedItems={new Set()}
        onToggleItem={() => undefined}
        oauthTrace={{
          version: 1,
          traceId: 'trace-1',
          targetFingerprint: 'fingerprint',
          targetUrl: authorizationReport.serverUrl,
          startedAt: '2026-08-11T20:02:00.000Z',
          events: [{
            sequence: 1,
            type: 'target_challenge',
            outcome: 'challenged',
            timestamp: '2026-08-11T20:02:00.000Z',
            provenance: 'direct_target',
            route: 'direct',
            explanation: 'The MCP target requested authorization.',
          }],
        }}
      />
    );

    expect(markup).toContain('Required step');
    expect(markup).not.toContain('OAuth error');
    expect(markup).toContain('View raw trace (redacted)');
  });
});
