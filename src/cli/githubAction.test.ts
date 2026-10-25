// @vitest-environment node
import { mkdtemp, readFile, writeFile, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { describe, expect, it, vi } from 'vitest';
import { classifyActionTarget, parseActionInputs, renderActionSummary, runGitHubAction, updatePullRequestComment } from './githubAction';
import type { PublicReport } from '../utils/reportArtifact';

const env = { MCPTEST_ACTION_ENDPOINTS: 'https://example.com/mcp\r\nhttps://example.com/sse' };
const report = (tools: string[] = []): PublicReport => ({
  generatedAt: '2026-10-25T00:00:00Z', target: { testedEndpoint: 'https://example.com/mcp' },
  releaseDecision: { status: 'ready', priorities: [{ title: 'Header missing', severity: 'medium', referenceUrl: 'https://mcptest.io/learn/mcp-transport-diagnostics-reference#transport-accept' }] },
  compatibility: { assessments: { chatgpt: { status: 'compatible' }, 'codex-cli': { status: 'unknown' } } },
  toolSurfaceAnalysis: { toolDefinitions: { status: 'complete', tools: tools.map(name => ({ name, inputSchema: { type: 'object' } })) } },
} as unknown as PublicReport);

describe('GitHub Action inputs and release policy', () => {
  it('uses CLI newline parsing, secret references and opt-in probes', () => {
    const parsed = parseActionInputs({ ...env, MCPTEST_ACTION_BEARER: 'TOKEN', TOKEN: 'a-secret', MCPTEST_ACTION_CLIENTS: 'claude-code, codex-cli\nchatgpt', MCPTEST_ACTION_SESSION: 'true' });
    expect(parsed.argv).toContain('--session-resilience');
    expect(parsed.argv).toContain('TOKEN');
    expect(parsed.argv.join(' ')).not.toContain('a-secret');
    expect(parsed.clients).toEqual(['claude-code', 'codex-cli', 'chatgpt']);
    expect(parseActionInputs(env)).toMatchObject({ baseline: 'none', failOn: 'blocked', publish: false, comment: true });
  });
  it.each([
    { MCPTEST_ACTION_FAIL_ON: 'ready' }, { MCPTEST_ACTION_CLIENTS: 'imaginary-client' },
    { MCPTEST_ACTION_SESSION: 'yes' }, { MCPTEST_ACTION_PUBLISH: '1' },
    { MCPTEST_ACTION_BEARER: 'literal-token-value' },
    { MCPTEST_ACTION_ENDPOINTS: 'https://example.com/mcp?token=secret' },
    { MCPTEST_ACTION_BEARER: 'TOKEN', TOKEN: 'secret', MCPTEST_ACTION_API_KEY: 'KEY', KEY: 'key' },
  ])('rejects invalid or unsafe inputs', input => {
    expect(() => parseActionInputs({ ...env, ...input })).toThrow();
  });
  it('blocks removed tools, classifies additive changes and requires selected clients', () => {
    const result = classifyActionTarget(report(), report(['old_tool']), []);
    expect(result.decision).toBe('blocked');
    expect(result.changes?.counts.breaking).toBe(1);
    expect(classifyActionTarget(report(['new']), report(), []).changes?.counts.safe).toBe(1);
    expect(classifyActionTarget(report(), undefined, ['codex-cli']).decision).toBe('unknown');
  });
  it('detects removals from redacted schemas only when the name inventories are complete', () => {
    const before = report(['old_tool', 'retained']);
    const after = report(['retained']);
    for (const value of [before, after]) {
      Object.assign(value.toolSurfaceAnalysis!.toolDefinitions, { status: 'partial', namesComplete: true });
    }
    const target = classifyActionTarget(after, before, []);
    expect(target).toMatchObject({ decision: 'blocked', comparison: 'partial' });
    expect(target.changes?.counts.breaking).toBe(1);
    expect(renderActionSummary([target], 'blocked')).toContain('Schema comparison could not run');
    const unchanged = classifyActionTarget(after, after, []);
    expect(unchanged.decision).toBe('unknown');
    expect(renderActionSummary([unchanged], 'unknown')).toContain('breaking count is unknown');
    const complete = report(['retained']);
    complete.toolSurfaceAnalysis!.toolDefinitions.tools[0].description = 'Retained tool guidance';
    expect(classifyActionTarget(complete, before, []).changes?.counts).toEqual({ breaking: 1, risky: 0, safe: 0 });
    before.toolSurfaceAnalysis!.toolDefinitions.namesComplete = false;
    expect(classifyActionTarget(after, before, [])).toMatchObject({ decision: 'unknown', comparison: 'unavailable', changes: undefined });
  });
  it('reports an unknown breaking count when action configuration or baseline loading fails', async () => {
    const dir = await mkdtemp(join(tmpdir(), 'mcptest-failed-action-'));
    const stderr = vi.spyOn(process.stderr, 'write').mockImplementation(() => true);
    try {
      const outputs = join(dir, 'outputs');
      const summary = join(dir, 'summary');
      expect(await runGitHubAction({ ...env, GITHUB_WORKSPACE: dir, GITHUB_OUTPUT: outputs,
        GITHUB_STEP_SUMMARY: summary, MCPTEST_ACTION_BASELINE: 'missing.json', MCPTEST_ACTION_COMMENT: 'false' })).toBe(1);
      expect(await readFile(outputs, 'utf8')).toContain('decision=unknown\nbreaking-count=unknown');
      expect(await readFile(summary, 'utf8')).toContain('comparison could not run');
    } finally {
      stderr.mockRestore();
      await rm(dir, { recursive: true, force: true });
    }
  });
  it('does not claim comparison success for incomplete tool lists or unrelated endpoints', () => {
    const incomplete = report();
    delete incomplete.toolSurfaceAnalysis;
    expect(classifyActionTarget(report(), incomplete, []).decision).toBe('unknown');
    const unrelated = report();
    unrelated.target.testedEndpoint = 'https://other.example/mcp';
    expect(() => classifyActionTarget(report(), unrelated, [])).toThrow('Baseline endpoint');
  });
});

describe('compact summary and sticky comment', () => {
  it('renders client verdicts, grouped changes and trusted reference links', () => {
    const target = classifyActionTarget(report(), report(['old_tool']), []);
    const markdown = renderActionSummary([target], 'blocked', true);
    expect(markdown).toContain('mcptest: blocked — gate failed');
    expect(markdown).toContain('| chatgpt | compatible |');
    expect(markdown).toContain('old\\_tool');
    expect(markdown).toContain('#removing-or-renaming-a-tool');
    expect(markdown).toContain('#transport-accept');
    expect(markdown).toContain('Output schemas were not recorded');
  });
  it('redacts credential patterns and escapes server-controlled Markdown', () => {
    const malicious = report(['<script>|@everyone']);
    malicious.releaseDecision!.priorities[0].title = 'Bearer super-secret-token <script>|';
    malicious.releaseDecision!.priorities[0].referenceUrl = 'https://evil.example/steal';
    const markdown = renderActionSummary([classifyActionTarget(malicious, report(), [])], 'blocked');
    expect(markdown).not.toContain('super-secret-token');
    expect(markdown).not.toContain('evil.example');
    expect(markdown).not.toContain('<script>');
  });
  it('updates only the bot marker and gracefully skips a fork-like 403', async () => {
    const dir = await mkdtemp(join(tmpdir(), 'mcptest-comment-'));
    try {
      const eventPath = join(dir, 'event.json');
      await writeFile(eventPath, JSON.stringify({ pull_request: { number: 42, head: { repo: { fork: true } } } }));
      const commentEnv = { GITHUB_EVENT_PATH: eventPath, GITHUB_EVENT_NAME: 'pull_request', GITHUB_REPOSITORY: 'owner/repo', MCPTEST_ACTION_GITHUB_TOKEN: 'github-only-token' };
      const denied = vi.fn(async () => new Response('', { status: 403 }));
      expect(await updatePullRequestComment('body', commentEnv, denied)).toBe('skipped');
      const fetcher = vi.fn().mockResolvedValueOnce(Response.json([
        { id: 1, body: '<!-- mcptest-release-gate -->', user: { login: 'someone' } },
        { id: 2, body: '<!-- mcptest-release-gate --> old', user: { login: 'github-actions[bot]' } },
      ])).mockResolvedValueOnce(Response.json({ id: 2 }));
      expect(await updatePullRequestComment('new body', commentEnv, fetcher)).toBe('updated');
      expect(fetcher.mock.calls[1][0]).toContain('/issues/comments/2');
      expect(fetcher.mock.calls[1][1]).toMatchObject({ method: 'PATCH', body: JSON.stringify({ body: 'new body' }) });
    } finally { await rm(dir, { recursive: true, force: true }); }
  });
});
