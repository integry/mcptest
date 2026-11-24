import { expect, test, type Page } from '@playwright/test';
import { SITE_ASSISTANT_META_NAME } from '../../src/siteAssistant/config.mts';

// Opt in because the live engine is outside CI's control. Use app-staging.solv.chat
// while production is older than 0.1.13. Only local HTML can be rewritten.
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

async function useLiveEndpoint(page: Page, baseURL: string, configured = true) {
  await page.route(`${baseURL}/**`, async route => {
    if (route.request().resourceType() !== 'document') return route.fallback();
    const response = await route.fetch();
    const html = await response.text();
    const original = html.match(new RegExp(`<meta name="${SITE_ASSISTANT_META_NAME}" data-endpoint="([^"]+)"`))?.[1];
    if (!original) throw new Error('Build the site with its assistant config before running the live dock test.');
    const body = configured
      ? html.split(original).join(endpoint!)
      : html.replace(new RegExp(`<meta name="${SITE_ASSISTANT_META_NAME}"[^>]*>`), '')
        .replace(/<script data-key="[^"]*">[\s\S]*?<\/script>/, '');
    await route.fulfill({ response, body });
  });
}

test.use({ viewport: { width: 1440, height: 1000 }, ignoreHTTPSErrors: true });
test.skip(!endpoint, 'Set E2E_SOLV_DOCK_ENDPOINT to a live solv.chat engine serving widget 0.1.13.');

test('a live docked panel preserves content width on route changes and from the first reload frame', async ({ page, context, baseURL }) => {
  if (process.env.VITE_SOLV_ENDPOINT !== endpoint) await useLiveEndpoint(page, baseURL!);
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

  // Open the widget and then mount the app before testing router navigation.
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

  for (const width of [1280, 1920, 1440]) {
    await page.setViewportSize({ width, height: 1000 });
    await expect.poll(async () => (await panel.boundingBox())?.x).toBe(width - 460);
    const bounds = await page.locator(content).boundingBox();
    expect(bounds!.x + bounds!.width).toBeLessThanOrEqual(width - 460);
  }
  await page.keyboard.press('Shift');
  await expect(page.locator('[data-deferred-mount]')).toHaveCount(0);
  const previousWidget = await page.locator(widget).elementHandle();
  await page.evaluate(() => { window.dockFrames.length = 0; });
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
  await cdp.send('Network.emulateNetworkConditions', {
    offline: false,
    latency: 400,
    downloadThroughput: 400 * 1024,
    uploadThroughput: 400 * 1024,
  });
  const requestsBeforeReload = requests.length;
  await page.reload({ waitUntil: 'commit' });
  await expect(page.locator('div[id^="solv-dock:1:"]')).toBeVisible({ timeout: 1_500 });
  await expect(panel).toBeVisible();
  await expect(page.locator('div[id^="solv-dock:1:"]')).toHaveCount(0);
  expect(requests.slice(requestsBeforeReload).filter(url => url === `${endpoint}/widget.js`)).toHaveLength(1);
  await page.waitForLoadState('domcontentloaded');
  const { widgetStart, domContentLoaded } = await page.evaluate(url => ({
    widgetStart: performance.getEntriesByName(url, 'resource')[0]?.startTime,
    domContentLoaded: (performance.getEntriesByType('navigation')[0] as PerformanceNavigationTiming).domContentLoadedEventStart,
  }), `${endpoint}/widget.js`);
  expect(widgetStart).toBeLessThan(domContentLoaded);
  const reloadFrames = await page.evaluate(() => new Promise<DockFrame[]>(resolve => {
    requestAnimationFrame(() => requestAnimationFrame(() => resolve(window.dockFrames)));
  }));
  expect(reloadFrames[0]).toEqual({ width: dockedWidth, placeholder: true, panel: false });
  expect(reloadFrames[reloadFrames.length - 1]).toEqual({ width: dockedWidth, placeholder: false, panel: true });
  expect(reloadFrames.every(frame => frame.width === dockedWidth && (frame.placeholder || frame.panel))).toBe(true);

  await cdp.detach();

  // A separate tab has no dock state, even while the original tab is open.
  const fresh = await context.newPage();
  if (process.env.VITE_SOLV_ENDPOINT !== endpoint) await useLiveEndpoint(fresh, baseURL!);
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

for (const { path, heading } of [
  { path: '/catalog', heading: 'Submit a server' },
  { path: '/learn', heading: 'What is the Model Context Protocol?' },
]) {
  test(`the first link click on ${path} navigates natively at the same speed with the assistant configured`, async ({ browser, baseURL }) => {
    test.setTimeout(120_000);
    const measure = async (configured: boolean) => {
      const context = await browser.newContext({ baseURL });
      try {
        const page = await context.newPage();
        await useLiveEndpoint(page, baseURL!, configured);
        const cdp = await context.newCDPSession(page);
        await cdp.send('Emulation.setCPUThrottlingRate', { rate: 4 });
        await cdp.send('Network.emulateNetworkConditions', {
          offline: false, latency: 150, downloadThroughput: -1, uploadThroughput: -1,
        });
        await page.addInitScript(() => {
          window.addEventListener('click', event => {
            const link = (event.target as Element).closest('main a[href]');
            if (link) sessionStorage.setItem('static-link-click', JSON.stringify({
              time: performance.timeOrigin + event.timeStamp,
              prevented: event.defaultPrevented,
            }));
          });
        });
        const samples: number[] = [];
        for (let run = 0; run < 3; run += 1) {
          await page.goto(path, { waitUntil: 'domcontentloaded' });
          await expect(page.locator('[data-deferred-mount]')).toBeVisible();
          const link = page.locator('.main-content a[href^="/"]').first();
          const destination = new URL((await link.getAttribute('href'))!, page.url()).href;
          await link.click({ noWaitAfter: true });
          await page.waitForURL(destination, { waitUntil: 'commit' });
          await expect(page.getByRole('heading', { level: 1, name: heading, exact: true })).toBeVisible();
          const { prevented, elapsed } = await page.evaluate(() => {
            const click = JSON.parse(sessionStorage.getItem('static-link-click')!);
            const navigation = performance.getEntriesByType('navigation')[0] as PerformanceNavigationTiming;
            return { prevented: click.prevented, elapsed: performance.timeOrigin + navigation.responseStart - click.time };
          });
          expect(prevented).toBe(false);
          expect(elapsed).toBeGreaterThanOrEqual(0);
          samples.push(elapsed);
        }
        return samples.sort((left, right) => left - right)[1];
      } finally {
        await context.close();
      }
    };

    const baseline = await measure(false);
    const configured = await measure(true);
    expect(configured).toBeLessThanOrEqual(baseline * 1.5);
  });
}
