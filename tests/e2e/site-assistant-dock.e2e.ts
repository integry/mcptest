import { expect, test, type Page } from '@playwright/test';
import { SITE_ASSISTANT_META_NAME } from '../../src/siteAssistant/config.mts';

// Opt in because the live engine is outside CI's control. Use app-staging.solv.chat
// while production is older than 0.1.12. Only local HTML can be rewritten.
const endpoint = process.env.E2E_SOLV_DOCK_ENDPOINT;
const guide = '/learn/oauth-for-mcp-explained';
const content = '.main-content';
const widget = 'solv-chat';
const launcher = '.site-assistant-launcher';

type DockFrame = { width: number; placeholder: boolean; panel: boolean };
declare global {
  interface Window {
    dockFrames: DockFrame[];
  }
}

async function sampleFrames(page: Page) {
  await page.addInitScript(({ content, widget }) => {
    window.dockFrames = [];
    const sample = () => {
      const main = document.querySelector(content);
      if (main) {
        const panel = document.querySelector(widget)?.shadowRoot?.querySelector<HTMLElement>('.solv-panel');
        const placeholder = document.querySelector<HTMLElement>('div[id^="solv-dock:1:"]');
        window.dockFrames.push({
          width: main.getBoundingClientRect().width,
          placeholder: Boolean(placeholder?.getBoundingClientRect().width),
          panel: Boolean(panel?.getBoundingClientRect().width),
        });
      }
      requestAnimationFrame(sample);
    };
    requestAnimationFrame(sample);
  }, { content, widget });
}

async function useLiveEndpoint(page: Page, baseURL: string) {
  await page.route(`${baseURL}/**`, async route => {
    if (route.request().resourceType() !== 'document') return route.fallback();
    const response = await route.fetch();
    const html = await response.text();
    const original = html.match(new RegExp(`<meta name="${SITE_ASSISTANT_META_NAME}" data-endpoint="([^"]+)"`))?.[1];
    if (!original) throw new Error('Build the site with its assistant config before running the live dock test.');
    await route.fulfill({ response, body: html.split(original).join(endpoint!) });
  });
}

test.use({ viewport: { width: 1440, height: 1000 }, ignoreHTTPSErrors: true });
test.skip(!endpoint, 'Set E2E_SOLV_DOCK_ENDPOINT to a live solv.chat engine serving widget 0.1.12.');

test('a live docked panel preserves content width on route changes and from the first reload frame', async ({ page, context, baseURL }) => {
  await useLiveEndpoint(page, baseURL!);
  await sampleFrames(page);
  const requests: string[] = [];
  page.on('request', request => {
    if (new URL(request.url()).origin === endpoint) requests.push(request.url());
  });

  await page.goto('/learn');
  await expect(page.locator(launcher)).toBeVisible();
  const mainWidth = () => page.locator(content).evaluate(element => element.getBoundingClientRect().width);
  const undockedWidth = await mainWidth();
  expect(requests).toEqual([]);
  await expect(page.locator('div[id^="solv-dock:1:"]')).toHaveCount(0);

  // Open the widget without pointer or keyboard input so the static shell
  // remains in place until the first navigation click.
  await page.locator(launcher).evaluate((button: HTMLButtonElement) => button.click());
  const panel = page.locator(widget).getByRole('dialog');
  await expect(panel).toBeVisible();
  // Allow an engine that uses its default floating layout to finish loading
  // settings, then dock it using the real widget control.
  const expand = panel.getByRole('button', { name: 'Expand to a side panel' });
  const collapse = panel.getByRole('button', { name: 'Collapse to a small window' });
  await expect(expand.or(collapse)).toBeVisible();
  if (await expand.isVisible()) await expand.evaluate((button: HTMLButtonElement) => button.click());
  await expect(page.locator(widget)).toHaveAttribute('data-layout', 'side');
  const dockedWidth = await mainWidth();
  expect(dockedWidth).toBeLessThan(undockedWidth);

  const previousWidget = await page.locator(widget).elementHandle();
  await page.evaluate(() => { window.dockFrames.length = 0; });
  await expect(page.locator('[data-deferred-mount]')).toBeVisible();
  const guideLink = page.locator(`a[href="${guide}"]`).filter({ visible: true }).first();
  await guideLink.click();
  await expect(page).toHaveURL(new RegExp(`${guide}$`));
  await expect(page.getByRole('heading', { level: 1, name: 'OAuth for MCP explained' })).toBeVisible();
  expect(await page.locator(widget).evaluate((element, previous) => element === previous, previousWidget)).toBe(true);
  // Back and another link click now run in the mounted router.
  await page.goBack();
  await expect(guideLink).toBeVisible();
  await guideLink.click();
  await expect(page.getByRole('heading', { level: 1, name: 'OAuth for MCP explained' })).toBeVisible();
  expect(await page.locator(widget).evaluate((element, previous) => element === previous, previousWidget)).toBe(true);
  const routeFrames = await page.evaluate(() => window.dockFrames);
  expect(routeFrames.length).toBeGreaterThan(0);
  expect(routeFrames.every(frame => frame.width === dockedWidth && frame.panel)).toBe(true);

  const cdp = await context.newCDPSession(page);
  await cdp.send('Network.enable');
  await cdp.send('Network.setCacheDisabled', { cacheDisabled: true });
  await cdp.send('Network.emulateNetworkConditionsByRule', {
    offline: false,
    matchedNetworkConditions: [{
      urlPattern: `${endpoint}/widget.js`,
      latency: 900,
      downloadThroughput: -1,
      uploadThroughput: -1,
    }],
  });
  const requestsBeforeReload = requests.length;
  await page.reload({ waitUntil: 'commit' });
  await expect(page.locator('div[id^="solv-dock:1:"]')).toBeVisible({ timeout: 1_500 });
  await expect(panel).toBeVisible();
  await expect(page.locator('div[id^="solv-dock:1:"]')).toHaveCount(0);
  expect(requests.slice(requestsBeforeReload)).toContain(`${endpoint}/widget.js`);
  const reloadFrames = await page.evaluate(() => new Promise<DockFrame[]>(resolve => {
    requestAnimationFrame(() => requestAnimationFrame(() => resolve(window.dockFrames)));
  }));
  expect(reloadFrames[0]).toEqual({ width: dockedWidth, placeholder: true, panel: false });
  expect(reloadFrames[reloadFrames.length - 1]).toEqual({ width: dockedWidth, placeholder: false, panel: true });
  expect(reloadFrames.every(frame => frame.width === dockedWidth && (frame.placeholder || frame.panel))).toBe(true);

  // A separate tab has no dock state, even while the original tab is open.
  const fresh = await context.newPage();
  await useLiveEndpoint(fresh, baseURL!);
  const freshRequests: string[] = [];
  fresh.on('request', request => {
    if (new URL(request.url()).origin === endpoint) freshRequests.push(request.url());
  });
  await fresh.goto(guide);
  await expect(fresh.locator(launcher)).toBeVisible();
  await expect(fresh.locator('div[id^="solv-dock:1:"]')).toHaveCount(0);
  expect(await fresh.locator(content).evaluate(element => element.getBoundingClientRect().width)).toBe(undockedWidth);
  expect(freshRequests).toEqual([]);
  await fresh.close();

  await panel.getByRole('button', { name: 'Close chat' }).click();
  await expect(panel).toBeHidden();
  const requestsAfterClose = requests.length;
  await page.reload();
  await expect(page.locator(launcher)).toBeVisible();
  await expect(page.locator('div[id^="solv-dock:1:"]')).toHaveCount(0);
  await expect(page.locator(widget)).toHaveCount(0);
  expect(await mainWidth()).toBe(undockedWidth);
  expect(requests).toHaveLength(requestsAfterClose);
});
