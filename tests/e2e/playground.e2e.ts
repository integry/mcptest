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

for (const width of [1280, 390]) {
  test(`returning visitor never paints a landing frame at ${width}px`, async ({ page }, testInfo) => {
    test.setTimeout(90_000);
    await page.setViewportSize({ width, height: 844 });
    // Let the application write its real recent-server objects and saved tabs.
    const endpoint = mockUrl('2026');
    const mock = new URL(endpoint);
    await page.goto(`/server/http:${mock.host}${mock.pathname}`);
    await expect(page.getByRole('heading', { name: 'MCP connection ready' })).toBeVisible();
    await expect.poll(() => page.evaluate(() => JSON.parse(localStorage.getItem('mcpRecentServers') || '[]')))
      .toContainEqual({ url: endpoint });
    await expect.poll(() => page.evaluate(() => JSON.parse(localStorage.getItem('mcpConnectionTabs') || '[]')))
      .toEqual(expect.arrayContaining([expect.objectContaining({ serverUrl: endpoint })]));

    await page.addInitScript(() => {
      const frames: unknown[] = [];
      (window as any).__returningFrames = frames;
      const visible = (selector: string) => [...document.querySelectorAll(selector)].some(el => el.getClientRects().length > 0);
      const record = () => {
        if (visible('.app-header')) {
          const panel = [...document.querySelectorAll('.connection-console')].find(el => el.getClientRects().length > 0);
          const rect = panel?.getBoundingClientRect();
          frames.push({
            static: Boolean(document.querySelector('.seo-shell-fallback')),
            landing: visible('.landing-title'), panel: Boolean(panel),
            tabs: [...document.querySelectorAll('.playground-tab-label')].map(el => el.textContent),
            rect: rect && { x: rect.x, y: rect.y, width: rect.width, height: rect.height },
          });
        }
        if (frames.length < 3000) requestAnimationFrame(record);
      };
      requestAnimationFrame(record);
    });
    const cdp = await page.context().newCDPSession(page);
    await cdp.send('Network.enable');
    await cdp.send('Network.setCacheDisabled', { cacheDisabled: true });
    await cdp.send('Network.emulateNetworkConditions', { offline: false, latency: 150, downloadThroughput: 200_000, uploadThroughput: 200_000 });
    await page.goto('/', { waitUntil: 'commit' });
    await expect(page.locator('.seo-returning-workspace .connection-console')).toBeVisible();
    await testInfo.attach('returning-static-first-paint', { body: await page.screenshot(), contentType: 'image/png' });
    await expect(page.locator('.seo-shell-fallback')).toHaveCount(0, { timeout: 60_000 });
    await expect(page.locator('.recent-server-link').first()).toHaveText(endpoint);
    await expect(page.getByRole('heading', { name: 'Suggested servers' })).toBeVisible();
    // Include the delayed auth resolution and restoration effects after mount.
    await page.waitForTimeout(1800);
    const frames = await page.evaluate(() => (window as any).__returningFrames as {
      static: boolean; landing: boolean; panel: boolean; tabs: string[];
      rect: { x: number; y: number; width: number; height: number };
    }[]);
    await testInfo.attach('returning-paint-timeline', { body: JSON.stringify(frames, null, 2), contentType: 'application/json' });
    expect(frames.some(frame => frame.static)).toBe(true);
    expect(frames.some(frame => !frame.static)).toBe(true);
    expect(frames.every(frame => !frame.landing && frame.panel)).toBe(true);
    const first = frames.find(frame => frame.static)!;
    const last = frames[frames.length - 1]!;
    expect(first.tabs).toEqual(last.tabs);
    for (const key of ['x', 'y', 'width', 'height'] as const) {
      expect(Math.abs(first.rect[key] - last.rect[key]), `connection panel ${key}: ${JSON.stringify({ first: first.rect, last: last.rect })}`).toBeLessThan(2);
    }
    await testInfo.attach('returning-mounted', { body: await page.screenshot(), contentType: 'image/png' });
  });
}

test('context7 deep link connects to and stores the literal /mcp endpoint', async ({ page }) => {
  const endpoint = 'https://mcp.context7.com/mcp';
  // Keep the endpoint and all MCP exchanges real; forward only the network
  // destination to our local protocol fixture.
  const requests: string[] = [];
  await page.context().route('https://mcp.context7.com/**', async route => {
    requests.push(route.request().url());
    const response = await route.fetch({ url: mockUrl('2026') });
    await route.fulfill({ response });
  });
  await page.goto('/server/mcp.context7.com/mcp');
  await expect(page.getByRole('heading', { name: 'MCP connection ready' })).toBeVisible();
  await expect(page.locator('.connection-endpoint')).toHaveText(endpoint);
  await expect.poll(() => page.evaluate(() => JSON.parse(localStorage.getItem('mcpRecentServers') || '[]')))
    .toEqual([{ url: endpoint }]);
  expect(requests.length).toBeGreaterThan(0);
  expect(requests.every(url => url === endpoint)).toBe(true);
  await page.goto('/');
  await expect(page.locator('.recent-server-link').first()).toHaveText(endpoint);
});
