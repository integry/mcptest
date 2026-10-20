import React from 'react';
import { renderToStaticMarkup } from 'react-dom/server';
import { describe, expect, it } from 'vitest';
import type { EvaluationReport } from '../utils/evaluation';
import ReleaseReadinessReport from './ReleaseReadinessReport';
import { createCapabilityInventory } from '../utils/capabilityInventory';
import { HOST_IDS } from '../compatibility';
import { getClientCompatibilityForHost } from '../data/clientCompatibility';

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

    expect(container.textContent).toContain('Evaluation incomplete');
    expect(container.textContent).toContain('What blocks me?');
    expect(container.textContent).toContain('Fix first:');
    expect(container.textContent).toContain('Host compatibility');
    expect(container.textContent).toContain('OAuth flight recorder');
    expect(container.textContent).toContain('Tool surface, context, and risk');
    expect(container.textContent).not.toContain('Final Score');
    expect(container.textContent).not.toContain('grade');
  });

  it('cites the client data behind every host compatibility verdict', () => {
    const markup = renderToStaticMarkup(
      <ReleaseReadinessReport
        report={authorizationReport}
        expandedItems={new Set()}
        onToggleItem={() => undefined}
      />
    );
    const container = document.createElement('div');
    container.innerHTML = markup;
    const citations = [...container.querySelectorAll('.compatibility-citation')];

    expect(citations).toHaveLength(HOST_IDS.length);
    HOST_IDS.forEach((hostId, index) => {
      const client = getClientCompatibilityForHost(hostId);
      const link = citations[index].querySelector('a');
      expect(link?.getAttribute('href')).toBe(client.documentationUrl);
      expect(link?.textContent).toBe(client.name);
      expect(citations[index].textContent).toContain(`verified ${client.verifiedOn}`);
    });
    expect(citations[HOST_IDS.indexOf('vscode-copilot')].textContent)
      .toBe('Client data: VS Code with GitHub Copilot 1.142, verified 2026-10-20');
  });

  it('links a documented priority id to its reference section and leaves other priorities unlinked', () => {
    const report: EvaluationReport = {
      serverUrl: 'https://tools.example/mcp',
      outcome: 'scored',
      finalScore: 10,
      sections: {
        protocol: {
          name: 'Protocol',
          description: 'Protocol checks',
          score: 10,
          maxScore: 10,
          details: [{ text: '✓ Connected' }],
        },
      },
      outputContracts: {
        checkedToolCount: 1,
        passingTools: [],
        violatingTools: [{
          toolName: 'weather',
          violations: [{ path: 'structuredContent.city', message: 'Expected string but got number.' }],
          omittedViolationCount: 0,
        }],
      },
    };
    const container = document.createElement('div');
    container.innerHTML = renderToStaticMarkup(
      <ReleaseReadinessReport report={report} expandedItems={new Set()} onToggleItem={() => undefined} />
    );

    const priorities = [...container.querySelectorAll('.release-priority')];
    const contract = priorities.find((item) => item.textContent?.includes('declared output schema'));
    const link = contract?.querySelector<HTMLAnchorElement>('.release-priority-meta a');
    expect(link?.getAttribute('href'))
      .toBe('/learn/mcp-transport-diagnostics-reference#tool-output-contract-violation');
    expect(link?.textContent).toBe('tool.output-contract-violation Learn more');
    for (const item of priorities.filter((entry) => entry !== contract)) {
      expect(item.querySelector('.release-priority-meta a')).toBeNull();
    }
  });

  it('links an expanded transport diagnostic to its reference section', () => {
    const report: EvaluationReport = {
      serverUrl: 'https://tools.example/mcp',
      outcome: 'scored',
      finalScore: 10,
      sections: {
        transport: {
          name: 'Transport',
          description: 'Transport checks',
          score: 10,
          maxScore: 10,
          details: [{
            text: '⚠ Server does not offer a GET event stream (HTTP 405) (transport.get-stream-405)',
            context: 'Optional stream refused.',
            metadata: { transportDiagnostic: { id: 'transport.get-stream-405' } },
          }],
        },
      },
    };
    const container = document.createElement('div');
    container.innerHTML = renderToStaticMarkup(
      <ReleaseReadinessReport
        report={report}
        expandedItems={new Set(['protocol-transport-0'])}
        onToggleItem={() => undefined}
      />
    );

    const link = container.querySelector<HTMLAnchorElement>('#protocol-transport-0-body a');
    expect(link?.getAttribute('href'))
      .toBe('/learn/mcp-transport-diagnostics-reference#transport-get-stream-405');
    expect(container.querySelector('.protocol-evidence button a')).toBeNull();
  });

  it('links expanded output-contract evidence to its reference section', () => {
    const report: EvaluationReport = {
      serverUrl: 'https://tools.example/mcp',
      outcome: 'scored',
      finalScore: 10,
      sections: {
        capabilities: {
          name: 'Capabilities',
          description: 'Capability checks',
          score: 10,
          maxScore: 10,
          details: [{
            text: '✗ 1 of 1 checked tools broke their declared output contract',
            context: 'weather: structuredContent.city — Expected string but got number.',
            metadata: { method: 'tools/call', findingId: 'tool.output-contract-violation', violatingTools: ['weather'] },
          }],
        },
      },
    };
    const container = document.createElement('div');
    container.innerHTML = renderToStaticMarkup(
      <ReleaseReadinessReport
        report={report}
        expandedItems={new Set(['protocol-capabilities-0'])}
        onToggleItem={() => undefined}
      />
    );

    const link = container.querySelector<HTMLAnchorElement>('#protocol-capabilities-0-body a');
    expect(link?.getAttribute('href'))
      .toBe('/learn/mcp-transport-diagnostics-reference#tool-output-contract-violation');
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
