import { expect, test as base, type Page } from '@playwright/test';
import { MOCK_PORT } from '../../playwright.config';

export type MockPath = '2026' | '2025' | 'accept-406' | 'no-expose' | 'rate-limited';

/** Endpoint of the local mock MCP server for one flow or misbehavior mode. */
export const mockUrl = (path: MockPath): string => `http://127.0.0.1:${MOCK_PORT}/${path}/mcp`;

const LOCAL_ORIGIN = /^http:\/\/127\.0\.0\.1(:\d+)?\//;
const WORKER_ROUTE = /^\/(badge\/(server|report)\/|r(\/|$))/;
const STUB_BADGE = '<svg xmlns="http://www.w3.org/2000/svg" width="90" height="20"><rect width="90" height="20" fill="#555"/></svg>';

/**
 * Every test runs hermetically: requests that leave the machine are aborted
 * and recorded, and the Worker-only routes (live badges, published reports),
 * which the static server cannot answer, are stubbed.
 */
export const test = base.extend<{ externalRequests: string[] }>({
  externalRequests: [async ({ context }, use) => {
    const external: string[] = [];
    await context.route(() => true, async (route) => {
      const url = new URL(route.request().url());
      if (!LOCAL_ORIGIN.test(url.href)) {
        external.push(url.href);
        await route.abort('blockedbyclient');
        return;
      }
      if (url.port !== String(MOCK_PORT) && WORKER_ROUTE.test(url.pathname)) {
        if (url.pathname.endsWith('.svg')) {
          await route.fulfill({ status: 200, contentType: 'image/svg+xml', body: STUB_BADGE });
        } else {
          await route.fulfill({ status: 404, contentType: 'application/json', body: '{"error":"not_found"}' });
        }
        return;
      }
      await route.fallback();
    });
    await use(external);
  }, { auto: true }],
});

export { expect };

/** Connects from the playground's landing input and waits for the ready state. */
export async function connect(page: Page, path: MockPath): Promise<void> {
  await page.goto('/');
  await page.getByLabel('MCP endpoint URL').fill(mockUrl(path));
  await page.getByRole('button', { name: 'Connect', exact: true }).click();
}

export async function connectAndWait(page: Page, path: MockPath): Promise<void> {
  await connect(page, path);
  await expect(page.getByRole('heading', { name: 'MCP connection ready' })).toBeVisible();
}

/** True when the page scrolls sideways at the current viewport. */
export const hasHorizontalScroll = (page: Page): Promise<boolean> => page.evaluate(() => (
  document.documentElement.scrollWidth > window.innerWidth
  || document.body.scrollWidth > window.innerWidth
));
