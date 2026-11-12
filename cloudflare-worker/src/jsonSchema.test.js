import Ajv2020 from 'ajv/dist/2020';
import addFormats from 'ajv-formats';
import { describe, expect, it } from 'vitest';
import reportSchema from '../../public/schemas/report/v2.schema.json';
import { createOAuthFlightRecorder } from '../../src/utils/oauthTrace.ts';
import { createPublicReport, serializePublicReportJson } from '../../src/utils/reportArtifact.ts';
import { createCompatibilityMatrix, createReleaseDecision } from '../../src/utils/releaseReadiness.ts';
import { analyzeToolSurface } from '../../src/utils/toolSurfaceAnalysis.ts';
import { compileSchema } from './jsonSchema.js';

const ajv = new Ajv2020({ allErrors: true, strict: false });
addFormats(ajv);
const reference = ajv.compile(reportSchema);
const validate = compileSchema(reportSchema);

const scoredReport = () => ({
  serverUrl: 'https://schema.example/mcp',
  outcome: 'scored',
  finalScore: 55,
  toolSurfaceAnalysis: analyzeToolSurface([{
    name: 'search', description: 'Search records.',
    inputSchema: { type: 'object', properties: { query: { type: 'string' } }, required: ['query'] },
  }]),
  sections: {
    protocol: {
      name: 'Protocol', description: 'Protocol', score: 15, maxScore: 15,
      details: [{ text: 'Negotiated', context: 'direct', metadata: {
        protocolEra: 'modern', protocolVersion: '2026-07-28', endpoint: 'https://schema.example/mcp', route: 'direct',
      } }],
    },
    capabilities: {
      name: 'Capabilities', description: 'Capabilities', score: 10, maxScore: 10,
      details: [{ text: 'Tools', metadata: { method: 'tools/list', itemCount: 1, durationMs: 18 } }],
    },
    transport: {
      name: 'Transport', description: 'Transport', score: 15, maxScore: 15,
      details: [{ text: 'Connected', metadata: { transportType: 'streamable-http' } }],
    },
    performance: {
      name: 'Performance', description: 'Performance', score: 15, maxScore: 15,
      details: [{ text: 'Fast', metadata: { durationMs: 200, category: 'excellent' } }],
    },
  },
});

const authorizationRequiredReport = () => ({
  serverUrl: 'https://protected.example/mcp',
  authenticationUrl: 'https://protected.example/mcp',
  outcome: 'authorization-required',
  finalScore: 0,
  sections: {
    auth: {
      name: 'Authorization Required', description: 'OAuth authorization is required', score: 0, maxScore: 0,
      details: [{ text: 'Authorize before running the report', metadata: {
        route: 'direct', status: 401, authenticationSource: 'target',
        responseHeaders: { 'WWW-Authenticate': 'Bearer resource_metadata="https://protected.example/.well-known/oauth-protected-resource"' },
      } }],
    },
  },
});

const failedReport = () => ({
  serverUrl: 'https://down.example/mcp',
  outcome: 'failed',
  finalScore: 0,
  sections: {
    protocol: {
      name: 'Protocol', description: 'Protocol', score: 0, maxScore: 15, status: 'failed',
      details: [{ text: 'Connection refused' }],
    },
  },
});

const artifacts = () => {
  const recorder = createOAuthFlightRecorder({
    targetUrl: 'https://protected.example/mcp',
    startedAt: '2026-10-20T09:00:00.000Z',
  });
  recorder.record({
    type: 'target_challenge', outcome: 'challenged', timestamp: '2026-10-20T09:00:01.000Z',
    provenance: 'direct_target', route: 'direct', explanation: 'Challenge observed.',
  });
  return [scoredReport(), authorizationRequiredReport(), failedReport()].map((report, index) => {
    const oauthTrace = index === 1 ? recorder.snapshot() : undefined;
    const compatibilityMatrix = createCompatibilityMatrix(report, oauthTrace);
    const releaseDecision = createReleaseDecision(report, compatibilityMatrix, report.toolSurfaceAnalysis, oauthTrace);
    return JSON.parse(serializePublicReportJson(createPublicReport(report, {
      generatedAt: '2026-10-20T09:00:00.000Z',
      releaseDecision, compatibilityMatrix, toolSurfaceAnalysis: report.toolSurfaceAnalysis, oauthTrace,
    })));
  });
};

// Every JSON path in the document, so mutations reach nested objects and array items.
const paths = (value, prefix = []) => {
  if (Array.isArray(value)) return value.flatMap((item, index) => [[...prefix, index], ...paths(item, [...prefix, index])]);
  if (value && typeof value === 'object') {
    return Object.keys(value).flatMap((key) => [[...prefix, key], ...paths(value[key], [...prefix, key])]);
  }
  return [];
};

const mutate = (document, path, mutation) => {
  const copy = JSON.parse(JSON.stringify(document));
  const parent = path.slice(0, -1).reduce((node, key) => node[key], copy);
  const key = path[path.length - 1];
  if (mutation === 'delete') {
    if (Array.isArray(parent)) parent.splice(key, 1);
    else delete parent[key];
  } else if (mutation === 'retype') {
    parent[key] = typeof parent[key] === 'string' ? 12345 : 'retyped';
  } else if (mutation === 'empty') {
    parent[key] = typeof parent[key] === 'string' ? '' : typeof parent[key] === 'number' ? -1 : null;
  } else if (mutation === 'extra' && parent[key] && typeof parent[key] === 'object' && !Array.isArray(parent[key])) {
    parent[key].unexpectedProperty = true;
  }
  return copy;
};

describe('worker JSON Schema validator', () => {
  it('accepts every artifact the app produces', () => {
    for (const artifact of artifacts()) {
      expect(reference(artifact), JSON.stringify(reference.errors)).toBe(true);
      expect(validate(artifact)).toEqual({ valid: true, errors: [] });
    }
  });

  it('agrees with Ajv on hundreds of single-point mutations', () => {
    const disagreements = [];
    let rejected = 0;
    let total = 0;
    for (const artifact of artifacts()) {
      // Shallow paths cover every schema definition; deeper ones mostly repeat array items.
      const candidates = paths(artifact).filter((path) => path.length <= 3);
      const sampled = candidates.filter((_, index) => index % Math.ceil(candidates.length / 120) === 0);
      for (const path of sampled) {
        for (const mutation of ['delete', 'retype', 'empty', 'extra']) {
          const mutated = mutate(artifact, path, mutation);
          const expected = reference(mutated);
          const actual = validate(mutated).valid;
          total += 1;
          if (!expected) rejected += 1;
          if (expected !== actual) disagreements.push({ path: path.join('.'), mutation, expected, actual });
        }
      }
    }
    expect(total).toBeGreaterThan(400);
    expect(rejected).toBeGreaterThan(150);
    expect(disagreements).toEqual([]);
  }, 60000);

  it('reports the failing path and refuses schemas with unsupported keywords', () => {
    const artifact = artifacts()[0];
    delete artifact.target.testedEndpoint;
    const result = validate(artifact);
    expect(result.valid).toBe(false);
    expect(result.errors[0]).toEqual({ path: '/target', message: 'missing required property "testedEndpoint"' });
    expect(() => compileSchema({ type: 'object', dependentRequired: { a: ['b'] } })).toThrow(/dependentRequired/);
  });
});
