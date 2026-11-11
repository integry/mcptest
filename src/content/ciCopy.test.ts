import { describe, expect, it } from 'vitest';
import { classifyActionTarget, renderActionSummary } from '../cli/githubAction';
import type { PublicReport } from '../utils/reportArtifact';
import { CI_EXAMPLE_COMMENT } from './ciCopy';

const compatibility = {
  'claude-ai': 'compatible-with-caveats',
  chatgpt: 'compatible',
  cursor: 'compatible',
  'codex-cli': 'compatible',
};

const report = (tools: unknown[]): PublicReport => ({
  generatedAt: '2026-10-25T00:00:00Z',
  target: { testedEndpoint: 'https://mcp.example.com/mcp' },
  releaseDecision: { status: 'ready', priorities: [] },
  compatibility: {
    assessments: Object.fromEntries(Object.entries(compatibility).map(([id, status]) => [id, { status }])),
  },
  toolSurfaceAnalysis: { toolDefinitions: { status: 'complete', tools } },
} as unknown as PublicReport);

const search = (inputs: string[]) => ({
  name: 'search',
  description: 'Search',
  inputSchema: {
    type: 'object',
    properties: Object.fromEntries(inputs.map(name => [name, { type: 'string' }])),
    required: inputs,
  },
});

describe('CI page example comment', () => {
  it('is what the action posts for the example change', () => {
    const before = report([search(['q'])]);
    const after = report([search(['q', 'filter']), { name: 'lookup', description: 'Lookup', inputSchema: { type: 'object' } }]);
    const target = classifyActionTarget(after, before, []);
    expect(target.decision).toBe('blocked');
    const comment = renderActionSummary([target], 'blocked', true).replace(/^<!--[^>]*-->\n/, '');
    expect(comment.trimEnd()).toBe(CI_EXAMPLE_COMMENT.trimEnd());
  });
});
