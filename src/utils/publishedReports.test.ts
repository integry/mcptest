import { afterEach, describe, expect, it, vi } from 'vitest';
import type { EvaluationReport } from './evaluation';
import { createReportDownload } from './reportDownloads';
import { createCompatibilityMatrix, createReleaseDecision } from './releaseReadiness';
import {
  PUBLISHED_REPORT_REMOVAL_TOKENS_KEY,
  PublishedReportError,
  createPublishableReportJson,
  deletePublishedReport,
  fetchPublishedReport,
  fetchPublishedReportIndex,
  forgetRemovalToken,
  getPublishedReportsApiBase,
  loadRemovalTokens,
  publishReport,
  saveRemovalToken,
} from './publishedReports';
import {
  normalizePublishedEndpoint,
  parsePublishedReportId,
  publishedEndpointKey,
  publishedReportContentHash,
  publishedReportId,
} from './publishedReportIdentity';

const report = (): EvaluationReport => ({
  serverUrl: 'https://Published.Example/mcp?token=secret#frag',
  outcome: 'scored',
  finalScore: 55,
  sections: {
    protocol: {
      name: 'Protocol', description: 'Protocol', score: 15, maxScore: 15,
      details: [{ text: 'Negotiated', metadata: {
        protocolEra: 'modern', protocolVersion: '2026-07-28', endpoint: 'https://published.example/mcp', route: 'direct',
      } }],
    },
    capabilities: {
      name: 'Capabilities', description: 'Capabilities', score: 10, maxScore: 10,
      details: [{ text: 'Tools', metadata: { method: 'tools/list', itemCount: 1 } }],
    },
    transport: {
      name: 'Transport', description: 'Transport', score: 15, maxScore: 15,
      details: [{ text: 'Connected', metadata: { transportType: 'streamable-http' } }],
    },
    performance: {
      name: 'Performance', description: 'Performance', score: 15, maxScore: 15,
      details: [{ text: 'Fast', metadata: { durationMs: 200 } }],
    },
  },
});

class MemoryStorage {
  private values = new Map<string, string>();
  getItem(key: string) { return this.values.get(key) ?? null; }
  setItem(key: string, value: string) { this.values.set(key, value); }
  removeItem(key: string) { this.values.delete(key); }
}

afterEach(() => {
  vi.unstubAllEnvs();
});

describe('published report identity', () => {
  it('normalizes endpoints and refuses non-public ones', () => {
    expect(normalizePublishedEndpoint(' https://Published.Example/mcp?token=secret#frag ')).toBe('https://published.example/mcp?token=secret');
    expect(normalizePublishedEndpoint('https://user:pw@published.example/mcp')).toBe('https://published.example/mcp');
    expect(normalizePublishedEndpoint('http://localhost:3000/mcp')).toBeUndefined();
    expect(normalizePublishedEndpoint('http://127.0.0.1/mcp')).toBeUndefined();
    expect(normalizePublishedEndpoint('ftp://published.example/mcp')).toBeUndefined();
    expect(normalizePublishedEndpoint('not a url')).toBeUndefined();
  });

  it('derives deterministic ids that ignore run clocks', async () => {
    const key = await publishedEndpointKey('https://published.example/mcp');
    expect(key).toMatch(/^[a-f0-9]{20}$/);
    const base = { artifactType: 'mcptest.report', generatedAt: '2026-10-20T09:00:00.000Z', timings: { checks: [{ name: 'a', durationMs: 1 }] }, outcome: { status: 'scored' } };
    const rerun = { ...base, generatedAt: '2026-10-21T09:00:00.000Z', timings: { checks: [{ name: 'a', durationMs: 9 }] } };
    const changed = { ...base, outcome: { status: 'failed' } };
    const hash = await publishedReportContentHash(base);
    expect(await publishedReportContentHash(rerun)).toBe(hash);
    expect(await publishedReportContentHash(changed)).not.toBe(hash);
    const id = publishedReportId(key, hash);
    expect(parsePublishedReportId(id)).toEqual({ endpointKey: key, contentHashPrefix: hash.slice(0, 20) });
    expect(parsePublishedReportId('nope')).toBeUndefined();
  });
});

describe('publishable artifact', () => {
  it('is byte-for-byte the JSON download', () => {
    const live = report();
    const matrix = createCompatibilityMatrix(live);
    const decision = createReleaseDecision(live, matrix, live.toolSurfaceAnalysis);
    const download = createReportDownload(live, 'json', '2026-10-20T09:00:00.000Z', {
      releaseDecision: decision, compatibilityMatrix: matrix, toolSurfaceAnalysis: live.toolSurfaceAnalysis,
    });
    const published = createPublishableReportJson(live, undefined, '2026-10-20T09:00:00.000Z');
    expect(published).toBe(download.content);
    expect(published).not.toContain('secret');
    expect(JSON.parse(published).target.testedEndpoint).toBe('https://published.example/mcp?token=%5BREDACTED%5D');
  });
});

describe('published report client', () => {
  it('reads the worker base URL from the environment', () => {
    vi.stubEnv('VITE_CLOUDFLARE_WORKER_URL', 'https://worker.test/');
    expect(getPublishedReportsApiBase()).toBe('https://worker.test');
    vi.stubEnv('VITE_CLOUDFLARE_WORKER_URL', '  ');
    expect(getPublishedReportsApiBase()).toBeUndefined();
  });

  it('builds the index, read, publish and delete requests', async () => {
    const calls: Array<{ url: string; init?: RequestInit }> = [];
    const fetchImpl = (async (input: string | URL | Request, init?: RequestInit) => {
      const url = String(input);
      calls.push({ url, init });
      if (init?.method === 'DELETE') return new Response(null, { status: 204 });
      if (init?.method === 'POST') return new Response(JSON.stringify({ id: 'x', removalToken: 't' }), { status: 201 });
      if (url.includes('/r/endpoint/')) return new Response(JSON.stringify({ endpoint: 'https://published.example/mcp', retention: 20, snapshots: [] }));
      return new Response(JSON.stringify({ not: 'a report' }));
    }) as typeof fetch;
    const options = { apiBase: 'https://worker.test/', fetchImpl };

    expect(await fetchPublishedReportIndex('https://Published.Example/mcp#x', options)).toEqual({
      endpoint: 'https://published.example/mcp', retention: 20, snapshots: [],
    });
    expect(calls[0].url).toBe(`https://worker.test/r/endpoint/${encodeURIComponent('https://published.example/mcp')}`);
    expect(await fetchPublishedReportIndex('http://localhost/mcp', options)).toBeUndefined();
    expect(await fetchPublishedReportIndex('https://published.example/mcp', { apiBase: '', fetchImpl })).toBeUndefined();

    await expect(fetchPublishedReport('abc', options)).rejects.toMatchObject({ code: 'invalid_artifact' });
    expect(calls[1].url).toBe('https://worker.test/r/abc');

    expect(await publishReport('{"artifact":true}', options)).toEqual({ id: 'x', removalToken: 't' });
    expect(calls[2].init).toMatchObject({ method: 'POST', body: '{"artifact":true}' });

    await deletePublishedReport('x', 'tok', options);
    expect(calls[3].init?.method).toBe('DELETE');
    expect((calls[3].init?.headers as Record<string, string>)['X-Removal-Token']).toBe('tok');
  });

  it('turns worker error bodies into typed errors', async () => {
    const fetchImpl = (async () => new Response(JSON.stringify({ error: 'rate_limited', message: 'Slow down.' }), { status: 429 })) as typeof fetch;
    const error = await publishReport('{}', { apiBase: 'https://worker.test', fetchImpl }).catch((caught: unknown) => caught);
    expect(error).toBeInstanceOf(PublishedReportError);
    expect(error).toMatchObject({ status: 429, code: 'rate_limited', message: 'Slow down.' });
    await expect(publishReport('{}', { apiBase: '', fetchImpl })).rejects.toMatchObject({ code: 'not_configured' });
  });

  it('keeps removal tokens only in local storage', () => {
    const storage = new MemoryStorage();
    expect(loadRemovalTokens(storage)).toEqual({});
    saveRemovalToken('a', 'token-a', storage);
    saveRemovalToken('b', 'token-b', storage);
    expect(loadRemovalTokens(storage)).toEqual({ a: 'token-a', b: 'token-b' });
    forgetRemovalToken('a', storage);
    expect(loadRemovalTokens(storage)).toEqual({ b: 'token-b' });
    forgetRemovalToken('b', storage);
    expect(storage.getItem(PUBLISHED_REPORT_REMOVAL_TOKENS_KEY)).toBeNull();
    storage.setItem(PUBLISHED_REPORT_REMOVAL_TOKENS_KEY, '[broken');
    expect(loadRemovalTokens(storage)).toEqual({});
  });
});
