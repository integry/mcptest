import { describe, expect, it, vi } from 'vitest';
import {
  assessToolListConsistency,
  canonicalToolListJson,
  clampToolListSamples,
  collectToolListPages,
  diffToolListSamples,
  hashToolList,
  notCheckedToolListConsistency,
  pickInstanceHeaders,
  sampleToolLists,
  type ToolListObservation,
} from './toolListConsistency';
import {
  describeToolListDifference,
  toolListConsistencyFromSections,
  toolListConsistencyPriority,
  toolListConsistencyReportDetail,
} from './toolListConsistencyReport';

const search = {
  name: 'search',
  title: 'Search',
  description: 'Search documents',
  inputSchema: {
    type: 'object',
    properties: { query: { type: 'string', description: 'Query text' }, limit: { type: 'integer' } },
    required: ['query'],
  },
  outputSchema: { type: 'object', properties: { hits: { type: 'array' } } },
  annotations: { readOnlyHint: true, openWorldHint: false },
};
const fetchTool = {
  name: 'fetch',
  description: 'Fetch a document',
  inputSchema: { type: 'object', properties: { id: { type: 'string' } }, required: ['id'] },
};

/** Same definition with every object's keys in reverse order. */
const reverseKeys = (value: unknown): unknown => {
  if (Array.isArray(value)) return value.map(reverseKeys);
  if (value && typeof value === 'object') {
    return Object.fromEntries(Object.entries(value as Record<string, unknown>).reverse()
      .map(([key, child]) => [key, reverseKeys(child)]));
  }
  return value;
};

const context = {
  authentication: 'unauthenticated' as const,
  route: 'direct' as const,
  transportType: 'streamable-http' as const,
  requestedSamples: 3,
};

describe('canonical tool list hashing', () => {
  it('is independent of object key order at every depth', async () => {
    const reordered = reverseKeys([search, fetchTool]) as unknown[];
    expect(JSON.stringify(reordered)).not.toBe(JSON.stringify([search, fetchTool]));
    expect(canonicalToolListJson(reordered)).toBe(canonicalToolListJson([search, fetchTool]));
    expect(await hashToolList(reordered)).toBe(await hashToolList([search, fetchTool]));
  });

  it('is independent of the order tools are listed in', async () => {
    expect(await hashToolList([fetchTool, search])).toBe(await hashToolList([search, fetchTool]));
  });

  it('produces a SHA-256 hash in this runtime', async () => {
    expect(await hashToolList([search])).toMatch(/^sha256:[0-9a-f]{64}$/);
  });

  it('falls back to a non-cryptographic hash without WebCrypto, still detecting changes', async () => {
    vi.stubGlobal('crypto', undefined);
    try {
      const hash = await hashToolList([search]);
      expect(hash).toMatch(/^fnv1a-64:[0-9a-f]{16}$/);
      expect(await hashToolList([{ ...search, description: 'Search all documents' }])).not.toBe(hash);
    } finally {
      vi.unstubAllGlobals();
    }
  });

  it('detects a description-only change', async () => {
    const reworded = { ...search, description: 'Search the documents' };
    expect(await hashToolList([reworded, fetchTool])).not.toBe(await hashToolList([search, fetchTool]));
  });

  it('detects a nested input-schema description change', async () => {
    const changed = {
      ...search,
      inputSchema: {
        ...search.inputSchema,
        properties: { ...search.inputSchema.properties, query: { type: 'string', description: 'Search text' } },
      },
    };
    expect(await hashToolList([changed])).not.toBe(await hashToolList([search]));
  });

  it.each([
    ['title', { title: 'Find' }],
    ['outputSchema', { outputSchema: { type: 'object', properties: { results: { type: 'array' } } } }],
    ['annotations', { annotations: { readOnlyHint: false, openWorldHint: false } }],
  ])('covers %s in the full definition', async (_field, change) => {
    expect(await hashToolList([{ ...search, ...change }])).not.toBe(await hashToolList([search]));
  });

  it('hashes a paginated list the same as the identical unpaginated list', async () => {
    const pages: Record<string, unknown> = {
      start: { tools: [search], nextCursor: 'page-2' },
      'page-2': { tools: [reverseKeys(fetchTool)], nextCursor: 'page-3' },
      'page-3': { tools: [] },
    };
    const fetchPage = vi.fn(async (cursor?: string) => pages[cursor ?? 'start']);
    const paginated = await collectToolListPages(fetchPage);

    expect(fetchPage.mock.calls.map(([cursor]) => cursor)).toEqual([undefined, 'page-2', 'page-3']);
    expect(paginated.pageCount).toBe(3);
    expect(await hashToolList(paginated.tools)).toBe(await hashToolList([search, fetchTool]));
  });

  it('treats a repeated cursor, malformed page or page limit as an incomplete list', async () => {
    await expect(collectToolListPages(async () => ({ tools: [search], nextCursor: 'same' })))
      .rejects.toThrow(/repeated a tools\/list cursor/);
    await expect(collectToolListPages(async () => ({ items: [] }))).rejects.toThrow(/malformed/);
    await expect(collectToolListPages(async () => ({ tools: [], nextCursor: '' }))).rejects.toThrow(/malformed nextCursor/);
    let page = 0;
    await expect(collectToolListPages(async () => ({ tools: [], nextCursor: `c${page++}` }), 4))
      .rejects.toThrow(/4-page/);
  });
});

describe('tool list sample comparison', () => {
  it('reports tools that are present in some samples and changed fields in others', () => {
    const differences = diffToolListSamples([
      { index: 1, tools: [search, fetchTool] },
      { index: 2, tools: [{ ...search, description: 'Search everything', annotations: { readOnlyHint: false } }] },
      { index: 3, tools: [search, fetchTool] },
    ]);
    expect(differences).toEqual([
      { tool: 'fetch', kind: 'presence', presentIn: [1, 3], absentIn: [2], changedFields: [] },
      { tool: 'search', kind: 'definition', presentIn: [1, 2, 3], absentIn: [], changedFields: ['description', 'annotations'] },
    ]);
    expect(differences.map(describeToolListDifference)).toEqual([
      'fetch: listed by requests 1, 3, missing from request 2',
      'search: description, annotations differ between requests',
    ]);
  });

  it('passes identical samples regardless of key order', async () => {
    const result = await assessToolListConsistency([
      { connection: 'evaluation', tools: [search, fetchTool] },
      { connection: 'fresh', tools: reverseKeys([fetchTool, search]) as unknown[] },
      { connection: 'fresh', tools: [search, fetchTool] },
    ], context);
    expect(result.status).toBe('consistent');
    expect(result.distinctHashes).toBe(1);
    expect(result.differences).toEqual([]);
    expect(toolListConsistencyPriority(result)).toBeUndefined();
    expect(toolListConsistencyReportDetail(result).text).toBe(
      '✓ tools/list returned identical definitions on 3 of 3 requests (unauthenticated)'
    );
  });

  it('flags differing samples as a medium-priority non-deterministic finding', async () => {
    const result = await assessToolListConsistency([
      { connection: 'evaluation', tools: [search, fetchTool], instanceHeaders: { 'x-vercel-id': 'fra1::abc' } },
      { connection: 'fresh', tools: [search], instanceHeaders: { 'x-vercel-id': 'iad1::def' } },
    ], { ...context, authentication: 'authenticated' });
    expect(result).toMatchObject({
      status: 'inconsistent',
      authentication: 'authenticated',
      distinctHashes: 2,
      differences: [{ tool: 'fetch', kind: 'presence', presentIn: [1], absentIn: [2] }],
    });
    const priority = toolListConsistencyPriority(result);
    expect(priority).toMatchObject({
      id: 'tools.list-nondeterministic',
      severity: 'medium',
      title: 'Tool list is not deterministic (likely mixed deploy or stale replica)',
      source: 'Evaluation',
    });
    expect(priority?.detail).toContain('fetch: listed by request 1, missing from request 2');
    expect(priority?.detail).toContain('x-vercel-id: fra1::abc');
    expect(priority?.detail).toContain('x-vercel-id: iad1::def');
    const detail = toolListConsistencyReportDetail(result);
    expect(detail.text.startsWith('⚠ Tool list is not deterministic')).toBe(true);
    expect(detail.metadata.findingId).toBe('tools.list-nondeterministic');
  });

  it('does not compare when fewer than two samples completed', async () => {
    const result = await assessToolListConsistency([
      { connection: 'evaluation', tools: [search] },
      { connection: 'fresh', error: new Error('HTTP 503') },
    ], context);
    expect(result.status).toBe('not-checked');
    expect(result.samples[1]).toMatchObject({ status: 'failed', error: 'HTTP 503' });
    expect(result.notCheckedReason).toMatch(/Only one tools\/list request completed/);
    expect(toolListConsistencyPriority(result)).toBeUndefined();
  });

  it('explains when CORS hides instance headers in the browser and when the proxy may supply them', async () => {
    const hidden = await assessToolListConsistency([
      { connection: 'evaluation', tools: [search], crossOrigin: true },
      { connection: 'fresh', tools: [search], crossOrigin: true },
    ], context);
    expect(hidden.headerNote).toMatch(/CORS hides response headers/);
    const proxied = await assessToolListConsistency([
      { connection: 'evaluation', tools: [search], instanceHeaders: { server: 'cloudflare' } },
      { connection: 'fresh', tools: [search] },
    ], { ...context, route: 'proxy' });
    expect(proxied.headerNote).toMatch(/may describe the proxy/);
  });

  it('keeps only allowlisted instance headers with bounded values', () => {
    const headers = new Headers({
      'cf-ray': '8a1b2c3d4e5f-AMS',
      server: `nginx ${'x'.repeat(300)}`,
      'set-cookie': 'session=secret',
      authorization: 'Bearer secret',
    });
    const picked = pickInstanceHeaders(headers);
    expect(Object.keys(picked ?? {})).toEqual(['cf-ray', 'server']);
    expect(picked?.server.length).toBeLessThanOrEqual(128);
    expect(pickInstanceHeaders({ Via: '1.1 varnish' })).toEqual({ via: '1.1 varnish' });
    expect(pickInstanceHeaders(new Headers())).toBeUndefined();
  });

  it('reads the recorded result from evaluation and public report sections', async () => {
    const result = await assessToolListConsistency([
      { connection: 'evaluation', tools: [search] },
      { connection: 'fresh', tools: [search] },
    ], context);
    const detail = toolListConsistencyReportDetail(result);
    expect(toolListConsistencyFromSections({ toolListConsistency: { details: [detail] } })).toEqual(result);
    expect(toolListConsistencyFromSections([{ evidence: [{ metadata: detail.metadata }] }])).toEqual(result);
    expect(toolListConsistencyFromSections({ other: { details: [{ metadata: { toolListConsistency: { version: 2 } } }] } }))
      .toBeUndefined();
  });

  it('ignores schema-valid evidence metadata whose members are null or malformed', async () => {
    const result = await assessToolListConsistency([
      { connection: 'evaluation', tools: [search], instanceHeaders: { 'cf-ray': 'abc-AMS' } },
      { connection: 'fresh', tools: [fetchTool] },
    ], context);
    expect(result.status).toBe('inconsistent');
    const read = (record: unknown) => toolListConsistencyFromSections([{ evidence: [
      { metadata: { toolListConsistency: record } },
    ] }]);
    expect(read(JSON.parse(JSON.stringify(result)))).toEqual(result);
    const malformed: unknown[] = [
      { version: 1, status: 'consistent', samples: [null], differences: [] },
      { ...result, samples: [null] },
      { ...result, samples: [{ ...result.samples[0], status: 7 }] },
      { ...result, samples: [{ ...result.samples[0], connection: 'other' }] },
      { ...result, samples: [{ ...result.samples[0], hash: 42 }] },
      { ...result, samples: [{ ...result.samples[0], instanceHeaders: null }] },
      { ...result, samples: [{ ...result.samples[0], instanceHeaders: { 'cf-ray': { nested: true } } }] },
      { ...result, differences: [null] },
      { ...result, differences: [{ ...result.differences[0], changedFields: null }] },
      { ...result, differences: [{ ...result.differences[0], presentIn: 'all' }] },
      { ...result, authentication: undefined },
      { ...result, notCheckedReason: { text: 'x' } },
    ];
    for (const record of malformed) expect(read(record)).toBeUndefined();
    // A malformed record does not hide a valid one recorded later.
    expect(toolListConsistencyFromSections([{ evidence: [
      { metadata: { toolListConsistency: malformed[0] } },
      { metadata: { toolListConsistency: result } },
    ] }])).toEqual(result);
  });

  it('records a not-checked result without samples', () => {
    expect(notCheckedToolListConsistency(context, 'first list failed')).toMatchObject({
      status: 'not-checked', samples: [], notCheckedReason: 'first list failed',
    });
  });
});

describe('bounded sampling', () => {
  it('clamps the sample count', () => {
    expect(clampToolListSamples(undefined)).toBe(3);
    expect(clampToolListSamples(1)).toBe(2);
    expect(clampToolListSamples(50)).toBe(5);
  });

  it('takes the requested number of follow-up samples with spacing between them', async () => {
    const sleep = vi.fn(async () => undefined);
    const takeSample = vi.fn(async (): Promise<ToolListObservation> => ({ connection: 'fresh', tools: [search] }));
    const observations = await sampleToolLists({ connection: 'evaluation', tools: [search] }, takeSample, {
      samples: 3, spacingMs: 40, sleep,
    });
    expect(observations).toHaveLength(3);
    expect(takeSample).toHaveBeenCalledTimes(2);
    expect(sleep).toHaveBeenCalledTimes(2);
    expect(sleep).toHaveBeenCalledWith(40, undefined);
  });

  it('stops after the first failed follow-up sample', async () => {
    const takeSample = vi.fn()
      .mockRejectedValueOnce(new Error('HTTP 429'))
      .mockResolvedValue({ connection: 'fresh', tools: [search] });
    const observations = await sampleToolLists({ connection: 'evaluation', tools: [search] }, takeSample, {
      samples: 5, sleep: async () => undefined,
    });
    expect(takeSample).toHaveBeenCalledTimes(1);
    expect(observations[1]).toMatchObject({ connection: 'fresh', error: expect.any(Error) });
  });

  it('stops when the signal aborts', async () => {
    const controller = new AbortController();
    const takeSample = vi.fn(async (): Promise<ToolListObservation> => {
      controller.abort();
      return { connection: 'fresh', tools: [search] };
    });
    await sampleToolLists({ connection: 'evaluation', tools: [search] }, takeSample, {
      samples: 5, signal: controller.signal, sleep: async () => undefined,
    });
    expect(takeSample).toHaveBeenCalledTimes(1);
  });
});
