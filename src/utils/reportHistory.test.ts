import { describe, expect, it } from 'vitest';
import type { EvaluationReport } from './evaluation';
import {
  REPORT_HISTORY_STORAGE_KEY,
  REPORT_SNAPSHOT_RETENTION_PER_ENDPOINT,
  REPORT_SNAPSHOT_RETENTION_TOTAL,
  createReportSnapshot,
  deleteAllReportSnapshots,
  deleteReportSnapshot,
  loadReportSnapshots,
  serializeReportSnapshotHistory,
  snapshotsForEndpoint,
  storeReportSnapshot,
  type ReportSnapshotV1,
} from './reportHistory';
import { analyzeToolSurface } from './toolSurfaceAnalysis';

class MemoryStorage implements Storage {
  private values = new Map<string, string>();
  get length() { return this.values.size; }
  clear() { this.values.clear(); }
  getItem(key: string) { return this.values.get(key) ?? null; }
  key(index: number) { return [...this.values.keys()][index] ?? null; }
  removeItem(key: string) { this.values.delete(key); }
  setItem(key: string, value: string) { this.values.set(key, value); }
}

const report = (serverUrl = 'https://history.example/mcp'): EvaluationReport => ({
  serverUrl,
  outcome: 'scored',
  finalScore: 55,
  toolSurfaceAnalysis: analyzeToolSurface([{
    name: 'search',
    description: 'Search with Authorization: Bearer history-secret',
    inputSchema: {
      type: 'object',
      properties: {
        access_token: { $ref: '#/$defs/public' },
      },
      $defs: {
        public: { type: 'string', const: 'schema-secret' },
      },
    },
  }]),
  sections: {
    protocol: {
      name: 'Protocol', description: 'Protocol', score: 15, maxScore: 15,
      details: [{ text: 'Negotiated', metadata: {
        protocolEra: 'modern', protocolVersion: '2026-07-28',
        transportType: 'streamable-http', endpoint: serverUrl, route: 'direct',
      } }],
    },
    capabilities: {
      name: 'Capabilities', description: 'Capabilities', score: 10, maxScore: 10,
      details: [{ text: 'Listed tools', metadata: { method: 'tools/list', itemCount: 1 } }],
    },
    transport: {
      name: 'Transport', description: 'Transport', score: 15, maxScore: 15,
      details: [{ text: 'Connected', metadata: { transportType: 'streamable-http' } }],
    },
    performance: {
      name: 'Performance', description: 'Performance', score: 15, maxScore: 15,
      details: [{ text: 'Fast', metadata: { durationMs: 100 } }],
    },
  },
});

describe('report snapshot history', () => {
  it('stores only redacted public artifacts', () => {
    const storage = new MemoryStorage();
    const snapshot = createReportSnapshot(
      report('https://history.example/mcp?access_token=url-secret'),
      undefined,
      '2026-08-11T20:00:00.000Z'
    );
    storeReportSnapshot(snapshot, storage);
    const stored = storage.getItem(REPORT_HISTORY_STORAGE_KEY) || '';

    expect(stored).toContain('[REDACTED]');
    expect(stored).not.toContain('url-secret');
    expect(stored).not.toContain('history-secret');
    expect(stored).not.toContain('schema-secret');
    const loaded = loadReportSnapshots(storage);
    expect(loaded).toHaveLength(1);
    expect(loaded[0].report.toolSurfaceAnalysis?.toolDefinitions?.tools[0].inputSchema).toEqual({
      properties: {
        access_token: '[REDACTED]',
      },
      $defs: {
        public: '[REDACTED]',
      },
      type: 'object',
    });
  });

  it.each([
    ['dependentRequired', { account: ['access_token'] }],
    ['dependencies', { account: ['access_token'] }],
  ] as const)('does not store credentials declared through %s', (keyword, declaration) => {
    const credential = '0000';
    const unsafeReport = report();
    unsafeReport.toolSurfaceAnalysis = analyzeToolSurface([{
      name: 'authenticate',
      inputSchema: {
        type: 'object',
        [keyword]: declaration,
        additionalProperties: { type: 'string', const: credential },
      },
    }]);
    const storage = new MemoryStorage();
    const snapshot = createReportSnapshot(
      unsafeReport,
      undefined,
      '2026-08-11T20:00:00.000Z'
    );

    storeReportSnapshot(snapshot, storage);

    const stored = storage.getItem(REPORT_HISTORY_STORAGE_KEY) || '';
    expect(stored).not.toContain(credential);
    expect(snapshot.report.toolSurfaceAnalysis?.toolDefinitions.status).toBe('partial');
    expect(snapshot.report.toolSurfaceAnalysis?.toolDefinitions.tools[0].inputSchema)
      .toBe('[REDACTED]');
  });

  it('does not serialize a credential constraint split across allOf branches', () => {
    const credential = '1234';
    const unsafeReport = report();
    unsafeReport.toolSurfaceAnalysis = analyzeToolSurface([{
      name: 'authenticate',
      inputSchema: {
        type: 'object',
        allOf: [
          { required: ['access_token'] },
          { additionalProperties: { const: credential } },
        ],
      },
    }]);
    const storage = new MemoryStorage();
    const snapshot = createReportSnapshot(
      unsafeReport,
      undefined,
      '2026-08-11T20:00:00.000Z'
    );

    storeReportSnapshot(snapshot, storage);

    expect(storage.getItem(REPORT_HISTORY_STORAGE_KEY)).not.toContain(credential);
    expect(serializeReportSnapshotHistory([snapshot])).not.toContain(credential);
    expect(snapshot.report.toolSurfaceAnalysis?.toolDefinitions.status).toBe('partial');
    expect(snapshot.report.toolSurfaceAnalysis?.toolDefinitions.tools[0].inputSchema)
      .toBe('[REDACTED]');
  });

  it.each([
    ['exact numeric bounds', { type: 'integer', minimum: 1234, maximum: 1234 }, '1234'],
    ['a regex pattern', { type: 'string', pattern: '^0000$' }, '0000'],
  ] as const)('does not store low-entropy credentials encoded by %s', (
    _constraint,
    credentialSchema,
    credential
  ) => {
    const unsafeReport = report();
    unsafeReport.toolSurfaceAnalysis = analyzeToolSurface([{
      name: 'authenticate',
      inputSchema: {
        type: 'object',
        properties: {
          value: {
            title: 'Authentication PIN',
            ...credentialSchema,
          },
        },
      },
    }]);
    const storage = new MemoryStorage();
    const snapshot = createReportSnapshot(
      unsafeReport,
      undefined,
      '2026-08-11T20:00:00.000Z'
    );

    storeReportSnapshot(snapshot, storage);

    expect(storage.getItem(REPORT_HISTORY_STORAGE_KEY)).not.toContain(credential);
    expect(serializeReportSnapshotHistory([snapshot])).not.toContain(credential);
    expect(snapshot.report.toolSurfaceAnalysis?.toolDefinitions.status).toBe('partial');
  });

  it('drops opaque low-entropy credentials in unrecognized schema extensions from storage and exports', () => {
    const makeSnapshot = (credential: number) => {
      const unsafeReport = report();
      unsafeReport.toolSurfaceAnalysis = analyzeToolSurface([{
        name: 'authenticate',
        inputSchema: { type: 'object' },
      }]);
      const unsafeSnapshot = createReportSnapshot(
        unsafeReport,
        undefined,
        '2026-08-11T20:00:00.000Z'
      );
      const inputSchema = unsafeSnapshot.report.toolSurfaceAnalysis
        ?.toolDefinitions?.tools[0].inputSchema as Record<string, unknown>;
      inputSchema['x-validation-value'] = credential;
      return unsafeSnapshot;
    };
    const snapshot = makeSnapshot(1234);
    const alternate = makeSnapshot(5678);
    const storage = new MemoryStorage();

    const storedSnapshots = storeReportSnapshot(snapshot, storage);
    const alternateStoredSnapshots = storeReportSnapshot(alternate, new MemoryStorage());

    const stored = storage.getItem(REPORT_HISTORY_STORAGE_KEY) || '';
    const exported = serializeReportSnapshotHistory([snapshot]);
    const exportedSnapshots = (JSON.parse(exported) as { snapshots: ReportSnapshotV1[] }).snapshots;
    expect(stored).not.toContain('1234');
    expect(stored).not.toContain('x-validation-value');
    expect(exported).not.toContain('1234');
    expect(exported).not.toContain('x-validation-value');
    expect(storedSnapshots[0].report.toolSurfaceAnalysis?.toolDefinitions.status).toBe('partial');
    expect(storedSnapshots[0].report.toolSurfaceAnalysis?.toolDefinitions.tools[0].inputSchema)
      .toEqual({ type: 'object' });
    expect(exportedSnapshots[0].report.toolSurfaceAnalysis?.toolDefinitions.status).toBe('partial');
    expect(storedSnapshots[0].report.toolSurfaceAnalysis?.fingerprint)
      .toEqual(alternateStoredSnapshots[0].report.toolSurfaceAnalysis?.fingerprint);
  });

  it.each([
    ['type', (credential: string) => ({ type: credential })],
    ['required', (credential: string) => ({ type: 'object', required: credential })],
    ['dependentRequired', (credential: string) => ({
      type: 'object', dependentRequired: { account: credential },
    })],
    ['dependencies', (credential: string) => ({
      type: 'object', dependencies: { account: credential },
    })],
    ['numeric', (credential: string) => ({ type: 'array', minItems: credential })],
    ['boolean', (credential: string) => ({ type: 'string', readOnly: credential })],
  ])('redacts an opaque credential in a malformed %s keyword from storage and exports', (
    keyword,
    schema
  ) => {
    const credential = `opaque-${keyword}-credential-47`;
    const unsafeReport = report();
    unsafeReport.toolSurfaceAnalysis = analyzeToolSurface([{
      name: 'authenticate',
      inputSchema: schema(credential),
    }]);
    const storage = new MemoryStorage();
    const snapshot = createReportSnapshot(
      unsafeReport,
      undefined,
      '2026-08-11T20:00:00.000Z'
    );

    const storedSnapshots = storeReportSnapshot(snapshot, storage);
    const stored = storage.getItem(REPORT_HISTORY_STORAGE_KEY) || '';
    const exported = serializeReportSnapshotHistory([snapshot]);

    expect(snapshot.report.toolSurfaceAnalysis?.toolDefinitions.status).toBe('partial');
    expect(storedSnapshots[0].report.toolSurfaceAnalysis?.toolDefinitions.status).toBe('partial');
    expect(JSON.stringify(snapshot.report.toolSurfaceAnalysis?.toolDefinitions.tools[0].inputSchema))
      .toContain('[REDACTED]');
    expect(stored).not.toContain(credential);
    expect(exported).not.toContain(credential);
  });

  it('retains multiple snapshots per endpoint within documented bounds', () => {
    const storage = new MemoryStorage();
    const base = createReportSnapshot(report(), undefined, '2026-08-11T20:00:00.000Z');
    const stored = Array.from({ length: REPORT_SNAPSHOT_RETENTION_PER_ENDPOINT + 3 }, (_, index) => {
      const createdAt = new Date(Date.UTC(2026, 7, 11, 20, index)).toISOString();
      return { ...base, id: `snapshot-${index}`, createdAt, report: { ...base.report, generatedAt: createdAt } };
    });
    storage.setItem(REPORT_HISTORY_STORAGE_KEY, JSON.stringify(stored));
    const snapshots = loadReportSnapshots(storage);
    expect(snapshots).toHaveLength(REPORT_SNAPSHOT_RETENTION_PER_ENDPOINT);
    expect(snapshots[0].createdAt).toBe('2026-08-11T20:12:00.000Z');
  });

  it('finds redacted snapshots by the raw endpoint credential identity', () => {
    const rawEndpoint = 'https://history.example/mcp?access_token=elm-cobalt-73&tenant=acme';
    const snapshot = createReportSnapshot(
      report(rawEndpoint),
      undefined,
      '2026-08-11T20:00:00.000Z'
    );

    expect(snapshot.endpoint).not.toContain('elm-cobalt-73');
    expect(snapshotsForEndpoint([snapshot], rawEndpoint)).toEqual([snapshot]);
  });

  it('enforces the total history bound across endpoints', () => {
    const storage = new MemoryStorage();
    const base = createReportSnapshot(report(), undefined, '2026-08-11T20:00:00.000Z');
    const stored = Array.from({ length: REPORT_SNAPSHOT_RETENTION_TOTAL + 5 }, (_, index) => {
      const createdAt = new Date(Date.UTC(2026, 7, 11, 20, index)).toISOString();
      const endpoint = `https://history-${index}.example/mcp`;
      return {
        ...base,
        id: `snapshot-${index}`,
        endpoint,
        createdAt,
        report: { ...base.report, generatedAt: createdAt, target: { testedEndpoint: endpoint } },
      };
    });
    storage.setItem(REPORT_HISTORY_STORAGE_KEY, JSON.stringify(stored));
    expect(loadReportSnapshots(storage)).toHaveLength(REPORT_SNAPSHOT_RETENTION_TOTAL);
  });

  it('deletes one snapshot or all history without deleting unrelated app data', () => {
    const storage = new MemoryStorage();
    storage.setItem('mcpSpaces', 'keep-me');
    const first = createReportSnapshot(report(), undefined, '2026-08-11T20:00:00.000Z');
    const second = createReportSnapshot(report(), undefined, '2026-08-11T20:01:00.000Z');
    storeReportSnapshot(first, storage);
    storeReportSnapshot(second, storage);

    expect(deleteReportSnapshot(first.id, storage).map((item) => item.id)).toEqual([second.id]);
    deleteAllReportSnapshots(storage);

    expect(storage.getItem(REPORT_HISTORY_STORAGE_KEY)).toBeNull();
    expect(storage.getItem('mcpSpaces')).toBe('keep-me');
  });

  it('does not overwrite history when reading it fails during snapshot storage', () => {
    const snapshot = createReportSnapshot(report(), undefined, '2026-08-11T20:00:00.000Z');
    const storage = {
      getItem: () => { throw new Error('storage read failed'); },
      setItem: () => { throw new Error('setItem must not be called'); },
      removeItem: () => { throw new Error('removeItem must not be called'); },
    };

    expect(() => storeReportSnapshot(snapshot, storage)).toThrow('storage read failed');
  });

  it('does not mutate history when reading it fails during snapshot deletion', () => {
    const storage = {
      getItem: () => { throw new Error('storage read failed'); },
      setItem: () => { throw new Error('setItem must not be called'); },
      removeItem: () => { throw new Error('removeItem must not be called'); },
    };

    expect(() => deleteReportSnapshot('snapshot-1', storage)).toThrow('storage read failed');
  });

  it('exports bounded redacted history and ignores invalid stored entries', () => {
    const storage = new MemoryStorage();
    storage.setItem(REPORT_HISTORY_STORAGE_KEY, JSON.stringify([{ version: 1, id: 'bad' }]));
    expect(loadReportSnapshots(storage)).toEqual([]);

    const snapshot = createReportSnapshot(report(), undefined, '2026-08-11T20:00:00.000Z');
    const exported = serializeReportSnapshotHistory([snapshot]);
    expect(exported).toContain('mcptest.report-history');
    expect(exported).toContain(`"perEndpoint": ${REPORT_SNAPSHOT_RETENTION_PER_ENDPOINT}`);
    expect(exported).not.toContain('history-secret');
    expect(exported).not.toContain('schema-secret');
  });
});
