import { describe, expect, it } from 'vitest';
import { diffInterfaceSnapshots, type InterfaceChangeKind } from './reportDiff';
import {
  INTERFACE_SNAPSHOT_SCHEMA_BUDGET,
  INTERFACE_SNAPSHOT_STORAGE_KEY,
  createInterfaceSnapshot,
  interfaceSnapshotFromReport,
  loadInterfaceSnapshot,
  loadPreviousInterfaceSnapshot,
  storeInterfaceSnapshot,
  type LiveInterfaceInput,
} from './interfaceSnapshot';
import { REPORT_HISTORY_STORAGE_KEY } from './reportHistory';
import type { PublicReport } from './reportArtifact';

const baseInput = (): LiveInterfaceInput => ({
  tools: [
    {
      name: 'search',
      description: 'Search documents',
      inputSchema: {
        type: 'object',
        properties: { query: { type: 'string' }, limit: { type: 'integer' } },
        required: ['query'],
      },
      outputSchema: { type: 'object', properties: { hits: { type: 'array' } } },
    },
    { name: 'fetch', description: 'Fetch a document', inputSchema: { type: 'object', properties: { id: { type: 'string' } } } },
  ],
  resources: [{ name: 'readme', uri: 'file:///readme.md' }],
  resourceTemplates: [{ name: 'doc', uriTemplate: 'docs://{id}' }],
  prompts: [{ name: 'summarize' }],
  protocolVersion: '2025-06-18',
  transport: 'streamable-http',
  observedAt: '2026-10-01T12:00:00.000Z',
});

const snapshot = (mutate: (input: LiveInterfaceInput) => void = () => {}) => {
  const input = baseInput();
  mutate(input);
  return createInterfaceSnapshot(input);
};

const kinds = (mutate: (input: LiveInterfaceInput) => void): InterfaceChangeKind[] => (
  diffInterfaceSnapshots(snapshot(), snapshot(mutate)).changes.map((change) => change.kind)
);

const tool = (input: LiveInterfaceInput, name: string) => (
  input.tools.find((candidate) => (candidate as { name: string }).name === name) as Record<string, any>
);

const memoryStorage = () => {
  const values = new Map<string, string>();
  return {
    getItem: (key: string) => values.get(key) ?? null,
    setItem: (key: string, value: string) => { values.set(key, value); },
    removeItem: (key: string) => { values.delete(key); },
  };
};

describe('diffInterfaceSnapshots', () => {
  it('reports nothing for an unchanged server', () => {
    const diff = diffInterfaceSnapshots(snapshot(), snapshot());
    expect(diff.changes).toEqual([]);
    expect(diff.hasBreakingChanges).toBe(false);
    expect(diff.beforeObservedAt).toBe('2026-10-01T12:00:00.000Z');
    expect(diff.beforeSource).toBe('playground');
  });

  it('reports added and removed tools, removals as breaking', () => {
    const diff = diffInterfaceSnapshots(snapshot(), snapshot((input) => {
      input.tools = [tool(input, 'search'), { name: 'delete', inputSchema: { type: 'object' } }];
    }));
    expect(diff.changes.map((change) => [change.kind, change.subject])).toEqual([
      ['tool-removed', 'fetch'],
      ['tool-added', 'delete'],
    ]);
    expect(diff.counts['tool-removed']).toBe(1);
    expect(diff.hasBreakingChanges).toBe(true);
  });

  it('reports description and title changes', () => {
    expect(kinds((input) => { tool(input, 'fetch').description = 'Fetch one document by id'; }))
      .toEqual(['description-changed']);
    expect(kinds((input) => { tool(input, 'fetch').title = 'Fetch document'; }))
      .toEqual(['description-changed']);
  });

  it('classifies input schema changes with the report diff rules', () => {
    const diff = diffInterfaceSnapshots(snapshot(), snapshot((input) => {
      tool(input, 'search').inputSchema.required = ['query', 'limit'];
    }));
    expect(diff.changes).toHaveLength(1);
    expect(diff.changes[0]).toMatchObject({
      kind: 'input-schema-changed',
      subject: 'search',
      classification: 'breaking',
      breaking: true,
    });
    expect(diff.changes[0].schemaChanges?.map((change) => change.title)).toEqual(['search.limit became required']);
  });

  it('names redacted schema portions only when nothing comparable changed', () => {
    const withTitle = (input: LiveInterfaceInput) => {
      // A property named like a schema keyword is stored redacted.
      tool(input, 'fetch').inputSchema.properties.title = { type: 'string' };
    };
    const changed = diffInterfaceSnapshots(snapshot(withTitle), snapshot((input) => {
      withTitle(input);
      tool(input, 'fetch').inputSchema.required = ['id'];
    }));
    expect(changed.changes[0].schemaChanges?.map((change) => change.title)).toEqual(['fetch.id became required']);
  });

  it('treats an added optional input as a non-breaking schema change', () => {
    const diff = diffInterfaceSnapshots(snapshot(), snapshot((input) => {
      tool(input, 'fetch').inputSchema.properties.format = { type: 'string' };
    }));
    expect(diff.changes[0]).toMatchObject({ kind: 'input-schema-changed', breaking: false });
  });

  it('reports output schema added, removed and changed', () => {
    expect(kinds((input) => { tool(input, 'search').outputSchema = { type: 'object', properties: { total: { type: 'integer' } } }; }))
      .toEqual(['output-schema-changed']);
    expect(kinds((input) => { delete tool(input, 'search').outputSchema; }))
      .toEqual(['output-schema-changed']);
    const added = diffInterfaceSnapshots(snapshot(), snapshot((input) => {
      tool(input, 'fetch').outputSchema = { type: 'object' };
    }));
    expect(added.changes[0]).toMatchObject({ kind: 'output-schema-changed', classification: 'addition' });
  });

  it('reports resources, resource templates and prompts added or removed', () => {
    expect(kinds((input) => {
      input.resources = [{ name: 'changelog', uri: 'file:///CHANGELOG.md' }];
      input.resourceTemplates = [];
      input.prompts = [{ name: 'summarize' }, { name: 'translate' }];
    })).toEqual(['resource-removed', 'resource-removed', 'resource-added', 'prompt-added']);
    expect(kinds((input) => { input.prompts = []; })).toEqual(['prompt-removed']);
  });

  it('reports protocol version and transport changes, legacy SSE as breaking', () => {
    expect(kinds((input) => { input.protocolVersion = '2025-11-25'; })).toEqual(['protocol-changed']);
    const diff = diffInterfaceSnapshots(snapshot(), snapshot((input) => { input.transport = 'legacy-sse'; }));
    expect(diff.changes[0]).toMatchObject({ kind: 'transport-changed', breaking: true });
  });

  it('does not invent changes for values one snapshot did not record', () => {
    expect(kinds((input) => { input.protocolVersion = null; input.transport = null; })).toEqual([]);
  });

  it('compares schemas by fingerprint when storage kept fingerprints only', () => {
    const before = snapshot();
    const after = snapshot((input) => { tool(input, 'fetch').inputSchema.properties.id.type = 'integer'; });
    const strip = (value: typeof before) => ({
      ...value,
      tools: value.tools!.map(({ inputSchema: _input, outputSchema: _output, ...rest }) => rest),
    });
    const diff = diffInterfaceSnapshots(strip(before), strip(after));
    expect(diff.changes).toHaveLength(1);
    expect(diff.changes[0]).toMatchObject({ kind: 'input-schema-changed', classification: 'change' });
  });
});

describe('interface snapshots', () => {
  it('redacts secrets in descriptions and schema defaults before storage', () => {
    const value = snapshot((input) => {
      tool(input, 'fetch').description = 'Call with Authorization: Bearer sk-proj-abcdefghijklmnopqrstuv';
      tool(input, 'fetch').inputSchema.properties.id.default = 'ghp_abcdefghijklmnopqrstuvwxyz0123456789';
    });
    const serialized = JSON.stringify(value);
    expect(serialized).not.toContain('sk-proj-abcdefghijklmnopqrstuv');
    expect(serialized).not.toContain('ghp_abcdefghijklmnopqrstuvwxyz0123456789');
  });

  it('keeps only fingerprints for very large tool surfaces', () => {
    const value = snapshot((input) => {
      input.tools = Array.from({ length: 400 }, (_, index) => ({
        name: `tool_${index}`,
        inputSchema: {
          type: 'object',
          properties: Object.fromEntries(Array.from({ length: 20 }, (__, field) => [`field_${field}`, { type: 'string', description: 'x'.repeat(40) }])),
        },
      }));
    });
    expect(JSON.stringify(value.tools).length).toBeLessThan(INTERFACE_SNAPSHOT_SCHEMA_BUDGET);
    expect(value.tools?.[0].inputSchema).toBeUndefined();
    expect(value.tools?.[0].inputSchemaFingerprint).toMatch(/^fnv1a-32:/);
  });

  it('stores the newest snapshot per endpoint', () => {
    const storage = memoryStorage();
    storeInterfaceSnapshot('https://MCP.example.com/mcp', snapshot(), storage);
    const later = snapshot((input) => { input.observedAt = '2026-10-02T12:00:00.000Z'; });
    storeInterfaceSnapshot('https://mcp.example.com/mcp', later, storage);
    expect(JSON.parse(storage.getItem(INTERFACE_SNAPSHOT_STORAGE_KEY)!)).toHaveLength(1);
    expect(loadInterfaceSnapshot('https://mcp.example.com/mcp', storage)?.observedAt).toBe('2026-10-02T12:00:00.000Z');
    expect(loadInterfaceSnapshot('https://other.example.com/mcp', storage)).toBeUndefined();
  });

  it('falls back to the latest report snapshot and compares only what the report proves', () => {
    const live = snapshot();
    const report = {
      generatedAt: '2026-09-30T08:00:00.000Z',
      protocol: { era: 'modern', version: '2025-03-26' },
      transport: { type: 'streamable-http' },
      toolSurfaceAnalysis: {
        toolDefinitions: {
          status: 'complete',
          tools: live.tools!
            .filter((candidate) => candidate.name === 'search')
            .map(({ name, description, inputSchema }) => ({ name, description, inputSchema })),
        },
      },
      capabilityInventory: {
        prompts: { status: 'complete', omittedCount: 0, paginationComplete: true, items: [{ name: 'summarize' }] },
        resources: { status: 'partial', omittedCount: 3, paginationComplete: true, items: [] },
      },
    } as unknown as PublicReport;
    const fromReport = interfaceSnapshotFromReport(report);
    expect(fromReport.source).toBe('report');
    expect(fromReport.resources).toBeUndefined();

    const diff = diffInterfaceSnapshots(fromReport, live);
    // The report kept no output schemas, titles or a complete resource list.
    expect(diff.changes.map((change) => change.kind)).toEqual(['tool-added', 'protocol-changed']);
    expect(diff.beforeSource).toBe('report');
  });

  it('prefers the playground snapshot over report history and tolerates bad storage', () => {
    const storage = memoryStorage();
    storage.setItem(INTERFACE_SNAPSHOT_STORAGE_KEY, '{oops');
    storage.setItem(REPORT_HISTORY_STORAGE_KEY, '[]');
    expect(loadPreviousInterfaceSnapshot('https://mcp.example.com/mcp', storage)).toBeUndefined();
    storeInterfaceSnapshot('https://mcp.example.com/mcp', snapshot(), storage);
    expect(loadPreviousInterfaceSnapshot('https://mcp.example.com/mcp', storage)?.source).toBe('playground');
  });
});
