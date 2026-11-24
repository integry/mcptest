import { expect, test } from '@playwright/test';

declare global {
  interface Window {
    catalogPerformanceData: { start: number; firstResultMs: number; tasks: number[] };
  }
}

test.use({ viewport: { width: 1440, height: 900 } });

test('catalog filters on the first keystroke and keeps the prerendered list through mount', async ({ page }) => {
  await page.goto('/catalog', { waitUntil: 'load' });
  const search = page.locator('#catalog-search');
  const list = page.locator('.catalog-server-list');
  const originalList = await list.elementHandle();
  const originalCount = await list.locator('li').count();
  expect(originalCount).toBeGreaterThan(100);
  await expect(page.locator('[data-deferred-mount]')).toBeVisible();

  await page.evaluate(() => {
    const count = document.querySelector('.catalog-results-count strong')!;
    const originalCount = count.textContent;
    const performanceData = window.catalogPerformanceData = { start: Infinity, firstResultMs: Infinity, tasks: [] };
    document.addEventListener('pointerdown', event => { performanceData.start = event.timeStamp; }, { capture: true, once: true });
    const tasks = new PerformanceObserver(entries => {
      for (const entry of entries.getEntries()) {
        if (entry.startTime + entry.duration >= performanceData.start) performanceData.tasks.push(entry.duration);
      }
    });
    tasks.observe({ type: 'longtask' });
    document.addEventListener('input', event => {
      const results = new MutationObserver(() => {
        if (count.textContent === originalCount) return;
        performanceData.firstResultMs = performance.now() - event.timeStamp;
        results.disconnect();
      });
      results.observe(count, { childList: true });
    }, { capture: true, once: true });
  });

  await search.click();
  await page.keyboard.type('G');
  await expect(search).toHaveValue('G', { timeout: 100 });
  await page.waitForFunction(() => Number.isFinite(window.catalogPerformanceData.firstResultMs));
  await page.keyboard.type('itHub');
  await expect(list.locator('.catalog-server-title[href="/servers/github/"]')).toBeVisible({ timeout: 1000 });
  await expect(page).toHaveURL(/\?q=GitHub$/);
  expect(await list.locator('li').count()).toBeLessThan(originalCount);
  await expect(page.locator('[data-deferred-mount]')).toBeVisible();

  // Allow PerformanceObserver to deliver any task from the result frame.
  const { firstResultMs, tasks } = await page.evaluate(async () => {
    await new Promise(resolve => requestAnimationFrame(() => requestAnimationFrame(resolve)));
    return window.catalogPerformanceData;
  });
  expect(firstResultMs).toBeLessThanOrEqual(500);
  expect(tasks.filter(duration => duration > 200)).toEqual([]);

  await page.keyboard.press('Tab');
  await expect(page.locator('[data-deferred-mount]')).toHaveCount(0);
  await expect(search).toHaveValue('GitHub');
  await expect(page.getByRole('heading', { level: 1 })).toHaveCount(1);
  expect(await list.evaluate((element, original) => element === original, originalList)).toBe(true);
});
