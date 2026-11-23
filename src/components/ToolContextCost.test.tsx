import React from 'react';
import { renderToStaticMarkup } from 'react-dom/server';
import { describe, expect, it } from 'vitest';
import type { EvaluationReport } from '../utils/evaluation';
import { analyzeToolSurface } from '../utils/toolSurfaceAnalysis';
import { computeToolContextCost, diffToolContextCost } from '../utils/toolTokenCost';
import ReleaseReadinessReport from './ReleaseReadinessReport';
import ReportDiffChanges from './ReportDiffChanges';
import { ToolContextCostDelta, ToolContextCostPanel, contextCostDeltaChanged } from './ToolContextCost';

const tool = (name: string, description: string, properties: Record<string, unknown> = {}) => ({
  name, description, inputSchema: { type: 'object', properties, required: Object.keys(properties).slice(0, 1) },
});

const render = (element: React.ReactElement) => {
  const container = document.createElement('div');
  container.innerHTML = renderToStaticMarkup(element);
  return container;
};

describe('ToolContextCostPanel', () => {
  const definitions = Array.from({ length: 12 }, (_, index) => tool(
    `tool_${String(index).padStart(2, '0')}`,
    'Reads records. '.repeat(index + 1),
    { query: { type: 'string', description: 'Query text.' }, limit: { type: 'integer' } }
  ));

  it('shows totals, the method and the heaviest tools with their share and per-parameter detail', () => {
    const cost = computeToolContextCost(definitions);
    const container = render(<ToolContextCostPanel cost={cost} />);
    const text = container.textContent || '';

    expect(text).toContain('Context cost by tool');
    expect(text).toContain(`≈${cost.estimatedTotal.toLocaleString('en-US')}`);
    expect(text).toContain('Median per tool');
    expect(text).toContain('Estimate, not an exact count.');
    expect(container.querySelector('code')?.textContent).toBeTruthy();
    expect(text).toContain('lexical-json-v1');

    const rows = container.querySelectorAll('.tool-context-cost-list > li');
    // 10 visible plus 2 behind "Show 2 more tools".
    expect(rows).toHaveLength(12);
    expect(text).toContain('Show 2 more tools');
    const first = rows[0];
    expect(first.querySelector('.tool-context-cost-name')?.textContent).toBe('tool_11');
    expect(first.querySelector('summary')?.textContent).toMatch(/≈\d+\d+%/);
    expect(first.querySelectorAll('details table')).toHaveLength(2);
    expect(first.textContent).toContain('Name and description');
    expect(first.textContent).toContain('query');
    expect(first.textContent).toContain('required');
  });

  it('says when discovery stopped part-way and qualifies the total and shares', () => {
    const complete = render(<ToolContextCostPanel cost={computeToolContextCost(definitions)} />);
    expect(complete.querySelector('[data-testid="context-cost-incomplete"]')).toBeNull();
    expect(complete.textContent).toContain('Heaviest tool share');
    expect(complete.textContent).not.toContain('received');

    const partial = computeToolContextCost(definitions.slice(0, 3), { listingComplete: false });
    expect(partial.omittedToolCount).toBe(0);
    const container = render(<ToolContextCostPanel cost={partial} />);
    const notice = container.querySelector('[data-testid="context-cost-incomplete"]');
    expect(notice?.textContent).toContain('Tool discovery did not complete.');
    expect(notice?.textContent).toContain('cover only the 3 tools received');
    const metrics = container.querySelector('.tool-metrics')?.textContent || '';
    expect(metrics).toContain('Total of tools received, estimated tokens');
    expect(metrics).toContain('Heaviest tool share of tools received');
    expect(metrics).toContain('Tools received and counted');
  });

  it('lists findings with advice, and can hide a total reported elsewhere', () => {
    const big = Array.from({ length: 60 }, (_, index) => tool(`t${index}`, 'Explains the tool in detail. '.repeat(10)));
    const cost = computeToolContextCost(big);
    expect(render(<ToolContextCostPanel cost={cost} />).textContent).toContain('Tool definitions use a large share of the context window');
    expect(render(<ToolContextCostPanel cost={cost} hideFindingIds={['context-cost.total-above-threshold']} />).textContent)
      .not.toContain('Tool definitions use a large share of the context window');
  });
});

describe('ToolContextCostDelta', () => {
  const before = computeToolContextCost([tool('search', 'Search.'), tool('legacy', 'Old.')]);
  const after = computeToolContextCost([tool('search', 'Search records by text, owner and label.'), tool('close', 'Close one.')]);
  const delta = diffToolContextCost(before, after)!;

  it('shows the overall change, each changed tool and that numbers are estimates', () => {
    const text = render(<ToolContextCostDelta delta={delta} />).textContent || '';
    expect(text).toMatch(/Context cost: ≈\d+ → ≈\d+ estimated tokens/);
    expect(text).toMatch(/search: ≈\d+ → ≈\d+ \(\+\d+\)/);
    expect(text).toContain('close: added');
    expect(text).toContain('legacy: removed');
    expect(text).toContain('not exact counts for any model');
  });

  it('is shown in report diffs only when something changed', () => {
    const diff = {
      beforeGeneratedAt: 'a', afterGeneratedAt: 'b', hasBreakingChanges: false,
      counts: { breaking: 0, removal: 0, risk: 0, unknown: 0, addition: 1, change: 0 },
      changes: [{ classification: 'addition' as const, category: 'tools' as const, path: 'tools.close', title: 'Tool added: close', detail: 'New.', breaking: false }],
    };
    expect(render(<ReportDiffChanges diff={{ ...diff, contextCost: delta }} />).querySelector('[data-testid="context-cost-delta"]')).not.toBeNull();
    const unchanged = diffToolContextCost(before, before)!;
    expect(contextCostDeltaChanged(unchanged)).toBe(false);
    expect(render(<ReportDiffChanges diff={{ ...diff, contextCost: unchanged }} />).querySelector('[data-testid="context-cost-delta"]')).toBeNull();
  });
});

describe('ReleaseReadinessReport context cost', () => {
  const report = (withBreakdown: boolean): EvaluationReport => {
    const analysis = analyzeToolSurface({ tools: [tool('search', 'Search records.', { query: { type: 'string' } })], resources: [], prompts: [] });
    if (!withBreakdown) delete analysis.contextCost;
    return {
      serverUrl: 'https://cost.example/mcp',
      outcome: 'scored',
      finalScore: 10,
      toolSurfaceAnalysis: analysis,
      sections: {
        capabilities: {
          name: 'Capabilities', description: 'Discovery', score: 10, maxScore: 10,
          details: [{ text: 'Tools listed', metadata: { method: 'tools/list' } }],
        },
      },
    };
  };

  it('renders the breakdown in the tool surface section', () => {
    const container = render(<ReleaseReadinessReport report={report(true)} expandedItems={new Set()} onToggleItem={() => undefined} />);
    expect(container.querySelector('.tool-context-cost')).not.toBeNull();
    expect(container.textContent).toContain('Context cost by tool');
  });

  it('discloses a tool listing whose discovery did not complete', () => {
    const partial = report(true);
    partial.toolSurfaceAnalysis = analyzeToolSurface({
      tools: [tool('search', 'Search records.', { query: { type: 'string' } })], resources: [], prompts: [], incompleteDiscovery: ['tools'],
    });
    expect(partial.toolSurfaceAnalysis.contextCost?.listingIncomplete).toBe(true);
    const container = render(<ReleaseReadinessReport report={partial} expandedItems={new Set()} onToggleItem={() => undefined} />);
    expect(container.querySelector('[data-testid="context-cost-incomplete"]')?.textContent).toContain('cover only the 1 tool received');
    expect(container.textContent).toContain('Estimated context tokens, tools received only');
    const complete = render(<ReleaseReadinessReport report={report(true)} expandedItems={new Set()} onToggleItem={() => undefined} />);
    expect(complete.querySelector('[data-testid="context-cost-incomplete"]')).toBeNull();
    expect(complete.textContent).not.toContain('tools received only');
  });

  it('labels the legacy estimate of older reports and shows no breakdown', () => {
    const container = render(<ReleaseReadinessReport report={report(false)} expandedItems={new Set()} onToggleItem={() => undefined} />);
    expect(container.querySelector('.tool-context-cost')).toBeNull();
    expect(container.textContent).toContain('Estimated context tokens (bytes / 4)');
  });
});
