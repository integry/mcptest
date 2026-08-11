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
  storeReportSnapshot,
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
        access_token: { type: 'string', default: 'schema-secret' },
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
        access_token: { default: '[REDACTED]', type: 'string' },
      },
      type: 'object',
    });
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
