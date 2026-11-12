import AxeBuilder from '@axe-core/playwright';
import type { Page, TestInfo } from '@playwright/test';
import { connect, expect, hasHorizontalScroll, mockUrl, test } from './fixtures';

/**
 * Connected view guidance (issue #560): real connection stages, a summary
 * with one next action, a guided first tool call, the share prompt, plain
 * failures, and hints that a returning visitor never sees.
 */

const blockingViolations = async (page: Page, info: TestInfo, state: string) => {
  await page.evaluate(() => document.fonts.ready);
  const results = await new AxeBuilder({ page })
    .withTags(['wcag2a', 'wcag2aa', 'wcag21a', 'wcag21aa', 'wcag22aa', 'best-practice'])
    .analyze();
  await info.attach(`axe-${state}`, { body: JSON.stringify(results.violations, null, 2), contentType: 'application/json' });
  return results.violations
    .filter(v => v.impact === 'serious' || v.impact === 'critical')
    .map(v => ({ id: v.id, nodes: v.nodes.map(n => n.target.join(' ')) }));
};

const summary = (page: Page) => page.locator('.connected-summary');
const resultView = (page: Page) => page.getByRole('tabpanel', { name: 'Result' });

for (const width of [1280, 390]) {
  test(`a new visitor is guided from connect to a tool call to the share prompt at ${width}px`, async ({ page }, testInfo) => {
    test.setTimeout(60_000);
    await page.setViewportSize({ width, height: 900 });

    // Hold the first MCP response so the stage list can be observed mid-attempt.
    let release!: () => void;
    const gate = new Promise<void>(resolve => { release = resolve; });
    let held = false;
    await page.route(mockUrl('2026'), async route => {
      if (!held && route.request().method() === 'POST') {
        held = true;
        await gate;
      }
      await route.fallback();
    });

    await connect(page, '2026');
    const stages = page.locator('.connection-stages');
    await expect(stages).toBeVisible();
    await expect(stages.locator('[data-stage="reach"]')).toHaveAttribute('data-status', 'active');
    await expect(stages.locator('[data-stage="negotiate"]')).toHaveAttribute('data-status', 'pending');
    // Without a response, nothing advances on its own.
    await page.waitForTimeout(400);
    await expect(stages.locator('[data-stage="reach"]')).toHaveAttribute('data-status', 'active');
    await expect(page.locator('.connection-progress [role="status"]')).toHaveText(/Reach the endpoint/);
    if (width === 1280) await testInfo.attach('connecting-stages', { body: await page.screenshot(), contentType: 'image/png' });
    release();

    // Summary: identity, negotiated session, counts and one next action; focus lands on it.
    await expect(page.getByRole('heading', { name: 'MCP connection ready' })).toBeVisible();
    const name = summary(page).getByRole('heading', { level: 2 });
    await expect(name).toHaveText(/mcptest-e2e-mock/);
    await expect(name).toBeFocused();
    const session = summary(page).getByRole('list', { name: 'Session' });
    await expect(session).toContainText('MCP 2026-07-28');
    await expect(session).toContainText('Streamable HTTP');
    await expect(session).toContainText('No auth');
    const capabilities = summary(page).getByRole('list', { name: 'Capabilities' });
    await expect(capabilities).toContainText('2 tools');
    await expect(capabilities).toContainText('1 resource');
    await expect(capabilities).toContainText('1 prompt');
    await expect(summary(page).getByRole('status')).toHaveText(/Connected\. 2 tools, 1 resource, 1 prompt/);

    // Guided first call: the hint, then "Call a tool" lands on the first tool.
    await expect(page.locator('.onboarding-hint--tools')).toContainText('Pick a tool to call');
    if (width === 1280) await testInfo.attach('connected-guided', { body: await page.screenshot(), contentType: 'image/png' });
    expect(await hasHorizontalScroll(page)).toBe(false);
    await summary(page).getByRole('button', { name: 'Call a tool' }).click();
    const firstTool = page.getByRole('listbox', { name: 'Tools' }).getByRole('option').first();
    await expect(firstTool).toBeFocused();
    await firstTool.click();
    await expect(page.locator('.onboarding-hint--tools')).toHaveCount(0);
    const request = page.getByRole('region', { name: 'Request builder' });
    await expect(request).toContainText('Returns a structured weather forecast for a city.');
    await expect(request).toContainText('Fields marked * are required.');
    await page.getByLabel(/^city/).fill('Oslo');
    await page.locator('#executeBtn').click();

    // The result explains itself, focus moves to it and the call is announced.
    await expect(resultView(page).locator('.tool-result-explanation')).toContainText('Structured content is the typed JSON');
    await expect(page.getByRole('region', { name: 'Last result' })).toBeFocused();
    await expect(page.locator('.output-panel > [role="status"]')).toHaveText('Call 1: get_forecast returned a result.');
    await resultView(page).getByRole('button', { name: 'View result JSON' }).click();
    await expect(resultView(page).getByRole('tab', { name: 'JSON-RPC' })).toHaveAttribute('aria-selected', 'true');
    await expect(resultView(page).locator('.tool-result-explanation')).toContainText('envelope is reconstructed');

    // The share prompt follows the first successful run.
    const share = page.getByRole('complementary', { name: 'Next step: share a report' });
    await expect(share).toContainText('redacted');
    await expect(share.getByRole('link', { name: 'Share report' })).toHaveAttribute('href', `/report/${encodeURIComponent(mockUrl('2026'))}`);
    await expect(summary(page).getByRole('link', { name: 'Share report' })).toBeVisible();
    expect(await hasHorizontalScroll(page)).toBe(false);
    if (width === 1280) {
      await share.scrollIntoViewIfNeeded();
      await testInfo.attach('first-call-share-prompt', { body: await page.screenshot(), contentType: 'image/png' });
    }
    expect(await blockingViolations(page, testInfo, `guided-${width}`)).toEqual([]);

    // Dismissed hints stay dismissed on the next visit.
    await share.getByRole('button', { name: 'Dismiss the share report hint' }).click();
    await expect(share).toHaveCount(0);
    await expect.poll(() => page.evaluate(() => JSON.parse(localStorage.getItem('mcptest-onboarding-dismissed') || '[]')))
      .toContain('share-report');
  });
}

test('a returning visitor who has completed the steps sees no hints', async ({ page }) => {
  await page.addInitScript(() => {
    localStorage.setItem('mcptest-next-steps-completed', JSON.stringify(['tool', 'report']));
  });
  await connect(page, '2026');
  await expect(page.getByRole('heading', { name: 'MCP connection ready' })).toBeVisible();
  await expect(page.getByRole('listbox', { name: 'Tools' })).toBeVisible();
  await expect(page.locator('.onboarding-hint')).toHaveCount(0);
  await page.getByRole('option', { name: /get_forecast/ }).click();
  await page.getByLabel(/^city/).fill('Tartu');
  await page.locator('#executeBtn').click();
  await expect(resultView(page)).toContainText('"city": "Tartu"');
  await expect(page.locator('.onboarding-hint')).toHaveCount(0);
  // The primary action still moves on; it is not a hint.
  await expect(summary(page).getByRole('link', { name: 'Share report' })).toBeVisible();
});

test('repeated runs started with Enter in a form field are each announced', async ({ page }) => {
  await page.addInitScript(() => {
    localStorage.setItem('mcptest-next-steps-completed', JSON.stringify(['tool', 'report']));
  });
  await connect(page, '2026');
  await page.getByRole('option', { name: /get_forecast/ }).click();
  const city = page.getByLabel(/^city/);
  const status = page.locator('.output-panel > [role="status"]');

  // Consecutive successes: same tool, same outcome, focus stays in the form.
  await city.fill('Oslo');
  await city.press('Enter');
  await expect(resultView(page)).toContainText('"city": "Oslo"');
  await expect(status).toHaveText('Call 1: get_forecast returned a result.');
  await city.fill('Bergen');
  await city.press('Enter');
  await expect(resultView(page)).toContainText('"city": "Bergen"');
  await expect(status).toHaveText('Call 2: get_forecast returned a result.');
  await expect(city).toBeFocused();

  // Consecutive failures: every failed call uses the same sentence.
  await page.route(mockUrl('2026'), async route => {
    if (route.request().method() === 'POST' && (route.request().postData() || '').includes('"tools/call"')) {
      await route.fulfill({ status: 500, contentType: 'text/plain', body: 'tool exploded' });
      return;
    }
    await route.fallback();
  });
  await city.fill('Tromsø');
  await city.press('Enter');
  await expect(status).toHaveText('Call 3: The call failed. The result panel explains what happened.');
  await city.fill('Bodø');
  await city.press('Enter');
  await expect(status).toHaveText('Call 4: The call failed. The result panel explains what happened.');
  await expect(city).toBeFocused();
});

test('a failed connection shows the failed stage and plain guidance before the technical detail', async ({ page }, testInfo) => {
  await connect(page, 'accept-406');
  const card = page.locator('.connection-console section[role="alert"]');
  await expect(card).toBeVisible();
  await expect(card).toHaveAttribute('data-guidance-id', 'media-type');
  await expect(card.locator('.failure-guidance-what')).toHaveText('The server refused the request format the MCP spec requires.');
  await expect(card.locator('.failure-guidance-learn a')).toHaveAttribute('href', '/learn/mcp-406-not-acceptable-415-and-405');
  await expect(page.locator('.connection-stages [data-status="failed"]')).toHaveCount(1);
  await expect(page.locator('.connection-stages [data-stage="reach"]')).toHaveAttribute('data-status', 'done');
  await card.scrollIntoViewIfNeeded();
  await testInfo.attach('connection-failure-guidance', { body: await page.screenshot(), contentType: 'image/png' });
  expect(await blockingViolations(page, testInfo, 'failure')).toEqual([]);
});

test('the list stage advances in the summary as each list request finishes', async ({ page }) => {
  await page.addInitScript(() => {
    localStorage.setItem('mcptest-next-steps-completed', JSON.stringify(['tool', 'report']));
  });
  // Hold the prompts list so the stage is observed between list responses.
  let release!: () => void;
  const gate = new Promise<void>(resolve => { release = resolve; });
  await page.route(mockUrl('2026'), async route => {
    if (route.request().method() === 'POST' && route.request().postDataJSON()?.method === 'prompts/list') await gate;
    await route.fallback();
  });
  await connect(page, '2026');
  const stage = summary(page).locator('[data-stage="list"]');
  await expect(stage).toHaveAttribute('data-status', 'active');
  await expect(stage).toContainText('3 of 4 lists received');
  await expect(summary(page).getByRole('status')).toHaveText('List tools, resources and prompts: 3 of 4 lists received.');
  release();
  await expect(stage).toHaveAttribute('data-status', 'done');
  await expect(stage).toContainText('2 tools, 1 resource, 1 prompt');
  await expect(summary(page).getByRole('status')).toHaveText(/Connected\. 2 tools, 1 resource, 1 prompt/);
});

test('"Call a tool" expands a collapsed Tools list and focuses its first tool', async ({ page }) => {
  await connect(page, '2026');
  await expect(page.getByRole('listbox', { name: 'Tools' })).toBeVisible();
  await page.locator('.workbench-capabilities summary', { hasText: 'Tools' }).click();
  await expect(page.getByRole('listbox', { name: 'Tools' })).toHaveCount(0);
  await summary(page).getByRole('button', { name: 'Call a tool' }).click();
  await expect(page.getByRole('listbox', { name: 'Tools' }).getByRole('option').first()).toBeFocused();
});
