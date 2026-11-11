import Ajv2020 from 'ajv/dist/2020';
import addFormats from 'ajv-formats';
import { describe, expect, it } from 'vitest';
import publicJsonSchema from '../../public/schemas/report/v2.schema.json';
import type { EvaluationReport } from './evaluation';
import {
  createPublicReport,
  parsePublicReportJson,
  serializePublicReportJson,
  serializePublicReportMarkdown,
  type PublicReport,
} from './reportArtifact';
import { diffPublicReports, diffReportContextCost } from './reportDiff';
import { analyzeToolSurface } from './toolSurfaceAnalysis';

const ajv = new Ajv2020({ allErrors: true, strict: false });
addFormats(ajv);
const validatePublishedSchema = ajv.compile(publicJsonSchema);

const searchTool = (description = 'Search records by query.') => ({
  name: 'search',
  description,
  inputSchema: {
    type: 'object',
    properties: { query: { type: 'string', description: 'Text to search for.' } },
    required: ['query'],
  },
});

const report = (tools: unknown[], generatedAt = '2026-11-11T10:00:00.000Z'): PublicReport => {
  const evaluation: EvaluationReport = {
    serverUrl: 'https://cost.example/mcp',
    outcome: 'scored',
    finalScore: 10,
    toolSurfaceAnalysis: analyzeToolSurface({ tools, resources: [], prompts: [] }),
    sections: {
      capabilities: {
        name: 'Capabilities', description: 'Discovery', score: 10, maxScore: 10,
        details: [{ text: 'Tools listed', metadata: { method: 'tools/list', itemCount: tools.length } }],
      },
    },
  };
  return createPublicReport(evaluation, { generatedAt });
};

/** A report as stored before the breakdown existed: bytes / 4 and no contextCost. */
const legacy = (value: PublicReport): PublicReport => {
  const copy = JSON.parse(JSON.stringify(value));
  delete copy.toolSurfaceAnalysis.contextCost;
  copy.toolSurfaceAnalysis.metrics.estimatedContextTokens = 999;
  return parsePublicReportJson(JSON.stringify(copy));
};

describe('context cost in public reports', () => {
  it('stores the breakdown so it survives redaction, serialization and both schemas', () => {
    const artifact = report([searchTool(), { ...searchTool('List records.'), name: 'list' }]);
    const parsed = parsePublicReportJson(serializePublicReportJson(artifact));
    const cost = parsed.toolSurfaceAnalysis?.contextCost;

    expect(cost?.method.id).toBe('lexical-json-v1');
    expect(cost?.estimatedTotal).toBe(parsed.toolSurfaceAnalysis?.metrics.estimatedContextTokens);
    expect(cost?.tools.map((tool) => tool.name).sort()).toEqual(['list', 'search']);
    expect(cost?.tools[0].parameters[0]).toMatchObject({ name: 'query', required: true });
    expect(validatePublishedSchema(JSON.parse(serializePublicReportJson(artifact)))).toBe(true);
  });

  it('keeps reports without the breakdown readable', () => {
    const old = legacy(report([searchTool()]));
    expect(old.toolSurfaceAnalysis?.contextCost).toBeUndefined();
    expect(validatePublishedSchema(JSON.parse(serializePublicReportJson(old)))).toBe(true);
    const markdown = serializePublicReportMarkdown(old);
    expect(markdown).toContain('- Estimated context tokens: 999 (bytes / 4)');
    expect(markdown).not.toContain('### Context cost');
  });

  it('writes totals, the heaviest tools and the method into Markdown', () => {
    const markdown = serializePublicReportMarkdown(report([searchTool(), { ...searchTool('List.'), name: 'list' }]));
    expect(markdown).toContain('### Context cost (estimated)');
    expect(markdown).toMatch(/Total: ≈\d+ estimated tokens across 2 tools; median ≈\d+ per tool/);
    expect(markdown).toMatch(/1\. search: ≈\d+ \(\d+%\)/);
    expect(markdown).toContain('not an exact count for any model');
  });
});

describe('context cost in report diffs', () => {
  const before = report([searchTool(), { ...searchTool('Remove a record.'), name: 'remove' }]);
  const after = report([
    searchTool('Search records by query, owner, label and creation date. Returns up to fifty matches.'),
    { ...searchTool('Add a record.'), name: 'add' },
  ], '2026-11-11T11:00:00.000Z');

  it('shows the overall and per-tool delta from stored breakdowns', () => {
    const delta = diffPublicReports(before, after).contextCost!;
    expect(delta.before).toBe(before.toolSurfaceAnalysis?.contextCost?.estimatedTotal);
    expect(delta.after).toBe(after.toolSurfaceAnalysis?.contextCost?.estimatedTotal);
    expect(delta.limitation).toBeUndefined();
    expect(delta.complete).toBe(true);
    expect(Object.fromEntries(delta.tools.map((tool) => [tool.name, tool.status]))).toEqual({
      search: 'changed', add: 'added', remove: 'removed',
    });
  });

  it('re-estimates both sides from stored definitions when one report predates the breakdown', () => {
    const delta = diffReportContextCost(legacy(before), after)!;
    // The legacy bytes / 4 total is never mixed with the new method.
    expect(delta.before).not.toBe(999);
    expect(delta.limitation).toContain('predates the per-tool breakdown');
    expect(delta.tools.find((tool) => tool.name === 'search')?.status).toBe('changed');
  });

  it('reports no change for identical reports', () => {
    const delta = diffReportContextCost(before, report([searchTool(), { ...searchTool('Remove a record.'), name: 'remove' }]))!;
    expect(delta.delta).toBe(0);
    expect(delta.tools).toEqual([]);
  });
});
