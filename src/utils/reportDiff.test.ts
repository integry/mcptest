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

  it('classifies widening and removing input type constraints as compatible', () => {
    const stringOnly = artifact({
      tools: [tool(inputSchema({ query: { type: 'string' } }))],
    });
    const nullableString = artifact({
      generatedAt: '2026-08-11T20:01:00.000Z',
      tools: [tool(inputSchema({ query: { type: ['null', 'string'] } }))],
    });
    const unconstrained = artifact({
      generatedAt: '2026-08-11T20:02:00.000Z',
      tools: [tool(inputSchema({ query: {} }))],
    });

    for (const diff of [
      diffPublicReports(stringOnly, nullableString),
      diffPublicReports(nullableString, unconstrained),
    ]) {
      expect(diff.changes).toContainEqual(expect.objectContaining({
        path: 'tools.search.inputSchema.properties.query.type',
        classification: 'change',
        breaking: false,
      }));
      expect(diff.changes).not.toContainEqual(expect.objectContaining({
        path: 'tools.search.inputSchema.properties.query.type',
        classification: 'breaking',
      }));
    }
  });

  it.each([
    ['integer', 'number'],
    [['integer', 'string'], ['number', 'string']],
  ] as const)('treats %j to %j as a compatible numeric widening', (beforeType, afterType) => {
    const before = artifact({
      tools: [tool(inputSchema({ query: { type: beforeType } }))],
    });
    const after = artifact({
      generatedAt: '2026-08-11T20:01:00.000Z',
      tools: [tool(inputSchema({ query: { type: afterType } }))],
    });

    expect(diffPublicReports(before, after).changes).toContainEqual(expect.objectContaining({
      path: 'tools.search.inputSchema.properties.query.type',
      classification: 'change',
      breaking: false,
    }));
  });

  it.each([
    ['number', 'integer'],
    [['number', 'string'], ['integer', 'string']],
  ] as const)('treats %j to %j as a breaking numeric narrowing', (beforeType, afterType) => {
    const before = artifact({
      tools: [tool(inputSchema({ query: { type: beforeType } }))],
    });
    const after = artifact({
      generatedAt: '2026-08-11T20:01:00.000Z',
      tools: [tool(inputSchema({ query: { type: afterType } }))],
    });

    expect(diffPublicReports(before, after).changes).toContainEqual(expect.objectContaining({
      path: 'tools.search.inputSchema.properties.query.type',
      classification: 'breaking',
      breaking: true,
    }));
  });

  it('classifies malformed input type declarations as unknown', () => {
    const before = artifact({ tools: [tool(inputSchema({ query: { type: 'string' } }))] });
    const after = artifact({
      generatedAt: '2026-08-11T20:01:00.000Z',
      tools: [tool(inputSchema({ query: { type: ['string', 42] } }))],
    });

    expect(diffPublicReports(before, after).changes).toContainEqual(expect.objectContaining({
      path: 'tools.search.inputSchema.properties.query.type',
      classification: 'unknown',
      breaking: false,
    }));
  });

  it('does not infer property removals from a malformed properties declaration', () => {
    const before = artifact({ tools: [tool(inputSchema({
      query: { type: 'string' },
      limit: { type: 'number' },
    }))] });
    const after = artifact({
      generatedAt: '2026-08-11T20:01:00.000Z',
      tools: [tool({
        type: 'object', properties: [], required: ['query'], additionalProperties: false,
      })],
    });
    const changes = diffPublicReports(before, after).changes;

    expect(changes).toContainEqual(expect.objectContaining({
      path: 'tools.search.inputSchema.properties', classification: 'unknown', breaking: false,
    }));
    expect(changes).not.toContainEqual(expect.objectContaining({
      path: expect.stringMatching(/inputSchema\.properties\.(query|limit)$/),
      classification: 'removal',
    }));
  });

  it('does not infer newly optional inputs from a malformed required declaration', () => {
    const before = artifact({
      tools: [tool(inputSchema({ query: { type: 'string' } }, ['query']))],
    });
    const after = artifact({
      generatedAt: '2026-08-11T20:01:00.000Z',
      tools: [tool({
        type: 'object',
        properties: { query: { type: 'string' } },
        required: 'query',
        additionalProperties: false,
      })],
    });
    const changes = diffPublicReports(before, after).changes;

    expect(changes).toContainEqual(expect.objectContaining({
      path: 'tools.search.inputSchema.required', classification: 'unknown', breaking: false,
    }));
    expect(changes).not.toContainEqual(expect.objectContaining({
      path: 'tools.search.inputSchema.required.query',
      title: 'search.query is now optional',
    }));
  });

  it('compares prototype-colliding property names as own schema properties', () => {
    const withoutConstructor = artifact({
      tools: [tool(inputSchema({ query: { type: 'string' } }))],
    });
    const withConstructor = artifact({
      generatedAt: '2026-08-11T20:01:00.000Z',
      tools: [tool(inputSchema({
        query: { type: 'string' },
        constructor: { type: 'string' },
      }))],
    });

    expect(diffPublicReports(withoutConstructor, withConstructor).changes).toContainEqual(
      expect.objectContaining({
        path: 'tools.search.inputSchema.properties.constructor',
        classification: 'addition',
      })
    );
    expect(diffPublicReports(withConstructor, withoutConstructor).changes).toContainEqual(
      expect.objectContaining({
        path: 'tools.search.inputSchema.properties.constructor',
        classification: 'removal',
        breaking: true,
      })
    );
  });

  it('classifies adding and removing enum constraints by direction', () => {
    const unrestricted = artifact({
      tools: [tool(inputSchema({ query: { type: 'string' } }))],
    });
    const restricted = artifact({
      generatedAt: '2026-08-11T20:01:00.000Z',
      tools: [tool(inputSchema({ query: { type: 'string', enum: ['public', 'private'] } }))],
    });

    expect(diffPublicReports(unrestricted, restricted).changes).toContainEqual(expect.objectContaining({
      path: 'tools.search.inputSchema.properties.query.enum',
      classification: 'breaking',
      title: 'search now restricts accepted values',
      breaking: true,
    }));
    expect(diffPublicReports(restricted, unrestricted).changes).toContainEqual(expect.objectContaining({
      path: 'tools.search.inputSchema.properties.query.enum',
      classification: 'change',
      title: 'search no longer restricts accepted values',
      breaking: false,
    }));
  });

  it('ignores representation-only schema changes', () => {
    const before = artifact({ tools: [tool({
      type: 'object',
      properties: {
        query: { type: 'string', enum: ['public', 'private'] },
        tenant: { type: 'string' },
      },
      required: ['query', 'tenant'],
    })] });
    const after = artifact({
      generatedAt: '2026-08-11T20:01:00.000Z',
      tools: [tool({
        type: 'object',
        properties: {
          query: { type: 'string', enum: ['private', 'public'] },
          tenant: { type: 'string' },
        },
        required: ['tenant', 'query'],
        additionalProperties: true,
      })],
    });

    expect(diffPublicReports(before, after).changes.filter(({ category }) => category === 'tools'))
      .toEqual([]);
  });

  it('marks description redaction as an uncomparable tool contract', () => {
    const before = artifact({ tools: [{
      ...tool(inputSchema({ query: { type: 'string' } })),
      description: 'Authenticate with access_token=quartz-maple-91',
    }] });
    const after = artifact({
      generatedAt: '2026-08-11T20:01:00.000Z',
      tools: [{
        ...tool(inputSchema({ query: { type: 'string' } })),
        description: 'Authenticate with access_token=cobalt-river-27',
      }],
    });

    expect(before.toolSurfaceAnalysis?.toolDefinitions.status).toBe('partial');
    expect(after.toolSurfaceAnalysis?.toolDefinitions.status).toBe('partial');
    expect(diffPublicReports(before, after).changes).toContainEqual(expect.objectContaining({
      path: 'toolSurfaceAnalysis.toolDefinitions', classification: 'unknown', breaking: false,
    }));
  });

  it('marks example-object redaction as an uncomparable tool contract', () => {
    const withExample = (credential: string) => tool(inputSchema({
      query: {
        type: 'string',
        examples: [{ client_secret: credential }],
      },
    }));
    const before = artifact({ tools: [withExample('quartz-maple-91')] });
    const after = artifact({
      generatedAt: '2026-08-11T20:01:00.000Z',
      tools: [withExample('cobalt-river-27')],
    });

    expect(before.toolSurfaceAnalysis?.toolDefinitions.status).toBe('partial');
    expect(after.toolSurfaceAnalysis?.toolDefinitions.status).toBe('partial');
    expect(diffPublicReports(before, after).changes).toContainEqual(expect.objectContaining({
      path: 'toolSurfaceAnalysis.toolDefinitions', classification: 'unknown', breaking: false,
    }));
  });

  it('reports matching partial tool sets as unknown without using their fingerprints', () => {
    const before = artifact({ tools: [{
      ...tool(inputSchema({ query: { type: 'string' } })),
      description: 'Authenticate with access_token=quartz-maple-91',
    }] });
    const after = artifact({
      generatedAt: '2026-08-11T20:01:00.000Z',
      tools: [{
        ...tool(inputSchema({ query: { type: 'string' } })),
        description: 'Authenticate with access_token=quartz-maple-91',
      }],
    });

    expect(before.toolSurfaceAnalysis?.fingerprint.value)
      .toBe(after.toolSurfaceAnalysis?.fingerprint.value);
    expect(diffPublicReports(before, after).changes).toContainEqual(expect.objectContaining({
      path: 'toolSurfaceAnalysis.toolDefinitions', classification: 'unknown', breaking: false,
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

  it('classifies a transport upgrade as compatible', () => {
    const before = artifact({ transport: 'legacy-sse' });
    const after = artifact({
      generatedAt: '2026-08-11T20:01:00.000Z', transport: 'streamable-http',
    });

    expect(diffPublicReports(before, after).changes).toContainEqual(expect.objectContaining({
      path: 'transport.type', classification: 'change', title: 'Transport changed', breaking: false,
    }));
  });

  it('classifies unavailable transport data as unknown', () => {
    const before = artifact();
    const after = artifact({ generatedAt: '2026-08-11T20:01:00.000Z' });
    delete after.transport;

    expect(diffPublicReports(before, after).changes).toContainEqual(expect.objectContaining({
      path: 'transport.type', classification: 'unknown',
      title: 'Transport changed', breaking: false,
    }));
  });

  it.each(['partial', 'failed'] as const)(
    'classifies a route lost during a %s run as unknown',
    (outcome) => {
      const before = artifact();
      const after = artifact({ generatedAt: '2026-08-11T20:01:00.000Z' });
      after.provenance = { route: 'unknown', proxyUsed: null };
      after.outcome = { status: outcome, summary: `The evaluation was ${outcome}.` };
      after.score = null;

      expect(diffPublicReports(before, after).changes).toContainEqual(expect.objectContaining({
        path: 'provenance.route', classification: 'unknown', breaking: false,
      }));
    }
  );

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

  it('classifies OAuth observations missing from a failed run as unknown', () => {
    const before = artifact({ oauthMetadata: { issuer: 'https://auth.example' } });
    const after = artifact({ generatedAt: '2026-08-11T20:01:00.000Z' });
    after.outcome = { status: 'failed', summary: 'The evaluation did not complete.' };
    after.score = null;

    expect(diffPublicReports(before, after).changes).toContainEqual(expect.objectContaining({
      path: 'oauth.authorization_server_metadata', classification: 'unknown', breaking: false,
    }));
  });

  it('classifies capabilities missing from a partial run as unknown', () => {
    const before = artifact();
    const after = artifact({ generatedAt: '2026-08-11T20:01:00.000Z' });
    const capabilities = after.sections.find(({ id }) => id === 'capabilities')!;
    capabilities.status = 'partial';
    capabilities.evidence = [];
    after.outcome = { status: 'partial', summary: 'The evaluation was partial.' };
    after.score = null;

    expect(diffPublicReports(before, after).changes).toContainEqual(expect.objectContaining({
      path: 'capabilities.tools/list', classification: 'unknown', breaking: false,
    }));
    expect(diffPublicReports(before, after).changes).not.toContainEqual(expect.objectContaining({
      path: 'capabilities.tools/list', classification: 'removal',
    }));
  });

  it('classifies protocol data unavailable after a failed run as unknown', () => {
    const before = artifact();
    const after = artifact({ generatedAt: '2026-08-11T20:01:00.000Z' });
    delete after.protocol;
    after.sections.find(({ id }) => id === 'protocol')!.status = 'failed';
    after.outcome = { status: 'failed', summary: 'The evaluation did not complete.' };
    after.score = null;

    expect(diffPublicReports(before, after).changes).toEqual(expect.arrayContaining([
      expect.objectContaining({ path: 'protocol.era', classification: 'unknown', breaking: false }),
      expect.objectContaining({ path: 'protocol.version', classification: 'unknown', breaking: false }),
    ]));
  });

  it.each(['partial', 'failed'] as const)(
    'does not resolve tool findings after a %s run',
    (outcome) => {
      const before = artifact();
      const after = artifact({ generatedAt: '2026-08-11T20:01:00.000Z' });
      const finding: NonNullable<PublicReport['toolSurfaceAnalysis']>['findings']['medium'][number] = {
        id: 'tool-source-check',
        category: 'schema-quality',
        severity: 'medium',
        kind: 'quality-signal',
        title: 'Tool schema needs review',
        summary: 'The tool schema needs review.',
        evidence: [],
        omittedEvidenceCount: 0,
        remediation: 'Review the tool schema.',
      };
      before.toolSurfaceAnalysis!.findings.medium.push(finding);
      before.toolSurfaceAnalysis!.findingCount += 1;
      after.outcome = { status: outcome, summary: `The evaluation was ${outcome}.` };
      after.score = null;
      const capabilities = after.sections.find(({ id }) => id === 'capabilities')!;
      capabilities.status = outcome;

      const change = diffPublicReports(before, after).changes.find(
        ({ path }) => path === 'findings.tool:tool-source-check'
      );

      expect(change).toEqual(expect.objectContaining({
        classification: 'unknown',
        title: 'Finding is not comparable: Tool schema needs review',
        breaking: false,
      }));
      expect(change?.title).not.toContain('resolved');
    }
  );

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
