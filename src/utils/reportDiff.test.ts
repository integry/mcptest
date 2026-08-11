import { describe, expect, it } from 'vitest';
import type { EvaluationReport } from './evaluation';
import { createPublicReport, type PublicReport } from './reportArtifact';
import { diffPublicReports } from './reportDiff';
import { analyzeToolSurface } from './toolSurfaceAnalysis';

interface FixtureOptions {
  generatedAt?: string;
  tools?: unknown[];
  protocolEra?: 'modern' | 'legacy';
  protocolVersion?: string;
  transport?: 'streamable-http' | 'legacy-sse';
  score?: number;
  latency?: number;
  oauthMetadata?: Record<string, unknown>;
}

const artifact = ({
  generatedAt = '2026-08-11T20:00:00.000Z',
  tools = [{
    name: 'search',
    description: 'Search records by query.',
    inputSchema: {
      type: 'object',
      properties: { query: { type: 'string' } },
      required: ['query'],
      additionalProperties: false,
    },
  }],
  protocolEra = 'modern',
  protocolVersion = protocolEra === 'modern' ? '2026-07-28' : '2025-11-25',
  transport = 'streamable-http',
  score = transport === 'streamable-http' ? 55 : 46,
  latency = 200,
  oauthMetadata,
}: FixtureOptions = {}): PublicReport => {
  const report: EvaluationReport = {
    serverUrl: 'https://drift.example/mcp',
    outcome: 'scored',
    finalScore: score,
    toolSurfaceAnalysis: analyzeToolSurface({ tools, resources: [], prompts: [] }),
    sections: {
      protocol: {
        name: 'Protocol', description: 'Protocol lifecycle', score: 15, maxScore: 15,
        details: [{ text: 'Negotiated', metadata: {
          protocolEra, protocolVersion, endpoint: 'https://drift.example/mcp', route: 'direct',
        } }],
      },
      capabilities: {
        name: 'Capabilities', description: 'Discovery', score: 10, maxScore: 10,
        details: [{ text: 'Tools listed', metadata: { method: 'tools/list', itemCount: tools.length } }],
      },
      transport: {
        name: 'Transport', description: 'Transport', score: transport === 'streamable-http' ? 15 : 6, maxScore: 15,
        details: [{ text: 'Transport negotiated', metadata: { transportType: transport, protocolEra } }],
      },
      performance: {
        name: 'Performance', description: 'Latency', score: 15, maxScore: 15,
        details: [{ text: 'Measured', metadata: { durationMs: latency } }],
      },
    },
  };
  return createPublicReport(report, {
    generatedAt,
    ...(oauthMetadata ? {
      oauthTrace: {
        version: 1,
        traceId: `trace-${generatedAt}`,
        targetFingerprint: 'target-fingerprint',
        targetUrl: report.serverUrl,
        startedAt: generatedAt,
        events: [{
          sequence: 1,
          type: 'authorization_server_metadata',
          outcome: 'succeeded',
          timestamp: generatedAt,
          provenance: 'authorization_server',
          route: 'direct',
          explanation: 'Metadata loaded.',
          response: { status: 200, metadata: oauthMetadata },
        }],
      },
    } : {}),
  });
};

const inputSchema = (properties: Record<string, unknown>, required = ['query']) => ({
  type: 'object', properties, required, additionalProperties: false,
});

const tool = (schema: unknown) => ({
  name: 'search', description: 'Search records by query.', inputSchema: schema,
});

describe('semantic report drift', () => {
  it('classifies an additive optional input as compatible', () => {
    const before = artifact({ tools: [tool(inputSchema({ query: { type: 'string' } }))] });
    const after = artifact({
      generatedAt: '2026-08-11T20:01:00.000Z',
      tools: [tool(inputSchema({ query: { type: 'string' }, limit: { type: 'number' } }))],
    });

    const diff = diffPublicReports(before, after);

    expect(diff.changes).toContainEqual(expect.objectContaining({
      classification: 'addition',
      title: 'search added optional input limit',
      breaking: false,
    }));
    expect(diff.hasBreakingChanges).toBe(false);
  });

  it('classifies a newly required input as breaking', () => {
    const properties = { query: { type: 'string' }, tenant: { type: 'string' } };
    const before = artifact({ tools: [tool(inputSchema(properties, ['query']))] });
    const after = artifact({
      generatedAt: '2026-08-11T20:01:00.000Z',
      tools: [tool(inputSchema(properties, ['query', 'tenant']))],
    });

    expect(diffPublicReports(before, after).changes[0]).toEqual(expect.objectContaining({
      classification: 'breaking',
      title: 'search.tenant became required',
    }));
  });

  it('classifies tool and input removals as breaking removals', () => {
    const before = artifact({ tools: [
      tool(inputSchema({ query: { type: 'string' }, limit: { type: 'number' } })),
      { name: 'delete_record', description: 'Delete one record.', inputSchema: { type: 'object' } },
    ] });
    const after = artifact({
      generatedAt: '2026-08-11T20:01:00.000Z',
      tools: [tool(inputSchema({ query: { type: 'string' } }))],
    });
    const diff = diffPublicReports(before, after);

    expect(diff.changes).toEqual(expect.arrayContaining([
      expect.objectContaining({ classification: 'removal', title: 'Tool removed: delete_record', breaking: true }),
      expect.objectContaining({ classification: 'removal', title: 'search removed input limit', breaking: true }),
    ]));
  });

  it('classifies input type changes as breaking', () => {
    const before = artifact({ tools: [tool(inputSchema({ query: { type: 'string' } }))] });
    const after = artifact({
      generatedAt: '2026-08-11T20:01:00.000Z',
      tools: [tool(inputSchema({ query: { type: 'array', items: { type: 'string' } } }))],
    });

    expect(diffPublicReports(before, after).changes).toContainEqual(expect.objectContaining({
      classification: 'breaking', title: 'search input type changed',
      path: 'tools.search.inputSchema.properties.query.type',
    }));
  });

  it('prioritizes transport regressions ahead of score changes', () => {
    const before = artifact();
    const after = artifact({
      generatedAt: '2026-08-11T20:01:00.000Z', transport: 'legacy-sse', score: 46,
    });
    const diff = diffPublicReports(before, after);

    expect(diff.changes[0]).toEqual(expect.objectContaining({
      category: 'transport', classification: 'breaking', title: 'Transport changed',
    }));
    expect(diff.changes.findIndex((change) => change.category === 'score')).toBeGreaterThan(0);
  });

  it('reports OAuth metadata changes as authentication risk changes', () => {
    const before = artifact({ oauthMetadata: {
      issuer: 'https://auth.example', scopes_supported: ['read'],
    } });
    const after = artifact({
      generatedAt: '2026-08-11T20:01:00.000Z',
      oauthMetadata: { issuer: 'https://auth.example', scopes_supported: ['read', 'write'] },
    });

    expect(diffPublicReports(before, after).changes[0]).toEqual(expect.objectContaining({
      category: 'authentication', classification: 'risk',
      title: 'OAuth metadata changed: authorization_server_metadata',
    }));
  });

  it('compares stateful and stateless protocol results without treating them as unavailable', () => {
    const stateful = artifact({ protocolEra: 'legacy', protocolVersion: '2025-11-25' });
    const stateless = artifact({
      generatedAt: '2026-08-11T20:01:00.000Z',
      protocolEra: 'modern', protocolVersion: '2026-07-28',
    });
    const diff = diffPublicReports(stateful, stateless);

    expect(diff.changes).toContainEqual(expect.objectContaining({
      category: 'protocol', classification: 'change', title: 'Protocol lifecycle changed',
    }));
    expect(diff.changes).not.toContainEqual(expect.objectContaining({
      category: 'protocol', classification: 'unknown',
    }));
  });

  it('is deterministic for the same pair of artifacts', () => {
    const before = artifact();
    const after = artifact({
      generatedAt: '2026-08-11T20:01:00.000Z', latency: 500,
      tools: [tool(inputSchema({ query: { type: 'number' }, limit: { type: 'number' } }))],
    });
    expect(diffPublicReports(before, after)).toEqual(diffPublicReports(before, after));
  });
});
