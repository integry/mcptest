// @vitest-environment node
import { mkdtemp, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { describe, expect, it, vi } from 'vitest';
import type { EvaluationReport } from '../utils/evaluation';
import { analyzeToolSurface } from '../utils/toolSurfaceAnalysis';
import { classifyActionTarget, parseActionInputs, renderActionSummary } from './githubAction';
import { RELEASE_GATE_EXIT_CODES, getContextCostThresholdReason, runReleaseGate } from './releaseGate';
import { parseReleaseGateArgs, releaseGateHelp, runCli } from './runCli';

const fixture = vi.hoisted(() => ({ evaluation: undefined as unknown }));

vi.mock('../utils/evaluation', async (importOriginal) => ({
  ...await importOriginal<typeof import('../utils/evaluation')>(),
  evaluateServer: vi.fn(async () => fixture.evaluation),
}));

const tools = [
  {
    name: 'search_records',
    description: 'Search records by text query, owner and label. Returns up to fifty matches with links.',
    inputSchema: {
      type: 'object',
      properties: {
        query: { type: 'string', description: 'Full-text query.' },
        owner: { type: 'string', description: 'Owner login.' },
      },
      required: ['query'],
    },
  },
  { name: 'get_record', description: 'Get one record by id.', inputSchema: { type: 'object', properties: { id: { type: 'string' } } } },
];

const evaluation = (endpoint = 'https://fixture.example/mcp', listed: unknown[] = tools): EvaluationReport => ({
  serverUrl: endpoint,
  outcome: 'scored',
  finalScore: 10,
  toolSurfaceAnalysis: analyzeToolSurface({ tools: listed, resources: [], prompts: [] }),
  sections: {
    capabilities: {
      name: 'Capabilities', description: 'Discovery', score: 10, maxScore: 10,
      details: [{ text: '✓ tools/list succeeded', metadata: { method: 'tools/list' } }],
    },
  },
});

const policy = { failOnResults: new Set<never>(), failOnSeverity: 'none' as const };

describe('context-cost gate', () => {
  it('parses the threshold and the top-N option', () => {
    const parsed = parseReleaseGateArgs(['--max-context-tokens', '1500', '--context-cost-top', '3', 'https://fixture.example/mcp'], {});
    expect(parsed.policy.maxContextTokens).toBe(1500);
    expect(parsed.contextCostTop).toBe(3);
    const defaults = parseReleaseGateArgs(['https://fixture.example/mcp'], {});
    expect(defaults.policy.maxContextTokens).toBeUndefined();
    expect(defaults.contextCostTop).toBe(5);
    expect(() => parseReleaseGateArgs(['--max-context-tokens', '1.5', 'https://fixture.example/mcp'], {}))
      .toThrow('--max-context-tokens must be a non-negative integer.');
    expect(releaseGateHelp).toContain('--max-context-tokens <n>');
    expect(releaseGateHelp).toContain('not an exact');
  });

  it('fails only when the estimated total is above the configured maximum', async () => {
    const run = (maxContextTokens?: number) => runReleaseGate({
      endpoints: ['https://fixture.example/mcp'],
      policy: { ...policy, ...(maxContextTokens !== undefined ? { maxContextTokens } : {}) },
    }, { evaluate: async () => evaluation() });

    const unlimited = await run();
    const total = unlimited.targets[0].report!.toolSurfaceAnalysis!.metrics.estimatedContextTokens;
    expect(unlimited.exitCode).toBe(RELEASE_GATE_EXIT_CODES.pass);
    expect((await run(total)).exitCode).toBe(RELEASE_GATE_EXIT_CODES.pass);

    const failed = await run(total - 1);
    expect(failed.exitCode).toBe(RELEASE_GATE_EXIT_CODES.thresholdFailure);
    expect(failed.targets[0].thresholdReasons).toEqual([
      `estimated context cost ≈${total} exceeds the configured maximum of ${total - 1} (an estimate, method lexical-json-v1)`,
    ]);
  });

  it('does not fail when the tool surface is unknown', () => {
    const report = { toolSurfaceAnalysis: undefined } as never;
    expect(getContextCostThresholdReason(report, { ...policy, maxContextTokens: 0 })).toBeUndefined();
  });

  it('prints the totals and the top N tools', async () => {
    fixture.evaluation = evaluation();
    const outputDir = await mkdtemp(join(tmpdir(), 'mcptest-context-cost-'));
    let stdout = '';
    const write = vi.spyOn(process.stdout, 'write').mockImplementation((chunk) => {
      stdout += String(chunk);
      return true;
    });
    try {
      const exitCode = await runCli([
        '--quiet', '--fail-on-result', 'none', '--fail-on-severity', 'none',
        '--context-cost-top', '1', '--output-dir', outputDir, 'https://fixture.example/mcp',
      ], {});
      expect(exitCode).toBe(RELEASE_GATE_EXIT_CODES.pass);
    } finally {
      write.mockRestore();
      await rm(outputDir, { recursive: true, force: true });
    }
    expect(stdout).toMatch(/ {2}context cost: Total: ≈\d+ estimated tokens across 2 tools; median ≈\d+ per tool \(method lexical-json-v1/);
    expect(stdout).toMatch(/ {4}1\. search_records: ≈\d+ \(\d+%\)/);
    expect(stdout).not.toContain('2. get_record');
  });
});

describe('context cost in the GitHub Action', () => {
  it('passes the threshold input to the CLI and validates it', () => {
    const env = { MCPTEST_ACTION_ENDPOINTS: 'https://example.com/mcp' };
    expect(parseActionInputs({ ...env, MCPTEST_ACTION_MAX_CONTEXT_TOKENS: '8000' }).argv.join(' '))
      .toContain('--max-context-tokens 8000');
    expect(parseActionInputs(env).argv).not.toContain('--max-context-tokens');
    expect(() => parseActionInputs({ ...env, MCPTEST_ACTION_MAX_CONTEXT_TOKENS: 'lots' })).toThrow();
  });

  it('summarizes the totals, heaviest tools and the delta against the baseline', async () => {
    const gate = (listed: unknown[]) => runReleaseGate({ endpoints: ['https://fixture.example/mcp'], policy }, {
      evaluate: async () => evaluation(undefined, listed),
    });
    const baseline = (await gate(tools.slice(1))).targets[0].report!;
    const current = (await gate(tools)).targets[0].report!;
    const target = classifyActionTarget(current, baseline, []);

    expect(target.contextCost?.tools).toEqual([expect.objectContaining({ name: 'search_records', status: 'added' })]);
    const summary = renderActionSummary([target], target.decision);
    expect(summary).toMatch(/Context cost: Total: ≈\d+ estimated tokens across 2 tools/);
    expect(summary).toMatch(/- search\\_records: ≈\d+ \\\(\d+%\\\)/);
    expect(summary).toMatch(/Context cost vs baseline: ≈\d+ → ≈\d+ estimated tokens \\\(\+\d+, \+\d+%\\\)/);
    expect(summary).toMatch(/- search\\_records: added/);
  });
});
