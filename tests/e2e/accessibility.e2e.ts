import AxeBuilder from '@axe-core/playwright';
import { connectAndWait, expect, mockUrl, test } from './fixtures';
import type { Page, TestInfo } from '@playwright/test';

// Only third-party markup may be excluded. Turnstile owns the contents of this
// cross-origin iframe; app-owned wrappers and all other elements remain scanned.
const THIRD_PARTY_ALLOWLIST = ['iframe[src^="https://challenges.cloudflare.com/"]'];

async function scan(page: Page, info: TestInfo, state: string) {
  await page.evaluate(() => document.fonts.ready);
  const builder = new AxeBuilder({ page })
    .withTags(['wcag2a', 'wcag2aa', 'wcag21a', 'wcag21aa', 'wcag22aa', 'best-practice']);
  for (const selector of THIRD_PARTY_ALLOWLIST) builder.exclude(selector);
  const results = await builder.analyze();
  await info.attach(`axe-${state}`, {
    body: JSON.stringify(results, null, 2), contentType: 'application/json',
  });
  const moderate = results.violations.filter(v => v.impact === 'moderate');
  for (const violation of moderate) info.annotations.push({
    type: 'a11y-moderate', description: `${state}: ${violation.id}: ${violation.help} (${violation.nodes.map(n => n.target.join(' ')).join(', ')})`,
  });
  const blocking = results.violations.filter(v => v.impact === 'serious' || v.impact === 'critical');
  expect.soft(blocking.map(v => ({
    id: v.id, impact: v.impact, nodes: v.nodes.map(n => ({ target: n.target, html: n.html, failureSummary: n.failureSummary })),
  })), state).toEqual([]);
}

const routes = [
  '/', '/catalog', '/catalog/databases', '/servers/context7/',
  '/learn/mcp-http-headers-reference', '/learn', '/clients', '/submit',
  '/tools/discovery', '/tools/breaking-changes', '/no-such-page',
  '/docs/testing-guide', '/docs/troubleshooting',
  '/learn/mcp-session-not-found-after-deploy', '/learn/mcp-oauth-protected-resource-mismatch',
  '/learn/vscode-mcp-oauth-redirect-uris', '/learn/how-to-vet-an-mcp-server', '/learn/mcp-glossary',
];

for (const theme of ['light', 'dark'] as const) {
  test.describe(`accessibility ${theme}`, () => {
    test.beforeEach(async ({ page }) => {
      await page.addInitScript(value => localStorage.setItem('theme', value), theme);
    });
    for (const route of routes) {
      test(route, async ({ page }, info) => {
        // The full catalog needs two axe scans across hundreds of server cards
        // (prerendered and mounted). Allow both to finish on shared CI runners.
        if (route === '/catalog') test.setTimeout(60_000);
        await page.goto(route);
        await expect(page.locator('main')).toBeVisible();
        await expect(page.locator('html')).toHaveAttribute('data-theme', theme);
        // Content pages defer React until input. Scan the actual static HTML,
        // then explicitly wait for its replacement before scanning the app.
        if (await page.locator('#root > [data-deferred-mount]').count()) {
          await scan(page, info, 'prerendered');
          await page.keyboard.press('Shift');
          await expect(page.locator('#root > [data-deferred-mount]')).toHaveCount(0);
        }
        await scan(page, info, 'mounted');
        await expect(page.getByRole('heading', { level: 1 })).toHaveCount(1);
      });
    }
    test('mock server report', async ({ page }, info) => {
      await page.goto(`/report/${encodeURIComponent(mockUrl('2026'))}`);
      await expect(page.getByRole('region', { name: 'Share and embed' })).toBeVisible({ timeout: 30_000 });
      await scan(page, info, 'report');
    });
    test('connected inspector with selected tool', async ({ page }, info) => {
      await connectAndWait(page, '2026');
      await page.getByRole('option', { name: /get_forecast/ }).click();
      await expect(page.getByLabel(/^city/)).toBeVisible();
      await scan(page, info, 'inspector');
    });
    test('mobile drawer', async ({ page }, info) => {
      await page.setViewportSize({ width: 390, height: 844 });
      await page.goto('/');
      await page.getByRole('button', { name: 'Toggle navigation menu' }).click();
      await expect(page.locator('body')).toHaveClass(/menu-open/);
      await scan(page, info, 'drawer');
    });
  });
}
