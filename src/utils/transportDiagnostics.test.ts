import { describe, expect, it } from 'vitest';
import Ajv2020 from 'ajv/dist/2020';
import addFormats from 'ajv-formats';
import publicJsonSchema from '../../public/schemas/report/v2.schema.json';
import type { ObservedTransportRequest } from './transportDetection';
import { TransportConnectionError } from './transportDetection';
import type { EvaluationReport } from './evaluation';
import {
  TRANSPORT_DIAGNOSTIC_DEFINITIONS,
  collectTransportDiagnostics,
  detectTransportDiagnostics,
  detectedTransportDiagnostics,
  mergeTransportDiagnostics,
  parseRetryAfter,
  transportDiagnosticReportDetail,
  transportDiagnosticSourcesFromFailures,
  transportDiagnosticsFromSections,
} from './transportDiagnostics';
import { TRANSPORT_DIAGNOSTIC_IDS } from '../types/transportDiagnostics';
import {
  createCompatibilityMatrix,
  createReleaseDecision,
  transportDiagnosticPriority,
} from './releaseReadiness';
import {
  REPORT_SCHEMA_VERSION,
  createPublicReport,
  parsePublicReportJson,
  serializePublicReportJson,
  serializePublicReportMarkdown,
} from './reportArtifact';
import { collectConnectionTransportDiagnostics } from './connectionDiagnostics';

const ENDPOINT = 'https://mcp.example.com/mcp';
const PROXY_ENDPOINT = `https://proxy.mcptest.io/?target=${encodeURIComponent(ENDPOINT)}`;

const request = (overrides: Partial<ObservedTransportRequest> = {}): ObservedTransportRequest => ({
  method: 'POST',
  mcpMethod: 'initialize',
  url: ENDPOINT,
  candidateUrl: ENDPOINT,
  targetUrl: ENDPOINT,
  transportType: 'streamable-http',
  startedAt: '2026-10-20T00:00:00.000Z',
  requestAccept: 'application/json, text/event-stream',
  requestContentType: 'application/json',
  status: 200,
  responseSource: 'target',
  responseContentType: 'application/json',
  outcome: 'succeeded',
  ...overrides,
});

const proxied = (overrides: Partial<ObservedTransportRequest> = {}): ObservedTransportRequest => request({
  url: PROXY_ENDPOINT,
  candidateUrl: PROXY_ENDPOINT,
  ...overrides,
});

const ids = (requests: ObservedTransportRequest[], route: 'direct' | 'proxy' = 'direct') => (
  detectTransportDiagnostics(requests, route).map(({ id, severity }) => ({ id, severity }))
);

describe('transport diagnostic model', () => {
  it('defines an explanation and three stack-specific code hints for every stable id', () => {
    expect(Object.keys(TRANSPORT_DIAGNOSTIC_DEFINITIONS).sort()).toEqual([...TRANSPORT_DIAGNOSTIC_IDS].sort());
    for (const id of TRANSPORT_DIAGNOSTIC_IDS) {
      expect(id).toMatch(/^transport\.[a-z0-9-]+$/);
      const definition = TRANSPORT_DIAGNOSTIC_DEFINITIONS[id];
      expect(definition.explanation.length).toBeGreaterThan(120);
      expect(definition.remediation.summary.length).toBeGreaterThan(40);
      expect(definition.remediation.hints.map(({ stack }) => stack)).toEqual([
        'TypeScript SDK',
        'Python SDK',
        'Cloudflare Workers',
      ]);
    }
  });
});

describe('parseRetryAfter', () => {
  const now = Date.parse('2026-10-20T12:00:00.000Z');

  it('reads delta-seconds', () => {
    expect(parseRetryAfter('120', now)).toBe(120);
    expect(parseRetryAfter(' 0 ', now)).toBe(0);
  });

  it('reads an HTTP-date relative to the response time', () => {
    expect(parseRetryAfter('Tue, 20 Oct 2026 12:00:30 GMT', now)).toBe(30);
    expect(parseRetryAfter('Tuesday, 20-Oct-26 12:01:00 GMT', now)).toBe(60);
  });

  it('treats a date in the past as no wait', () => {
    expect(parseRetryAfter('Tue, 20 Oct 2026 11:59:00 GMT', now)).toBe(0);
  });

  it('rejects absent, negative, fractional and unparsable values', () => {
    expect(parseRetryAfter(undefined, now)).toBeUndefined();
    expect(parseRetryAfter('', now)).toBeUndefined();
    expect(parseRetryAfter('-5', now)).toBeUndefined();
    expect(parseRetryAfter('1.5', now)).toBeUndefined();
    expect(parseRetryAfter('soon', now)).toBeUndefined();
  });
});

describe('transport.accept-header-406', () => {
  it('detects a target 406 with the Accept header that was sent', () => {
    const [diagnostic] = detectTransportDiagnostics([request({ status: 406, outcome: 'failed' })], 'direct');

    expect(diagnostic).toMatchObject({ id: 'transport.accept-header-406', severity: 'error', status: 'detected' });
    expect(diagnostic.evidence[0]).toMatchObject({
      route: 'direct',
      endpoint: ENDPOINT,
      method: 'POST',
      mcpMethod: 'initialize',
      status: 406,
      responseSource: 'target',
      headersSent: { accept: 'application/json, text/event-stream', 'content-type': 'application/json' },
    });
  });

  it('does not attribute a 406 produced by the proxy to the target', () => {
    expect(ids([proxied({ status: 406, responseSource: 'proxy' })], 'proxy')).toEqual([]);
    // Unknown provenance through the proxy is not proof of a target response either.
    expect(ids([proxied({ status: 406, responseSource: undefined })], 'proxy')).toEqual([]);
  });

  it('detects a target 406 forwarded by the proxy', () => {
    const [diagnostic] = detectTransportDiagnostics([proxied({ status: 406 })], 'proxy');
    expect(diagnostic.id).toBe('transport.accept-header-406');
    expect(diagnostic.evidence[0]).toMatchObject({ route: 'proxy', endpoint: ENDPOINT });
  });

  it('only warns when the optional GET stream is refused with 406', () => {
    expect(ids([request({
      method: 'GET', mcpMethod: undefined, status: 406, requestAccept: 'text/event-stream',
    })])).toEqual([{ id: 'transport.accept-header-406', severity: 'warning' }]);
  });
});

describe('transport.get-stream-405', () => {
  it('is a warning for the optional Streamable HTTP GET stream', () => {
    expect(ids([
      request(),
      request({ method: 'GET', mcpMethod: undefined, status: 405, responseContentType: undefined }),
    ])).toEqual([{ id: 'transport.get-stream-405', severity: 'warning' }]);
  });

  it('ignores 405 on POST and on the legacy SSE endpoint', () => {
    expect(ids([request({ status: 405 })])).toEqual([]);
    expect(ids([request({ method: 'GET', mcpMethod: undefined, status: 405, transportType: 'legacy-sse' })])).toEqual([]);
  });

  it('does not block release readiness', () => {
    const [diagnostic] = detectTransportDiagnostics([
      request({ method: 'GET', mcpMethod: undefined, status: 405 }),
    ], 'direct');
    expect(transportDiagnosticPriority(diagnostic)).toMatchObject({
      id: 'transport.get-stream-405',
      severity: 'medium',
      source: 'Evaluation',
    });
  });
});

describe('transport.unsupported-media-type-415', () => {
  it('detects a target 415 with the Content-Type that was sent', () => {
    const [diagnostic] = detectTransportDiagnostics([
      request({ status: 415, requestContentType: 'application/json' }),
    ], 'direct');
    expect(diagnostic).toMatchObject({ id: 'transport.unsupported-media-type-415', severity: 'error' });
    expect(diagnostic.evidence[0].observation).toContain('Content-Type: application/json');
  });

  it('ignores a proxy-produced 415', () => {
    expect(ids([proxied({ status: 415, responseSource: 'proxy' })], 'proxy')).toEqual([]);
  });
});

describe('transport.target-rate-limited-429', () => {
  it('reports the Retry-After wait in seconds', () => {
    const [diagnostic] = detectTransportDiagnostics([
      request({ status: 429, retryAfter: '45', rateLimitRetry: { action: 'not-retried', waitMs: 45_000, reason: 'too long' } }),
    ], 'direct');
    expect(diagnostic).toMatchObject({
      id: 'transport.target-rate-limited-429',
      severity: 'error',
      retryAfterSeconds: 45,
    });
    expect(diagnostic.evidence[0].headersSeen).toEqual({ 'content-type': 'application/json', 'retry-after': '45' });
  });

  it('reports a Retry-After HTTP-date relative to the request time', () => {
    const [diagnostic] = detectTransportDiagnostics([
      request({ status: 429, retryAfter: 'Tue, 20 Oct 2026 00:02:00 GMT' }),
    ], 'direct');
    expect(diagnostic.retryAfterSeconds).toBe(120);
  });

  it('anchors the retry deadline to when the 429 arrived', () => {
    const [seconds] = detectTransportDiagnostics([
      request({ status: 429, retryAfter: '30', durationMs: 1500 }),
    ], 'direct');
    expect(seconds.retryAt).toBe('2026-10-20T00:00:31.500Z');

    const [date] = detectTransportDiagnostics([
      request({ status: 429, retryAfter: 'Tue, 20 Oct 2026 00:02:00 GMT' }),
    ], 'direct');
    expect(date.retryAt).toBe('2026-10-20T00:02:00.000Z');
  });

  it('leaves no retry deadline when the automatic retry already honored the wait', () => {
    const [diagnostic] = detectTransportDiagnostics([
      request({ status: 429, retryAfter: '1', rateLimitRetry: { action: 'retried', waitMs: 1000 } }),
      request({ status: 200, automaticRetry: { reason: 'target-rate-limit', waitMs: 1000 } }),
      request({ mcpMethod: 'tools/list', status: 406 }),
    ], 'direct');
    expect(diagnostic).toMatchObject({ id: 'transport.target-rate-limited-429', severity: 'warning', retryAfterSeconds: 1 });
    expect(diagnostic.retryAt).toBeUndefined();
  });

  it('keeps the latest outstanding deadline, with its own wait, when merging', () => {
    const [recovered] = detectTransportDiagnostics([
      request({ status: 429, retryAfter: '2', startedAt: '2026-10-20T00:00:20.000Z', rateLimitRetry: { action: 'retried', waitMs: 2000 } }),
      request({ status: 200, startedAt: '2026-10-20T00:00:22.000Z', automaticRetry: { reason: 'target-rate-limit', waitMs: 2000 } }),
    ], 'direct');
    const [longEarly] = detectTransportDiagnostics([
      request({ status: 429, retryAfter: '60', startedAt: '2026-10-20T00:00:00.000Z' }),
    ], 'direct');
    const [shortLate] = detectTransportDiagnostics([
      request({ status: 429, retryAfter: '30', startedAt: '2026-10-20T00:00:40.000Z' }),
    ], 'direct');

    const [merged] = mergeTransportDiagnostics([recovered, longEarly, shortLate]);
    expect(merged).toMatchObject({ retryAt: '2026-10-20T00:01:10.000Z', retryAfterSeconds: 30 });
    expect(mergeTransportDiagnostics([shortLate, longEarly])[0]).toMatchObject({
      retryAt: '2026-10-20T00:01:10.000Z',
      retryAfterSeconds: 30,
    });
  });

  it('says when Retry-After was not readable', () => {
    const [diagnostic] = detectTransportDiagnostics([request({ status: 429 })], 'direct');
    expect(diagnostic.retryAfterSeconds).toBeUndefined();
    expect(diagnostic.evidence[0].observation).toContain('No readable Retry-After header');
  });

  it('downgrades to a warning when the single automatic retry succeeded', () => {
    expect(ids([
      request({ status: 429, retryAfter: '1', rateLimitRetry: { action: 'retried', waitMs: 1000 } }),
      request({ status: 200, automaticRetry: { reason: 'target-rate-limit', waitMs: 1000 } }),
    ])).toEqual([{ id: 'transport.target-rate-limited-429', severity: 'warning' }]);
  });

  it('never treats the mcptest proxy caller limit as a target 429', () => {
    expect(ids([proxied({
      status: 429,
      responseSource: 'proxy',
      proxyLimit: { tier: 'anonymous', retryAfterSeconds: 30 },
    })], 'proxy')).toEqual([]);
    expect(ids([proxied({
      status: 429,
      responseSource: 'target',
      proxyLimit: { tier: 'anonymous', kind: 'response_bytes' },
    })], 'proxy')).toEqual([]);
  });
});

describe('transport.cors-expose-headers-missing', () => {
  const statefulFailure = (initialize: Partial<ObservedTransportRequest> = {}) => [
    request({ crossOrigin: true, readableResponseHeaders: [], ...initialize }),
    request({ mcpMethod: 'notifications/initialized', status: 202, responseContentType: undefined }),
    request({
      mcpMethod: 'tools/list',
      status: 400,
      outcome: 'failed',
      requestHeaders: ['accept', 'content-type', 'mcp-protocol-version'],
      targetError: { message: 'Bad Request: No valid session ID provided' },
    }),
  ];

  it('detects an unreadable session id followed by a session rejection', () => {
    const [diagnostic] = detectTransportDiagnostics(statefulFailure(), 'direct');
    expect(diagnostic).toMatchObject({ id: 'transport.cors-expose-headers-missing', severity: 'error', status: 'detected' });
    expect(diagnostic.evidence).toHaveLength(2);
    expect(diagnostic.evidence[0].observation).toContain('could not read Mcp-Session-Id or MCP-Protocol-Version');
    expect(diagnostic.evidence[1]).toMatchObject({ mcpMethod: 'tools/list', status: 400 });
  });

  it('only suspects hidden headers when a sessionless server later fails for another reason', () => {
    for (const unrelated of [
      request({ mcpMethod: 'tools/call', status: 400, outcome: 'failed', targetError: { code: -32602, message: 'Invalid params: missing "name"' } }),
      request({ mcpMethod: 'tools/list', status: 404, outcome: 'failed', responseContentType: 'text/html' }),
    ]) {
      const requests = [
        request({ crossOrigin: true, readableResponseHeaders: [] }),
        request({ mcpMethod: 'notifications/initialized', status: 202, responseContentType: undefined }),
        unrelated,
      ];
      const diagnostics = collectTransportDiagnostics([{ route: 'direct', requests }]);
      expect(diagnostics).toEqual([expect.objectContaining({
        id: 'transport.cors-expose-headers-missing',
        status: 'suspected',
        severity: 'warning',
        unconfirmedReason: expect.stringContaining('does not use sessions'),
      })]);
      expect(detectedTransportDiagnostics(diagnostics)).toEqual([]);
      expect(transportDiagnosticPriority(diagnostics[0])).toBeUndefined();
      expect(transportDiagnosticReportDetail(diagnostics[0]).text).toContain('Possible, not confirmed');
    }
  });

  it('confirms with a session-specific rejection even after an unrelated failure', () => {
    const [diagnostic] = detectTransportDiagnostics([
      request({ crossOrigin: true, readableResponseHeaders: [] }),
      request({ mcpMethod: 'tools/list', status: 404, outcome: 'failed' }),
      request({ mcpMethod: 'tools/list', status: 400, outcome: 'failed', targetError: { message: 'Session not found' } }),
    ], 'direct');
    expect(diagnostic).toMatchObject({ status: 'detected', severity: 'error' });
    expect(diagnostic.evidence[1].observation).toContain('Session not found');
  });

  it('prefers a confirmed detection over a suspicion when merging', () => {
    const [suspected] = detectTransportDiagnostics([
      request({ crossOrigin: true, readableResponseHeaders: [] }),
      request({ mcpMethod: 'tools/list', status: 400, outcome: 'failed' }),
    ], 'direct');
    const [detected] = detectTransportDiagnostics(statefulFailure(), 'direct');
    expect(mergeTransportDiagnostics([suspected, detected])[0]).toMatchObject({ status: 'detected', severity: 'error' });
    expect(mergeTransportDiagnostics([detected, suspected])[0]).toMatchObject({ status: 'detected', severity: 'error' });
    expect(mergeTransportDiagnostics([detected, suspected])[0].evidence).toHaveLength(2);
  });

  it('passes when the browser could read Mcp-Session-Id', () => {
    expect(ids(statefulFailure({ readableResponseHeaders: ['mcp-session-id'] }))).toEqual([]);
    expect(collectTransportDiagnostics([{
      route: 'direct',
      requests: statefulFailure({ readableResponseHeaders: ['mcp-session-id'] }),
    }])).toEqual([]);
  });

  it('does not flag a same-origin or stateless success', () => {
    expect(ids(statefulFailure({ crossOrigin: false }))).toEqual([]);
    expect(ids([
      request({ crossOrigin: true }),
      request({ mcpMethod: 'tools/list', status: 200 }),
    ])).toEqual([]);
  });

  it('says explicitly that the check was not performed through the proxy', () => {
    const diagnostics = collectTransportDiagnostics([{
      route: 'proxy',
      requests: [proxied({ crossOrigin: true })],
    }]);
    expect(diagnostics).toEqual([expect.objectContaining({
      id: 'transport.cors-expose-headers-missing',
      status: 'not-checked',
      severity: 'info',
      notCheckedReason: expect.stringContaining('mcptest proxy'),
    })]);
    expect(transportDiagnosticPriority(diagnostics[0])).toBeUndefined();
  });

  it('says explicitly that the check was not performed when every direct response was unreadable', () => {
    const diagnostics = collectTransportDiagnostics([{
      route: 'direct',
      requests: [request({ status: undefined, responseSource: undefined, outcome: 'failed', crossOrigin: true })],
    }]);
    expect(diagnostics[0]).toMatchObject({
      status: 'not-checked',
      notCheckedReason: expect.stringContaining('No direct, cross-origin initialize response was readable'),
    });
  });

  it('says explicitly that the check was not performed in the headless runtime', () => {
    expect(collectTransportDiagnostics([{ route: 'direct', requests: [request()] }], 'headless')[0])
      .toMatchObject({ status: 'not-checked', notCheckedReason: expect.stringContaining('did not use a browser') });
  });

  it('prefers a detection on the direct route over the proxy "not checked" note', () => {
    const diagnostics = collectTransportDiagnostics([
      { route: 'direct', requests: statefulFailure() },
      { route: 'proxy', requests: [proxied()] },
    ]);
    expect(diagnostics.filter(({ id }) => id === 'transport.cors-expose-headers-missing')).toEqual([
      expect.objectContaining({ status: 'detected' }),
    ]);
  });
});

describe('transport.sse-content-type-mismatch', () => {
  it('detects a legacy SSE endpoint served as text/plain', () => {
    expect(ids([request({
      method: 'GET', mcpMethod: undefined, transportType: 'legacy-sse', responseContentType: 'text/plain; charset=utf-8',
    })])).toEqual([{ id: 'transport.sse-content-type-mismatch', severity: 'error' }]);
  });

  it('detects a missing Content-Type on an SSE stream', () => {
    const [diagnostic] = detectTransportDiagnostics([request({
      method: 'GET', mcpMethod: undefined, transportType: 'legacy-sse', responseContentType: undefined,
    })], 'direct');
    expect(diagnostic.evidence[0].observation).toContain('Content-Type (missing)');
  });

  it('detects a POST response that is neither JSON nor SSE', () => {
    expect(ids([request({ mcpMethod: 'tools/list', responseContentType: 'text/html' })]))
      .toEqual([{ id: 'transport.sse-content-type-mismatch', severity: 'error' }]);
  });

  it('does not mistake an HTML page at a guessed SSE path for a mislabelled stream', () => {
    expect(ids([request({
      method: 'GET', mcpMethod: undefined, transportType: 'legacy-sse', responseContentType: 'text/html; charset=utf-8',
    })])).toEqual([]);
  });

  it('accepts JSON or SSE with parameters, notifications and 202 responses', () => {
    expect(ids([
      request({ responseContentType: 'application/json; charset=utf-8' }),
      request({ mcpMethod: 'tools/list', responseContentType: 'Text/Event-Stream' }),
      request({ mcpMethod: 'notifications/initialized', responseContentType: 'text/plain' }),
      request({ mcpMethod: 'tools/list', status: 202, responseContentType: undefined }),
      request({ method: 'GET', mcpMethod: undefined, transportType: 'legacy-sse', responseContentType: 'text/event-stream' }),
    ])).toEqual([]);
  });
});

describe('collecting diagnostics from failed connections', () => {
  it('walks candidate failures of a TransportConnectionError on each route', () => {
    const directError = new TransportConnectionError([new Error('HTTP 406')], [{
      candidateUrl: ENDPOINT,
      transportType: 'streamable-http',
      error: new Error('HTTP 406'),
      observedRequests: [request({ status: 406 })],
    }]);
    const proxyError = new TransportConnectionError([new Error('HTTP 406')], [{
      candidateUrl: PROXY_ENDPOINT,
      transportType: 'streamable-http',
      error: new Error('HTTP 406'),
      observedRequests: [proxied({ status: 406 })],
    }]);

    const sources = transportDiagnosticSourcesFromFailures([
      { route: 'direct', error: directError },
      { route: 'proxy', error: proxyError },
    ]);
    expect(sources.map(({ route }) => route)).toEqual(['direct', 'proxy']);

    const diagnostics = collectConnectionTransportDiagnostics([
      { route: 'direct', error: directError },
      { route: 'proxy', error: proxyError },
    ]);
    const accept = diagnostics.find(({ id }) => id === 'transport.accept-header-406');
    expect(accept?.evidence.map(({ route }) => route)).toEqual(['direct', 'proxy']);
  });

  it('merges evidence and keeps the strongest severity', () => {
    const [warning] = detectTransportDiagnostics([request({ method: 'GET', mcpMethod: undefined, status: 406 })], 'direct');
    const [error] = detectTransportDiagnostics([request({ status: 406 })], 'direct');
    const [merged] = mergeTransportDiagnostics([warning, error]);
    expect(merged.severity).toBe('error');
    expect(merged.evidence).toHaveLength(2);
  });
});

describe('report serialization', () => {
  const ajv = new Ajv2020({ allErrors: true, strict: false });
  addFormats(ajv);
  const validatePublishedSchema = ajv.compile(publicJsonSchema);

  const reportWithDiagnostics = (): EvaluationReport => {
    const diagnostics = collectTransportDiagnostics([{
      route: 'direct',
      requests: [
        request({ crossOrigin: true, readableResponseHeaders: ['mcp-session-id'] }),
        request({ method: 'GET', mcpMethod: undefined, status: 405, responseContentType: undefined }),
        request({ mcpMethod: 'tools/list', status: 429, retryAfter: '30', rateLimitRetry: { action: 'retried', waitMs: 1000 } }),
      ],
    }]);
    return {
      serverUrl: ENDPOINT,
      outcome: 'scored',
      finalScore: 30,
      sections: {
        protocol: {
          name: 'Core Protocol Adherence',
          description: 'Validates MCP lifecycle and JSON-RPC negotiation',
          score: 15,
          maxScore: 15,
          details: [{
            text: '✓ Negotiated the stateful initialize lifecycle',
            metadata: { protocolEra: 'stateful', protocolVersion: '2025-11-25', endpoint: ENDPOINT, route: 'direct' },
          }],
        },
        transport: {
          name: 'Transport Layer Modernity',
          description: 'Identifies Streamable HTTP or deprecated HTTP+SSE',
          score: 15,
          maxScore: 15,
          details: [
            {
              text: '✓ Streamable HTTP negotiated successfully',
              metadata: { transportType: 'streamable-http', endpoint: ENDPOINT, protocolEra: 'stateful' },
            },
            ...diagnostics.map(transportDiagnosticReportDetail),
          ],
        },
      },
    };
  };

  it('carries diagnostic ids into release priorities, JSON and Markdown without a schema change', () => {
    const report = reportWithDiagnostics();
    expect(transportDiagnosticsFromSections(report.sections).map(({ id }) => id)).toEqual([
      'transport.target-rate-limited-429',
      'transport.get-stream-405',
    ]);

    const matrix = createCompatibilityMatrix(report);
    const decision = createReleaseDecision(report, matrix);
    const transportPriorities = decision.priorities.filter(({ id }) => id.startsWith('transport.'));
    expect(transportPriorities).toEqual([
      expect.objectContaining({ id: 'transport.target-rate-limited-429', severity: 'high', source: 'Evaluation' }),
      expect.objectContaining({ id: 'transport.get-stream-405', severity: 'medium', source: 'Evaluation' }),
    ]);
    expect(decision.status).toBe('blocked');

    const artifact = createPublicReport(report, {
      generatedAt: '2026-10-20T00:00:00.000Z',
      toolVersion: '1.0.0',
      releaseDecision: decision,
    });
    expect(artifact.schemaVersion).toBe(REPORT_SCHEMA_VERSION);

    const json = serializePublicReportJson(artifact);
    expect(validatePublishedSchema(JSON.parse(json))).toBe(true);
    const parsed = parsePublicReportJson(json);
    expect(parsed.releaseDecision?.priorities.map(({ id }) => id)).toEqual(
      expect.arrayContaining(['transport.target-rate-limited-429', 'transport.get-stream-405'])
    );
    const transportEvidence = parsed.sections.find(({ id }) => id === 'transport')?.evidence
      .map(({ metadata }) => (metadata as { transportDiagnostic?: { id: string; remediation: { hints: unknown[] } } })?.transportDiagnostic)
      .filter(Boolean);
    expect(transportEvidence?.map((diagnostic) => diagnostic?.id)).toEqual([
      'transport.target-rate-limited-429',
      'transport.get-stream-405',
    ]);
    expect(transportEvidence?.[0]?.remediation.hints).toHaveLength(3);

    const markdown = serializePublicReportMarkdown(artifact);
    expect(markdown).toContain('  - Id: transport.target-rate-limited-429');
    expect(markdown).toContain('  - Id: transport.get-stream-405');
    expect(markdown).toContain('Server does not offer a GET event stream (HTTP 405) (transport.get-stream-405)');
    expect(markdown).toContain('"retryAfterSeconds": 30');
  });

  it('keeps a lone 405 warning reviewable rather than blocked', () => {
    const report = reportWithDiagnostics();
    report.sections.transport.details = report.sections.transport.details.filter((detail) => (
      (detail.metadata as { transportDiagnostic?: { id: string } })?.transportDiagnostic?.id !== 'transport.target-rate-limited-429'
    ));
    const decision = createReleaseDecision(report, createCompatibilityMatrix(report));
    expect(decision.priorities.filter(({ id }) => id.startsWith('transport.'))).toEqual([
      expect.objectContaining({ id: 'transport.get-stream-405', severity: 'medium' }),
    ]);
    expect(decision.priorities.some(({ severity }) => severity === 'high' || severity === 'critical')).toBe(false);
  });

  it('serializes a "not checked" note as evidence without a release priority', () => {
    const report = reportWithDiagnostics();
    report.sections.transport.details = [
      report.sections.transport.details[0],
      ...collectTransportDiagnostics([{ route: 'proxy', requests: [proxied()] }]).map(transportDiagnosticReportDetail),
    ];
    const decision = createReleaseDecision(report, createCompatibilityMatrix(report));
    expect(decision.priorities.some(({ id }) => id.startsWith('transport.'))).toBe(false);

    const markdown = serializePublicReportMarkdown(createPublicReport(report, {
      generatedAt: '2026-10-20T00:00:00.000Z',
      releaseDecision: decision,
    }));
    expect(markdown).toContain('Check not performed: Browser cannot read Mcp-Session-Id');
    expect(markdown).toContain('transport.cors-expose-headers-missing');
  });
});
