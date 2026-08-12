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
  releaseGateFilenameBase,
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

  it('rejects credential reuse across transports or origins before evaluation', async () => {
    const evaluate = vi.fn(async () => evaluatedReport());

    await expect(runReleaseGate({
      endpoints: ['http://fixture.example/mcp'],
      headers: { Authorization: 'Bearer fixture-secret' },
    }, { evaluate })).rejects.toThrow('Credentialed endpoints must use HTTPS.');
    await expect(runReleaseGate({
      endpoints: ['https://one.example/mcp', 'https://two.example/mcp'],
      headers: { 'X-API-Key': 'fixture-secret' },
    }, { evaluate })).rejects.toThrow('Credentialed runs require all endpoints to share one origin.');
    expect(evaluate).not.toHaveBeenCalled();
  });

  it.each([
    ['another origin', 'https://other.example/mcp'],
    ['plaintext HTTP', 'http://fixture.example/mcp'],
  ])('blocks a credentialed redirect to %s before sending the API key', async (
    _label,
    location
  ) => {
    const requests: Request[] = [];
    const fetchFn = vi.fn<typeof fetch>(async (input, init) => {
      const request = new Request(input, init);
      requests.push(request);
      return new Response(null, { status: 302, headers: { location } });
    });
    const result = await runReleaseGate({
      endpoints: ['https://fixture.example/mcp'],
      headers: { 'X-API-Key': 'redirect-fixture-secret' },
    }, {
      fetch: fetchFn,
      evaluate: async (endpoint, _firebaseToken, _progress, _oauthToken, headers) => {
        await fetch(endpoint, { method: 'POST', headers, body: '{}' });
        return evaluatedReport();
      },
    });

    expect(result.exitCode).toBe(RELEASE_GATE_EXIT_CODES.infrastructureFailure);
    expect(result.targets[0].error).toContain('blocked from redirecting');
    expect(fetchFn).toHaveBeenCalledTimes(1);
    expect(requests[0].url).toBe('https://fixture.example/mcp');
    expect(requests[0].redirect).toBe('manual');
    expect(requests[0].headers.get('x-api-key')).toBe('redirect-fixture-secret');
    expect(requests.some((request) => request.url === location)).toBe(false);
  });

  it('follows a same-origin HTTPS redirect with the API key', async () => {
    const requests: Request[] = [];
    const fetchFn = vi.fn<typeof fetch>(async (input, init) => {
      const request = new Request(input, init);
      requests.push(request);
      return request.url.endsWith('/mcp')
        ? new Response(null, { status: 307, headers: { location: '/redirected' } })
        : new Response('{}', { status: 200 });
    });
    const result = await runReleaseGate({
      endpoints: ['https://fixture.example/mcp'],
      headers: { 'X-API-Key': 'same-origin-fixture-secret' },
      policy: { failOnResults: new Set(), failOnSeverity: 'none' },
    }, {
      fetch: fetchFn,
      evaluate: async (endpoint, _firebaseToken, _progress, _oauthToken, headers) => {
        await fetch(endpoint, { method: 'POST', headers, body: '{}' });
        return evaluatedReport();
      },
    });

    expect(result.exitCode).toBe(RELEASE_GATE_EXIT_CODES.pass);
    expect(requests.map((request) => request.url)).toEqual([
      'https://fixture.example/mcp',
      'https://fixture.example/redirected',
    ]);
    expect(requests[1].headers.get('x-api-key')).toBe('same-origin-fixture-secret');
    expect(await requests[1].text()).toBe('{}');
  });

  it('preserves normal redirects for uncredentialed discovery during a credentialed evaluation', async () => {
    const requests: Request[] = [];
    const fetchFn = vi.fn<typeof fetch>(async (input, init) => {
      const request = new Request(input, init);
      requests.push(request);
      return request.redirect === 'follow'
        ? new Response('{"issuer":"https://fixture.example"}', { status: 200 })
        : new Response(null, { status: 302, headers: { location: '/oauth-metadata' } });
    });
    const result = await runReleaseGate({
      endpoints: ['https://fixture.example/mcp'],
      headers: { Authorization: 'Bearer credentialed-evaluation-secret' },
      policy: { failOnResults: new Set(), failOnSeverity: 'none' },
    }, {
      fetch: fetchFn,
      evaluate: async () => {
        const response = await fetch('https://fixture.example/.well-known/oauth-protected-resource');
        expect(response.status).toBe(200);
        return evaluatedReport();
      },
    });

    expect(result.exitCode).toBe(RELEASE_GATE_EXIT_CODES.pass);
    expect(requests).toHaveLength(1);
    expect(requests[0].redirect).toBe('follow');
    expect(requests[0].headers.has('authorization')).toBe(false);
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

  it('scrubs credentials from evaluator evidence property names without losing collisions', async () => {
    const secret = 'opaque-evidence-marker';
    const result = await runReleaseGate({
      endpoints: ['https://fixture.example/mcp'],
      headers: { Authorization: `Bearer ${secret}` },
      policy: { failOnResults: new Set(), failOnSeverity: 'none' },
    }, {
      evaluate: async () => {
        const report = evaluatedReport();
        report.sections.protocol.details[0].metadata = {
          [REDACTED_VALUE]: 'existing redaction marker',
          [secret]: 'credential key',
          [`prefix-${secret}`]: 'embedded credential key',
        };
        return report;
      },
    });

    const metadata = result.targets[0].report?.sections[0].evidence[0].metadata;
    expect(metadata).toEqual({
      [REDACTED_VALUE]: 'existing redaction marker',
      [`${REDACTED_VALUE}#2`]: 'credential key',
      [`prefix-${REDACTED_VALUE}`]: 'embedded credential key',
    });
    expect(result.targets[0].json).not.toContain(secret);
    expect(result.targets[0].markdown).not.toContain(secret);
  });

  it('scrubs a protocol-version credential without changing compatibility or gate semantics', async () => {
    const secret = '2026-07-28';
    const evaluate = async () => evaluatedReport();
    const baseline = await runReleaseGate({
      endpoints: ['https://fixture.example/mcp'],
    }, { evaluate });
    const result = await runReleaseGate({
      endpoints: ['https://fixture.example/mcp'],
      headers: { Authorization: `Bearer ${secret}` },
    }, { evaluate });

    expect(result.exitCode).toBe(baseline.exitCode);
    expect(result.targets[0].thresholdReasons).toEqual(baseline.targets[0].thresholdReasons);
    expect(result.targets[0].releaseDecision?.status)
      .toBe(baseline.targets[0].releaseDecision?.status);
    expect(Object.values(result.targets[0].report?.compatibility?.assessments || {})
      .map((assessment) => assessment.status))
      .toEqual(Object.values(baseline.targets[0].report?.compatibility?.assessments || {})
        .map((assessment) => assessment.status));
    expect(result.targets[0].report?.protocol?.version).toBe(REDACTED_VALUE);
    expect(JSON.stringify(result.targets[0])).not.toContain(secret);
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

  it('preserves compatibility schema versions when the supplied credential is 1.0', async () => {
    const generatedAt = '2026-08-11T23:30:00.000Z';
    const options = {
      endpoints: ['https://fixture.example/mcp'],
      generatedAt,
    };
    const evaluate = async () => evaluatedReport();
    const baseline = await runReleaseGate(options, { evaluate });
    const result = await runReleaseGate({
      ...options,
      headers: { 'X-API-Key': '1.0' },
    }, { evaluate });

    expect(result.exitCode).toBe(baseline.exitCode);
    expect(result.targets[0].status).toBe(baseline.targets[0].status);
    expect(result.targets[0].thresholdReasons).toEqual(baseline.targets[0].thresholdReasons);
    expect(result.targets[0].releaseDecision).toEqual(baseline.targets[0].releaseDecision);
    expect(result.targets[0].report?.compatibility?.schemaVersion).toBe('1.0');
    const assessments = Object.values(
      result.targets[0].report?.compatibility?.assessments || {}
    );
    expect(assessments).not.toHaveLength(0);
    expect(assessments.every((assessment) => assessment.schemaVersion === '1.0')).toBe(true);
    expect(PublicReportSchema.parse(JSON.parse(result.targets[0].json || '')))
      .toEqual(result.targets[0].report);
    expect(result.targets[0].markdown).toContain('# mcptest Evaluation Report');
    expect(result.targets[0].markdown).not.toContain(REDACTED_VALUE);
  });

  it('preserves the locally generated timestamp when its year matches a credential', async () => {
    const generatedAt = '2026-08-11T23:30:00.000Z';
    const result = await runReleaseGate({
      endpoints: ['https://fixture.example/mcp'],
      headers: { Authorization: 'Bearer 2026' },
      policy: { failOnResults: new Set(), failOnSeverity: 'none' },
      generatedAt,
    }, { evaluate: async () => evaluatedReport() });

    expect(result.exitCode).toBe(RELEASE_GATE_EXIT_CODES.pass);
    expect(result.targets[0].status).toBe('evaluated');
    expect(result.targets[0].report?.generatedAt).toBe(generatedAt);
    expect(PublicReportSchema.parse(JSON.parse(result.targets[0].json || '')))
      .toEqual(result.targets[0].report);
  });

  it('preserves a configured endpoint when a credential matches a hostname component', async () => {
    const endpoint = 'https://credential-collision.example/mcp';
    const credential = 'credential-collision';
    const result = await runReleaseGate({
      endpoints: [endpoint],
      headers: { Authorization: `Bearer ${credential}` },
      policy: { failOnResults: new Set(), failOnSeverity: 'none' },
    }, {
      evaluate: async () => {
        const report = evaluatedReport(endpoint);
        report.sections.protocol.details[0].context = `Server echoed ${credential}`;
        return report;
      },
    });

    expect(result.exitCode).toBe(RELEASE_GATE_EXIT_CODES.pass);
    expect(result.targets[0].report?.target.testedEndpoint).toBe(endpoint);
    expect(result.targets[0].report?.target.negotiatedEndpoint).toBe(endpoint);
    expect(result.targets[0].report?.sections[0].evidence[0].context)
      .toBe(`Server echoed ${REDACTED_VALUE}`);
    expect(() => new URL(result.targets[0].report?.target.testedEndpoint || '')).not.toThrow();
    expect(PublicReportSchema.parse(JSON.parse(result.targets[0].json || '')))
      .toEqual(result.targets[0].report);
  });

  it('preserves locally generated host-profile identifiers that collide with credentials', async () => {
    const result = await runReleaseGate({
      endpoints: ['https://fixture.example/mcp'],
      headers: { Authorization: 'Bearer chatgpt' },
      policy: { failOnResults: new Set(), failOnSeverity: 'none' },
    }, {
      evaluate: async () => {
        const report = evaluatedReport();
        report.sections.protocol.details[0].context = 'Server echoed chatgpt';
        return report;
      },
    });

    expect(result.exitCode).toBe(RELEASE_GATE_EXIT_CODES.pass);
    expect(result.targets[0].report?.compatibility?.assessments.chatgpt?.profileId)
      .toBe('chatgpt');
    expect(result.targets[0].report?.sections[0].evidence[0].context)
      .toBe(`Server echoed ${REDACTED_VALUE}`);
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

  it('bounds overlong filename hosts with a stable collision-resistant hash', () => {
    const sharedLabels = `${'a'.repeat(63)}.${'b'.repeat(63)}.${'c'.repeat(63)}`;
    const first = releaseGateFilenameBase(
      `https://${sharedLabels}.${'d'.repeat(61)}/mcp`, 0, 1
    );
    const second = releaseGateFilenameBase(
      `https://${sharedLabels}.${'e'.repeat(61)}/mcp`, 0, 1
    );

    expect(Buffer.byteLength(`${first}.json`)).toBeLessThanOrEqual(255);
    expect(first).toMatch(/-[a-f0-9]{12}-report$/);
    expect(releaseGateFilenameBase(
      `https://${sharedLabels}.${'d'.repeat(61)}/mcp`, 0, 1
    )).toBe(first);
    expect(second).not.toBe(first);
  });
});
