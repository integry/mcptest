import type { Page } from '@playwright/test';
import { connectAndWait, expect, mockUrl, test } from './fixtures';

/** The structured / content / JSON-RPC view inside the Result tab. */
const resultView = (page: Page) => page.getByRole('tabpanel', { name: 'Result' }).getByRole('tabpanel');

test.describe('playground against the mock MCP server', () => {
  test('2026-07-28 stateless: connect, capabilities, fuzzy search, structured output and error result', async ({ page, externalRequests }, testInfo) => {
    await connectAndWait(page, '2026');

    const era = page.getByTestId('connection-protocol-era');
    await expect(era).toHaveText('Stateless');
    await expect(era).toHaveAttribute('title', 'Negotiated MCP 2026-07-28');

    // Capabilities: tools, resources and prompts from the mock.
    await expect(page.getByText('2 tools · 1 resource · 1 prompt', { exact: true })).toBeVisible();
    const lists = page.getByRole('navigation', { name: 'Playground tool lists' });
    await expect(lists.getByRole('option', { name: /get_forecast/ })).toBeVisible();
    await expect(lists.getByRole('option', { name: /always_fails/ })).toBeVisible();
    await expect(lists.getByRole('option', { name: /readme/ })).toBeVisible();
    await expect(lists.getByRole('option', { name: /greeting/ })).toBeVisible();

    // Fuzzy search: a subsequence of the tool name finds it and nothing else.
    const search = page.getByRole('combobox', { name: 'Search tools, resources and prompts' });
    await search.fill('frcst');
    await expect(lists.getByRole('option', { name: /get_forecast/ })).toBeVisible();
    await expect(lists.getByRole('option')).toHaveCount(1);
    await search.press('Enter');
    await expect(page.locator('#executeBtn')).toHaveText('Run tool');

    // Structured tool: the verdict and the structured view.
    await page.getByLabel(/^city/).fill('Oslo');
    await page.locator('#executeBtn').click();
    await expect(page.getByRole('status').filter({ hasText: 'Structured output matches the declared output schema.' })).toBeVisible();
    await expect(page.getByRole('tab', { name: 'Structured' })).toHaveAttribute('aria-selected', 'true');
    await expect(resultView(page)).toContainText('"conditions": "Light rain"');
    await expect(resultView(page)).toContainText('"city": "Oslo"');
    await testInfo.attach('playground-structured-output', {
      body: await page.screenshot(),
      contentType: 'image/png',
    });

    // Error tool: isError is surfaced and exempt from the output contract.
    await search.fill('');
    await lists.getByRole('option', { name: /always_fails/ }).click();
    await page.locator('#executeBtn').click();
    await expect(page.getByRole('alert').filter({ hasText: 'The tool reported an error (isError: true).' })).toBeVisible();
    await expect(page.getByRole('status').filter({ hasText: 'Structured output matches' })).toHaveCount(0);

    expect(externalRequests).toEqual([]);
  });

  test('2025-11-25 stateful: falls back to initialize and keeps the session', async ({ page }) => {
    await connectAndWait(page, '2025');

    const era = page.getByTestId('connection-protocol-era');
    await expect(era).toHaveText('Stateful');
    await expect(era).toHaveAttribute('title', 'Negotiated MCP 2025-11-25');
    await expect(page.getByText('2 tools · 1 resource · 1 prompt', { exact: true })).toBeVisible();

    // A call after the handshake only succeeds when the session id is sent.
    const lists = page.getByRole('navigation', { name: 'Playground tool lists' });
    await lists.getByRole('option', { name: /get_forecast/ }).click();
    await page.getByLabel(/^city/).fill('Tartu');
    await page.locator('#executeBtn').click();
    await expect(page.getByRole('status').filter({ hasText: 'Structured output matches the declared output schema.' })).toBeVisible();
    await expect(resultView(page)).toContainText('"city": "Tartu"');
  });
});

test('connection address can be copied and reload reconnects immediately', async ({ page }) => {
  await connectAndWait(page, '2026');
  const endpoint = new URL(mockUrl('2026'));
  await expect(page).toHaveURL(new RegExp(`/server/http:${endpoint.host}/${'2026'}/mcp$`));
  const shared = page.url();
  await page.reload();
  await expect(page.getByRole('heading', { name: 'MCP connection ready' })).toBeVisible();
  await expect(page).toHaveURL(shared);
  await page.getByRole('button', { name: 'Disconnect', exact: true }).click();
  await expect(page).toHaveURL(/\/$/);
});

test('returning visitor paints recent chips throughout the static-to-React swap', async ({ page }, testInfo) => {
  await page.addInitScript(() => {
    localStorage.setItem('mcpRecentServers', JSON.stringify([{ url: 'https://mcp.context7.com/mcp' }, 'http://localhost:3000/mcp']));
    const frames: unknown[] = [];
    (window as any).__returningFrames = frames;
    const record = () => {
      const recent = document.querySelector('.landing-recent');
      const quick = [...document.querySelectorAll('.landing-quick-picks')].find(el => el.textContent?.includes('Try with'));
      if (document.querySelector('.landing-title')) frames.push({
        t: performance.now(), static: Boolean(document.querySelector('.seo-shell-fallback')),
        recent: Boolean(recent && getComputedStyle(recent).display !== 'none'),
        newUser: Boolean(quick && getComputedStyle(quick).display !== 'none'),
      });
      if (frames.length < 600) requestAnimationFrame(record);
    };
    requestAnimationFrame(record);
  });
  const cdp = await page.context().newCDPSession(page);
  await cdp.send('Network.enable');
  await cdp.send('Network.emulateNetworkConditions', { offline: false, latency: 40, downloadThroughput: 2_500_000, uploadThroughput: 625_000 });
  await page.goto('/', { waitUntil: 'commit' });
  await expect(page.locator('.seo-shell-fallback .landing-recent')).toBeVisible();
  await testInfo.attach('returning-static-first-paint', { body: await page.screenshot(), contentType: 'image/png' });
  await expect(page.locator('.seo-shell-fallback')).toHaveCount(0);
  await expect(page.locator('.landing-recent-host')).toHaveText(['mcp.context7.com', 'localhost:3000']);
  const frames = await page.evaluate(() => (window as any).__returningFrames as { static: boolean; recent: boolean; newUser: boolean }[]);
  expect(frames.some(frame => frame.static)).toBe(true);
  expect(frames.some(frame => !frame.static)).toBe(true);
  expect(frames.every(frame => frame.recent && !frame.newUser)).toBe(true);
  await testInfo.attach('returning-paint-timeline', { body: JSON.stringify(frames, null, 2), contentType: 'application/json' });
  await testInfo.attach('returning-mounted', { body: await page.screenshot(), contentType: 'image/png' });
});
