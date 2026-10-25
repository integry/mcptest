import { test, expect } from '@playwright/test';
import { execFile } from 'node:child_process';
import { promisify } from 'node:util';
import { mkdtemp, readFile, readdir, writeFile, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { resolve, join } from 'node:path';
import { pathToFileURL } from 'node:url';

const exec = promisify(execFile);
test('action entry script evaluates stateless MCP, blocks a removed tool and skips fork comments', async () => {
  test.setTimeout(120000);
  const workspace = await mkdtemp(join(tmpdir(), 'mcptest-action-'));
  // Keep the original schema descriptions: redaction must not hide tool removals.
  const { createMockMcpServer } = await import(pathToFileURL(resolve('tests/e2e/mock-mcp-server.mjs')).href);
  const { server } = createMockMcpServer();
  try {
    await new Promise<void>(resolve => server.listen(0, '127.0.0.1', resolve));
    const port = (server.address() as { port: number }).port;
    const event = join(workspace, 'event.json');
    await writeFile(event, JSON.stringify({ pull_request: { number: 42, head: { repo: { fork: true } } } }));
    // No write token, as on an untrusted fork PR. The mock endpoint is public HTTP;
    // credentialed CLI runs intentionally require HTTPS.
    const secret = 'action-fixture-secret-do-not-print';
    const env = { ...process.env, GITHUB_WORKSPACE: workspace, GITHUB_EVENT_PATH: event,
      GITHUB_EVENT_NAME: 'pull_request', GITHUB_REPOSITORY: 'fixture/repo',
      MCPTEST_ACTION_GITHUB_TOKEN: '', MCPTEST_ACTION_ENDPOINTS: `http://127.0.0.1:${port}/2026/mcp`,
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
    expect(outputs).toContain('decision=review');
    const reportDir = outputs.match(/^report-path=(.+)$/m)![1];
    const files = await readdir(reportDir);
    const report = JSON.parse(await readFile(join(reportDir, files.find(name => name.endsWith('.json'))!), 'utf8'));
    expect(report.toolSurfaceAnalysis.toolDefinitions.status).toBe('partial');
    expect(report.toolSurfaceAnalysis.toolDefinitions.namesComplete).toBe(true);
    expect(report.protocol.version).toBe('2026-07-28');
    expect(report.compatibility.assessments['claude-code']).toBeTruthy();
    expect(report.compatibility.assessments['codex-cli']).toBeTruthy();
    report.toolSurfaceAnalysis.toolDefinitions.tools.push({ name: `removed_tool-${secret}`, inputSchema: { type: 'object' } });
    const baseline = join(workspace, 'baseline.json');
    await writeFile(baseline, JSON.stringify(report));
    const second = await run({ MCPTEST_ACTION_BASELINE: baseline, MCPTEST_ACTION_GITHUB_TOKEN: secret, MCPTEST_ACTION_COMMENT: 'false' });
    expect(second.code, second.stderr).toBe(1);
    expect(await readFile(env.GITHUB_OUTPUT, 'utf8')).toContain('decision=blocked');
    expect(await readFile(env.GITHUB_OUTPUT, 'utf8'), second.stderr).toContain('breaking-count=1');
    const summary = await readFile(env.GITHUB_STEP_SUMMARY, 'utf8');
    expect(summary).toContain('mcptest: blocked');
    expect(summary).toContain('Schema comparison could not run');
    expect(summary).toContain('removed\\_tool');
    // An incomplete baseline must fail explicitly, rather than reporting zero removals.
    report.toolSurfaceAnalysis.toolDefinitions.namesComplete = false;
    await writeFile(baseline, JSON.stringify(report));
    const unknownOutputs = join(workspace, 'unknown-outputs');
    const unknownSummary = join(workspace, 'unknown-summary.md');
    const unknown = await run({ MCPTEST_ACTION_BASELINE: baseline, MCPTEST_ACTION_COMMENT: 'false',
      GITHUB_OUTPUT: unknownOutputs, GITHUB_STEP_SUMMARY: unknownSummary });
    expect(unknown.code, unknown.stderr).toBe(1);
    expect(await readFile(unknownOutputs, 'utf8')).toContain('decision=unknown\nbreaking-count=unknown');
    expect(await readFile(unknownSummary, 'utf8')).toContain('Comparison could not run');
    for (const content of [summary, first.stdout, first.stderr, second.stdout, second.stderr,
      ...await Promise.all(files.map(file => readFile(join(reportDir, file), 'utf8')))]) {
      expect(content).not.toContain(secret);
    }
  } finally {
    await new Promise<void>((resolve, reject) => server.close(error => error ? reject(error) : resolve()));
    await rm(workspace, { recursive: true, force: true });
  }
});

test('/ci serves a static workflow and example comment', async ({ page }) => {
  await page.goto('/ci');
  await expect(page.getByRole('heading', { level: 1 })).toHaveText('Gate your MCP deploy in GitHub Actions');
  await expect(page.locator('main')).toContainText('uses: integry/mcptest@v1');
  await expect(page.locator('main')).toContainText('Example PR comment');
  await page.getByRole('link', { name: 'Read the CI guide' }).click();
  await expect(page).toHaveURL(/learn\/test-remote-mcp-server-in-ci/);
});
