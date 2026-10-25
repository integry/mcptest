import { test, expect } from '@playwright/test';
import { execFile } from 'node:child_process';
import { promisify } from 'node:util';
import { mkdtemp, readFile, readdir, writeFile, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { resolve, join } from 'node:path';

const exec = promisify(execFile);
test('action entry script evaluates stateless MCP, blocks a removed tool and skips fork comments', async () => {
  test.setTimeout(120000);
  const workspace = await mkdtemp(join(tmpdir(), 'mcptest-action-'));
  try {
    const event = join(workspace, 'event.json');
    await writeFile(event, JSON.stringify({ pull_request: { number: 42, head: { repo: { fork: true } } } }));
    // No write token, as on an untrusted fork PR. The mock endpoint is public HTTP;
    // credentialed CLI runs intentionally require HTTPS.
    const secret = 'action-fixture-secret-do-not-print';
    const env = { ...process.env, GITHUB_WORKSPACE: workspace, GITHUB_EVENT_PATH: event,
      GITHUB_EVENT_NAME: 'pull_request', GITHUB_REPOSITORY: 'fixture/repo',
      MCPTEST_ACTION_GITHUB_TOKEN: '', MCPTEST_ACTION_ENDPOINTS: `http://127.0.0.1:${process.env.E2E_MOCK_PORT || 4180}/2026/mcp`,
      MCPTEST_ACTION_BEARER: '', MCPTEST_ACTION_API_KEY: '', MCPTEST_ACTION_CLIENTS: '', MCPTEST_ACTION_FAIL_ON: 'blocked', MCP_TOKEN: secret, MCPTEST_ACTION_COMMENT: 'true',
      MCPTEST_ACTION_PUBLISH: 'false', MCPTEST_ACTION_BASELINE: 'none', MCPTEST_ACTION_SESSION: 'true',
      GITHUB_STEP_SUMMARY: join(workspace, 'summary.md'), GITHUB_OUTPUT: join(workspace, 'outputs') };
    const run = async (extra = {}) => {
      try { return { ...(await exec(resolve('node_modules/.bin/vite-node'), ['scripts/github-action.ts'], { env: { ...env, ...extra }, timeout: 50000 })), code: 0 }; }
      catch (error) { return error as { stdout: string; stderr: string; code: number }; }
    };
    const first = await run();
    expect(first.code, first.stderr).toBe(0);
    expect(first.stdout).toContain('PR comment skipped');
    const outputs = await readFile(env.GITHUB_OUTPUT, 'utf8');
    const reportDir = outputs.match(/^report-path=(.+)$/m)![1];
    const files = await readdir(reportDir);
    const report = JSON.parse(await readFile(join(reportDir, files.find(name => name.endsWith('.json'))!), 'utf8'));
    expect(report.protocol.version).toBe('2026-07-28');
    expect(report.compatibility.assessments['claude-code']).toBeTruthy();
    expect(report.compatibility.assessments['codex-cli']).toBeTruthy();
    report.toolSurfaceAnalysis.toolDefinitions.tools.push({ name: `removed_tool-${secret}`, inputSchema: { type: 'object' } });
    const baseline = join(workspace, 'baseline.json');
    await writeFile(baseline, JSON.stringify(report));
    const second = await run({ MCPTEST_ACTION_BASELINE: baseline, MCPTEST_ACTION_GITHUB_TOKEN: secret, MCPTEST_ACTION_COMMENT: 'false' });
    expect(second.code).toBe(1);
    expect(await readFile(env.GITHUB_OUTPUT, 'utf8')).toContain('breaking-count=1');
    const summary = await readFile(env.GITHUB_STEP_SUMMARY, 'utf8');
    expect(summary).toContain('mcptest: blocked');
    expect(summary).toContain('removed\\_tool');
    for (const content of [summary, first.stdout, first.stderr, second.stdout, second.stderr,
      ...await Promise.all(files.map(file => readFile(join(reportDir, file), 'utf8')))]) {
      expect(content).not.toContain(secret);
    }
  } finally { await rm(workspace, { recursive: true, force: true }); }
});

test('/ci serves a static workflow and example comment', async ({ page }) => {
  await page.goto('/ci');
  await expect(page.getByRole('heading', { level: 1 })).toHaveText('Gate your MCP deploy in GitHub Actions');
  await expect(page.locator('main')).toContainText('uses: integry/mcptest@v1');
  await expect(page.locator('main')).toContainText('Example PR comment');
  await page.getByRole('link', { name: 'Read the CI guide' }).click();
  await expect(page).toHaveURL(/learn\/test-remote-mcp-server-in-ci/);
});
