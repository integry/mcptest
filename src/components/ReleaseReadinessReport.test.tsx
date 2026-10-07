import React from 'react';
import { renderToStaticMarkup } from 'react-dom/server';
import { describe, expect, it } from 'vitest';
import type { EvaluationReport } from '../utils/evaluation';
import ReleaseReadinessReport from './ReleaseReadinessReport';
import { createCapabilityInventory } from '../utils/capabilityInventory';

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
  it('renders safe capability names, summaries, provenance, and honest unavailable states', () => {
    const githubToken = `ghp_${'a'.repeat(36)}`;
    const stripeKey = `sk_live_${'b'.repeat(24)}`;
    const quotedSecret = 'quoted React secret';
    const report: EvaluationReport = {
      ...authorizationReport,
      capabilityInventory: createCapabilityInventory({
        observedAt: '2026-08-17T22:00:00.000Z',
        testedEndpoint: `https://oauth.example/mcp?sig=${stripeKey}`,
        route: 'direct',
        authentication: 'authenticated',
        statuses: {
          tools: 'complete', resources: 'unavailable', resourceTemplates: 'unsupported', prompts: 'partial',
        },
        paginationComplete: { prompts: false },
        discovered: {
          tools: [{ name: 'search_records', description: 'Search public records', inputSchema: {
            properties: {
              query: { type: 'string', description: `client_secret="${quotedSecret}"` },
            },
            required: ['query'],
          } }, { name: githubToken }],
          prompts: [{ name: 'summarize', arguments: [{ name: 'text', required: true }] }],
        },
      }),
    };
    const markup = renderToStaticMarkup(
      <ReleaseReadinessReport report={report} expandedItems={new Set()} onToggleItem={() => undefined} />
    );
    const container = document.createElement('div');
    container.innerHTML = markup;

    expect(container.querySelector('#release-capabilities-title')?.textContent).toBe('Capabilities provided');
    expect(container.textContent).toContain('search_records');
    expect(container.textContent).toContain('query · string · required');
    expect(container.textContent).toContain('Discovery was unavailable. This does not mean the server provides no capabilities.');
    expect(container.textContent).toContain('This server does not support this discovery method.');
    expect(container.textContent).toContain('authenticated discovery');
    expect(markup).toContain('[REDACTED]');
    for (const secret of [githubToken, stripeKey, quotedSecret]) {
      expect(markup).not.toContain(secret);
    }
  });

  it('distinguishes incomplete discovery from completed sanitized and bounded inventories', () => {
    const report: EvaluationReport = {
      ...authorizationReport,
      capabilityInventory: createCapabilityInventory({
        observedAt: '2026-08-17T22:00:00.000Z',
        testedEndpoint: 'https://oauth.example/mcp',
        route: 'direct',
        authentication: 'authenticated',
        statuses: {
          tools: 'complete', resources: 'complete', resourceTemplates: 'complete', prompts: 'partial',
        },
        paginationComplete: { prompts: false },
        discovered: {
          tools: [{ name: 'search_records', description: 'Use client_secret=not-public' }],
          resources: Array.from({ length: 101 }, (_, index) => ({ name: `Resource ${index}` })),
          resourceTemplates: [],
          prompts: [{ name: 'summarize' }],
        },
      }),
    };
    const markup = renderToStaticMarkup(
      <ReleaseReadinessReport report={report} expandedItems={new Set()} onToggleItem={() => undefined} />
    );
    const container = document.createElement('div');
    container.innerHTML = markup;
    const statuses = [...container.querySelectorAll('.capability-inventory-status')]
      .map((element) => element.textContent);

    expect(statuses).toContain(
      'Discovery completed; sanitized inventory: 1 retained of 1 observed. Capability details were sanitized for public display.'
    );
    expect(statuses).toContain(
      'Discovery completed; bounded inventory: 100 retained of 101 observed; 1 omitted.'
    );
    expect(statuses).toContain(
      'Partial discovery: 1 retained of 1 observed. More capabilities may exist.'
    );
  });

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

  it('labels an API-key target challenge as a required step instead of a failure', () => {
    const apiKeyReport: EvaluationReport = {
      ...authorizationReport,
      sections: {
        auth: {
          ...authorizationReport.sections.auth,
          description: 'Authorization is a prerequisite',
          details: [{ text: '⚠ Authorization required' }],
        },
      },
    };
    const markup = renderToStaticMarkup(
      <ReleaseReadinessReport
        report={apiKeyReport}
        expandedItems={new Set()}
        onToggleItem={() => undefined}
        oauthTrace={{
          version: 1,
          traceId: 'trace-api-key',
          targetFingerprint: 'fingerprint',
          targetUrl: apiKeyReport.serverUrl,
          startedAt: '2026-08-11T20:02:00.000Z',
          events: [{
            sequence: 1,
            type: 'target_challenge',
            outcome: 'challenged',
            timestamp: '2026-08-11T20:02:00.000Z',
            provenance: 'direct_target',
            route: 'direct',
            explanation: 'The MCP target requested an API key.',
            response: {
              status: 401,
              headers: { 'www-authenticate': 'ApiKey realm="mcp"' },
            },
          }],
        }}
      />
    );

    expect(markup).toContain('oauth-step-expected');
    expect(markup).toContain('API key required');
    expect(markup).not.toContain('oauth-step-failed');
    expect(markup).not.toContain('Needs attention');
  });

  it('does not present an authenticated-proxy challenge as a required OAuth step', () => {
    const markup = renderToStaticMarkup(
      <ReleaseReadinessReport
        report={{ ...authorizationReport, outcome: 'failed' }}
        expandedItems={new Set()}
        onToggleItem={() => undefined}
        oauthTrace={{
          version: 1,
          traceId: 'trace-proxy',
          targetFingerprint: 'fingerprint',
          targetUrl: authorizationReport.serverUrl,
          startedAt: '2026-08-11T20:02:00.000Z',
          events: [{
            sequence: 1,
            type: 'target_challenge',
            outcome: 'challenged',
            timestamp: '2026-08-11T20:02:00.000Z',
            provenance: 'authenticated_proxy',
            route: 'proxy',
            explanation: 'The proxy requested access.',
          }],
        }}
      />
    );

    expect(markup).toContain('Authenticated proxy requested access');
    expect(markup).toContain('Proxy access required');
    expect(markup).not.toContain('Required step');
  });

  it('keeps a failed target challenge visibly actionable', () => {
    const markup = renderToStaticMarkup(
      <ReleaseReadinessReport
        report={authorizationReport}
        expandedItems={new Set()}
        onToggleItem={() => undefined}
        oauthTrace={{
          version: 1,
          traceId: 'trace-failed-challenge',
          targetFingerprint: 'fingerprint',
          targetUrl: authorizationReport.serverUrl,
          startedAt: '2026-08-11T20:02:00.000Z',
          events: [{
            sequence: 1,
            type: 'target_challenge',
            outcome: 'failed',
            timestamp: '2026-08-11T20:02:00.000Z',
            provenance: 'direct_target',
            route: 'direct',
            explanation: 'The target challenge could not be processed.',
          }],
        }}
      />
    );

    expect(markup).toContain('oauth-step-failed');
    expect(markup).toContain('Needs attention');
    expect(markup).not.toContain('Required step');
  });

  it('does not present an unexpected metadata-discovery challenge as a required step', () => {
    const markup = renderToStaticMarkup(
      <ReleaseReadinessReport
        report={authorizationReport}
        expandedItems={new Set()}
        onToggleItem={() => undefined}
        oauthTrace={{
          version: 1,
          traceId: 'trace-unexpected-challenge',
          targetFingerprint: 'fingerprint',
          targetUrl: authorizationReport.serverUrl,
          startedAt: '2026-08-11T20:02:00.000Z',
          events: [{
            sequence: 1,
            type: 'authorization_server_metadata',
            outcome: 'challenged',
            timestamp: '2026-08-11T20:02:00.000Z',
            provenance: 'authorization_server',
            route: 'direct',
            explanation: 'Metadata discovery received an unexpected challenge.',
          }],
        }}
      />
    );

    expect(markup).toContain('oauth-step-failed');
    expect(markup).toContain('Needs attention');
    expect(markup).not.toContain('Required step');
  });
});
