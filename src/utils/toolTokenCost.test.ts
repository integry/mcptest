import { describe, expect, it } from 'vitest';
import {
  CONTEXT_COST_METHOD,
  CONTEXT_COST_THRESHOLDS,
  computeToolContextCost,
  contextCostSummaryLines,
  describeContextCostDelta,
  describeToolContextCostDelta,
  diffSurfaceContextCost,
  diffToolContextCost,
  estimateTextTokens,
  isToolContextCost,
  median,
  sumParts,
} from './toolTokenCost';
import { toolSurfaceFromInterfaceSnapshot } from './breakingChanges';
import { INTERFACE_SNAPSHOT_SCHEMA_BUDGET, createInterfaceSnapshot } from './interfaceSnapshot';

const searchTool = {
  name: 'search_issues',
  title: 'Search issues',
  description: 'Search issues in a repository by text query.',
  inputSchema: {
    type: 'object',
    additionalProperties: false,
    properties: {
      query: { type: 'string', description: 'Full-text query.' },
      state: { type: 'string', enum: ['open', 'closed', 'all'] },
      limit: { type: 'integer', minimum: 1, maximum: 100 },
    },
    required: ['query'],
  },
  outputSchema: { type: 'object', properties: { items: { type: 'array' } } },
  annotations: { readOnlyHint: true, openWorldHint: false },
  _meta: { 'example.com/version': 2 },
};

const tool = (name: string, description: string, properties: Record<string, unknown> = {}) => ({
  name,
  description,
  inputSchema: { type: 'object', properties },
});

describe('estimateTextTokens', () => {
  it('is zero only for empty text and grows with content', () => {
    expect(estimateTextTokens('')).toBe(0);
    expect(estimateTextTokens('a')).toBe(1);
    const short = estimateTextTokens('Search issues by text.');
    const long = estimateTextTokens('Search issues in a repository by text query, label, assignee and milestone.');
    expect(short).toBeGreaterThan(0);
    expect(long).toBeGreaterThan(short);
  });

  it('counts English words and JSON punctuation close to BPE tokenizers', () => {
    // cl100k_base and o200k_base both give 10 and 14 tokens for these strings.
    expect(estimateTextTokens('Returns the current weather conditions for a specified city.')).toBeGreaterThanOrEqual(9);
    expect(estimateTextTokens('Returns the current weather conditions for a specified city.')).toBeLessThanOrEqual(13);
    expect(estimateTextTokens('{"type":"object","properties":{"city":{"type":"string"}}}')).toBeGreaterThanOrEqual(14);
    expect(estimateTextTokens('{"type":"object","properties":{"city":{"type":"string"}}}')).toBeLessThanOrEqual(22);
  });

  it('samples very long text instead of scanning all of it', () => {
    const text = 'word '.repeat(400_000);
    const estimate = estimateTextTokens(text);
    expect(estimate).toBeGreaterThan(350_000);
    expect(estimate).toBeLessThan(500_000);
  });
});

describe('computeToolContextCost', () => {
  it('splits a tool into parts that add up to the tool and tools that add up to the total', () => {
    const cost = computeToolContextCost([searchTool, tool('get_issue', 'Get one issue.', { number: { type: 'integer' } })]);
    const search = cost.tools.find((entry) => entry.name === 'search_issues')!;

    expect(cost.method).toEqual(CONTEXT_COST_METHOD);
    expect(search.parts.nameDescription).toBeGreaterThan(0);
    expect(search.parts.parameters).toBeGreaterThan(0);
    expect(search.parts.inputSchema).toBeGreaterThan(0);
    expect(search.parts.outputSchema).toBeGreaterThan(0);
    expect(search.parts.annotations).toBeGreaterThan(0);
    expect(search.parts.other).toBeGreaterThan(0);
    for (const entry of cost.tools) {
      expect(sumParts(entry.parts)).toBe(entry.estimate);
      expect(entry.parameters.reduce((sum, parameter) => sum + parameter.estimate, 0)).toBe(entry.parts.parameters);
    }
    expect(cost.tools.reduce((sum, entry) => sum + entry.estimate, 0)).toBe(cost.estimatedTotal);
    expect(search.parameters.map((parameter) => parameter.name).sort()).toEqual(['limit', 'query', 'state']);
    expect(search.parameters.find((parameter) => parameter.name === 'query')?.required).toBe(true);
    expect(search.parameters.find((parameter) => parameter.name === 'limit')?.required).toBe(false);
  });

  it('estimates within the calibration band of the compact JSON as a whole', () => {
    const cost = computeToolContextCost([searchTool]);
    const whole = estimateTextTokens(JSON.stringify(searchTool));
    expect(Math.abs(cost.estimatedTotal - whole) / whole).toBeLessThan(0.15);
  });

  it('ranks tools heaviest first with shares, the median and a stable tie order', () => {
    const cost = computeToolContextCost([
      tool('b_small', 'Small.'),
      tool('heavy', 'A much longer description that explains in detail what the tool does and when to use it.'),
      tool('a_small', 'Small.'),
    ]);
    expect(cost.tools.map((entry) => entry.name)).toEqual(['heavy', 'a_small', 'b_small']);
    expect(cost.medianPerTool).toBe(cost.tools[1].estimate);
    expect(cost.tools[0].share).toBeGreaterThan(cost.tools[1].share);
    expect(cost.tools.reduce((sum, entry) => sum + entry.share, 0)).toBeCloseTo(1, 3);
  });

  it('bounds the stored lists but keeps every tool in the totals', () => {
    const many = Array.from({ length: 30 }, (_, index) => tool(`tool_${index}`, 'x '.repeat(index + 1), Object.fromEntries(
      Array.from({ length: 20 }, (__, parameter) => [`p${parameter}`, { type: 'string' }])
    )));
    const full = computeToolContextCost(many, { toolLimit: Number.POSITIVE_INFINITY, parameterLimit: Number.POSITIVE_INFINITY });
    const bounded = computeToolContextCost(many, { toolLimit: 10, parameterLimit: 5 });

    expect(bounded.estimatedTotal).toBe(full.estimatedTotal);
    expect(bounded.toolCount).toBe(30);
    expect(bounded.tools).toHaveLength(10);
    expect(bounded.omittedToolCount).toBe(20);
    expect(bounded.tools[0].parameters).toHaveLength(5);
    expect(bounded.tools[0].parameterCount).toBe(20);
    expect(bounded.tools[0].omittedParameterCount).toBe(15);
    // The part total still covers the parameters that are not listed.
    expect(bounded.tools[0].parts.parameters).toBe(full.tools[0].parts.parameters);
  });

  it('handles empty, malformed and unnamed definitions', () => {
    expect(computeToolContextCost([])).toMatchObject({ estimatedTotal: 0, toolCount: 0, medianPerTool: 0, tools: [], findings: [] });
    const cost = computeToolContextCost(['not a tool', { description: 'No name.' }, { name: 'raw', inputSchema: 'oops' }]);
    expect(cost.toolCount).toBe(3);
    expect(cost.tools.map((entry) => entry.name)).toContain('<tool 2>');
    expect(cost.tools.find((entry) => entry.name === 'raw')?.parts.inputSchema).toBeGreaterThan(0);
    for (const entry of cost.tools) expect(sumParts(entry.parts)).toBe(entry.estimate);
  });

  it('is deterministic and stays readable through JSON', () => {
    const first = computeToolContextCost([searchTool]);
    const second = computeToolContextCost([JSON.parse(JSON.stringify(searchTool))]);
    expect(second).toEqual(first);
    expect(isToolContextCost(JSON.parse(JSON.stringify(first)))).toBe(true);
    expect(isToolContextCost({ estimatedTotal: 1 })).toBe(false);
    expect(isToolContextCost(undefined)).toBe(false);
  });
});

describe('context-cost findings', () => {
  const ids = (cost: ReturnType<typeof computeToolContextCost>) => cost.findings.map((finding) => finding.id);

  it('reports nothing for a small, balanced surface', () => {
    const cost = computeToolContextCost([searchTool, tool('get_issue', 'Get one issue by number.'), tool('close_issue', 'Close an issue.')]);
    expect(cost.findings).toEqual([]);
  });

  it('reports a total at the documented thresholds', () => {
    const surface = (count: number) => Array.from({ length: count }, (_, index) => tool(
      `tool_${index}`,
      'Reads one record from the store and returns its fields, timestamps and links. '.repeat(4)
    ));
    const perTool = computeToolContextCost(surface(1)).estimatedTotal;
    const low = computeToolContextCost(surface(Math.ceil(CONTEXT_COST_THRESHOLDS.total.low / perTool)));
    const high = computeToolContextCost(surface(Math.ceil(CONTEXT_COST_THRESHOLDS.total.high / perTool)));

    expect(low.findings.find((finding) => finding.id === 'context-cost.total-above-threshold')?.severity).toBe('low');
    expect(high.findings.find((finding) => finding.id === 'context-cost.total-above-threshold')).toMatchObject({
      severity: 'high',
      summary: expect.stringContaining('20,000 threshold'),
      remediation: expect.stringContaining('defer'),
    });
    expect(ids(high)).not.toContain('context-cost.dominant-tool');
  });

  it('reports a dominant tool and its dominant parameter with concrete advice', () => {
    const huge = tool('export_everything', 'Exports data.', {
      filter: { type: 'string', description: 'Filter expression. '.repeat(400) },
      format: { type: 'string' },
    });
    const cost = computeToolContextCost([huge, tool('a', 'Small tool.'), tool('b', 'Small tool.'), tool('c', 'Small tool.')]);
    const dominant = cost.findings.find((finding) => finding.id === 'context-cost.dominant-tool');
    const parameter = cost.findings.find((finding) => finding.id === 'context-cost.dominant-parameter');

    expect(dominant).toMatchObject({ subject: 'export_everything', severity: 'medium' });
    expect(dominant?.summary).toContain('filter');
    expect(dominant?.remediation).toMatch(/Shorten the description/);
    expect(dominant?.remediation).toMatch(/split the tool/);
    expect(parameter).toMatchObject({ subject: 'export_everything.filter', severity: 'low' });
    expect(parameter?.remediation).toMatch(/Shorten the parameter description/);
  });

  it('reports a heavy tool on a small server without calling it dominant', () => {
    const cost = computeToolContextCost([tool('only', 'Explains everything in detail. '.repeat(500))]);
    expect(ids(cost)).toContain('context-cost.heavy-tool');
    expect(ids(cost)).not.toContain('context-cost.dominant-tool');
  });

  it('reports descriptions that repeat their enum values', () => {
    const cost = computeToolContextCost([tool('list_runs', 'List runs.', {
      status: {
        type: 'string',
        enum: ['queued', 'running', 'succeeded', 'failed'],
        description: 'One of queued, running, succeeded or failed.',
      },
      kinds: {
        type: 'array',
        items: { type: 'string', enum: ['build', 'test', 'deploy'] },
        description: 'Kinds to include.',
      },
    })]);
    const finding = cost.findings.find((entry) => entry.id === 'context-cost.redundant-enum-text');
    expect(finding).toMatchObject({ severity: 'info', subject: 'list_runs.status' });
    expect(finding?.remediation).toMatch(/Keep the enum/);
  });

  it('labels every finding as an estimate with the method label', () => {
    const cost = computeToolContextCost([tool('only', 'Explains everything in detail. '.repeat(500))]);
    for (const finding of cost.findings.filter((entry) => entry.id !== 'context-cost.redundant-enum-text')) {
      expect(finding.summary).toContain(CONTEXT_COST_METHOD.label);
    }
  });
});

describe('diffToolContextCost', () => {
  const before = computeToolContextCost([
    tool('search', 'Search.', { query: { type: 'string' } }),
    tool('get', 'Get one.'),
    tool('legacy', 'Old tool.'),
  ]);
  const after = computeToolContextCost([
    tool('search', 'Search issues by text, label and assignee.', { query: { type: 'string' }, label: { type: 'string' } }),
    tool('get', 'Get one.'),
    tool('close', 'Close an issue.'),
  ]);

  it('reports the overall and per-tool change, largest first, skipping unchanged tools', () => {
    const delta = diffToolContextCost(before, after)!;
    expect(delta.before).toBe(before.estimatedTotal);
    expect(delta.after).toBe(after.estimatedTotal);
    expect(delta.delta).toBe(after.estimatedTotal - before.estimatedTotal);
    expect(delta.complete).toBe(true);
    expect(delta.tools.map((entry) => entry.name).sort()).toEqual(['close', 'legacy', 'search']);
    expect(delta.tools.find((entry) => entry.name === 'close')).toMatchObject({ status: 'added', before: 0 });
    expect(delta.tools.find((entry) => entry.name === 'legacy')).toMatchObject({ status: 'removed', after: 0 });
    expect(delta.tools.find((entry) => entry.name === 'search')?.status).toBe('changed');
    // Per-tool deltas account for the whole change when every tool is listed.
    expect(delta.tools.reduce((sum, entry) => sum + entry.delta, 0)).toBe(delta.delta);
    const magnitudes = delta.tools.map((entry) => Math.abs(entry.delta));
    expect(magnitudes).toEqual([...magnitudes].sort((left, right) => right - left));
  });

  it('describes the change for people', () => {
    const delta = diffToolContextCost(before, after)!;
    expect(describeContextCostDelta(delta)).toMatch(/^≈\d+ → ≈\d+ estimated tokens \(\+\d+, \+\d+%\)$/);
    expect(describeToolContextCostDelta({ name: 'close', status: 'added', before: 0, after: 12, delta: 12 }))
      .toBe('close: added (≈12, +12)');
    expect(describeToolContextCostDelta({ name: 'search', status: 'changed', before: 10, after: 7, delta: -3 }))
      .toBe('search: ≈10 → ≈7 (−3)');
  });

  it('refuses to compare different methods', () => {
    expect(diffToolContextCost(before, { ...after, method: { ...after.method, id: 'other' } })).toBeUndefined();
  });

  it('does not invent additions or removals when a side omitted tools', () => {
    const boundedBefore = computeToolContextCost([tool('a', 'A.'), tool('b', 'B tool with more words.')], { toolLimit: 1 });
    const later = computeToolContextCost([tool('a', 'A.'), tool('b', 'B tool with more words.')]);
    const delta = diffToolContextCost(boundedBefore, later)!;
    expect(delta.complete).toBe(false);
    expect(delta.tools).toEqual([]);
    expect(delta.delta).toBe(0);
  });

  it('does not invent additions or removals when a listing was incomplete', () => {
    const full = computeToolContextCost([tool('a', 'A.'), tool('b', 'B.')]);
    const partial = computeToolContextCost([tool('a', 'A.')], { listingComplete: false });
    expect(partial.listingIncomplete).toBe(true);
    expect(computeToolContextCost([tool('a', 'A.')]).listingIncomplete).toBeUndefined();
    const delta = diffToolContextCost(full, partial)!;
    expect(delta.complete).toBe(false);
    expect(delta.tools).toEqual([]);
    expect(delta.limitation).toContain('later listing did not complete');
    expect(contextCostSummaryLines(partial)[0]).toContain('tool discovery did not complete');
  });

  it('does not list membership changes between listings obtained with different access', () => {
    const surface = (names: string[], authentication?: 'authenticated' | 'unauthenticated') => ({
      tools: names.map((name) => ({ name, description: `${name}.`, inputSchema: { type: 'object' } })),
      outputSchemasObserved: true, annotationsObserved: true, titlesObserved: true,
      ...(authentication ? { authentication } : {}),
    });
    const delta = diffSurfaceContextCost(surface(['public_tool', 'private_tool'], 'authenticated'), surface(['public_tool'], 'unauthenticated'))!;
    expect(delta.tools).toEqual([]);
    expect(delta.complete).toBe(false);
    expect(delta.delta).toBeLessThan(0);
    expect(delta.limitation).toContain('cover different access scopes');
    for (const [left, right] of [['authenticated', 'authenticated'], [undefined, 'unauthenticated']] as const) {
      const comparable = diffSurfaceContextCost(surface(['public_tool', 'private_tool'], left), surface(['public_tool'], right))!;
      expect(comparable.tools.map((change) => `${change.name}:${change.status}`)).toEqual(['private_tool:removed']);
      expect(comparable.complete).toBe(true);
    }
  });

  it('compares breaking-change snapshots on the fields both recorded', () => {
    const left = { tools: [{ name: 'search', description: 'Search.', inputSchema: { type: 'object' } }], outputSchemasObserved: false, annotationsObserved: false, titlesObserved: false };
    const right = {
      tools: [{ name: 'search', title: 'Search', description: 'Search.', inputSchema: { type: 'object' }, outputSchema: { type: 'object' }, annotations: { readOnlyHint: true } }],
      outputSchemasObserved: true, annotationsObserved: true, titlesObserved: true,
    };
    const delta = diffSurfaceContextCost(left, right)!;
    expect(delta.delta).toBe(0);
    expect(delta.tools).toEqual([]);
    expect(delta.limitation).toContain('titles and output schemas and annotations');
  });

  it('leaves out schemas one snapshot kept only as fingerprints for tools both list', () => {
    // Large enough that the saved snapshot drops its schemas and keeps fingerprints.
    const tools = Array.from({ length: 3 }, (_, index) => ({
      name: `tool_${index}`,
      description: `Tool ${index}.`,
      inputSchema: {
        type: 'object',
        properties: Object.fromEntries(Array.from({ length: Math.ceil(INTERFACE_SNAPSHOT_SCHEMA_BUDGET / 100) }, (__, field) => (
          [`field_${field}`, { type: 'string', description: `Field ${field} of the request, described at some length to fill the schema.` }]
        ))),
      },
      outputSchema: { type: 'object', properties: { result: { type: 'string' } } },
    }));
    const stored = createInterfaceSnapshot({ tools, resources: [], resourceTemplates: [], prompts: [] });
    expect(stored.tools!.every((entry) => entry.inputSchema === undefined && entry.outputSchema === undefined)).toBe(true);
    const complete = { tools, outputSchemasObserved: true, annotationsObserved: false, titlesObserved: true };
    const saved = toolSurfaceFromInterfaceSnapshot(stored)!;
    for (const [left, right] of [[saved, complete], [complete, saved]] as const) {
      const delta = diffSurfaceContextCost(left, right)!;
      expect(delta.delta).toBe(0);
      expect(delta.tools).toEqual([]);
      expect(delta.limitation).toContain('stored only as fingerprints');
    }
    // A tool only one side lists is still counted with what that side kept.
    const added = { name: 'extra', description: 'Extra.', inputSchema: { type: 'object', properties: { q: { type: 'string' } } } };
    const grown = diffSurfaceContextCost(saved, { ...complete, tools: [...tools, added] })!;
    expect(grown.tools.map((change) => `${change.name}:${change.status}`)).toEqual(['extra:added']);
    expect(grown.delta).toBe(computeToolContextCost([added]).estimatedTotal);
  });

  it('still counts an output schema the server does not declare on one side', () => {
    const left = { tools: [{ name: 'search', inputSchema: { type: 'object' } }], outputSchemasObserved: true, annotationsObserved: false, titlesObserved: false };
    const right = {
      tools: [{ name: 'search', inputSchema: { type: 'object' }, outputSchema: { type: 'object', properties: { hits: { type: 'array' } } } }],
      outputSchemasObserved: true, annotationsObserved: false, titlesObserved: false,
    };
    const delta = diffSurfaceContextCost(left, right)!;
    expect(delta.delta).toBeGreaterThan(0);
    expect(delta.tools.map((change) => change.name)).toEqual(['search']);
  });
});

describe('summaries', () => {
  it('prints the total, median and top N tools with their share', () => {
    const cost = computeToolContextCost([searchTool, tool('get_issue', 'Get one issue.')]);
    const lines = contextCostSummaryLines(cost, 1);
    expect(lines).toHaveLength(2);
    expect(lines[0]).toMatch(/^Total: ≈\d+ estimated tokens across 2 tools; median ≈\d+ per tool \(method lexical-json-v1, an estimate, not an exact count for any model\)\.$/);
    expect(lines[1]).toMatch(/^1\. search_issues: ≈\d+ \(\d+%\)$/);
  });

  it('computes medians of odd and even lists', () => {
    expect(median([])).toBe(0);
    expect(median([5, 1, 3])).toBe(3);
    expect(median([1, 2, 3, 10])).toBe(3);
  });
});
