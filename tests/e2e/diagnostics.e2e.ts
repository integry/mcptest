import { connect, expect, test, mockUrl, type MockPath } from './fixtures';

const MODES: Array<{ path: MockPath; id: string; detail: RegExp }> = [
  {
    path: 'accept-406',
    id: 'transport.accept-header-406',
    detail: /answered POST initialize with HTTP 406 although the request sent Accept: application\/json, text\/event-stream/,
  },
  {
    path: 'no-expose',
    id: 'transport.cors-expose-headers-missing',
    detail: /the browser could not read Mcp-Session-Id/,
  },
  {
    path: 'rate-limited',
    id: 'transport.target-rate-limited-429',
    detail: /The server asked clients to wait 2 minutes/,
  },
];

test.describe('transport diagnostics per misbehavior mode', () => {
  for (const mode of MODES) {
    test(`${mode.path} → ${mode.id}`, async ({ page }, testInfo) => {
      await connect(page, mode.path);

      const detected = page.getByTestId('transport-diagnostic')
        .filter({ has: page.getByText(mode.id, { exact: true }) });
      await expect(detected).toHaveCount(1);
      await expect(detected.locator('.badge')).toHaveText('Error');
      await expect(detected).toContainText(mode.detail);
      // Only the expected id is detected; any other entry is "Not checked".
      const others = await page.getByTestId('transport-diagnostic')
        .filter({ hasNotText: mode.id })
        .locator('.badge')
        .allInnerTexts();
      expect(others.filter(label => label !== 'Not checked')).toEqual([]);
      await expect(page.getByRole('heading', { name: 'MCP connection ready' })).toHaveCount(0);

      if (mode.path === 'accept-406') {
        await detected.scrollIntoViewIfNeeded();
        await testInfo.attach('transport-diagnostic-406', {
          body: await page.screenshot(),
          contentType: 'image/png',
        });
      }
    });
  }
});

test('session resilience runs only on click and leaves the inspector session working', async ({ page }) => {
  const initialized = page.waitForResponse(response => response.url() === mockUrl('2025')
    && response.request().method() === 'POST' && response.request().postDataJSON()?.method === 'initialize');
  await connect(page, '2025');
  await expect(page.getByRole('heading', { name: 'MCP connection ready' })).toBeVisible();
  const panel = page.getByRole('region', { name: 'Session resilience diagnostics' });
  await expect(panel.getByTestId('transport-diagnostic')).toHaveCount(0);
  await panel.getByRole('button', { name: 'Check session resilience', exact: true }).click();
  await expect(panel.getByTestId('transport-diagnostic')).toHaveCount(4);
  await expect(panel.locator('.badge')).toHaveText(['Pass', 'Pass', 'Pass', 'Pass']);
  await expect(panel).toContainText('0/12 session rejections');
  await expect(page.getByRole('heading', { name: 'MCP connection ready' })).toBeVisible();
  await expect(panel.locator('a').filter({ hasText: 'session.unknown-id' })).toHaveAttribute('href', /#session-unknown-id$/);
  const originalSession = (await initialized).headers()['mcp-session-id'];
  const ping = await page.request.post(mockUrl('2025'), {
    headers: { Accept: 'application/json, text/event-stream', 'Mcp-Session-Id': originalSession, 'MCP-Protocol-Version': '2025-11-25' },
    data: { jsonrpc: '2.0', id: 999, method: 'ping' },
  });
  expect(ping.status()).toBe(200);
});

test('session resilience detects alternating replica loss', async ({ page }) => {
  await connect(page, 'session-replicas');
  await expect(page.getByRole('heading', { name: 'MCP connection ready' })).toBeVisible();
  const panel = page.getByRole('region', { name: 'Session resilience diagnostics' });
  await panel.getByRole('button', { name: 'Check session resilience', exact: true }).click();
  const finding = panel.getByTestId('transport-diagnostic').filter({ hasText: 'session.stickiness' });
  await expect(finding.locator('.badge')).toHaveText('Error');
  await expect(finding).toContainText('6/12 session rejections');
});

test('stateless session diagnostics explain applicability', async ({ page }) => {
  await connect(page, '2026');
  await expect(page.getByRole('heading', { name: 'MCP connection ready' })).toBeVisible();
  const panel = page.getByRole('region', { name: 'Session resilience diagnostics' });
  await panel.getByRole('button', { name: 'Check session resilience', exact: true }).click();
  await expect(panel.locator('.badge')).toHaveText(['Pass', 'Pass', 'Pass', 'Pass']);
  await expect(panel).toContainText('Not applicable: stateless');
});

test('opted-in release report renders and exports session findings', async ({ page }) => {
  await page.goto('/report');
  await page.getByRole('checkbox', { name: /Check session resilience/ }).check();
  await page.getByLabel('MCP server URL').fill(mockUrl('2025'));
  await page.getByRole('button', { name: 'Run Report', exact: true }).click();
  const findings = page.locator('.release-report').getByTestId('transport-diagnostic');
  await expect(findings).toHaveCount(4);
  await expect(findings.locator('.badge')).toHaveText(['Pass', 'Pass', 'Pass', 'Pass']);
  const downloadPromise = page.waitForEvent('download');
  await page.getByRole('button', { name: 'Download JSON', exact: true }).click();
  const path = await (await downloadPromise).path();
  const { readFile } = await import('node:fs/promises');
  const artifact = JSON.parse(await readFile(path!, 'utf8'));
  const section = artifact.sections.find((item: { id: string }) => item.id === 'sessionResilience');
  expect(section.evidence).toHaveLength(4);
  expect(section.evidence[0].metadata.transportDiagnostic).toMatchObject({
    id: 'session.unknown-id', outcome: 'pass',
    referenceUrl: 'https://mcptest.io/learn/mcp-transport-diagnostics-reference#session-unknown-id',
  });
});
