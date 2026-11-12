import { describe, expect, it } from 'vitest';
import { analyzeToolSurface } from './toolSurfaceAnalysis';

const schema = { type: 'object', properties: {} };

describe('analyzeToolSurface tool annotations', () => {
  it('records title, description, and declared boolean hints per tool', () => {
    const analysis = analyzeToolSurface({
      tools: [
        { name: 'b_tool', title: 'B', description: 'Does b.', inputSchema: schema, annotations: { readOnlyHint: true, openWorldHint: false } },
        { name: 'a_tool', description: '', inputSchema: schema, annotations: { title: 'A', destructiveHint: 'yes', idempotentHint: true } },
        { name: 'c_tool', inputSchema: schema },
      ],
      resources: [],
      prompts: [],
    });

    expect(analysis.toolAnnotations).toEqual({
      status: 'complete',
      tools: [
        { name: 'a_tool', title: true, description: false, idempotentHint: true },
        { name: 'b_tool', title: true, description: true, readOnlyHint: true, openWorldHint: false },
        { name: 'c_tool', title: false, description: false },
      ],
    });
  });

  it('is unavailable without a tool list and partial when a tool cannot be recorded', () => {
    expect(analyzeToolSurface({ resources: [], prompts: [] }).toolAnnotations?.status).toBe('unavailable');
    const partial = analyzeToolSurface({ tools: [{ name: 'ok', inputSchema: schema }, 'not a tool'] });
    expect(partial.toolAnnotations?.status).toBe('partial');
    expect(partial.toolAnnotations?.tools.map((tool) => tool.name)).toEqual(['ok']);
  });

  it('bounds the retained records on very large surfaces', () => {
    const tools = Array.from({ length: 2_000 }, (_, index) => ({
      name: `tool_${String(index).padStart(4, '0')}_${'n'.repeat(40)}`,
      inputSchema: schema,
      annotations: { readOnlyHint: true, destructiveHint: false, openWorldHint: false, idempotentHint: true },
    }));
    const summary = analyzeToolSurface(tools).toolAnnotations;
    expect(summary?.status).toBe('partial');
    expect(JSON.stringify(summary).length).toBeLessThan(20_000);
  });
});
